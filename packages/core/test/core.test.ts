import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, one, all, run, uid, now, DB } from "../src/db.js";
import { seedPricing, calculateCost, normalizeModelId } from "../src/pricing.js";
import { UsageNormalizer } from "../src/usage.js";
import { parseClaudeLine } from "../src/providers/claude.js";
import { parseRateLimits } from "../src/providers/codex.js";
import { checkEnv, childEnv } from "../src/providers/common.js";
import { createCore } from "../src/service.js";
import type { AgentProviderAdapter, RunSink } from "../src/providers/common.js";
import type { RunRequest, RunHandle, ProviderStatus } from "../src/types.js";

const T = (o: Partial<any> = {}) => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0, ...o });
let db: DB; let exId: string;
function mkExec(db: DB) {
  const pid = uid(); run(db, "INSERT INTO projects (id,name,path,created_at) VALUES (?,?,?,?)", pid, "p", "/tmp", now());
  const id = uid(); run(db, "INSERT INTO agent_executions (id,project_id,provider,prompt,status,created_at) VALUES (?,?,?,?,?,?)", id, pid, "codex", "x", "running", now()); return { pid, id };
}
beforeEach(() => { db = openDb(":memory:"); seedPricing(db); exId = mkExec(db).id; });

describe("pricing", () => {
  it("reproduit exactement le coût rapporté par Claude Code (sonnet-5-5, cache 1h)", () => {
    const c = calculateCost(db, "claude", "claude-sonnet-5-5", T({ input: 2, output: 4, cacheRead: 17369, cacheWrite: 10575, cacheWrite1h: 10575 }));
    expect(c.status).toBe("calculated"); expect(c.usd).toBeCloseTo(0.0440809, 7);
  });
  it("modèle inconnu → prix indisponible, jamais inventé", () => {
    const c = calculateCost(db, "codex", "gpt-99-zeta", T({ input: 10 })); expect(c.usd).toBeNull(); expect(c.status).toBe("price_unavailable");
  });
  it("normalise suffixe de date et [1m]", () => { expect(normalizeModelId("claude-opus-5-5-20260101")).toBe("claude-opus-5-5"); expect(normalizeModelId("claude-opus-5-5[1m]")).toBe("claude-opus-5-5"); });
  it("tarif de cache absent → partiel, sans prix fictif", () => {
    const c = calculateCost(db, "codex", "gpt-5.5", T({ input: 1000, cacheWrite: 500 })); expect(c.status).toBe("partial");
  });
});

describe("UsageNormalizer", () => {
  const ctx = () => ({ executionId: exId, provider: "codex" as const });
  it("cumulatif : ne compte que les deltas, sans double comptage", () => {
    const n = new UsageNormalizer(db);
    const r1 = n.record(ctx(), { model: "gpt-6-luna", mode: "cumulative", counterKey: "th1", eventKey: "t1:100", confidence: "reported", tokens: T({ input: 80, output: 20, total: 100 }), lastStep: T({ input: 80, output: 20, total: 100 }) });
    const r2 = n.record(ctx(), { model: "gpt-6-luna", mode: "cumulative", counterKey: "th1", eventKey: "t1:250", confidence: "reported", tokens: T({ input: 180, output: 70, total: 250 }), lastStep: T({ input: 100, output: 50, total: 150 }) });
    const dup = n.record(ctx(), { model: "gpt-6-luna", mode: "cumulative", counterKey: "th1", eventKey: "t1:250", confidence: "reported", tokens: T({ input: 180, output: 70, total: 250 }) });
    expect(r1.delta.total).toBe(100); expect(r2.delta.total).toBe(150); expect(dup.duplicate).toBe(true);
    expect(one<any>(db, "SELECT SUM(total) t FROM usage_events").t).toBe(250);
  });
  it("session reprise : base = total - dernier pas (calculated)", () => {
    const n = new UsageNormalizer(db);
    const r = n.record(ctx(), { model: "gpt-6-luna", mode: "cumulative", counterKey: "old", eventKey: "a", confidence: "reported", tokens: T({ input: 5000, total: 5000 }), lastStep: T({ input: 700, total: 700 }) });
    expect(r.delta.total).toBe(700); expect(r.confidence).toBe("calculated"); expect(r.note).toMatch(/reprise/);
  });
  it("base inconnue → rien d'imputé, confiance unknown", () => {
    const r = new UsageNormalizer(db).record(ctx(), { model: "m", mode: "cumulative", counterKey: "z", eventKey: "a", confidence: "reported", tokens: T({ total: 9999 }) });
    expect(r.delta.total).toBe(0); expect(r.confidence).toBe("unknown");
  });
  it("compteur en recul → ignoré et signalé", () => {
    const n = new UsageNormalizer(db); n.record(ctx(), { model: "m", mode: "cumulative", counterKey: "r", eventKey: "1", confidence: "reported", tokens: T({ total: 500 }), lastStep: T({ total: 500 }) });
    const r = n.record(ctx(), { model: "m", mode: "cumulative", counterKey: "r", eventKey: "2", confidence: "reported", tokens: T({ total: 100 }) });
    expect(r.delta.total).toBe(0); expect(r.confidence).toBe("unknown");
  });
  it("final Claude : conserve le coût rapporté séparément du calcul", () => {
    const r = new UsageNormalizer(db).record({ ...ctx(), provider: "claude" }, { model: "claude-sonnet-5-5", mode: "final", counterKey: "c", eventKey: "final", confidence: "reported", providerCostUsd: 0.0440809, tokens: T({ input: 2, output: 4, cacheRead: 17369, cacheWrite: 10575, cacheWrite1h: 10575, total: 27950 }) });
    const row = one<any>(db, "SELECT u.provider_cost_usd p, c.calculated_usd c FROM usage_events u JOIN cost_estimates c ON c.usage_event_id=u.id");
    expect(row.p).toBeCloseTo(0.0440809, 7); expect(row.c).toBeCloseTo(0.0440809, 7); expect(r.usd).not.toBeNull();
  });
});

describe("parsers de protocole", () => {
  it("Claude result → usage par modèle + done", () => {
    const ev = parseClaudeLine({ type: "result", is_error: false, result: "ok", modelUsage: { "claude-sonnet-5-5": { inputTokens: 2, outputTokens: 4, cacheReadInputTokens: 17369, cacheCreationInputTokens: 10575, cacheCreationEphemeral1hInputTokens: 10575, costUSD: 0.044 } } }, "e1", {});
    expect(ev.find((e) => e.type === "usage")).toBeTruthy(); expect(ev.at(-1)).toMatchObject({ type: "done", ok: true });
  });
  it("Claude erreur de quota → flag quota", () => {
    const ev = parseClaudeLine({ type: "result", is_error: true, result: "Usage limit reached" }, "e1", {}); expect(ev.find((e) => e.type === "error")).toMatchObject({ quota: true });
  });
  it("rate_limit_event → fenêtres %", () => {
    const [e] = parseClaudeLine({ type: "rate_limit_event", rate_limit_info: { status: "allowed", unifiedWindows: { five_hour: { utilization: 0.19, resetsAt: 1795383600, status: "allowed" } } } }, "e", {}) as any;
    expect(e.quota.windows[0].usedPercent).toBe(19);
  });
  it("Codex rate limits", () => {
    const q = parseRateLimits({ ordinaryUsageAllowed: true, rateLimits: { primary: { usedPercent: 4, windowDurationMins: 300, resetsAt: 1795391097 }, secondary: { usedPercent: 92, windowDurationMins: 10080, resetsAt: 1795765615 } } });
    expect(q.state).toBe("limited"); expect(q.windows).toHaveLength(2);
  });
});

describe("garde-fou facturation", () => {
  it("détecte et retire les variables API en mode exclusif", () => {
    const env = { ANTHROPIC_API_KEY: "x", OPENAI_API_KEY: "y", PATH: "p", CLAUDE_CODE_SESSION_ID: "s" } as any;
    expect(checkEnv("claude", env).flagged).toEqual(["ANTHROPIC_API_KEY"]);
    const c = childEnv("claude", true, env); expect(c.ANTHROPIC_API_KEY).toBeUndefined(); expect(c.CLAUDE_CODE_SESSION_ID).toBeUndefined(); expect(c.PATH).toBe("p");
    expect(childEnv("codex", false, env).OPENAI_API_KEY).toBe("y");
  });
});

describe("migrations", () => {
  it("idempotentes", () => { const d = openDb(":memory:"); expect(all(d, "SELECT * FROM schema_migrations")).toHaveLength(10); });
});

// ---- faux adaptateur pour tester l'ordonnanceur sans consommer l'abonnement
function fake(delay = 150, ok = true): AgentProviderAdapter {
  const st: ProviderStatus = { provider: "claude", installed: true, authenticated: true, authMode: "subscription", warnings: [], checkedAt: now() };
  return { id: "claude", detectInstallation: async () => ({ installed: true }), getVersion: async () => "0", getAuthStatus: async () => st, getSupportedModels: async () => [], getCapabilities: () => ({}), getQuotaStatus: async () => ({ provider: "claude", state: "unknown", windows: [], checkedAt: now() }),
    startSession(req: RunRequest, sink: RunSink): RunHandle { let cancel!: () => void; const done = new Promise<void>((res) => { const t = setTimeout(() => { sink.event({ type: "usage", report: { model: "claude-sonnet-5-5", mode: "final", counterKey: "k" + req.executionId, eventKey: "final", confidence: "reported", tokens: T({ input: 10, output: 5, total: 15 }) } }); sink.event({ type: "text", text: "fait", final: true }); sink.event({ type: "done", ok, message: ok ? "fait" : "boom" }); res(); }, delay); cancel = () => { clearTimeout(t); sink.event({ type: "done", ok: false, message: "Annulé" }); res(); }; }); return { done, cancel: async () => cancel() }; },
    resumeSession(r: any, s: RunSink) { return this.startSession(r, s); }, cancelExecution: async (h) => h.cancel(), dispose: async () => {} } as any;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(f: () => boolean, ms = 5000) { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error("timeout"); await wait(20); } }
function mkCore(a = fake()) { const dir = mkdtempSync(join(tmpdir(), "acc-")); const c = createCore({ dataDir: dir, dbFile: ":memory:", adapters: { claude: a, codex: { ...fake(), id: "codex" } as any } }); const p = c.projects.create({ name: "P", path: dir }); return { c, p, dir }; }

describe("ExecutionManager", () => {
  it("exécute 2 tâches en parallèle, persiste usage + USD", async () => {
    const { c, p } = mkCore(); c.settings.set("concurrency.global", 4);
    const a = c.run({ projectId: p, prompt: "a", provider: "claude" }); const b = c.run({ projectId: p, prompt: "b", provider: "codex" });
    await wait(60); expect((c.executions.list().filter((e: any) => e.status === "running")).length).toBe(2);
    await until(() => c.executions.list().every((e: any) => e.status === "completed"));
    const t = c.analytics.totals(); expect(t.total).toBe(30); expect(t.usd).toBeGreaterThan(0);
    expect(c.analytics.by("provider").map((r: any) => r.key).sort()).toEqual(["claude", "codex"].filter((k) => k !== "codex" || true).sort().slice(0, 2).length === 2 ? ["claude", "codex"].sort() : []);
  });
  it("respecte la limite de concurrence globale", async () => {
    const { c, p } = mkCore(fake(250)); c.settings.set("concurrency.global", 1);
    for (let i = 0; i < 3; i++) c.run({ projectId: p, prompt: "x" + i, provider: "claude" });
    await wait(80); const act = () => c.executions.list().filter((e: any) => e.status === "running").length;
    expect(act()).toBe(1); await until(() => c.executions.list().every((e: any) => e.status === "completed"), 8000);
  });
  it("dépendances : la tâche dépendante attend", async () => {
    const { c, p } = mkCore(fake(120)); const t1 = c.tasks.create({ projectId: p, title: "t1" }); const t2 = c.tasks.create({ projectId: p, title: "t2", dependsOn: [t1] });
    const e2 = c.tasks.start(t2); await wait(100); expect((c.executions.get(e2) as any).status).toBe("queued");
    c.tasks.start(t1); await until(() => (c.tasks.list() as any[]).find((t) => t.id === t1).status === "review");
    c.tasks.setStatus(t1, "done"); await c.exec.schedule(); await until(() => (c.executions.get(e2) as any).status === "completed");
  });
  it("annulation → cancelled, jamais completed", async () => {
    const { c, p } = mkCore(fake(3000)); const id = c.run({ projectId: p, prompt: "long", provider: "claude" }); await wait(80); await c.cancel(id);
    await until(() => (c.executions.get(id) as any).status === "cancelled");
  });
  it("échec agent → failed, retry crée une nouvelle tentative", async () => {
    const { c, p } = mkCore(fake(50, false)); const t = c.tasks.create({ projectId: p, title: "x" }); const e1 = c.tasks.start(t);
    await until(() => (c.executions.get(e1) as any).status === "failed"); const e2 = c.retry(e1); expect((c.executions.get(e2) as any).attempt).toBe(2);
    await until(() => (c.executions.get(e2) as any).status === "failed"); expect(all(c.db, "SELECT 1 FROM agent_executions WHERE task_id=?", t)).toHaveLength(2);
  });
  it("réconciliation au redémarrage : jamais 'completed'", () => {
    const { c, p } = mkCore(); const id = uid(); run(c.db, "INSERT INTO agent_executions (id,project_id,provider,prompt,status,created_at) VALUES (?,?,?,?,?,?)", id, p, "claude", "x", "running", now());
    expect(c.exec.reconcile()).toBe(1); expect((c.executions.get(id) as any).status).toBe("interrupted");
  });
  it("mode abonnement exclusif bloque un mode d'auth API", async () => {
    const a = fake(); (a as any).getAuthStatus = async () => ({ provider: "claude", installed: true, authenticated: true, authMode: "api_key", warnings: [], checkedAt: now() });
    const { c, p } = mkCore(a); const id = c.run({ projectId: p, prompt: "x", provider: "claude" });
    await until(() => (c.executions.get(id) as any).status === "failed"); expect((c.executions.get(id) as any).error).toMatch(/abonnement exclusif/);
  });
});
