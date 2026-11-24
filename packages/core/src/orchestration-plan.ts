import { AGENT_TEMPLATES } from "./templates.js";

export type NodeKind = "agent" | "approval" | "test" | "notification";
export const NODE_KINDS: NodeKind[] = ["agent", "approval", "test", "notification"];
export interface PlanNode { key: string; title: string; description?: string; role: string; provider?: "claude" | "codex"; dependsOn: string[]; kind: NodeKind; gate?: boolean; /** commande du nœud « test » (exécutée dans le projet) */ command?: string; /** position dans l'éditeur graphique (sans effet sur l'exécution) */ pos?: { x: number; y: number } }
export interface Plan { summary?: string; tasks: PlanNode[] }
export interface PlanCheck { ok: boolean; errors: string[]; warnings: string[]; plan?: Plan; order?: string[] }
export const MAX_TASKS = 12;
const cleanPos = (p: any): { x: number; y: number } | undefined => (p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: Math.round(Math.max(-20000, Math.min(20000, p.x))), y: Math.round(Math.max(-20000, Math.min(20000, p.y))) } : undefined);
const ROLE_KEYS = new Set(AGENT_TEMPLATES.map((t) => t.key));
const WRITE_ROLES = new Set(AGENT_TEMPLATES.filter((t) => t.permission === "workspace-write").map((t) => t.key));
export const isWriteRole = (r: string) => WRITE_ROLES.has(r);
export const roleKeys = () => [...ROLE_KEYS];

/** Extrait un objet JSON d'une réponse de modèle : bloc ```json, sinon premier objet équilibré. */
export function extractJson(text: string, fence = "json"): unknown | undefined {
  const m = new RegExp("```" + fence + "\\s*([\\s\\S]*?)```", "i").exec(text);
  const tryParse = (s: string) => { try { return JSON.parse(s); } catch { return undefined; } };
  if (m) { const v = tryParse(m[1]!.trim()); if (v !== undefined) return v; }
  if (fence !== "json") return undefined;
  const start = text.indexOf("{"); if (start < 0) return undefined;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) { const c = text[i]!; if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; } if (c === '"') inStr = true; else if (c === "{") depth++; else if (c === "}" && --depth === 0) return tryParse(text.slice(start, i + 1)); }
  return undefined;
}

/** Valide et normalise un plan : clés uniques, dépendances existantes, pas de cycle, limites. Pur et testable. */
export function validatePlan(raw: unknown, opts: { unavailable?: string[]; useWorktrees?: boolean } = {}): PlanCheck {
  const errors: string[] = [], warnings: string[] = [];
  const r = raw as any; if (!r || typeof r !== "object" || !Array.isArray(r.tasks)) return { ok: false, errors: ["Le plan doit contenir un tableau « tasks »."], warnings };
  if (!r.tasks.length) errors.push("Le plan ne contient aucune tâche.");
  if (r.tasks.length > MAX_TASKS) errors.push(`Trop de tâches (${r.tasks.length} > ${MAX_TASKS}).`);
  const nodes: PlanNode[] = []; const seen = new Set<string>();
  r.tasks.slice(0, MAX_TASKS).forEach((t: any, i: number) => {
    const key = String(t?.key ?? "").trim(); const title = String(t?.title ?? "").trim();
    if (!key) { errors.push(`Tâche ${i + 1} : clé manquante.`); return; } if (!/^[a-zA-Z0-9_-]{1,40}$/.test(key)) errors.push(`Clé invalide « ${key} » (lettres, chiffres, - et _ uniquement).`);
    if (seen.has(key)) errors.push(`Clé en double : « ${key} ».`); seen.add(key);
    if (!title) errors.push(`Tâche « ${key} » : titre manquant.`);
    const kind: NodeKind = NODE_KINDS.includes(t?.kind) ? t.kind : "agent";
    if (kind === "test" && !String(t?.command ?? t?.description ?? "").trim()) errors.push(`Nœud test « ${key} » : commande manquante.`);
    let role = String(t?.role ?? "fullstack"); if (kind === "agent" && !ROLE_KEYS.has(role)) { warnings.push(`Rôle inconnu « ${role} » pour « ${key} » : remplacé par « fullstack ».`); role = "fullstack"; }
    const provider = t?.provider === "claude" || t?.provider === "codex" ? t.provider : undefined;
    if (t?.provider && !provider) warnings.push(`Fournisseur inconnu « ${t.provider} » pour « ${key} » : choix automatique.`);
    nodes.push({ key, title, description: t?.description ? String(t.description) : undefined, role, provider, dependsOn: Array.isArray(t?.dependsOn) ? t.dependsOn.map(String) : [], kind, gate: !!t?.gate, pos: cleanPos(t?.pos), command: kind === "test" ? String(t?.command ?? t?.description ?? "").trim().slice(0, 500) : undefined });
  });
  for (const n of nodes) { for (const d of n.dependsOn) { if (d === n.key) errors.push(`« ${n.key} » dépend de lui-même.`); else if (!seen.has(d)) errors.push(`« ${n.key} » dépend d'une tâche inexistante : « ${d} ».`); } n.dependsOn = [...new Set(n.dependsOn)]; }
  // cycles (algorithme de Kahn)
  const indeg = new Map(nodes.map((n) => [n.key, 0])); for (const n of nodes) for (const d of n.dependsOn) if (seen.has(d) && d !== n.key) indeg.set(n.key, (indeg.get(n.key) ?? 0) + 1);
  const q = [...indeg].filter(([, v]) => v === 0).map(([k]) => k); const order: string[] = [];
  while (q.length) { const k = q.shift()!; order.push(k); for (const n of nodes) if (n.dependsOn.includes(k)) { const v = (indeg.get(n.key) ?? 1) - 1; indeg.set(n.key, v); if (v === 0) q.push(n.key); } }
  if (order.length < nodes.length) errors.push(`Cycle de dépendances détecté : ${nodes.filter((n) => !order.includes(n.key)).map((n) => n.key).join(", ")}.`);
  if (errors.length) return { ok: false, errors, warnings };
  // avertissements : agents indisponibles, conflits de ressources
  for (const n of nodes) if (n.provider && opts.unavailable?.includes(n.provider)) warnings.push(`« ${n.key} » demande ${n.provider}, actuellement indisponible : un autre fournisseur sera utilisé.`);
  if (!opts.useWorktrees) {
    const anc = new Map<string, Set<string>>(); for (const k of order) { const s = new Set<string>(); for (const d of nodes.find((n) => n.key === k)!.dependsOn) { s.add(d); anc.get(d)?.forEach((x) => s.add(x)); } anc.set(k, s); }
    const writers = nodes.filter((n) => n.kind === "agent" && isWriteRole(n.role));
    for (let i = 0; i < writers.length; i++) for (let j = i + 1; j < writers.length; j++) { const a = writers[i]!, b = writers[j]!; if (!anc.get(a.key)!.has(b.key) && !anc.get(b.key)!.has(a.key)) warnings.push(`Conflit de ressources possible : « ${a.key} » et « ${b.key} » peuvent écrire en parallèle dans le même dossier. Activez les worktrees Git ou ajoutez une dépendance.`); }
  }
  return { ok: true, errors, warnings, plan: { summary: typeof r.summary === "string" ? r.summary : undefined, tasks: nodes }, order };
}

export function plannerPrompt(goal: string, project: { name: string; path: string; instructions?: string | null }) {
  return `Tu es l'orchestrateur d'une équipe d'agents de développement. Ne modifie AUCUN fichier : explore le projet en lecture seule si nécessaire, puis produis un plan.

Objectif : ${goal}
Projet : ${project.name} (${project.path})${project.instructions ? `\nInstructions du projet : ${project.instructions}` : ""}

Découpe l'objectif en ${2}–${MAX_TASKS} tâches avec dépendances. Les tâches indépendantes doivent pouvoir s'exécuter en parallèle. Termine souvent par une tâche de revue (rôle "reviewer") et, si pertinent, une étape de validation humaine (kind "approval").

Rôles disponibles : ${roleKeys().join(", ")}.
Fournisseurs : "claude" ou "codex" (optionnel ; choisis selon la nature de la tâche).

Réponds UNIQUEMENT avec un bloc de code JSON de cette forme exacte :
\`\`\`json
{"summary":"résumé du plan","tasks":[{"key":"archi","title":"Titre court","description":"Instructions précises","role":"architect","provider":"claude","dependsOn":[],"kind":"agent"},{"key":"back","title":"…","description":"…","role":"backend","dependsOn":["archi"],"kind":"agent"},{"key":"ok","title":"Validation utilisateur","role":"reviewer","dependsOn":["back"],"kind":"approval"}]}
\`\`\``;
}

// ---------------- handoffs ----------------
export interface AgentHandoff {
  objective: string; from: { taskId: string; title: string; agent?: string; provider?: string }; to: { taskId: string; title: string };
  summary: string; decisions: string[]; filesModified: string[]; commits: string[]; testResults?: string; errors: string[]; openQuestions: string[]; nextSteps: string[];
  usage: { tokens: number; usd: number | null }; worktree?: { branch: string; path: string }; structured: boolean;
}
export const HANDOFF_INSTRUCTION = `À la toute fin de ta réponse, ajoute un bloc de code \`\`\`handoff contenant un JSON : {"decisions":[],"testResults":"","openQuestions":[],"nextSteps":[]} (listes de phrases courtes ; "testResults" = résultat des tests si tu en as exécuté). Ce bloc sera transmis à l'agent suivant ; sois concis.`;
const arr = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 12) : []);
/** Sépare le texte de réponse du bloc handoff structuré (si l'agent l'a fourni). */
export function parseHandoffBlock(text: string): { summary: string; decisions: string[]; testResults?: string; openQuestions: string[]; nextSteps: string[]; structured: boolean } {
  const j = extractJson(text, "handoff") as any; const summary = text.replace(/```handoff[\s\S]*?```/gi, "").trim();
  if (!j || typeof j !== "object") return { summary, decisions: [], openQuestions: [], nextSteps: [], structured: false };
  return { summary, decisions: arr(j.decisions), testResults: j.testResults ? String(j.testResults).slice(0, 600) : undefined, openQuestions: arr(j.openQuestions), nextSteps: arr(j.nextSteps), structured: true };
}
export const HANDOFF_MAX_CHARS = 6000;
/** Rendu Markdown limité en taille pour préserver la consommation de l'agent suivant. */
export function renderHandoff(h: AgentHandoff, max = HANDOFF_MAX_CHARS): string {
  const list = (t: string, a: string[]) => (a.length ? `**${t}**\n${a.map((x) => `- ${x}`).join("\n")}\n` : "");
  const tail = [list("Décisions techniques", h.decisions), list("Fichiers modifiés", h.filesModified.slice(0, 40)), list("Commits", h.commits), h.testResults ? `**Résultats de tests** : ${h.testResults}\n` : "", list("Erreurs", h.errors), list("Questions ouvertes", h.openQuestions), list("Prochaines étapes", h.nextSteps), h.worktree ? `**Branche** : ${h.worktree.branch}\n` : ""].join("");
  const head = `### Handoff de « ${h.from.title} »${h.from.agent ? ` (${h.from.agent}${h.from.provider ? `, ${h.from.provider}` : ""})` : ""}\n**Objectif de la suite** : ${h.objective}\n`;
  const room = Math.max(300, max - head.length - tail.length - 40); const sum = h.summary.length > room ? h.summary.slice(0, room) + "\n[… résumé tronqué]" : h.summary;
  const out = `${head}**Résumé du travail**\n${sum}\n${tail}`; return out.length > max ? out.slice(0, max) + "\n[… tronqué]" : out;
}
