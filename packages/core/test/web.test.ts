import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCore } from "../src/service.js";
import { buildClaudeArgs } from "../src/providers/claude.js";
import { codexConfig } from "../src/providers/codex.js";
import { now, all } from "../src/db.js";
import type { RunRequest, RunHandle, ProviderStatus, ProviderId, ModelInfo } from "../src/types.js";
import type { RunSink } from "../src/providers/common.js";

const base = (o: Partial<RunRequest> = {}): RunRequest => ({ executionId: "e1", prompt: "p", cwd: "/", permission: "read-only", approvalPolicy: "never", policy: "chat", ...o } as any);
const flag = (a: string[], f: string) => { const i = a.indexOf(f); return i < 0 ? undefined : a[i + 1]; };

describe("Recherche web en Chat : arguments des fournisseurs", () => {
  it("Claude : sans web, aucun outil ; avec web, uniquement WebSearch et WebFetch (et toujours le reste isolé)", () => {
    const off = buildClaudeArgs(base()); expect(flag(off, "--tools")).toBe(""); expect(off).not.toContain("--allowedTools"); expect(off).toEqual(expect.arrayContaining(["--strict-mcp-config", "--disable-slash-commands"]));
    const on = buildClaudeArgs(base({ web: true })); expect(flag(on, "--tools")).toBe("WebSearch,WebFetch"); expect(on.slice(on.indexOf("--allowedTools") + 1, on.indexOf("--allowedTools") + 3)).toEqual(["WebSearch", "WebFetch"]); expect(on).toEqual(expect.arrayContaining(["--strict-mcp-config", "--disable-slash-commands"]));
  });
  it("Claude : MCP et web fusionnent dans une seule liste autorisée ; hors Chat, `web` est sans effet", () => {
    const a = buildClaudeArgs(base({ web: true, mcp: [{ name: "demo", transport: "stdio", command: "node", args: [] }] as any })); expect(a.filter((x) => x === "--allowedTools")).toHaveLength(1); const i = a.indexOf("--allowedTools"); expect(a.slice(i + 1, i + 4)).toEqual(["mcp__demo", "WebSearch", "WebFetch"]);
    const code = buildClaudeArgs(base({ policy: "code", web: true })); expect(code).not.toContain("--tools"); expect(code).not.toContain("--allowedTools");
  });
  it("Codex : en Chat la recherche est explicitement « disabled » sauf activation (« live »), jamais forcée ailleurs", () => {
    expect(codexConfig(base())).toEqual({ web_search: "disabled", features: { image_generation: false } }); expect(codexConfig(base({ web: true }))).toEqual({ web_search: "live", features: { image_generation: false } }); expect(codexConfig(base({ policy: "code" }))).toBeUndefined();
    const m = codexConfig(base({ web: true, mcp: [{ name: "d", transport: "stdio", command: "node", args: [] }] as any }))!; expect(m.web_search).toBe("live"); expect(Object.keys(m.mcp_servers as object)).toEqual(["d"]);
  });
});

const MODELS: ModelInfo[] = [{ id: "", displayName: "Défaut", isDefault: true, source: "cli-alias" }];
function mk(tool: string) {
  const reqs: RunRequest[] = [];
  const adapter = (id: ProviderId): any => ({ id, detectInstallation: async () => ({ installed: true }), getVersion: async () => "0", getSupportedModels: async () => MODELS, getCapabilities: () => ({}), getQuotaStatus: async () => ({ provider: id, state: "unknown", windows: [], checkedAt: now() }),
    getAuthStatus: async (): Promise<ProviderStatus> => ({ provider: id, installed: true, authenticated: true, authMode: "subscription", warnings: [], checkedAt: now() }),
    startSession(req: RunRequest, sink: RunSink): RunHandle { reqs.push(req); let cancelled = false; const done = new Promise<void>((res) => setTimeout(() => { sink.event({ type: "tool", id: "t", name: tool, summary: "{}", state: "started" }); setTimeout(() => { if (cancelled) return res(); sink.event({ type: "text", text: "ok", final: true }); sink.event({ type: "done", ok: true, message: "ok" }); res(); }, 120); }, 20)); return { done, cancel: async () => { cancelled = true; sink.event({ type: "done", ok: false, message: "Annulé" }); } }; },
    resumeSession(q: any, s: any) { return (this as any).startSession(q, s); }, cancelExecution: async (h: RunHandle) => h.cancel(), dispose: async () => {} });
  const c = createCore({ dataDir: mkdtempSync(join(tmpdir(), "web-")), dbFile: ":memory:", adapters: { claude: adapter("claude"), codex: adapter("codex") } }); c.settings.set("ui.richBlocks", false); return { c, reqs };
}
const until = async (f: () => boolean) => { const t = Date.now(); while (!f()) { if (Date.now() - t > 6000) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 15)); } };
const violations = (c: any) => c.audit().filter((a: any) => a.type === "policy.violation");

describe("Recherche web en Chat : activation par conversation et moniteur", () => {
  it("activée : l'outil de recherche est autorisé, la requête porte `web` et la consigne l'annonce", async () => {
    const { c, reqs } = mk("WebSearch"); const id = await c.conversations.create({ mode: "chat", provider: "claude", web: true }); expect(c.conversations.get(id).web).toBe(1); await c.conversations.send(id, "actu ?"); await until(() => c.conversations.messages(id).length === 2);
    expect(reqs[0]!.web).toBe(true); expect(reqs[0]!.instructions).toMatch(/recherche web est activée/); expect(violations(c)).toHaveLength(0); expect(c.conversations.messages(id)[1].status).toBe("completed");
  });
  it("désactivée : le même outil est interrompu et journalisé ; un autre outil (Bash) l'est aussi quand le web est activé", async () => {
    const off = mk("WebSearch"); const a = await off.c.conversations.create({ mode: "chat", provider: "claude" }); await off.c.conversations.send(a, "x"); await until(() => violations(off.c).length > 0); await until(() => off.c.conversations.messages(a).length === 2); expect(off.c.conversations.messages(a)[1].content).toMatch(/« WebSearch ».*Recherche web/s); expect(off.reqs[0]!.web).toBe(false); expect(off.reqs[0]!.instructions).toMatch(/aucun outil/);
    const on = mk("Bash"); const b = await on.c.conversations.create({ mode: "chat", provider: "claude", web: true }); await on.c.conversations.send(b, "x"); await until(() => violations(on.c).length > 0); // le web n'ouvre pas la porte aux autres outils
  });
  it("Codex : l'élément webSearch est autorisé seulement si activé ; setWeb bascule, réservé au Chat, journalisé", async () => {
    const { c, reqs } = mk("webSearch"); const id = await c.conversations.create({ mode: "chat", provider: "codex" }); c.conversations.setWeb(id, true); await c.conversations.send(id, "actu ?"); await until(() => c.conversations.messages(id).length === 2); expect(violations(c)).toHaveLength(0); expect(reqs[0]!.web).toBe(true);
    c.conversations.setWeb(id, false); expect(c.conversations.get(id).web).toBe(0); expect(all<any>(c.db, "SELECT detail FROM conversation_config_history WHERE conversation_id=? AND kind='web'", id).length).toBe(2);
    const proj = c.projects.create({ name: "P", path: tmp() }); const code = await c.conversations.create({ mode: "code", provider: "claude", projectId: proj }); expect(() => c.conversations.setWeb(code, true)).toThrow(/uniquement dans le Chat/); expect(() => c.conversations.setWeb("nope", true)).toThrow(/introuvable/);
  });
  it("une branche conserve l'activation du web", async () => {
    const { c } = mk("WebSearch"); const id = await c.conversations.create({ mode: "chat", provider: "claude", web: true }); await c.conversations.send(id, "a"); await until(() => c.conversations.messages(id).length === 2);
    const r = await c.conversations.branchFrom(id, c.conversations.messages(id)[0].id, "b"); await until(() => c.conversations.messages(r.id).length === 2); expect(c.conversations.get(r.id).web).toBe(1);
  });
});
const tmp = () => mkdtempSync(join(tmpdir(), "wp-"));
