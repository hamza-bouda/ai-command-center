import React, { useEffect, useMemo, useState, useRef } from "react";
import { NavLink, useLocation, useNavigate, Link } from "react-router-dom";
import { Database, ShieldCheck, Zap, MessageSquare, Briefcase, Code2, Home, SquareTerminal, LayoutDashboard, FolderGit2, Bot, KanbanSquare, TerminalSquare, BarChart3, Gauge, GitBranch, Bell, Settings as Cog, Workflow, Columns, Puzzle, Activity, PanelLeftClose, PanelLeftOpen, Search, Plus, PanelRight, ChevronRight, Asterisk, Library, Share2, CornerDownLeft, AlertTriangle, RefreshCw } from "lucide-react";
import { useData, useLiveEvents } from "./hooks"; import { useT } from "./i18n"; import { StatusIndicator } from "./ui"; import { ago } from "./api";

export const MODE_ITEMS: [string, string, any][] = [["/chat", "nav.chat", MessageSquare], ["/work", "nav.work", Briefcase], ["/code", "nav.code", Code2]];
export const CODE_ITEMS: [string, string, any][] = [["/projects", "nav.projects", FolderGit2], ["/agents", "nav.agents", Bot], ["/tasks", "nav.tasks", KanbanSquare], ["/sessions", "nav.sessions", TerminalSquare], ["/orchestrator", "nav.orchestrator", Share2], ["/git", "nav.git", GitBranch], ["/terminal", "nav.terminal", SquareTerminal], ["/quality", "nav.quality", ShieldCheck], ["/workflows", "nav.workflows", Workflow], ["/compare", "nav.compare", Columns]];
export const COMMON_ITEMS: [string, string, any][] = [["/overview", "nav.overview", LayoutDashboard], ["/analytics", "nav.analytics", BarChart3], ["/quotas", "nav.quotas", Gauge], ["/activity", "nav.activity", Activity], ["/automations", "nav.automations", Zap], ["/notifications", "nav.notifications", Bell], ["/library", "nav.library", Library], ["/knowledge", "nav.knowledge", Database], ["/mcp", "nav.mcp", Puzzle], ["/settings", "nav.settings", Cog]];
export const NAV_GROUPS: { label: string; items: [string, string, any][] }[] = [{ label: "nav.modes", items: [["/", "nav.home", Home], ...MODE_ITEMS] }, { label: "nav.code", items: CODE_ITEMS }, { label: "nav.common", items: COMMON_ITEMS }];
/** Pages qui appartiennent à l'expérience Code (la barre latérale déplie alors ses outils). */
export const inCodeFamily = (p: string) => ["/code", ...CODE_ITEMS.map((x) => x[0])].some((x) => p === x || p.startsWith(x + "/"));
const SOON = new Set<string>();
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* indisponible */ } } };

export class ErrorBoundary extends React.Component<{ children: React.ReactNode; resetKey?: string }, { err?: Error }> {
  state: { err?: Error } = {};
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidUpdate(p: { resetKey?: string }) { if (p.resetKey !== this.props.resetKey && this.state.err) this.setState({ err: undefined }); }
  render() {
    if (!this.state.err) return this.props.children;
    return <div role="alert" className="p-10 max-w-xl mx-auto"><div className="card p-6"><div className="flex items-center gap-2 text-danger font-semibold mb-2"><AlertTriangle size={18} />Cet écran a rencontré un problème</div><p className="text-fg2 mb-4">Le reste de l'application reste utilisable. {this.state.err.message}</p><button className="btn" onClick={() => this.setState({ err: undefined })}><RefreshCw size={14} />Réessayer</button></div></div>;
  }
}

const GROUPS: { id: string; label: string; items: string[] }[] = [
  { id: "track", label: "Suivi", items: ["/overview", "/analytics", "/quotas", "/activity"] },
];
function Sidebar({ collapsed, toggle }: { collapsed: boolean; toggle: () => void }) {
  const t = useT(); const { pathname } = useLocation(); const { data: d } = useData<any>("dashboard", [], { events: /execution|notification|approval/ }); const { data: p } = useData<any>("providers.all", [], { every: 60000 });
  const code = inCodeFamily(pathname); const badge = (to: string) => to === "/sessions" ? (d?.counts.running || 0) + (d?.counts.waiting || 0) : to === "/notifications" ? d?.counts.unread || 0 : to === "/tasks" ? d?.counts.queued || 0 : 0;
  const [open, setOpen] = useState<Record<string, boolean>>(() => { try { return JSON.parse(store.get("acc.groups") ?? "{}"); } catch { return {}; } });
  const flip = (id: string, cur: boolean) => { const n = { ...open, [id]: !cur }; setOpen(n); store.set("acc.groups", JSON.stringify(n)); };
  const idx = pathname.startsWith("/chat") ? 0 : pathname.startsWith("/work") ? 1 : code ? 2 : -1;
  const ALL = new Map<string, [string, any]>([...CODE_ITEMS, ...COMMON_ITEMS].map(([to, key, I]) => [to, [key, I]]));
  const item = (to: string) => { const [key, I] = ALL.get(to)!; const n = badge(to);
    return <NavLink key={to} to={to} aria-label={t(key)} title={collapsed ? t(key) : undefined} className={`nav-item ${collapsed ? "!justify-center !px-0" : ""}`}>
      {() => <><I size={16} aria-hidden className="shrink-0" />{!collapsed && <span className="flex-1 truncate">{t(key)}</span>}{!collapsed && n > 0 && <span className="tnum text-2xs px-1.5 rounded-full bg-raised text-fg2">{n}</span>}{collapsed && n > 0 && <span className="absolute top-1.5 right-3 w-2 h-2 rounded-full bg-accent" />}</>}</NavLink>; };
  const group = (id: string, label: string, items: string[], dflt: boolean) => { const isOpen = open[id] ?? dflt; const hasActive = items.some((x) => pathname === x || pathname.startsWith(x + "/"));
    return <div key={id} className="mt-3"><button type="button" onClick={() => flip(id, isOpen)} aria-expanded={isOpen} data-open={isOpen} className="w-full flex items-center gap-1.5 px-2.5 h-7 text-2xs font-semibold text-muted uppercase tracking-wider hover:text-fg2 transition-colors"><ChevronRight size={12} className="chev" aria-hidden />{label}{!isOpen && hasActive && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-accent" />}</button>
      <div className="fold" data-open={isOpen || hasActive}><div className="space-y-0.5 pt-0.5">{items.map(item)}</div></div></div>; };
  return <aside aria-label="Navigation principale" className="shrink-0 bg-sidebar border-r border-line flex flex-col transition-[width] duration-200" style={{ width: collapsed ? 64 : 248 }}>
    <div className={`h-14 flex items-center shrink-0 ${collapsed ? "justify-center" : "px-4 justify-between"}`}><Link to="/" className="flex items-center gap-2.5 min-w-0 group" aria-label="AI Command Center — accueil"><span className="w-7 h-7 grid place-items-center shrink-0 text-accent transition-transform duration-500 group-hover:rotate-90"><Asterisk size={24} strokeWidth={2.6} aria-hidden /></span>{!collapsed && <span className="font-semibold tracking-tight truncate">Command Center</span>}</Link>
      {!collapsed && <button className="btn btn-ghost btn-icon" onClick={toggle} aria-label="Réduire la barre latérale"><PanelLeftClose size={16} /></button>}</div>
    {collapsed && <button className="btn btn-ghost btn-icon mx-auto mb-1" onClick={toggle} aria-label="Déployer la barre latérale"><PanelLeftOpen size={16} /></button>}
    <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3">
      {collapsed ? <div className="space-y-0.5">{MODE_ITEMS.map(([to, key, I], i) => <NavLink key={to} to={to} title={t(key)} aria-label={t(key)} className="nav-item !justify-center !px-0 !h-10" data-on={idx === i}><I size={18} /></NavLink>)}<div className="h-px bg-line mx-2 my-2" />{[...(code ? CODE_ITEMS : []), ...COMMON_ITEMS].filter(([to]) => to !== "/settings").map(([to]) => item(to))}</div>
      : <>
        <div className="mode-switch mt-1" role="navigation" aria-label="Mode"><span className="mode-ind" aria-hidden style={{ transform: `translateX(${Math.max(idx, 0) * 100}%)`, opacity: idx < 0 ? 0 : 1 }} />
          {MODE_ITEMS.map(([to, key, I], i) => <NavLink key={to} to={to} data-on={idx === i} aria-current={idx === i ? "page" : undefined}><I size={15} aria-hidden />{t(key)}</NavLink>)}</div>
        <div className="mt-3 space-y-0.5"><NavLink to="/" end className="nav-item"><Home size={16} className="shrink-0" />{t("nav.home")}</NavLink></div>
        {code && group("code", t("nav.codeTools"), CODE_ITEMS.map((x) => x[0]), true)}
        {group("track", "Suivi", GROUPS[0]!.items, false)}
        <div className="mt-3 space-y-0.5">{["/library", "/knowledge", "/automations", "/notifications", "/mcp"].map(item)}</div></>}
    </nav>
    <div className="border-t border-line p-2.5 min-w-0 shrink-0 space-y-1">
      {!collapsed && item("/settings")}{collapsed && <div className="flex justify-center">{item("/settings")}</div>}
      <Link to="/quotas" className={`flex items-center min-w-0 min-h-8 rounded-lg px-2 hover:bg-raised transition-colors ${collapsed ? "flex-col justify-center gap-1.5 py-1" : "gap-3"}`} title="Fournisseurs connectés par abonnement">
        {(["claude", "codex"] as const).map((k) => { const s = p?.[k]; const ok = s?.authenticated && s.authMode === "subscription"; return <span key={k} className="inline-flex items-center gap-1.5 min-w-0" title={`${k === "claude" ? "Claude Code" : "Codex"} : ${!s ? "…" : !s.installed ? "absent" : ok ? "connecté" : "à vérifier"}`}><span className={`w-2 h-2 rounded-full shrink-0 ${ok ? "bg-success" : s?.installed ? "bg-warning" : "bg-muted"}`} aria-hidden />{!collapsed && <span className="text-xs text-fg2 truncate">{k === "claude" ? "Claude" : "Codex"}</span>}<span className="sr-only">{k} {ok ? "connecté" : "à vérifier"}</span></span>; })}
        {!collapsed && <span className="ml-auto text-2xs text-muted shrink-0">abonnement</span>}</Link></div>
  </aside>;
}

function Breadcrumbs() {
  const t = useT(); const { pathname } = useLocation(); const all = NAV_GROUPS.flatMap((g) => g.items); const cur = all.find(([to]) => (to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(to + "/")));
  return <nav aria-label="Fil d'Ariane" className="flex items-center gap-2 text-[13px] text-muted"><span className="text-fg font-semibold text-[14px] tracking-tight">{cur ? t(cur[1]) : ""}</span></nav>;
}

function Topbar({ onPalette, panelOpen, togglePanel }: { onPalette: () => void; panelOpen: boolean; togglePanel: () => void }) {
  const t = useT(); const nav = useNavigate(); const { data: d } = useData<any>("dashboard", [], { events: /execution|notification/ }); const isMac = navigator.platform.includes("Mac");
  const active = (d?.counts.running ?? 0);
  return <header className="h-14 shrink-0 border-b border-line flex items-center gap-3 px-5 bg-bg/80 backdrop-blur">
    <Breadcrumbs />
    <button onClick={onPalette} className="ml-auto hidden md:flex items-center gap-2 h-9 w-[320px] px-3 rounded-lg bg-panel border border-line text-muted hover:border-line-strong text-[13px]" aria-label="Ouvrir la recherche globale"><Search size={14} /><span className="flex-1 text-left">{t("common.search")}</span><span className="kbd">{isMac ? "⌘" : "Ctrl"} K</span></button>
    <button onClick={onPalette} className="md:hidden btn btn-ghost btn-icon ml-auto" aria-label="Recherche"><Search size={16} /></button>
    {active > 0 && <button onClick={() => nav("/sessions")} className="hidden lg:inline-flex items-center gap-2 text-[13px] text-success px-3 h-8 rounded-full bg-[var(--success-subtle)] hover:brightness-125 transition anim-pop"><span className="w-2 h-2 rounded-full bg-success pulse-dot" aria-hidden />{`${active} agent${active > 1 ? "s" : ""} en cours`}</button>}
    <button className="btn" onClick={() => nav("/tasks?new=1")}><Plus size={15} />{t("common.newTask")}</button>
    <button className="btn btn-ghost btn-icon relative" aria-label={`Notifications${d?.counts.unread ? `, ${d.counts.unread} non lues` : ""}`} onClick={() => nav("/notifications")}><Bell size={16} />{d?.counts.unread > 0 && <span className="absolute top-1 right-1 min-w-[14px] h-[14px] px-1 rounded-full bg-accent text-[var(--accent-fg)] text-[9px] font-semibold grid place-items-center tnum">{d.counts.unread}</span>}</button>
    <button className={`btn btn-ghost btn-icon ${panelOpen ? "!bg-raised !text-fg" : ""}`} aria-pressed={panelOpen} aria-label="Panneau d'activité" onClick={togglePanel}><PanelRight size={16} /></button>
  </header>;
}

const EVT_LABEL: Record<string, string> = { "execution.queued": "Exécution en file", "execution.running": "Agent démarré", "execution.completed": "Tâche terminée", "execution.failed": "Exécution échouée", "execution.cancelled": "Exécution annulée", "execution.interrupted": "Exécution interrompue", "execution.waiting_approval": "Approbation requise", "usage.received": "Consommation mesurée", "git.worktree_created": "Worktree créé", "git.conflict": "Conflit Git", "quota.changed": "Quota mis à jour", "approval.requested": "Approbation demandée", "approval.resolved": "Approbation traitée", "notification": "Notification", "project.created": "Projet ajouté", "agent.created": "Agent créé", "task.created": "Tâche créée" };
export const evtLabel = (type: string) => EVT_LABEL[type] ?? type;
export const evtTone = (type: string) => /failed|conflict/.test(type) ? "text-danger" : /completed|resolved/.test(type) ? "text-success" : /approval|waiting|interrupted/.test(type) ? "text-warning" : "text-fg2";
function ActivityPanel() {
  const ev = useLiveEvents();
  return <aside aria-label="Activité en direct" className="w-[320px] max-w-[88vw] shrink-0 border-l border-line bg-sidebar flex flex-col anim-slide max-[1499px]:absolute max-[1499px]:right-0 max-[1499px]:top-0 max-[1499px]:bottom-0 max-[1499px]:z-30 max-[1499px]:shadow-[-18px_0_40px_rgba(0,0,0,.28)]"><div className="h-14 px-5 flex items-center border-b border-line font-semibold">Activité en direct</div>
    <div className="flex-1 overflow-auto p-4 space-y-3">{!ev.length ? <p className="text-muted text-[13px]">Les événements des agents apparaîtront ici en temps réel.</p> : ev.map((e) => <div key={e.id} className="text-[13px]"><div className={`font-medium ${evtTone(e.type)}`}>{evtLabel(e.type)}</div><div className="text-muted text-xs tnum">{e.provider ?? ""} {e.provider ? "· " : ""}{ago(e.ts)}{e.type === "usage.received" && e.payload?.total ? ` · ${new Intl.NumberFormat("fr-FR").format(e.payload.total)} tokens` : ""}</div></div>)}</div></aside>;
}

// ------- palette de commandes -------
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
function lev(a: string, b: string) { const m = a.length, n = b.length; if (Math.abs(m - n) > 2) return 9; const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]); for (let j = 0; j <= n; j++) d[0]![j] = j; for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[m]![n]!; }
export function score(q: string, text: string) {
  q = norm(q).trim(); text = norm(text); if (!q) return 1; if (text.startsWith(q)) return 120; if (text.includes(q)) return 100;
  let i = 0; for (const c of text) if (c === q[i]) i++; if (i === q.length && q.length > 2) return 50;
  const best = Math.min(...text.split(/[\s\-_/]+/).map((w) => lev(q, w.slice(0, q.length)))); return best <= 1 && q.length >= 3 ? 30 : 0;
}
interface Cmd { id: string; label: string; group: string; hint?: string; icon: any; run: () => void }
function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT(); const nav = useNavigate(); const [q, setQ] = useState(""); const [sel, setSel] = useState(0); const inp = useRef<HTMLInputElement>(null);
  const { data: projects } = useData<any[]>("projects.list", []); const { data: agents } = useData<any[]>("agents.list", []); const { data: execs } = useData<any[]>("executions.list", [{ limit: 15 }]);
  useEffect(() => { if (open) { setQ(""); setSel(0); setTimeout(() => inp.current?.focus(), 0); } }, [open]);
  const cmds = useMemo<Cmd[]>(() => {
    const go = (to: string) => () => nav(to);
    const c: Cmd[] = [{ id: "a-chat", label: "Nouveau chat", group: "Actions", icon: MessageSquare, run: go("/chat?new=1") }, { id: "a-work", label: "Nouveau travail", group: "Actions", icon: Briefcase, run: go("/work?new=1") }, { id: "a-code", label: "Nouvelle session Code", group: "Actions", icon: Code2, run: go("/code?new=1") }, { id: "a-task", label: t("common.newTask"), group: "Actions", icon: Plus, run: go("/tasks?new=1") }, { id: "a-agent", label: t("common.newAgent"), group: "Actions", icon: Plus, run: go("/agents?new=1") }, { id: "a-session", label: "Nouvelle session", group: "Actions", icon: Plus, run: go("/sessions?new=1") }, { id: "a-project", label: "Ajouter un projet", group: "Actions", icon: Plus, run: go("/projects?new=1") }, { id: "a-term", label: "Nouveau terminal", group: "Actions", icon: SquareTerminal, run: go("/terminal?new=1") }];
    for (const g of NAV_GROUPS) for (const [to, key, I] of g.items) c.push({ id: "n" + to, label: t(key), group: "Pages", icon: I, run: go(to) });
    for (const p of projects ?? []) c.push({ id: "p" + p.id, label: p.name, group: "Projets", hint: p.path, icon: FolderGit2, run: go("/projects") });
    for (const a of agents ?? []) c.push({ id: "g" + a.id, label: a.name, group: "Agents", hint: a.provider, icon: Bot, run: go("/agents?open=" + a.id) });
    for (const e of execs ?? []) c.push({ id: "e" + e.id, label: e.prompt.slice(0, 60), group: "Sessions", hint: e.provider, icon: TerminalSquare, run: go("/sessions?open=" + e.id) });
    return c;
  }, [projects, agents, execs, t]);
  const results = useMemo(() => cmds.map((c) => ({ c, s: score(q, c.label + " " + (c.hint ?? "")) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 30).map((x) => x.c), [cmds, q]);
  useEffect(() => setSel(0), [q]);
  if (!open) return null;
  const choose = (c?: Cmd) => { if (c) { onClose(); c.run(); } };
  const onKey = (e: React.KeyboardEvent) => { if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); } else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); } else if (e.key === "Enter") choose(results[sel]); else if (e.key === "Escape") onClose(); };
  let last = "";
  return <div className="fixed inset-0 z-[60] bg-black/60 anim-fade flex items-start justify-center pt-[14vh]" onMouseDown={onClose}>
    <div role="dialog" aria-modal="true" aria-label="Palette de commandes" onMouseDown={(e) => e.stopPropagation()} className="anim-pop w-[600px] max-w-[92vw] bg-panel rounded-2xl overflow-hidden" style={{ boxShadow: "var(--shadow-pop)" }}>
      <div className="flex items-center gap-3 px-4 h-14 border-b border-line"><Search size={16} className="text-muted" /><input ref={inp} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} role="combobox" aria-expanded aria-controls="cmd-list" aria-activedescendant={results[sel] ? "cmd-" + results[sel]!.id : undefined} placeholder={t("palette.placeholder")} className="no-ring flex-1 bg-transparent text-[15px] placeholder:text-muted" /><span className="kbd">Esc</span></div>
      <ul id="cmd-list" role="listbox" className="max-h-[50vh] overflow-auto p-2">{!results.length && <li className="text-muted text-center py-8">{t("palette.empty")}</li>}
        {results.map((c, i) => { const hdr = c.group !== last; last = c.group; const I = c.icon; return <React.Fragment key={c.id}>{hdr && <li role="presentation" className="px-3 pt-2 pb-1 text-2xs uppercase tracking-wider text-muted">{c.group}</li>}
          <li id={"cmd-" + c.id} role="option" aria-selected={i === sel} onMouseMove={() => setSel(i)} onClick={() => choose(c)} className={`flex items-center gap-3 px-3 h-10 rounded-lg cursor-pointer ${i === sel ? "bg-raised" : ""}`}><I size={15} className="text-muted shrink-0" aria-hidden /><span className="flex-1 truncate">{c.label}</span>{c.hint && <span className="text-xs text-muted truncate max-w-[180px]">{c.hint}</span>}{i === sel && <CornerDownLeft size={13} className="text-muted" />}</li></React.Fragment>; })}</ul></div></div>;
}

export function Shell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(store.get("acc.sidebar") === "1"); const [panel, setPanel] = useState(store.get("acc.panel") === "1"); const [palette, setPalette] = useState(false); const loc = useLocation();
  useEffect(() => { const mq = window.matchMedia("(max-width: 1100px)"); const f = () => mq.matches && setCollapsed(true); f(); mq.addEventListener("change", f); return () => mq.removeEventListener("change", f); }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => { const mod = e.ctrlKey || e.metaKey; if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); return; } if (mod && !e.shiftKey && !e.altKey && ["1", "2", "3"].includes(e.key)) { e.preventDefault(); window.location.hash = ["/chat", "/work", "/code"][Number(e.key) - 1]!; } else if (mod && e.key.toLowerCase() === "n" && !e.shiftKey) { const h = window.location.hash; const to = h.startsWith("#/work") ? "/work" : h.startsWith("#/code") ? "/code" : "/chat"; e.preventDefault(); window.location.hash = to + "?new=1&t=" + Date.now(); } }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, []);
  return <div className="h-full flex bg-bg">
    <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-[80] focus:m-2 btn">Aller au contenu</a>
    <Sidebar collapsed={collapsed} toggle={() => { store.set("acc.sidebar", collapsed ? "0" : "1"); setCollapsed(!collapsed); }} />
    <div className="flex-1 flex flex-col min-w-0"><Topbar onPalette={() => setPalette(true)} panelOpen={panel} togglePanel={() => { store.set("acc.panel", panel ? "0" : "1"); setPanel(!panel); }} />
      <div className="flex-1 flex min-h-0 relative"><main id="main" className="flex-1 overflow-auto min-w-0"><ErrorBoundary resetKey={loc.pathname}>{children}</ErrorBoundary></main>{panel && <ActivityPanel />}</div></div>
    <CommandPalette open={palette} onClose={() => setPalette(false)} />
  </div>;
}
