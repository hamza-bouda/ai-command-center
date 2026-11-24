import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCore } from "../src/service.js";
import { codexConfig, isImagegenSkillRead } from "../src/providers/codex.js";
import { now } from "../src/db.js";
import type { RunRequest, RunHandle, ProviderStatus, ProviderId, ModelInfo, ExecEvent } from "../src/types.js";
import type { RunSink } from "../src/providers/common.js";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]).toString("base64");
const MODELS: ModelInfo[] = [{ id: "", displayName: "Défaut", isDefault: true, source: "cli-alias" }];
function mk(events: ExecEvent[]) {
  const reqs: RunRequest[] = [];
  const adapter = (id: ProviderId): any => ({ id, detectInstallation: async () => ({ installed: true }), getVersion: async () => "0", getSupportedModels: async () => MODELS, getCapabilities: () => ({}), getQuotaStatus: async () => ({ provider: id, state: "unknown", windows: [], checkedAt: now() }),
    getAuthStatus: async (): Promise<ProviderStatus> => ({ provider: id, installed: true, authenticated: true, authMode: "subscription", warnings: [], checkedAt: now() }),
    startSession(req: RunRequest, sink: RunSink): RunHandle { reqs.push(req); let cancelled = false; const done = new Promise<void>((res) => setTimeout(() => { for (const e of events) { if (cancelled) break; sink.event(e); } if (!cancelled) { sink.event({ type: "text", text: "Voici l'image.", final: true }); sink.event({ type: "done", ok: true }); } res(); }, 20)); return { done, cancel: async () => { cancelled = true; } } as any; },
    resumeSession(q: any, s: any) { return (this as any).startSession(q, s); }, cancelExecution: async (h: RunHandle) => h.cancel(), dispose: async () => {} });
  const dir = mkdtempSync(join(tmpdir(), "img-")); const c = createCore({ dataDir: dir, dbFile: ":memory:", adapters: { claude: adapter("claude"), codex: adapter("codex") } }); c.settings.set("ui.richBlocks", false); return { c, reqs, dir };
}
const until = async (f: () => boolean) => { const t = Date.now(); while (!f()) { if (Date.now() - t > 6000) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 15)); } };
const violations = (c: any) => c.audit().filter((a: any) => a.type === "policy.violation");
const IMG: ExecEvent[] = [{ type: "tool", id: "t1", name: "image_generation", summary: "", state: "started" }, { type: "image", id: "exec-abc-123", mime: "image/png", data: PNG, prompt: "un cercle" }, { type: "tool", id: "t1", name: "image_generation", summary: "", state: "completed" }];

describe("Génération d'images (Codex, abonnement)", () => {
  it("activée : l'image est enregistrée dans le dossier de l'application et référencée dans la réponse", async () => {
    const { c, reqs, dir } = mk(IMG); const id = await c.conversations.create({ mode: "chat", provider: "codex", image: true }); expect(c.conversations.get(id).image).toBe(1);
    await c.conversations.send(id, "dessine"); await until(() => c.conversations.messages(id).length === 2);
    const m = c.conversations.messages(id)[1]; expect(m.status).toBe("completed"); expect(violations(c)).toHaveLength(0); expect(reqs[0]!.image).toBe(true);
    const mm = /```image\n(\{.*\})\n```/.exec(m.content); expect(mm).toBeTruthy(); const meta = JSON.parse(mm![1]!); expect(meta.file).toMatch(/^[A-Za-z0-9_-]+\/exec-abc-123\.png$/); expect(meta.prompt).toBe("un cercle");
    expect(existsSync(join(dir, "images", meta.file))).toBe(true); expect(readFileSync(join(dir, "images", meta.file)).subarray(0, 4).toString("hex")).toBe("89504e47");
    expect(reqs[0]!.instructions).toMatch(/générer des images avec l'outil/);
  });
  it("désactivée : l'outil d'image est interrompu et journalisé ; la consigne interdit d'en prétendre", async () => {
    const { c, reqs } = mk(IMG); const id = await c.conversations.create({ mode: "chat", provider: "codex" }); await c.conversations.send(id, "dessine"); await until(() => violations(c).length > 0);
    expect(reqs[0]!.image).toBe(false); expect(reqs[0]!.instructions).toMatch(/ne peux pas générer d'images/);
  });
  it("Claude : impossible à activer (pas d'outil d'image) ; réservé au Chat ; journalisé", async () => {
    const { c } = mk(IMG); const a = await c.conversations.create({ mode: "chat", provider: "claude" }); expect(() => c.conversations.setImage(a, true)).toThrow(/Codex/);
    const b = await c.conversations.create({ mode: "chat", provider: "codex" }); c.conversations.setImage(b, true); c.conversations.setImage(b, false); expect(c.conversations.get(b).image).toBe(0);
  });
  it("une image qui n'est pas un PNG est refusée (rien n'est écrit)", async () => {
    const { c, dir } = mk([{ type: "tool", id: "t", name: "image_generation", summary: "", state: "started" }, { type: "image", id: "x", mime: "image/png", data: Buffer.from("pas une image du tout").toString("base64") }]);
    const id = await c.conversations.create({ mode: "chat", provider: "codex", image: true }); await c.conversations.send(id, "x"); await until(() => c.conversations.messages(id).length === 2);
    expect(c.conversations.messages(id)[1].content).not.toContain("```image"); expect(existsSync(join(dir, "images"))).toBe(false);
  });
  it("Codex : la fonction est coupée explicitement en Chat sauf activation ; la lecture de la fiche imagegen est la seule lecture tolérée", () => {
    const b = (o: Partial<RunRequest> = {}): RunRequest => ({ executionId: "e", prompt: "p", cwd: "/", permission: "read-only", approvalPolicy: "never", policy: "chat", ...o } as any);
    expect((codexConfig(b()) as any).features).toEqual({ image_generation: false }); expect((codexConfig(b({ image: true })) as any).features).toEqual({ image_generation: true }); expect(codexConfig(b({ policy: "code" }))).toBeUndefined();
    const read = (p: string) => ({ commandActions: [{ type: "read", path: p }] });
    const SK = String.raw`C:\Users\x\.codex\skills\.system\imagegen\SKILL.md`; const AUTH = String.raw`C:\Users\x\.codex\auth.json`; const TRAV = String.raw`C:\Users\x\.codex\skills\.system\imagegen\..\..\..\auth.json`;
    expect(isImagegenSkillRead(read(SK))).toBe(true);
    expect(isImagegenSkillRead(read(AUTH))).toBe(false); expect(isImagegenSkillRead(read(TRAV))).toBe(false);
    expect(isImagegenSkillRead({ commandActions: [{ type: "unknown", path: SK }] })).toBe(false); expect(isImagegenSkillRead({})).toBe(false);
  });
});
