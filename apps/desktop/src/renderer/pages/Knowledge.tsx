import { useState } from "react";
import { Database, Plus, Trash2, FileText, Search, FilePlus2 } from "lucide-react";
import { api } from "../api"; import { useData } from "../hooks"; import { toast, confirmDialog } from "../overlay";
import { Page, Card, EmptyState, LoadingSkeleton } from "../ui";

const errMsg = (e: any) => String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
const ko = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)} k car.` : `${n} car.`);

/** Bases de connaissances : documents rangés une fois, retrouvés par mots-clés ; seuls les extraits pertinents sont envoyés à l'IA (économie de tokens). */
export default function Knowledge() {
  const { data: kbs, reload, loading } = useData<any[]>("kb.list", []); const [sel, setSel] = useState<string | null>(null); const [name, setName] = useState(""); const [q, setQ] = useState(""); const [hits, setHits] = useState<any[] | null>(null); const [busy, setBusy] = useState(false);
  const cur = kbs?.find((k) => k.id === sel) ?? kbs?.[0]; const { data: docs, reload: reloadDocs } = useData<any[]>("kb.docs", [cur?.id ?? ""], { enabled: !!cur });
  const create = async () => { try { const id = await api("kb.create", name); setName(""); setSel(id); reload(); } catch (e: any) { toast(errMsg(e), "error"); } };
  const addFiles = async () => { if (!cur) return; setBusy(true); try { const r = await api("kb.addFiles", cur.id); if (!r) return; reload(); reloadDocs(); if (r.added) toast(`${r.added} document(s) ajouté(s) (${r.chunks} extraits).`, "success"); for (const m of [...r.problems].slice(0, 3)) toast(m, "error"); if (r.needsConverter) toast("Des PDF/Office demandent le convertisseur : installez-le dans MCP et Skills › Convertisseur de documents.", "info"); } catch (e: any) { toast(errMsg(e), "error"); } finally { setBusy(false); } };
  const search = async () => { if (!cur || !q.trim()) return; try { setHits(await api("kb.search", cur.id, q)); } catch (e: any) { toast(errMsg(e), "error"); } };
  return <Page title="Connaissances" sub="Rangez vos documents une fois ; les conversations n'en reçoivent que les extraits utiles, pas les fichiers entiers.">
    <div className="grid lg:grid-cols-[260px_1fr] gap-4 [&>*]:min-w-0">
      <Card title="Bases">
        {loading && !kbs ? <LoadingSkeleton cards={1} rows={0} /> : <ul className="space-y-1 mb-3">{kbs?.map((k) => <li key={k.id}><button className={`w-full text-left rounded-lg px-3 py-2 text-[13px] border-l-2 ${cur?.id === k.id ? "bg-accent-subtle text-fg border-[var(--accent)]" : "border-transparent hover:bg-hover"}`} onClick={() => { setSel(k.id); setHits(null); }}><div className="font-medium truncate">{k.name}</div><div className="text-2xs text-fg2">{k.docs} doc. · {ko(k.chars)}</div></button></li>)}</ul>}
        <div className="flex gap-2"><input className="input" aria-label="Nom de la nouvelle base" placeholder="Nouvelle base" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) void create(); }} /><button className="btn btn-icon" aria-label="Créer la base" disabled={!name.trim()} onClick={() => void create()}><Plus size={14} /></button></div>
      </Card>
      {!cur ? <Card><EmptyState icon={Database} title="Aucune base" desc="Créez une base (par exemple « Contrats » ou « Cours »), ajoutez-y vos documents, puis reliez-la à une conversation depuis la fenêtre du modèle." /></Card> :
      <div className="space-y-4">
        <Card title={cur.name} sub={`${cur.docs} document(s) · ≈ ${Math.round(cur.chars / 4).toLocaleString("fr-FR")} tokens au total, mais seuls ~2 000 tokens d'extraits au plus sont envoyés par message`} right={<><button className="btn btn-primary" disabled={busy} onClick={() => void addFiles()}><FilePlus2 size={14} />{busy ? "Ajout…" : "Ajouter des documents"}</button><button className="btn btn-ghost btn-icon" aria-label="Supprimer la base" onClick={async () => { if (await confirmDialog({ title: `Supprimer « ${cur.name} » ?`, body: "Les documents de la base et leur index seront supprimés. Les fichiers d'origine ne sont pas touchés.", confirmLabel: "Supprimer", danger: true })) { await api("kb.remove", cur.id); setSel(null); reload(); } }}><Trash2 size={14} /></button></>}>
          {!docs?.length ? <p className="text-xs text-muted">Aucun document. PDF, Word, PowerPoint, Excel, HTML, EPUB (avec le convertisseur) et fichiers texte ou code sont acceptés.</p>
            : <ul className="divide-y divide-line">{docs.map((d) => <li key={d.id} className="py-2 flex items-center gap-3"><FileText size={15} className="text-muted shrink-0" /><span className="text-[13px] flex-1 min-w-0 truncate">{d.name}</span><span className="text-2xs text-muted tnum shrink-0">{ko(d.chars)}</span><button className="btn btn-ghost btn-icon !h-7 !w-7" aria-label={`Retirer ${d.name}`} onClick={async () => { await api("kb.removeDoc", d.id); reload(); reloadDocs(); setHits(null); }}><Trash2 size={13} /></button></li>)}</ul>}
        </Card>
        <Card title="Rechercher dans cette base" sub="Mots-clés, sans accents ni majuscules ; c'est cette même recherche qui choisit les extraits envoyés à l'IA">
          <div className="flex gap-2 mb-3"><div className="relative flex-1"><Search size={14} className="absolute left-3 top-2.5 text-muted" /><input className="input !pl-9" aria-label="Rechercher dans la base" placeholder="Ex. budget de maintenance" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void search(); }} /></div><button className="btn" disabled={!q.trim()} onClick={() => void search()}>Chercher</button></div>
          {hits && (hits.length === 0 ? <p className="text-xs text-muted">Aucun extrait ne correspond.</p> : <ul className="space-y-2">{hits.map((h, i) => <li key={i} className="rounded-xl border border-line p-3"><div className="text-2xs text-accent font-medium mb-1">{h.docName}</div><p className="text-[13px] text-fg2 whitespace-pre-wrap line-clamp-6">{h.text}</p></li>)}</ul>)}
        </Card>
      </div>}
    </div></Page>;
}
