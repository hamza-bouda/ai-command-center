import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCore } from "../src/service.js";
import { MEMORY_MAX_ITEMS } from "../src/usermemory.js";
import { now } from "../src/db.js";
import type { RunRequest, RunHandle, ProviderStatus, ProviderId, ModelInfo } from "../src/types.js";
import type { RunSink } from "../src/providers/common.js";

const MODELS: ModelInfo[] = [{ id: "", displayName: "Défaut", isDefault: true, source: "cli-alias" }];
function mk() {
  const reqs: RunRequest[] = [];
  const adapter = (id: ProviderId): any => ({ id, detectInstallation: async () => ({ installed: true }), getVersion: async () => "0", getSupportedModels: async () => MODELS, getCapabilities: () => ({}), getQuotaStatus: async () => ({ provider: id, state: "unknown", windows: [], checkedAt: now() }),
    getAuthStatus: async (): Promise<ProviderStatus> => ({ provider: id, installed: true, authenticated: true, authMode: "subscription", warnings: [], checkedAt: now() }),
    startSession(req: RunRequest, sink: RunSink): RunHandle { reqs.push(req); const done = new Promise<void>((res) => setTimeout(() => { sink.event({ type: "text", text: "ok", final: true }); sink.event({ type: "done", ok: true }); res(); }, 15)); return { done, cancel: async () => {} } as any; },
    resumeSession(q: any, s: any) { return (this as any).startSession(q, s); }, cancelExecution: async (h: RunHandle) => h.cancel(), dispose: async () => {} });
  return { c: createCore({ dataDir: mkdtempSync(join(tmpdir(), "um-")), dbFile: ":memory:", adapters: { claude: adapter("claude"), codex: adapter("codex") } }), reqs };
}
const until = async (f: () => boolean) => { const t = Date.now(); while (!f()) { if (Date.now() - t > 6000) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 15)); } };

describe("Mémoire de l'utilisateur (validée par lui)", () => {
  it("ajout, doublon ignoré, suppression, limites", () => {
    const { c } = mk(); const m = c.userMemory; expect(m.add("Je préfère les réponses courtes.").duplicate).toBe(false); expect(m.add("  je préfère   les réponses COURTES. ").duplicate).toBe(true); expect(m.list()).toHaveLength(1);
    expect(() => m.add("ab")).toThrow(/trop court/); expect(m.add("x".repeat(500)).duplicate).toBe(false); expect(m.list().find((i) => i.text.startsWith("xxx"))!.text.length).toBe(280);
    for (let i = 0; i < MEMORY_MAX_ITEMS; i++) { try { m.add(`souvenir numéro ${i}`); } catch { break; } } expect(m.list().length).toBe(MEMORY_MAX_ITEMS); expect(() => m.add("un de trop")).toThrow(/maximum/);
    m.remove(m.list()[0]!.id); expect(m.list().length).toBe(MEMORY_MAX_ITEMS - 1); m.clear(); expect(m.list()).toHaveLength(0);
  });
  it("injectée dans la consigne de chaque mode, avec la consigne d'en proposer ; coupée si désactivée", async () => {
    const { c, reqs } = mk(); c.userMemory.add("Je travaille dans la logistique."); const id = await c.conversations.create({ mode: "chat", provider: "claude" });
    await c.conversations.send(id, "bonjour"); await until(() => c.conversations.messages(id).length === 2);
    expect(reqs[0]!.instructions).toMatch(/Je travaille dans la logistique/); expect(reqs[0]!.instructions).toMatch(/```memory/);
    c.userMemory.setEnabled(false); await c.conversations.send(id, "encore"); await until(() => c.conversations.messages(id).length === 4);
    expect(reqs[1]!.instructions).not.toMatch(/logistique/); expect(reqs[1]!.instructions).not.toMatch(/```memory/);
  });
  it("jamais de souvenir enregistré sans action explicite : un message de l'IA ne modifie pas la mémoire", async () => {
    const { c } = mk(); const id = await c.conversations.create({ mode: "chat", provider: "claude" }); await c.conversations.send(id, "retiens que j'aime le thé"); await until(() => c.conversations.messages(id).length === 2); expect(c.userMemory.list()).toHaveLength(0);
  });
  it("coût borné : l'injection ne dépasse pas ≈ 450 tokens", () => {
    const { c } = mk(); for (let i = 0; i < 40; i++) c.userMemory.add(`${i} ` + "mot ".repeat(60)); expect(c.userMemory.textFor().length).toBeLessThanOrEqual(1900); expect(c.userMemory.tokens()).toBeLessThanOrEqual(480);
  });
});
