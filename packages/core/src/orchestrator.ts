import { DB, all, one, run, uid, now, tx } from "./db.js";
import type { EventBus } from "./events.js";
import type { ExecutionManager } from "./execution.js";
import { AGENT_TEMPLATES } from "./templates.js";
import { git } from "./git.js";
import { Plan, PlanNode, validatePlan, extractJson, plannerPrompt, isWriteRole, parseHandoffBlock, renderHandoff, HANDOFF_INSTRUCTION, AgentHandoff } from "./orchestration-plan.js";
import type { ProviderId, ProviderStatus } from "./types.js";

export type OrchMode = "manual" | "assisted" | "auto";
export type OrchStatus = "draft" | "planning" | "awaiting_approval" | "running" | "paused" | "completed" | "failed" | "cancelled";
const TERMINAL: OrchStatus[] = ["completed", "failed", "cancelled"];

/** Le moteur local reste responsable de l'ordre, de la concurrence, des autorisations, des transitions et des retries ; l'IA ne fait que proposer un plan. */
export class Orchestrator {
  private chain = new Map<string, Promise<void>>();
  constructor(private db: DB, private bus: EventBus, private exec: ExecutionManager, private statusOf: (p: ProviderId) => Promise<ProviderStatus>) {
    bus.on((e) => {
      if (!e.executionId || !/^execution\.(completed|failed|cancelled|interrupted)$/.test(e.type)) return;
      const status = e.type.split(".")[1]!; const id = e.executionId;
      setImmediate(() => void this.onExecutionEnd(id, status)); // après finalizeTask() du gestionnaire d'exécution
    });
  }

  private ev(orchId: string, type: string, detail?: string, taskId?: string) { run(this.db, "INSERT INTO orch_events VALUES (?,?,?,?,?,?)", uid(), orchId, type, detail ?? null, taskId ?? null, now()); this.bus.emit("orchestration." + type, { detail: detail ?? "" }, { projectId: undefined, taskId }); }
  private setStatus(id: string, s: OrchStatus, extra: Record<string, any> = {}) {
    run(this.db, "UPDATE orchestrations SET status=? WHERE id=?", s, id);
    if (TERMINAL.includes(s)) run(this.db, "UPDATE orchestrations SET finished_at=? WHERE id=?", now(), id);
    for (const [k, v] of Object.entries(extra)) run(this.db, `UPDATE orchestrations SET ${k}=? WHERE id=?`, v, id);
    this.bus.emit("orchestration.status", { id, status: s });
  }
  get(id: string) { return one<any>(this.db, "SELECT * FROM orchestrations WHERE id=?", id); }
  list(projectId?: string) { return all<any>(this.db, `SELECT o.*, (SELECT COUNT(*) FROM tasks WHERE orchestration_id=o.id) tasks, (SELECT COUNT(*) FROM tasks WHERE orchestration_id=o.id AND status='done') done, ((SELECT COALESCE(SUM(u.total),0) FROM usage_events u JOIN tasks t ON t.id=u.task_id WHERE t.orchestration_id=o.id) + (SELECT COALESCE(SUM(total),0) FROM usage_events WHERE execution_id=o.planner_execution_id)) tokens, ((SELECT COALESCE(SUM(c.calculated_usd),0) FROM usage_events u JOIN tasks t ON t.id=u.task_id JOIN cost_estimates c ON c.usage_event_id=u.id WHERE t.orchestration_id=o.id) + (SELECT COALESCE(SUM(c.calculated_usd),0) FROM usage_events u JOIN cost_estimates c ON c.usage_event_id=u.id WHERE u.execution_id=o.planner_execution_id)) usd FROM orchestrations o ${projectId ? "WHERE project_id=?" : ""} ORDER BY created_at DESC`, ...(projectId ? [projectId] : [])); }
  tasks(id: string) { return all<any>(this.db, `SELECT t.*, (SELECT COALESCE(SUM(total),0) FROM usage_events WHERE task_id=t.id) tokens, (SELECT COALESCE(SUM(c.calculated_usd),0) FROM usage_events u JOIN cost_estimates c ON c.usage_event_id=u.id WHERE u.task_id=t.id) usd, (SELECT GROUP_CONCAT(d.depends_on) FROM task_dependencies d WHERE d.task_id=t.id) deps, (SELECT status FROM agent_executions WHERE task_id=t.id ORDER BY created_at DESC LIMIT 1) exec_status, (SELECT duration_ms FROM agent_executions WHERE task_id=t.id ORDER BY created_at DESC LIMIT 1) duration_ms, (SELECT id FROM agent_executions WHERE task_id=t.id ORDER BY created_at DESC LIMIT 1) execution_id FROM tasks t WHERE orchestration_id=? ORDER BY created_at, rowid`, id); }
  handoffs(id: string) { return all<any>(this.db, "SELECT * FROM handoffs WHERE orchestration_id=? ORDER BY created_at", id).map((h) => ({ ...h, payload: JSON.parse(h.payload) })); }
  events(id: string) { return all<any>(this.db, "SELECT * FROM orch_events WHERE orchestration_id=? ORDER BY at", id); }
  gates(id: string) { return all<any>(this.db, "SELECT * FROM orch_gates WHERE orchestration_id=? ORDER BY created_at", id); }
  pendingGates() { return all<any>(this.db, "SELECT g.*, t.title task_title, o.goal FROM orch_gates g JOIN tasks t ON t.id=g.task_id JOIN orchestrations o ON o.id=g.orchestration_id WHERE g.status='pending' ORDER BY g.created_at"); }

  create(o: { projectId: string; goal: string; mode: OrchMode; plannerProvider?: ProviderId; useWorktrees?: boolean; workflowId?: string }): string {
    if (!o.goal.trim()) throw new Error("L'objectif est vide."); if (!one(this.db, "SELECT 1 x FROM projects WHERE id=?", o.projectId)) throw new Error("Projet introuvable");
    const id = uid(); run(this.db, "INSERT INTO orchestrations (id,project_id,goal,mode,status,planner_provider,use_worktrees,created_at,workflow_id) VALUES (?,?,?,?,?,?,?,?,?)", id, o.projectId, o.goal.trim(), o.mode, "draft", o.plannerProvider ?? "claude", o.useWorktrees ? 1 : 0, now(), o.workflowId ?? null);
    this.ev(id, "created", `Mode ${o.mode}`);
    if (o.mode !== "manual") void this.requestPlan(id);
    return id;
  }

  /** Demande un plan à un agent « Orchestrateur » en lecture seule ; le plan est validé localement avant toute utilisation. */
  async requestPlan(id: string) {
    const o = this.get(id); if (!o || !["draft", "awaiting_approval"].includes(o.status)) throw new Error("Statut incompatible avec la planification");
    const proj = one<any>(this.db, "SELECT * FROM projects WHERE id=?", o.project_id); const provider = (o.planner_provider ?? "claude") as ProviderId;
    const agentId = this.ensureAgent(o.project_id, "orchestrator", provider);
    this.setStatus(id, "planning", { error: null }); this.ev(id, "planning", `Planification par ${provider}`);
    const eid = this.exec.enqueue({ projectId: o.project_id, agentId, provider, prompt: plannerPrompt(o.goal, proj), priority: 8 });
    run(this.db, "UPDATE orchestrations SET planner_execution_id=? WHERE id=?", eid, id);
  }

  private async onPlannerDone(o: any, status: string) {
    const ex = one<any>(this.db, "SELECT * FROM agent_executions WHERE id=?", o.planner_execution_id);
    const text = ex?.result_text ?? ""; run(this.db, "UPDATE orchestrations SET planner_text=? WHERE id=?", text.slice(0, 20000), o.id);
    if (status !== "completed") return this.setStatus(o.id, "draft", { error: `Planification ${status === "cancelled" ? "annulée" : "échouée"} : ${ex?.error ?? "voir la session"}. Vous pouvez relancer ou saisir le plan manuellement.` });
    const check = validatePlan(extractJson(text), { unavailable: await this.unavailable(), useWorktrees: !!o.use_worktrees });
    if (!check.ok) { this.ev(o.id, "plan_invalid", check.errors.join(" | ")); return this.setStatus(o.id, "draft", { error: "Plan proposé invalide : " + check.errors.join(" ") }); }
    run(this.db, "UPDATE orchestrations SET plan_json=? WHERE id=?", JSON.stringify(check.plan), o.id); this.ev(o.id, "plan_ready", `${check.plan!.tasks.length} tâches proposées`);
    check.warnings.forEach((w) => this.ev(o.id, "plan_warning", w));
    if (o.mode === "auto") { this.setStatus(o.id, "awaiting_approval"); await this.approve(o.id); } // auto : lancement immédiat, portes d'approbation sur les étapes qui écrivent
    else { this.setStatus(o.id, "awaiting_approval", { error: null }); this.exec.notify("info", "Plan prêt", "Un plan d'orchestration attend votre validation.", "orchestration"); }
  }

  private async unavailable() { const out: string[] = []; for (const p of ["claude", "codex"] as ProviderId[]) { const s = await this.statusOf(p).catch(() => undefined); if (!s?.installed || !s.authenticated) out.push(p); } return out; }
  async checkPlan(id: string, plan: unknown) { const o = this.get(id); return validatePlan(plan, { unavailable: await this.unavailable(), useWorktrees: !!o?.use_worktrees }); }
  /** Enregistre un plan édité par l'utilisateur (manuel ou correction du plan IA). */
  async setPlan(id: string, plan: unknown) {
    const o = this.get(id); if (!o || !["draft", "awaiting_approval"].includes(o.status)) throw new Error("Le plan n'est plus modifiable.");
    const c = await this.checkPlan(id, plan); if (!c.ok) return c;
    run(this.db, "UPDATE orchestrations SET plan_json=?, error=NULL WHERE id=?", JSON.stringify(c.plan), id); this.setStatus(id, "awaiting_approval"); this.ev(id, "plan_edited", `${c.plan!.tasks.length} tâches`); return c;
  }

  /** Approbation humaine du plan → création des tâches/dépendances puis démarrage. */
  async approve(id: string) {
    const o = this.get(id); if (!o || o.status !== "awaiting_approval" || !o.plan_json) throw new Error("Aucun plan à approuver.");
    const c = await this.checkPlan(id, JSON.parse(o.plan_json)); if (!c.ok) throw new Error(c.errors.join(" "));
    const plan = c.plan!; const idOf = new Map<string, string>();
    tx(this.db, () => {
      for (const n of plan.tasks) { const tid = uid(); idOf.set(n.key, tid);
        const gate = (n.kind === "agent" && (n.gate || (o.mode === "auto" && isWriteRole(n.role)))) || (n.kind === "test" && (n.gate || o.mode !== "manual")) ? 1 : 0; // un plan proposé par l'IA ne peut jamais exécuter une commande sans approbation humaine
        run(this.db, "INSERT INTO tasks (id,project_id,title,description,provider,priority,status,created_at,orchestration_id,node_key,node_kind,gate,role) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", tid, o.project_id, n.title, n.kind === "test" ? n.command ?? null : n.description ?? null, n.provider ?? null, 5, "todo", now(), id, n.key, n.kind, gate, n.role); }
      for (const n of plan.tasks) for (const d of n.dependsOn) run(this.db, "INSERT INTO task_dependencies VALUES (?,?)", idOf.get(n.key), idOf.get(d));
      run(this.db, "UPDATE orchestrations SET started_at=? WHERE id=?", now(), id);
    });
    this.setStatus(id, "running"); this.ev(id, "approved", o.mode === "auto" ? "Plan lancé automatiquement (portes d'approbation sur les étapes qui écrivent)" : "Plan approuvé par l'utilisateur");
    await this.tick(id);
  }

  tick(id: string): Promise<void> { const p = (this.chain.get(id) ?? Promise.resolve()).then(() => this.doTick(id)).catch((e) => this.ev(id, "engine_error", String(e?.message ?? e))); this.chain.set(id, p); return p; }

  private async doTick(id: string) {
    const o = this.get(id); if (!o || o.status !== "running") return;
    const tasks = this.tasks(id); const byId = new Map(tasks.map((t) => [t.id, t]));
    if (tasks.length && tasks.every((t) => t.status === "done")) return this.finish(o, tasks);
    for (const t of tasks) {
      if (t.status !== "todo") continue;
      const deps = (t.deps ? String(t.deps).split(",") : []).map((d) => byId.get(d)!);
      if (deps.some((d) => d.status !== "done")) continue;
      if (t.exec_status && ["queued", "preparing", "running", "waiting_approval"].includes(t.exec_status)) continue;
      if (t.node_kind === "notification") { this.exec.notify("info", t.title, t.description ?? o.goal.slice(0, 80), "orchestration"); run(this.db, "UPDATE tasks SET status='done', finished_at=? WHERE id=?", now(), t.id); this.ev(o.id, "notification", t.title, t.id); return void (await this.doTick(id)); }
      if (t.node_kind === "test") { if (t.gate && !(await this.gateApproved(o, t))) continue; run(this.db, "UPDATE tasks SET status='in_progress', started_at=? WHERE id=?", now(), t.id); void this.runTest(o, t); continue; }
      if (t.node_kind === "approval") { await this.ensureGate(o, t, "approval", `Validation requise : ${t.title}`); continue; }
      if (t.gate && !(await this.gateApproved(o, t))) continue;
      await this.launch(o, t, deps);
    }
  }
  private async ensureGate(o: any, t: any, kind: string, summary: string) {
    if (one(this.db, "SELECT 1 x FROM orch_gates WHERE task_id=? AND status='pending'", t.id)) return;
    run(this.db, "INSERT INTO orch_gates VALUES (?,?,?,?,?,?,?,?)", uid(), o.id, t.id, kind, "pending", summary, now(), null);
    this.ev(o.id, "gate_requested", summary, t.id); this.exec.notify("warn", "Approbation requise", `${summary} — ${o.goal.slice(0, 60)}`, "approval");
  }
  private async gateApproved(o: any, t: any) {
    const g = one<any>(this.db, "SELECT status FROM orch_gates WHERE task_id=? ORDER BY created_at DESC LIMIT 1", t.id);
    if (g?.status === "approved") return true; if (!g) await this.ensureGate(o, t, "gate", `Autoriser le démarrage de « ${t.title} » (étape qui peut modifier le projet)`); return false;
  }
  async resolveGate(gateId: string, approved: boolean) {
    const g = one<any>(this.db, "SELECT * FROM orch_gates WHERE id=?", gateId); if (!g || g.status !== "pending") return;
    run(this.db, "UPDATE orch_gates SET status=?, resolved_at=? WHERE id=?", approved ? "approved" : "declined", now(), gateId);
    this.ev(g.orchestration_id, approved ? "gate_approved" : "gate_declined", g.summary, g.task_id);
    if (g.kind === "approval") { if (approved) run(this.db, "UPDATE tasks SET status='done', finished_at=? WHERE id=?", now(), g.task_id); else { run(this.db, "UPDATE tasks SET status='blocked' WHERE id=?", g.task_id); this.pause(g.orchestration_id, "Validation refusée par l'utilisateur."); } }
    else if (!approved) { run(this.db, "UPDATE tasks SET status='blocked' WHERE id=?", g.task_id); this.pause(g.orchestration_id, "Démarrage refusé par l'utilisateur."); }
    await this.tick(g.orchestration_id);
  }
  private pause(id: string, why: string) { const o = this.get(id); if (o?.status === "running") { this.setStatus(id, "paused", { error: why }); this.ev(id, "paused", why); } }

  /** Choisit le fournisseur : celui du plan s'il est disponible, sinon l'autre, avec trace. */
  private async pickProvider(o: any, t: any): Promise<ProviderId> {
    const proj = one<any>(this.db, "SELECT default_provider FROM projects WHERE id=?", o.project_id);
    const wanted = (t.provider ?? proj?.default_provider ?? "claude") as ProviderId; const other: ProviderId = wanted === "claude" ? "codex" : "claude";
    const ok = async (p: ProviderId) => { const s = await this.statusOf(p).catch(() => undefined); return !!s?.installed && !!s.authenticated && (s.authMode === "subscription" || !this.exclusive()); };
    if (await ok(wanted)) return wanted;
    if (await ok(other)) { this.ev(o.id, "provider_swapped", `${wanted} indisponible : « ${t.title} » exécutée par ${other}`, t.id); return other; }
    return wanted; // l'exécution échouera proprement avec un message explicite
  }
  private exclusive() { const r = one<{ value: string }>(this.db, "SELECT value FROM app_settings WHERE key='billing.exclusive'"); return r ? JSON.parse(r.value) !== false : true; }

  private ensureAgent(projectId: string, role: string, provider: ProviderId): string {
    const tpl = AGENT_TEMPLATES.find((x) => x.key === role) ?? AGENT_TEMPLATES.find((x) => x.key === "fullstack")!;
    const name = `${tpl.name} · ${provider === "claude" ? "Claude" : "Codex"}`;
    const ex = one<any>(this.db, "SELECT id FROM agent_profiles WHERE name=? AND provider=?", name, provider); if (ex) return ex.id;
    const id = uid(); run(this.db, "INSERT INTO agent_profiles (id,name,description,icon,color,provider,specialty,instructions,permission,approval_policy,priority,max_concurrency,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", id, name, "Créé par l'orchestrateur", tpl.icon, tpl.color, provider, tpl.specialty, tpl.instructions, tpl.permission, "never", 5, 2, now());
    this.bus.emit("agent.created", { name }, { agentId: id }); return id;
  }

  /** Nœud « test » : exécute réellement la commande dans le projet (sortie bornée, délai maximal), succès = code 0. */
  private async runTest(o: any, t: any) {
    const proj = one<any>(this.db, "SELECT path FROM projects WHERE id=?", o.project_id); const cmd = String(t.description ?? "").trim(); const started = Date.now();
    this.ev(o.id, "test_started", cmd, t.id);
    const { spawn } = await import("node:child_process"); const { terminalEnv } = await import("./terminal.js");
    const child = spawn(cmd, { cwd: proj.path, shell: true, env: terminalEnv(this.exclusive()), windowsHide: true }); let out = ""; const add = (d: Buffer) => { out += d.toString(); if (out.length > 20000) out = out.slice(-20000); };
    child.stdout.on("data", add); child.stderr.on("data", add);
    const timer = setTimeout(() => { out += "\n[délai maximal de 10 min dépassé : arrêt]"; child.kill(); }, 600_000);
    const code: number = await new Promise((res) => { child.on("error", (e) => { out += String(e.message); res(-1); }); child.on("close", (c) => res(c ?? -1)); }); clearTimeout(timer);
    const cur = this.get(o.id); const ms = Date.now() - started;
    run(this.db, "UPDATE tasks SET result=?, finished_at=?, status=? WHERE id=?", `$ ${cmd}
(code ${code}, ${Math.round(ms / 1000)} s)
${out}`.slice(0, 22000), now(), code === 0 ? "done" : "blocked", t.id);
    this.ev(o.id, code === 0 ? "test_passed" : "test_failed", `${cmd} → code ${code} (${Math.round(ms / 1000)} s)`, t.id);
    if (!cur || TERMINAL.includes(cur.status)) return;
    if (code === 0) await this.tick(o.id); else { this.pause(o.id, `Le test « ${t.title} » a échoué (code ${code}). Corrigez puis relancez l'étape.`); this.exec.notify("error", "Tests échoués", `${t.title} (code ${code})`, "orchestration"); }
  }

  /** Construit les handoffs des dépendances (traçables, tronqués) et lance la tâche avec son propre historique. */
  private async launch(o: any, t: any, deps: any[]) {
    const provider = await this.pickProvider(o, t); const agentId = this.ensureAgent(o.project_id, t.role ?? "fullstack", provider);
    const blocks: string[] = [];
    for (const d of deps) { const h = this.buildHandoff(o, d, t); if (!h) continue; const block = renderHandoff(h.payload); run(this.db, "INSERT INTO handoffs VALUES (?,?,?,?,?,?,?,?)", uid(), o.id, d.id, t.id, h.execId, JSON.stringify(h.payload), block.length, now()); blocks.push(block); this.ev(o.id, "handoff", `${d.title} → ${t.title}`, t.id); }
    const prompt = [`[Objectif global] ${o.goal}`, `[Ta tâche] ${t.title}${t.description ? `\n${t.description}` : ""}`, blocks.length ? `[Contexte transmis par les étapes précédentes]\n${blocks.join("\n\n")}` : "", `[Consignes] Réalise uniquement ta tâche. ${HANDOFF_INSTRUCTION}`].filter(Boolean).join("\n\n");
    const write = isWriteRole(t.role ?? "");
    const eid = this.exec.enqueue({ projectId: o.project_id, agentId, taskId: t.id, provider, prompt, priority: 5, useWorktree: !!o.use_worktrees && write });
    this.ev(o.id, "task_started", `${t.title} (${provider})`, t.id); void eid;
  }
  private buildHandoff(o: any, from: any, to: any): { payload: AgentHandoff; execId: string } | undefined {
    const ex = one<any>(this.db, "SELECT * FROM agent_executions WHERE task_id=? AND status='completed' ORDER BY created_at DESC LIMIT 1", from.id); if (!ex) return undefined;
    const p = parseHandoffBlock(ex.result_text ?? "");
    const files = [...new Set(all<any>(this.db, "SELECT content FROM exec_logs WHERE execution_id=? AND kind='file_change'", ex.id).flatMap((l) => JSON.parse(l.content) as string[]))];
    const wt = ex.worktree_id && ex.worktree_id !== "pending" ? one<any>(this.db, "SELECT * FROM git_worktrees WHERE id=?", ex.worktree_id) : undefined;
    const commits = wt ? git(wt.path, ["log", "--oneline", `${wt.base_branch}..HEAD`]).out.split("\n").filter(Boolean) : [];
    const errs = all<any>(this.db, "SELECT error FROM agent_executions WHERE task_id=? AND status IN ('failed','interrupted') AND error IS NOT NULL", from.id).map((r) => r.error as string);
    const agent = one<any>(this.db, "SELECT name FROM agent_profiles WHERE id=?", ex.agent_id);
    return { execId: ex.id, payload: { objective: `${to.title} — ${o.goal}`, from: { taskId: from.id, title: from.title, agent: agent?.name, provider: ex.provider }, to: { taskId: to.id, title: to.title }, summary: p.summary || "(aucune réponse textuelle)", decisions: p.decisions, filesModified: files, commits, testResults: p.testResults, errors: errs, openQuestions: p.openQuestions, nextSteps: p.nextSteps, usage: { tokens: from.tokens ?? 0, usd: from.usd ?? null }, worktree: wt ? { branch: wt.branch, path: wt.path } : undefined, structured: p.structured } };
  }

  private async onExecutionEnd(execId: string, status: string) {
    const o = one<any>(this.db, "SELECT * FROM orchestrations WHERE planner_execution_id=?", execId);
    if (o && o.status === "planning") return void (await this.onPlannerDone(o, status));
    const ex = one<any>(this.db, "SELECT task_id FROM agent_executions WHERE id=?", execId); if (!ex?.task_id) return;
    const t = one<any>(this.db, "SELECT * FROM tasks WHERE id=?", ex.task_id); if (!t?.orchestration_id) return;
    const orch = this.get(t.orchestration_id); if (!orch) return;
    if (TERMINAL.includes(orch.status)) { if (t.status !== 'done') run(this.db, "UPDATE tasks SET status='backlog' WHERE id=?", t.id); return; }
    if (status === "completed") { run(this.db, "UPDATE tasks SET status='done', finished_at=? WHERE id=?", now(), t.id); this.ev(orch.id, "task_done", t.title, t.id); await this.tick(orch.id); }
    else { run(this.db, "UPDATE tasks SET status='blocked' WHERE id=?", t.id); this.ev(orch.id, "task_failed", `${t.title} : ${status}`, t.id); this.pause(orch.id, `La tâche « ${t.title} » n'a pas abouti (${status}). Relancez-la ou annulez l'orchestration.`); this.exec.notify("error", "Orchestration en pause", `« ${t.title} » : ${status}`, "orchestration"); }
  }

  /** Relance une tâche bloquée (nouvelle tentative traçable) et reprend l'orchestration. */
  async retryTask(taskId: string) {
    const t = one<any>(this.db, "SELECT * FROM tasks WHERE id=?", taskId); if (!t?.orchestration_id) throw new Error("Tâche hors orchestration");
    const o = this.get(t.orchestration_id); if (!o || TERMINAL.includes(o.status)) throw new Error("Orchestration terminée.");
    run(this.db, "UPDATE tasks SET status='todo' WHERE id=?", taskId); run(this.db, "UPDATE orch_gates SET status='superseded' WHERE task_id=? AND status='declined'", taskId);
    this.ev(o.id, "retry", t.title, taskId); if (o.status === "paused") this.setStatus(o.id, "running", { error: null }); await this.tick(o.id);
  }
  /** Reprend une orchestration en pause (ex. après redémarrage) : relance les tâches interrompues. */
  async resume(id: string) {
    const o = this.get(id); if (!o || !["paused", "running"].includes(o.status)) throw new Error("Rien à reprendre.");
    run(this.db, "UPDATE tasks SET status='todo' WHERE orchestration_id=? AND status='blocked' AND node_kind='agent'", id); this.setStatus(id, "running", { error: null }); this.ev(id, "resumed"); await this.tick(id);
  }
  async cancel(id: string) {
    const o = this.get(id); if (!o || TERMINAL.includes(o.status)) return;
    this.setStatus(id, "cancelled"); this.ev(id, "cancelled");
    for (const t of this.tasks(id)) { const live = all<any>(this.db, "SELECT id FROM agent_executions WHERE task_id=? AND status IN ('queued','preparing','running','waiting_approval')", t.id); for (const e of live) await this.exec.cancel(e.id); if (t.status !== "done") run(this.db, "UPDATE tasks SET status='backlog' WHERE id=?", t.id); }
    run(this.db, "UPDATE orch_gates SET status='superseded' WHERE orchestration_id=? AND status='pending'", id);
    if (o.planner_execution_id) await this.exec.cancel(o.planner_execution_id);
  }
  /** Anciennes transmissions enregistrées avec une taille de 0 : recalculée depuis leur contenu (idempotent). */
  backfillHandoffSizes() { for (const h of all<any>(this.db, "SELECT id, payload FROM handoffs WHERE chars IS NULL OR chars=0")) { try { const n = renderHandoff(JSON.parse(h.payload)).length; if (n > 0) run(this.db, "UPDATE handoffs SET chars=? WHERE id=?", n, h.id); } catch { /* contenu illisible : laissé tel quel */ } } }
  /** Au démarrage : les orchestrations « running » dont les exécutions ont été interrompues passent en pause. */
  reconcile() { for (const o of all<any>(this.db, "SELECT id FROM orchestrations WHERE status IN ('running','planning')")) { const live = one(this.db, "SELECT 1 x FROM agent_executions e JOIN tasks t ON t.id=e.task_id WHERE t.orchestration_id=? AND e.status IN ('queued','preparing','running','waiting_approval')", o.id); if (!live) { run(this.db, "UPDATE tasks SET status='blocked' WHERE orchestration_id=? AND status='in_progress'", o.id); this.setStatus(o.id, "paused", { error: "Application redémarrée : reprenez l'orchestration pour relancer les étapes interrompues." }); } } }

  private finish(o: any, tasks: any[]) {
    const hs = this.handoffs(o.id); const tot = tasks.reduce((a, t) => ({ tok: a.tok + (t.tokens ?? 0), usd: a.usd + (t.usd ?? 0) }), { tok: 0, usd: 0 });
    const lines = [`# Rapport d'orchestration`, `**Objectif** : ${o.goal}`, "", `| Tâche | Agent | Statut | Durée | Tokens | Éq. API |`, `|---|---|---|---|---|---|`];
    for (const t of tasks) { const ex = t.execution_id ? one<any>(this.db, "SELECT provider,agent_id FROM agent_executions WHERE id=?", t.execution_id) : undefined; const ag = ex?.agent_id ? one<any>(this.db, "SELECT name FROM agent_profiles WHERE id=?", ex.agent_id)?.name : t.node_kind === "approval" ? "Validation humaine" : "—"; lines.push(`| ${t.title} | ${ag} | ${t.status} | ${t.duration_ms ? Math.round(t.duration_ms / 1000) + " s" : "—"} | ${t.tokens ?? 0} | ≈ $${(t.usd ?? 0).toFixed(4)} |`); }
    lines.push("", `**Total** : ${tot.tok} tokens · ≈ $${tot.usd.toFixed(4)} (équivalent API, non facturé en plus de l'abonnement) · ${hs.length} handoff(s)`, "");
    for (const t of tasks) { const ex = t.execution_id ? one<any>(this.db, "SELECT result_text FROM agent_executions WHERE id=?", t.execution_id) : undefined; if (ex?.result_text) lines.push(`## ${t.title}`, parseHandoffBlock(ex.result_text).summary.slice(0, 1500), ""); }
    this.setStatus(o.id, "completed", { report: lines.join("\n") }); this.ev(o.id, "completed", `${tot.tok} tokens`); this.exec.notify("info", "Orchestration terminée", o.goal.slice(0, 80), "orchestration");
  }
}
