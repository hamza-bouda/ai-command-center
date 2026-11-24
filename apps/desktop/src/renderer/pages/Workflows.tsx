import { useEffect, useMemo, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import ReactFlow, { Background, Controls, Handle, Position, MarkerType, type Node, type Edge, type NodeProps } from "reactflow";
import "reactflow/dist/style.css";
import { Plus, Play, Copy, Trash2, Workflow as WfIcon, FlaskConical, ShieldAlert, Bell, Bot, Pencil, AlertTriangle } from "lucide-react";
import { api, fmt, usd, ago } from "../api"; import { useData } from "../hooks"; import { toast, confirmDialog } from "../overlay";
import { Page, Card, Modal, Drawer, Field, EmptyState, ErrorState, LoadingSkeleton, Badge, StatusIndicator, Tabs } from "../ui";
import { NodeListEditor, PNode, KIND_LABEL, ROLES } from "../components/NodeListEditor"; import { layout } from "./Orchestrator";

const KIND_ICON: Record<string, any> = { agent: Bot, approval: ShieldAlert, test: FlaskConical, notification: Bell };
function WfNode({ data }: NodeProps) { const I = KIND_ICON[data.kind] ?? Bot; return <div className="w-[230px] rounded-xl border border-line-strong bg-panel p-3" style={{ boxShadow: "0 4px 18px rgba(0,0,0,.4)" }}><Handle type="target" position={Position.Left} className="!bg-line-strong !border-0 !w-2 !h-2" />
  <div className="flex items-center justify-between mb-1.5"><span className="inline-flex items-center gap-1.5 text-2xs text-muted"><I size={12} />{KIND_LABEL[data.kind as keyof typeof KIND_LABEL]}</span>{data.provider && <Badge v={data.provider} />}</div><div className="text-[13px] font-medium leading-snug line-clamp-2">{data.title}</div>{data.kind === "agent" && <div className="text-2xs text-muted mt-1">{ROLES.find((r) => r[0] === data.role)?.[1]}</div>}{data.kind === "test" && <div className="text-2xs mono text-muted mt-1 truncate">{data.command}</div>}<Handle type="source" position={Position.Right} className="!bg-line-strong !border-0 !w-2 !h-2" /></div>; }
const nodeTypes = { wf: WfNode };
function WfGraph({ nodes: ns, height = 340 }: { nodes: PNode[]; height?: number }) {
  const { nodes, edges } = useMemo(() => { const list = ns.map((n) => ({ id: n.key })); const es = ns.flatMap((n) => n.dependsOn.map((d) => ({ task_id: n.key, depends_on: d }))); const pos = layout(list, es);
    return { nodes: ns.map((n): Node => ({ id: n.key, type: "wf", position: pos.get(n.key) ?? { x: 0, y: 0 }, data: n })), edges: es.map((e): Edge => ({ id: `${e.depends_on}-${e.task_id}`, source: e.depends_on, target: e.task_id, type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed, color: "#3a3a44" }, style: { stroke: "#3a3a44", strokeWidth: 1.5 } })) }; }, [ns]);
  return <div className="card overflow-hidden" style={{ height }}><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.2 }} minZoom={0.2} maxZoom={1.4} nodesDraggable={false} nodesConnectable={false} proOptions={{ hideAttribution: true }}><Background color="#27272e" gap={22} /><Controls showInteractive={false} /></ReactFlow></div>;
}

export function RunDialog({ wf, onClose }: { wf: any; onClose: () => void }) {
  const { data: projects } = useData<any[]>("projects.list", []); const [pid, setPid] = useState(""); const [goal, setGoal] = useState(""); const [wt, setWt] = useState(false); const [busy, setBusy] = useState(false); const [ok, setOk] = useState(false); const [cmds, setCmds] = useState<string[]>([]);
  useEffect(() => { if (projects?.length && !pid) setPid(projects[0].id); }, [projects]); useEffect(() => { if (wf) api("wf.commands", wf.id, goal || "…").then(setCmds).catch(() => setCmds([])); }, [wf, goal]);
  const go = async () => { setBusy(true); try { await api("wf.run", { workflowId: wf.id, projectId: pid, goal, useWorktrees: wt }); toast("Workflow lancé : suivez-le dans l'Orchestrateur.", "success"); onClose(); window.location.hash = "/orchestrator"; } catch (e: any) { toast(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "error"); } finally { setBusy(false); } };
  return <Modal open={!!wf} onClose={onClose} title={`Lancer « ${wf?.name ?? ""} »`} footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={!pid || !goal.trim() || busy || (cmds.length > 0 && !ok)} onClick={go}><Play size={14} />Lancer</button></>}>
    {!projects?.length ? <p className="text-fg2 pb-3">Ajoutez d'abord un projet. <Link to="/projects?new=1" className="text-accent" onClick={onClose}>Ajouter un projet</Link></p> : <>
      <Field label="Objectif"><textarea className="input" rows={3} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Ex. Ajouter l'authentification par e-mail" /></Field><Field label="Projet"><select className="input" value={pid} onChange={(e) => setPid(e.target.value)}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <label className="flex items-start gap-2 text-[13px] text-fg2 mb-3"><input type="checkbox" className="mt-0.5" checked={wt} onChange={(e) => setWt(e.target.checked)} /><span>Isoler les étapes qui écrivent dans des worktrees Git<br /><span className="text-xs text-muted">Nécessite un dépôt Git avec au moins un commit.</span></span></label>
      {cmds.length > 0 && <div className="card p-3 !border-[rgba(251,191,36,.4)] mb-3"><div className="text-warning text-[13px] font-medium flex items-center gap-1.5 mb-1.5"><AlertTriangle size={14} />Commandes qui seront exécutées dans le projet</div>{cmds.map((c) => <div key={c} className="mono text-xs text-fg2">$ {c}</div>)}<label className="flex items-center gap-2 text-[13px] mt-2"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />Je confirme l'exécution de ces commandes</label></div>}</>}</Modal>;
}

function Editor({ wf, open, onClose, onSaved }: { wf?: any; open: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(""); const [desc, setDesc] = useState(""); const [nodes, setNodes] = useState<PNode[]>([]); const [err, setErr] = useState("");
  useEffect(() => { if (open) { setName(wf?.name ?? ""); setDesc(wf?.description ?? ""); setNodes(wf?.nodes ?? []); setErr(""); } }, [open, wf]);
  const save = async () => { try { await api("wf.save", { id: wf?.id, name, description: desc, nodes }); toast("Workflow enregistré.", "success"); onSaved(); onClose(); } catch (e: any) { setErr(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, "")); } };
  return <Modal open={open} onClose={onClose} width="max-w-4xl" title={wf ? `Modifier « ${wf.name} »` : "Nouveau workflow"} footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={!name.trim() || !nodes.length} onClick={save}>Enregistrer</button></>}>
    <div className="grid grid-cols-2 gap-3"><Field label="Nom"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field><Field label="Description"><input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} /></Field></div>
    {nodes.length > 0 && <div className="mb-4"><WfGraph nodes={nodes} height={240} /></div>}{err && <p role="alert" className="text-danger text-[13px] mb-3">{err}</p>}<NodeListEditor nodes={nodes} onChange={setNodes} /></Modal>;
}

function Detail({ wf, onClose, onRun, onEdit, reload }: { wf: any; onClose: () => void; onRun: () => void; onEdit: () => void; reload: () => void }) {
  const { data: runs } = useData<any[]>("wf.runs", [wf.id], { events: /orchestration/ }); const [tab, setTab] = useState<"graph" | "runs">("graph");
  return <Drawer open onClose={onClose} width={720} title={wf.name} actions={<><button className="btn btn-sm btn-primary" onClick={onRun}><Play size={13} />Lancer</button>{!wf.builtin && <button className="btn btn-sm" onClick={onEdit}><Pencil size={13} />Modifier</button>}</>}>
    <p className="text-fg2 text-[13px] mb-4">{wf.description}</p><Tabs tabs={[["graph", "Graphe"], ["runs", `Exécutions (${wf.runs})`]]} value={tab} onChange={setTab} />
    {tab === "graph" ? <><WfGraph nodes={wf.nodes} height={360} /><div className="mt-4 space-y-1.5">{wf.nodes.map((n: PNode) => <div key={n.key} className="flex items-center gap-2 text-[13px]"><span className="mono text-xs text-muted w-16 truncate">{n.key}</span><span className="flex-1 truncate">{n.title}</span><span className="text-xs text-muted">{KIND_LABEL[n.kind]}</span></div>)}</div></>
      : !runs?.length ? <p className="text-muted text-[13px]">Aucune exécution.</p> : <div className="space-y-2">{runs.map((o) => <Link key={o.id} to="/orchestrator" className="card p-3 flex items-center gap-3 hover:border-line-strong"><StatusIndicator status={o.status === "completed" ? "completed" : o.status === "running" ? "running" : o.status === "paused" ? "interrupted" : o.status === "cancelled" ? "cancelled" : "queued"} size="sm" /><span className="flex-1 truncate text-[13px]">{o.goal}</span><span className="text-xs text-muted">{o.project_name} · {ago(o.created_at)}</span></Link>)}</div>}</Drawer>;
}

export default function Workflows() {
  const [sp, setSp] = useSearchParams(); const { data: list, err, loading, reload } = useData<any[]>("wf.list", [], { events: /orchestration|workflow/ });
  const [run, setRun] = useState<any>(); const [edit, setEdit] = useState<{ wf?: any } | null>(null); const [open, setOpen] = useState<string>();
  useEffect(() => { if (sp.get("new")) { setEdit({}); sp.delete("new"); setSp(sp, { replace: true }); } }, [sp]);
  const cur = list?.find((w) => w.id === open);
  return <Page title="Workflows" sub="Des enchaînements réutilisables d'agents, de tests et de validations — lancés sur vos projets." actions={<button className="btn btn-primary" onClick={() => { window.location.hash = "/studio?new=1"; }}><Plus size={15} />Nouveau workflow</button>}>
    {err && !list ? <ErrorState message={err} onRetry={reload} /> : loading && !list ? <LoadingSkeleton rows={3} cards={3} /> : !list?.length ? <Card><EmptyState icon={WfIcon} title="Aucun workflow" desc="Créez un enchaînement réutilisable." /></Card>
      : <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{list.map((w) => { const kinds = [...new Set(w.nodes.map((n: PNode) => n.kind))] as string[]; return <article key={w.id} className="card p-5 flex flex-col hover:border-line-strong transition-colors">
        <div className="flex items-start justify-between gap-2 mb-1"><h3 className="font-semibold">{w.name}</h3>{w.builtin ? <span className="text-2xs text-muted border border-line rounded px-1.5 py-0.5">Modèle</span> : <Badge v="subscription" text="Personnalisé" />}</div>
        <p className="text-[13px] text-fg2 min-h-[40px] mb-3">{w.description}</p>
        <div className="flex flex-wrap gap-1.5 mb-3">{kinds.map((k) => { const I = KIND_ICON[k]; return <span key={k} className="inline-flex items-center gap-1 text-2xs text-muted bg-raised rounded px-1.5 py-0.5"><I size={11} />{KIND_LABEL[k as keyof typeof KIND_LABEL]}</span>; })}<span className="text-2xs text-muted px-1 py-0.5">{w.nodes.length} étapes</span></div>
        <div className="grid grid-cols-3 gap-2 text-center mb-4 tnum"><div><div className="font-semibold">{w.runs}</div><div className="text-2xs text-muted">lancements</div></div><div><div className="font-semibold">{w.runs ? Math.round((w.ok / w.runs) * 100) + "%" : "—"}</div><div className="text-2xs text-muted">réussis</div></div><div><div className="font-semibold">{usd(w.usd)}</div><div className="text-2xs text-muted">{fmt(w.tokens)} tok</div></div></div>
        <div className="mt-auto flex gap-2"><button className="btn btn-primary btn-sm" onClick={() => setRun(w)}><Play size={13} />Lancer</button><button className="btn btn-sm" onClick={() => setOpen(w.id)}>Détails</button><button className="btn btn-ghost btn-icon !h-7 !w-7 ml-auto" aria-label="Dupliquer" title="Dupliquer" onClick={async () => { await api("wf.duplicate", w.id); toast("Workflow dupliqué.", "success"); reload(); }}><Copy size={13} /></button>
          {!w.builtin && <button className="btn btn-ghost btn-icon !h-7 !w-7" aria-label="Supprimer" onClick={async () => { if (await confirmDialog({ title: "Supprimer ce workflow ?", body: "Le modèle est supprimé ; l'historique de ses exécutions est conservé.", confirmLabel: "Supprimer", danger: true })) { await api("wf.remove", w.id); reload(); } }}><Trash2 size={13} /></button>}</div></article>; })}</div>}
    <RunDialog wf={run} onClose={() => setRun(undefined)} /><Editor wf={edit?.wf} open={!!edit} onClose={() => setEdit(null)} onSaved={reload} />
    {cur && <Detail wf={cur} onClose={() => setOpen(undefined)} onRun={() => { setRun(cur); }} onEdit={() => { window.location.hash = `/studio?id=${cur.id}`; }} reload={reload} />}</Page>;
}
