import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCore } from "../src/service.js";
import { chunkText, ftsQuery, KB_MAX_DOCS, KB_CONTEXT_CHARS } from "../src/knowledge.js";
import { now, all } from "../src/db.js";
import type { RunRequest, RunHandle, ProviderStatus, ProviderId, ModelInfo } from "../src/types.js";
import type { RunSink } from "../src/providers/common.js";

const MODELS: ModelInfo[] = [{ id: "", displayName: "Défaut", isDefault: true, source: "cli-alias" }];
function mk() {
  const reqs: RunRequest[] = [];
  const adapter = (id: ProviderId): any => ({ id, detectInstallation: async () => ({ installed: true }), getVersion: async () => "0", getSupportedModels: async () => MODELS, getCapabilities: () => ({}), getQuotaStatus: async () => ({ provider: id, state: "unknown", windows: [], checkedAt: now() }),
    getAuthStatus: async (): Promise<ProviderStatus> => ({ provider: id, installed: true, authenticated: true, authMode: "subscription", warnings: [], checkedAt: now() }),
    startSession(req: RunRequest, sink: RunSink): RunHandle { reqs.push(req); const done = new Promise<void>((res) => setTimeout(() => { sink.event({ type: "text", text: "ok", final: true }); sink.event({ type: "done", ok: true }); res(); }, 15)); return { done, cancel: async () => {} } as any; },
    resumeSession(q: any, s: any) { return (this as any).startSession(q, s); }, cancelExecution: async (h: RunHandle) => h.cancel(), dispose: async () => {} });
  return { c: createCore({ dataDir: mkdtempSync(join(tmpdir(), "kb-")), dbFile: ":memory:", adapters: { claude: adapter("claude"), codex: adapter("codex") } }), reqs };
}
const until = async (f: () => boolean) => { const t = Date.now(); while (!f()) { if (Date.now() - t > 6000) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 15)); } };
const DOC = ["# Rapport logistique", "Les entrepôts de Lyon traitent 1200 palettes par jour. Le café est livré chaque lundi.", "## Sécurité", "Le port du casque est obligatoire dans la zone de chargement. Les chariots élévateurs sont limités à 10 km/h.", "## Budget", "Le budget annuel de maintenance est de 45 000 euros."].join("\n\n");

describe("Bases de connaissances", () => {
  it("découpage : extraits bornés, rien de perdu", () => {
    const big = Array.from({ length: 80 }, (_, i) => `Paragraphe ${i} ` + "mot ".repeat(60)).join("\n\n"); const ch = chunkText(big); expect(ch.length).toBeGreaterThan(5); expect(Math.max(...ch.map((c) => c.length))).toBeLessThanOrEqual(1700); expect(ch.join(" ")).toContain("Paragraphe 79");
    expect(chunkText("x".repeat(5000)).length).toBeGreaterThan(3);
  });
  it("requête FTS : sans accents, sans mots vides, injection impossible", () => {
    expect(ftsQuery("Quel est le café du lundi ?")).toBe('"cafe"* OR "lundi"*'); expect(ftsQuery('a" OR 1=1 --')).not.toContain("1=1"); expect(ftsQuery("le la les")).toBe("");
  });
  it("recherche par mots-clés (accents ignorés), suppression d'un document retire ses extraits", () => {
    const { c } = mk(); const kb = c.knowledge.create("Logistique"); const d = c.knowledge.addDoc(kb, "rapport.md", DOC);
    expect(c.knowledge.search(kb, "budget de maintenance")[0]!.text).toMatch(/45 000/); expect(c.knowledge.search(kb, "CAFÉ lundi")[0]!.docName).toBe("rapport.md"); expect(c.knowledge.search(kb, "kangourou")).toHaveLength(0);
    c.knowledge.removeDoc(d.id); expect(c.knowledge.search(kb, "budget")).toHaveLength(0); expect(all(c.db, "SELECT 1 FROM kb_fts WHERE kb_id=?", kb)).toHaveLength(0);
  });
  it("limites : nom unique, document vide, nombre de documents", () => {
    const { c } = mk(); const kb = c.knowledge.create("A"); expect(() => c.knowledge.create("a")).toThrow(/déjà/); expect(() => c.knowledge.create("  ")).toThrow(/nom/); expect(() => c.knowledge.addDoc(kb, "v", "x")).toThrow(/vide/); expect(() => c.knowledge.addDoc("nope", "v", DOC)).toThrow(/introuvable/);
    for (let i = 0; i < KB_MAX_DOCS; i++) c.knowledge.addDoc(kb, `d${i}`, DOC + i); expect(() => c.knowledge.addDoc(kb, "de trop", DOC)).toThrow(/maximum/);
  });
  it("extraits pertinents seulement, budget borné, ajoutés à la consigne de la conversation reliée", async () => {
    const { c, reqs } = mk(); const kb = c.knowledge.create("Logistique"); for (let i = 0; i < 20; i++) c.knowledge.addDoc(kb, `doc${i}.md`, `Document ${i}. ` + "Les chariots élévateurs sont limités. ".repeat(40));
    const id = await c.conversations.create({ mode: "chat", provider: "claude" }); c.conversations.setKb(id, kb);
    await c.conversations.send(id, "Quelle est la limite de vitesse des chariots ?"); await until(() => c.conversations.messages(id).length === 2);
    const ins = reqs[0]!.instructions!; expect(ins).toMatch(/Extraits de la base de connaissances « Logistique »/); expect(ins).toMatch(/chariots/); expect(ins.length).toBeLessThan(KB_CONTEXT_CHARS + 4000);
    c.conversations.setKb(id, null); await c.conversations.send(id, "chariots ?"); await until(() => c.conversations.messages(id).length === 4); expect(reqs[1]!.instructions ?? "").not.toMatch(/Extraits de la base/);
  });
  it("aucun extrait pertinent : la consigne le dit au lieu d'inventer ; suppression de la base détache les conversations ; branche conserve la base", async () => {
    const { c, reqs } = mk(); const kb = c.knowledge.create("Logistique"); c.knowledge.addDoc(kb, "r.md", DOC); const id = await c.conversations.create({ mode: "chat", provider: "claude" }); c.conversations.setKb(id, kb);
    await c.conversations.send(id, "Parle-moi des kangourous"); await until(() => c.conversations.messages(id).length === 2); expect(reqs[0]!.instructions).toMatch(/aucun extrait ne correspond/);
    const br = await c.conversations.branchFrom(id, c.conversations.messages(id)[0].id, "Et le budget ?"); await until(() => c.conversations.messages(br.id).length === 2); expect(c.conversations.get(br.id).kb_id).toBe(kb);
    c.knowledge.remove(kb); expect(c.conversations.get(id).kb_id).toBeNull(); expect(c.knowledge.list()).toHaveLength(0); expect(() => c.conversations.setKb(id, kb)).toThrow(/introuvable/);
  });
});
