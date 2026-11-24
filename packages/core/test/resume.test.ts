import { describe, it, expect } from "vitest";
import { createCore } from "../src/service.js";
import { resumeArgs } from "../src/terminal.js";
import { run, uid, now } from "../src/db.js";

describe("reprise de session dans un terminal", () => {
  it("arguments officiels, identifiant strictement validé", () => {
    expect(resumeArgs("claude", "0123abcd-4567-89ef")).toEqual(["--resume", "0123abcd-4567-89ef"]); expect(resumeArgs("codex", "01a20ebb-9c4b-71e0-9a1c-effa120adf75")).toEqual(["resume", "01a20ebb-9c4b-71e0-9a1c-effa120adf75"]);
    for (const bad of ["", "abc", "x; rm -rf /", "a b c d e f g h", "--last", "../../etc/passwd", "id\nnext"]) expect(() => resumeArgs("claude", bad)).toThrow(/invalide/);
    expect(() => resumeArgs("shell", "0123abcd-4567-89ef")).toThrow(/shell/);
  });
});
describe("journal d'exécution : fin seulement", () => {
  it("renvoie les N dernières lignes dans l'ordre, borné", () => {
    const c = createCore({ dataDir: "x", dbFile: ":memory:" }); const pid = c.projects.create({ name: "P", path: process.cwd() });
    const ex = uid(); run(c.db, "INSERT INTO agent_executions (id,project_id,provider,prompt,cwd,status,attempt,priority,created_at) VALUES (?,?,?,?,?,?,?,?,?)", ex, pid, "claude", "p", process.cwd(), "completed", 1, 5, now());
    for (let i = 1; i <= 60; i++) run(c.db, "INSERT INTO exec_logs (execution_id,kind,content,at) VALUES (?,?,?,?)", ex, "text", `l${i}`, now());
    const t = c.executions.logs(ex, 0, 5) as any[]; expect(t.map((r) => r.content)).toEqual(["l56", "l57", "l58", "l59", "l60"]); expect((c.executions.logs(ex, 0) as any[]).length).toBe(60); expect((c.executions.logs(ex, 0, 9999) as any[]).length).toBe(60);
  });
});
