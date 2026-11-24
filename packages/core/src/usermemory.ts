import { DB, all, one, run, uid, now } from "./db.js";
import { getSetting } from "./settings.js";

/**
 * Mémoire de l'utilisateur : faits durables que l'IA a proposés et que l'utilisateur a choisi de retenir (jamais enregistrés automatiquement).
 * Stockée dans la base de l'application ; n'a aucun lien avec les fichiers internes de Codex ou de Claude.
 */
export const MEMORY_MAX_ITEMS = 40;
export const MEMORY_MAX_LEN = 280;
const INJECT_MAX = 1800; // ≈ 450 tokens ajoutés à chaque message : le coût est visible dans l'interface
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
export class UserMemory {
  constructor(private db: DB, private setSetting: (k: string, v: unknown) => void) {}
  enabled() { return getSetting<boolean>(this.db, "memory.enabled", true) !== false; }
  setEnabled(on: boolean) { this.setSetting("memory.enabled", !!on); }
  list(): { id: string; text: string; created_at: string }[] { return all<any>(this.db, "SELECT id, text, created_at FROM user_memories ORDER BY created_at DESC"); }
  add(text: string): { id: string; duplicate: boolean } {
    const t = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, MEMORY_MAX_LEN); if (t.length < 3) throw new Error("Texte trop court.");
    const dup = this.list().find((m) => norm(m.text) === norm(t)); if (dup) return { id: dup.id, duplicate: true };
    if (this.list().length >= MEMORY_MAX_ITEMS) throw new Error(`${MEMORY_MAX_ITEMS} souvenirs maximum : supprimez-en avant d'en ajouter.`);
    const id = uid(); run(this.db, "INSERT INTO user_memories (id,text,created_at) VALUES (?,?,?)", id, t, now()); return { id, duplicate: false };
  }
  remove(id: string) { run(this.db, "DELETE FROM user_memories WHERE id=?", id); }
  clear() { run(this.db, "DELETE FROM user_memories"); }
  /** Texte ajouté à la consigne système (vide si désactivée ou sans souvenir). */
  textFor(): string {
    if (!this.enabled()) return ""; const items = this.list().reverse(); if (!items.length) return "";
    let out = "Souvenirs que l'utilisateur a choisi de te faire retenir (à utiliser seulement s'ils sont pertinents) :"; for (const m of items) { const line = `\n- ${m.text}`; if (out.length + line.length > INJECT_MAX) break; out += line; } return out;
  }
  tokens(): number { return Math.ceil(this.textFor().length / 4); }
}
export const MEMORY_PROMPT = "- ```memory : si l'utilisateur te confie une information durable et utile plus tard (préférence, contexte professionnel), propose de la retenir : {\"items\":[\"phrase courte\"]}. Rarement, jamais de secret, mot de passe ni donnée de santé. L'utilisateur décide.";
void one;
