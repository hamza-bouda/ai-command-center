import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCore } from "../src/service.js";
import { RICH_PROMPT } from "../src/conversations.js";
import { now } from "../src/db.js";
import type { RunRequest, RunHandle, ProviderStatus, ProviderId, ModelInfo } from "../src/types.js";
import type { RunSink } from "../src/providers/common.js";

const MODELS: ModelInfo[] = [{ id: "", displayName: "Défaut", isDefault: true, source: "cli-alias" }];
function mk() {
  const reqs: RunRequest[] = [];
  const adapter = (id: ProviderId): any => ({ id, detectInstallation: async () => ({ installed: true }), getVersion: async () => "0", getSupportedModels: async () => MODELS, getCapabilities: () => ({}), getQuotaStatus: async () => ({ provider: id, state: "unknown", windows: [], checkedAt: now() }),
    getAuthStatus: async (): Promise<ProviderStatus> => ({ provider: id, installed: true, authenticated: true, authMode: "subscription", warnings: [], checkedAt: now() }),
    startSession(req: RunRequest, sink: RunSink): RunHandle { reqs.push(req); const done = new Promise<void>((res) => setTimeout(() => { sink.event({ type: "text", text: "ok", final: true }); sink.event({ type: "done", ok: true, message: "ok" }); res(); }, 20)); return { done, cancel: async () => {} }; },
    resumeSession(q: any, s: any) { return (this as any).startSession(q, s); }, cancelExecution: async () => {}, dispose: async () => {} });
  const dir = mkdtempSync(join(tmpdir(), "rich-")); const c = createCore({ dataDir: dir, dbFile: ":memory:", adapters: { claude: adapter("claude"), codex: adapter("codex") } }); return { c, reqs, dir };
}
const until = async (f: () => boolean) => { const t = Date.now(); while (!f()) { if (Date.now() - t > 6000) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 15)); } };

describe("Réponses enrichies : consigne donnée au modèle", () => {
  it("le prompt décrit les blocs et reste court (coût en tokens)", () => {
    for (const b of ["```quiz", "```choices", "```chart", "```mermaid", "```artifact", "```svg", "$$"]) expect(RICH_PROMPT).toContain(b);
    expect(RICH_PROMPT).toMatch(/AskUserQuestion/); expect(RICH_PROMPT.length).toBeLessThan(2600); // ≈ 650 tokens maximum (la livraison de fichiers en coûte ≈ 200)
  });
  it("ajouté aux modes Chat, Work et Code par défaut ; retiré quand le réglage est désactivé", async () => {
    const { c, reqs, dir } = mk(); const project = c.projects.create({ name: "P", path: dir });
    const chat = await c.conversations.create({ mode: "chat", provider: "claude" }); await c.conversations.send(chat, "a"); await until(() => c.conversations.messages(chat).length === 2); expect(reqs[0]!.instructions).toContain("```quiz");
    const code = await c.conversations.create({ mode: "code", provider: "codex", projectId: project }); await c.conversations.send(code, "b"); await until(() => c.conversations.messages(code).length === 2); expect(reqs[1]!.instructions).toContain("```quiz");
    c.settings.set("ui.richBlocks", false);
    const chat2 = await c.conversations.create({ mode: "chat", provider: "claude" }); await c.conversations.send(chat2, "c"); await until(() => c.conversations.messages(chat2).length === 2); expect(reqs[2]!.instructions ?? "").not.toContain("```quiz"); expect(reqs[2]!.instructions).toMatch(/assistant conversationnel/); // le reste de la consigne du mode est conservé
  });
});
