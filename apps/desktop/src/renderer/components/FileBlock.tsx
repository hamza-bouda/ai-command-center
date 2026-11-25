import { useContext, useState } from "react";
import { Check, Copy, Download, FileDown, Loader2, AlertTriangle } from "lucide-react";
import { api } from "../api"; import { toast } from "../overlay"; import { RichScope } from "./RichBlocks";
import { extOf, kindOf, unsupportedReason, parseBundle, parseSheets, parseSlides } from "../../shared/filetypes";

/**
 * Fichier livré par l'IA dans sa réponse : première ligne « name: nom.ext », puis le contenu intégral.
 * Le Chat n'a aucun outil de fichier : c'est l'application qui fabrique le fichier à l'enregistrement
 * (texte tel quel ; Word, Excel, PowerPoint, PDF, ZIP convertis depuis un format source simple).
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
const LABEL: Record<string, string> = { docx: "Document Word", xlsx: "Classeur Excel", pptx: "Présentation PowerPoint", pdf: "Document PDF", zip: "Archive ZIP" };
/** Ce que l'application va fabriquer, et un aperçu du contenu quand le format source se laisse analyser. */
export function describeFile(name: string, content: string): { label?: string; note: string; problem?: string } {
  const why = unsupportedReason(name); if (why) return { problem: why, note: "" };
  const kind = kindOf(name); const label = LABEL[kind];
  try {
    if (/\.ipynb$/i.test(name)) return { note: notebookNote(content) };
    if (kind === "zip") { const n = parseBundle(content).length; return n ? { label, note: `${n} fichier(s)` } : { label, note: "", problem: "Archive vide : chaque fichier doit commencer par une ligne « === chemin/nom.ext === »." }; }
    if (kind === "xlsx") { const s = parseSheets(content); return { label, note: `${s.length} feuille(s), ${s.reduce((a, x) => a + x.rows.length, 0)} ligne(s)` }; }
    if (kind === "pptx") return { label, note: `${parseSlides(content).length} diapositive(s)` };
    if (kind === "docx" || kind === "pdf") return { label, note: `${content.split(/\s+/).filter(Boolean).length} mots` };
  } catch (e: any) { return { label, note: "", problem: String(e?.message ?? e) }; }
  return { note: "" };
}

export function FileBlock({ raw }: { raw: string }) {
  const { streaming } = useContext(RichScope); const [ok, setOk] = useState(false); const [busy, setBusy] = useState(false); const p = parseFileBlock(raw);
  if (typeof p === "string") return streaming
    ? <div className="my-4 rounded-2xl border border-line bg-panel/50 px-4 py-6 flex items-center gap-2.5 text-[13px] text-muted not-prose" role="status"><Loader2 size={15} className="animate-spin text-accent" />Préparation du fichier…</div>
    : <div className="my-3"><div role="alert" className="text-xs text-warning mb-1.5">Fichier : {p} — affichage du contenu brut.</div><pre className="bg-bg border border-line rounded-xl p-4 overflow-auto text-[12.5px] max-h-80">{raw}</pre></div>;
  const bytes = new Blob([p.content]).size; const size = bytes < 1024 ? `${bytes} o` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} Ko`;
  const d = streaming ? { note: "" } as ReturnType<typeof describeFile> : describeFile(p.name, p.content); const ext = extOf(p.name);
  const save = async () => { setBusy(true); try { const f = await api("file.saveGenerated", p.name, p.content); if (f) toast(`Fichier enregistré : ${f}`, "success"); } catch (e: any) { toast(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "error"); } finally { setBusy(false); } };
  return <div className="my-4 rounded-2xl border border-line bg-panel/60 not-prose px-4 py-3">
    <div className="flex items-center gap-3"><span className="w-10 h-10 rounded-xl bg-accent-subtle text-accent grid place-items-center shrink-0">{d.problem ? <AlertTriangle size={18} /> : <FileDown size={18} />}</span>
      <div className="min-w-0 flex-1"><div className="text-[14px] font-medium truncate select-text">{p.name}</div><div className="text-xs text-muted tnum">{d.label ? `${d.label} · ` : ext ? `.${ext} · ` : ""}{size}{d.note ? ` · ${d.note}` : ""}{streaming ? " · en cours d'écriture…" : ""}</div></div>
      <button className="btn btn-sm" disabled={streaming} title="Copie le contenu source" onClick={() => { void navigator.clipboard?.writeText(p.content).catch(() => {}); setOk(true); setTimeout(() => setOk(false), 1400); }}>{ok ? <Check size={13} /> : <Copy size={13} />}Copier</button>
      <button className="btn btn-sm btn-primary" disabled={streaming || busy || !!d.problem} onClick={() => void save()}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}Enregistrer</button></div>
    {d.problem && <p role="alert" className="text-xs text-warning mt-2">{d.problem}</p>}</div>;
}
