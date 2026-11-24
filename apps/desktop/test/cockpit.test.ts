import { describe, it, expect } from "vitest";
import { toLines } from "../src/renderer/components/AgentCockpit";

const L = (id: number, kind: string, content: string) => ({ id, kind, content });
describe("cockpit : lignes du terminal d'un agent", () => {
  it("regroupe le texte, suit l'état d'une commande, liste les fichiers et les erreurs", () => {
    const lines = toLines([L(1, "text", "Bonjour "), L(2, "text", "monde"), L(3, "tool", JSON.stringify({ id: "t1", name: "shell", summary: "npm test", state: "started" })), L(4, "tool", JSON.stringify({ id: "t1", name: "shell", summary: "npm test", state: "completed" })),
      L(5, "file_change", JSON.stringify(["a.ts", "b.ts"])), L(6, "status", "thread 1"), L(7, "error", "boom")]);
    expect(lines.map((l) => l.kind)).toEqual(["out", "cmd", "file", "file", "dim", "err"]); expect(lines[0]!.text).toBe("Bonjour monde"); expect(lines[1]!.state).toBe("completed"); expect(lines[1]!.text).toBe("shell npm test");
  });
  it("tolère les journaux illisibles ou vides", () => {
    expect(toLines(undefined)).toEqual([]); expect(toLines([L(1, "tool", "{pas du json"), L(2, "file_change", "oups"), L(3, "status", "")])).toEqual([]);
  });
});
