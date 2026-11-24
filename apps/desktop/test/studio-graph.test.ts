import { describe, it, expect } from "vitest";
import { slugKey, wouldCycle, toPlan, removeNode, roots, autoLayout, edgesOf, type SNode } from "../src/renderer/studio/graph";

const n = (key: string, dependsOn: string[] = []): SNode => ({ key, title: key, role: "fullstack", kind: "agent", dependsOn });
describe("éditeur graphique : fonctions pures", () => {
  it("clés valides et uniques", () => {
    expect(slugKey("Développement été", [])).toBe("developpement-ete"); expect(slugKey("Tests", ["tests"])).toBe("tests-2"); expect(slugKey("???", [])).toBe("etape"); expect(slugKey("a".repeat(80), [])).toMatch(/^[a-z0-9-]{1,24}$/);
  });
  it("refuse un lien qui créerait un cycle ou une boucle", () => {
    const e = edgesOf([n("a"), n("b", ["a"]), n("c", ["b"])]); expect(wouldCycle(e, "c", "a")).toBe(true); expect(wouldCycle(e, "a", "a")).toBe(true); expect(wouldCycle(e, "a", "c")).toBe(false); expect(wouldCycle(e, "b", "a")).toBe(true);
  });
  it("le plan est reconstruit depuis les liens (sans doublon ni lien vers un nœud absent)", () => {
    const p = toPlan([n("a"), n("b", ["zzz"])], [{ source: "a", target: "b" }, { source: "a", target: "b" }, { source: "ghost", target: "b" }, { source: "b", target: "b" }]); expect(p[1]!.dependsOn).toEqual(["a"]); expect(p[0]!.dependsOn).toEqual([]);
  });
  it("supprimer un nœud retire les dépendances qui le visaient ; les racines sont lancées en premier", () => {
    const l = removeNode([n("a"), n("b", ["a"]), n("c", ["a", "b"])], "a"); expect(l.map((x) => x.dependsOn)).toEqual([[], ["b"]]); expect(roots(l)).toEqual(["b"]);
  });
  it("disposition : colonnes par profondeur, sans chevauchement", () => {
    const pos = autoLayout([n("a"), n("b", ["a"]), n("c", ["a"]), n("d", ["b", "c"])]); expect(pos.get("a")!.x).toBe(0); expect(pos.get("b")!.x).toBe(pos.get("c")!.x); expect(pos.get("b")!.y).not.toBe(pos.get("c")!.y); expect(pos.get("d")!.x).toBeGreaterThan(pos.get("b")!.x);
  });
});

describe("disposition verticale", () => {
  it("TB : profondeur vers le bas, branches côte à côte", () => {
    const pos = autoLayout([n("a"), n("b", ["a"]), n("c", ["a"]), n("d", ["b", "c"])], 230, 130, "TB");
    expect(pos.get("a")!.y).toBe(0); expect(pos.get("b")!.y).toBe(pos.get("c")!.y); expect(pos.get("b")!.x).not.toBe(pos.get("c")!.x); expect(pos.get("d")!.y).toBeGreaterThan(pos.get("b")!.y);
  });
});
