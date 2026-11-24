import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCore } from "../src/service.js";
import { validatePlan, extractJson, parseHandoffBlock, renderHandoff, MAX_TASKS, type AgentHandoff } from "../src/orchestration-plan.js";
import { now, all, one } from "../src/db.js";
import type { AgentProviderAdapter, RunSink } from "../src/providers/common.js";
import type { RunRequest, RunHandle, ProviderStatus, ProviderId } from "../src/types.js";

const T = (o: any = {}) => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0, ...o });
const node = (key: string, extra: any = {}) => ({ key, title: key, role: "backend", dependsOn: [], ...extra });

describe("validatePlan", () => {
  it("accepte un DAG valide et calcule l'ordre", () => { const c = validatePlan({ tasks: [node("a", { role: "architect" }), node("b", { dependsOn: ["a"] }), node("c", { dependsOn: ["a"], role: "frontend" })] }); expect(c.ok).toBe(true); expect(c.order![0]).toBe("a"); });
  it("détecte les cycles", () => { const c = validatePlan({ tasks: [node("a", { dependsOn: ["b"] }), node("b", { dependsOn: ["a"] })] }); expect(c.ok).toBe(false); expect(c.errors.join()).toMatch(/Cycle/); });
  it("détecte dépendance manquante, auto-dépendance et clé en double", () => {
    expect(validatePlan({ tasks: [node("a", { dependsOn: ["zz"] })] }).errors.join()).toMatch(/inexistante/);
    expect(validatePlan({ tasks: [node("a", { dependsOn: ["a"] })] }).errors.join()).toMatch(/lui-même/);
    expect(validatePlan({ tasks: [node("a"), node("a")] }).errors.join()).toMatch(/double/);
  });
  it("limite le nombre de tâches et refuse un plan vide", () => { expect(validatePlan({ tasks: Array.from({ length: MAX_TASKS + 1 }, (_, i) => node("t" + i)) }).ok).toBe(false); expect(validatePlan({ tasks: [] }).ok).toBe(false); expect(validatePlan({}).ok).toBe(false); });
  it("remplace un rôle inconnu avec avertissement", () => { const c = validatePlan({ tasks: [node("a", { role: "wizard" })] }); expect(c.ok).toBe(true); expect(c.plan!.tasks[0]!.role).toBe("fullstack"); expect(c.warnings.join()).toMatch(/Rôle inconnu/); });
  it("avertit des écritures parallèles sans worktree, pas avec worktrees ni dépendance", () => {
    const par = { tasks: [node("a"), node("b", { role: "frontend" })] };
    expect(validatePlan(par).warnings.join()).toMatch(/Conflit de ressources/); expect(validatePlan(par, { useWorktrees: true }).warnings.join()).not.toMatch(/Conflit/);
    expect(validatePlan({ tasks: [node("a"), node("b", { dependsOn: ["a"] })] }).warnings.join()).not.toMatch(/Conflit/);
  });
  it("avertit d'un fournisseur indisponible", () => expect(validatePlan({ tasks: [node("a", { provider: "codex" })] }, { unavailable: ["codex"] }).warnings.join()).toMatch(/indisponible/));
});
describe("extraction et handoffs", () => {
  it("extrait un JSON fenced ou brut", () => { expect(extractJson("blabla ```json\n{\"a\":1}\n``` fin")).toEqual({ a: 1 }); expect(extractJson('texte {"a":{"b":"}"}} suite')).toEqual({ a: { b: "}" } }); expect(extractJson("rien")).toBeUndefined(); });
  it("sépare résumé et bloc handoff", () => { const p = parseHandoffBlock('Voici le travail.\n```handoff\n{"decisions":["D1"],"testResults":"12 ok","openQuestions":["Q?"],"nextSteps":["N1"]}\n```'); expect(p.structured).toBe(true); expect(p.summary).toBe("Voici le travail."); expect(p.decisions).toEqual(["D1"]); expect(p.testResults).toBe("12 ok"); });
  it("sans bloc : non structuré, rien d'inventé", () => { const p = parseHandoffBlock("juste du texte"); expect(p).toMatchObject({ structured: false, decisions: [], openQuestions: [], nextSteps: [] }); });
  it("rendu tronqué pour limiter la consommation", () => {
    const h: AgentHandoff = { objective: "o", from: { taskId: "1", title: "A" }, to: { taskId: "2", title: "B" }, summary: "x".repeat(20000), decisions: [], filesModified: [], commits: [], errors: [], openQuestions: [], nextSteps: [], usage: { tokens: 1, usd: null }, structured: false };
    const r = renderHandoff(h); expect(r.length).toBeLessThanOrEqual(6100); expect(r).toMatch(/tronqué/);
  });
});

// ---------- scénarios moteur avec faux fournisseurs ----------
interface Fake { prompts: { provider: ProviderId; prompt: string; cwd: string }[]; adapter: (id: ProviderId) => AgentProviderAdapter; failMatching?: RegExp; delay: number; auth: Record<ProviderId, boolean>; planner: () => string }
const PLAN = JSON.stringify({ summary: "plan", tasks: [
  { key: "archi", title: "Architecture", description: "Conçois", role: "architect", provider: "claude", dependsOn: [], kind: "agent" },
  { key: "back", title: "Backend", description: "Implémente l'API", role: "backend", provider: "codex", dependsOn: ["archi"], kind: "agent" },
  { key: "front", title: "Frontend", description: "Implémente l'UI", role: "frontend", provider: "claude", dependsOn: ["archi"], kind: "agent" },
  { key: "ok", title: "Validation utilisateur", role: "reviewer", dependsOn: ["back", "front"], kind: "approval" }] });
function mk(over: Partial<Fake> = {}) {
  const f: Fake = { prompts: [], delay: 30, auth: { claude: true, codex: true }, planner: () => "```json\n" + PLAN + "\n```", ...over } as any;
  f.adapter = (id) => ({ id, detectInstallation: async () => ({ installed: true }), getVersion: async () => "0", getSupportedModels: async () => [], getCapabilities: () => ({}), getQuotaStatus: async () => ({ provider: id, state: "unknown", windows: [], checkedAt: now() }),
    getAuthStatus: async (): Promise<ProviderStatus> => ({ provider: id, installed: true, authenticated: f.auth[id], authMode: "subscription", warnings: [], checkedAt: now() }),
    startSession(req: RunRequest, sink: RunSink): RunHandle {
      f.prompts.push({ provider: id, prompt: req.prompt, cwd: req.cwd }); let cancel!: () => void;
      const done = new Promise<void>((res) => { const t = setTimeout(() => {
        const isPlan = /orchestrateur d'une équipe/.test(req.prompt); const fail = f.failMatching?.test(req.prompt) && !isPlan;
        sink.event({ type: "usage", report: { model: "claude-sonnet-5-5", mode: "final", counterKey: "k" + req.executionId, eventKey: "final", confidence: "reported", tokens: T({ input: 10, output: 5, total: 15 }) } });
        if (fail) { sink.event({ type: "done", ok: false, message: "boom" }); return res(); }
        const text = isPlan ? f.planner() : `Travail fait pour: ${/\[Ta tâche\] (.*)/.exec(req.prompt)?.[1]}\n\`\`\`handoff\n{"decisions":["choix-${id}"],"testResults":"ok","nextSteps":["suite"]}\n\`\`\``;
        sink.event({ type: "text", text, final: true }); sink.event({ type: "done", ok: true, message: text }); res(); }, f.delay); cancel = () => { clearTimeout(t); sink.event({ type: "done", ok: false, message: "Annulé" }); res(); }; });
      return { done, cancel: async () => cancel() }; },
    resumeSession(r: any, s: RunSink) { return (this as any).startSession(r, s); }, cancelExecution: async (h: RunHandle) => h.cancel(), dispose: async () => {} } as any);
  const dir = mkdtempSync(join(tmpdir(), "orch-")); const c = createCore({ dataDir: dir, dbFile: ":memory:", adapters: { claude: f.adapter("claude"), codex: f.adapter("codex") } });
  c.settings.set("concurrency.global", 6); c.settings.set("concurrency.provider", 6);
  const project = c.projects.create({ name: "P", path: dir }); return { c, f, project };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(f: () => boolean, ms = 8000) { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error("timeout"); await wait(20); } }
const st = (c: any, id: string) => c.orchestrator.get(id).status;

describe("Orchestrator", () => {
  it("planifie (assisté), attend l'approbation, exécute le DAG en parallèle avec handoffs, gate de validation, rapport", async () => {
    const { c, f, project } = mk(); const id = c.orchestrator.create({ projectId: project, goal: "Construire un SaaS", mode: "assisted" });
    await until(() => st(c, id) === "awaiting_approval"); expect(all(c.db, "SELECT 1 FROM tasks WHERE orchestration_id=?", id)).toHaveLength(0); // rien n'est créé avant approbation
    const planner = f.prompts[0]!; expect(planner.prompt).toMatch(/Construire un SaaS/);
    await c.orchestrator.approve(id); expect(c.orchestrator.tasks(id)).toHaveLength(4);
    // back et front en parallèle après archi
    await until(() => f.prompts.filter((p) => /\[Ta tâche\] (Backend|Frontend)/.test(p.prompt)).length === 2);
    const back = f.prompts.find((p) => /\[Ta tâche\] Backend/.test(p.prompt))!; const front = f.prompts.find((p) => /\[Ta tâche\] Frontend/.test(p.prompt))!;
    expect(back.provider).toBe("codex"); expect(front.provider).toBe("claude"); // fournisseurs du plan respectés
    expect(back.prompt).toMatch(/Handoff de « Architecture »/); expect(back.prompt).toMatch(/Travail fait pour: Architecture/); expect(back.prompt).toMatch(/choix-claude/);
    expect(back.prompt).not.toMatch(/Handoff de « Frontend »/); // pas de transfert inutile entre branches parallèles
    // nœud d'approbation humaine
    await until(() => c.orchestrator.pendingGates().length === 1); expect(st(c, id)).toBe("running");
    await c.orchestrator.resolveGate(c.orchestrator.pendingGates()[0].id, true); await until(() => st(c, id) === "completed");
    const o = c.orchestrator.get(id); expect(o.report).toMatch(/Rapport d'orchestration/); expect(o.report).toMatch(/Backend/);
    const hs = c.orchestrator.handoffs(id); expect(hs).toHaveLength(2); expect(hs[0].payload.decisions.length).toBeGreaterThan(0); expect(hs[0].payload.structured).toBe(true); expect(hs.every((h: any) => h.chars > 0)).toBe(true);
    expect(c.analytics.totals({}).total).toBeGreaterThan(0); // consommation des étapes + planification tracée
    // chaque agent garde son propre historique : une exécution distincte par tâche
    const exs = all<any>(c.db, "SELECT DISTINCT task_id FROM agent_executions WHERE task_id IS NOT NULL"); expect(exs).toHaveLength(3);
  });
  it("plan invalide proposé par l'IA → retour en brouillon avec erreur, jamais exécuté", async () => {
    const { c, project } = mk({ planner: () => 'Voici : ```json\n{"tasks":[{"key":"a","title":"A","dependsOn":["b"]},{"key":"b","title":"B","dependsOn":["a"]}]}\n```' } as any);
    const id = c.orchestrator.create({ projectId: project, goal: "x", mode: "assisted" }); await until(() => st(c, id) === "draft" && !!c.orchestrator.get(id).error);
    expect(c.orchestrator.get(id).error).toMatch(/Cycle/); expect(all(c.db, "SELECT 1 FROM tasks WHERE orchestration_id=?", id)).toHaveLength(0);
  });
  it("mode manuel : plan saisi par l'utilisateur, validé localement", async () => {
    const { c, project } = mk(); const id = c.orchestrator.create({ projectId: project, goal: "manuel", mode: "manual" });
    expect(st(c, id)).toBe("draft"); const bad = await c.orchestrator.setPlan(id, { tasks: [node("a", { dependsOn: ["x"] })] }); expect(bad.ok).toBe(false);
    const good = await c.orchestrator.setPlan(id, { tasks: [node("a", { role: "architect" }), node("b", { dependsOn: ["a"] })] }); expect(good.ok).toBe(true); expect(st(c, id)).toBe("awaiting_approval");
    await c.orchestrator.approve(id); await until(() => st(c, id) === "completed");
  });
  it("échec d'une tâche → pause, aval bloqué ; retry traçable puis reprise", async () => {
    const { c, f, project } = mk({ failMatching: /\[Ta tâche\] Backend/ } as any); const id = c.orchestrator.create({ projectId: project, goal: "g", mode: "assisted" });
    await until(() => st(c, id) === "awaiting_approval"); await c.orchestrator.approve(id); await until(() => st(c, id) === "paused");
    const tasks = c.orchestrator.tasks(id); expect(tasks.find((t: any) => t.node_key === "back").status).toBe("blocked"); expect(tasks.find((t: any) => t.node_key === "ok").status).toBe("todo");
    f.failMatching = undefined; await c.orchestrator.retryTask(tasks.find((t: any) => t.node_key === "back").id);
    expect(all(c.db, "SELECT 1 FROM agent_executions WHERE task_id=?", tasks.find((t: any) => t.node_key === "back").id).length).toBeGreaterThanOrEqual(1);
    await until(() => c.orchestrator.pendingGates().length === 1); await c.orchestrator.resolveGate(c.orchestrator.pendingGates()[0].id, true); await until(() => st(c, id) === "completed");
    const back = c.orchestrator.tasks(id).find((t: any) => t.node_key === "back"); expect(all(c.db, "SELECT 1 FROM agent_executions WHERE task_id=?", back.id)).toHaveLength(2); // l'ancienne tentative est conservée
  });
  it("mode auto : lancement immédiat mais porte d'approbation avant les étapes qui écrivent", async () => {
    const { c, project } = mk(); const id = c.orchestrator.create({ projectId: project, goal: "auto", mode: "auto" });
    await until(() => st(c, id) === "running"); await until(() => c.orchestrator.pendingGates().length > 0);
    const g = c.orchestrator.pendingGates()[0]; expect(g.kind).toBe("gate"); expect(["Backend", "Frontend"]).toContain(g.task_title); // première étape écrivante après l'architecte (lecture seule)
    expect(c.orchestrator.tasks(id).find((t: any) => t.node_key === "archi").gate).toBe(0);
    // refuser met en pause
    await c.orchestrator.resolveGate(g.id, false); expect(st(c, id)).toBe("paused");
  });
  it("fournisseur indisponible → bascule vers l'autre, avec trace", async () => {
    const { c, f, project } = mk(); f.auth.codex = false; const id = c.orchestrator.create({ projectId: project, goal: "g", mode: "assisted" });
    await until(() => st(c, id) === "awaiting_approval"); await c.orchestrator.approve(id); await until(() => f.prompts.some((p) => /\[Ta tâche\] Backend/.test(p.prompt)));
    expect(f.prompts.find((p) => /\[Ta tâche\] Backend/.test(p.prompt))!.provider).toBe("claude"); expect(c.orchestrator.events(id).some((e: any) => e.type === "provider_swapped")).toBe(true);
  });
  it("annulation : arrête les exécutions, remet les tâches non terminées en backlog", async () => {
    const { c, project } = mk({ delay: 400 } as any); const id = c.orchestrator.create({ projectId: project, goal: "g", mode: "assisted" });
    await until(() => st(c, id) === "awaiting_approval"); await c.orchestrator.approve(id); await wait(150); await c.orchestrator.cancel(id);
    expect(st(c, id)).toBe("cancelled"); await wait(600); expect(c.orchestrator.tasks(id).every((t: any) => t.status === "backlog")).toBe(true);
  });
  it("les tâches orchestrées ne peuvent pas être lancées en contournant le moteur", async () => {
    const { c, project } = mk(); const id = c.orchestrator.create({ projectId: project, goal: "m", mode: "manual" }); await c.orchestrator.setPlan(id, { tasks: [node("a")] }); await c.orchestrator.approve(id);
    expect(() => c.tasks.start(c.orchestrator.tasks(id)[0].id)).toThrow(/orchestrateur/);
  });
  it("réconciliation au redémarrage : orchestration en pause, jamais « terminée »", async () => {
    const { c, project } = mk({ delay: 5000 } as any); const id = c.orchestrator.create({ projectId: project, goal: "g", mode: "manual" }); await c.orchestrator.setPlan(id, { tasks: [node("a")] }); await c.orchestrator.approve(id); await wait(100);
    c.exec.reconcile(); c.orchestrator.reconcile(); expect(one<any>(c.db, "SELECT status FROM orchestrations WHERE id=?", id)!.status).toBe("paused");
  });
});
