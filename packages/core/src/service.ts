import { join } from "node:path";
import { DB, MIGRATION_COUNT, openDb, all, one, run, uid, now, tx } from "./db.js";
import { EventBus } from "./events.js";
import { seedPricing, listPricing, calculateCost, DISCLAIMER } from "./pricing.js";
import { ExecutionManager, EnqueueInput } from "./execution.js";
import { ClaudeAdapter } from "./providers/claude.js";
import { CodexAdapter } from "./providers/codex.js";
import type { AgentProviderAdapter } from "./providers/common.js";
import { checkEnv } from "./providers/common.js";
import { getSetting, setSetting } from "./settings.js";
import { AGENT_TEMPLATES } from "./templates.js";
import * as A from "./analytics.js";
import { AICatalog } from "./catalog.js";
import { Conversations } from "./conversations.js";
import { Works } from "./works.js";
import { describePolicy, policyFor, EXPERIENCE_MODES, type ExperienceMode } from "./policies.js";
import { Quality, CHECK_KINDS, type CheckKind } from "./quality.js";
import { Automations } from "./automations.js";
import { Extensions } from "./extensions.js"; import { Profile } from "./profile.js"; import { UserMemory } from "./usermemory.js"; import { Knowledge } from "./knowledge.js"; import { Library } from "./library.js"; import { DocConverter } from "./convert.js";
import { Workflows } from "./workflows.js";
import { Comparisons } from "./comparison.js";
import { ProjectMemory, listMcpCached, listSkills, backupTo, autoBackup, inspectBackup as inspectBackupRaw, stageRestore, applyPendingRestore } from "./system.js";
import { routerAdvice } from "./router.js";
import { Orchestrator } from "./orchestrator.js";
import { TerminalManager } from "./terminal.js";
import { git, isGitRepo, currentBranch, createWorktree, worktreeChanges, worktreeDiff, mergeWorktree, listWorktrees } from "./git.js";
import type { ProviderId, ProviderStatus, QuotaStatus } from "./types.js";

export function createCore(opts: { dataDir: string; dbFile?: string; adapters?: Partial<Record<ProviderId, AgentProviderAdapter>>; scheduler?: boolean; onTerminalEvent?: (e: { id: string; data?: string; end?: number; exit?: { code: number | null } }) => void }) {
  const dbFile = opts.dbFile ?? join(opts.dataDir, "acc.sqlite"); const restored = dbFile !== ":memory:" ? applyPendingRestore(opts.dataDir, dbFile) : false;
  const db: DB = openDb(dbFile);
  seedPricing(db);
  const bus = new EventBus();
  const claude = new ClaudeAdapter(getSetting<string | undefined>(db, "provider.claude.path", undefined));
  const codex = new CodexAdapter(getSetting<string | undefined>(db, "provider.codex.path", undefined));
  const adapters = { claude, codex, ...opts.adapters } as Record<ProviderId, AgentProviderAdapter>;
  const statusCache = new Map<ProviderId, { at: number; s: ProviderStatus }>();
  const providerStatus = async (p: ProviderId, force = false): Promise<ProviderStatus> => {
    const c = statusCache.get(p); if (!force && c && Date.now() - c.at < 60_000) return c.s;
    const s = await adapters[p].getAuthStatus(); statusCache.set(p, { at: Date.now(), s });
    run(db, "INSERT INTO provider_auth_states VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET installed=excluded.installed,path=excluded.path,version=excluded.version,authenticated=excluded.authenticated,auth_mode=excluded.auth_mode,account=excluded.account,plan=excluded.plan,warnings=excluded.warnings,blocked_reason=excluded.blocked_reason,checked_at=excluded.checked_at",
      p, s.installed ? 1 : 0, s.path ?? null, s.version ?? null, s.authenticated ? 1 : 0, s.authMode, s.account ?? null, s.plan ?? null, JSON.stringify(s.warnings), s.blockedReason ?? null, s.checkedAt);
    bus.emit("provider.status", { status: s as any }, { provider: p });
    return s;
  };
  const exec = new ExecutionManager(db, bus, adapters, (p) => providerStatus(p), opts.dataDir);
  const recovered = exec.reconcile();
  const orchestrator = new Orchestrator(db, bus, exec, (p) => providerStatus(p)); orchestrator.reconcile(); orchestrator.backfillHandoffSizes();
  const catalog = new AICatalog(db, adapters, (p) => providerStatus(p));
  let worksRef: Works | undefined;
  const extensions = new Extensions(db); const profile = new Profile(db, (k, v) => setSetting(db, k, v)); const knowledge = new Knowledge(db); const userMemory = new UserMemory(db, (k, v) => setSetting(db, k, v)); const library = new Library(db); const converter = new DocConverter(opts.dataDir, bus);
  const conversations = new Conversations(db, bus, exec, catalog, opts.dataDir, (id) => (id ? worksRef?.dirOf(id) : undefined), extensions, profile, userMemory, knowledge);
  const works = (worksRef = new Works(db, conversations, opts.dataDir));
  bus.on((e) => { if (e.type === "conversation.message") { const w = one<any>(db, "SELECT id FROM works WHERE conversation_id=?", String(e.payload.id)); if (w) works.syncDeliverables(w.id); } });
  const workflows = new Workflows(db, orchestrator); const comparisons = new Comparisons(db, bus, exec, catalog, join(opts.dataDir, "chat-sandbox")); const memory = new ProjectMemory(db);
  const quality = new Quality(db, bus, exec, join(opts.dataDir, "chat-sandbox"));
  const automations = new Automations(db, bus, {
    runWorkflow: (c) => workflows.run({ workflowId: c.workflowId, projectId: c.projectId, goal: String(c.goal ?? ""), useWorktrees: !!c.useWorktrees }),
    runChecks: async (c) => { const r = await quality.runAll(c.projectId, (c.kinds?.length ? c.kinds : CHECK_KINDS) as CheckKind[], "automation"); return r.map((x: any) => `${x.kind}: ${x.status}`).join(", ") || "aucune commande configurée"; },
    reviewChanges: async (c) => quality.review(c.projectId, c.provider === "codex" ? "codex" : "claude"),
    notify: (t, b) => exec.notify("info", t, b, "automation"),
    createTask: async (c) => { const id = uid(); run(db, "INSERT INTO tasks (id,project_id,title,description,priority,status,created_at) VALUES (?,?,?,?,?,?,?)", id, c.projectId, String(c.title), c.description ?? null, 5, "todo", now()); bus.emit("task.created", { title: c.title }, { taskId: id, projectId: c.projectId }); return id; },
    usageReport: async () => { const since = new Date(Date.now() - 864e5).toISOString(); const by = A.usageBy(db, "mode", { since }); const tot = A.usageTotals(db, { since }); const txt = `24 h : ${tot.total} tokens, ≈ $${(tot.usd ?? 0).toFixed(2)} (éq. API) — ${by.map((r: any) => `${r.key}: ${r.total}`).join(", ") || "aucune activité"}`; exec.notify("info", "Rapport de consommation (24 h)", txt, "automation"); return txt; },
    gitHead: (pid) => { const p = one<any>(db, "SELECT path FROM projects WHERE id=?", pid); return p && isGitRepo(p.path) ? git(p.path, ["rev-parse", "HEAD"]).out || undefined : undefined; },
    providerState: async (p) => (await quotaOf(p as ProviderId)).state,
  });
  if (opts.scheduler ?? dbFile !== ":memory:") automations.start();
  const terminals = new TerminalManager(db, (p) => providerStatus(p), (e) => opts.onTerminalEvent?.(e));

  const insertProject = (p: { name: string; path: string; description?: string; defaultProvider?: string; defaultModel?: string; instructions?: string; permission?: string; maxConcurrency?: number }) => {
    const id = uid(); const git = isGitRepo(p.path);
    run(db, "INSERT INTO projects (id,name,description,path,git_repo,main_branch,default_provider,default_model,instructions,permission,max_concurrency,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", id, p.name, p.description ?? null, p.path, git ? 1 : 0, git ? currentBranch(p.path) : null, p.defaultProvider ?? "claude", p.defaultModel ?? null, p.instructions ?? null, p.permission ?? "workspace-write", p.maxConcurrency ?? 3, now());
    bus.emit("project.created", { name: p.name }, { projectId: id }); return id;
  };
  const quotaCache = new Map<string, { at: number; q: QuotaStatus }>();
  const quotaOf = async (p: ProviderId): Promise<QuotaStatus> => {
    const hit = quotaCache.get(p); if (hit && Date.now() - hit.at < 45_000) return hit.q;
    const q = await (async (): Promise<QuotaStatus> => {
        if (p === "codex") {
          let q = await adapters.codex.getQuotaStatus();
          if (q.state === "unknown") { await new Promise((r) => setTimeout(r, 1500)); q = await adapters.codex.getQuotaStatus(); } // course transitoire (verrou ~/.codex)
          if (q.state !== "unknown") { run(db, "INSERT INTO quota_snapshots VALUES (?,?,?,?,?,?)", uid(), p, q.state, JSON.stringify(q.windows), q.note ?? null, now()); return q; }
          const last = one<any>(db, "SELECT * FROM quota_snapshots WHERE provider='codex' ORDER BY created_at DESC LIMIT 1");
          return last ? { provider: "codex", state: last.state, windows: JSON.parse(last.windows), note: `Mesure en direct indisponible ; dernière mesure du ${last.created_at}.`, checkedAt: last.created_at } : q;
        }
        const last = one<any>(db, "SELECT * FROM quota_snapshots WHERE provider='claude' ORDER BY created_at DESC LIMIT 1");
        if (last) return { provider: "claude", state: last.state, windows: JSON.parse(last.windows), note: `Dernière mesure reçue pendant une exécution (${last.created_at}).`, checkedAt: last.created_at };
        return adapters.claude.getQuotaStatus();
    })();
    quotaCache.set(p, { at: Date.now(), q }); return q;
  };
  return {
    db, bus, exec, recovered, terminals, orchestrator, conversations, works, workflows, comparisons, memory, restored, quality, automations, extensions, converter, profile, userMemory, knowledge, library,
    system: { mcp: (force?: boolean) => listMcpCached(!!force), skills: () => listSkills(), backup: (file: string) => backupTo(db, file), autoBackup: () => dbFile === ":memory:" ? null : autoBackup(db, opts.dataDir), backupsDir: join(opts.dataDir, "backups"), inspectBackup: (file: string) => inspectBackupRaw(file, MIGRATION_COUNT()), stageRestore: (file: string) => stageRestore(opts.dataDir, file) },
    router: { advice: (preferred?: ProviderId) => routerAdvice(db, (p) => providerStatus(p), (p) => quotaOf(p), preferred) },
    ai: { catalog: (p: ProviderId, force = false) => catalog.get(p, force), validate: (p: ProviderId, m?: string | null, e?: string | null) => catalog.validate(p, m, e), policy: (m: ExperienceMode, p: ProviderId) => ({ ...policyFor(m), description: describePolicy(m, p) }),
      defaults: () => Object.fromEntries(EXPERIENCE_MODES.map((m) => [m, getSetting<any>(db, "defaults." + m, null)])), setDefault: (m: ExperienceMode, v: unknown) => setSetting(db, "defaults." + m, v) }, disclaimer: DISCLAIMER,
    // --- fournisseurs
    providerStatus, async allProviders(force = false) { return { claude: await providerStatus("claude", force), codex: await providerStatus("codex", force) }; },
    billing: { exclusive: () => !!getSetting(db, "billing.exclusive", true), setExclusive: (v: boolean) => { setSetting(db, "billing.exclusive", v); run(db, "INSERT INTO audit_events VALUES (?,?,?,?,?,?,?,?,?)", uid(), "billing.exclusive_changed", null, null, null, null, null, JSON.stringify({ value: v }), now()); }, env: () => ({ claude: checkEnv("claude").flagged, codex: checkEnv("codex").flagged }) },
    models: (p: ProviderId) => adapters[p].getSupportedModels(), capabilities: (p: ProviderId) => adapters[p].getCapabilities(),
    quota: (p: ProviderId) => quotaOf(p),
    // --- projets
    projects: { list: () => all(db, "SELECT * FROM projects WHERE archived=0 ORDER BY created_at DESC"), get: (id: string) => one(db, "SELECT * FROM projects WHERE id=?", id), create: insertProject,
      update: (id: string, p: Record<string, any>) => { const m: Record<string, string> = { name: "name", description: "description", defaultProvider: "default_provider", defaultModel: "default_model", instructions: "instructions", permission: "permission", maxConcurrency: "max_concurrency" }; for (const [k, v] of Object.entries(p)) if (m[k]) run(db, `UPDATE projects SET ${m[k]}=? WHERE id=?`, v, id); },
      archive: (id: string) => run(db, "UPDATE projects SET archived=1 WHERE id=?", id) },
    // --- agents
    templates: AGENT_TEMPLATES,
    agents: { list: () => all(db, "SELECT * FROM agent_profiles ORDER BY created_at DESC"),
      create: (a: { name: string; provider: ProviderId; model?: string; specialty?: string; instructions?: string; permission?: string; approvalPolicy?: string; icon?: string; color?: string; description?: string; projectId?: string; priority?: number; maxConcurrency?: number }) => {
        const id = uid(); run(db, "INSERT INTO agent_profiles (id,name,description,icon,color,provider,model,specialty,instructions,permission,approval_policy,priority,max_concurrency,project_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", id, a.name, a.description ?? null, a.icon ?? "Bot", a.color ?? "#6366f1", a.provider, a.model || null, a.specialty ?? null, a.instructions ?? null, a.permission ?? "workspace-write", a.approvalPolicy ?? "never", a.priority ?? 5, a.maxConcurrency ?? 1, a.projectId ?? null, now()); bus.emit("agent.created", { name: a.name }, { agentId: id }); return id; },
      update: (id: string, a: Record<string, any>) => { const m: Record<string, string> = { name: "name", description: "description", instructions: "instructions", model: "model", permission: "permission", approvalPolicy: "approval_policy", specialty: "specialty", color: "color", icon: "icon", priority: "priority", maxConcurrency: "max_concurrency", projectId: "project_id" }; for (const [k, v] of Object.entries(a)) if (m[k]) run(db, `UPDATE agent_profiles SET ${m[k]}=? WHERE id=?`, v === "" ? null : v, id); },
      duplicate: (id: string) => { const a = one<any>(db, "SELECT * FROM agent_profiles WHERE id=?", id); if (!a) throw new Error("introuvable"); const n = uid(); run(db, "INSERT INTO agent_profiles (id,name,description,icon,color,provider,model,specialty,instructions,permission,approval_policy,priority,max_concurrency,project_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", n, a.name + " (copie)", a.description, a.icon, a.color, a.provider, a.model, a.specialty, a.instructions, a.permission, a.approval_policy, a.priority, a.max_concurrency, a.project_id, now()); return n; },
      remove: (id: string) => { if (one(db, "SELECT 1 x FROM agent_executions WHERE agent_id=?", id)) throw new Error("Agent référencé par des exécutions : suppression refusée (historique conservé)."); run(db, "DELETE FROM agent_profiles WHERE id=?", id); } },
    // --- tâches
    tasks: { list: (projectId?: string) => all(db, `SELECT t.*, (SELECT COALESCE(SUM(total),0) FROM usage_events WHERE task_id=t.id) tokens, (SELECT COALESCE(SUM(c.calculated_usd),0) FROM usage_events u JOIN cost_estimates c ON c.usage_event_id=u.id WHERE u.task_id=t.id) usd, (SELECT COUNT(*) FROM agent_executions WHERE task_id=t.id) attempts FROM tasks t WHERE archived=0 ${projectId ? "AND project_id=?" : ""} ORDER BY created_at DESC`, ...(projectId ? [projectId] : [])),
      create: (t: { projectId: string; title: string; description?: string; agentId?: string; provider?: string; model?: string; priority?: number; dependsOn?: string[] }) => { const id = uid(); tx(db, () => { run(db, "INSERT INTO tasks (id,project_id,title,description,agent_id,provider,model,priority,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)", id, t.projectId, t.title, t.description ?? null, t.agentId ?? null, t.provider ?? null, t.model ?? null, t.priority ?? 5, "todo", now()); for (const d of t.dependsOn ?? []) run(db, "INSERT INTO task_dependencies VALUES (?,?)", id, d); }); bus.emit("task.created", { title: t.title }, { taskId: id, projectId: t.projectId }); return id; },
      setStatus: (id: string, s: string) => run(db, "UPDATE tasks SET status=? WHERE id=?", s, id),
      start: (id: string, useWorktree = false) => { const t = one<any>(db, "SELECT * FROM tasks WHERE id=?", id); if (!t) throw new Error("Tâche introuvable"); if (t.orchestration_id) throw new Error("Cette tâche est pilotée par l'orchestrateur : utilisez la page Orchestrateur (reprise ou relance)."); return exec.enqueue({ projectId: t.project_id, agentId: t.agent_id, taskId: id, provider: t.provider, model: t.model, prompt: [t.title, t.description].filter(Boolean).join("\n\n"), priority: t.priority, useWorktree } as EnqueueInput); },
      edges: () => all(db, "SELECT task_id, depends_on FROM task_dependencies"), update: (id: string, t: Record<string, any>) => { const m: Record<string, string> = { title: "title", description: "description", priority: "priority", agentId: "agent_id" }; for (const [k, v] of Object.entries(t)) if (m[k]) run(db, `UPDATE tasks SET ${m[k]}=? WHERE id=?`, v === "" ? null : v, id); },
      deps: (id: string) => all(db, "SELECT depends_on FROM task_dependencies WHERE task_id=?", id) },
    // --- exécutions
    run: (i: EnqueueInput) => exec.enqueue(i), cancel: (id: string) => exec.cancel(id), retry: (id: string) => exec.retry(id), resolveApproval: (id: string, ok: boolean) => exec.resolveApproval(id, ok),
    executions: { list: (f: { projectId?: string; status?: string; limit?: number; mode?: string } = {}) => all(db, `SELECT e.*, a.name agent_name, p.name project_name, t.title task_title, (SELECT COALESCE(SUM(total),0) FROM usage_events WHERE execution_id=e.id) tokens, (SELECT COALESCE(SUM(c.calculated_usd),0) FROM usage_events u JOIN cost_estimates c ON c.usage_event_id=u.id WHERE u.execution_id=e.id) usd FROM agent_executions e LEFT JOIN agent_profiles a ON a.id=e.agent_id LEFT JOIN projects p ON p.id=e.project_id LEFT JOIN tasks t ON t.id=e.task_id WHERE 1=1 ${f.projectId ? "AND e.project_id=?" : ""} ${f.status ? "AND e.status=?" : ""} ${f.mode ? "AND e.mode=?" : ""} ORDER BY e.created_at DESC LIMIT ${f.limit ?? 200}`, ...[f.projectId, f.status, f.mode].filter(Boolean)),
      get: (id: string) => one(db, "SELECT * FROM agent_executions WHERE id=?", id), logs: (id: string, after = 0) => all(db, "SELECT * FROM exec_logs WHERE execution_id=? AND id>? ORDER BY id LIMIT 2000", id, after),
      transitions: (id: string) => all(db, "SELECT * FROM exec_transitions WHERE execution_id=? ORDER BY at", id),
      usage: (id: string) => all(db, "SELECT u.*, c.calculated_usd, c.status pricing_status, c.detail pricing_detail FROM usage_events u LEFT JOIN cost_estimates c ON c.usage_event_id=u.id WHERE u.execution_id=? ORDER BY u.created_at", id),
      pendingApprovals: () => all(db, "SELECT * FROM approvals WHERE status='pending' ORDER BY created_at") },
    // --- analytics
    analytics: { totals: (f?: A.UsageFilter) => A.usageTotals(db, f), by: (b: A.GroupBy, f?: A.UsageFilter, l?: number) => A.usageBy(db, b, f, l), series: (b: any, f?: A.UsageFilter) => A.usageSeries(db, b, f), rows: (f?: A.UsageFilter) => A.usageRows(db, f), execStats: (f?: any) => A.executionStats(db, f), export: (f: A.UsageFilter, fmt: "csv" | "json") => A.exportRows(db, f, fmt) },
    dashboard() {
      const d = new Date(); const startDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
      const startWeek = new Date(Date.now() - 7 * 864e5).toISOString(); const startMonth = new Date(Date.now() - 30 * 864e5).toISOString();
      const c = (sql: string, ...p: any[]) => (one<any>(db, sql, ...p)?.c ?? 0) as number;
      return { today: A.usageTotals(db, { since: startDay }), week: A.usageTotals(db, { since: startWeek }), month: A.usageTotals(db, { since: startMonth }), all: A.usageTotals(db), byProvider: A.usageBy(db, "provider"), topModel: A.usageBy(db, "model", {}, 1)[0], topProject: A.usageBy(db, "project", {}, 1)[0],
        counts: { projects: c("SELECT COUNT(*) c FROM projects WHERE archived=0"), agents: c("SELECT COUNT(*) c FROM agent_profiles"), running: c("SELECT COUNT(*) c FROM agent_executions WHERE status IN ('preparing','running')"), waiting: c("SELECT COUNT(*) c FROM agent_executions WHERE status='waiting_approval'"), queued: c("SELECT COUNT(*) c FROM agent_executions WHERE status='queued'"), completed: c("SELECT COUNT(*) c FROM agent_executions WHERE status='completed'"), failed: c("SELECT COUNT(*) c FROM agent_executions WHERE status='failed'"), tasksDone: c("SELECT COUNT(*) c FROM tasks WHERE status IN ('done','review')"), unread: c("SELECT COUNT(*) c FROM notifications WHERE read=0") },
        recent: all(db, "SELECT e.id,e.provider,e.model,e.status,e.prompt,e.created_at,e.duration_ms,a.name agent_name FROM agent_executions e LEFT JOIN agent_profiles a ON a.id=e.agent_id ORDER BY e.created_at DESC LIMIT 8") };
    },
    pricing: { list: () => listPricing(db), calc: (p: ProviderId, m: string, t: any) => calculateCost(db, p, m, t) },
    notifications: { list: (limit = 100) => all(db, "SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?", limit), markRead: (id?: string) => id ? run(db, "UPDATE notifications SET read=1 WHERE id=?", id) : run(db, "UPDATE notifications SET read=1") },
    settings: { get: <T>(k: string, d: T) => getSetting(db, k, d), set: (k: string, v: unknown) => setSetting(db, k, v), all: () => Object.fromEntries(all<any>(db, "SELECT * FROM app_settings").map((r) => [r.key, JSON.parse(r.value)])) },
    audit: (limit = 100) => all(db, "SELECT * FROM audit_events ORDER BY at DESC LIMIT ?", limit),
    git: { isRepo: isGitRepo, worktrees: (pid?: string) => listWorktrees(db, pid), changes: worktreeChanges, diff: worktreeDiff,
      merge: (wtId: string, confirmed: boolean) => { const w = one<any>(db, "SELECT * FROM git_worktrees WHERE id=?", wtId); const p = one<any>(db, "SELECT * FROM projects WHERE id=?", w?.project_id); if (!w || !p) return { ok: false, reason: "introuvable" }; const r = mergeWorktree(p.path, w.branch, { confirmed }); if (r.ok) run(db, "UPDATE git_worktrees SET status='merged' WHERE id=?", wtId); else if ((r as any).conflict) bus.emit("git.conflict", { branch: w.branch }, { projectId: p.id }); return r; } },
    async close() { automations.stop(); terminals.shutdown(); await exec.shutdown(); db.close(); },
  };
}
export type Core = ReturnType<typeof createCore>;
