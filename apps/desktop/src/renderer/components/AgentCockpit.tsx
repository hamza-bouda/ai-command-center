import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { NodeToolbar, Position } from "reactflow";
import { Square, RotateCcw, ExternalLink, SquareTerminal, FileText, ArrowDownToLine, ArrowUpFromLine, Clock, Coins } from "lucide-react";
import { api, fmt, usd } from "../api"; import { useData } from "../hooks"; import { toast, confirmDialog } from "../overlay";
import { Drawer, Tabs, StatusIndicator, Badge } from "../ui"; import { Md, ToolCallBlock } from "../pages/Sessions"; import { RichScope } from "./RichBlocks"; import { logBlocks } from "./ConversationParts";

const ACTIVE = ["queued", "preparing", "running", "waiting_approval"];
const errMsg = (e: any) => String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
const TASK_STATUS: Record<string, [string, string]> = { backlog: ["draft", "Backlog"], todo: ["queued", "En attente"], in_progress: ["running", "En cours"], review: ["waiting", "En validation"], done: ["completed", "Terminé"], blocked: ["blocked", "Bloqué"] };

/** Lignes d'affichage « terminal » construites depuis le journal persisté de l'exécution (pas un PTY : l'agent tourne en mode non interactif). */
interface Line { id: string; kind: "out" | "cmd" | "file" | "dim" | "err"; text: string; state?: string }
export function toLines(logs: any[] = []): Line[] {
  const out: Line[] = []; const tools = new Map<string, Line>();
  for (const l of logs) {
    if (l.kind === "text") { const last = out[out.length - 1]; if (last?.kind === "out") last.text += l.content; else out.push({ id: String(l.id), kind: "out", text: l.content }); }
    else if (l.kind === "tool") { try { const t = JSON.parse(l.content); const ex = tools.get(t.id); if (ex) { ex.state = t.state; } else { const ln: Line = { id: String(l.id), kind: "cmd", text: `${t.name}${t.summary ? " " + t.summary : ""}`, state: t.state }; tools.set(t.id, ln); out.push(ln); } } catch { /* ligne illisible */ } }
    else if (l.kind === "file_change") { try { for (const f of JSON.parse(l.content) as string[]) out.push({ id: `${l.id}:${f}`, kind: "file", text: f }); } catch { /* ignoré */ } }
    else if (l.kind === "error") out.push({ id: String(l.id), kind: "err", text: l.content });
    else if (l.kind === "status" && l.content) out.push({ id: String(l.id), kind: "dim", text: l.content });
  }
  return out;
}
const GLYPH: Record<string, string> = { started: "◐", completed: "✓", failed: "✗" };

/** Terminal d'un agent : toujours sombre, façon console, avec curseur clignotant tant que l'agent travaille. */
export function AgentTerminal({ execId, title, tail, height = 360 }: { execId: string; title?: string; tail?: number; height?: number | string }) {
  const { data: ex } = useData<any>("executions.get", [execId], { events: /execution\./ }); const live = !!ex && ACTIVE.includes(ex.status);
  const { data: logs } = useData<any[]>("executions.logs", tail ? [execId, 0, tail * 8] : [execId], { events: /execution\./, every: live ? (tail ? 2500 : 1500) : undefined });
  const lines = toLines(logs); const shown = tail ? lines.slice(-tail) : lines; const box = useRef<HTMLDivElement>(null); const stick = useRef(true);
  useEffect(() => { const el = box.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [logs]);
  return <div className="rounded-2xl overflow-hidden border border-[#2f2f2c] bg-[#161615] text-[#e8e6e1] shadow-lg flex flex-col min-w-0" style={{ height }}>
    <div className="h-8 shrink-0 flex items-center gap-1.5 px-3 bg-[#1f1f1d] border-b border-[#2f2f2c]"><span className="w-2.5 h-2.5 rounded-full bg-[#ef6b5f]" /><span className="w-2.5 h-2.5 rounded-full bg-[#f4bf4f]" /><span className="w-2.5 h-2.5 rounded-full bg-[#61c554]" />
      <span className="ml-2 text-[11px] text-[#9a978f] truncate">{title ?? "agent"}</span><span className="ml-auto text-[10px] uppercase tracking-wider" style={{ color: live ? "#61c554" : "#7d7a73" }}>{live ? "● en direct" : ex?.status === "failed" ? "échec" : "terminé"}</span></div>
    <div ref={box} onScroll={(e) => { const t = e.currentTarget; stick.current = t.scrollHeight - t.scrollTop - t.clientHeight < 40; }} className="flex-1 overflow-auto p-3 mono text-[12px] leading-[1.55] select-text" role="log" aria-label="Sortie de l'agent">
      {shown.length === 0 && <div className="text-[#7d7a73]">{live ? "L'agent démarre…" : "Aucune sortie enregistrée."}</div>}
      {shown.map((l) => l.kind === "cmd" ? <div key={l.id} className="flex gap-2 text-[#7dd3fc]"><span style={{ color: l.state === "failed" ? "#ef6b5f" : l.state === "completed" ? "#61c554" : "#f4bf4f" }} className={l.state === "started" ? "animate-pulse" : ""}>{GLYPH[l.state ?? "started"]}</span><span className="break-all">$ {l.text}</span></div>
        : l.kind === "file" ? <div key={l.id} className="text-[#86efac] break-all">+ {l.text}</div> : l.kind === "err" ? <div key={l.id} className="text-[#fca5a5] whitespace-pre-wrap">{l.text}</div>
        : l.kind === "dim" ? <div key={l.id} className="text-[#7d7a73] break-all"># {l.text}</div> : <div key={l.id} className="whitespace-pre-wrap break-words my-1">{l.text}</div>)}
      {live && <span className="inline-block w-2 h-3.5 bg-[#e8e6e1] align-middle animate-pulse" aria-hidden />}</div></div>;
}

/** Aperçu au survol : tant que le curseur est sur l'agent (ou sur l'aperçu), un mini-terminal en direct s'affiche au-dessus ; un clic dessus ouvre le cockpit latéral. */
export function usePeek() {
  const [show, setShow] = useState(false); const [pos, setPos] = useState<"top" | "bottom">("top"); const t = useRef<any>(); const node = useRef<HTMLElement | null>(null);
  const on = (e?: any) => { clearTimeout(t.current); const el0 = e?.currentTarget as HTMLElement | undefined; const el = el0 && !el0.closest(".react-flow__node-toolbar") ? el0 : undefined; /* l'aperçu lui-même ne repositionne rien */ if (el) node.current = el; const box = el?.closest(".react-flow") as HTMLElement | null; if (el && box) setPos(el.getBoundingClientRect().top - box.getBoundingClientRect().top < 240 ? "bottom" : "top"); t.current = setTimeout(() => setShow(true), 180); };
  const off = () => { clearTimeout(t.current); t.current = setTimeout(() => setShow(false), 260); };
  const hide = () => { clearTimeout(t.current); setShow(false); };
  // Filet de sécurité : si un panneau recouvre l'agent, « mouseleave » n'arrive pas ; on ferme dès que le curseur n'est ni sur l'agent ni sur l'aperçu, ou sur Échap.
  useEffect(() => { if (!show) return; const mv = (e: MouseEvent) => { const el = e.target as Element | null; if (!el) return; if (node.current?.contains(el) || el.closest?.(".react-flow__node-toolbar")) return; hide(); }; const key = (e: KeyboardEvent) => { if (e.key === "Escape") hide(); }; document.addEventListener("mousemove", mv); document.addEventListener("keydown", key); return () => { document.removeEventListener("mousemove", mv); document.removeEventListener("keydown", key); }; }, [show]);
  useEffect(() => () => clearTimeout(t.current), []);
  return { show, pos, hide, hover: { onMouseEnter: on as () => void, onMouseLeave: off } };
}
export function AgentPeek({ show, pos = "top", hover, execId, title, onOpen }: { show: boolean; pos?: "top" | "bottom"; hover: { onMouseEnter: () => void; onMouseLeave: () => void }; execId?: string; title: string; onOpen: () => void }) {
  if (!execId) return null;
  return <NodeToolbar isVisible={show} position={pos === "top" ? Position.Top : Position.Bottom} offset={12}><div {...hover} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onOpen(); }} role="button" tabIndex={0} aria-label={`Ouvrir le cockpit de ${title}`} onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }} className="w-[340px] cursor-pointer anim-pop group/peek">
    <AgentTerminal execId={execId} title={title} tail={7} height={176} /><div className="mt-1 text-center text-2xs text-muted opacity-0 group-hover/peek:opacity-100 transition-opacity">Cliquer pour ouvrir le cockpit</div></div></NodeToolbar>;
}

/** Cockpit d'une étape : terminal, interface (conversation), contexte reçu et transmis, résultat — avec actions. */
export function AgentCockpit({ task, orch, handoffs, onClose, onChanged }: { task: any; orch: any; handoffs: any[]; onClose: () => void; onChanged: () => void }) {
  const execId: string | undefined = task?.execution_id; const [tab, setTab] = useState<"term" | "ui" | "ctx" | "res">("term");
  const { data: ex } = useData<any>("executions.get", [execId ?? ""], { events: /execution\./, enabled: !!execId }); const { data: logs } = useData<any[]>("executions.logs", [execId ?? ""], { events: /execution\./, enabled: !!execId });
  const live = !!ex && ACTIVE.includes(ex.status); const [st, sl] = TASK_STATUS[task?.status] ?? ["idle", task?.status ?? ""];
  const incoming = handoffs.filter((h) => h.to_task_id === task?.id); const outgoing = handoffs.filter((h) => h.from_task_id === task?.id);
  const act = async (fn: () => Promise<any>, ok?: string) => { try { await fn(); if (ok) toast(ok, "success"); onChanged(); } catch (e: any) { toast(errMsg(e), "error"); } };
  const blocks = logBlocks(logs, true); const files = (logs ?? []).filter((l) => l.kind === "file_change").flatMap((l) => { try { return JSON.parse(l.content) as string[]; } catch { return []; } });
  const provider = ex?.provider ?? task?.provider;
  return <Drawer open={!!task} onClose={onClose} width={760} title={task?.title ?? ""}>{task && <div className="space-y-4 text-[13px]">
    <div className="flex flex-wrap items-center gap-2.5"><StatusIndicator status={live ? "running" : st} label={live ? "En cours" : sl} />{provider && <Badge v={provider} />}<span className="text-xs text-muted">{task.node_kind === "agent" ? task.role : task.node_kind}</span>
      <span className="ml-auto flex items-center gap-3 text-xs text-muted tnum"><span className="inline-flex items-center gap-1"><Coins size={12} />{task.tokens ? `${fmt(task.tokens)} tok` : "—"}{task.usd ? ` · ${usd(task.usd)}` : ""}</span>{task.duration_ms ? <span className="inline-flex items-center gap-1"><Clock size={12} />{Math.round(task.duration_ms / 1000)} s</span> : null}</span></div>
    <div className="flex flex-wrap gap-2">
      {live && execId && <button className="btn btn-sm btn-danger" onClick={async () => { if (await confirmDialog({ title: "Arrêter cet agent ?", body: "L'exécution en cours est interrompue ; l'orchestration se met en pause.", confirmLabel: "Arrêter", danger: true })) void act(() => api("cancel", execId), "Agent arrêté."); }}><Square size={13} />Arrêter</button>}
      {(task.status === "blocked" || ex?.status === "failed") && task.node_kind === "agent" && <button className="btn btn-sm btn-primary" onClick={() => void act(() => api("orch.retryTask", task.id), "Nouvelle tentative lancée.")}><RotateCcw size={13} />Relancer l'étape</button>}
      {execId && <Link to={`/sessions?open=${execId}`} className="btn btn-sm"><ExternalLink size={13} />Session complète</Link>}
      {provider && task.node_kind === "agent" && ex?.provider_session_id && !live && <button className="btn btn-sm" title="Rouvre cette session dans le terminal officiel : vous pouvez lui parler" onClick={() => void act(async () => { await api("terminal.resume", execId); window.location.hash = "/terminal"; })}><SquareTerminal size={13} />Reprendre dans un terminal</button>}
      {provider && task.node_kind === "agent" && !ex?.provider_session_id && <button className="btn btn-sm" title="Ouvre un terminal officiel neuf dans le dossier du projet" onClick={() => void act(async () => { await api("terminal.create", { kind: provider === "codex" ? "codex" : "claude", projectId: orch.project_id, title: `${task.title}` }); window.location.hash = "/terminal"; })}><SquareTerminal size={13} />Nouveau terminal ici</button>}</div>
    {!execId ? <div className="rounded-2xl border border-dashed border-line p-6 text-center text-muted">{task.node_kind === "approval" ? "Étape de validation humaine : pas d'agent." : "Cette étape n'a pas encore démarré : elle attend ses dépendances."}</div> : <>
      <Tabs tabs={[["term", "Terminal"], ["ui", "Interface"], ["ctx", `Contexte (${incoming.length}↓ ${outgoing.length}↑)`], ["res", "Résultat"]]} value={tab} onChange={setTab} />
      {tab === "term" && <AgentTerminal execId={execId} title={`${task.title} · ${provider ?? ""}`} height="min(56vh, 520px)" />}
      {tab === "ui" && <div className="rounded-2xl border border-line bg-panel p-4 max-h-[62vh] overflow-auto"><div className="flex justify-end mb-3"><div className="max-w-[85%] bg-raised border border-line rounded-2xl rounded-br-md px-3.5 py-2 text-[12.5px] whitespace-pre-wrap line-clamp-6" title="Consigne reçue par l'agent (voir l'onglet Contexte pour le texte complet)">{String(ex?.prompt ?? "").slice(0, 600)}{(ex?.prompt?.length ?? 0) > 600 ? "…" : ""}</div></div>
        <RichScope.Provider value={{ scope: `cockpit-${execId}`, streaming: live }}>{blocks.map((b) => b.k === "text" ? <Md key={"t" + b.id} text={b.text} /> : b.k === "tool" ? <ToolCallBlock key={"c" + b.bid} tool={b} /> : b.k === "files" ? <div key={b.id} className="text-xs text-success flex items-center gap-1.5 my-1"><FileText size={12} />Fichiers modifiés : <span className="mono">{b.files.join(", ")}</span></div> : b.k === "err" ? <p key={b.id} role="alert" className="text-danger text-[13px] my-1">{b.text}</p> : null)}</RichScope.Provider>
        {live && <div className="flex gap-1 mt-2" role="status" aria-label="L'agent travaille">{[0, 1, 2].map((i) => <span key={i} className="w-1.5 h-1.5 rounded-full bg-accent pulse-dot" style={{ animationDelay: `${i * 0.2}s` }} />)}</div>}</div>}
      {tab === "ctx" && <div className="space-y-3 max-h-[62vh] overflow-auto">
        <div><div className="text-2xs uppercase tracking-wider text-muted mb-1.5 flex items-center gap-1.5"><ArrowDownToLine size={12} />Reçu des étapes précédentes</div>{incoming.length === 0 ? <p className="text-muted text-xs">Première étape : rien reçu.</p> : incoming.map((h) => <HandoffCard key={h.id} h={h} />)}</div>
        <div><div className="text-2xs uppercase tracking-wider text-muted mb-1.5 flex items-center gap-1.5"><ArrowUpFromLine size={12} />Transmis aux étapes suivantes</div>{outgoing.length === 0 ? <p className="text-muted text-xs">Rien transmis pour le moment.</p> : outgoing.map((h) => <HandoffCard key={h.id} h={h} />)}</div>
        <details className="rounded-xl border border-line p-3"><summary className="cursor-pointer text-fg2">Consigne complète envoyée à l'agent</summary><pre className="mt-2 text-xs whitespace-pre-wrap break-words max-h-80 overflow-auto select-text">{ex?.prompt}</pre></details></div>}
      {tab === "res" && <div className="space-y-3 max-h-[62vh] overflow-auto">{ex?.result_text ? <div className="rounded-2xl border border-line bg-panel p-4"><RichScope.Provider value={{ scope: `res-${execId}`, streaming: false }}><Md text={ex.result_text} /></RichScope.Provider></div> : <p className="text-muted">{live ? "Résultat attendu à la fin de l'étape." : "Aucun résultat enregistré."}</p>}
        {files.length > 0 && <div className="rounded-xl border border-line p-3"><div className="text-xs text-muted mb-1.5">Fichiers modifiés</div><ul className="mono text-xs space-y-0.5">{[...new Set(files)].map((f) => <li key={f} className="text-success">+ {f}</li>)}</ul></div>}
        {ex?.error && <p role="alert" className="text-danger">{ex.error}</p>}</div>}</>}
  </div>}</Drawer>;
}

function HandoffCard({ h }: { h: any }) {
  const p = h.payload ?? {};
  return <div className="rounded-xl border border-line p-3 mb-2"><div className="flex items-center gap-2 text-xs text-muted mb-1"><span className="tnum">{h.chars ? `${fmt(h.chars)} car.` : ""}</span>{p.worktree?.branch && <span className="mono">{p.worktree.branch}</span>}</div>
    <p className="text-[13px] text-fg2 whitespace-pre-wrap line-clamp-5">{p.summary || "(résumé vide)"}</p>
    {p.filesModified?.length > 0 && <p className="text-2xs text-success mono mt-1.5 truncate">+ {p.filesModified.join(", ")}</p>}{p.openQuestions?.length > 0 && <p className="text-2xs text-warning mt-1">{p.openQuestions.length} question(s) ouverte(s)</p>}</div>;
}

/** Mur d'agents : une vignette-terminal par étape, en direct ; un clic ouvre le cockpit. */
export function AgentWall({ tasks, onOpen }: { tasks: any[]; onOpen: (id: string) => void }) {
  if (!tasks.length) return null;
  return <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">{tasks.map((t) => { const [st, sl] = TASK_STATUS[t.status] ?? ["idle", t.status]; const running = t.status === "in_progress";
    return <button key={t.id} type="button" onClick={() => onOpen(t.id)} className={`text-left rounded-2xl p-2 transition-all hover:-translate-y-0.5 ${running ? "node-live" : "border border-line"} bg-panel`} aria-label={`Ouvrir le cockpit de ${t.title}`}>
      <div className="flex items-center gap-2 px-1.5 pb-2"><StatusIndicator status={st} label={sl} size="sm" /><span className="text-[13px] font-medium truncate flex-1">{t.title}</span>{t.provider && <Badge v={t.provider} />}</div>
      {t.execution_id ? <div className="pointer-events-none"><AgentTerminal execId={t.execution_id} title={t.role ?? "agent"} tail={9} height={196} /></div>
        : <div className="h-[196px] rounded-2xl border border-dashed border-line grid place-items-center text-xs text-muted p-4 text-center">{t.node_kind === "approval" ? "Validation humaine" : "En attente de ses dépendances"}</div>}</button>; })}</div>;
}
