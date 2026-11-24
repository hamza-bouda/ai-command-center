import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCore } from "../src/index.js";

describe("sauvegarde", () => {
  it("retire les secrets MCP de la copie mais pas de la base vivante", () => {
    const dir = mkdtempSync(join(tmpdir(), "acc-bk-")); const c = createCore({ dataDir: dir, scheduler: false });
    c.extensions.addMcp({ name: "srv", config: { transport: "stdio", command: "node", args: [], env: { API_KEY: "sk-secret" } }, modes: ["code"] });
    const out = join(dir, "b.sqlite"); const r = c.system.backup(out);
    expect(r.stripped).toBe(1);
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const d = new DatabaseSync(out); const cfg = JSON.parse((d.prepare("SELECT config FROM extensions").get() as any).config); d.close();
    expect(cfg.env).toEqual({ API_KEY: "" }); expect(JSON.stringify(cfg)).not.toContain("sk-secret");
    expect(c.system.backup(join(dir, "b2.sqlite")).stripped).toBe(1); // la base vivante garde sa valeur : la 2e copie retire encore 1 secret
  });
  it("sauvegarde automatique : une par semaine, 5 conservées", () => {
    const dir = mkdtempSync(join(tmpdir(), "acc-bk-")); const c = createCore({ dataDir: dir, scheduler: false });
    const first = c.system.autoBackup(); expect(first && existsSync(first)).toBeTruthy();
    expect(c.system.autoBackup()).toBeNull();
    for (let i = 0; i < 7; i++) { const f = c.system.autoBackup(); if (f) { /* vieillit pour forcer la suivante */ } for (const n of readdirSync(join(dir, "backups"))) utimesSync(join(dir, "backups", n), new Date(Date.now() - 9 * 86400000), new Date(Date.now() - (9 + i) * 86400000)); c.system.autoBackup(); }
    expect(readdirSync(join(dir, "backups")).length).toBeLessThanOrEqual(5);
  });
  it("refuse une sauvegarde d'une version plus récente", () => {
    const dir = mkdtempSync(join(tmpdir(), "acc-bk-")); const c = createCore({ dataDir: dir, scheduler: false });
    const out = join(dir, "b.sqlite"); c.system.backup(out);
    expect(c.system.inspectBackup(out).ok).toBe(true);
  });
});
