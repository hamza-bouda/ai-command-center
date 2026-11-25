import { useContext, useState } from "react";
import { Check, Copy, Download, FileDown, Loader2 } from "lucide-react";
import { api } from "../api"; import { toast } from "../overlay"; import { RichScope } from "./RichBlocks";

/**
 * Fichier livré par l'IA dans sa réponse : première ligne « name: nom.ext », puis le contenu intégral.
 * Le Chat n'a aucun outil de fichier : c'est l'interface qui permet d'enregistrer le contenu (fenêtre « Enregistrer sous »).
 */
export function parseFileBlock(raw: string): { name: string; content: string } | string {
  const nl = raw.indexOf("\n"); const first = nl < 0 ? raw : raw.slice(0, nl);
  const m = /^\s*(?:name|nom|file|fichier)\s*[:=]\s*(.+?)\s*$/i.exec(first); if (!m) return "première ligne « name: nom.ext » manquante";
  const base = m[1]!.replace(/^["'`]+|["'`]+$/g, "").split(/[\\/]/).pop() ?? "";
  const name = base.replace(/[<>:"|?*]/g, "_").replace(/[\u0000-\u001f]/g, "").slice(0, 120).trim();
  if (!name || name === "." || name === "..") return "nom de fichier invalide";
  const content = nl < 0 ? "" : raw.slice(nl + 1).replace(/^\s*-{3,}\s*\n/, ""); return { name, content };
}
/** Résumé d'un notebook Jupyter : valide, nombre de cellules ; sinon explication. */
export function notebookNote(content: string): string {
  try { const nb = JSON.parse(content); return Array.isArray(nb?.cells) ? `Notebook valide : ${nb.cells.length} cellule(s)` : "JSON valide, mais ce n'est pas un notebook (clé « cells » absente)"; }
  catch { return "Attention : ce JSON est invalide (réponse peut-être tronquée)"; }
}

export function FileBlock({ raw }: { raw: string }) {
  const { streaming } = useContext(RichScope); const [ok, setOk] = useState(false); const p = parseFileBlock(raw);
  if (typeof p === "string") return streaming
    ? <div className="my-4 rounded-2xl border border-line bg-panel/50 px-4 py-6 flex items-center gap-2.5 text-[13px] text-muted not-prose" role="status"><Loader2 size={15} className="animate-spin text-accent" />Préparation du fichier…</div>
    : <div className="my-3"><div role="alert" className="text-xs text-warning mb-1.5">Fichier : {p} — affichage du contenu brut.</div><pre className="bg-bg border border-line rounded-xl p-4 overflow-auto text-[12.5px] max-h-80">{raw}</pre></div>;
  const bytes = new Blob([p.content]).size; const size = bytes < 1024 ? `${bytes} o` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} Ko`;
  const note = /\.ipynb$/i.test(p.name) && !streaming ? notebookNote(p.content) : "";
  const save = async () => { try { const f = await api("file.saveText", p.name, p.content); if (f) toast(`Fichier enregistré : ${f}`, "success"); } catch (e: any) { toast(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "error"); } };
  return <div className="my-4 rounded-2xl border border-line bg-panel/60 not-prose flex items-center gap-3 px-4 py-3">
    <span className="w-10 h-10 rounded-xl bg-accent-subtle text-accent grid place-items-center shrink-0"><FileDown size={18} /></span>
    <div className="min-w-0 flex-1"><div className="text-[14px] font-medium truncate select-text">{p.name}</div><div className="text-xs text-muted tnum">{size}{note ? ` · ${note}` : ""}{streaming ? " · en cours d'écriture…" : ""}</div></div>
    <button className="btn btn-sm" disabled={streaming} onClick={() => { void navigator.clipboard?.writeText(p.content).catch(() => {}); setOk(true); setTimeout(() => setOk(false), 1400); }}>{ok ? <Check size={13} /> : <Copy size={13} />}Copier</button>
    <button className="btn btn-sm btn-primary" disabled={streaming} onClick={() => void save()}><Download size={13} />Enregistrer</button></div>;
}
