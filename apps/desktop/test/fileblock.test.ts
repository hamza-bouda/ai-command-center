import { describe, it, expect } from "vitest";
import { parseFileBlock, notebookNote } from "../src/renderer/components/FileBlock";

describe("fichier livré par l'IA : bloc « file »", () => {
  it("nom puis contenu intégral (avec ou sans séparateur)", () => {
    expect(parseFileBlock('name: analyse.ipynb\n{"cells":[]}')).toEqual({ name: "analyse.ipynb", content: '{"cells":[]}' });
    expect(parseFileBlock("nom = données.csv\n---\na,b\n1,2")).toEqual({ name: "données.csv", content: "a,b\n1,2" });
  });
  it("nom nettoyé : jamais de chemin, de caractères interdits ni de nom vide", () => {
    expect((parseFileBlock("name: ../../etc/passwd\nx") as any).name).toBe("passwd");
    expect((parseFileBlock(String.raw`name: C:\Users\x\a<b>.txt` + "\nx") as any).name).toBe("a_b_.txt");
    expect((parseFileBlock('name: "quoted.py"\nx') as any).name).toBe("quoted.py");
    for (const bad of ["x", "name:\nx", "name: ..\nx", "name: .\nx"]) expect(typeof parseFileBlock(bad)).toBe("string");
  });
  it("résumé d'un notebook : valide, sans cellules, ou tronqué", () => {
    expect(notebookNote(JSON.stringify({ cells: [1, 2, 3], nbformat: 4 }))).toMatch(/3 cellule/);
    expect(notebookNote('{"a":1}')).toMatch(/pas un notebook/);
    expect(notebookNote('{"cells":[')).toMatch(/invalide/);
  });
});
