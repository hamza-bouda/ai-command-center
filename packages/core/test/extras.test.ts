import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createCore } from "../src/service.js";
import { parseClaudeMcp, parseCodexMcp, listSkills, inspectBackup } from "../src/system.js";
import { routerAdvice } from "../src/router.js";
import { snapshotDir, diffSnapshots } from "../src/fsnap.js";
import { BUILTIN_WORKFLOWS } from "../src/workflows.js";
import { now, all, one, run } from "../src/db.js";
import type { RunRequest, RunHandle, ProviderStatus, ProviderId, ModelInfo } from "../src/types.js";
import type { RunSink } from "../src/providers/common.js";

const T = (o: any = {}) => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0, ...o });
const MODELS: ModelInfo[] = [{ id: "", displayName: "Défaut", isDefault: true, source: "cli-alias", efforts: [{ value: "low" }, { value: "high" }] }];
const PLAN = JSON.stringify({ tasks: [{ key: "a", title: "A", role: "architect", dependsOn: [], kind: "agent" }] });

interface Rig { reqs: (RunRequest & { provider: ProviderId })[]; writeFile?: string; planner: string; sess: number }
function mk(dirOverride?: string) {
  const r: Rig = { reqs: [], planner: "```json\n" + PLAN + "\n```", sess: 0 };
  const adapter = (id: ProviderId): any => ({ id, detectInstallation: async () => ({ installed: true }), getVersion: async () => "0", getSupportedModels: async () => MODELS, getCapabilities: () => ({}), getQuotaStatus: async () => ({ provider: id, state: "unknown", windows: [], checkedAt: now() }),
    getAuthStatus: async (): Promise<ProviderStatus> => ({ provider: id, installed: true, authenticated: true, authMode: "subscription", warnings: [], checkedAt: now() }),
    startSession(req: RunRequest, sink: RunSink): RunHandle {
      r.reqs.push({ ...req, provider: id });
      const done = new Promise<void>((res) => { setTimeout(() => {
        if (r.writeFile) writeFileSync(join(req.cwd, r.writeFile), "contenu");
        sink.event({ type: "session", providerSessionId: `s-${id}-${++r.sess}` }); sink.event({ type: "usage", report: { model: id + "-m", mode: "final", counterKey: "k" + req.executionId, eventKey: "final", confidence: "reported", tokens: T({ input: 10, output: 5, total: 15 }) } });
        const text = /orchestrateur d'une équipe/.test(req.prompt) ? r.planner : `Résultat ${id}`; sink.event({ type: "text", text, final: true }); sink.event({ type: "done", ok: true, message: text }); res(); }, 25); });
      return { done, cancel: async () => { sink.event({ type: "done", ok: false, message: "Annulé" }); } }; },
    resumeSession(q: any, s: any) { return (this as any).startSession(q, s); }, cancelExecution: async (h: RunHandle) => h.cancel(), dispose: async () => {} });
  const dir = dirOverride ?? mkdtempSync(join(tmpdir(), "extras-")); const c = createCore({ dataDir: dir, dbFile: ":memory:", adapters: { claude: adapter("claude"), codex: adapter("codex") } });
  c.settings.set("concurrency.global", 8); c.settings.set("concurrency.provider", 8); const project = c.projects.create({ name: "P", path: dir }); return { c, r, dir, project };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(f: () => boolean, ms = 8000) { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error("timeout"); await wait(20); } }
const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" });
function gitRepo() { const d = mkdtempSync(join(tmpdir(), "gitrepo-")); git(d, "init", "-q"); git(d, "config", "user.email", "t@t.t"); git(d, "config", "user.name", "t"); writeFileSync(join(d, "a.txt"), "1"); git(d, "add", "."); git(d, "commit", "-qm", "init"); return d; }

describe("Workflows", () => {
  it("5 modèles livrés, valides, non modifiables ni supprimables ; duplication et édition d'une copie", () => {
    const { c } = mk(); const l = c.workflows.list(); expect(l.filter((w: any) => w.builtin)).toHaveLength(BUILTIN_WORKFLOWS.length); expect(l.map((w: any) => w.name)).toEqual(expect.arrayContaining(["Feature Development", "Bug Fix", "Refactoring", "Security Audit", "Dual AI Review"]));
    const f = l.find((w: any) => w.key === "feature"); expect(() => c.workflows.save({ id: f.id, name: "x", nodes: f.nodes })).toThrow(/dupliquez/); expect(() => c.workflows.remove(f.id)).toThrow(/livré/);
    const copy = c.workflows.duplicate(f.id); c.workflows.save({ id: copy, name: "Ma copie", nodes: f.nodes }); expect(c.workflows.get(copy).name).toBe("Ma copie"); c.workflows.remove(copy); expect(c.workflows.get(copy)).toBeUndefined();
    expect(() => c.workflows.save({ name: "cycle", nodes: [{ key: "a", title: "a", role: "qa", dependsOn: ["b"], kind: "agent" }, { key: "b", title: "b", role: "qa", dependsOn: ["a"], kind: "agent" }] })).toThrow(/Cycle/);
  });
  it("lance « Dual AI Review » : objectif injecté, analyses parallèles puis synthèse avec handoffs, statistiques par workflow", async () => {
    const { c, r, project } = mk(); const wf = c.workflows.list().find((w: any) => w.key === "dual"); const id = await c.workflows.run({ workflowId: wf.id, projectId: project, goal: "le module de paiement" });
    await until(() => c.orchestrator.get(id).status === "completed"); expect(r.reqs.filter((q) => /Analyse indépendante de : le module de paiement/.test(q.prompt))).toHaveLength(2); const synth = r.reqs.find((q) => /Comparaison et synthèse/.test(q.prompt))!; expect(synth.prompt).toMatch(/Handoff de « Analyse Claude/); expect(synth.prompt).toMatch(/Handoff de « Analyse Codex/);
    const s = c.workflows.get(wf.id); expect(s).toMatchObject({ runs: 1, ok: 1 }); expect(s.tokens).toBe(45); expect(c.workflows.runs(wf.id)).toHaveLength(1);
  });
  it("nœud test : exécute vraiment la commande (succès → suite ; échec → pause)", async () => {
    const { c, project } = mk(); const ok = c.workflows.save({ name: "T-ok", nodes: [{ key: "t", title: "Tests", role: "qa", dependsOn: [], kind: "test", command: "node -e \"console.log('vert')\"" }, { key: "n", title: "Fin", role: "qa", dependsOn: ["t"], kind: "notification", description: "Terminé" }] });
    const id = await c.workflows.run({ workflowId: ok, projectId: project, goal: "g" }); await until(() => c.orchestrator.get(id).status === "completed"); expect(c.orchestrator.tasks(id).find((t: any) => t.node_key === "t").result).toMatch(/vert/); expect(c.notifications.list().some((n: any) => n.title === "Fin")).toBe(true);
    const ko = c.workflows.save({ name: "T-ko", nodes: [{ key: "t", title: "Tests", role: "qa", dependsOn: [], kind: "test", command: "node -e \"process.exit(3)\"" }] }); const id2 = await c.workflows.run({ workflowId: ko, projectId: project, goal: "g" });
    await until(() => c.orchestrator.get(id2).status === "paused"); expect(c.orchestrator.get(id2).error).toMatch(/échoué \(code 3\)/); expect(c.orchestrator.tasks(id2)[0].status).toBe("blocked");
  });
  it("une commande de test issue d'un plan IA (mode assisté) exige toujours une approbation humaine", async () => {
    const { c, project } = mk(); const id = c.orchestrator.create({ projectId: project, goal: "g", mode: "manual" }); void id;
    const { c: c2, r: r2, project: p2 } = mk(); r2.planner = "```json\n" + JSON.stringify({ tasks: [{ key: "t", title: "Tests", role: "qa", dependsOn: [], kind: "test", command: "node -e \"1\"" }] }) + "\n```";
    const oid = c2.orchestrator.create({ projectId: p2, goal: "g", mode: "assisted" }); await until(() => c2.orchestrator.get(oid).status === "awaiting_approval"); await c2.orchestrator.approve(oid);
    await until(() => c2.orchestrator.pendingGates().length === 1); expect(c2.orchestrator.pendingGates()[0].kind).toBe("gate"); expect(c2.orchestrator.tasks(oid)[0].status).toBe("todo"); expect(c2.workflows.commands(c2.workflows.list()[0].id, "x")).toBeInstanceOf(Array);
  });
  it("les tokens du planificateur sont inclus dans le total de l'orchestration", async () => {
    const { c, project } = mk(); const id = c.orchestrator.create({ projectId: project, goal: "g", mode: "assisted" }); await until(() => c.orchestrator.get(id).status === "awaiting_approval"); await c.orchestrator.approve(id); await until(() => c.orchestrator.get(id).status === "completed");
    expect(c.orchestrator.list()[0].tokens).toBe(c.analytics.totals({}).total); expect(c.orchestrator.list()[0].tokens).toBe(30);
  });
});

describe("Comparaison Claude / Codex", () => {
  it("lecture seule : deux exécutions indépendantes en parallèle, résultats, consommation, choix et synthèse", async () => {
    const { c, r, project } = mk(); const id = await c.comparisons.create({ projectId: project, prompt: "Analyse le module", write: false, runs: [{ provider: "claude" }, { provider: "codex", effort: "high" }] });
    await until(() => c.comparisons.get(id).status === "done"); const g = c.comparisons.get(id); expect(g.runs).toHaveLength(2); expect(r.reqs.every((q) => q.permission === "read-only")).toBe(true); expect(r.reqs.find((q) => q.provider === "codex")!.effort).toBe("high");
    expect(g.runs.map((x: any) => x.usage.tokens)).toEqual([15, 15]); expect(g.runs.map((x: any) => x.execution.result_text)).toEqual(["Résultat claude", "Résultat codex"]);
    c.comparisons.choose(id, g.runs[1].id, "meilleure"); expect(c.comparisons.get(id).winner_run_id).toBe(g.runs[1].id); c.comparisons.choose(id, "both"); expect(c.comparisons.get(id).winner_run_id).toBe("both");
    const eid = c.comparisons.synthesize(id, "claude"); await until(() => (c.executions.get(eid) as any).status === "completed"); const q = r.reqs.at(-1)!; expect(q.prompt).toMatch(/Résultat claude/); expect(q.prompt).toMatch(/Résultat codex/); expect(q.policy).toBe("chat");
  });
  it("refuse < 2 configurations, config invalide, et l'écriture hors dépôt Git", async () => {
    const { c, project } = mk(); await expect(c.comparisons.create({ projectId: project, prompt: "x", write: false, runs: [{ provider: "claude" }] })).rejects.toThrow(/2 à 4/);
    await expect(c.comparisons.create({ projectId: project, prompt: "x", write: false, runs: [{ provider: "claude", effort: "ultra" }, { provider: "codex" }] })).rejects.toThrow(/non pris en charge/);
    await expect(c.comparisons.create({ projectId: project, prompt: "x", write: true, runs: [{ provider: "claude" }, { provider: "codex" }] })).rejects.toThrow(/dépôt Git/);
  });
  it("écriture : un worktree Git isolé par version, modifications détectées et conservées", async () => {
    const repo = gitRepo(); const { c, r, project } = mk(); const p2 = c.projects.create({ name: "G", path: repo }); r.writeFile = "nouveau.txt";
    const id = await c.comparisons.create({ projectId: p2, prompt: "Ajoute un fichier", write: true, runs: [{ provider: "claude" }, { provider: "codex" }] }); void project;
    await until(() => c.comparisons.get(id).status === "done"); const g = c.comparisons.get(id); const cwds = r.reqs.map((q) => q.cwd); expect(new Set(cwds).size).toBe(2); expect(cwds.every((d) => d !== repo)).toBe(true);
    expect(g.runs.every((x: any) => x.worktree && x.files.includes("nouveau.txt"))).toBe(true); expect(g.runs[0].changes.files.map((f: any) => f.path)).toContain("nouveau.txt"); expect(existsSync(join(repo, "nouveau.txt"))).toBe(false); // le dépôt principal n'est pas touché
    c.comparisons.remove(id); expect(g.runs[0].worktree && existsSync(g.runs[0].worktree.path)).toBe(true); // jamais de suppression automatique des worktrees
  });
});

describe("Mémoire de projet", () => {
  it("seules les notes épinglées sont injectées, bornées en taille, et visibles", async () => {
    const { c, r, project } = mk(); const a = c.memory.add(project, { title: "Stack", content: "React + SQLite" }); const b = c.memory.add(project, { title: "Secret perso", content: "à ne pas envoyer", pinned: false });
    expect(c.memory.context(project).included.map((x) => x.title)).toEqual(["Stack"]); const e = c.run({ projectId: project, prompt: "x", provider: "claude" }); await until(() => (c.executions.get(e) as any).status === "completed");
    expect(r.reqs[0]!.instructions).toMatch(/Mémoire du projet[\s\S]*Stack : React \+ SQLite/); expect(r.reqs[0]!.instructions).not.toMatch(/Secret perso/); c.memory.update(b, { pinned: true }); c.memory.update(a, { pinned: false });
    expect(c.memory.context(project).included.map((x) => x.title)).toEqual(["Secret perso"]); c.memory.add(project, { title: "Gros", content: "x".repeat(7000) }); expect(c.memory.context(project, 3000).text.length).toBeLessThanOrEqual(3100);
  });
  it("mémoire non injectée en Chat (aucune fuite de contexte projet)", async () => {
    const { c, r, project } = mk(); c.memory.add(project, { title: "Stack", content: "React" }); const id = await c.conversations.create({ mode: "chat", provider: "claude" }); await c.conversations.send(id, "salut"); await until(() => c.conversations.messages(id).length === 2); expect(r.reqs.at(-1)!.instructions ?? "").not.toMatch(/Mémoire/);
  });
});

describe("Détection des fichiers modifiés", () => {
  it("détecte un fichier écrit sans événement fournisseur (écriture via shell)", async () => {
    const { c, r, project } = mk(); r.writeFile = "via-shell.txt"; const e = c.run({ projectId: project, prompt: "x", provider: "codex" }); await until(() => (c.executions.get(e) as any).status === "completed");
    const logs = c.executions.logs(e) as any[]; expect(logs.some((l) => l.kind === "file_change" && l.content.includes("via-shell.txt"))).toBe(true);
  });
  it("Chat : une écriture dans le dossier isolé est détectée, auditée et signalée", async () => {
    const { c, r } = mk(); r.writeFile = "intrus.txt"; const id = await c.conversations.create({ mode: "chat", provider: "claude" }); await c.conversations.send(id, "x"); await until(() => c.audit().some((a: any) => a.type === "policy.violation"));
    expect(JSON.parse(c.audit().find((a: any) => a.type === "policy.violation").payload).filesChanged).toContain("intrus.txt");
  });
  it("empreinte de dossier : ajouts, modifications, suppressions ; ignore node_modules et .git", () => {
    const d = mkdtempSync(join(tmpdir(), "snap-")); writeFileSync(join(d, "a"), "1"); writeFileSync(join(d, "b"), "2"); mkdirSync(join(d, "node_modules")); writeFileSync(join(d, "node_modules", "x"), "x"); const s1 = snapshotDir(d).map;
    writeFileSync(join(d, "a"), "123"); writeFileSync(join(d, "c"), "3"); writeFileSync(join(d, "node_modules", "y"), "y"); expect(diffSnapshots(s1, snapshotDir(d).map)).toEqual(["a", "c"]);
  });
});

describe("Budgets", () => {
  it("notifie quand le budget USD éq. ou projet est dépassé", async () => {
    const { c, project } = mk(); c.settings.set("budget.maxTokensPerProject", 10); const e = c.run({ projectId: project, prompt: "x", provider: "claude" }); await until(() => (c.executions.get(e) as any).status === "completed");
    expect(c.notifications.list().some((n: any) => n.category === "budget" && /projet/i.test(n.title))).toBe(true);
  });
});

describe("MCP, skills, sauvegarde, routeur", () => {
  it("parse la sortie réelle de `claude mcp list`", () => { const l = parseClaudeMcp("Checking MCP server health…\n\nclaude.ai Canva: https://mcp.canva.com/mcp - ✔ Connected\nplugin:firebase:firebase: npx -y firebase-tools@latest mcp --dir . - ✔ Connected\nplugin:canva:canva: https://mcp.canva.com/mcp (HTTP) - ! Needs authentication"); expect(l.map((x) => [x.name, x.transport, x.status])).toEqual([["claude.ai Canva", "http", "Connecté"], ["plugin:firebase:firebase", "stdio", "Connecté"], ["plugin:canva:canva", "http", "Authentification requise"]]); });
  it("parse `codex mcp list --json` sans jamais exposer les valeurs d'environnement", () => { const l = parseCodexMcp(JSON.stringify([{ name: "firebase", enabled: true, transport: { type: "stdio", command: "npx", args: ["-y", "x"], env: { SECRET_KEY: "valeur-secrete" } } }, { name: "off", enabled: false, disabled_reason: "policy", transport: { type: "stdio", command: "n" } }])); expect(l[0]).toMatchObject({ name: "firebase", status: "Activé", envKeys: ["SECRET_KEY"] }); expect(JSON.stringify(l)).not.toMatch(/valeur-secrete/); expect(l[1]!.status).toMatch(/Désactivé/); });
  it("liste les skills depuis leurs SKILL.md (frontmatter)", () => { const home = mkdtempSync(join(tmpdir(), "home-")); mkdirSync(join(home, ".claude", "skills", "revue"), { recursive: true }); writeFileSync(join(home, ".claude", "skills", "revue", "SKILL.md"), "---\nname: revue\ndescription: \"Relit le code\"\n---\ncorps"); mkdirSync(join(home, ".codex", "skills", ".system", "docs"), { recursive: true }); writeFileSync(join(home, ".codex", "skills", ".system", "docs", "SKILL.md"), "---\nname: docs\ndescription: Docs OpenAI\n---\n"); const s = listSkills(home); expect(s.map((x) => [x.provider, x.name, x.description])).toEqual(expect.arrayContaining([["claude", "revue", "Relit le code"], ["codex", "docs", "Docs OpenAI"]])); });
  it("sauvegarde → restauration : la base restaurée contient l'état sauvegardé, l'ancienne est conservée", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bk-")); const c1 = createCore({ dataDir: dir }); const p = c1.projects.create({ name: "Avant", path: dir }); const file = join(dir, "sauvegarde.sqlite"); c1.system.backup(file); expect(inspectBackup(file)).toMatchObject({ ok: true, projects: 1 });
    c1.projects.create({ name: "Après", path: dir }); expect(c1.projects.list()).toHaveLength(2); c1.system.stageRestore(file); await c1.close(); void p;
    const c2 = createCore({ dataDir: dir }); expect(c2.restored).toBe(true); expect(c2.projects.list().map((x: any) => x.name)).toEqual(["Avant"]); expect(all(c2.db, "SELECT 1 FROM schema_migrations").length).toBe(11); await c2.close();
    expect(inspectBackup(join(dir, "n-existe-pas.sqlite")).ok).toBe(false); writeFileSync(join(dir, "faux.sqlite"), "pas une base"); expect(inspectBackup(join(dir, "faux.sqlite")).ok).toBe(false);
  });
  it("routeur : recommande l'autre fournisseur quand le premier est limité, sans jamais forcer ; fournisseur indisponible exclu", async () => {
    const st = (p: ProviderId, ok = true): Promise<ProviderStatus> => Promise.resolve({ provider: p, installed: ok, authenticated: ok, authMode: "subscription", warnings: [], checkedAt: now() });
    const q = (p: ProviderId, pct: number) => Promise.resolve({ provider: p, state: pct >= 100 ? "exhausted" : pct >= 85 ? "limited" : "available", windows: [{ label: "5h", usedPercent: pct, resetsAt: new Date(Date.now() + 3600e3).toISOString() }], checkedAt: now() } as any);
    const db = mk().c.db; const a = await routerAdvice(db, (p) => st(p), (p) => q(p, p === "claude" ? 95 : 10), "claude"); expect(a.providers.claude.limited).toBe(true); expect(a.recommended).toBe("codex"); expect(a.message).toMatch(/basculer sur Codex/);
    const b = await routerAdvice(db, (p) => st(p, p === "claude"), (p) => q(p, 95), "claude"); expect(b.recommended).toBeNull(); expect(b.message).toMatch(/attendez la réinitialisation/); const d = await routerAdvice(db, (p) => st(p), (p) => q(p, 10), "codex"); expect(d.recommended).toBe("codex"); expect(d.message).toBeUndefined();
  });
});
