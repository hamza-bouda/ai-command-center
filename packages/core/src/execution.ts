import { DB, all, one, run, uid, now, tx } from "./db.js";
import { EventBus } from "./events.js";
import { UsageNormalizer } from "./usage.js";
import type { AgentProviderAdapter, RunSink } from "./providers/common.js";
import type { ExecEvent, ExecStatus, ProviderId, RunHandle, ProviderStatus, RunRequest } from "./types.js";
import { createWorktree } from "./git.js";
import { getSetting } from "./settings.js";
import { join, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { snapshotDir, diffSnapshots } from "./fsnap.js";
import { ProjectMemory } from "./system.js";

export type ExecMode = "chat" | "work" | "code";
/** Outils de recherche web autorisés en Chat quand l'utilisateur l'a activé pour la conversation (et eux seuls). */
export const WEB_TOOLS = new Set(["WebSearch", "WebFetch", "webSearch"]);
export interface EnqueueInput { web?: boolean; image?: boolean; extensions?: { mcp: NonNullable<RunRequest["mcp"]>; skillsText: string }; images?: { name: string; mime: string; data: string }[]; permission?: "read-only" | "workspace-write"; projectId?: string | null; mode?: ExecMode; conversationId?: string | null; cwd?: string; effort?: string | null; systemPrompt?: string; agentId?: string | null; taskId?: string | null; provider?: ProviderId; model?: string | null; prompt: string; priority?: number; resumeSessionId?: string | null; parentExecutionId?: string | null; useWorktree?: boolean }
const ACTIVE: ExecStatus[] = ["preparing", "running", "waiting_approval"];
const TERMINAL: ExecStatus[] = ["completed", "failed", "cancelled", "interrupted"];

interface Live { handle?: RunHandle; cancelRequested: boolean; buf: string; flush?: NodeJS.Timeout; approvals: Map<string, (ok: boolean) => void>; gotError?: string }

export class ExecutionManager {
  private live = new Map<string, Live>(); private pendingImages = new Map<string, { name: string; mime: string; data: string }[]>(); private pendingWeb = new Set<string>(); private pendingImage = new Set<string>(); private imageBlocks = new Map<string, string[]>(); private pendingExt = new Map<string, { mcp: NonNullable<RunRequest["mcp"]>; skillsText: string }>();
  private normalizer: UsageNormalizer;
  private scheduling = false;
  constructor(private db: DB, private bus: EventBus, private adapters: Record<ProviderId, AgentProviderAdapter>, private statusOf: (p: ProviderId) => Promise<ProviderStatus>, private dataDir: string) { this.normalizer = new UsageNormalizer(db); }

  private transition(id: string, to: ExecStatus, detail?: string) {
    const cur = one<any>(this.db, "SELECT status,provider,project_id,agent_id,task_id FROM agent_executions WHERE id=?", id);
    if (!cur || cur.status === to) return;
    if (TERMINAL.includes(cur.status)) return; // un état terminal est définitif
    const t = now();
    tx(this.db, () => {
      run(this.db, "UPDATE agent_executions SET status=? WHERE id=?", to, id);
      if (to === "running") run(this.db, "UPDATE agent_executions SET started_at=COALESCE(started_at,?) WHERE id=?", t, id);
      if (TERMINAL.includes(to)) run(this.db, "UPDATE agent_executions SET finished_at=?, duration_ms=CASE WHEN started_at IS NULL THEN NULL ELSE CAST((julianday(?)-julianday(started_at))*86400000 AS INTEGER) END, pid=NULL WHERE id=?", t, t, id);
      run(this.db, "INSERT INTO exec_transitions VALUES (?,?,?,?,?,?)", uid(), id, cur.status, to, detail ?? null, t);
    });
    this.bus.emit(`execution.${to}`, { status: to, detail }, { executionId: id, provider: cur.provider, projectId: cur.project_id, agentId: cur.agent_id, taskId: cur.task_id });
  }
  private log(id: string, kind: string, content: string) { run(this.db, "INSERT INTO exec_logs (execution_id,kind,content,at) VALUES (?,?,?,?)", id, kind, content, now()); }

  enqueue(i: EnqueueInput): string {
    const agent = i.agentId ? one<any>(this.db, "SELECT * FROM agent_profiles WHERE id=?", i.agentId) : undefined;
    const proj = i.projectId ? one<any>(this.db, "SELECT * FROM projects WHERE id=?", i.projectId) : undefined; if (i.projectId && !proj) throw new Error("Projet introuvable");
    const mode: ExecMode = i.mode ?? "code"; const cwd0 = i.cwd ?? proj?.path; if (!cwd0) throw new Error("Dossier de travail requis (projet ou espace isolé).");
    const cwd = resolve(cwd0);
    if (mode === "code" && !proj) throw new Error("Le mode Code nécessite un projet.");
    const provider = (i.provider ?? agent?.provider ?? proj?.default_provider ?? "claude") as ProviderId;
    const model = i.model ?? agent?.model ?? proj?.default_model ?? null;
    const id = uid(); const attempt = i.taskId ? ((one<any>(this.db, "SELECT COUNT(*) c FROM agent_executions WHERE task_id=?", i.taskId)?.c ?? 0) + 1) : 1;
    tx(this.db, () => {
      run(this.db, "INSERT INTO agent_executions (id,task_id,agent_id,project_id,provider,model,prompt,cwd,status,attempt,priority,provider_session_id,parent_execution_id,created_at,mode,conversation_id,effort_requested,policy_note,permission) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        id, i.taskId ?? null, i.agentId ?? null, i.projectId ?? null, provider, model, i.prompt, cwd, "queued", attempt, i.priority ?? agent?.priority ?? 5, i.resumeSessionId ?? null, i.parentExecutionId ?? null, now(), mode, i.conversationId ?? null, i.effort ?? null, i.systemPrompt ?? null, i.permission ?? null);
      run(this.db, "INSERT INTO exec_transitions VALUES (?,?,?,?,?,?)", uid(), id, null, "queued", null, now());
      if (i.taskId) run(this.db, "UPDATE tasks SET status='in_progress' WHERE id=? AND status IN ('todo','backlog','blocked')", i.taskId);
    });
    if (i.web && i.mode === "chat") this.pendingWeb.add(id);
    if (i.image && i.mode === "chat") this.pendingImage.add(id);
    if (i.images?.length) this.pendingImages.set(id, i.images); if (i.extensions && (i.extensions.mcp.length || i.extensions.skillsText)) this.pendingExt.set(id, i.extensions);
    if (i.useWorktree) run(this.db, "UPDATE agent_executions SET worktree_id='pending' WHERE id=?", id);
    this.bus.emit("execution.queued", { provider, model }, { executionId: id, provider, projectId: i.projectId ?? undefined, agentId: i.agentId ?? undefined, taskId: i.taskId ?? undefined });
    void this.schedule();
    return id;
  }

  private depsSatisfied(taskId?: string | null) {
    if (!taskId) return true;
    return !one(this.db, "SELECT 1 x FROM task_dependencies d JOIN tasks t ON t.id=d.depends_on WHERE d.task_id=? AND t.status<>'done'", taskId);
  }
  /** Ordonnanceur : respecte concurrence globale / fournisseur / projet / agent et priorités. */
  async schedule() {
    if (this.scheduling) return; this.scheduling = true;
    try {
      const gMax = Number(getSetting(this.db, "concurrency.global", 4));
      const pMax = Number(getSetting(this.db, "concurrency.provider", 3));
      const queued = all<any>(this.db, "SELECT * FROM agent_executions WHERE status='queued' ORDER BY priority DESC, created_at ASC");
      for (const q of queued) {
        const act = all<any>(this.db, `SELECT provider,project_id,agent_id FROM agent_executions WHERE status IN ('preparing','running','waiting_approval')`);
        if (act.length >= gMax) break;
        if (act.filter((a) => a.provider === q.provider).length >= pMax) continue;
        const proj = one<any>(this.db, "SELECT max_concurrency FROM projects WHERE id=?", q.project_id);
        if (act.filter((a) => a.project_id === q.project_id).length >= (proj?.max_concurrency ?? 3)) continue;
        if (q.agent_id) { const ag = one<any>(this.db, "SELECT max_concurrency FROM agent_profiles WHERE id=?", q.agent_id); if (act.filter((a) => a.agent_id === q.agent_id).length >= (ag?.max_concurrency ?? 1)) continue; }
        if (!this.depsSatisfied(q.task_id)) continue;
        this.transition(q.id, "preparing"); // réserve le slot avant tout await
        void this.start(q.id);
      }
    } finally { this.scheduling = false; }
  }

  private async start(id: string) {
    const ex = one<any>(this.db, "SELECT * FROM agent_executions WHERE id=?", id)!;
    const proj = ex.project_id ? one<any>(this.db, "SELECT * FROM projects WHERE id=?", ex.project_id) : undefined;
    const agent = ex.agent_id ? one<any>(this.db, "SELECT * FROM agent_profiles WHERE id=?", ex.agent_id) : undefined;
    const live: Live = { cancelRequested: false, buf: "", approvals: new Map() }; this.live.set(id, live);
    const fail = (m: string) => { this.log(id, "error", m); run(this.db, "UPDATE agent_executions SET error=? WHERE id=?", m, id); this.transition(id, "failed", m); this.finalizeTask(id, false); this.notify("error", "Exécution échouée", m, "task"); this.live.delete(id); void this.schedule(); };
    try {
      const exclusive = !!getSetting(this.db, "billing.exclusive", true);
      const st = await this.statusOf(ex.provider);
      if (!st.installed) return fail(`${ex.provider} n'est pas installé`);
      if (!st.authenticated) { this.bus.emit("provider.auth_required", {}, { provider: ex.provider }); return fail(`${ex.provider} : authentification requise`); }
      if (exclusive && st.authMode !== "subscription") return fail(`Mode abonnement exclusif : exécution bloquée (mode d'authentification « ${st.authMode} » non vérifié comme abonnement). ${st.blockedReason ?? ""}`);
      if (live.cancelRequested) return;
      let cwd = ex.cwd as string;
      if (ex.worktree_id === "pending" && proj) {
        const wt = createWorktree(this.db, { projectId: proj.id, projectPath: proj.path, executionId: id, baseDir: join(this.dataDir, "worktrees") });
        cwd = wt.path; run(this.db, "UPDATE agent_executions SET worktree_id=?, cwd=? WHERE id=?", wt.id, cwd, id);
        this.bus.emit("git.worktree_created", { branch: wt.branch, path: wt.path }, { executionId: id, projectId: proj.id });
      }
      const mode = (ex.mode ?? "code") as ExecMode;
      const mem = proj && mode === "code" ? new ProjectMemory(this.db).context(proj.id) : { text: "" };
      const instr = [proj?.instructions, agent?.instructions, ex.policy_note, mem.text, this.pendingExt.get(id)?.skillsText].filter(Boolean).join("\n\n") || undefined;
      const permission = ex.permission === "read-only" ? "read-only" : mode === "chat" ? "read-only" : mode === "work" ? "workspace-write" : (agent?.permission ?? proj?.permission ?? "workspace-write") === "read-only" ? "read-only" : "workspace-write";
      const sink: RunSink = {
        event: (e) => this.onEvent(id, ex, e), setPid: (pid) => run(this.db, "UPDATE agent_executions SET pid=? WHERE id=?", pid ?? null, id),
        requestApproval: (kind, summary) => this.requestApproval(id, kind, summary),
      };
      this.transition(id, "running");
      const adapter = this.adapters[ex.provider as ProviderId];
      const req = { executionId: id, prompt: ex.prompt, cwd, model: ex.model || undefined, permission: permission as any, instructions: instr, resumeSessionId: ex.provider_session_id || undefined, approvalPolicy: (agent?.approval_policy === "on-request" ? "on-request" : "never") as any, policy: mode, effort: ex.effort_requested || undefined, images: this.pendingImages.get(id), mcp: this.pendingExt.get(id)?.mcp, web: this.pendingWeb.has(id), image: this.pendingImage.has(id) };
      const before = snapshotDir(cwd); // détection des fichiers modifiés indépendante du fournisseur
      live.handle = adapter.startSession(req, sink, { exclusive });
      await live.handle.done;
      this.detectChanges(id, ex, cwd, before.map);
    } catch (e: any) { return fail(e.message ?? String(e)); }
    // fin du processus : si aucun "done" n'a fixé l'état, c'est un échec (jamais un succès implicite)
    this.flush(id);
    const cur = one<any>(this.db, "SELECT status FROM agent_executions WHERE id=?", id);
    if (cur && !TERMINAL.includes(cur.status)) { this.transition(id, live.cancelRequested ? "cancelled" : "failed", "Processus terminé sans résultat"); this.finalizeTask(id, false); }
    this.live.delete(id); void this.schedule();
  }

  /** Compare le dossier avant/après : signale les fichiers modifiés même si le fournisseur ne les a pas déclarés (écriture via shell). */
  private detectChanges(id: string, ex: any, cwd: string, before: Map<string, string>) {
    try {
      const changed = diffSnapshots(before, snapshotDir(cwd).map); if (!changed.length) return;
      const reported = new Set(all<any>(this.db, "SELECT content FROM exec_logs WHERE execution_id=? AND kind='file_change'", id).flatMap((l) => JSON.parse(l.content) as string[]).map((p) => p.split(String.fromCharCode(92)).join("/")));
      const missing = changed.filter((p) => ![...reported].some((r) => r === p || r.endsWith("/" + p)));
      if (missing.length) { this.log(id, "file_change", JSON.stringify(missing)); this.log(id, "status", `${missing.length} fichier(s) modifié(s) détecté(s) par comparaison du dossier (non signalés par le fournisseur)`); this.bus.emit("execution.file_change", { paths: missing, detected: true }, { executionId: id, projectId: ex.project_id ?? undefined }); }
      if (ex.mode === "chat") { run(this.db, "INSERT INTO audit_events (id,type,provider,execution_id,payload,at) VALUES (?,?,?,?,?,?)", uid(), "policy.violation", ex.provider, id, JSON.stringify({ mode: "chat", filesChanged: changed.slice(0, 20) }), now()); this.notify("warn", "Chat : écriture détectée", `Des fichiers ont changé dans le dossier isolé : ${changed.slice(0, 3).join(", ")}`, "policy"); }
    } catch { /* la détection est un bonus, jamais bloquante */ }
  }
  /** Enregistre l'image générée dans le dossier de l'application (jamais ailleurs) et la référence dans la réponse par un bloc « image ». */
  private saveImage(id: string, ex: any, e: Extract<ExecEvent, { type: "image" }>) {
    try {
      const buf = Buffer.from(e.data, "base64"); if (buf.length < 8 || buf.length > 30 * 1024 * 1024 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error("image illisible");
      const scope = String(ex.conversation_id ?? id).replace(/[^A-Za-z0-9_-]/g, ""); const name = String(e.id).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60) + ".png";
      const dir = join(this.dataDir, "images", scope); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, name), buf);
      const block = `

\`\`\`image
${JSON.stringify({ file: `${scope}/${name}`, prompt: (e.prompt ?? "").slice(0, 400) })}
\`\`\`
`;
      this.imageBlocks.set(id, [...(this.imageBlocks.get(id) ?? []), block]); this.log(id, "status", `image générée (${Math.round(buf.length / 1024)} Ko)`);
    } catch (err: any) { this.log(id, "error", `Image non enregistrée : ${err.message}`); }
  }
  private flush(id: string) { const l = this.live.get(id); if (!l) return; if (l.flush) { clearTimeout(l.flush); l.flush = undefined; } if (l.buf) { this.log(id, "text", l.buf); l.buf = ""; } }
  private onEvent(id: string, ex: any, e: ExecEvent) {
    const l = this.live.get(id); const ctx = { executionId: id, provider: ex.provider, projectId: ex.project_id, agentId: ex.agent_id ?? undefined, taskId: ex.task_id ?? undefined };
    switch (e.type) {
      case "text":
        if (e.final) { run(this.db, "UPDATE agent_executions SET result_text=? WHERE id=?", e.text + (this.imageBlocks.get(id) ?? []).join(""), id); break; }
        if (l) { l.buf += e.text; if (!l.flush) l.flush = setTimeout(() => this.flush(id), 300); }
        this.bus.emit("execution.text", { text: e.text }, ctx); break;
      case "tool":
        if (ex.mode === "chat" && e.state === "started" && !(this.pendingWeb.has(id) && WEB_TOOLS.has(e.name)) && !(this.pendingImage.has(id) && (e.name === "image_generation" || e.name === "imagegen_skill_read")) && !(e.name.startsWith("mcp__") && (this.pendingExt.get(id)?.mcp ?? []).some((m) => e.name.startsWith(`mcp__${m.name}__`)))) { // ChatPolicy : aucun outil autorisé → interruption immédiate et trace d'audit
          const msg = `Politique Chat : l'outil « ${e.name || "inconnu"} » est interdit en mode Chat. Exécution interrompue.`; this.log(id, "error", msg); if (l) l.gotError = msg;
          run(this.db, "INSERT INTO audit_events (id,type,provider,execution_id,payload,at) VALUES (?,?,?,?,?,?)", uid(), "policy.violation", ex.provider, id, JSON.stringify({ mode: "chat", tool: e.name, summary: e.summary }), now());
          this.notify("warn", "Chat : outil bloqué", msg, "policy"); void this.cancel(id); break;
        }
        this.flush(id); this.log(id, "tool", JSON.stringify(e)); this.bus.emit("execution.tool", e as any, ctx); break;
      case "image": this.saveImage(id, ex, e); break;
      case "file_change": this.log(id, "file_change", JSON.stringify(e.paths)); this.bus.emit("execution.file_change", { paths: e.paths }, ctx); break;
      case "applied": run(this.db, "UPDATE agent_executions SET model=COALESCE(?,model), effort_applied=? WHERE id=?", e.model ?? null, e.effort ?? null, id); this.log(id, "status", `appliqué : modèle ${e.model ?? "?"}, effort ${e.effort ?? "géré par le fournisseur"} (${e.effortSource})`); break;
      case "status": this.log(id, "status", e.detail ?? ""); break;
      case "session": run(this.db, "UPDATE agent_executions SET provider_session_id=? WHERE id=?", e.providerSessionId, id); break;
      case "usage": {
        if (e.report.model && e.report.model !== "unknown") run(this.db, "UPDATE agent_executions SET model=COALESCE(model,?) WHERE id=?", e.report.model, id);
        const r = this.normalizer.record({ executionId: id, provider: ex.provider, taskId: ex.task_id, agentId: ex.agent_id, projectId: ex.project_id }, e.report);
        if (!r.duplicate) { this.bus.emit("usage.received", { total: r.delta.total, usd: r.usd, model: e.report.model, confidence: r.confidence, note: r.note }, ctx); this.checkBudget(id, ex); }
        break;
      }
      case "quota": {
        run(this.db, "INSERT INTO quota_snapshots VALUES (?,?,?,?,?,?)", uid(), e.quota.provider, e.quota.state, JSON.stringify(e.quota.windows), e.quota.note ?? null, now());
        this.bus.emit("quota.changed", { quota: e.quota as any }, ctx);
        if (e.quota.state === "exhausted") this.notify("error", "Quota atteint", `${e.quota.provider} : limite d'abonnement atteinte`, "quota");
        else if (e.quota.windows.some((w) => (w.usedPercent ?? 0) >= 90)) this.notify("warn", "Limite proche", `${e.quota.provider} : plus de 90 % d'une fenêtre consommée`, "quota");
        break;
      }
      case "error": this.log(id, "error", e.message); if (l) l.gotError = e.message; if (e.quota) this.notify("error", "Quota/limite", e.message, "quota"); if (e.auth) this.notify("error", "Authentification", e.message, "auth"); break;
      case "done": {
        this.flush(id);
        const cancelled = l?.cancelRequested;
        if (e.ok) { this.transition(id, "completed"); this.finalizeTask(id, true); this.notify("info", "Tâche terminée", ex.prompt.slice(0, 80), "task"); }
        else if (cancelled) { this.transition(id, "cancelled", e.message); this.finalizeTask(id, false, true); }
        else { run(this.db, "UPDATE agent_executions SET error=? WHERE id=?", e.message ?? l?.gotError ?? "échec", id); this.transition(id, "failed", e.message); this.finalizeTask(id, false); this.notify("error", "Exécution échouée", e.message ?? "", "task"); }
        break;
      }
    }
  }
  private checkBudget(id: string, ex: any) {
    
    const block = !!getSetting(this.db, "budget.block", false); const over = (title: string, body: string) => { this.notify("warn", title, body + " Les mesures arrivent après consommation : l'arrêt n'est pas garanti au dernier token.", "budget"); if (block) void this.cancel(id); };
    const maxT = Number(getSetting(this.db, "budget.maxTokensPerTask", 0)); if (maxT && ex.task_id) { const used = one<any>(this.db, "SELECT COALESCE(SUM(total),0) t FROM usage_events WHERE task_id=?", ex.task_id)?.t ?? 0; if (used >= maxT) over("Budget tokens dépassé", `La tâche a consommé ${used} tokens (seuil ${maxT}).`); }
    const maxU = Number(getSetting(this.db, "budget.maxUsdPerTask", 0)); if (maxU && ex.task_id) { const usd = one<any>(this.db, "SELECT COALESCE(SUM(c.calculated_usd),0) v FROM usage_events u JOIN cost_estimates c ON c.usage_event_id=u.id WHERE u.task_id=?", ex.task_id)?.v ?? 0; if (usd >= maxU) over("Budget USD éq. dépassé", `La tâche atteint ≈ $${usd.toFixed(2)} (seuil $${maxU}).`); }
    const maxP = Number(getSetting(this.db, "budget.maxTokensPerProject", 0)); if (maxP && ex.project_id) { const used = one<any>(this.db, "SELECT COALESCE(SUM(total),0) t FROM usage_events WHERE project_id=?", ex.project_id)?.t ?? 0; if (used >= maxP) over("Budget projet dépassé", `Le projet a consommé ${used} tokens (seuil ${maxP}).`); }
  }
  private finalizeTask(execId: string, ok: boolean, cancelled = false) {
    const ex = one<any>(this.db, "SELECT task_id,result_text FROM agent_executions WHERE id=?", execId); if (!ex?.task_id) return;
    const status = ok ? "review" : cancelled ? "todo" : "blocked";
    run(this.db, "UPDATE tasks SET status=?, result=COALESCE(?,result), finished_at=? WHERE id=?", status, ok ? ex.result_text : null, ok ? now() : null, ex.task_id);
  }
  notify(level: string, title: string, body: string, category: string) {
    run(this.db, "INSERT INTO notifications (id,level,title,body,category,created_at) VALUES (?,?,?,?,?,?)", uid(), level, title, body, category, now());
    this.bus.emit("notification", { level, title, body, category });
  }

  private requestApproval(execId: string, kind: string, summary: string): Promise<boolean> {
    const aid = uid(); run(this.db, "INSERT INTO approvals VALUES (?,?,?,?,?,?,?)", aid, execId, kind, summary, "pending", now(), null);
    this.transition(execId, "waiting_approval", summary);
    this.bus.emit("approval.requested", { approvalId: aid, kind, summary }, { executionId: execId });
    this.notify("warn", "Approbation requise", summary, "approval");
    return new Promise((res) => this.live.get(execId)?.approvals.set(aid, res));
  }
  resolveApproval(aid: string, ok: boolean) {
    const a = one<any>(this.db, "SELECT * FROM approvals WHERE id=?", aid); if (!a || a.status !== "pending") return;
    run(this.db, "UPDATE approvals SET status=?, resolved_at=? WHERE id=?", ok ? "approved" : "declined", now(), aid);
    const l = this.live.get(a.execution_id); l?.approvals.get(aid)?.(ok); l?.approvals.delete(aid);
    // revient en "running" (transition manuelle, waiting_approval n'est pas terminal)
    run(this.db, "UPDATE agent_executions SET status='running' WHERE id=? AND status='waiting_approval'", a.execution_id);
    run(this.db, "INSERT INTO exec_transitions VALUES (?,?,?,?,?,?)", uid(), a.execution_id, "waiting_approval", "running", ok ? "approuvé" : "refusé", now());
    this.bus.emit("approval.resolved", { approvalId: aid, approved: ok }, { executionId: a.execution_id });
  }

  async cancel(id: string) {
    const ex = one<any>(this.db, "SELECT status FROM agent_executions WHERE id=?", id); if (!ex) return;
    if (ex.status === "queued") return this.transition(id, "cancelled", "Annulé avant lancement");
    const l = this.live.get(id); if (!l) return;
    l.cancelRequested = true;
    for (const r of l.approvals.values()) r(false);
    await l.handle?.cancel();
    setTimeout(() => { const c = one<any>(this.db, "SELECT status FROM agent_executions WHERE id=?", id); if (c && !TERMINAL.includes(c.status)) { this.transition(id, "cancelled", "Annulé par l'utilisateur"); } }, 4000);
  }
  retry(id: string) { const ex = one<any>(this.db, "SELECT * FROM agent_executions WHERE id=?", id); if (!ex) throw new Error("introuvable"); return this.enqueue({ projectId: ex.project_id, agentId: ex.agent_id, taskId: ex.task_id, provider: ex.provider, model: ex.model, prompt: ex.prompt, priority: ex.priority, parentExecutionId: null }); }

  /** Au démarrage : réconcilie les exécutions laissées actives par un crash. Jamais marquées "completed". */
  reconcile() {
    const stale = all<any>(this.db, "SELECT id,pid FROM agent_executions WHERE status IN ('preparing','running','waiting_approval')");
    for (const s of stale) {
      let alive = false; if (s.pid) { try { process.kill(s.pid, 0); alive = true; } catch { alive = false; } }
      this.transition(s.id, "interrupted", alive ? `Application redémarrée ; processus ${s.pid} peut-être encore actif (non repris)` : "Application redémarrée ; processus disparu");
      this.finalizeTask(s.id, false);
    }
    return stale.length;
  }
  isLive(id: string) { return this.live.has(id); }
  async shutdown() { for (const [id] of this.live) await this.cancel(id); }
}
