import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useSearchParams } from "react-router-dom";
import ReactFlow, { ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap, Handle, Position, MarkerType, useNodesState, useEdgesState, useReactFlow, type Node, type Edge, type NodeProps, type Connection } from "reactflow";
import "reactflow/dist/style.css";
import { ArrowLeft, Bot, ShieldAlert, FlaskConical, Bell, Crown, Save, Play, LayoutGrid, Wand2, Trash2, AlertTriangle, CheckCircle2, Sparkles, Plus, GitBranch, Loader2, Copy } from "lucide-react";
import { api } from "../api"; import { useData } from "../hooks"; import { toast, confirmDialog } from "../overlay"; import { Modal, Field } from "../ui";
import { ROLES } from "../components/NodeListEditor"; import { RunDialog } from "./Workflows";
import { slugKey, wouldCycle, toPlan, edgesOf, autoLayout, roots, MAX_NODES, type SNode, type Kind } from "../studio/graph";

const errMsg = (e: any) => String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
const KIND: Record<Kind, { icon: any; label: string; color: string; hint: string }> = {
  agent: { icon: Bot, label: "Agent IA", color: "var(--accent)", hint: "Un agent Claude ou Codex qui accomplit une tâche précise" },
  approval: { icon: ShieldAlert, label: "Validation humaine", color: "var(--warning)", hint: "Le workflow attend votre accord avant de continuer" },
  test: { icon: FlaskConical, label: "Test (commande)", color: "var(--info)", hint: "Exécute une commande dans le projet (tests, lint, build)" },
  notification: { icon: Bell, label: "Notification", color: "var(--success)", hint: "Vous prévient quand cette étape est atteinte" },
};
const roleLabel = (k: string) => ROLES.find(([r]) => r === k)?.[1] ?? k;
const ORCH = "__orch";

interface NData { node: SNode; issues: string[] }
function StudioNode({ data, selected }: NodeProps<NData>) {
  const n = data.node; const K = KIND[n.kind]; const I = K.icon; const bad = data.issues.length > 0;
  return <div className="w-[236px] rounded-2xl bg-panel transition-all duration-150" style={{ border: `1.5px solid ${selected ? K.color : bad ? "var(--danger)" : "var(--border-strong)"}`, boxShadow: selected ? `0 0 0 4px color-mix(in srgb, ${K.color} 18%, transparent), var(--shadow-pop)` : "0 6px 20px rgba(0,0,0,.18)" }}>
    <Handle type="target" position={Position.Left} className="!w-3 !h-3 !border-2 !bg-panel" style={{ borderColor: K.color, left: -7 }} />
    <div className="h-1.5 rounded-t-2xl" style={{ background: `linear-gradient(90deg, ${K.color}, color-mix(in srgb, ${K.color} 25%, transparent))` }} />
    <div className="p-3"><div className="flex items-center gap-2 mb-1.5"><span className="w-7 h-7 rounded-lg grid place-items-center shrink-0" style={{ background: `color-mix(in srgb, ${K.color} 16%, transparent)`, color: K.color }}><I size={15} /></span>
      <span className="text-2xs text-muted flex-1 truncate">{n.kind === "agent" ? roleLabel(n.role) : K.label}</span>
      {n.gate && <span title="Validation avant exécution" className="text-warning"><ShieldAlert size={13} /></span>}{bad && <span title={data.issues.join("\n")} className="text-danger"><AlertTriangle size={13} /></span>}</div>
      <div className="text-[13px] font-semibold leading-snug line-clamp-2">{n.title}</div>
      <div className="flex items-center gap-1.5 mt-2 text-2xs text-muted">{n.kind === "agent" && <><span className="w-1.5 h-1.5 rounded-full" style={{ background: n.provider === "claude" ? "var(--claude)" : n.provider === "codex" ? "var(--codex)" : "var(--text-muted)" }} />{n.provider === "claude" ? "Claude" : n.provider === "codex" ? "Codex" : "Choix auto"}</>}{n.kind === "test" && <span className="mono truncate">{n.command || "commande ?"}</span>}</div></div>
    <Handle type="source" position={Position.Right} className="!w-3 !h-3 !border-2 !bg-panel" style={{ borderColor: K.color, right: -7 }} /></div>;
}
function OrchNode({ data, selected }: NodeProps<{ count: number }>) {
  return <div className="w-[230px] rounded-3xl p-4 text-white transition-all" style={{ background: "linear-gradient(135deg, #b4532c, #e0865f 60%, #f1a97f)", boxShadow: selected ? "0 0 0 4px color-mix(in srgb, var(--accent) 30%, transparent), 0 10px 30px rgba(0,0,0,.35)" : "0 10px 28px rgba(0,0,0,.3)" }}>
    <div className="flex items-center gap-2.5"><span className="w-10 h-10 rounded-2xl bg-white/20 grid place-items-center"><Crown size={20} /></span><div><div className="font-semibold text-[14px] leading-tight">Orchestrateur</div><div className="text-[11px] opacity-85">chef d'orchestre du projet</div></div></div>
    <p className="text-[11.5px] leading-snug mt-3 opacity-95">Lance les {data.count} étape(s) dans l'ordre des liens, limite la concurrence, vérifie les permissions, met en pause en cas d'échec.</p>
    <Handle type="source" position={Position.Right} className="!w-3 !h-3 !border-2 !bg-white" style={{ borderColor: "#b4532c", right: -7 }} /></div>;
}
const nodeTypes = { step: StudioNode, orch: OrchNode };
const edgeStyle = { stroke: "var(--accent)", strokeWidth: 2 };
const mkEdge = (s: string, t: string): Edge => ({ id: `${s}->${t}`, source: s, target: t, type: "smoothstep", animated: true, style: edgeStyle, markerEnd: { type: MarkerType.ArrowClosed, color: "var(--accent)" } });

function StudioInner() {
  const [sp, setSp] = useSearchParams(); const wfId = sp.get("id"); const isNew = !!sp.get("new");
  const { data: list, reload } = useData<any[]>("wf.list", []); const wf = list?.find((w) => w.id === wfId);
  const [nodes, setNodes, onNodesChange] = useNodesState<NData | { count: number }>([]); const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [name, setName] = useState("Nouveau workflow"); const [desc, setDesc] = useState(""); const [sel, setSel] = useState<string | null>(null); const [dirty, setDirty] = useState(false);
  const [check, setCheck] = useState<{ ok: boolean; errors: string[]; warnings: string[] }>({ ok: true, errors: [], warnings: [] }); const [loadedFor, setLoadedFor] = useState<string | null>(null); const [start, setStart] = useState(isNew && !wfId);
  const [runWf, setRunWf] = useState<any>(); const [propose, setPropose] = useState(false); const wrap = useRef<HTMLDivElement>(null); const rf = useReactFlow(); const useWt = useRef(false);

  const steps = useMemo(() => nodes.filter((n) => n.id !== ORCH).map((n) => (n.data as NData).node), [nodes]);
  const realEdges = useMemo(() => edges.filter((e) => !e.id.startsWith("v-")), [edges]);
  const plan = useMemo(() => toPlan(steps, realEdges.map((e) => ({ source: e.source, target: e.target }))).map((n) => ({ ...n, pos: nodes.find((x) => x.id === n.key)?.position })), [steps, realEdges, nodes]);

  /** Charge un graphe (plan) dans le canevas : positions mémorisées, sinon disposition automatique ; l'orchestrateur est toujours à gauche. */
  const load = useCallback((tasks: SNode[], keepName = true) => {
    const auto = autoLayout(tasks); const ns: Node[] = tasks.map((t) => ({ id: t.key, type: "step", position: t.pos ?? auto.get(t.key) ?? { x: 0, y: 0 }, data: { node: t, issues: [] } }));
    ns.push({ id: ORCH, type: "orch", position: { x: -320, y: 0 }, data: { count: tasks.length }, deletable: false, draggable: true });
    setNodes(ns); setEdges(edgesOf(tasks).map((e) => mkEdge(e.source, e.target))); setSel(null); setDirty(false); void keepName; setTimeout(() => rf.fitView({ padding: 0.12, minZoom: 0.55, maxZoom: 1, duration: 400 }), 60);
  }, [rf, setNodes, setEdges]);
  useEffect(() => { if (wfId && wf && loadedFor !== wfId) { setLoadedFor(wfId); setName(wf.name); setDesc(wf.description ?? ""); load(wf.nodes); setStart(false); } }, [wfId, wf, loadedFor, load]);
  useEffect(() => { if (!wfId && nodes.length === 0) load([]); }, [wfId]);  // canevas vide avec son orchestrateur

  // liens virtuels orchestrateur → premières étapes (visuels, jamais enregistrés)
  const shownEdges = useMemo(() => { const r = new Set(roots(toPlan(steps, realEdges.map((e) => ({ source: e.source, target: e.target }))))); return [...realEdges, ...[...r].map((k): Edge => ({ id: `v-${k}`, source: ORCH, target: k, type: "smoothstep", animated: false, focusable: false, deletable: false, style: { stroke: "var(--accent)", strokeWidth: 1.5, strokeDasharray: "5 6", opacity: 0.6 } }))]; }, [steps, realEdges]);

  // validation en direct (moteur du cœur : mêmes règles qu'au lancement)
  useEffect(() => {
    if (!steps.length) { setCheck({ ok: true, errors: [], warnings: [] }); return; }
    const t = setTimeout(() => { api("wf.check", plan, useWt.current).then((c: any) => setCheck(c)).catch(() => {}); }, 350); return () => clearTimeout(t);
  }, [plan]);
  useEffect(() => { const msgs = [...check.errors, ...check.warnings]; setNodes((ns) => ns.map((n) => { if (n.id === ORCH) return { ...n, data: { count: steps.length } }; const d = n.data as NData; const issues = msgs.filter((m) => m.includes(`« ${n.id} »`)); return JSON.stringify(issues) === JSON.stringify(d.issues) ? n : { ...n, data: { ...d, issues } }; })); }, [check, steps.length]);

  const patch = (key: string, p: Partial<SNode>) => { setNodes((ns) => ns.map((n) => (n.id === key ? { ...n, data: { ...(n.data as NData), node: { ...(n.data as NData).node, ...p } } } : n))); setDirty(true); };
  const add = (kind: Kind, role = "fullstack", at?: { x: number; y: number }) => {
    if (steps.length >= MAX_NODES) { toast(`${MAX_NODES} étapes au maximum par workflow.`, "error"); return; }
    const title = kind === "agent" ? roleLabel(role) : KIND[kind].label; const key = slugKey(title, steps.map((s) => s.key));
    const xs = nodes.filter((n) => n.id !== ORCH).map((n) => n.position.x); const pos = at ?? { x: (xs.length ? Math.max(...xs) : -290) + 290, y: 0 }; if (!at) setTimeout(() => rf.fitView({ padding: 0.12, minZoom: 0.55, maxZoom: 1, duration: 350 }), 80);
    const node: SNode = { key, title, role, kind, dependsOn: [], description: kind === "agent" ? "Objectif : {{goal}}. " : kind === "test" ? "" : "", command: kind === "test" ? "npm test" : undefined };
    setNodes((ns) => [...ns, { id: key, type: "step", position: pos, data: { node, issues: [] }, selected: true }].map((n) => (n.id === key ? n : { ...n, selected: false }))); setSel(key); setDirty(true);
  };
  const onConnect = useCallback((c: Connection) => { if (!c.source || !c.target || c.source === ORCH) return; if (wouldCycle(edgesOf(plan), c.source, c.target)) { toast("Ce lien créerait une boucle : une étape ne peut pas dépendre d'elle-même, même indirectement.", "error"); return; } setEdges((es) => (es.some((e) => e.id === `${c.source}->${c.target}`) ? es : [...es, mkEdge(c.source!, c.target!)])); setDirty(true); }, [plan, setEdges]);
  const onDrop = (e: DragEvent) => { e.preventDefault(); const raw = e.dataTransfer.getData("application/acc-node"); if (!raw) return; const { kind, role } = JSON.parse(raw); add(kind, role, rf.project({ x: e.clientX - (wrap.current?.getBoundingClientRect().left ?? 0) - 118, y: e.clientY - (wrap.current?.getBoundingClientRect().top ?? 0) - 40 })); };
  const remove = (key: string) => { setNodes((ns) => ns.filter((n) => n.id !== key)); setEdges((es) => es.filter((e) => e.source !== key && e.target !== key)); setSel(null); setDirty(true); };

  const save = async (): Promise<string | undefined> => {
    if (!name.trim()) { toast("Donnez un nom au workflow.", "error"); return; } if (wf?.builtin) { toast("Un modèle livré n'est pas modifiable : dupliquez-le.", "error"); return; }
    try { const id = await api("wf.save", { id: wfId ?? undefined, name, description: desc, nodes: plan }); setDirty(false); toast("Workflow enregistré.", "success"); setLoadedFor(id); reload(); if (!wfId) setSp({ id }, { replace: true }); return id; } catch (e: any) { toast(errMsg(e), "error"); }
  };
  const run = async () => { const id = dirty || !wfId ? await save() : wfId; if (id) setRunWf({ id, name, nodes: plan }); };
  const arrange = () => { const pos = autoLayout(steps); setNodes((ns) => ns.map((n) => (n.id === ORCH ? n : { ...n, position: pos.get(n.id) ?? n.position }))); setDirty(true); setTimeout(() => rf.fitView({ padding: 0.12, minZoom: 0.55, maxZoom: 1, duration: 400 }), 60); };
  const selNode = sel && sel !== ORCH ? steps.find((s) => s.key === sel) : undefined; const incoming = selNode ? realEdges.filter((e) => e.target === selNode.key).length : 0;

  const fromTemplate = (w: any) => { setName(w.builtin ? `${w.name} (copie)` : w.name); setDesc(w.description ?? ""); load(w.nodes.map((n: SNode) => ({ ...n, pos: undefined }))); setStart(false); setDirty(true); };
  const back = () => { window.location.hash = "/workflows"; };

  return <div className="flex flex-col min-h-0" style={{ height: "calc(100vh - 56px)" }}>
    <div className="shrink-0 h-14 border-b border-line flex items-center gap-3 px-4 bg-bg">
      <button className="btn btn-ghost btn-icon" aria-label="Retour aux workflows" onClick={async () => { if (!dirty || await confirmDialog({ title: "Quitter sans enregistrer ?", body: "Les modifications du canevas seront perdues.", confirmLabel: "Quitter", danger: true })) back(); }}><ArrowLeft size={16} /></button>
      <input className="input !h-9 !w-64 !font-semibold" aria-label="Nom du workflow" value={name} maxLength={60} onChange={(e) => { setName(e.target.value); setDirty(true); }} />
      <span className={`inline-flex items-center gap-1.5 text-xs whitespace-nowrap ${check.errors.length ? "text-danger" : check.warnings.length ? "text-warning" : "text-success"}`} role="status">{check.errors.length ? <><AlertTriangle size={13} />{check.errors.length} erreur(s)</> : check.warnings.length ? <><AlertTriangle size={13} />{check.warnings.length} avertissement(s)</> : <><CheckCircle2 size={13} />{steps.length ? "Graphe valide" : "Canevas vide"}</>}</span>
      {dirty && <span className="text-2xs text-muted whitespace-nowrap">non enregistré</span>}
      <input className="input !h-9 !w-72 hidden 2xl:block" aria-label="Description du workflow" placeholder="Description (facultatif)" value={desc} maxLength={200} onChange={(e) => { setDesc(e.target.value); setDirty(true); }} />
      <div className="ml-auto flex items-center gap-2"><button className="btn btn-sm" onClick={() => setPropose(true)} title="L'agent orchestrateur propose un graphe à partir d'un objectif"><Wand2 size={14} />Proposer avec l'orchestrateur</button><button className="btn btn-sm" onClick={arrange}><LayoutGrid size={14} />Ranger</button>
        {wf?.builtin ? <button className="btn btn-primary btn-sm" onClick={async () => { const id = await api("wf.duplicate", wf.id); reload(); setLoadedFor(null); setSp({ id }, { replace: true }); toast("Copie créée : vous pouvez la modifier.", "success"); }}><Copy size={14} />Dupliquer pour modifier</button> : <button className="btn btn-sm" disabled={!dirty} onClick={() => void save()}><Save size={14} />Enregistrer</button>}
        <button className="btn btn-primary btn-sm" disabled={!steps.length || check.errors.length > 0} onClick={() => void run()}><Play size={14} />Lancer</button></div></div>
    <div className="flex-1 flex min-h-0">
      <aside aria-label="Palette" className="w-[212px] shrink-0 border-r border-line bg-sidebar overflow-auto p-3 space-y-4">
        <p className="text-2xs text-muted leading-snug">Glissez une étape sur le canevas, ou cliquez pour l'ajouter. Reliez-les par leurs poignées.</p>
        <div><div className="text-2xs uppercase tracking-wider text-muted mb-1.5">Agents IA</div><div className="grid gap-1">{ROLES.filter(([r]) => r !== "orchestrator").map(([r, l]) => <PaletteItem key={r} kind="agent" role={r} label={l} onAdd={() => add("agent", r)} />)}</div></div>
        <div><div className="text-2xs uppercase tracking-wider text-muted mb-1.5">Contrôle</div><div className="grid gap-1">{(["approval", "test", "notification"] as Kind[]).map((k) => <PaletteItem key={k} kind={k} label={KIND[k].label} hint={KIND[k].hint} onAdd={() => add(k)} />)}</div></div></aside>
      <div ref={wrap} className="flex-1 min-w-0 relative" onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }} onDrop={onDrop}>
        <ReactFlow nodes={nodes} edges={shownEdges} nodeTypes={nodeTypes} onNodesChange={(c) => { onNodesChange(c); if (c.some((x) => x.type === "position" && x.dragging === false || x.type === "remove")) setDirty(true); }} onEdgesChange={(c) => { onEdgesChange(c.filter((x) => !("id" in x) || !String((x as any).id).startsWith("v-"))); if (c.some((x) => x.type === "remove")) setDirty(true); }} onConnect={onConnect}
          isValidConnection={(c) => !!c.source && !!c.target && c.source !== c.target && c.target !== ORCH && c.source !== ORCH && !wouldCycle(edgesOf(plan), c.source, c.target)} onSelectionChange={({ nodes: s }) => setSel(s[0]?.id ?? null)} onPaneClick={() => setSel(null)}
          fitView fitViewOptions={{ padding: 0.12, minZoom: 0.55, maxZoom: 1 }} minZoom={0.25} maxZoom={1.6} deleteKeyCode={["Backspace", "Delete"]} proOptions={{ hideAttribution: true }} defaultEdgeOptions={{ type: "smoothstep" }} connectionLineStyle={edgeStyle} snapToGrid snapGrid={[16, 16]}>
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.6} color="var(--border-strong)" /><Controls showInteractive={false} /><MiniMap pannable zoomable nodeColor={(n) => (n.id === ORCH ? "#e0865f" : KIND[(n.data as NData).node?.kind ?? "agent"].color)} maskColor="rgba(0,0,0,.18)" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12 }} /></ReactFlow>
        {(check.errors.length > 0 || check.warnings.length > 0) && <div className="absolute left-3 bottom-3 max-w-[360px] rounded-2xl border border-line-strong bg-panel/95 backdrop-blur p-3 text-xs space-y-1 shadow-lg" role="status">{check.errors.map((m) => <p key={m} className="text-danger">• {m}</p>)}{check.warnings.map((m) => <p key={m} className="text-warning">• {m}</p>)}</div>}
      
        {start && <div className="absolute inset-0 z-10 bg-bg/85 backdrop-blur-sm grid place-items-center p-6 overflow-auto"><div className="max-w-3xl w-full anim-pop"><h2 className="font-display text-[30px] mb-1">Par où commencer ?</h2><p className="text-fg2 text-[14px] mb-5">Composez une équipe d'agents sous la supervision de l'orchestrateur : un canevas vide, un modèle à adapter, ou laissez l'orchestrateur proposer un graphe.</p>
          <div className="grid sm:grid-cols-2 gap-3"><button className="card lift p-4 text-left" onClick={() => { setStart(false); }}><Plus size={18} className="text-accent mb-2" /><div className="font-semibold">Canevas vide</div><div className="text-xs text-muted">Ajoutez vos propres agents et reliez-les.</div></button>
            <button className="card lift p-4 text-left" onClick={() => { setStart(false); setPropose(true); }}><Wand2 size={18} className="text-accent mb-2" /><div className="font-semibold">Proposé par l'orchestrateur</div><div className="text-xs text-muted">Donnez un objectif et un projet : un agent en lecture seule propose le graphe, vous le corrigez.</div></button>
            {list?.filter((w) => w.builtin).map((w) => <button key={w.id} className="card lift p-4 text-left" onClick={() => fromTemplate(w)}><GitBranch size={18} className="text-accent mb-2" /><div className="font-semibold">{w.name}</div><div className="text-xs text-muted line-clamp-2">{w.description}</div><div className="text-2xs text-muted mt-1.5">{w.nodes.length} étapes</div></button>)}</div></div></div>}
      </div>
  {sel && <aside aria-label="Réglages de l'étape" className="w-[320px] shrink-0 border-l border-line bg-sidebar overflow-auto p-4 anim-slide">{sel === ORCH ? <OrchPanel count={steps.length} onWt={(v) => { useWt.current = v; setDirty(true); }} onPropose={() => setPropose(true)} />
          : selNode ? <Inspector node={selNode} incoming={incoming} onPatch={(p) => patch(selNode.key, p)} onDelete={() => remove(selNode.key)} /> : null}</aside>}
    </div>
    <RunDialog wf={runWf} onClose={() => setRunWf(undefined)} />
    <ProposeDialog open={propose} onClose={() => setPropose(false)} hasNodes={steps.length > 0} onPlan={(tasks) => { load(tasks.map((t) => ({ ...t, pos: undefined }))); setDirty(true); setStart(false); }} />
  </div>;
}

function PaletteItem({ kind, role, label, hint, onAdd }: { kind: Kind; role?: string; label: string; hint?: string; onAdd: () => void }) {
  const K = KIND[kind]; const I = K.icon;
  return <button type="button" draggable onDragStart={(e) => { e.dataTransfer.setData("application/acc-node", JSON.stringify({ kind, role })); e.dataTransfer.effectAllowed = "copy"; }} onClick={onAdd} title={hint ?? K.hint} className="flex items-center gap-2.5 h-9 px-2 rounded-xl border border-transparent hover:border-line-strong hover:bg-raised text-left text-[13px] cursor-grab active:cursor-grabbing transition-colors"><span className="w-6 h-6 rounded-lg grid place-items-center shrink-0" style={{ background: `color-mix(in srgb, ${K.color} 16%, transparent)`, color: K.color }}><I size={13} /></span><span className="truncate">{label}</span></button>;
}

function Inspector({ node, incoming, onPatch, onDelete }: { node: SNode; incoming: number; onPatch: (p: Partial<SNode>) => void; onDelete: () => void }) {
  const K = KIND[node.kind]; const I = K.icon;
  return <div className="space-y-4"><div className="flex items-center gap-2.5"><span className="w-9 h-9 rounded-xl grid place-items-center" style={{ background: `color-mix(in srgb, ${K.color} 16%, transparent)`, color: K.color }}><I size={18} /></span><div className="min-w-0"><div className="font-semibold text-[14px]">{K.label}</div><div className="text-2xs text-muted mono truncate">{node.key}</div></div></div>
    <Field label="Titre"><input className="input" value={node.title} maxLength={80} onChange={(e) => onPatch({ title: e.target.value })} /></Field>
    {node.kind === "agent" && <>
      <Field label="Rôle de l'agent"><select className="input" value={node.role} onChange={(e) => onPatch({ role: e.target.value })}>{ROLES.filter(([r]) => r !== "orchestrator").map(([r, l]) => <option key={r} value={r}>{l}</option>)}</select></Field>
      <div><label className="label">Fournisseur</label><div role="radiogroup" aria-label="Fournisseur" className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-bg border border-line">{([[undefined, "Auto"], ["claude", "Claude"], ["codex", "Codex"]] as const).map(([v, l]) => <button key={l} type="button" role="radio" aria-checked={node.provider === v} onClick={() => onPatch({ provider: v })} className={`h-8 rounded-lg text-[13px] transition-colors ${node.provider === v ? "bg-panel border border-line-strong font-medium" : "text-muted hover:text-fg border border-transparent"}`}>{l}</button>)}</div></div>
      <Field label="Instructions" hint="{{goal}} sera remplacé par l'objectif au lancement. Les agents voient le travail des étapes précédentes."><textarea className="input" rows={7} value={node.description ?? ""} onChange={(e) => onPatch({ description: e.target.value })} placeholder="Ce que cet agent doit faire, précisément." /></Field></>}
    {node.kind === "test" && <Field label="Commande" hint="Exécutée dans le dossier du projet, après votre confirmation au lancement."><input className="input mono" value={node.command ?? ""} onChange={(e) => onPatch({ command: e.target.value })} placeholder="npm test" /></Field>}
    {(node.kind === "approval" || node.kind === "notification") && <Field label="Message"><textarea className="input" rows={4} value={node.description ?? ""} onChange={(e) => onPatch({ description: e.target.value })} placeholder={node.kind === "approval" ? "Ce que vous devez vérifier avant de continuer" : "Texte de la notification"} /></Field>}
    {node.kind === "agent" && <label className="flex items-start gap-2.5 text-[13px] cursor-pointer rounded-xl border border-line p-3 hover:bg-raised"><input type="checkbox" className="mt-0.5 w-4 h-4 accent-[var(--accent)]" checked={!!node.gate} onChange={(e) => onPatch({ gate: e.target.checked })} /><span><span className="font-medium flex items-center gap-1.5"><ShieldAlert size={13} className="text-warning" />Validation avant exécution</span><span className="text-xs text-muted block mt-0.5">L'orchestrateur attend votre accord avant de lancer cet agent.</span></span></label>}
    <p className="text-xs text-muted">{incoming === 0 ? "Première étape : lancée directement par l'orchestrateur." : `Attend ${incoming} étape(s) précédente(s) ; reçoit leur résultat.`}</p>
    <button className="btn btn-sm w-full !text-danger" onClick={onDelete}><Trash2 size={13} />Supprimer l'étape</button></div>;
}

function OrchPanel({ count, onWt, onPropose }: { count: number; onWt: (v: boolean) => void; onPropose: () => void }) {
  const [wt, setWt] = useState(false);
  return <div className="space-y-4"><div className="flex items-center gap-2.5"><span className="w-10 h-10 rounded-2xl grid place-items-center text-white" style={{ background: "linear-gradient(135deg, #b4532c, #e0865f)" }}><Crown size={20} /></span><div><div className="font-semibold text-[15px]">Agent orchestrateur</div><div className="text-xs text-muted">supervise {count} étape(s)</div></div></div>
    <ul className="text-[13px] text-fg2 space-y-1.5 list-disc pl-4"><li>Lance chaque étape quand ses prédécesseurs sont terminées ; les branches indépendantes tournent en parallèle.</li><li>Respecte les limites de concurrence et les permissions de chaque rôle.</li><li>Transmet le résultat d'une étape à la suivante.</li><li>Met le workflow en pause si une étape échoue : vous relancez ou corrigez.</li><li>S'arrête aux étapes de validation et attend votre accord.</li></ul>
    <p className="text-xs text-muted rounded-xl border border-line p-3">L'ordre, la concurrence et les autorisations sont gérés par le moteur local, de façon déterministe. L'IA ne fait que <i>proposer</i> un graphe, que vous validez.</p>
    <label className="flex items-start gap-2.5 text-[13px] cursor-pointer"><input type="checkbox" className="mt-0.5 w-4 h-4 accent-[var(--accent)]" checked={wt} onChange={(e) => { setWt(e.target.checked); onWt(e.target.checked); }} /><span>Isoler les étapes qui écrivent dans des worktrees Git<span className="text-xs text-muted block">Évite les conflits entre agents parallèles (dépôt Git requis). Réglable aussi au lancement.</span></span></label>
    <button className="btn w-full" onClick={onPropose}><Wand2 size={14} />Proposer un graphe</button></div>;
}

/** L'orchestrateur (Claude ou Codex, lecture seule) propose un graphe pour un objectif ; rien n'est exécuté et l'orchestration technique créée pour la proposition est annulée aussitôt. */
function ProposeDialog({ open, onClose, hasNodes, onPlan }: { open: boolean; onClose: () => void; hasNodes: boolean; onPlan: (t: SNode[]) => void }) {
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

export default function Studio() { return <ReactFlowProvider><StudioInner /></ReactFlowProvider>; }
