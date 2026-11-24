/** Fonctions pures de l'éditeur graphique : conversion plan ⇄ graphe, clés, cycles. Testées sans interface. */
export type Kind = "agent" | "approval" | "test" | "notification";
export interface SNode { key: string; title: string; description?: string; role: string; provider?: "claude" | "codex"; dependsOn: string[]; kind: Kind; gate?: boolean; command?: string; pos?: { x: number; y: number } }
export interface SEdge { source: string; target: string }
export const MAX_NODES = 12;

/** Clé stable et valide (lettres, chiffres, - et _), unique parmi `taken`. */
export function slugKey(title: string, taken: Iterable<string>): string {
  const used = new Set(taken); const base = (title.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24)) || "etape";
  if (!used.has(base)) return base; for (let i = 2; i < 100; i++) { const k = `${base}-${i}`; if (!used.has(k)) return k; } return `${base}-${Date.now()}`;
}
export const edgesOf = (nodes: SNode[]): SEdge[] => nodes.flatMap((n) => n.dependsOn.map((d) => ({ source: d, target: n.key })));
/** Ajouter source → cible créerait-il un cycle (ou une boucle sur soi-même) ? */
export function wouldCycle(edges: SEdge[], source: string, target: string): boolean {
  if (source === target) return true; const next = new Map<string, string[]>(); for (const e of edges) next.set(e.source, [...(next.get(e.source) ?? []), e.target]);
  const seen = new Set<string>(); const stack = [target]; while (stack.length) { const k = stack.pop()!; if (k === source) return true; if (seen.has(k)) continue; seen.add(k); stack.push(...(next.get(k) ?? [])); } return false;
}
/** Reconstruit le plan à partir des nœuds et des liens du canevas (les dépendances viennent uniquement des liens). */
export function toPlan(nodes: SNode[], edges: SEdge[]): SNode[] {
  const keys = new Set(nodes.map((n) => n.key));
  return nodes.map((n) => ({ ...n, dependsOn: [...new Set(edges.filter((e) => e.target === n.key && keys.has(e.source) && e.source !== n.key).map((e) => e.source))] }));
}
export const removeNode = (nodes: SNode[], key: string): SNode[] => nodes.filter((n) => n.key !== key).map((n) => ({ ...n, dependsOn: n.dependsOn.filter((d) => d !== key) }));
/** Nœuds sans prédécesseur : ceux que l'orchestrateur lance en premier. */
export const roots = (nodes: SNode[]): string[] => nodes.filter((n) => n.dependsOn.length === 0).map((n) => n.key);
/** Positions manquantes : disposition en colonnes par profondeur (gauche → droite). */
export function autoLayout(nodes: SNode[], dx = 290, dy = 150): Map<string, { x: number; y: number }> {
  const depth = new Map<string, number>(); const by = new Map(nodes.map((n) => [n.key, n])); const d = (k: string, guard = 0): number => { if (depth.has(k)) return depth.get(k)!; if (guard > 30) return 0; const n = by.get(k); const v = !n || !n.dependsOn.length ? 0 : 1 + Math.max(...n.dependsOn.map((p) => d(p, guard + 1))); depth.set(k, v); return v; };
  const cols = new Map<number, string[]>(); for (const n of nodes) { const v = d(n.key); cols.set(v, [...(cols.get(v) ?? []), n.key]); }
  const out = new Map<string, { x: number; y: number }>(); for (const [c, ks] of cols) ks.forEach((k, i) => out.set(k, { x: c * dx, y: (i - (ks.length - 1) / 2) * dy })); return out;
}
