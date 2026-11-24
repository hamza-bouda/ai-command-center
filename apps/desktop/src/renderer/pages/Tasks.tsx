import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, Search, LayoutGrid, List as ListIcon, Table2, Play, RotateCcw, ChevronDown, Flag, ArrowUp, ArrowDown, ExternalLink, CheckCheck, KanbanSquare } from "lucide-react";
import { api, fmt, usd, dur, ago } from "../api"; import { useData } from "../hooks"; import { useT } from "../i18n"; import { toast } from "../overlay";
import { AgentTerminal } from "../components/AgentCockpit";
import { AIModelConfiguration } from "../components/AIModelConfiguration"; import { Page, Card, Modal, Drawer, Field, EmptyState, ErrorState, LoadingSkeleton, Badge, StatusIndicator, Segmented, Tabs } from "../ui";

const COLS: [string, string][] = [["backlog", "Backlog"], ["todo", "À faire"], ["in_progress", "En cours"], ["review", "En validation"], ["done", "Terminé"], ["blocked", "Bloqué"]];
const COLNAME = Object.fromEntries(COLS);
const prio = (p: number) => p >= 7 ? { l: "Haute", c: "text-danger" } : p >= 4 ? { l: "Normale", c: "text-fg2" } : { l: "Basse", c: "text-muted" };
type View = "board" | "list" | "table";

/** Règles de déplacement manuel : on ne contourne ni le planificateur, ni la validation humaine. */
export function moveRule(task: any, to: string): { ok: boolean; reason?: string; action?: "start" | "status" } {
  if (task.status === to) return { ok: false };
  if (task.status === "in_progress") return { ok: false, reason: "Cette tâche est en cours d'exécution : arrêtez-la depuis Sessions avant de la déplacer." };
  if (to === "in_progress") return { ok: true, action: "start" };
  if (to === "done" && task.status !== "review") return { ok: false, reason: "Une tâche doit passer par « En validation » avant d'être terminée." };
  return { ok: true, action: "status" };
}

export default function Tasks() {
  const t = useT(); const [sp, setSp] = useSearchParams();
  const { data: tasks, err, loading, reload } = useData<any[]>("tasks.list", [], { events: /task|execution|usage/ });
  const { data: projects } = useData<any[]>("projects.list", []); const { data: agents } = useData<any[]>("agents.list", []);
  const { data: edges } = useData<any[]>("tasks.edges", [], { events: /task/ }); const { data: execs } = useData<any[]>("executions.list", [{ limit: 200 }], { events: /execution/ });
  const [view, setView] = useState<View>((localStorage.getItem("acc.tasks.view") as View) || "board"); const [q, setQ] = useState(""); const [fp, setFp] = useState(""); const [fa, setFa] = useState(""); const [fprov, setFprov] = useState("");
  const [creating, setCreating] = useState(false); const [openId, setOpenId] = useState<string>(); const [dragId, setDragId] = useState<string>(); const [over, setOver] = useState<string>(); const [sort, setSort] = useState<[string, 1 | -1]>(["created_at", -1]);
  useEffect(() => { if (sp.get("new")) { setCreating(true); sp.delete("new"); setSp(sp, { replace: true }); } }, [sp]);
  const setV = (v: View) => { setView(v); try { localStorage.setItem("acc.tasks.view", v); } catch { /* ok */ } };
  const agentOf = (id?: string) => agents?.find((a) => a.id === id); const projOf = (id: string) => projects?.find((p) => p.id === id);
  const provOf = (x: any) => x.provider ?? agentOf(x.agent_id)?.provider ?? projOf(x.project_id)?.default_provider;
  const filtered = useMemo(() => (tasks ?? []).filter((x) => (!fp || x.project_id === fp) && (!fa || x.agent_id === fa) && (!fprov || provOf(x) === fprov) && (!q || (x.title + " " + (x.description ?? "")).toLowerCase().includes(q.toLowerCase()))), [tasks, fp, fa, fprov, q, agents, projects]);
  const sorted = useMemo(() => [...filtered].sort((a, b) => { const [k, d] = sort; const av = a[k] ?? "", bv = b[k] ?? ""; return (av > bv ? 1 : av < bv ? -1 : 0) * d; }), [filtered, sort]);
  const depsOf = (id: string) => (edges ?? []).filter((e) => e.task_id === id).map((e) => tasks?.find((x) => x.id === e.depends_on)).filter(Boolean);

  const start = async (x: any) => { try { await api("tasks.start", x.id, false); toast("Tâche mise en file d'exécution.", "success"); reload(); } catch (e: any) { toast(e.message, "error"); } };
  const move = async (task: any, to: string) => { const r = moveRule(task, to); if (!r.ok) { if (r.reason) toast(r.reason, "warning"); return; } try { if (r.action === "start") await start(task); else { await api("tasks.setStatus", task.id, to); toast(`Déplacée vers « ${COLNAME[to]} ».`, "success"); reload(); } } catch (e: any) { toast(e.message, "error"); } };
  const open = tasks?.find((x) => x.id === openId);

  const Card_ = ({ x }: { x: any }) => { const a = agentOf(x.agent_id); const p = prio(x.priority); const prov = provOf(x); const running = x.status === "in_progress"; return <div draggable={!running} onDragStart={() => setDragId(x.id)} onDragEnd={() => { setDragId(undefined); setOver(undefined); }} onClick={() => setOpenId(x.id)} tabIndex={0} role="button" aria-label={x.title} onKeyDown={(e) => e.key === "Enter" && setOpenId(x.id)}
    className={`bg-raised border border-line rounded-xl p-3 mb-2 hover:border-line-strong cursor-pointer transition-colors ${dragId === x.id ? "opacity-40" : ""}`}>
    <div className="font-medium text-[13px] leading-snug mb-2 line-clamp-2">{x.title}</div>
    <div className="flex items-center flex-wrap gap-1.5 mb-2">{prov && <Badge v={prov} />}<span className={`inline-flex items-center gap-1 text-2xs ${p.c}`}><Flag size={11} />{p.l}</span>{x.attempts > 1 && <span className="text-2xs text-muted">· {x.attempts} tentatives</span>}</div>
    <div className="flex items-center justify-between text-xs text-muted"><span className="truncate max-w-[110px]">{a?.name ?? "Sans agent"}</span><span className="tnum">{x.tokens ? `${fmt(x.tokens)} tok` : projOf(x.project_id)?.name}</span></div></div>; };

  const header = <><div className="relative"><Search size={14} className="absolute left-3 top-2.5 text-muted" /><input className="input !pl-9 !w-56" placeholder={t("common.search")} aria-label="Rechercher une tâche" value={q} onChange={(e) => setQ(e.target.value)} /></div>
    <select className="input !w-40" aria-label="Filtrer par projet" value={fp} onChange={(e) => setFp(e.target.value)}><option value="">Tous les projets</option>{projects?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
    <select className="input !w-40" aria-label="Filtrer par agent" value={fa} onChange={(e) => setFa(e.target.value)}><option value="">Tous les agents</option>{agents?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
    <select className="input !w-36" aria-label="Filtrer par fournisseur" value={fprov} onChange={(e) => setFprov(e.target.value)}><option value="">Fournisseurs</option><option value="claude">Claude</option><option value="codex">Codex</option></select>
    <Segmented label="Vue" value={view} onChange={setV} options={[["board", <LayoutGrid key="b" size={14} />, "Tableau"], ["list", <ListIcon key="l" size={14} />, "Liste"], ["table", <Table2 key="t" size={14} />, "Table"]]} /></>;

  return <Page title={t("tasks.title")} sub={t("tasks.sub")} wide actions={<button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={15} />{t("common.newTask")}</button>}>
    <div className="flex flex-wrap items-center gap-2 mb-5">{header}</div>
    {err && !tasks ? <ErrorState message={err} onRetry={reload} /> : loading && !tasks ? <LoadingSkeleton rows={5} /> : !tasks?.length ? <Card><EmptyState icon={KanbanSquare} title={t("tasks.empty.title")} desc={t("tasks.empty.desc")} action={<button className="btn btn-primary" onClick={() => setCreating(true)}>{t("common.newTask")}</button>} /></Card>
    : view === "board" ? <div className="grid gap-3 overflow-x-auto pb-2" style={{ gridTemplateColumns: "repeat(6, minmax(188px, 1fr))" }}>{COLS.map(([k, label]) => { const items = filtered.filter((x) => x.status === k); return <section key={k} aria-label={label} onDragOver={(e) => { e.preventDefault(); setOver(k); }} onDragLeave={() => setOver(undefined)} onDrop={() => { const x = tasks.find((z) => z.id === dragId); setOver(undefined); if (x) void move(x, k); }}
      className={`rounded-2xl p-2 min-h-[320px] transition-colors ${over === k ? "bg-accent-subtle" : "bg-panel/60"} border border-line`}><div className="flex justify-between items-center px-2 py-1.5 mb-1.5 text-[13px] font-medium"><span>{label}</span><span className="text-xs text-muted tnum">{items.length}</span></div>{items.map((x) => <Card_ key={x.id} x={x} />)}</section>; })}</div>
    : view === "list" ? <div className="card divide-y divide-line">{sorted.map((x) => <div key={x.id} onClick={() => setOpenId(x.id)} className="flex items-center gap-4 px-4 py-3 row-hover cursor-pointer"><StatusIndicator status={x.status === "in_progress" ? "running" : x.status === "review" ? "waiting" : x.status === "done" ? "completed" : x.status} label={COLNAME[x.status]} size="sm" /><span className="flex-1 truncate font-medium text-[13px]">{x.title}</span>{provOf(x) && <Badge v={provOf(x)} />}<span className="text-xs text-muted w-28 truncate">{agentOf(x.agent_id)?.name ?? "—"}</span><span className="text-xs text-muted tnum w-24 text-right">{fmt(x.tokens)} tok</span></div>)}</div>
    : <div className="card overflow-auto"><table className="w-full"><thead><tr>{[["title", "Titre"], ["status", "Statut"], ["priority", "Priorité"], ["agent_id", "Agent"], ["tokens", "Tokens"], ["usd", "Éq. API"], ["created_at", "Créée"]].map(([k, l]) => <th key={k} className="th cursor-pointer select-none" onClick={() => setSort(([sk, sd]) => [k!, sk === k ? (sd === 1 ? -1 : 1) : 1])} aria-sort={sort[0] === k ? (sort[1] === 1 ? "ascending" : "descending") : "none"}><span className="inline-flex items-center gap-1">{l}{sort[0] === k && (sort[1] === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}</span></th>)}</tr></thead>
      <tbody>{sorted.map((x) => <tr key={x.id} className="row-hover cursor-pointer" onClick={() => setOpenId(x.id)}><td className="td font-medium max-w-[320px] truncate">{x.title}</td><td className="td">{COLNAME[x.status]}</td><td className={`td ${prio(x.priority).c}`}>{prio(x.priority).l}</td><td className="td text-fg2">{agentOf(x.agent_id)?.name ?? "—"}</td><td className="td tnum">{fmt(x.tokens)}</td><td className="td tnum">{usd(x.usd)}</td><td className="td text-muted">{ago(x.created_at)}</td></tr>)}</tbody></table></div>}

    <TaskCreate open={creating} onClose={() => setCreating(false)} projects={projects ?? []} agents={agents ?? []} tasks={tasks ?? []} onDone={reload} />
    <Drawer open={!!open} onClose={() => setOpenId(undefined)} width={520} title={open?.title ?? ""}>{open && <TaskDetail x={open} agent={agentOf(open.agent_id)} agents={agents ?? []} project={projOf(open.project_id)} deps={depsOf(open.id)} execs={(execs ?? []).filter((e) => e.task_id === open.id)} onStart={() => start(open)} onMove={(to: string) => move(open, to)} onSaved={reload} />}</Drawer></Page>;
}

function TaskDetail({ x, agent, agents, project, deps, execs, onStart, onMove, onSaved }: any) {
  const [tab, setTab] = useState<"overview" | "runs">("overview");
  const canStart = ["todo", "blocked", "review", "backlog"].includes(x.status);
  return <div><div className="flex flex-wrap gap-2 mb-4">{canStart && <button className="btn btn-primary" onClick={onStart}>{x.attempts ? <><RotateCcw size={14} />Relancer</> : <><Play size={14} />Démarrer</>}</button>}{x.status === "review" && <button className="btn" onClick={() => onMove("done")}><CheckCheck size={14} />Valider</button>}{x.status !== "backlog" && x.status !== "in_progress" && x.status !== "done" && <button className="btn btn-ghost" onClick={() => onMove("backlog")}>Mettre en backlog</button>}</div>
    <Tabs tabs={[["overview", "Aperçu"], ["runs", `Exécutions (${execs.length})`]]} value={tab} onChange={setTab} />
    {tab === "overview" ? <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 text-[13px]"><div><dt className="text-muted text-xs">Statut</dt><dd>{COLNAME[x.status]}</dd></div><div><dt className="text-muted text-xs">Projet</dt><dd>{project?.name}</dd></div>
        <div><dt className="text-muted text-xs">Consommation</dt><dd className="tnum">{fmt(x.tokens)} tokens · {usd(x.usd)}</dd></div><div><dt className="text-muted text-xs">Créée</dt><dd>{ago(x.created_at)}</dd></div></dl>
      {x.description && <div><div className="label">Description</div><p className="text-fg2 whitespace-pre-wrap text-[13px]">{x.description}</p></div>}
      <div className="grid grid-cols-2 gap-3"><Field label="Agent assigné"><select className="input" value={x.agent_id ?? ""} onChange={async (e) => { await api("tasks.update", x.id, { agentId: e.target.value }); onSaved(); }}><option value="">Défaut du projet</option>{agents.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <Field label="Priorité"><select className="input" value={x.priority >= 7 ? 8 : x.priority >= 4 ? 5 : 2} onChange={async (e) => { await api("tasks.update", x.id, { priority: Number(e.target.value) }); onSaved(); }}><option value={8}>Haute</option><option value={5}>Normale</option><option value={2}>Basse</option></select></Field></div>
      <div><div className="label">Dépendances</div>{deps.length ? deps.map((d: any) => <div key={d.id} className="flex justify-between text-[13px] py-1"><span>{d.title}</span><span className={d.status === "done" ? "text-success" : "text-muted"}>{COLNAME[d.status]}</span></div>) : <p className="text-muted text-[13px]">Aucune dépendance.</p>}<p className="text-xs text-muted mt-1">Une tâche attend la validation de ses dépendances avant de démarrer.</p></div>
      {x.result && <div><div className="label">Résultat</div><pre className="bg-bg border border-line rounded-lg p-3 text-[12px] whitespace-pre-wrap max-h-64 overflow-auto">{x.result}</pre></div>}
    </div> : <div className="space-y-2">{execs.length ? execs.map((e: any) => <div key={e.id} className="space-y-2"><Link to={`/sessions?open=${e.id}`} className="card p-3 flex items-center gap-3 hover:border-line-strong"><StatusIndicator status={e.status} size="sm" /><div className="flex-1 min-w-0 text-[13px]"><div>Tentative {e.attempt} · {e.model ?? "modèle par défaut"}</div><div className="text-xs text-muted tnum">{dur(e.duration_ms)} · {fmt(e.tokens)} tok · {usd(e.usd)}</div></div><ExternalLink size={14} className="text-muted" /></Link><details><summary className="cursor-pointer text-xs text-accent hover:underline list-none pl-1">Voir le terminal de cette tentative</summary><div className="mt-2"><AgentTerminal execId={e.id} title={`Tentative ${e.attempt}`} height={300} /></div></details></div>) : <p className="text-muted text-[13px]">Aucune exécution pour cette tâche.</p>}</div>}</div>;
}

function TaskCreate({ open, onClose, projects, agents, tasks, onDone }: any) {
  const t = useT(); const [f, setF] = useState<any>({ projectId: "", title: "", description: "", agentId: "", priority: 5, dependsOn: [] }); const [adv, setAdv] = useState(false); const [startNow, setStartNow] = useState(true); const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setF((x: any) => ({ ...x, projectId: x.projectId || projects[0]?.id || "" })); }, [open, projects]);
  const [cfgOn, setCfgOn] = useState(false); const [cfg, setCfg] = useState<any>({ provider: "claude", model: null, effort: null });
  const save = async () => { setBusy(true); try { const id = await api("tasks.create", { ...f, agentId: f.agentId || undefined, priority: Number(f.priority), ...(cfgOn ? { provider: cfg.provider, model: cfg.model || undefined } : {}) }); if (startNow) await api("tasks.start", id, false); toast(startNow ? "Tâche créée et mise en file." : "Tâche créée.", "success"); setF({ ...f, title: "", description: "", dependsOn: [] }); onDone(); onClose(); } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); } };
  return <Modal open={open} onClose={onClose} title={t("common.newTask")} footer={<><button className="btn" onClick={onClose}>{t("common.cancel")}</button><button className="btn btn-primary" disabled={!f.title.trim() || !f.projectId || busy} onClick={save}>{startNow ? "Créer et lancer" : t("common.create")}</button></>}>
    {!projects.length ? <p className="text-fg2 pb-3">Ajoutez d'abord un projet pour créer une tâche. <Link className="text-accent" to="/projects?new=1" onClick={onClose}>Ajouter un projet</Link></p> : <>
      <Field label="Que doit faire l'agent ?"><textarea className="input" rows={3} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Ex. Ajouter des tests unitaires pour le module de facturation" /></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="Projet"><select className="input" value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}>{projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Agent"><select className="input" value={f.agentId} onChange={(e) => setF({ ...f, agentId: e.target.value })}><option value="">Défaut du projet</option>{agents.map((a: any) => <option key={a.id} value={a.id}>{a.name} ({a.provider})</option>)}</select></Field></div>
      <label className="flex items-center gap-2 text-[13px] text-fg2 mb-3"><input type="checkbox" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} />Lancer immédiatement</label>
      <button className="text-[13px] text-muted hover:text-fg inline-flex items-center gap-1 mb-3" onClick={() => setAdv(!adv)} aria-expanded={adv}><ChevronDown size={14} className={adv ? "rotate-180" : ""} />Options avancées</button>
      {adv && <div className="anim-fade"><Field label="Description détaillée"><textarea className="input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-[13px] text-fg2 mb-3"><input type="checkbox" checked={cfgOn} onChange={(e) => setCfgOn(e.target.checked)} />Choisir le fournisseur et le modèle de cette tâche</label>{cfgOn && <div className="mb-3"><AIModelConfiguration mode="code" value={cfg} onChange={setCfg} showEffort={false} showPolicy={false} /></div>}
        <Field label="Priorité"><select className="input" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value={8}>Haute</option><option value={5}>Normale</option><option value={2}>Basse</option></select></Field>
        <Field label="Dépend de" hint="Ctrl/Cmd + clic pour en sélectionner plusieurs."><select multiple className="input !h-24" value={f.dependsOn} onChange={(e) => setF({ ...f, dependsOn: Array.from(e.target.selectedOptions).map((o) => o.value) })}>{tasks.filter((x: any) => x.project_id === f.projectId).map((x: any) => <option key={x.id} value={x.id}>{x.title}</option>)}</select></Field></div>}</>}</Modal>;
}
