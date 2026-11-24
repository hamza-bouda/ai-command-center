import { FileCode2, Volume2, VolumeX } from "lucide-react"; import { canSpeak, speak, stopSpeaking } from "../speech";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Paperclip, X as XIcon, Star, Search, Plus, Archive, ArchiveRestore, Trash2, Download, Copy, Check, RefreshCw, Send, Square, History, MessageSquare, CornerUpRight, Pencil, GitBranch, Globe, ShieldAlert, Loader2, XCircle, ChevronRight, Lock, FolderGit2, FileText } from "lucide-react";
import { api, fmt, usd, ago } from "../api"; import { useData } from "../hooks"; import { toast, confirmDialog } from "../overlay";
import { Badge, Drawer, Modal, Field, Segmented, Disclaimer, StatusIndicator } from "../ui";
import { Md, ToolCallBlock } from "../pages/Sessions"; import { LimitBanner } from "./LimitBanner"; import { Composer, type Attach } from "./Composer"; import { useAttachFlow } from "./attachFlow"; import { useImageInput } from "./imageInput"; import { ChatActions, RichScope } from "./RichBlocks"; import { AIModelConfiguration, AIConfig, Mode, PROVIDER_LABEL, effortLabel } from "./AIModelConfiguration";


/** Message de l'utilisateur, modifiable : « Modifier » crée une branche (nouvelle conversation) à partir de ce point, l'original reste intact. */
export function UserMessage({ m, canEdit, code, before, onBranch }: { m: any; canEdit: boolean; code: boolean; before: number; onBranch: (text: string) => Promise<void> }) {
  const raw = String(m.content); const hasFiles = /\n\n[🖼📎] /u.test(raw); const clean = raw.replace(/\n\n[🖼📎] [\s\S]*$/u, "");
  const [editing, setEditing] = useState(false); const [text, setText] = useState(clean); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const submit = async () => { if (!text.trim() || busy) return; setBusy(true); setErr(""); try { await onBranch(text.trim()); setEditing(false); } catch (e: any) { setErr(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, "")); } finally { setBusy(false); } };
  if (editing) return <div className="mb-5 msg-in flex justify-end"><div className="w-full max-w-[640px] rounded-2xl border border-accent bg-panel p-3 shadow-lg">
    <textarea autoFocus className="input !h-auto" rows={Math.min(8, Math.max(3, text.split("\n").length + 1))} value={text} onChange={(e) => setText(e.target.value)} aria-label="Message modifié" onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void submit(); }} />
    <ul className="text-2xs text-muted mt-2 space-y-0.5 list-disc pl-4"><li>Une <b>nouvelle conversation</b> est créée à partir de ce point ; l'originale reste intacte.</li><li>L'historique précédent (≈ {Math.round(before / 4).toLocaleString("fr-FR")} tokens) est renvoyé au modèle.</li>{hasFiles && <li className="text-warning">Les pièces jointes ne sont pas reprises : ajoutez-les de nouveau si besoin.</li>}{code && <li className="text-warning">Les fichiers déjà modifiés sur le disque ne sont pas annulés.</li>}</ul>
    {err && <p role="alert" className="text-xs text-danger mt-2">{err}</p>}
    <div className="flex justify-end gap-2 mt-3"><button className="btn btn-sm" onClick={() => { setEditing(false); setText(clean); }}>Annuler</button><button className="btn btn-sm btn-primary" disabled={!text.trim() || busy} onClick={() => void submit()}>{busy ? "Création…" : "Envoyer dans une nouvelle branche"}</button></div></div></div>;
  return <div className="group/user flex justify-end items-start gap-1.5 mb-5 msg-in">
    {canEdit && <button className="btn btn-ghost btn-icon !h-7 !w-7 mt-1.5 opacity-0 group-hover/user:opacity-100 focus-visible:opacity-100 transition-opacity" aria-label="Modifier ce message" title="Modifier et relancer (nouvelle branche)" onClick={() => { setText(clean); setEditing(true); }}><Pencil size={13} /></button>}
    <div className="max-w-[80%] bg-raised border border-line rounded-2xl rounded-br-md px-4 py-2.5 text-[14px] whitespace-pre-wrap">{m.content}</div></div>;
}
/** Bandeau des conversations nées d'une modification de message. */
export function ParentLink({ id, mode }: { id: string; mode: Mode }) {
  const { data: parent } = useData<any>("conv.get", [id]); if (!parent) return null;
  return <div className="mb-4 flex items-center gap-2 text-xs text-muted"><GitBranch size={13} className="text-accent" />Branche créée en modifiant un message de <button className="text-accent hover:underline truncate max-w-[280px]" onClick={() => { window.location.hash = `/${mode === "code" ? "code" : "chat"}?open=${id}`; }}>« {String(parent.title).replace(/ \(modifié\)$/, "")} »</button></div>;
}

export function logBlocks(logs: any[] = [], withTools: boolean) {
  const out: any[] = []; const tools = new Map<string, any>();
  for (const l of logs) { if (l.kind === "text") { const last = out[out.length - 1]; if (last?.k === "text") last.text += l.content; else out.push({ k: "text", text: l.content, id: l.id }); }
    else if (l.kind === "tool" && withTools) { const t = JSON.parse(l.content); const ex = tools.get(t.id); if (ex) { ex.state = t.state; ex.name = ex.name || t.name; ex.summary = ex.summary || t.summary; } else { const b = { k: "tool", ...t, bid: l.id }; tools.set(t.id, b); out.push(b); } }
    else if (l.kind === "file_change" && withTools) out.push({ k: "files", files: JSON.parse(l.content), id: l.id }); else if (l.kind === "error") out.push({ k: "err", text: l.content, id: l.id }); }
  return out;
}
export function ToolsOf({ execId }: { execId: string }) { // outils / commandes / fichiers d'un tour terminé (modes Work et Code)
  const { data: logs } = useData<any[]>("executions.logs", [execId]); const bl = logBlocks(logs, true).filter((b) => b.k === "tool" || b.k === "files");
  if (!bl.length) return null;
  return <div className="mb-2">{bl.map((b) => b.k === "tool" ? <ToolCallBlock key={b.bid} tool={b} /> : <div key={b.id} className="text-xs text-success flex items-center gap-1.5 my-1"><FileText size={12} />Fichiers modifiés : <span className="mono">{b.files.join(", ")}</span></div>)}</div>;
}
export function LiveTurn({ execId, mode }: { execId: string; mode: Mode }) {
  const { data: logs } = useData<any[]>("executions.logs", [execId], { events: /execution\./, every: 1500 }); const { data: ex } = useData<any>("executions.get", [execId], { events: /execution\./ });
  const bl = logBlocks(logs, mode !== "chat");
  return <div className="flex gap-3"><div className="min-w-0 flex-1"><RichScope.Provider value={{ scope: "live", streaming: true }}>{bl.map((b) => b.k === "text" ? <Md key={"t" + b.id} text={b.text} /> : b.k === "tool" ? <ToolCallBlock key={"c" + b.bid} tool={b} /> : b.k === "files" ? <div key={b.id} className="text-xs text-success my-1">Fichiers modifiés : <span className="mono">{b.files.join(", ")}</span></div> : <div key={b.id} role="alert" className="text-danger text-[13px] my-2 flex gap-2"><XCircle size={15} className="mt-0.5 shrink-0" />{b.text}</div>)}</RichScope.Provider>
    <div className="flex items-center gap-2 text-xs text-muted mt-2" role="status">{ex?.status === "waiting_approval" ? <><ShieldAlert size={13} className="text-warning" />En attente d'approbation</> : ex?.status === "queued" ? <><Loader2 size={13} className="animate-spin" />En file d'attente…</> : <><span className="flex gap-1">{[0, 1, 2].map((i) => <span key={i} className="w-1.5 h-1.5 rounded-full bg-accent pulse-dot" style={{ animationDelay: `${i * 0.2}s` }} />)}</span>Génération en cours…</>}</div></div></div>;
}

export function UsageDrawer({ msg, onClose }: { msg: any; onClose: () => void }) {
  const { data: rows } = useData<any[]>("executions.usage", [msg?.execution_id ?? ""]);
  return <Drawer open={!!msg} onClose={onClose} width={420} title="Détails de la réponse">{msg && <div className="space-y-4 text-[13px]">
    <dl className="grid grid-cols-2 gap-3"><div><dt className="text-muted text-xs">Fournisseur</dt><dd><Badge v={msg.provider} /></dd></div><div><dt className="text-muted text-xs">Modèle</dt><dd>{msg.model ?? "—"}</dd></div>
      <div><dt className="text-muted text-xs">Effort appliqué</dt><dd>{msg.effort_applied ? effortLabel(msg.effort_applied) : "Géré par le fournisseur"}</dd></div><div><dt className="text-muted text-xs">Statut</dt><dd>{msg.status}</dd></div></dl>
    {rows?.length ? rows.map((r) => <div key={r.id} className="card p-3 space-y-1 tnum">{[["Input (hors cache)", fmt(r.input)], ["Output", fmt(r.output)], ["Cache lu", fmt(r.cache_read)], ["Cache écrit", fmt(r.cache_write)], ["Total", fmt(r.total)]].map(([k, v]) => <div key={k} className="flex justify-between"><span className="text-muted">{k}</span><span className={k === "Total" ? "font-medium" : ""}>{v}</span></div>)}
      <div className="flex justify-between"><span className="text-muted">Équivalent API</span><span>{usd(r.calculated_usd)}</span></div>{r.provider_cost_usd != null && <div className="flex justify-between"><span className="text-muted">Coût rapporté par le CLI</span><span>${r.provider_cost_usd.toFixed(4)}</span></div>}<div className="flex justify-between items-center"><span className="text-muted">Fiabilité</span><Badge v={r.confidence} /></div>{r.note && <p className="text-xs text-muted pt-1">{r.note}</p>}</div>) : <p className="text-muted">Aucune mesure reçue pour cette réponse.</p>}
    <Disclaimer /><p className="text-xs text-muted">Seules les utilisations observées par AI Command Center sont comptées ; les conversations menées directement sur chatgpt.com ou claude.ai ne sont pas visibles.</p></div>}</Drawer>;
}
export function HistoryDrawer({ id, open, onClose }: { id: string; open: boolean; onClose: () => void }) {
  const { data: h } = useData<any[]>("conv.history", [id], { events: /conversation/ });
  const LBL: Record<string, string> = { created: "Création", provider_changed: "Fournisseur modifié", model_changed: "Modèle modifié", effort_changed: "Effort modifié", new_session: "Nouvelle session", context_imported: "Contexte importé" };
  return <Drawer open={open} onClose={onClose} width={420} title="Historique de configuration"><ol className="relative border-l border-line ml-2 space-y-4">{(h ?? []).map((x) => <li key={x.id} className="ml-4"><div className="text-[13px] font-medium">{LBL[x.kind] ?? x.kind}</div><div className="text-xs text-fg2">{x.detail}</div><div className="text-2xs text-muted tnum">{new Date(x.at).toLocaleString("fr-FR")}</div></li>)}</ol></Drawer>;
}
export function ContinueInCode({ id, open, onClose, selection }: { id: string; open: boolean; onClose: () => void; selection?: string }) {
  const { data: projects } = useData<any[]>("projects.list", []); const [pid, setPid] = useState(""); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { const cid = await api("conv.continueInCode", id, pid, selection || undefined); toast("Conversation Code créée avec le contexte transmis.", "success"); onClose(); window.location.hash = `/code?open=${cid}`; } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); } };
  return <Modal open={open} onClose={onClose} title="Continuer dans Code" footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={!pid || busy} onClick={go}>Continuer</button></>}>
    <p className="text-fg2 text-[13px] mb-4">Une nouvelle conversation Code est créée dans le projet choisi. Le contexte récent (ou le texte sélectionné) lui est transmis explicitement ; la conversation actuelle n'est pas déplacée.</p>
    {!projects?.length ? <p className="text-warning text-[13px]">Ajoutez d'abord un projet dans Code.</p> : <Field label="Projet"><select className="input" value={pid} onChange={(e) => setPid(e.target.value)}><option value="">Choisir un projet…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}</Modal>;
}


export function GitDiff({ open, onClose, path }: { open: boolean; onClose: () => void; path: string }) {
  const [state, setState] = useState<{ files: any[]; diff: string }>();
  useEffect(() => { if (!open) return; setState(undefined); Promise.all([api("git.changes", path), api("git.diff", path)]).then(([c, d]) => setState({ files: c.files, diff: d })).catch((e) => toast(e.message, "error")); }, [open, path]);
  return <Drawer open={open} onClose={onClose} width={640} title="Modifications Git du projet">{!state ? <p className="text-muted">Chargement…</p> : <div><p className="text-[13px] text-fg2 mb-3">{state.files.length} fichier(s) modifié(s) non commité(s)</p>{state.files.map((f) => <div key={f.path} className="mono text-xs py-0.5"><span className="text-warning inline-block w-6">{f.status}</span>{f.path}</div>)}
    <div className="mt-4 bg-bg border border-line rounded-xl overflow-auto max-h-[60vh] text-[12px] mono">{state.diff ? state.diff.split("\n").map((l, i) => <div key={i} className={`px-3 whitespace-pre ${l.startsWith("+") && !l.startsWith("+++") ? "bg-[var(--success-subtle)] text-success" : l.startsWith("-") && !l.startsWith("---") ? "bg-[var(--danger-subtle)] text-danger" : l.startsWith("@@") ? "text-info" : "text-fg2"}`}>{l || " "}</div>) : <div className="p-3 text-muted">Aucune différence.</div>}</div></div>}</Drawer>;
}


