import { DB, all, one, run, uid, now, tx } from "./db.js";

/**
 * Bases de connaissances : documents (déjà convertis en texte) rangés par l'utilisateur et interrogés par mots-clés (SQLite FTS5, local).
 * À chaque message d'une conversation reliée à une base, seuls les extraits pertinents (budget borné) sont ajoutés à la consigne :
 * c'est ce qui évite d'envoyer des documents entiers à chaque tour.
 */
export const KB_MAX_DOCS = 30;
export const KB_MAX_DOC_CHARS = 1_500_000;
export const KB_CONTEXT_CHARS = 9000; // ≈ 2 250 tokens ajoutés au plus à chaque message
const CHUNK = 1100;
const STOP = new Set("le la les un une des de du et ou en au aux ce ces cet cette que qui quoi dans pour par sur avec sans est sont etre avoir fait faire comment quel quelle quels quelles the and for with that this from what how why are was were you your".split(" "));
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Découpe un texte en extraits d'environ CHUNK caractères, aux limites de paragraphes. */
export function chunkText(text: string): string[] {
  const paras = text.replace(/\r/g, "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean); const out: string[] = []; let cur = "";
  for (const p of paras) {
    if (p.length > CHUNK * 1.5) { if (cur) { out.push(cur); cur = ""; } for (let i = 0; i < p.length; i += CHUNK) out.push(p.slice(i, i + CHUNK)); continue; }
    if (cur && cur.length + p.length + 2 > CHUNK) { out.push(cur); cur = ""; } cur = cur ? cur + "\n\n" + p : p;
  }
  if (cur) out.push(cur); return out;
}
/** Requête FTS5 sûre à partir d'une phrase libre : mots utiles, entre guillemets, préfixes, reliés par OR. */
export function ftsQuery(q: string): string {
  const words = [...new Set((fold(q).match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !STOP.has(w)))].slice(0, 12);
  return words.map((w) => `"${w}"*`).join(" OR ");
}
export interface KbHit { docId: string; docName: string; text: string }
export class Knowledge {
  constructor(private db: DB) {}
  list() { return all<any>(this.db, "SELECT k.id, k.name, k.created_at, (SELECT COUNT(*) FROM knowledge_docs d WHERE d.kb_id=k.id) docs, (SELECT COALESCE(SUM(chars),0) FROM knowledge_docs d WHERE d.kb_id=k.id) chars FROM knowledge_bases k ORDER BY k.created_at DESC"); }
  create(name: string): string { const n = String(name ?? "").trim().slice(0, 60); if (!n) throw new Error("Donnez un nom à la base."); if (one(this.db, "SELECT 1 x FROM knowledge_bases WHERE lower(name)=lower(?)", n)) throw new Error("Une base porte déjà ce nom."); const id = uid(); run(this.db, "INSERT INTO knowledge_bases (id,name,created_at) VALUES (?,?,?)", id, n, now()); return id; }
  remove(id: string) { tx(this.db, () => { run(this.db, "DELETE FROM kb_fts WHERE kb_id=?", id); run(this.db, "DELETE FROM knowledge_docs WHERE kb_id=?", id); run(this.db, "UPDATE conversations SET kb_id=NULL WHERE kb_id=?", id); run(this.db, "DELETE FROM knowledge_bases WHERE id=?", id); }); }
  docs(kbId: string) { return all<any>(this.db, "SELECT id, name, chars, created_at FROM knowledge_docs WHERE kb_id=? ORDER BY created_at DESC", kbId); }
  addDoc(kbId: string, name: string, text: string): { id: string; chunks: number } {
    if (!one(this.db, "SELECT 1 x FROM knowledge_bases WHERE id=?", kbId)) throw new Error("Base introuvable.");
    const t = String(text ?? "").trim(); if (t.length < 20) throw new Error(`« ${name} » est vide ou trop court.`); if (t.length > KB_MAX_DOC_CHARS) throw new Error(`« ${name} » est trop volumineux (${Math.round(KB_MAX_DOC_CHARS / 1000)} 000 caractères maximum).`);
    if ((one<any>(this.db, "SELECT COUNT(*) c FROM knowledge_docs WHERE kb_id=?", kbId)?.c ?? 0) >= KB_MAX_DOCS) throw new Error(`${KB_MAX_DOCS} documents maximum par base.`);
    const id = uid(); const chunks = chunkText(t);
    tx(this.db, () => { run(this.db, "INSERT INTO knowledge_docs (id,kb_id,name,chars,created_at) VALUES (?,?,?,?,?)", id, kbId, String(name).slice(0, 120), t.length, now()); const ins = this.db.prepare("INSERT INTO kb_fts (text, doc_id, kb_id) VALUES (?,?,?)"); for (const c of chunks) ins.run(c, id, kbId); });
    return { id, chunks: chunks.length };
  }
  removeDoc(docId: string) { tx(this.db, () => { run(this.db, "DELETE FROM kb_fts WHERE doc_id=?", docId); run(this.db, "DELETE FROM knowledge_docs WHERE id=?", docId); }); }
  search(kbId: string, query: string, limit = 6): KbHit[] {
    const q = ftsQuery(query); if (!q) return [];
    const rows = all<any>(this.db, "SELECT f.text text, f.doc_id doc_id, d.name name FROM kb_fts f JOIN knowledge_docs d ON d.id=f.doc_id WHERE kb_fts MATCH ? AND f.kb_id=? ORDER BY bm25(kb_fts) LIMIT ?", q, kbId, Math.max(1, Math.min(20, limit)));
    return rows.map((r) => ({ docId: r.doc_id, docName: r.name, text: r.text }));
  }
  /** Extraits à ajouter à la consigne pour ce message (vide si rien de pertinent). */
  contextFor(kbId: string | null | undefined, prompt: string, budget = KB_CONTEXT_CHARS): string {
    if (!kbId) return ""; const kb = one<any>(this.db, "SELECT name FROM knowledge_bases WHERE id=?", kbId); if (!kb) return "";
    const hits = this.search(kbId, prompt, 10); if (!hits.length) return `Base de connaissances « ${kb.name} » reliée à cette conversation : aucun extrait ne correspond à la question. Dis-le si la réponse devait s'y trouver.`;
    let out = `Extraits de la base de connaissances « ${kb.name} » (documents de l'utilisateur), choisis pour cette question. Appuie-toi dessus, cite le nom du document, et dis clairement si la réponse n'y figure pas :`;
    for (const h of hits) { const block = `\n\n[${h.docName}]\n${h.text}`; if (out.length + block.length > budget) break; out += block; } return out;
  }
}
