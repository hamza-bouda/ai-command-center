import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import ReactFlow, { Background, Controls, MiniMap, Handle, Position, type Node, type Edge, type NodeProps, MarkerType } from "reactflow";
import "reactflow/dist/style.css";
import ReactMarkdown from "react-markdown"; import remarkGfm from "remark-gfm";
import { Share2, Plus, Play, RotateCcw, Square, ExternalLink, ShieldAlert, Trash2, CheckCircle2, AlertTriangle, ArrowRight, Wand2 } from "lucide-react";
import { useData } from "../hooks"; import { useT } from "../i18n"; import { fmt, usd, dur, ago, api } from "../api"; import { toast, confirmDialog } from "../overlay";
import { AgentCockpit, AgentWall, AgentPeek, usePeek } from "../components/AgentCockpit";
import { NodeListEditor, PNode } from "../components/NodeListEditor"; import { Page, Card, Modal, Drawer, Field, EmptyState, ErrorState, LoadingSkeleton, Badge, StatusIndicator, Tabs, Segmented, Disclaimer } from "../ui";

const MAP: Record<string, string> = { backlog: "draft", todo: "queued", in_progress: "running", review: "waiting", done: "completed", blocked: "blocked" };
const LABEL: Record<string, string> = { backlog: "Backlog", todo: "En attente", in_progress: "En cours", review: "En validation", done: "Terminé", blocked: "Bloqué" };
const OSTATUS: Record<string, [string, string]> = { draft: ["draft", "Brouillon"], planning: ["running", "Planification…"], awaiting_approval: ["waiting", "Plan à valider"], running: ["running", "En cours"], paused: ["interrupted", "En pause"], completed: ["completed", "Terminée"], failed: ["failed", "Échec"], cancelled: ["cancelled", "Annulée"] };
const ROLES: [string, string][] = [["architect", "Architecte"], ["frontend", "Frontend"], ["backend", "Backend"], ["fullstack", "Full-stack"], ["database", "Base de données"], ["security", "Sécurité"], ["devops", "DevOps"], ["qa", "Testeur QA"], ["debugger", "Débogueur"], ["reviewer", "Reviewer"], ["docs", "Documentation"], ["performance", "Performance"], ["refactor", "Refactoring"], ["uxui", "UX/UI"], ["orchestrator", "Orchestrateur"]];
const MODES: [string, string, string][] = [["assisted", "Assisté", "L'IA propose un plan, vous le relisez et l'approuvez. Recommandé."], ["manual", "Manuel", "Vous construisez le plan vous-même."], ["auto", "Automatique", "Plan lancé sans relecture ; approbation demandée avant chaque étape qui écrit."]];

function TaskNode({ data, selected }: NodeProps) {
  const peek = usePeek();
  return <div {...peek.hover} className={`w-[250px] rounded-xl border bg-panel p-3 text-left ${data.status === "in_progress" ? "node-live" : ""} ${selected ? "border-accent" : data.gate ? "border-[rgba(251,191,36,.5)]" : "border-line-strong"}`} style={{ boxShadow: "0 4px 18px rgba(0,0,0,.4)" }}>
    {data.execId && <AgentPeek show={peek.show} pos={peek.pos} hover={peek.hover} execId={data.execId} title={data.title} onOpen={() => { peek.hide(); data.onOpen?.(data.taskId); }} />}
    <Handle type="target" position={Position.Left} className="!bg-line-strong !border-0 !w-2 !h-2" />
    <div className="flex items-center justify-between mb-2"><StatusIndicator status={data.gate ? "waiting_approval" : MAP[data.status] ?? "idle"} label={data.gate ? "Approbation" : LABEL[data.status]} size="sm" />{data.provider && <Badge v={data.provider} />}</div>
    <div className="text-[13px] font-medium leading-snug line-clamp-2 mb-2">{data.title}</div>
    <div className="flex justify-between text-2xs text-muted tnum"><span className="truncate max-w-[110px]">{data.kind === "approval" ? "Validation humaine" : data.kind === "test" ? "Test (commande)" : data.kind === "notification" ? "Notification" : data.agent ?? data.role ?? "—"}</span><span>{data.tokens ? `${fmt(data.tokens)} tok` : "—"}{data.duration ? ` · ${dur(data.duration)}` : ""}</span></div>
    <Handle type="source" position={Position.Right} className="!bg-line-strong !border-0 !w-2 !h-2" /></div>;
}
const nodeTypes = { task: TaskNode };

/** Disposition en colonnes selon la profondeur de dépendance (tri topologique, cycles ignorés). */
export function layout(tasks: { id: string }[], edges: { task_id: string; depends_on: string }[]) {
  const deps = new Map<string, string[]>(); for (const e of edges) (deps.get(e.task_id) ?? deps.set(e.task_id, []).get(e.task_id)!).push(e.depends_on);
  const depth = new Map<string, number>(); const visiting = new Set<string>();
  const d = (id: string): number => { if (depth.has(id)) return depth.get(id)!; if (visiting.has(id)) return 0; visiting.add(id); const v = Math.max(-1, ...(deps.get(id) ?? []).map(d)) + 1; visiting.delete(id); depth.set(id, v); return v; };
  const cols = new Map<number, string[]>(); for (const t of tasks) { const k = d(t.id); (cols.get(k) ?? cols.set(k, []).get(k)!).push(t.id); }
  const pos = new Map<string, { x: number; y: number }>(); for (const [c, ids] of cols) ids.forEach((id, i) => pos.set(id, { x: c * 340, y: i * 130 }));
  return pos;
}

function Graph({ nodes, edges, onClick, height = "calc(100vh - 440px)" }: { nodes: Node[]; edges: Edge[]; onClick: (id: string) => void; height?: string }) {
  return <div className="card overflow-hidden" style={{ height, minHeight: 380 }}><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.2 }} minZoom={0.2} maxZoom={1.6} nodesDraggable={false} nodesConnectable={false} onNodeClick={(_, n) => onClick(n.id)} proOptions={{ hideAttribution: true }}><Background color="#27272e" gap={22} /><Controls showInteractive={false} /><MiniMap pannable zoomable nodeColor="#3a3a44" maskColor="rgba(9,9,11,.7)" style={{ background: "#121216" }} /></ReactFlow></div>;
}

// ---------- éditeur de plan ----------
function PlanEditor({ orch, onSaved }: { orch: any; onSaved: () => void }) {
  const initial: PNode[] = useMemo(() => orch.plan_json ? JSON.parse(orch.plan_json).tasks : [], [orch.plan_json]);
  const [nodes, setNodes] = useState<PNode[]>(initial); const [check, setCheck] = useState<any>(); const [busy, setBusy] = useState(false);
  useEffect(() => { setNodes(initial); setCheck(undefined); }, [initial]);
  const validate = async () => setCheck(await api("orch.checkPlan", orch.id, { tasks: nodes }));
  const save = async () => { setBusy(true); try { const c = await api("orch.setPlan", orch.id, { tasks: nodes }); setCheck(c); if (c.ok) { toast("Plan enregistré.", "success"); onSaved(); } } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); } };
  return <div>
    {orch.error && <div role="alert" className="text-[13px] text-danger bg-[var(--danger-subtle)] rounded-xl px-4 py-2.5 mb-4 flex gap-2"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{orch.error}</div>}
    <NodeListEditor nodes={nodes} onChange={(n) => { setNodes(n); setCheck(undefined); }} />
    {check && (check.ok ? <div className="text-[13px] text-success bg-[var(--success-subtle)] rounded-xl px-4 py-2.5 mt-4 flex gap-2"><CheckCircle2 size={15} className="mt-0.5" />Plan valide ({check.plan.tasks.length} tâches, aucun cycle).</div> : <div role="alert" className="text-[13px] text-danger bg-[var(--danger-subtle)] rounded-xl px-4 py-2.5 mt-4"><b>Plan invalide</b><ul className="list-disc pl-5 mt-1">{check.errors.map((e: string) => <li key={e}>{e}</li>)}</ul></div>)}
    {check?.warnings?.length > 0 && <div className="text-[13px] text-warning bg-[var(--warning-subtle)] rounded-xl px-4 py-2.5 mt-3"><ul className="list-disc pl-5">{check.warnings.map((w: string) => <li key={w}>{w}</li>)}</ul></div>}
    <div className="flex gap-2 mt-4 justify-end"><button className="btn" onClick={validate} disabled={!nodes.length}>Vérifier</button><button className="btn btn-primary" onClick={save} disabled={busy || !nodes.length}>Enregistrer le plan</button></div>
    {orch.planner_text && <details className="mt-4 text-xs text-muted"><summary className="cursor-pointer">Réponse brute de l'orchestrateur IA</summary><pre className="mt-2 bg-bg border border-line rounded-lg p-3 whitespace-pre-wrap max-h-64 overflow-auto">{orch.planner_text}</pre></details>}</div>;
}

const EVT: Record<string, string> = { created: "Orchestration créée", planning: "Planification demandée", plan_ready: "Plan proposé", plan_invalid: "Plan invalide", plan_warning: "Avertissement", plan_edited: "Plan modifié", approved: "Plan approuvé", task_started: "Étape démarrée", task_done: "Étape terminée", task_failed: "Étape en échec", handoff: "Handoff transmis", gate_requested: "Approbation demandée", gate_approved: "Approuvé", gate_declined: "Refusé", provider_swapped: "Fournisseur remplacé", paused: "Mise en pause", resumed: "Reprise", retry: "Relance", cancelled: "Annulée", completed: "Terminée", engine_error: "Erreur du moteur" };

function Detail({ orch, reload }: { orch: any; reload: () => void }) {
  const ev = { events: /orchestration|execution|task|approval|usage/ as RegExp };
  const { data: tasks } = useData<any[]>("orch.tasks", [orch.id], ev); const { data: hs } = useData<any[]>("orch.handoffs", [orch.id], ev); const { data: events } = useData<any[]>("orch.events", [orch.id], ev); const { data: gates } = useData<any[]>("orch.gates", [orch.id], ev);
  const [tab, setTab] = useState<"plan" | "graph" | "wall" | "handoffs" | "journal" | "report">(orch.plan_json && !["draft", "awaiting_approval", "planning"].includes(orch.status) ? "graph" : "plan"); const [sel, setSel] = useState<string>();
  useEffect(() => { if (["running", "completed"].includes(orch.status) && tab === "plan") setTab("graph"); }, [orch.status]);
  const [os, ol] = OSTATUS[orch.status] ?? ["draft", orch.status]; const editable = ["draft", "awaiting_approval"].includes(orch.status); const pending = (gates ?? []).filter((g) => g.status === "pending");
  const { nodes, edges } = useMemo(() => {
    const list = tasks ?? []; const es: any[] = list.flatMap((t) => (t.deps ? String(t.deps).split(",") : []).map((d: string) => ({ task_id: t.id, depends_on: d }))); const pos = layout(list, es);
    return { nodes: list.map((t): Node => ({ id: t.id, type: "task", position: pos.get(t.id) ?? { x: 0, y: 0 }, data: { taskId: t.id, execId: t.execution_id, onOpen: setSel, title: t.title, status: t.status, role: t.role, kind: t.node_kind, provider: t.provider, tokens: t.tokens, duration: t.duration_ms, gate: pending.some((g) => g.task_id === t.id) } })),
      edges: es.map((e): Edge => ({ id: `${e.depends_on}-${e.task_id}`, source: e.depends_on, target: e.task_id, type: "smoothstep", animated: list.find((x) => x.id === e.depends_on)?.status === "in_progress", markerEnd: { type: MarkerType.ArrowClosed, color: "#3a3a44" }, style: { stroke: "#3a3a44", strokeWidth: 1.5 } })) };
  }, [tasks, gates]);
  const done = (tasks ?? []).filter((t) => t.status === "done").length; const cur = (tasks ?? []).find((t) => t.id === sel);
  const act = async (fn: () => Promise<any>, ok?: string) => { try { await fn(); if (ok) toast(ok, "success"); reload(); } catch (e: any) { toast(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "error"); } };
  const run = orch.tasks ? orch : orch;
  return <div>
    <div className="mb-4"><div className="min-w-0 mb-3"><div className="flex items-center gap-2 mb-1"><StatusIndicator status={os} label={ol} /><span className="text-xs text-muted">{MODES.find((m) => m[0] === orch.mode)?.[1]} · {ago(orch.created_at)}</span></div><h2 className="text-[17px] font-semibold">{orch.goal}</h2>
      <p className="text-xs text-muted mt-1 tnum">{done}/{tasks?.length ?? 0} étapes terminées · {fmt(run.tokens)} tokens · {usd(run.usd)} <span className="ml-1">(éq. API, non facturé)</span></p></div>
      <div className="flex gap-2 flex-wrap">
        {orch.status === "awaiting_approval" && <button className="btn btn-primary" onClick={() => act(() => api("orch.approve", orch.id), "Orchestration lancée.")}><Play size={14} />Approuver et lancer</button>}
        {editable && orch.mode !== "manual" && <button className="btn" onClick={() => act(() => api("orch.replan", orch.id))}><Wand2 size={14} />Replanifier avec l'IA</button>}
        {orch.status === "paused" && <button className="btn btn-primary" onClick={() => act(() => api("orch.resume", orch.id), "Reprise.")}><RotateCcw size={14} />Reprendre</button>}
        {!["completed", "failed", "cancelled"].includes(orch.status) && <button className="btn btn-danger" onClick={async () => { if (await confirmDialog({ title: "Annuler l'orchestration ?", body: "Les exécutions en cours seront arrêtées. Les tâches terminées sont conservées.", confirmLabel: "Annuler l'orchestration", danger: true })) act(() => api("orch.cancel", orch.id), "Orchestration annulée."); }}><Square size={13} />Annuler</button>}</div></div>
    {orch.status === "planning" && <div role="status" className="card p-4 mb-4 flex items-center gap-3 text-[13px]"><span className="flex gap-1">{[0, 1, 2].map((i) => <span key={i} className="w-1.5 h-1.5 rounded-full bg-accent pulse-dot" style={{ animationDelay: `${i * 0.2}s` }} />)}</span>L'orchestrateur IA analyse le projet et prépare un plan (lecture seule)…{orch.planner_execution_id && <Link className="text-accent ml-auto" to={`/sessions?open=${orch.planner_execution_id}`}>Voir la session</Link>}</div>}
    {orch.status === "paused" && orch.error && <div role="alert" className="text-[13px] text-warning bg-[var(--warning-subtle)] rounded-xl px-4 py-2.5 mb-4">{orch.error}</div>}
    {pending.map((g) => <div key={g.id} className="card !border-[rgba(251,191,36,.4)] p-4 mb-3 flex items-center gap-3"><ShieldAlert className="text-warning shrink-0" size={18} /><div className="flex-1 text-[13px]"><div className="font-medium">Approbation requise</div><div className="text-fg2">{g.summary}</div></div><button className="btn btn-primary btn-sm" onClick={() => act(() => api("orch.resolveGate", g.id, true))}>Autoriser</button><button className="btn btn-danger btn-sm" onClick={() => act(() => api("orch.resolveGate", g.id, false))}>Refuser</button></div>)}
    <Tabs tabs={[["plan", "Plan"], ["graph", "Graphe"], ["wall", "Mur d'agents"], ["handoffs", `Handoffs (${hs?.length ?? 0})`], ["journal", "Journal"], ["report", "Rapport"]]} value={tab} onChange={setTab} />
    {tab === "plan" && (editable ? <PlanEditor orch={orch} onSaved={reload} /> : <div className="space-y-2">{(tasks ?? []).map((t) => <div key={t.id} className="card p-3 flex items-center gap-3 text-[13px]"><StatusIndicator status={MAP[t.status] ?? "idle"} label={LABEL[t.status]} size="sm" /><span className="mono text-xs text-muted w-16 truncate">{t.node_key}</span><span className="flex-1 truncate">{t.title}</span><span className="text-xs text-muted">{ROLES.find((r) => r[0] === t.role)?.[1]}</span></div>)}</div>)}
    {tab === "graph" && (tasks?.length ? <Graph nodes={nodes} edges={edges} onClick={setSel} /> : <Card><EmptyState icon={Share2} title="Le graphe apparaîtra après l'approbation du plan" desc="Validez le plan dans l'onglet Plan pour créer les tâches et démarrer." /></Card>)}
    {tab === "wall" && (tasks?.length ? <AgentWall tasks={tasks} onOpen={setSel} /> : <Card><EmptyState icon={Share2} title="Le mur apparaîtra au lancement" desc="Chaque étape y aura son terminal en direct." /></Card>)}
    {tab === "handoffs" && ((hs?.length ?? 0) === 0 ? <Card><EmptyState icon={ArrowRight} title="Aucun handoff pour le moment" desc="Quand une étape se termine, son résumé, ses fichiers modifiés, ses décisions et ses questions ouvertes sont transmis explicitement à l'étape suivante." /></Card> : <div className="space-y-3">{hs!.map((h) => { const p = h.payload; return <Card key={h.id}><div className="flex items-center gap-2 text-[13px] mb-2"><b>{p.from.title}</b><ArrowRight size={14} className="text-muted" /><b>{p.to.title}</b><span className="text-xs text-muted ml-auto">{ago(h.created_at)}</span>{p.structured ? <Badge v="reported" text="Structuré par l'agent" /> : <Badge v="estimated" text="Résumé seul" />}</div>
      <p className="text-[13px] text-fg2 whitespace-pre-wrap line-clamp-6 mb-3">{p.summary}</p>
      <div className="grid md:grid-cols-2 gap-3 text-[13px]">{[["Décisions", p.decisions], ["Questions ouvertes", p.openQuestions], ["Prochaines étapes", p.nextSteps], ["Fichiers modifiés", p.filesModified], ["Commits", p.commits], ["Erreurs", p.errors]].map(([l, a]: any) => a.length ? <div key={l}><div className="label">{l}</div><ul className="list-disc pl-4 text-fg2">{a.slice(0, 8).map((x: string) => <li key={x} className="break-all">{x}</li>)}</ul></div> : null)}{p.testResults && <div><div className="label">Résultats de tests</div><p className="text-fg2">{p.testResults}</p></div>}</div>
      <div className="text-xs text-muted mt-3 tnum">Étape source : {fmt(p.usage.tokens)} tokens · {usd(p.usage.usd)}{p.worktree ? ` · branche ${p.worktree.branch}` : ""}</div></Card>; })}</div>)}
    {tab === "journal" && <Card pad={false}><ul className="divide-y divide-line">{(events ?? []).slice().reverse().map((e) => <li key={e.id} className="flex gap-4 px-5 py-2.5 text-[13px]"><span className={`w-44 shrink-0 font-medium ${/failed|declined|invalid|error/.test(e.type) ? "text-danger" : /gate|paused|swapped|warning/.test(e.type) ? "text-warning" : /done|completed|approved/.test(e.type) ? "text-success" : "text-fg2"}`}>{EVT[e.type] ?? e.type}</span><span className="flex-1 text-fg2 truncate" title={e.detail}>{e.detail}</span><span className="text-xs text-muted tnum">{new Date(e.at).toLocaleTimeString("fr-FR")}</span></li>)}</ul></Card>}
    {tab === "report" && (orch.report ? <Card><div className="prose-chat text-[14px]"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ table: ({ children }) => <div className="overflow-auto my-3"><table className="w-full text-[13px] border border-line rounded-lg">{children}</table></div>, th: ({ children }) => <th className="th bg-panel">{children}</th>, td: ({ children }) => <td className="td">{children}</td>, p: ({ children }) => <p className="my-2 leading-7">{children}</p>, h1: ({ children }) => <h3 className="text-[17px] font-semibold mb-2">{children}</h3>, h2: ({ children }) => <h4 className="font-semibold mt-4 mb-1">{children}</h4> }}>{orch.report}</ReactMarkdown></div><div className="mt-3"><Disclaimer /></div></Card> : <Card><EmptyState icon={Share2} title="Rapport final non disponible" desc="Il est généré quand toutes les étapes sont terminées." /></Card>)}
    <AgentCockpit task={cur} orch={orch} handoffs={hs ?? []} onClose={() => setSel(undefined)} onChanged={reload} />
  </div>;
}

function NewOrch({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { data: projects } = useData<any[]>("projects.list", []); const [f, setF] = useState<any>({ projectId: "", goal: "", mode: "assisted", plannerProvider: "claude", useWorktrees: false }); const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setF((x: any) => ({ ...x, projectId: x.projectId || projects?.[0]?.id || "" })); }, [open, projects]);
  const go = async () => { setBusy(true); try { const id = await api("orch.create", f); onCreated(id); onClose(); setF({ ...f, goal: "" }); } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); } };
  return <Modal open={open} onClose={onClose} title="Nouvelle orchestration" footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={busy || !f.goal.trim() || !f.projectId} onClick={go}>{f.mode === "manual" ? "Créer" : "Créer et planifier"}</button></>}>
    {!projects?.length ? <p className="text-fg2 pb-3">Ajoutez d'abord un projet.</p> : <>
      <Field label="Objectif"><textarea className="input" rows={3} value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })} placeholder="Ex. Développer un SaaS avec authentification, dashboard, base de données et tests" /></Field>
      <Field label="Projet"><select className="input" value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <div role="radiogroup" aria-label="Mode de planification" className="grid grid-cols-3 gap-2 mb-4">{MODES.map(([k, l, d]) => <button key={k} role="radio" aria-checked={f.mode === k} onClick={() => setF({ ...f, mode: k })} className={`text-left p-3 rounded-xl border ${f.mode === k ? "border-accent bg-accent-subtle" : "border-line hover:border-line-strong"}`}><div className="text-[13px] font-medium mb-1">{l}</div><div className="text-2xs text-muted">{d}</div></button>)}</div>
      {f.mode !== "manual" && <Field label="Fournisseur du planificateur" hint="L'orchestrateur IA travaille en lecture seule et consomme votre abonnement (suivi dans Consommation)."><select className="input" value={f.plannerProvider} onChange={(e) => setF({ ...f, plannerProvider: e.target.value })}><option value="claude">Claude Code</option><option value="codex">Codex</option></select></Field>}
      <label className="flex items-start gap-2 text-[13px] text-fg2 pb-3"><input type="checkbox" className="mt-0.5" checked={f.useWorktrees} onChange={(e) => setF({ ...f, useWorktrees: e.target.checked })} /><span>Isoler chaque étape qui écrit dans un worktree Git<br /><span className="text-xs text-muted">Évite les conflits entre agents parallèles (nécessite un dépôt Git avec au moins un commit). La fusion reste manuelle depuis la page Git.</span></span></label></>}</Modal>;
}

function AllTasks() {
  const { data: tasks, err, loading, reload } = useData<any[]>("tasks.list", [], { events: /task|execution|usage/ }); const { data: edges } = useData<any[]>("tasks.edges", [], { events: /task/ }); const { data: agents } = useData<any[]>("agents.list", []); const { data: execs } = useData<any[]>("executions.list", [{ limit: 300 }], { events: /execution/ });
  const { nodes, flowEdges } = useMemo(() => { const list = tasks ?? []; const ids = new Set(list.map((x) => x.id)); const es = (edges ?? []).filter((e) => ids.has(e.task_id) && ids.has(e.depends_on)); const pos = layout(list, es);
    return { nodes: list.map((x): Node => { const a = agents?.find((g) => g.id === x.agent_id); const ex = (execs ?? []).find((e) => e.task_id === x.id); return { id: x.id, type: "task", position: pos.get(x.id) ?? { x: 0, y: 0 }, data: { title: x.title, status: x.status, agent: a?.name, provider: x.provider ?? a?.provider, tokens: x.tokens, duration: ex?.duration_ms } }; }), flowEdges: es.map((e): Edge => ({ id: `${e.depends_on}-${e.task_id}`, source: e.depends_on, target: e.task_id, type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed, color: "#3a3a44" }, style: { stroke: "#3a3a44", strokeWidth: 1.5 } })) }; }, [tasks, edges, agents, execs]);
  if (err && !tasks) return <ErrorState message={err} onRetry={reload} />; if (loading && !tasks) return <LoadingSkeleton rows={4} />;
  return tasks?.length ? <Graph nodes={nodes} edges={flowEdges} onClick={() => {}} /> : <Card><EmptyState icon={Share2} title="Aucune tâche" desc="Créez des tâches avec des dépendances : le graphe les affichera avec leur état réel." action={<Link to="/tasks?new=1" className="btn btn-primary">Nouvelle tâche</Link>} /></Card>;
}

export default function Orchestrator() {
  const t = useT(); const [sp, setSp] = useSearchParams(); const [view, setView] = useState<"orch" | "all">("orch"); const [creating, setCreating] = useState(false); const [sel, setSel] = useState<string>();
  const { data: list, err, loading, reload } = useData<any[]>("orch.list", [], { events: /orchestration|execution|task|usage/ }); const { data: projects } = useData<any[]>("projects.list", []);
  useEffect(() => { if (sp.get("new")) { setCreating(true); sp.delete("new"); setSp(sp, { replace: true }); } }, [sp]);
  useEffect(() => { if (!sel && list?.length) setSel(list[0].id); }, [list, sel]);
  const cur = list?.find((o) => o.id === sel);
  return <Page title={t("orchestrator.title")} sub="Un objectif, un plan en graphe, des agents Claude et Codex qui collaborent par handoffs explicites." wide actions={<><Segmented label="Vue" value={view} onChange={setView} options={[["orch", "Orchestrations"], ["all", "Toutes les tâches"]]} /><button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={15} />Nouvelle orchestration</button></>}>
    {view === "all" ? <AllTasks /> : err && !list ? <ErrorState message={err} onRetry={reload} /> : loading && !list ? <LoadingSkeleton rows={3} /> : !list?.length ? <Card><EmptyState icon={Share2} title="Aucune orchestration" desc="Décrivez un objectif : l'IA propose un plan en tâches avec dépendances, vous le validez, puis les agents Claude et Codex travaillent en parallèle et se transmettent leur contexte." action={<button className="btn btn-primary" onClick={() => setCreating(true)}>Nouvelle orchestration</button>} /></Card>
    : <div className="grid grid-cols-[300px_1fr] gap-4"><div className="space-y-2">{list.map((o) => { const [s, l] = OSTATUS[o.status] ?? ["draft", o.status]; return <button key={o.id} onClick={() => setSel(o.id)} aria-pressed={sel === o.id} className={`w-full text-left card p-3 transition-colors ${sel === o.id ? "!border-accent" : "hover:border-line-strong"}`}><div className="flex items-center justify-between mb-1.5"><StatusIndicator status={s} label={l} size="sm" /><span className="text-2xs text-muted">{ago(o.created_at)}</span></div><div className="text-[13px] font-medium line-clamp-2 mb-1.5">{o.goal}</div><div className="text-2xs text-muted tnum">{o.done}/{o.tasks} étapes · {fmt(o.tokens)} tok · {projects?.find((p) => p.id === o.project_id)?.name}</div></button>; })}</div>
      <div className="min-w-0">{cur && <Detail key={cur.id} orch={cur} reload={reload} />}</div></div>}
    <NewOrch open={creating} onClose={() => setCreating(false)} onCreated={(id) => { setView("orch"); setSel(id); reload(); }} /></Page>;
}
