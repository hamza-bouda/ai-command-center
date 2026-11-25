import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCore } from "../src/service.js";
import { run, uid, now } from "../src/db.js";
import type { RunRequest, RunHandle, ProviderStatus, ProviderId, ModelInfo } from "../src/types.js";
import type { RunSink } from "../src/providers/common.js";

const MODELS: ModelInfo[] = [{ id: "", displayName: "Défaut", isDefault: true, source: "cli-alias" }];
const fake = (id: ProviderId): any => ({ id, detectInstallation: async () => ({ installed: true }), getVersion: async () => "0", getSupportedModels: async () => MODELS, getCapabilities: () => ({}), getQuotaStatus: async () => ({ provider: id, state: "unknown", windows: [], checkedAt: now() }),
  getAuthStatus: async (): Promise<ProviderStatus> => ({ provider: id, installed: true, authenticated: true, authMode: "subscription", warnings: [], checkedAt: now() }),
  startSession(_r: RunRequest, sink: RunSink): RunHandle { const done = new Promise<void>((res) => setTimeout(() => { sink.event({ type: "text", text: "ok", final: true }); sink.event({ type: "done", ok: true }); res(); }, 20)); return { done, cancel: async () => {} } as any; },
  resumeSession(q: any, s: any) { return (this as any).startSession(q, s); }, cancelExecution: async (h: RunHandle) => h.cancel(), dispose: async () => {} });
const mk = (dir?: string, dbFile = ":memory:") => createCore({ dataDir: dir ?? mkdtempSync(join(tmpdir(), "imp-")), dbFile, adapters: { claude: fake("claude"), codex: fake("codex") } });
const TASKS = [{ key: "a", title: "A", role: "architect", dependsOn: [], kind: "agent", provider: "claude" }, { key: "b", title: "B", role: "reviewer", dependsOn: ["a"], kind: "agent", pos: { x: 10, y: 20 } }];

describe("Améliorations", () => {
  it("un plan d'orchestration devient un workflow réutilisable (positions comprises)", async () => {
    const c = mk(); const pid = c.projects.create({ name: "P", path: process.cwd() }); const oid = c.orchestrator.create({ projectId: pid, goal: "Mon objectif", mode: "manual" }); const ck = await c.orchestrator.setPlan(oid, { tasks: TASKS }); expect(ck.ok).toBe(true);
    const wid = c.workflows.fromOrchestration(oid, "Modèle issu d'une exécution"); const w = c.workflows.get(wid)!; expect(w.name).toBe("Modèle issu d'une exécution"); expect(w.builtin).toBe(0); expect(w.nodes.map((n: any) => n.key)).toEqual(["a", "b"]); expect(w.nodes[1].dependsOn).toEqual(["a"]); expect(w.nodes[1].pos).toEqual({ x: 10, y: 20 });
    expect(() => c.workflows.fromOrchestration("nope", "x")).toThrow(/introuvable/); const o2 = c.orchestrator.create({ projectId: pid, goal: "Sans plan", mode: "manual" }); expect(() => c.workflows.fromOrchestration(o2, "x")).toThrow(/pas de plan/);
  });
  it("statistiques par rôle : réussites, échecs, moyennes", () => {
    const c = mk(); const pid = c.projects.create({ name: "P", path: process.cwd() }); const oid = c.orchestrator.create({ projectId: pid, goal: "G", mode: "manual" });
    const task = (role: string) => { const id = uid(); run(c.db, "INSERT INTO tasks (id,project_id,title,status,created_at,orchestration_id,node_key,node_kind,role) VALUES (?,?,?,?,?,?,?,?,?)", id, pid, role, "done", now(), oid, role + uid(), "agent", role); return id; };
    const ex = (tid: string, st: string, ms: number) => run(c.db, "INSERT INTO agent_executions (id,task_id,project_id,provider,prompt,cwd,status,attempt,priority,created_at,duration_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?)", uid(), tid, pid, "claude", "p", process.cwd(), st, 1, 5, now(), ms);
    const t1 = task("qa"), t2 = task("qa"), t3 = task("architect"); ex(t1, "completed", 1000); ex(t2, "failed", 3000); ex(t3, "completed", 500);
    const r = c.analytics.roles() as any[]; const qa = r.find((x) => x.role === "qa"); expect(qa.runs).toBe(2); expect(qa.ok).toBe(1); expect(qa.failed).toBe(1); expect(qa.avg_ms).toBe(2000); expect(r.find((x) => x.role === "architect").ok).toBe(1);
  });
  it("reprise automatique au redémarrage : seulement si l'option est activée", async () => {
    const dir = mkdtempSync(join(tmpdir(), "imp-")); const file = join(dir, "acc.sqlite"); let c = mk(dir, file); const pid = c.projects.create({ name: "P", path: process.cwd() }); const oid = c.orchestrator.create({ projectId: pid, goal: "G", mode: "manual" }); await c.orchestrator.setPlan(oid, { tasks: TASKS }); await c.orchestrator.approve(oid);
    await new Promise((r) => setTimeout(r, 400)); await c.close?.();
    // simule un arrêt brutal : orchestration « running » sans exécution vivante
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite"); const raw = new DatabaseSync(file); raw.exec("UPDATE orchestrations SET status='running'; UPDATE tasks SET status='in_progress' WHERE node_key='a'; UPDATE agent_executions SET status='interrupted';"); raw.close();
    c = mk(dir, file); expect(c.orchestrator.get(oid).status).toBe("paused"); await new Promise((r) => setTimeout(r, 2600)); expect(c.orchestrator.get(oid).status).toBe("paused"); await c.close?.();
    const raw2 = new DatabaseSync(file); raw2.exec("UPDATE orchestrations SET status='running'; UPDATE tasks SET status='in_progress' WHERE node_key='a'; INSERT OR REPLACE INTO app_settings (key,value) VALUES ('orchestrator.autoResume','true');"); raw2.close();
    c = mk(dir, file); await new Promise((r) => setTimeout(r, 2800)); expect(c.orchestrator.get(oid).status).not.toBe("paused"); await c.close?.();
  });
});
