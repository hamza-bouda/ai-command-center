import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { DB, all, one, run, uid, now, tx } from "./db.js";
import type { EventBus } from "./events.js";
import { getSetting } from "./settings.js"; import type { Profile } from "./profile.js"; import { MEMORY_PROMPT, type UserMemory } from "./usermemory.js"; import type { Knowledge } from "./knowledge.js";
import type { ExecutionManager } from "./execution.js";
import type { AICatalog } from "./catalog.js";
import type { ProviderId } from "./types.js";
import { ExperienceMode, CodeSubmode, EXPERIENCE_MODES } from "./policies.js";
import type { Extensions } from "./extensions.js";

export interface ConversationConfig { provider: ProviderId; model?: string | null; effort?: string | null }
const SYS: Record<ExperienceMode, string> = {
  chat: "Tu es un assistant conversationnel. Réponds de façon claire et structurée (Markdown), en français sauf demande contraire. Tu n'as accès à aucun outil, fichier ni commande : réponds uniquement avec tes connaissances et le contenu fourni dans la conversation.",
  work: "Tu travailles dans un espace de travail dédié. Les documents sources fournis par l'utilisateur sont dans le sous-dossier `sources/` ; écris tous les livrables (rapports, documents, tableaux) dans le sous-dossier `livrables/`. N'écris nulle part ailleurs. Sois transparent sur ce que tu as réellement fait.",
  code: "",
};
/** Blocs enrichis rendus par l'interface (QCM cliquables, choix, graphiques, diagrammes, aperçus HTML, formules). Court à dessein : ajouté à chaque tour, donc coûteux en tokens s'il grossit. */
export const RICH_PROMPT = [
  "Affichage riche : tu écris dans une interface graphique (pas un terminal) qui rend des blocs spéciaux ; boutons et graphiques fonctionnent. Utilise des blocs de code balisés :",
  "- ```quiz : QCM cliquable, corrigé par l'interface. JSON {\"title\":\"…\",\"questions\":[{\"q\":\"…\",\"options\":[\"…\",\"…\"],\"answer\":1,\"explain\":\"…\"}]} (answer = index de la bonne option, en partant de 0 ; tableau si plusieurs). Ne répète pas les réponses hors du bloc.",
  "- ```choices : question à choix cliquables {\"question\":\"…\",\"options\":[\"A\",\"B\"],\"multiple\":false}. Le choix de l'utilisateur te revient comme message.",
  "- ```chart : graphique {\"type\":\"bar|line|area|pie\",\"title\":\"…\",\"x\":\"clé\",\"series\":[\"clé numérique\"],\"data\":[{…}]}.",
  "- ```mermaid : diagramme. ```artifact : page HTML complète autonome (CSS/JS en ligne, aucun réseau) affichée en aperçu interactif. ```svg : image.",
  "- Formules LaTeX : $$…$$.",
  "- ```file : livrer un FICHIER COMPLET à télécharger (notebook .ipynb, code, csv, md…) : première ligne `name: nom.ext`, puis le contenu intégral du fichier, sans le tronquer ni le résumer. Si le contenu contient des ```, ouvre et ferme ce bloc avec 4 backticks. L'interface affiche un bouton Enregistrer : ne demande jamais à l'utilisateur de copier-coller, et ne dis pas que tu ne peux pas produire de fichier.",
  "Emploie-les quand ils servent vraiment (quiz, données à comparer, schéma, choix à faire) ; le JSON doit être valide. N'utilise jamais l'outil AskUserQuestion : il n'existe pas ici.",
].join("\n");
const ACTIVE = ["queued", "preparing", "running", "waiting_approval"];
const CONTEXT_MAX = 6000;

/** Conversations indépendantes par mode (chat / work / code) : historique, configuration appliquée, reprise ou nouvelle session explicite. */
export class Conversations {
  constructor(private db: DB, private bus: EventBus, private exec: ExecutionManager, private catalog: AICatalog, private dataDir: string, private workDir: (workId: string) => string | undefined, private ext?: Extensions, private profile?: Profile, private userMemory?: UserMemory, private knowledge?: Knowledge) {
    bus.on((e) => { if (e.executionId && /^execution\.(completed|failed|cancelled|interrupted)$/.test(e.type)) { const id = e.executionId; const st = e.type.split(".")[1]!; setImmediate(() => this.onExecutionEnd(id, st)); } });
  }
  private sandbox() { const d = join(this.dataDir, "chat-sandbox"); mkdirSync(d, { recursive: true }); return d; }
  private hist(id: string, kind: string, detail: string, config?: unknown) { run(this.db, "INSERT INTO conversation_config_history VALUES (?,?,?,?,?,?)", uid(), id, kind, detail, config ? JSON.stringify(config) : null, now()); }

  async create(o: { mode: ExperienceMode; submode?: CodeSubmode; title?: string; provider: ProviderId; model?: string | null; effort?: string | null; projectId?: string | null; workId?: string | null; style?: string | null; web?: boolean; image?: boolean }): Promise<string> {
    if (!EXPERIENCE_MODES.includes(o.mode)) throw new Error("Mode inconnu");
    if (o.mode === "code" && !o.projectId) throw new Error("Le mode Code nécessite un projet.");
    if (o.mode !== "code" && o.projectId) throw new Error("Seul le mode Code peut être associé à un projet.");
    if (o.projectId && !one(this.db, "SELECT 1 x FROM projects WHERE id=?", o.projectId)) throw new Error("Projet introuvable");
    const chk = await this.catalog.validate(o.provider, o.model || null, o.effort || null); if (!chk.ok) throw new Error(chk.error);
    if (o.style && !this.profile?.find(o.style)) throw new Error("Style inconnu.");
    const id = uid(); run(this.db, "INSERT INTO conversations (id,mode,submode,title,provider,model,effort,project_id,work_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)", id, o.mode, o.mode === "code" ? o.submode ?? "direct" : null, o.title?.trim() || "Nouvelle conversation", o.provider, o.model || null, o.effort || null, o.projectId ?? null, o.workId ?? null, now(), now());
    if (o.style) run(this.db, "UPDATE conversations SET style=? WHERE id=?", o.style, id);
    if (o.web && o.mode === "chat") run(this.db, "UPDATE conversations SET web=1 WHERE id=?", id);
    if (o.image && o.mode === "chat" && o.provider === "codex") run(this.db, "UPDATE conversations SET image=1 WHERE id=?", id);
    this.hist(id, "created",`${o.provider} · ${o.model || "modèle par défaut"} · effort ${o.effort || "géré par le fournisseur"}`, { provider: o.provider, model: o.model, effort: o.effort });
    this.bus.emit("conversation.created", { id, mode: o.mode }); return id;
  }
  get(id: string) { return one<any>(this.db, "SELECT * FROM conversations WHERE id=?", id); }
  list(f: { mode: ExperienceMode; archived?: boolean; favorite?: boolean; q?: string; projectId?: string; submode?: string }) {
    const c: string[] = ["c.mode=?", "c.archived=?"]; const p: any[] = [f.mode, f.archived ? 1 : 0];
    if (f.favorite) c.push("c.favorite=1"); if (f.projectId) { c.push("c.project_id=?"); p.push(f.projectId); } if (f.submode) { c.push("c.submode=?"); p.push(f.submode); }
    if (f.q?.trim()) { c.push("(c.title LIKE ? OR EXISTS (SELECT 1 FROM conversation_messages m WHERE m.conversation_id=c.id AND m.content LIKE ?))"); p.push(`%${f.q.trim()}%`, `%${f.q.trim()}%`); }
    return all<any>(this.db, `SELECT c.*, (SELECT content FROM conversation_messages WHERE conversation_id=c.id ORDER BY created_at DESC, rowid DESC LIMIT 1) preview, (SELECT COALESCE(SUM(u.total),0) FROM usage_events u JOIN agent_executions e ON e.id=u.execution_id WHERE e.conversation_id=c.id) tokens, (SELECT COALESCE(SUM(k.calculated_usd),0) FROM usage_events u JOIN agent_executions e ON e.id=u.execution_id JOIN cost_estimates k ON k.usage_event_id=u.id WHERE e.conversation_id=c.id) usd, (SELECT COUNT(*) FROM agent_executions WHERE conversation_id=c.id AND status IN ('queued','preparing','running','waiting_approval')) active FROM conversations c WHERE ${c.join(" AND ")} ORDER BY c.favorite DESC, c.updated_at DESC`, ...p);
  }
  messages(id: string) {
    return all<any>(this.db, `SELECT m.*, (SELECT COALESCE(SUM(input),0) FROM usage_events WHERE execution_id=m.execution_id) input, (SELECT COALESCE(SUM(output),0) FROM usage_events WHERE execution_id=m.execution_id) output, (SELECT COALESCE(SUM(cache_read+cache_write),0) FROM usage_events WHERE execution_id=m.execution_id) cache, (SELECT COALESCE(SUM(total),0) FROM usage_events WHERE execution_id=m.execution_id) tokens, (SELECT COALESCE(SUM(k.calculated_usd),0) FROM usage_events u JOIN cost_estimates k ON k.usage_event_id=u.id WHERE u.execution_id=m.execution_id) usd, (SELECT COUNT(*) FROM usage_events u LEFT JOIN cost_estimates k ON k.usage_event_id=u.id WHERE u.execution_id=m.execution_id AND k.calculated_usd IS NULL) unpriced, (SELECT status FROM agent_executions WHERE id=m.execution_id) exec_status FROM conversation_messages m WHERE conversation_id=? ORDER BY created_at, rowid`, id);
  }
  history(id: string) { return all<any>(this.db, "SELECT * FROM conversation_config_history WHERE conversation_id=? ORDER BY at, rowid", id); }
  activeExecution(id: string) { return one<any>(this.db, `SELECT id,status FROM agent_executions WHERE conversation_id=? AND status IN ('${ACTIVE.join("','")}') ORDER BY created_at DESC LIMIT 1`, id); }
  /** Invite système du mode ; en Chat, les outils MCP explicitement activés sont annoncés (sinon le modèle croit n'avoir aucun outil). */
  /** Invite système du mode + (si activé dans les Paramètres) la description des blocs riches que l'interface sait afficher. */
  private systemPromptFor(mode: ExperienceMode, mcpNames: string[], style?: string | null, web = false, image?: boolean, kbContext = ""): string | undefined {
    const parts = [this.baseSystemPrompt(mode, mcpNames, web), this.profile?.textFor(style), this.userMemory?.textFor(), kbContext, mode !== "chat" ? "" : image ? "Tu peux générer des images avec l'outil de génération d'image intégré (aucune commande, aucun script, aucune clé API). L'image est affichée automatiquement dans la conversation : ne donne pas de chemin de fichier. Décris brièvement ce que tu as généré." : "Tu ne peux pas générer d'images dans cette conversation : n'en prétends jamais avoir produit et propose à l'utilisateur d'activer la génération d'images dans la fenêtre du modèle (Codex).", getSetting<boolean>(this.db, "ui.richBlocks", true) === false ? "" : RICH_PROMPT + (this.userMemory?.enabled() ? String.fromCharCode(10) + MEMORY_PROMPT : "")].filter(Boolean) as string[];
    return parts.length ? parts.join("\n\n") : undefined;
  }
  /** Recherche web en Chat : opt-in par conversation (le Chat n'a sinon aucun outil). Work et Code ont déjà leurs propres outils. */
  setWeb(id: string, on: boolean) { const conv = this.get(id); if (!conv) throw new Error("Conversation introuvable"); if (conv.mode !== "chat") throw new Error("La recherche web s'active uniquement dans le Chat."); run(this.db, "UPDATE conversations SET web=? WHERE id=?", on ? 1 : 0, id); this.hist(id, "web", on ? "Recherche web activée" : "Recherche web désactivée", { on }); }
  /** Style de réponse de la conversation (null = style par défaut des Paramètres). */
  setStyle(id: string, style: string | null) { if (!this.get(id)) throw new Error("Conversation introuvable"); if (style && !this.profile?.find(style)) throw new Error("Style inconnu."); run(this.db, "UPDATE conversations SET style=? WHERE id=?", style || null, id); }
  /** Relie (ou détache) une base de connaissances : des extraits pertinents sont ajoutés à la consigne de chaque message. */
  setKb(id: string, kbId: string | null) { if (!this.get(id)) throw new Error("Conversation introuvable"); if (kbId && !one(this.db, "SELECT 1 x FROM knowledge_bases WHERE id=?", kbId)) throw new Error("Base introuvable."); run(this.db, "UPDATE conversations SET kb_id=? WHERE id=?", kbId, id); this.hist(id, "kb", kbId ? "Base de connaissances reliée" : "Base de connaissances détachée", { kbId }); }
  /** Images en Chat : opt-in par conversation, uniquement avec Codex (Claude Code n'a pas d'outil de génération d'image). */
  setImage(id: string, on: boolean) { const conv = this.get(id); if (!conv) throw new Error("Conversation introuvable"); if (conv.mode !== "chat") throw new Error("La génération d'images se règle dans le Chat ; Work et Code ont leurs propres outils."); if (on && conv.provider !== "codex") throw new Error("La génération d'images utilise Codex (abonnement ChatGPT). Changez de fournisseur dans la fenêtre du modèle."); run(this.db, "UPDATE conversations SET image=? WHERE id=?", on ? 1 : 0, id); this.hist(id, "image", on ? "Génération d'images activée" : "Génération d'images désactivée", { on }); }
  private baseSystemPrompt(mode: ExperienceMode, mcpNames: string[], web = false): string | undefined {
    if (mode === "chat" && web) return "Tu es un assistant conversationnel. Réponds de façon claire et structurée (Markdown), en français sauf demande contraire. Tu n'as accès à aucun fichier ni commande. Seule la recherche web est activée pour cette conversation (outils de recherche et de lecture de pages) : utilise-la quand une information récente ou vérifiable est nécessaire, et cite tes sources avec des liens." + (mcpNames.length ? " Les outils des serveurs MCP suivants, activés par l'utilisateur, sont aussi disponibles : " + mcpNames.join(", ") + "." : "");
    if (mode === "chat" && mcpNames.length) return"Tu es un assistant conversationnel. Réponds de façon claire et structurée (Markdown), en français sauf demande contraire. Tu n'as accès à aucun fichier ni commande système. Seuls les outils des serveurs MCP suivants, activés explicitement par l'utilisateur, sont disponibles et tu dois les utiliser quand la demande s'y rapporte : " + mcpNames.join(", ") + ".";
    return SYS[mode] || undefined;
  }
  /** Extensions applicables à cette conversation (activées pour son mode) avec leur état local. */
  extensions(id: string) { const c = this.get(id); if (!c || !this.ext) return []; const dis: string[] = c.ext_disabled ? JSON.parse(c.ext_disabled) : []; return this.ext.list().filter((e: any) => e.enabled && e.modes.includes(c.mode)).map((e: any) => ({ id: e.id, kind: e.kind, name: e.name, description: e.config.description ?? e.config.url ?? e.config.command ?? "", active: !dis.includes(e.id) })); }
  setExtensionActive(id: string, extId: string, active: boolean) { const c = this.get(id); if (!c) return; const dis = new Set<string>(c.ext_disabled ? JSON.parse(c.ext_disabled) : []); active ? dis.delete(extId) : dis.add(extId); run(this.db, "UPDATE conversations SET ext_disabled=? WHERE id=?", JSON.stringify([...dis]), id); }
  /**
   * Modifier un message et relancer : crée une branche (nouvelle conversation) contenant l'historique AVANT ce message, puis envoie le texte modifié dans une session fournisseur neuve
   * (le CLI ne sait pas « rembobiner » une session : reprendre l'ancienne ferait encore voir au modèle les tours supprimés). L'original reste intact ; les pièces jointes ne sont pas reprises.
   */
  async branchFrom(id: string, messageId: string, text: string, cfg?: Partial<ConversationConfig>): Promise<{ id: string; executionId: string }> {
    const conv = this.get(id); if (!conv) throw new Error("Conversation introuvable");
    if (conv.mode === "work") throw new Error("La modification de message n'est pas disponible dans Work (conversation liée à un espace de travail).");
    if (!text.trim()) throw new Error("Le message est vide.");
    const msgs = all<any>(this.db, "SELECT * FROM conversation_messages WHERE conversation_id=? ORDER BY created_at, rowid", id); const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx < 0) throw new Error("Message introuvable."); if (msgs[idx].role !== "user") throw new Error("Seuls vos propres messages peuvent être modifiés.");
    if (all(this.db, "SELECT 1 x FROM agent_executions WHERE conversation_id=? AND status IN ('queued','preparing','running','waiting_approval')", id).length) throw new Error("Une réponse est en cours : attendez sa fin ou arrêtez-la.");
    const nid = uid(); const t = now(); const title = `${String(conv.title).replace(/ \(modifié\)$/, "")} (modifié)`.slice(0, 90);
    tx(this.db, () => {
      run(this.db, "INSERT INTO conversations (id,mode,submode,title,provider,model,effort,project_id,work_id,style,ext_disabled,parent_id,web,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", nid, conv.mode, conv.submode, title, conv.provider, conv.model, conv.effort, conv.project_id, null, conv.style, conv.ext_disabled, id, conv.web ?? 0, t, t);
      if (conv.image) run(this.db, "UPDATE conversations SET image=1 WHERE id=?", nid);
      if (conv.kb_id) run(this.db, "UPDATE conversations SET kb_id=? WHERE id=?", conv.kb_id, nid);
      for (const m of msgs.slice(0, idx)) if ((m.role === "user" || m.role === "assistant") && (m.status === "completed" || m.role === "user")) run(this.db, "INSERT INTO conversation_messages (id,conversation_id,role,content,provider,model,effort_applied,execution_id,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)", uid(), nid, m.role, m.content, m.provider, m.model, m.effort_applied, null, m.status, m.created_at);
    });
    this.hist(nid, "created", `Branche de « ${conv.title} » (message modifié)`, { parent: id }); this.bus.emit("conversation.created", { id: nid, mode: conv.mode });
    const r = await this.send(nid, text, cfg ?? { provider: conv.provider, model: conv.model, effort: conv.effort }); return { id: nid, executionId: r.executionId };
  }
  rename(id: string, title: string) { if (!title.trim()) throw new Error("Titre vide"); run(this.db, "UPDATE conversations SET title=? WHERE id=?", title.trim().slice(0, 120), id); }
  setFavorite(id: string, v: boolean) { run(this.db, "UPDATE conversations SET favorite=? WHERE id=?", v ? 1 : 0, id); }
  setArchived(id: string, v: boolean) { run(this.db, "UPDATE conversations SET archived=? WHERE id=?", v ? 1 : 0, id); }
  /** Supprime la conversation et ses messages ; les exécutions et mesures de consommation sont conservées (statistiques intactes). */
  remove(id: string) { if (this.activeExecution(id)) throw new Error("Une réponse est en cours : arrêtez-la d'abord."); run(this.db, "DELETE FROM conversations WHERE id=?", id); run(this.db, "UPDATE agent_executions SET conversation_id=NULL WHERE conversation_id=?", id); }
  async stop(id: string) { const a = this.activeExecution(id); if (a) await this.exec.cancel(a.id); }

  private transcript(id: string): string {
    const ms = all<any>(this.db, "SELECT role,content FROM conversation_messages WHERE conversation_id=? AND role IN ('user','assistant') AND status IS NOT 'failed' ORDER BY created_at, rowid", id).slice(-12);
    let out = ""; for (const m of ms.reverse()) { const line = `${m.role === "user" ? "Utilisateur" : "Assistant"} : ${String(m.content).slice(0, 1200)}\n\n`; if ((out + line).length > CONTEXT_MAX) break; out = line + out; } return out.trim();
  }

  /** Envoie un message. Un changement de modèle/effort chez le même fournisseur reprend la session ; un changement de fournisseur ouvre explicitement une nouvelle session avec contexte transmis. */
  async send(id: string, text: string, cfg?: Partial<ConversationConfig>, attachments: { name: string; content: string }[] = [], images: { name: string; mime: string; data: string }[] = []): Promise<{ executionId: string; newSession: boolean; notice?: string }> {
    const conv = this.get(id); if (!conv) throw new Error("Conversation introuvable"); if (!text.trim()) throw new Error("Message vide");
    if (this.activeExecution(id)) throw new Error("Une réponse est déjà en cours.");
    const next: ConversationConfig = { provider: (cfg?.provider ?? conv.provider) as ProviderId, model: cfg && "model" in cfg ? cfg.model || null : conv.model, effort: cfg && "effort" in cfg ? cfg.effort || null : conv.effort };
    const providerChanged = next.provider !== conv.provider; const modelChanged = (next.model || null) !== (conv.model || null); const effortChanged = (next.effort || null) !== (conv.effort || null);
    // Un changement de modèle réinitialise un effort devenu invalide : jamais appliqué silencieusement.
    const chk = await this.catalog.validate(next.provider, next.model, next.effort); if (!chk.ok) throw new Error(chk.error);
    const sessionUsable = !!conv.provider_session_id && conv.session_provider === next.provider;
    const newSession = !sessionUsable; let notice: string | undefined;
    if (providerChanged || modelChanged || effortChanged) { tx(this.db, () => { run(this.db, "UPDATE conversations SET provider=?, model=?, effort=? WHERE id=?", next.provider, next.model || null, next.effort || null, id);
      if (providerChanged) this.hist(id, "provider_changed", `${conv.provider} → ${next.provider} : nouvelle session fournisseur (ce n'est pas la même session native), contexte transmis explicitement`, next);
      if (modelChanged) this.hist(id, "model_changed", `${conv.model || "défaut"} → ${next.model || "défaut"}${providerChanged ? "" : " : session reprise avec le nouveau modèle"}`, next);
      if (effortChanged) this.hist(id, "effort_changed", `${conv.effort || "auto"} → ${next.effort || "auto"}`, next); }); }
    if (providerChanged) notice = "Changement de fournisseur : une nouvelle session est ouverte et le contexte récent est transmis explicitement.";
    const att = this.checkAttachments(attachments); const imgs = this.checkImages(images); const shown = text.trim() + (imgs.length ? `

🖼 ${imgs.map((a) => a.name).join(", ")}` : "") + (att.length ? `

📎 ${att.map((a) => a.name).join(", ")}` : "");
    const fence = (s: string) => "`".repeat(Math.max(3, (s.match(/`+/g) ?? []).reduce((mx, m) => Math.max(mx, m.length), 0) + 1)); // clôture plus longue que tout bloc de code contenu dans le fichier
    let prompt = text.trim() + att.map((a) => { const f = fence(a.content); return `

[Fichier joint : ${a.name}]
${f}
${a.content}
${f}`; }).join(""); const ctxParts: string[] = [];
    if (newSession && this.messages(id).some((m) => m.role !== "system")) { const t = this.transcript(id); if (t) { ctxParts.push(`[Contexte repris d'une conversation précédente — cette session est nouvelle]\n${t}`); if (!notice) notice = "Nouvelle session : le contexte récent est transmis explicitement."; this.hist(id, "new_session", "Session fournisseur non reprise : contexte transmis explicitement"); } }
    if (conv.pending_context) { ctxParts.push(`[Contexte transmis depuis une autre conversation]\n${conv.pending_context}`); run(this.db, "UPDATE conversations SET pending_context=NULL WHERE id=?", id); }
    if (ctxParts.length) prompt = `${ctxParts.join("\n\n")}\n\n[Message]\n${prompt}`;
    const cwd = conv.mode === "chat" ? this.sandbox() : conv.mode === "work" ? this.workDir(conv.work_id) : (one<any>(this.db, "SELECT path FROM projects WHERE id=?", conv.project_id)?.path as string | undefined);
    if (!cwd) throw new Error(conv.mode === "work" ? "Espace de travail introuvable" : "Projet introuvable");
    const extResolved = this.ext ? this.ext.resolve(conv.mode as ExperienceMode, conv.ext_disabled ? JSON.parse(conv.ext_disabled) : []) : undefined;
    const umid = uid(); const first = !one(this.db, "SELECT 1 x FROM conversation_messages WHERE conversation_id=? AND role='user'", id);
    run(this.db, "INSERT INTO conversation_messages (id,conversation_id,role,content,provider,model,created_at) VALUES (?,?,?,?,?,?,?)", umid, id, "user", shown, next.provider, next.model || null, now());
    if (first && /^Nouvelle conversation$/.test(conv.title)) run(this.db, "UPDATE conversations SET title=? WHERE id=?", text.trim().replace(/\s+/g, " ").slice(0, 60), id);
    const executionId = this.exec.enqueue({ projectId: conv.mode === "code" ? conv.project_id : null, mode: conv.mode, conversationId: id, cwd, provider: next.provider, model: next.model || undefined, effort: next.effort, prompt, images: imgs, web: conv.mode === "chat" && !!conv.web, image: conv.mode === "chat" && !!conv.image && next.provider === "codex", extensions: extResolved ? { mcp: extResolved.mcp, skillsText: extResolved.skillsText } : undefined, resumeSessionId: sessionUsable ? conv.provider_session_id : null, systemPrompt: this.systemPromptFor(conv.mode as ExperienceMode, extResolved?.mcp.map((m) => m.name) ?? [], conv.style, conv.mode === "chat" && !!conv.web, conv.mode === "chat" && !!conv.image && next.provider === "codex", this.knowledge?.contextFor(conv.kb_id, prompt) ?? ""), priority: 7 });
    run(this.db, "UPDATE conversation_messages SET execution_id=? WHERE id=?", executionId, umid); run(this.db, "UPDATE conversations SET updated_at=? WHERE id=?", now(), id);
    return { executionId, newSession, notice };
  }
  /** Images : PNG, JPEG, GIF, WebP (signature vérifiée), 5 Mo et 4 images maximum. */
  checkImages(a: { name: string; mime: string; data: string }[]) {
    if (a.length > 4) throw new Error("4 images maximum.");
    for (const f of a) { const b = Buffer.from(f.data, "base64"); if (b.length > 5 * 1024 * 1024) throw new Error(`« ${f.name} » dépasse 5 Mo.`);
      const sig = b.subarray(0, 12); const ok = (f.mime === "image/png" && sig[0] === 0x89 && sig[1] === 0x50) || (f.mime === "image/jpeg" && sig[0] === 0xff && sig[1] === 0xd8) || (f.mime === "image/gif" && sig.subarray(0, 3).toString() === "GIF") || (f.mime === "image/webp" && sig.subarray(0, 4).toString() === "RIFF" && sig.subarray(8, 12).toString() === "WEBP");
      if (!ok) throw new Error(`« ${f.name} » n'est pas une image PNG, JPEG, GIF ou WebP valide.`); }
    return a;
  }
  /** Pièces jointes texte : contenu injecté dans le message (aucun accès fichier pour l'IA). Images et binaires non pris en charge. */
  checkAttachments(a: { name: string; content: string }[]) {
    if (a.length > 5) throw new Error("5 pièces jointes maximum."); let total = 0;
    for (const f of a) { if (typeof f.content !== "string" || f.content.includes(String.fromCharCode(0))) throw new Error(`« ${f.name} » n'est pas un fichier texte.`); total += f.content.length; if (f.content.length > 400_000) throw new Error(`« ${f.name} » dépasse 400 000 caractères.`); }
    if (total > 600_000) throw new Error("Pièces jointes trop volumineuses (600 000 caractères au total)."); return a.map((f) => ({ name: f.name, content: f.content }));
  }
  /** « Régénérer » = renvoyer le dernier message utilisateur comme nouveau tour (le fournisseur ne propose pas de régénération native en mode structuré). */
  async regenerate(id: string) { const last = all<any>(this.db, "SELECT content FROM conversation_messages WHERE conversation_id=? AND role='user' ORDER BY created_at DESC, rowid DESC LIMIT 1", id)[0]; if (!last) throw new Error("Aucun message à régénérer"); return this.send(id, last.content); }

  /** Message d'une réponse interrompue : si le Chat a bloqué un outil, on dit lequel et comment faire (au lieu d'un laconique « interrompue »). */
  private cancelReason(execId: string): string {
    const v = one<any>(this.db, "SELECT payload FROM audit_events WHERE execution_id=? AND type='policy.violation' ORDER BY at DESC LIMIT 1", execId); if (!v) return "Réponse interrompue.";
    let tool = ""; try { tool = String(JSON.parse(v.payload).tool ?? ""); } catch { /* payload illisible */ }
    return tool ? `Réponse interrompue : le modèle a voulu utiliser l'outil « ${tool} », que le Chat n'autorise pas. Si c'est une recherche sur Internet, activez « Recherche web » dans la fenêtre du modèle ; pour lire des fichiers ou lancer des commandes, utilisez le mode Code.` : "Réponse interrompue : une action non autorisée en Chat a été détectée.";
  }
  private onExecutionEnd(execId: string, status: string) {
    const ex = one<any>(this.db, "SELECT * FROM agent_executions WHERE id=?", execId); if (!ex?.conversation_id) return;
    const conv = this.get(ex.conversation_id); if (!conv || one(this.db, "SELECT 1 x FROM conversation_messages WHERE execution_id=? AND role='assistant'", execId)) return;
    let content = status === "completed" ? ex.result_text || "(réponse vide)" : status === "cancelled" ? this.cancelReason(execId) : ex.error || "L'exécution a échoué.";
    if (status === "failed" && /limit|quota|usage/i.test(content)) { // limite d'abonnement : jamais contournée, mais expliquée avec la prochaine fenêtre connue
      const snap = one<any>(this.db, "SELECT windows FROM quota_snapshots WHERE provider=? ORDER BY created_at DESC LIMIT 1", ex.provider); const reset = snap ? (JSON.parse(snap.windows) as any[]).map((w) => w.resetsAt).filter(Boolean).sort()[0] : undefined;
      content += `

Limite d'abonnement atteinte pour ${ex.provider === "claude" ? "Claude Code" : "Codex"}${reset ? ` — prochaine réinitialisation connue : ${new Date(reset).toLocaleString("fr-FR")}` : ""}. Vous pouvez continuer avec l'autre fournisseur depuis le sélecteur : une nouvelle session s'ouvrira avec le contexte transmis.`; }
    run(this.db, "INSERT INTO conversation_messages (id,conversation_id,role,content,provider,model,effort_applied,execution_id,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)", uid(), conv.id, "assistant", content, ex.provider, ex.model, ex.effort_applied, execId, status, now());
    if (ex.provider_session_id && status !== "failed") run(this.db, "UPDATE conversations SET provider_session_id=?, session_provider=? WHERE id=?", ex.provider_session_id, ex.provider, conv.id);
    run(this.db, "UPDATE conversations SET updated_at=? WHERE id=?", now(), conv.id); this.bus.emit("conversation.message", { id: conv.id, status }, { executionId: execId });
  }

  /** « Continuer dans Code » : crée une conversation Code (direct) dans un projet avec un contexte explicite sélectionné. */
  async continueInCode(id: string, projectId: string, selection?: string): Promise<string> {
    const src = this.get(id); if (!src) throw new Error("Conversation introuvable"); const ctx = (selection?.trim() || this.transcript(id)).slice(0, CONTEXT_MAX);
    if (!ctx) throw new Error("Aucun contenu à transmettre.");
    const cid = await this.create({ mode: "code", submode: "direct", title: `Suite de : ${src.title}`.slice(0, 80), provider: src.provider, model: null, effort: null, projectId });
    run(this.db, "UPDATE conversations SET pending_context=? WHERE id=?", `Source : conversation « ${src.title} » (${src.mode}, ${src.provider})\n${ctx}`, cid);
    this.hist(cid, "context_imported", `Contexte transmis depuis « ${src.title} » (${ctx.length} caractères)`); return cid;
  }
  export(id: string, fmt: "md" | "json") {
    const c = this.get(id); if (!c) throw new Error("Conversation introuvable"); const ms = this.messages(id);
    if (fmt === "json") return JSON.stringify({ conversation: c, history: this.history(id), messages: ms.map(({ id: _i, ...m }) => m) }, null, 2);
    return [`# ${c.title}`, `*${c.mode} · ${c.provider} · ${c.model || "modèle par défaut"} · effort ${c.effort || "géré par le fournisseur"}*`, "", ...ms.map((m) => `### ${m.role === "user" ? "Vous" : `Assistant (${m.model ?? m.provider}${m.effort_applied ? ", effort " + m.effort_applied : ""})`}\n\n${m.content}\n`)].join("\n");
  }
}
