import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useSearchParams } from "react-router-dom";
import ReactFlow, { ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap, Handle, Position, MarkerType, useNodesState, useEdgesState, useReactFlow, useUpdateNodeInternals, type Node, type Edge, type NodeProps, type Connection } from "reactflow";
import "reactflow/dist/style.css";
import { Undo2, Redo2, CopyPlus, Compass, LayoutTemplate, Server, Layers, Database, ShieldCheck, Rocket, CheckCheck, Bug, Eye, BookOpen, Gauge, Wrench, Palette, PanelLeftClose, PanelLeftOpen, ArrowLeft, Bot, ShieldAlert, FlaskConical, Bell, Crown, Save, Play, LayoutGrid, Wand2, Trash2, AlertTriangle, CheckCircle2, Sparkles, Plus, GitBranch, Loader2, Copy } from "lucide-react";
import { api } from "../api"; import { useData } from "../hooks"; import { toast, confirmDialog } from "../overlay"; import { Modal, Field } from "../ui";
import { ROLES } from "../components/NodeListEditor"; import { RunDialog } from "../pages/Workflows"; import { AgentCockpit, AgentPeek, usePeek } from "../components/AgentCockpit";
import { slugKey, wouldCycle, toPlan, edgesOf, autoLayout, roots, MAX_NODES, type SNode, type Kind } from "../studio/graph";


export const errMsg = (e: any) => String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
export const KIND: Record<Kind, { icon: any; label: string; color: string; hint: string }> = {
  agent: { icon: Bot, label: "Agent IA", color: "var(--accent)", hint: "Un agent Claude ou Codex qui accomplit une tâche précise" },
  approval: { icon: ShieldAlert, label: "Validation humaine", color: "var(--warning)", hint: "Le workflow attend votre accord avant de continuer" },
  test: { icon: FlaskConical, label: "Test (commande)", color: "var(--info)", hint: "Exécute une commande dans le projet (tests, lint, build)" },
  notification: { icon: Bell, label: "Notification", color: "var(--success)", hint: "Vous prévient quand cette étape est atteinte" },
};
/** Chaque rôle d'agent a son icône et sa teinte : on reconnaît l'équipe d'un coup d'œil. */
export const ROLE_STYLE: Record<string, { icon: any; color: string }> = { architect: { icon: Compass, color: "#8b7cf6" }, frontend: { icon: LayoutTemplate, color: "#38bdf8" }, backend: { icon: Server, color: "#34d399" }, fullstack: { icon: Layers, color: "#e0865f" }, database: { icon: Database, color: "#f59e0b" }, security: { icon: ShieldCheck, color: "#ef4444" }, devops: { icon: Rocket, color: "#06b6d4" }, qa: { icon: CheckCheck, color: "#22c55e" }, debugger: { icon: Bug, color: "#f472b6" }, reviewer: { icon: Eye, color: "#a78bfa" }, docs: { icon: BookOpen, color: "#60a5fa" }, performance: { icon: Gauge, color: "#fb923c" }, refactor: { icon: Wrench, color: "#2dd4bf" }, uxui: { icon: Palette, color: "#e879f9" } };
export const styleOf = (kind: Kind, role: string) => (kind === "agent" && ROLE_STYLE[role] ? { ...KIND.agent, ...ROLE_STYLE[role] } : KIND[kind]);
export const roleLabel = (k: string) => ROLES.find(([r]) => r === k)?.[1] ?? k;
export const ORCH = "__orch";

export type Dir = "LR" | "TB";
export interface NData { node: SNode; issues: string[]; dir?: Dir; run?: { status: string; tokens: number; execId?: string }; onOpen?: (key: string) => void }
export function StudioNode({ data, selected }: NodeProps<NData>) {
  const n = data.node; const K = styleOf(n.kind, n.role); const I = K.icon; const bad = data.issues.length > 0; const peek = usePeek();
  return <div {...peek.hover} className={`w-[208px] rounded-2xl bg-panel transition-all duration-150 ${data.run?.status === "in_progress" ? "node-live" : ""}`} style={{ border: `1.5px solid ${selected ? K.color : bad ? "var(--danger)" : "var(--border-strong)"}`, boxShadow: selected ? `0 0 0 4px color-mix(in srgb, ${K.color} 18%, transparent), var(--shadow-pop)` : "0 6px 20px rgba(0,0,0,.18)" }}>
    {data.run?.execId && <AgentPeek show={peek.show} pos={peek.pos} hover={peek.hover} execId={data.run.execId} title={n.title} onOpen={() => { peek.hide(); data.onOpen?.(n.key); }} />}
    <Handle type="target" position={data.dir === "TB" ? Position.Top : Position.Left} className="!w-3 !h-3 !border-2 !bg-panel" style={{ borderColor: K.color, ...(data.dir === "TB" ? { top: -7 } : { left: -7 }) }} />
    <div className="h-1.5 rounded-t-2xl" style={{ background: `linear-gradient(90deg, ${K.color}, color-mix(in srgb, ${K.color} 25%, transparent))` }} />
    <div className="p-3"><div className="flex items-center gap-2 mb-1.5"><span className="w-7 h-7 rounded-lg grid place-items-center shrink-0" style={{ background: `color-mix(in srgb, ${K.color} 16%, transparent)`, color: K.color }}><I size={15} /></span>
      <span className="text-2xs text-muted flex-1 truncate">{n.kind === "agent" ? roleLabel(n.role) : K.label}</span>
      {data.run && <span className={`text-2xs font-medium rounded-full px-1.5 py-0.5 ${data.run.status === "done" ? "bg-[var(--success-subtle,rgba(34,197,94,.15))] text-success" : data.run.status === "blocked" ? "bg-[var(--danger-subtle,rgba(239,68,68,.15))] text-danger" : data.run.status === "in_progress" ? "bg-accent-subtle text-accent" : "bg-raised text-muted"}`}>{data.run.status === "done" ? "✓ terminé" : data.run.status === "blocked" ? "bloqué" : data.run.status === "in_progress" ? "en cours" : data.run.status === "review" ? "à valider" : "en attente"}</span>}{n.gate && <span title="Validation avant exécution" className="text-warning"><ShieldAlert size={13} /></span>}{bad && <span title={data.issues.join("\n")} className="text-danger"><AlertTriangle size={13} /></span>}</div>
      <div className="text-[13px] font-semibold leading-snug line-clamp-2">{n.title}</div>
      <div className="flex items-center gap-1.5 mt-2 text-2xs text-muted">{n.kind === "agent" && <><span className="w-1.5 h-1.5 rounded-full" style={{ background: n.provider === "claude" ? "var(--claude)" : n.provider === "codex" ? "var(--codex)" : "var(--text-muted)" }} />{n.provider === "claude" ? "Claude" : n.provider === "codex" ? "Codex" : "Choix auto"}</>}{n.kind === "test" && <span className="mono truncate">{n.command || "commande ?"}</span>}</div></div>
    <Handle type="source" position={data.dir === "TB" ? Position.Bottom : Position.Right} className="!w-3 !h-3 !border-2 !bg-panel" style={{ borderColor: K.color, ...(data.dir === "TB" ? { bottom: -7 } : { right: -7 }) }} /></div>;
}
export function OrchNode({ data, selected }: NodeProps<{ count: number; dir?: Dir }>) {
  return <div className="w-[196px] rounded-3xl p-3.5 text-white transition-all" style={{ background: "linear-gradient(135deg, #b4532c, #e0865f 60%, #f1a97f)", boxShadow: selected ? "0 0 0 4px color-mix(in srgb, var(--accent) 30%, transparent), 0 10px 30px rgba(0,0,0,.35)" : "0 10px 28px rgba(0,0,0,.3)" }}>
    <div className="flex items-center gap-2.5"><span className="w-10 h-10 rounded-2xl bg-white/20 grid place-items-center"><Crown size={20} /></span><div><div className="font-semibold text-[14px] leading-tight">Orchestrateur</div><div className="text-[11px] opacity-85">chef d'orchestre du projet</div></div></div>
    <p className="text-[11.5px] leading-snug mt-3 opacity-95">Lance les {data.count} étape(s) dans l'ordre des liens, limite la concurrence, vérifie les permissions, met en pause en cas d'échec.</p>
    <Handle type="source" position={data.dir === "TB" ? Position.Bottom : Position.Right} className="!w-3 !h-3 !border-2 !bg-white" style={{ borderColor: "#b4532c", ...(data.dir === "TB" ? { bottom: -7 } : { right: -7 }) }} /></div>;
}
export const nodeTypes = { step: StudioNode, orch: OrchNode };
export const edgeStyle = { stroke: "var(--accent)", strokeWidth: 2 };
export const mkEdge = (s: string, t: string): Edge => ({ id: `${s}->${t}`, source: s, target: t, type: "smoothstep", animated: true, style: edgeStyle, markerEnd: { type: MarkerType.ArrowClosed, color: "var(--accent)" } });


export function PaletteItem({ kind, role, label, hint, rail, onAdd }: { kind: Kind; role?: string; label: string; hint?: string; rail?: boolean; onAdd: () => void }) {
  const K = styleOf(kind, role ?? ""); const I = K.icon;
  return <button type="button" draggable onDragStart={(e) => { e.dataTransfer.setData("application/acc-node", JSON.stringify({ kind, role })); e.dataTransfer.effectAllowed = "copy"; }} onClick={onAdd} title={rail ? label : hint ?? K.hint} aria-label={label} className="flex items-center gap-2.5 h-9 px-2 rounded-xl border border-transparent hover:border-line-strong hover:bg-raised text-left text-[13px] cursor-grab active:cursor-grabbing transition-colors"><span className="w-6 h-6 rounded-lg grid place-items-center shrink-0" style={{ background: `color-mix(in srgb, ${K.color} 16%, transparent)`, color: K.color }}><I size={13} /></span>{!rail && <span className="truncate">{label}</span>}</button>;
}

export function Inspector({ node, incoming, others, deps, blocked, onDep, onPatch, onDelete }: { node: SNode; incoming: number; others: SNode[]; deps: string[]; blocked: Set<string>; onDep: (src: string, on: boolean) => void; onPatch: (p: Partial<SNode>) => void; onDelete: () => void }) {
  const K = styleOf(node.kind, node.role); const I = K.icon;
  return <div className="space-y-4"><div className="flex items-center gap-2.5"><span className="w-9 h-9 rounded-xl grid place-items-center" style={{ background: `color-mix(in srgb, ${K.color} 16%, transparent)`, color: K.color }}><I size={18} /></span><div className="min-w-0"><div className="font-semibold text-[14px]">{K.label}</div><div className="text-2xs text-muted mono truncate">{node.key}</div></div></div>
    <Field label="Titre"><input className="input" value={node.title} maxLength={80} onChange={(e) => onPatch({ title: e.target.value })} /></Field>
    {node.kind === "agent" && <>
      <Field label="Rôle de l'agent"><select className="input" value={node.role} onChange={(e) => onPatch({ role: e.target.value })}>{ROLES.filter(([r]) => r !== "orchestrator").map(([r, l]) => <option key={r} value={r}>{l}</option>)}</select></Field>
      <div><label className="label">Fournisseur</label><div role="radiogroup" aria-label="Fournisseur" className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-bg border border-line">{([[undefined, "Auto"], ["claude", "Claude"], ["codex", "Codex"]] as const).map(([v, l]) => <button key={l} type="button" role="radio" aria-checked={node.provider === v} onClick={() => onPatch({ provider: v })} className={`h-8 rounded-lg text-[13px] transition-colors ${node.provider === v ? "bg-panel border border-line-strong font-medium" : "text-muted hover:text-fg border border-transparent"}`}>{l}</button>)}</div></div>
      <Field label="Instructions" hint="{{goal}} sera remplacé par l'objectif au lancement. Les agents voient le travail des étapes précédentes."><textarea className="input" rows={7} value={node.description ?? ""} onChange={(e) => onPatch({ description: e.target.value })} placeholder="Ce que cet agent doit faire, précisément." /></Field></>}
    {node.kind === "test" && <Field label="Commande" hint="Exécutée dans le dossier du projet, après votre confirmation au lancement."><input className="input mono" value={node.command ?? ""} onChange={(e) => onPatch({ command: e.target.value })} placeholder="npm test" /></Field>}
    {(node.kind === "approval" || node.kind === "notification") && <Field label="Message"><textarea className="input" rows={4} value={node.description ?? ""} onChange={(e) => onPatch({ description: e.target.value })} placeholder={node.kind === "approval" ? "Ce que vous devez vérifier avant de continuer" : "Texte de la notification"} /></Field>}
    {node.kind === "agent" && <label className="flex items-start gap-2.5 text-[13px] cursor-pointer rounded-xl border border-line p-3 hover:bg-raised"><input type="checkbox" className="mt-0.5 w-4 h-4 accent-[var(--accent)]" checked={!!node.gate} onChange={(e) => onPatch({ gate: e.target.checked })} /><span><span className="font-medium flex items-center gap-1.5"><ShieldAlert size={13} className="text-warning" />Validation avant exécution</span><span className="text-xs text-muted block mt-0.5">L'orchestrateur attend votre accord avant de lancer cet agent.</span></span></label>}
    {others.length > 0 && <fieldset className="rounded-xl border border-line p-3"><legend className="px-1 text-xs text-muted">Dépend de (alternative au glisser-déposer)</legend><div className="space-y-1">{others.map((o) => { const on = deps.includes(o.key); const dis = !on && blocked.has(o.key); return <label key={o.key} className={`flex items-center gap-2 text-[13px] ${dis ? "opacity-45" : "cursor-pointer"}`} title={dis ? "Créerait une boucle" : undefined}><input type="checkbox" className="w-4 h-4 accent-[var(--accent)]" checked={on} disabled={dis} onChange={(e) => onDep(o.key, e.target.checked)} /><span className="truncate">{o.title}</span></label>; })}</div></fieldset>}
    <p className="text-xs text-muted">{incoming === 0 ? "Première étape : lancée directement par l'orchestrateur." : `Attend ${incoming} étape(s) précédente(s) ; reçoit leur résultat.`}</p>
    <button className="btn btn-sm w-full !text-danger" onClick={onDelete}><Trash2 size={13} />Supprimer l'étape</button></div>;
}

export function OrchPanel({ count, onWt, onPropose }: { count: number; onWt: (v: boolean) => void; onPropose: () => void }) {
  const [wt, setWt] = useState(false);
  return <div className="space-y-4"><div className="flex items-center gap-2.5"><span className="w-10 h-10 rounded-2xl grid place-items-center text-white" style={{ background: "linear-gradient(135deg, #b4532c, #e0865f)" }}><Crown size={20} /></span><div><div className="font-semibold text-[15px]">Agent orchestrateur</div><div className="text-xs text-muted">supervise {count} étape(s)</div></div></div>
    <ul className="text-[13px] text-fg2 space-y-1.5 list-disc pl-4"><li>Lance chaque étape quand ses prédécesseurs sont terminées ; les branches indépendantes tournent en parallèle.</li><li>Respecte les limites de concurrence et les permissions de chaque rôle.</li><li>Transmet le résultat d'une étape à la suivante.</li><li>Met le workflow en pause si une étape échoue : vous relancez ou corrigez.</li><li>S'arrête aux étapes de validation et attend votre accord.</li></ul>
    <p className="text-xs text-muted rounded-xl border border-line p-3">L'ordre, la concurrence et les autorisations sont gérés par le moteur local, de façon déterministe. L'IA ne fait que <i>proposer</i> un graphe, que vous validez.</p>
    <label className="flex items-start gap-2.5 text-[13px] cursor-pointer"><input type="checkbox" className="mt-0.5 w-4 h-4 accent-[var(--accent)]" checked={wt} onChange={(e) => { setWt(e.target.checked); onWt(e.target.checked); }} /><span>Isoler les étapes qui écrivent dans des worktrees Git<span className="text-xs text-muted block">Évite les conflits entre agents parallèles (dépôt Git requis). Réglable aussi au lancement.</span></span></label>
    <button className="btn w-full" onClick={onPropose}><Wand2 size={14} />Proposer un graphe</button></div>;
}

/** L'orchestrateur (Claude ou Codex, lecture seule) propose un graphe pour un objectif ; rien n'est exécuté et l'orchestration technique créée pour la proposition est annulée aussitôt. */
export function ProposeDialog({ open, onClose, hasNodes, onPlan }: { open: boolean; onClose: () => void; hasNodes: boolean; onPlan: (t: SNode[]) => void }) {
  const { data: projects } = useData<any[]>("projects.list", [], { enabled: open }); const [pid, setPid] = useState(""); const [goal, setGoal] = useState(""); const [prov, setProv] = useState<"claude" | "codex">("claude"); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  useEffect(() => { if (projects?.length && !pid) setPid(projects[0].id); }, [projects]);
  const go = async () => {
    if (hasNodes && !(await confirmDialog({ title: "Remplacer le graphe actuel ?", body: "Le canevas sera remplacé par la proposition de l'orchestrateur.", confirmLabel: "Remplacer", danger: true }))) return;
    setBusy(true); setErr(""); let oid = "";
    try { oid = await api("orch.create", { projectId: pid, goal, mode: "assisted", plannerProvider: prov }); let o: any; for (let i = 0; i < 120; i++) { await new Promise((r) => setTimeout(r, 2000)); o = await api("orch.get", oid); if (o.status === "awaiting_approval" && o.plan_json) break; if (o.status === "draft" && o.error) throw new Error(o.error); if (["cancelled", "failed"].includes(o.status)) throw new Error(o.error ?? "Planification interrompue."); }
      if (!o?.plan_json) throw new Error("L'orchestrateur n'a pas répondu à temps."); const p = JSON.parse(o.plan_json); onPlan(p.tasks); onClose(); toast("Graphe proposé : relisez-le, ajustez-le, puis enregistrez.", "success"); }
    catch (e: any) { setErr(errMsg(e)); } finally { if (oid) void api("orch.cancel", oid).catch(() => {}); setBusy(false); }
  };
  return <Modal open={open} onClose={() => !busy && onClose()} title="Proposer un graphe" footer={<><button className="btn" disabled={busy} onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={busy || !pid || !goal.trim()} onClick={go}>{busy ? <><Loader2 size={14} className="animate-spin" />L'orchestrateur réfléchit…</> : <><Sparkles size={14} />Proposer</>}</button></>}>
    {!projects?.length ? <p className="text-fg2">Ajoutez d'abord un projet : l'orchestrateur lit son contenu pour proposer un graphe adapté.</p> : <>
      <Field label="Objectif"><textarea className="input" rows={3} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Ex. Ajouter un système de commentaires avec tests et revue de sécurité" /></Field>
      <Field label="Projet"><select className="input" value={pid} onChange={(e) => setPid(e.target.value)}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label="Qui propose ?"><select className="input" value={prov} onChange={(e) => setProv(e.target.value as any)}><option value="claude">Claude Code</option><option value="codex">Codex</option></select></Field>
      <p className="text-xs text-muted">Un agent en lecture seule étudie le projet (quelques minutes, un appel à votre abonnement). Aucun fichier n'est modifié et rien n'est lancé.</p>{err && <p role="alert" className="text-[13px] text-danger mt-2">{err}</p>}</>}</Modal>;
}

