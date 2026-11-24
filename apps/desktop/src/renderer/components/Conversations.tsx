import { FileCode2 } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Paperclip, X as XIcon, Star, Search, Plus, Archive, ArchiveRestore, Trash2, Download, Copy, Check, RefreshCw, Send, Square, History, MessageSquare, CornerUpRight, Pencil, GitBranch, Globe, ShieldAlert, Loader2, XCircle, ChevronRight, Lock, FolderGit2, FileText } from "lucide-react";
import { api, fmt, usd, ago } from "../api"; import { useData } from "../hooks"; import { toast, confirmDialog } from "../overlay";
import { Badge, Drawer, Modal, Field, Segmented, Disclaimer, StatusIndicator } from "../ui";
import { Md, ToolCallBlock } from "../pages/Sessions"; import { LimitBanner } from "./LimitBanner"; import { Composer, type Attach } from "./Composer"; import { useAttachFlow } from "./attachFlow"; import { useImageInput } from "./imageInput"; import { ChatActions, RichScope } from "./RichBlocks"; import { AIModelConfiguration, AIConfig, Mode, PROVIDER_LABEL, effortLabel } from "./AIModelConfiguration";

// ---------------- liste ----------------
/** Message de l'utilisateur, modifiable : « Modifier » crée une branche (nouvelle conversation) à partir de ce point, l'original reste intact. */
function UserMessage({ m, canEdit, code, before, onBranch }: { m: any; canEdit: boolean; code: boolean; before: number; onBranch: (text: string) => Promise<void> }) {
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
function ParentLink({ id, mode }: { id: string; mode: Mode }) {
  const { data: parent } = useData<any>("conv.get", [id]); if (!parent) return null;
  return <div className="mb-4 flex items-center gap-2 text-xs text-muted"><GitBranch size={13} className="text-accent" />Branche créée en modifiant un message de <button className="text-accent hover:underline truncate max-w-[280px]" onClick={() => { window.location.hash = `/${mode === "code" ? "code" : "chat"}?open=${id}`; }}>« {String(parent.title).replace(/ \(modifié\)$/, "")} »</button></div>;
}
const RICH_LABEL: Record<string, string> = { quiz: "QCM", qcm: "QCM", choices: "Choix", chart: "Graphique", mermaid: "Diagramme", artifact: "Aperçu HTML", svg: "Image SVG" };
/** Aperçu d'une conversation : les blocs enrichis (JSON, HTML) sont remplacés par leur nom au lieu d'afficher le code brut. */
const cleanPreview = (p: unknown) => String(p).replace(/```(\w+)[\s\S]*?(```|$)/g, (_m, l: string) => (RICH_LABEL[l] ? `[${RICH_LABEL[l]}]` : "[code]")).replace(/\s+/g, " ").trim().slice(0, 60);
export function ConversationList({ mode, selected, onSelect, onNew, projectId, newLabel = "Nouveau chat", emptyHint }: { mode: Mode; selected?: string; onSelect: (id: string) => void; onNew: () => void; projectId?: string; newLabel?: string; emptyHint?: string }) {
  const [q, setQ] = useState(""); const [view, setView] = useState<"recent" | "fav" | "archived">("recent");
  const f = useMemo(() => ({ mode, q: q || undefined, favorite: view === "fav", archived: view === "archived", projectId, submode: mode === "code" ? "direct" : undefined }), [mode, q, view, projectId]);
  const { data: list, reload } = useData<any[]>("conv.list", [f], { events: /conversation|execution\.(completed|failed|cancelled)/ });
  const groups = useMemo(() => { const today = new Date(); today.setHours(0, 0, 0, 0); const day = 86400000; const out: [string, any[]][] = [["Aujourd'hui", []], ["Hier", []], ["7 derniers jours", []], ["Plus ancien", []]];
    for (const c of list ?? []) { const age = (today.getTime() - new Date(c.updated_at).getTime()) / day; out[age <= 0 ? 0 : age <= 1 ? 1 : age <= 7 ? 2 : 3]![1].push(c); } return out.filter(([, l]) => l.length); }, [list]);
  return <div className="w-[272px] shrink-0 border-r border-line flex flex-col min-h-0 bg-[var(--sidebar)]/40">
    <div className="p-3 space-y-2.5"><button className="btn btn-primary w-full" onClick={onNew}><Plus size={15} />{newLabel}</button>
      <div className="relative"><Search size={14} className="absolute left-3 top-2.5 text-muted" /><input className="input !pl-9 !bg-transparent" placeholder="Rechercher…" aria-label="Rechercher dans les conversations" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <Segmented label="Filtre" value={view} onChange={setView} options={[["recent", "Récents"], ["fav", <Star key="s" size={13} />, "Favoris"], ["archived", <Archive key="a" size={13} />, "Archivés"]]} /></div>
    <div className="flex-1 overflow-auto px-2 pb-3" role="listbox" aria-label="Conversations">
      {!list?.length ? <p className="text-muted text-xs text-center px-4 py-10">{q ? "Aucun résultat." : view === "fav" ? "Aucune conversation favorite." : view === "archived" ? "Aucune conversation archivée." : emptyHint ?? "Aucune conversation pour le moment."}</p>
        : groups.map(([label, items]) => <div key={label} className="mb-2"><div className="px-3 pt-3 pb-1 text-2xs font-semibold text-muted uppercase tracking-wider">{label}</div>
          {items.map((c) => <div key={c.id} role="option" aria-selected={selected === c.id} tabIndex={0} onClick={() => onSelect(c.id)} onKeyDown={(e) => e.key === "Enter" && onSelect(c.id)} className={`group relative rounded-xl px-3 py-2 mb-0.5 cursor-pointer transition-all duration-150 active:scale-[.99] ${selected === c.id ? "bg-raised shadow-[inset_0_0_0_1px_var(--border)]" : "hover:bg-raised/70"}`}>
            {selected === c.id && <span className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r-full bg-accent anim-fade" aria-hidden />}
            <div className="flex items-center gap-1.5"><span className="text-[13px] font-medium truncate flex-1">{c.title}</span>{c.active > 0 && <Loader2 size={12} className="animate-spin text-accent shrink-0" aria-label="Réponse en cours" />}
              <button aria-label={c.favorite ? "Retirer des favoris" : "Ajouter aux favoris"} className={`shrink-0 transition-opacity ${c.favorite ? "text-warning" : "text-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`} onClick={async (e) => { e.stopPropagation(); await api("conv.favorite", c.id, !c.favorite); reload(); }}><Star size={13} fill={c.favorite ? "currentColor" : "none"} /></button></div>
            <div className="text-xs text-muted truncate mt-0.5">{c.preview ? cleanPreview(c.preview) : "Conversation vide"}</div>
            <div className="text-2xs text-muted mt-0.5 flex gap-1.5 tnum"><span>{PROVIDER_LABEL[c.provider as "claude" | "codex"]}</span><span>·</span><span>{ago(c.updated_at)}</span>{c.tokens > 0 && <><span>·</span><span>{fmt(c.tokens)} tok</span></>}</div></div>)}</div>)}</div></div>;
}

function logBlocks(logs: any[] = [], withTools: boolean) {
  const out: any[] = []; const tools = new Map<string, any>();
  for (const l of logs) { if (l.kind === "text") { const last = out[out.length - 1]; if (last?.k === "text") last.text += l.content; else out.push({ k: "text", text: l.content, id: l.id }); }
    else if (l.kind === "tool" && withTools) { const t = JSON.parse(l.content); const ex = tools.get(t.id); if (ex) { ex.state = t.state; ex.name = ex.name || t.name; ex.summary = ex.summary || t.summary; } else { const b = { k: "tool", ...t, bid: l.id }; tools.set(t.id, b); out.push(b); } }
    else if (l.kind === "file_change" && withTools) out.push({ k: "files", files: JSON.parse(l.content), id: l.id }); else if (l.kind === "error") out.push({ k: "err", text: l.content, id: l.id }); }
  return out;
}
function ToolsOf({ execId }: { execId: string }) { // outils / commandes / fichiers d'un tour terminé (modes Work et Code)
  const { data: logs } = useData<any[]>("executions.logs", [execId]); const bl = logBlocks(logs, true).filter((b) => b.k === "tool" || b.k === "files");
  if (!bl.length) return null;
  return <div className="mb-2">{bl.map((b) => b.k === "tool" ? <ToolCallBlock key={b.bid} tool={b} /> : <div key={b.id} className="text-xs text-success flex items-center gap-1.5 my-1"><FileText size={12} />Fichiers modifiés : <span className="mono">{b.files.join(", ")}</span></div>)}</div>;
}
function LiveTurn({ execId, mode }: { execId: string; mode: Mode }) {
  const { data: logs } = useData<any[]>("executions.logs", [execId], { events: /execution\./, every: 1500 }); const { data: ex } = useData<any>("executions.get", [execId], { events: /execution\./ });
  const bl = logBlocks(logs, mode !== "chat");
  return <div className="flex gap-3"><div className="min-w-0 flex-1"><RichScope.Provider value={{ scope: "live", streaming: true }}>{bl.map((b) => b.k === "text" ? <Md key={"t" + b.id} text={b.text} /> : b.k === "tool" ? <ToolCallBlock key={"c" + b.bid} tool={b} /> : b.k === "files" ? <div key={b.id} className="text-xs text-success my-1">Fichiers modifiés : <span className="mono">{b.files.join(", ")}</span></div> : <div key={b.id} role="alert" className="text-danger text-[13px] my-2 flex gap-2"><XCircle size={15} className="mt-0.5 shrink-0" />{b.text}</div>)}</RichScope.Provider>
    <div className="flex items-center gap-2 text-xs text-muted mt-2" role="status">{ex?.status === "waiting_approval" ? <><ShieldAlert size={13} className="text-warning" />En attente d'approbation</> : ex?.status === "queued" ? <><Loader2 size={13} className="animate-spin" />En file d'attente…</> : <><span className="flex gap-1">{[0, 1, 2].map((i) => <span key={i} className="w-1.5 h-1.5 rounded-full bg-accent pulse-dot" style={{ animationDelay: `${i * 0.2}s` }} />)}</span>Génération en cours…</>}</div></div></div>;
}

function UsageDrawer({ msg, onClose }: { msg: any; onClose: () => void }) {
  const { data: rows } = useData<any[]>("executions.usage", [msg?.execution_id ?? ""]);
  return <Drawer open={!!msg} onClose={onClose} width={420} title="Détails de la réponse">{msg && <div className="space-y-4 text-[13px]">
    <dl className="grid grid-cols-2 gap-3"><div><dt className="text-muted text-xs">Fournisseur</dt><dd><Badge v={msg.provider} /></dd></div><div><dt className="text-muted text-xs">Modèle</dt><dd>{msg.model ?? "—"}</dd></div>
      <div><dt className="text-muted text-xs">Effort appliqué</dt><dd>{msg.effort_applied ? effortLabel(msg.effort_applied) : "Géré par le fournisseur"}</dd></div><div><dt className="text-muted text-xs">Statut</dt><dd>{msg.status}</dd></div></dl>
    {rows?.length ? rows.map((r) => <div key={r.id} className="card p-3 space-y-1 tnum">{[["Input (hors cache)", fmt(r.input)], ["Output", fmt(r.output)], ["Cache lu", fmt(r.cache_read)], ["Cache écrit", fmt(r.cache_write)], ["Total", fmt(r.total)]].map(([k, v]) => <div key={k} className="flex justify-between"><span className="text-muted">{k}</span><span className={k === "Total" ? "font-medium" : ""}>{v}</span></div>)}
      <div className="flex justify-between"><span className="text-muted">Équivalent API</span><span>{usd(r.calculated_usd)}</span></div>{r.provider_cost_usd != null && <div className="flex justify-between"><span className="text-muted">Coût rapporté par le CLI</span><span>${r.provider_cost_usd.toFixed(4)}</span></div>}<div className="flex justify-between items-center"><span className="text-muted">Fiabilité</span><Badge v={r.confidence} /></div>{r.note && <p className="text-xs text-muted pt-1">{r.note}</p>}</div>) : <p className="text-muted">Aucune mesure reçue pour cette réponse.</p>}
    <Disclaimer /><p className="text-xs text-muted">Seules les utilisations observées par AI Command Center sont comptées ; les conversations menées directement sur chatgpt.com ou claude.ai ne sont pas visibles.</p></div>}</Drawer>;
}
function HistoryDrawer({ id, open, onClose }: { id: string; open: boolean; onClose: () => void }) {
  const { data: h } = useData<any[]>("conv.history", [id], { events: /conversation/ });
  const LBL: Record<string, string> = { created: "Création", provider_changed: "Fournisseur modifié", model_changed: "Modèle modifié", effort_changed: "Effort modifié", new_session: "Nouvelle session", context_imported: "Contexte importé" };
  return <Drawer open={open} onClose={onClose} width={420} title="Historique de configuration"><ol className="relative border-l border-line ml-2 space-y-4">{(h ?? []).map((x) => <li key={x.id} className="ml-4"><div className="text-[13px] font-medium">{LBL[x.kind] ?? x.kind}</div><div className="text-xs text-fg2">{x.detail}</div><div className="text-2xs text-muted tnum">{new Date(x.at).toLocaleString("fr-FR")}</div></li>)}</ol></Drawer>;
}
function ContinueInCode({ id, open, onClose, selection }: { id: string; open: boolean; onClose: () => void; selection?: string }) {
  const { data: projects } = useData<any[]>("projects.list", []); const [pid, setPid] = useState(""); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { const cid = await api("conv.continueInCode", id, pid, selection || undefined); toast("Conversation Code créée avec le contexte transmis.", "success"); onClose(); window.location.hash = `/code?open=${cid}`; } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); } };
  return <Modal open={open} onClose={onClose} title="Continuer dans Code" footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={!pid || busy} onClick={go}>Continuer</button></>}>
    <p className="text-fg2 text-[13px] mb-4">Une nouvelle conversation Code est créée dans le projet choisi. Le contexte récent (ou le texte sélectionné) lui est transmis explicitement ; la conversation actuelle n'est pas déplacée.</p>
    {!projects?.length ? <p className="text-warning text-[13px]">Ajoutez d'abord un projet dans Code.</p> : <Field label="Projet"><select className="input" value={pid} onChange={(e) => setPid(e.target.value)}><option value="">Choisir un projet…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}</Modal>;
}

// ---------------- conversation complète ----------------
/** `embedded` : conversation d'un espace Work — l'en-tête, le renommage, l'archivage et la suppression appartiennent au travail, pas à la conversation. */
export function ConversationView({ id, mode, onChanged, onDeleted, placeholder, embedded }: { id: string; mode: Mode; onChanged?: () => void; onDeleted?: () => void; placeholder?: string; embedded?: boolean }) {
  const { data: conv, reload: reloadConv } = useData<any>("conv.get", [id], { events: /conversation/ });
  const { data: msgs, reload: reloadMsgs } = useData<any[]>("conv.messages", [id], { events: /conversation|usage/ });
  const { data: active } = useData<any>("conv.active", [id], { events: /execution|conversation/, every: 2000 });
  const { data: projects } = useData<any[]>("projects.list", []); const { data: appr, reload: reloadAppr } = useData<any[]>("approvals.pending", [], { events: /approval|execution/ });
  const [cfg, setCfg] = useState<AIConfig>({ provider: "claude", model: null, effort: null }); const [text, setText] = useState(""); const [sending, setSending] = useState(false); const [usageMsg, setUsageMsg] = useState<any>(); const [hist, setHist] = useState(false); const [cont, setCont] = useState(false); const [renaming, setRenaming] = useState(false); const [title, setTitle] = useState(""); const [diffOpen, setDiffOpen] = useState(false); const [copied, setCopied] = useState<string>(); const [attach, setAttach] = useState<Attach[]>([]); const af = useAttachFlow(setAttach); const [imgs, setImgs] = useState<{ name: string; mime: string; data: string }[]>([]); const im = useImageInput(setImgs); const [limit, setLimit] = useState(80);
  const scroller = useRef<HTMLDivElement>(null); const inner = useRef<HTMLDivElement>(null); const stick = useRef(true); const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (conv) setCfg({ provider: conv.provider, model: conv.model, effort: conv.effort }); }, [conv?.id, conv?.provider, conv?.model, conv?.effort]);
  useEffect(() => { stick.current = true; setText(""); setAttach([]); setImgs([]); setLimit(80); }, [id]);
  useEffect(() => { const el = inner.current; if (!el) return; const ro = new ResizeObserver(() => { if (stick.current) scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }); ro.observe(el); return () => ro.disconnect(); }, [id]);
  useEffect(() => { const t = ta.current; if (t) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 220) + "px"; } }, [text]);
  const busy = !!active; const project = projects?.find((p) => p.id === conv?.project_id); const lastAssistant = [...(msgs ?? [])].reverse().find((m) => m.role === "assistant");
  const pending = (appr ?? []).filter((a) => a.execution_id === active?.id);
  if (!conv) return <div className="flex-1 grid place-items-center text-muted text-[13px]">Chargement…</div>;

  const send = async (override?: string) => { const t = (override ?? text).trim(); if (!t || busy || sending) return; setSending(true); try { stick.current = true; const r = await api("conv.send", id, t, cfg, override ? [] : attach, override ? [] : imgs); if (!override) { setText(""); setAttach([]); setImgs([]); } if (r.notice) toast(r.notice, "info"); reloadMsgs(); reloadConv(); onChanged?.(); } catch (e: any) { toast(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "error"); } finally { setSending(false); ta.current?.focus(); } };
  const act = async (fn: () => Promise<any>, ok?: string) => { try { await fn(); if (ok) toast(ok, "success"); reloadConv(); onChanged?.(); } catch (e: any) { toast(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "error"); } };
  const changedCfg = conv.provider !== cfg.provider || (conv.model ?? null) !== cfg.model || (conv.effort ?? null) !== cfg.effort;
  const genOn = mode === "chat" && !!conv.image && conv.provider === "codex"; const policyBadge = mode === "chat" && (conv.web || genOn) ? <span className="inline-flex items-center gap-1 text-xs text-warning" title="Aucune commande, aucun fichier, aucun agent. Seuls les outils activés (recherche web, génération d'images) sont autorisés pour cette conversation."><Globe size={12} />Chat · {[conv.web ? "recherche web" : "", genOn ? "images" : ""].filter(Boolean).join(" + ")} activé{conv.web && genOn ? "s" : conv.web ? "e" : "es"}</span> : mode === "chat" ? <span className="inline-flex items-center gap-1 text-xs text-success" title="Aucune commande, aucun fichier, aucun agent. Voir le détail dans la configuration."><Lock size={12} />Chat · sans outils</span> : mode === "work" ? <span className="inline-flex items-center gap-1 text-xs text-info"><FolderGit2 size={12} />Work · dossier de travail dédié</span> : <span className="inline-flex items-center gap-1 text-xs text-warning"><GitBranch size={12} />Code · {project?.name ?? "projet"}</span>;

  return <ChatActions.Provider value={{ send: (t) => void send(t), busy: busy || sending }}><div className="flex-1 flex flex-col min-w-0 min-h-0">{af.element}
    <div className="h-14 shrink-0 border-b border-line flex items-center gap-3 px-5">
      <div className="min-w-0 flex-1">{embedded ? <div className="text-[13px] font-medium">Conversation du travail</div> : renaming ? <input autoFocus className="input !h-8 !w-80" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => setRenaming(false)} onKeyDown={async (e) => { if (e.key === "Escape") setRenaming(false); if (e.key === "Enter") { await act(() => api("conv.rename", id, title)); setRenaming(false); } }} aria-label="Titre" />
        : <button className="font-medium truncate max-w-full text-left hover:text-accent inline-flex items-center gap-1.5" title="Renommer" onClick={() => { setTitle(conv.title); setRenaming(true); }}>{conv.title}<Pencil size={12} className="text-muted" /></button>}
        <div className="flex items-center gap-3 text-xs text-muted min-w-0 overflow-hidden whitespace-nowrap [&>:first-child]:shrink-0">{policyBadge}<span className="truncate min-w-0">{PROVIDER_LABEL[conv.provider as "claude" | "codex"]} · {conv.model || "modèle par défaut"} · effort {conv.effort ? effortLabel(conv.effort) : "auto"}</span></div></div>
      {!embedded && <button className="btn btn-ghost btn-icon" aria-label={conv.favorite ? "Retirer des favoris" : "Ajouter aux favoris"} onClick={() => act(() => api("conv.favorite", id, !conv.favorite))}><Star size={16} className={conv.favorite ? "text-warning" : ""} fill={conv.favorite ? "currentColor" : "none"} /></button>}
      {mode !== "code" && <button className="btn btn-sm" title="Continuer dans Code" aria-label="Continuer dans Code" onClick={() => setCont(true)} disabled={!msgs?.length}><CornerUpRight size={13} /><span className="hidden 2xl:inline">Continuer dans Code</span></button>}
      {mode === "code" && project?.git_repo ? <button className="btn btn-sm" onClick={() => setDiffOpen(true)}><GitBranch size={13} />Git diff</button> : null}
      <button className="btn btn-ghost btn-icon" aria-label="Historique de configuration" title="Historique de configuration" onClick={() => setHist(true)}><History size={16} /></button>
      <button className="btn btn-ghost btn-icon" aria-label="Exporter en Markdown" title="Exporter" onClick={() => act(async () => { const p = await api("conv.export", id, "md"); if (p) toast(`Exporté : ${p}`, "success"); })}><Download size={16} /></button>
      <button className="btn btn-ghost btn-icon" aria-label="Exporter en page web (HTML)" title="Page web autonome (graphiques et images inclus)" onClick={() => act(async () => { toast("Mise en page de l'export…", "info"); const p = await api("conv.exportRich", id, "html"); if (p) toast(`Exporté : ${p}`, "success"); })}><FileCode2 size={16} /></button>
      <button className="btn btn-ghost btn-icon" aria-label="Exporter en PDF" title="Document PDF" onClick={() => act(async () => { toast("Mise en page de l'export…", "info"); const p = await api("conv.exportRich", id, "pdf"); if (p) toast(`Exporté : ${p}`, "success"); })}><FileText size={16} /></button>
      {!embedded && <>      <button className="btn btn-ghost btn-icon" aria-label={conv.archived ? "Désarchiver" : "Archiver"} title={conv.archived ? "Désarchiver" : "Archiver"} onClick={() => act(() => api("conv.archive", id, !conv.archived), conv.archived ? "Conversation restaurée." : "Conversation archivée.")}>{conv.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}</button>
      <button className="btn btn-ghost btn-icon" aria-label="Supprimer" title="Supprimer" onClick={async () => { if (await confirmDialog({ title: "Supprimer cette conversation ?", body: "Les messages seront supprimés définitivement. Les statistiques de consommation déjà mesurées sont conservées.", confirmLabel: "Supprimer", danger: true })) act(async () => { await api("conv.remove", id); onDeleted?.(); }, "Conversation supprimée."); }}><Trash2 size={16} /></button></>}</div>

    <div ref={scroller} onScroll={(e) => { const s = e.currentTarget; stick.current = s.scrollHeight - s.scrollTop - s.clientHeight < 80; }} className="flex-1 overflow-auto px-6 py-6">
      <div ref={inner} className="max-w-[760px] mx-auto">
        {!msgs?.length && !busy && <div className="text-center text-muted text-[13px] py-16">Écrivez votre premier message ci-dessous.</div>}
        {(msgs?.length ?? 0) > limit && <div className="text-center mb-4"><button className="btn btn-sm" onClick={() => setLimit(limit + 80)}>Afficher les {Math.min(80, (msgs?.length ?? 0) - limit)} messages précédents</button></div>}
        {conv.parent_id && <ParentLink id={conv.parent_id} mode={mode} />}{(msgs ?? []).slice(-limit).map((m) => m.role === "user" ? <UserMessage key={m.id} m={m} canEdit={mode !== "work" && !busy && !sending} code={mode === "code"} before={(msgs ?? []).slice(0, (msgs ?? []).findIndex((x) => x.id === m.id)).reduce((n, x) => n + String(x.content).length, 0)} onBranch={async (text) => { const r = await api("conv.branch", id, m.id, text, cfg); window.location.hash = `/${mode === "code" ? "code" : "chat"}?open=${r.id}`; }} />
          : <div key={m.id} className="mb-7 group/msg msg-in">
              {mode !== "chat" && m.execution_id && <ToolsOf execId={m.execution_id} />}
              {m.status === "failed" || m.status === "cancelled" ? <div role="alert" className="text-[13px] text-danger flex gap-2"><XCircle size={15} className="mt-0.5 shrink-0" />{m.content}</div> : <RichScope.Provider value={{ scope: m.id, streaming: false }}><Md text={m.content} /></RichScope.Provider>}
              <div className="flex items-center gap-3 mt-1 text-xs text-muted">
                <button className="hover:text-fg tnum" onClick={() => setUsageMsg(m)} title="Détails de consommation">{m.model ?? "modèle"}{m.effort_applied ? ` · ${effortLabel(m.effort_applied)}` : ""}{m.tokens ? ` · ${fmt(m.tokens)} tok` : ""}{m.tokens ? ` · ${m.unpriced ? "prix n/d" : "≈ " + usd(m.usd).replace("≈ ", "")}` : ""}</button>
                <button aria-label="Copier la réponse" className="opacity-0 group-hover/msg:opacity-100 focus-visible:opacity-100 hover:text-fg inline-flex items-center gap-1" onClick={() => { navigator.clipboard?.writeText(m.content); setCopied(m.id); setTimeout(() => setCopied(undefined), 1400); }}>{copied === m.id ? <Check size={13} /> : <Copy size={13} />}</button>
                {lastAssistant?.id === m.id && !busy && <button aria-label="Régénérer" title="Régénérer : renvoie votre dernier message comme nouveau tour (pas de régénération native)" className="opacity-0 group-hover/msg:opacity-100 focus-visible:opacity-100 hover:text-fg inline-flex items-center gap-1" onClick={() => act(async () => { stick.current = true; const r = await api("conv.regenerate", id); if (r.notice) toast(r.notice, "info"); reloadMsgs(); })}><RefreshCw size={13} />Régénérer</button>}</div></div>)}
        {busy && <LiveTurn execId={active.id} mode={mode} />}
        {pending.map((a) => <div key={a.id} className="card !border-[rgba(251,191,36,.4)] p-3 my-3"><div className="text-warning font-medium text-[13px] mb-1 flex items-center gap-1.5"><ShieldAlert size={14} />Approbation requise ({a.kind})</div><div className="mono text-xs break-all mb-2 text-fg2">{a.summary}</div><div className="flex gap-2"><button className="btn btn-sm btn-primary" onClick={async () => { await api("approval.resolve", a.id, true); reloadAppr(); }}>Autoriser</button><button className="btn btn-sm btn-danger" onClick={async () => { await api("approval.resolve", a.id, false); reloadAppr(); }}>Refuser</button></div></div>)}
      </div></div>

    <div className="px-6 pb-5 shrink-0"><div className="max-w-[760px] mx-auto"><LimitBanner provider={cfg.provider} onSwitch={(p) => setCfg({ provider: p, model: null, effort: null })} />
      <Composer value={text} onChange={setText} onSend={() => send()} onStop={() => act(() => api("conv.stop", id), "Arrêt demandé.")} busy={busy} sending={sending} placeholder={placeholder} mode={mode} cfg={cfg} onCfg={setCfg} canAttach={mode !== "work"} convId={id}
        attachments={attach} images={imgs} note={changedCfg ? (cfg.provider !== conv.provider ? "Nouvelle session au prochain envoi" : "Appliqué au prochain envoi") : undefined}
        onAttach={() => void af.add()} styleValue={conv.style ?? null} onStyle={(s) => void act(() => api("conv.setStyle", id, s))} webValue={!!conv.web} onWeb={(on) => void act(() => api("conv.setWeb", id, on))} genValue={!!conv.image} onGen={(on) => void act(() => api("conv.setImage", id, on))} onPasteImages={(f) => void im.paste(f)} onCapture={() => void im.capture()} onDropFiles={(files) => void af.drop(files, async (paths) => { try { const f = await api("doc.images", paths); if (f?.length) setImgs((i) => [...i, ...f].slice(0, 4)); } catch (e: any) { toast(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "error"); } })}
        onImage={async () => { try { const f = await api("dialog.images"); if (f?.length) setImgs([...imgs, ...f].slice(0, 4)); } catch (e: any) { toast(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "error"); } }}
        onRemoveAttach={(i) => setAttach(attach.filter((_, j) => j !== i))} onRemoveImage={(i) => setImgs(imgs.filter((_, j) => j !== i))} />
      <p className="text-2xs text-muted text-center mt-2">{mode === "chat" ? "Moteur " + PROVIDER_LABEL[conv.provider as "claude" | "codex"] + " utilisé en conversation seule — ce n'est pas le Chat natif " + (conv.provider === "claude" ? "claude.ai" : "ChatGPT") + ". " : ""}Entrée pour envoyer · Maj+Entrée pour une nouvelle ligne.</p></div></div>

    <UsageDrawer msg={usageMsg} onClose={() => setUsageMsg(undefined)} /><HistoryDrawer id={id} open={hist} onClose={() => setHist(false)} /><ContinueInCode id={id} open={cont} onClose={() => setCont(false)} />
    {project && <GitDiff open={diffOpen} onClose={() => setDiffOpen(false)} path={project.path} />}
  </div></ChatActions.Provider>;
}

function GitDiff({ open, onClose, path }: { open: boolean; onClose: () => void; path: string }) {
  const [state, setState] = useState<{ files: any[]; diff: string }>();
  useEffect(() => { if (!open) return; setState(undefined); Promise.all([api("git.changes", path), api("git.diff", path)]).then(([c, d]) => setState({ files: c.files, diff: d })).catch((e) => toast(e.message, "error")); }, [open, path]);
  return <Drawer open={open} onClose={onClose} width={640} title="Modifications Git du projet">{!state ? <p className="text-muted">Chargement…</p> : <div><p className="text-[13px] text-fg2 mb-3">{state.files.length} fichier(s) modifié(s) non commité(s)</p>{state.files.map((f) => <div key={f.path} className="mono text-xs py-0.5"><span className="text-warning inline-block w-6">{f.status}</span>{f.path}</div>)}
    <div className="mt-4 bg-bg border border-line rounded-xl overflow-auto max-h-[60vh] text-[12px] mono">{state.diff ? state.diff.split("\n").map((l, i) => <div key={i} className={`px-3 whitespace-pre ${l.startsWith("+") && !l.startsWith("+++") ? "bg-[var(--success-subtle)] text-success" : l.startsWith("-") && !l.startsWith("---") ? "bg-[var(--danger-subtle)] text-danger" : l.startsWith("@@") ? "text-info" : "text-fg2"}`}>{l || " "}</div>) : <div className="p-3 text-muted">Aucune différence.</div>}</div></div>}</Drawer>;
}

export { ContinueInCode };
