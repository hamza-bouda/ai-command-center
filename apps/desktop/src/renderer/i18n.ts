import { useSyncExternalStore } from "react";
type Dict = Record<string, string>;
const fr: Dict = {
  "nav.workspace": "Espace de travail", "nav.development": "Développement", "nav.monitoring": "Suivi", "nav.system": "Système",
  "nav.overview": "Vue d'ensemble", "nav.projects": "Projets", "nav.agents": "Agents", "nav.tasks": "Tâches", "nav.orchestrator": "Orchestrateur",
  "nav.sessions": "Sessions", "nav.quality": "Qualité", "nav.automations": "Automatisations", "nav.chat": "Chat", "nav.work": "Work", "nav.code": "Code", "nav.modes": "Expériences", "nav.home": "Accueil", "nav.common": "Commun", "nav.codeTools": "Outils Code", "nav.terminal": "Terminal", "nav.workflows": "Workflows", "nav.git": "Git", "nav.compare": "Comparaison IA",
  "nav.analytics": "Consommation", "nav.quotas": "Abonnements et quotas", "nav.activity": "Activité",
  "nav.mcp": "MCP et Skills", "nav.library": "Bibliothèque", "nav.knowledge": "Connaissances", "nav.notifications": "Notifications", "nav.settings": "Paramètres",
  "common.newTask": "Nouvelle tâche", "common.newAgent": "Nouvel agent", "common.cancel": "Annuler", "common.create": "Créer", "common.save": "Enregistrer", "common.search": "Rechercher…",
  "common.stop": "Arrêter", "common.retry": "Relancer", "common.start": "Démarrer", "common.details": "Détails", "common.close": "Fermer", "common.back": "Retour", "common.next": "Suivant",
  "common.loading": "Chargement…", "common.all": "Tous", "common.none": "Aucun", "common.confirm": "Confirmer", "common.unavailable": "Information non disponible avec cette intégration.",
  "status.running": "En cours", "status.preparing": "Préparation", "status.queued": "En file", "status.completed": "Terminé", "status.failed": "Échec", "status.cancelled": "Annulé", "status.interrupted": "Interrompu",
  "status.waiting_approval": "Approbation requise", "status.blocked": "Bloqué", "status.draft": "Brouillon", "status.idle": "Inactif", "status.working": "Au travail", "status.waiting": "En attente", "status.offline": "Hors ligne",
  "auth.subscription": "Abonnement", "auth.api_key": "Clé API", "auth.unknown": "Inconnu", "auth.unavailable": "Indisponible",
  "disclaimer.usd": "Équivalent estimé au tarif API — non facturé en plus de votre abonnement.",
  "overview.title": "Vue d'ensemble", "overview.sub": "Votre espace de travail IA, en un coup d'œil.",
  "agents.title": "Agents", "agents.sub": "Créez et pilotez vos assistants de développement.",
  "agents.empty.title": "Aucun agent pour le moment", "agents.empty.desc": "Créez votre premier agent pour commencer à déléguer des tâches.", "agents.empty.cta": "Créer un agent",
  "tasks.title": "Tâches", "tasks.sub": "Organisez et suivez le travail de vos agents.",
  "tasks.empty.title": "Aucune tâche", "tasks.empty.desc": "Créez une tâche et assignez-la à un agent pour la lancer.",
  "sessions.title": "Sessions", "sessions.sub": "Conversations et exécutions en direct.", "sessions.empty.title": "Démarrez une conversation", "sessions.empty.desc": "Lancez une exécution avec Claude Code ou Codex.", "sessions.empty.cta": "Nouvelle session",
  "analytics.title": "Consommation", "analytics.sub": "Analysez l'utilisation de vos agents et la valeur équivalente API.",
  "analytics.empty.title": "Les statistiques apparaîtront après vos premières exécutions",
  "projects.title": "Projets", "projects.sub": "Les dossiers sur lesquels travaillent vos agents.", "projects.empty.title": "Votre espace de travail commence ici", "projects.empty.desc": "Ajoutez un dossier existant pour y lancer des agents.", "projects.empty.cta": "Ajouter un projet",
  "quotas.title": "Abonnements et quotas", "quotas.sub": "Mesures officielles des fournisseurs — aucune extrapolation.",
  "orchestrator.title": "Orchestrateur", "orchestrator.sub": "Graphe des tâches, dépendances et agents associés.",
  "git.title": "Git et worktrees", "git.sub": "Chaque exécution isolée travaille dans sa propre branche.",
  "settings.title": "Paramètres", "notifications.title": "Notifications",
  "palette.placeholder": "Rechercher une page, un projet, un agent ou une action…", "palette.empty": "Aucun résultat",
  "error.generic": "Une erreur est survenue", "error.retry": "Réessayer",
  "provider.missing": "n'est pas détecté sur cet ordinateur. Vérifiez son installation.",
};

const en: Dict = {
  "nav.quality": "Quality", "nav.automations": "Automations", "nav.chat": "Chat", "nav.work": "Work", "nav.code": "Code", "nav.modes": "Experiences", "nav.home": "Home", "nav.common": "Common", "nav.codeTools": "Code tools",
  "nav.overview": "Overview", "nav.projects": "Projects", "nav.agents": "Agents", "nav.tasks": "Tasks", "nav.orchestrator": "Orchestrator", "nav.sessions": "Sessions", "nav.terminal": "Terminal", "nav.workflows": "Workflows", "nav.git": "Git", "nav.compare": "AI Compare",
  "nav.analytics": "Usage", "nav.quotas": "Subscriptions & quotas", "nav.activity": "Activity", "nav.mcp": "MCP & Skills", "nav.library": "Library", "nav.knowledge": "Knowledge", "nav.notifications": "Notifications", "nav.settings": "Settings",
  "common.newTask": "New task", "common.newAgent": "New agent", "common.cancel": "Cancel", "common.create": "Create", "common.save": "Save", "common.search": "Search…", "common.stop": "Stop", "common.retry": "Retry", "common.start": "Start", "common.details": "Details", "common.close": "Close", "common.back": "Back", "common.next": "Next", "common.loading": "Loading…", "common.all": "All", "common.none": "None", "common.confirm": "Confirm", "common.unavailable": "Not available with this integration.",
  "status.running": "Running", "status.preparing": "Preparing", "status.queued": "Queued", "status.completed": "Completed", "status.failed": "Failed", "status.cancelled": "Cancelled", "status.interrupted": "Interrupted", "status.waiting_approval": "Approval required", "status.blocked": "Blocked", "status.draft": "Draft", "status.idle": "Idle", "status.working": "Working", "status.waiting": "Waiting", "status.offline": "Offline",
  "auth.subscription": "Subscription", "auth.api_key": "API key", "auth.unknown": "Unknown", "auth.unavailable": "Unavailable",
  "disclaimer.usd": "Estimated at API pricing — not billed on top of your subscription.",
  "overview.title": "Overview", "overview.sub": "Your AI workspace at a glance.", "agents.title": "Agents", "agents.sub": "Create and run your development assistants.", "tasks.title": "Tasks", "tasks.sub": "Organize and follow your agents' work.",
  "sessions.title": "Sessions", "sessions.sub": "Live conversations and runs.", "analytics.title": "Usage", "analytics.sub": "Analyze your agents' usage and the API-equivalent value.", "projects.title": "Projects", "projects.sub": "The folders your agents work on.", "quotas.title": "Subscriptions & quotas", "quotas.sub": "Official provider measurements — no extrapolation.",
  "orchestrator.title": "Orchestrator", "settings.title": "Settings", "notifications.title": "Notifications", "palette.placeholder": "Search a page, project, agent or action…", "palette.empty": "No results", "error.generic": "Something went wrong", "error.retry": "Retry",
};
const dicts: Record<string, Dict> = { fr, en };
let lang = "fr"; const subs = new Set<() => void>();
export const t = (k: string, vars?: Record<string, string | number>) => { let s = dicts[lang]?.[k] ?? fr[k] ?? k; if (vars) for (const [a, b] of Object.entries(vars)) s = s.replace(`{${a}}`, String(b)); return s; };
export function registerLanguage(code: string, d: Dict) { dicts[code] = d; }
export function setLanguage(code: string) { if (dicts[code]) { lang = code; subs.forEach((f) => f()); } }
export function useT() { useSyncExternalStore((cb) => (subs.add(cb), () => subs.delete(cb)), () => lang); return t; }

// ---- Traducteur d'exécution : applique le dictionnaire FR -> EN (généré) sur le DOM, sans toucher au contenu des conversations ni au code ----
const SKIP = "pre, code, textarea, script, style, .prose-chat, [data-no-i18n]"; const ATTRS = ["placeholder", "title", "aria-label", "alt"];
let observer: MutationObserver | undefined;
export function installDomTranslator(map: Record<string, string>) {
  if (observer || typeof document === "undefined") return;
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  // Textes dynamiques (valeurs insérées) : règles à motifs, appliquées quand le texte exact n'est pas dans le dictionnaire.
  const RULES: [RegExp, string][] = [[/^(\d+) réussis \/ (\d+) échecs \((\d+)\)$/, "$1 passed / $2 failed ($3)"], [/^Chaque jour à (.+)$/, "Every day at $1"], [/^Toutes les (\d+) min$/, "Every $1 min"], [/^Prochaine : (.+)$/, "Next: $1"], [/^Dernière : (.+)$/, "Last: $1"], [/^Taux de réussite : (.+) % sur (\d+) exéc\.$/, "Success rate: $1 % over $2 runs"], [/^(\d+) étapes?$/, "$1 steps"], [/^(\d+) (?:tâche|tâches)$/, "$1 tasks"], [/^(\d+) j$/, "$1 d"], [/^(\d+) lancements?$/, "$1 runs"], [/^Version installée : (.+)$/, "Installed version: $1"], [/^Rapport de consommation \(24 h\)$/, "Usage report (24 h)"], [/^Lancer un workflow$/, "Run a workflow"], [/^(\d+) fichier\(s\) modifié\(s\)$/, "$1 file(s) changed"], [/^Version (.+) disponible$/, "Version $1 available"], [/^Vous avez la dernière version \((.+)\)\.$/, "You have the latest version ($1)."]];
  const rule = (k: string) => { for (const [re, rep] of RULES) if (re.test(k)) return k.replace(re, rep); return undefined; };
  const text = (n: Text) => { const p = n.parentElement; if (!p || p.closest(SKIP)) return; const k = norm(n.nodeValue ?? ""); const en = k && (map[k] ?? rule(k)); if (en) { const raw = n.nodeValue!; n.nodeValue = raw.slice(0, raw.length - raw.trimStart().length) + en + raw.slice(raw.trimEnd().length); } };
  const attrs = (el: Element) => { if (el.closest(SKIP)) return; for (const a of ATTRS) { const v = el.getAttribute(a); const en = v && map[norm(v)]; if (en && en !== v) el.setAttribute(a, en); } };
  const walk = (root: Node) => { if (root.nodeType === 3) return text(root as Text); if (root.nodeType !== 1) return; attrs(root as Element); const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT); let n: Node | null; while ((n = w.nextNode())) n.nodeType === 3 ? text(n as Text) : attrs(n as Element); };
  document.documentElement.lang = "en"; walk(document.body);
  observer = new MutationObserver((ms) => { for (const m of ms) { if (m.type === "childList") m.addedNodes.forEach(walk); else if (m.type === "characterData") text(m.target as Text); else if (m.type === "attributes") attrs(m.target as Element); } });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
/** Applique la langue : le dictionnaire de libellés (t) + la traduction DOM complète pour l'anglais. */
export async function applyLanguage(code: string) { setLanguage(code); if (code === "en") { const m = await import("./i18n.en.generated"); installDomTranslator(m.EN_MAP); } }
