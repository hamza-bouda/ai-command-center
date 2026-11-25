import { DB, all, one, run, uid, now } from "./db.js";
import type { Orchestrator } from "./orchestrator.js";
import { PlanNode, validatePlan } from "./orchestration-plan.js";

type N = Omit<PlanNode, "provider"> & { provider?: "claude" | "codex" };
const n = (key: string, title: string, role: string, dependsOn: string[], description: string, extra: Partial<N> = {}): N => ({ key, title, role, dependsOn, description, kind: "agent", ...extra });
/** Modèles livrés : {{goal}} est remplacé par l'objectif au lancement. */
export const BUILTIN_WORKFLOWS: { key: string; name: string; description: string; nodes: N[] }[] = [
  { key: "feature", name: "Feature Development", description: "Planification → développement → tests → revue → validation avant fusion.", nodes: [
    n("plan", "Planification et architecture", "architect", [], "Objectif : {{goal}}. Analyse le projet, décide de l'architecture et liste précisément les changements à faire. Ne modifie aucun fichier.", { provider: "claude" }),
    n("dev", "Développement", "fullstack", ["plan"], "Implémente la fonctionnalité en suivant le plan transmis. Objectif : {{goal}}.", { provider: "codex" }),
    n("tests", "Tests", "qa", ["dev"], "Écris les tests manquants pour cette fonctionnalité et exécute-les. Rapporte les résultats.", { provider: "claude" }),
    n("review", "Revue de code", "reviewer", ["tests"], "Relis les changements (correction, sécurité, lisibilité) et rédige un rapport structuré avec les points bloquants.", { provider: "claude" }),
    n("ok", "Validation avant fusion", "reviewer", ["review"], "Relisez le rapport de revue ; la fusion Git reste manuelle (page Git).", { kind: "approval" })] },
  { key: "bugfix", name: "Bug Fix", description: "Diagnostic → reproduction → correction → test de régression → validation.", nodes: [
    n("diag", "Diagnostic", "debugger", [], "Bug à traiter : {{goal}}. Identifie la cause racine sans modifier le code.", { provider: "claude" }),
    n("repro", "Reproduction", "qa", ["diag"], "Écris un test qui reproduit le bug et vérifie qu'il échoue.", { provider: "codex" }),
    n("fix", "Correction", "debugger", ["repro"], "Corrige le bug de façon minimale : le test de reproduction doit passer.", { provider: "codex" }),
    n("regress", "Test de régression", "qa", ["fix"], "Exécute toute la suite de tests et signale les régressions.", { provider: "claude" }),
    n("ok", "Validation", "reviewer", ["regress"], "Validez la correction.", { kind: "approval" })] },
  { key: "refactor", name: "Refactoring", description: "Analyse → plan → modification → tests → revue.", nodes: [
    n("analyse", "Analyse et plan", "architect", [], "Refactoring demandé : {{goal}}. Analyse le code et propose un plan par étapes sans changer le comportement.", { provider: "claude" }),
    n("modif", "Modification", "refactor", ["analyse"], "Applique le plan de refactoring sans changer le comportement.", { provider: "codex" }),
    n("tests", "Tests", "qa", ["modif"], "Exécute les tests existants et ajoute ceux qui manquent.", { provider: "claude" }),
    n("review", "Revue", "reviewer", ["tests"], "Relis le refactoring et confirme l'équivalence de comportement.", { provider: "claude" })] },
  { key: "security", name: "Security Audit", description: "Analyse → rapport → propositions de correctifs → approbation.", nodes: [
    n("audit", "Analyse de sécurité", "security", [], "Audit demandé : {{goal}}. Cherche les vulnérabilités (injection, secrets, dépendances, permissions). Lecture seule.", { provider: "claude" }),
    n("report", "Rapport", "docs", ["audit"], "Rédige un rapport priorisé (gravité, preuve, impact).", { provider: "claude" }),
    n("fixes", "Correctifs proposés", "security", ["report"], "Propose des correctifs concrets (sans les appliquer).", { provider: "codex" }),
    n("ok", "Approbation", "security", ["fixes"], "Approuvez la suite à donner aux correctifs proposés.", { kind: "approval" })] },
  { key: "dual", name: "Dual AI Review", description: "Claude et Codex analysent indépendamment, puis synthèse comparée.", nodes: [
    n("claude", "Analyse Claude", "reviewer", [], "Analyse indépendante de : {{goal}}. Lecture seule.", { provider: "claude" }),
    n("codex", "Analyse Codex", "reviewer", [], "Analyse indépendante de : {{goal}}. Lecture seule.", { provider: "codex" }),
    n("synth", "Comparaison et synthèse", "architect", ["claude", "codex"], "Compare les deux analyses transmises : points communs, divergences, recommandation finale.", { provider: "claude" })] },
];

export class Workflows {
  constructor(private db: DB, private orch: Orchestrator) { this.seed(); }
  private seed() { for (const w of BUILTIN_WORKFLOWS) { if (one(this.db, "SELECT 1 x FROM workflows WHERE key=?", w.key)) continue; run(this.db, "INSERT INTO workflows (id,key,name,description,nodes,builtin,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)", uid(), w.key, w.name, w.description, JSON.stringify(w.nodes), 1, now(), now()); } }
  list() {
    return all<any>(this.db, `SELECT w.*, (SELECT COUNT(*) FROM orchestrations WHERE workflow_id=w.id) runs, (SELECT COUNT(*) FROM orchestrations WHERE workflow_id=w.id AND status='completed') ok,
      (SELECT COALESCE(SUM(u.total),0) FROM usage_events u JOIN tasks t ON t.id=u.task_id JOIN orchestrations o ON o.id=t.orchestration_id WHERE o.workflow_id=w.id) tokens,
      (SELECT COALESCE(SUM(c.calculated_usd),0) FROM usage_events u JOIN tasks t ON t.id=u.task_id JOIN orchestrations o ON o.id=t.orchestration_id JOIN cost_estimates c ON c.usage_event_id=u.id WHERE o.workflow_id=w.id) usd
      FROM workflows w ORDER BY w.builtin DESC, w.name`).map((w) => ({ ...w, nodes: JSON.parse(w.nodes) }));
  }
  get(id: string) { return this.list().find((w) => w.id === id); }
  runs(id: string) { return all<any>(this.db, "SELECT o.*, p.name project_name FROM orchestrations o JOIN projects p ON p.id=o.project_id WHERE o.workflow_id=? ORDER BY o.created_at DESC LIMIT 50", id); }
  save(w: { id?: string; name: string; description?: string; nodes: unknown }) {
    if (!w.name.trim()) throw new Error("Le nom du workflow est vide.");
    const c = validatePlan({ tasks: w.nodes }); if (!c.ok) throw new Error(c.errors.join(" "));
    if (w.id) { const cur = one<any>(this.db, "SELECT builtin FROM workflows WHERE id=?", w.id); if (!cur) throw new Error("Workflow introuvable"); if (cur.builtin) throw new Error("Un modèle livré n'est pas modifiable : dupliquez-le."); run(this.db, "UPDATE workflows SET name=?, description=?, nodes=?, updated_at=? WHERE id=?", w.name.trim(), w.description ?? null, JSON.stringify(c.plan!.tasks), now(), w.id); return w.id; }
    const id = uid(); run(this.db, "INSERT INTO workflows (id,key,name,description,nodes,builtin,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)", id, null, w.name.trim(), w.description ?? null, JSON.stringify(c.plan!.tasks), 0, now(), now()); return id;
  }
  /** Validation à blanc d'un graphe en cours d'édition (erreurs bloquantes et avertissements), sans rien enregistrer. */
  check(nodes: unknown, useWorktrees = false) { const c = validatePlan({ tasks: nodes }, { useWorktrees }); return { ok: c.ok, errors: c.errors, warnings: c.warnings }; }
  /** Enregistre le plan d'une orchestration réussie comme nouveau workflow réutilisable (positions et objectif remplacés par {{goal}} laissés à l'utilisateur). */
  fromOrchestration(orchId: string, name: string) {
    const o = this.orch.get(orchId); if (!o) throw new Error("Orchestration introuvable"); if (!o.plan_json) throw new Error("Cette orchestration n'a pas de plan à enregistrer.");
    const plan = JSON.parse(o.plan_json) as { tasks: unknown[] }; return this.save({ name: name || `${String(o.goal).slice(0, 40)} (modèle)`, description: `Créé depuis une exécution du ${new Date(o.created_at).toLocaleDateString("fr-FR")}.`, nodes: plan.tasks });
  }
  duplicate(id: string) { const w = this.get(id); if (!w) throw new Error("Workflow introuvable"); return this.save({ name: `${w.name} (copie)`, description: w.description, nodes: w.nodes }); }
  remove(id: string) { const w = one<any>(this.db, "SELECT builtin FROM workflows WHERE id=?", id); if (!w) return; if (w.builtin) throw new Error("Un modèle livré ne peut pas être supprimé."); run(this.db, "DELETE FROM workflows WHERE id=?", id); }
  /** Commandes qui seront exécutées dans le projet (à confirmer côté interface avant lancement). */
  commands(id: string, goal: string) { return (this.get(id)?.nodes ?? []).filter((x: PlanNode) => x.kind === "test").map((x: PlanNode) => (x.command ?? x.description ?? "").replace(/\{\{goal\}\}/g, goal)); }
  /** Instancie le workflow en orchestration (mode manuel : le plan est le vôtre, validé localement) et le lance. */
  async run(o: { workflowId: string; projectId: string; goal: string; useWorktrees?: boolean }): Promise<string> {
    const w = this.get(o.workflowId); if (!w) throw new Error("Workflow introuvable"); if (!o.goal.trim()) throw new Error("L'objectif est vide.");
    const sub = (s?: string) => (s ?? "").replace(/\{\{goal\}\}/g, o.goal.trim());
    const nodes = w.nodes.map((x: PlanNode) => ({ ...x, title: sub(x.title), description: sub(x.description), command: x.command ? sub(x.command) : undefined }));
    const id = this.orch.create({ projectId: o.projectId, goal: `${w.name} — ${o.goal.trim()}`, mode: "manual", useWorktrees: o.useWorktrees, workflowId: w.id });
    const c = await this.orch.setPlan(id, { summary: w.name, tasks: nodes }); if (!c.ok) throw new Error(c.errors.join(" "));
    await this.orch.approve(id); return id;
  }
}
