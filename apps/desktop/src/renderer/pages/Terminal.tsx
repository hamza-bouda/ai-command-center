import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Terminal as XTerm } from "@xterm/xterm"; import { FitAddon } from "@xterm/addon-fit"; import { SearchAddon } from "@xterm/addon-search"; import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { Plus, X, Search, Copy, ClipboardPaste, Square, SquareTerminal, RotateCcw, ChevronUp, ChevronDown, Info, Maximize2, Minimize2, Minus } from "lucide-react";
import { api } from "../api"; import { useData } from "../hooks"; import { useT } from "../i18n"; import { toast, confirmDialog } from "../overlay"; import { currentTheme } from "../theme";
import { Page, Card, Modal, Field, EmptyState, Badge, ErrorState } from "../ui";

import { insts, disposeInst, KINDS, LAYOUTS, layoutOf, forCount, store, Glyph, alive, Pane, EmptyPane, type LayoutId } from "../terminal/pane";

export default function TerminalPage() {
  const t = useT(); const [sp, setSp] = useSearchParams();
  const { data: rawList, err, reload } = useData<any[]>("terminal.list", [], { every: 4000 }); const { data: projects } = useData<any[]>("projects.list", []);
  const [layout, setLayoutRaw] = useState<LayoutId>(() => { const v = store.get("acc.term.layout") as LayoutId; return LAYOUTS.some((l) => l.id === v) ? v : "one"; });
  const [slots, setSlots] = useState<(string | null)[]>(() => { try { const v = JSON.parse(store.get("acc.term.slots") ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; } });
  const [activeSlot, setActiveSlot] = useState(0); const [zoom, setZoom] = useState<number | null>(null);
  const [creating, setCreating] = useState(false); const [f, setF] = useState({ kind: "claude", projectId: store.get("acc.term.project") ?? "", count: 1 }); const [busy, setBusy] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false); const [q, setQ] = useState(""); const [, force] = useState(0);
  /** Numérote les terminaux homonymes (« Shell 1 », « Shell 2 »…) pour les distinguer dans les onglets et les panneaux. */
  const list = rawList?.map((x, _i, arr) => { const same = arr.filter((y) => y.title === x.title); return same.length > 1 ? { ...x, title: `${x.title} ${same.indexOf(x) + 1}` } : x; });
  const def = layoutOf(layout); const cap = def.rects.length;
  useEffect(() => { const h = () => { force((x) => x + 1); reload(); }; window.addEventListener("acc-term-exit", h); return () => window.removeEventListener("acc-term-exit", h); }, [reload]);
  useEffect(() => { if (sp.get("new")) { const k = sp.get("kind"); if (k) setF((x) => ({ ...x, kind: k })); setCreating(true); sp.delete("new"); sp.delete("kind"); setSp(sp, { replace: true }); } }, [sp]);
  useEffect(() => { store.set("acc.term.layout", layout); }, [layout]); useEffect(() => { store.set("acc.term.slots", JSON.stringify(slots)); }, [slots]);
  useEffect(() => { if (f.projectId) store.set("acc.term.project", f.projectId); }, [f.projectId]);
  useEffect(() => { if (!f.projectId && projects?.length) setF((x) => ({ ...x, projectId: projects[0].id })); }, [projects]);

  // Cohérence des emplacements : retire les terminaux fermés, remplit les emplacements libres avec les terminaux non affichés.
  useEffect(() => {
    if (!list) return; const ids = new Set(list.map((x) => x.id));
    setSlots((prev) => { const next = Array.from({ length: Math.max(cap, prev.length) }, (_, i) => (prev[i] && ids.has(prev[i]!) ? prev[i]! : null)); const used = new Set(next.filter(Boolean) as string[]);
      const spare = list.map((x) => x.id).filter((id) => !used.has(id)); for (let i = 0; i < cap && spare.length; i++) if (!next[i]) next[i] = spare.shift()!;
      return next.length === prev.length && next.every((v, i) => v === prev[i]) ? prev : next; });
  }, [list, cap]);
  useEffect(() => { if (activeSlot >= cap) setActiveSlot(0); if (zoom != null && zoom >= cap) setZoom(null); }, [cap, activeSlot, zoom]);

  const infoOf = (id: string | null) => (id ? list?.find((x) => x.id === id) : undefined);
  const shown = slots.slice(0, cap); const shownIds = shown.filter(Boolean) as string[];
  const setLayout = (l: LayoutId) => { setLayoutRaw(l); setZoom(null); };
  const proj = (id?: string) => projects?.find((p) => p.id === id)?.name;
  /** Affiche le terminal `id` dans l'emplacement `slot` (échange si déjà affiché ailleurs). */
  const place = (slot: number, id: string) => setSlots((prev) => { const next = [...prev]; while (next.length <= slot) next.push(null); const from = next.indexOf(id); if (from >= 0) next[from] = next[slot] ?? null; next[slot] = id; return next; });

  const launch = async (kind: string, projectId: string, count: number, target: number) => {
    setBusy(true);
    try {
      const ids: string[] = []; for (let i = 0; i < count; i++) ids.push((await api("terminal.create", { kind, projectId: projectId || undefined, cols: 100, rows: 30 })).id);
      await reload(); setCreating(false);
      if (count > 1) { const l = forCount(Math.max(count, cap > 1 ? shownIds.length : 0)); setLayoutRaw(layoutOf(l).rects.length >= cap ? l : layout); setZoom(null); setSlots((prev) => { const next = [...prev]; ids.forEach((id, i) => { next[i] = id; }); return next; }); setActiveSlot(0); }
      else { place(target, ids[0]!); setActiveSlot(target); }
    } catch (e: any) { toast(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "error"); } finally { setBusy(false); }
  };
  const closeTerm = async (x: any) => { if (alive(x) && !(await confirmDialog({ title: "Fermer ce terminal ?", body: "Le processus en cours sera arrêté.", confirmLabel: "Fermer", danger: true }))) return; await api("terminal.close", x.id).catch(() => {}); disposeInst(x.id); setSlots((prev) => prev.map((v) => (v === x.id ? null : v))); reload(); };
  const activeId = shown[activeSlot] ?? null; const activeInst = activeId ? insts.get(activeId) : undefined;
  const doSearch = (dir: "next" | "prev") => { if (!activeInst || !q) return; (dir === "next" ? activeInst.search.findNext : activeInst.search.findPrevious).call(activeInst.search, q, { decorations: { matchBackground: "#e0865f55", activeMatchBackground: "#e0865f", matchOverviewRuler: "#e0865f", activeMatchColorOverviewRuler: "#e0865f" } }); };
  const focusSlot = (n: number) => { if (n < cap) { setZoom(null); setActiveSlot(n); } };
  const visible: number[] = zoom != null ? [zoom] : shown.map((_, i) => i);
  const gridStyle = zoom != null ? { gridTemplateColumns: "1fr", gridTemplateRows: "1fr" } : { gridTemplateColumns: def.cols, gridTemplateRows: def.rows };

  return <div className="h-full flex flex-col anim-page">
    <div className="px-8 pt-7 pb-4 flex items-end justify-between gap-4 flex-wrap"><div className="min-w-0"><h1 className="text-[28px] leading-8">{t("nav.terminal")}</h1><p className="text-fg2 mt-1">Plusieurs agents côte à côte : les CLI officiels Claude Code et Codex, non modifiés.</p></div>
      <div className="flex items-center gap-3"><div role="radiogroup" aria-label="Disposition des terminaux" className="flex items-center gap-0.5 p-1 rounded-xl bg-panel border border-line">{LAYOUTS.map((l) => <button key={l.id} role="radio" aria-checked={layout === l.id} title={l.label} aria-label={l.label} onClick={() => setLayout(l.id)} className={`h-8 w-9 grid place-items-center rounded-lg transition-all ${layout === l.id ? "bg-[var(--surface-hover)] text-accent shadow-sm" : "text-muted hover:text-fg hover:bg-raised"}`}><Glyph l={l} on={layout === l.id} /></button>)}</div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={15} />Nouveau terminal</button></div></div>
    {err && !list ? <div className="px-8"><ErrorState message={err} onRetry={reload} /></div> : !list?.length ? <div className="px-8"><Card><EmptyState icon={SquareTerminal} title="Aucun terminal ouvert" desc="Ouvrez Claude Code ou Codex dans son interface interactive officielle, ou un simple shell dans le dossier d'un projet. Vous pourrez en afficher plusieurs côte à côte." action={<button className="btn btn-primary" onClick={() => setCreating(true)}>Nouveau terminal</button>} /></Card></div>
    : <div className="flex-1 min-h-0 mx-8 mb-6 card flex flex-col overflow-hidden">
      <div role="tablist" aria-label="Terminaux ouverts" className="flex items-center gap-1 px-2 py-1.5 border-b border-line overflow-x-auto shrink-0">{list.map((x) => { const at = shown.indexOf(x.id); const on = at === activeSlot; const live = alive(x);
        return <div key={x.id} role="tab" aria-selected={on} tabIndex={0} title="Afficher dans le panneau actif" onClick={() => { place(activeSlot, x.id); setActiveSlot(activeSlot); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); place(activeSlot, x.id); } }} className={`group flex items-center gap-2 h-8 pl-2.5 pr-1 rounded-lg text-[13px] cursor-pointer shrink-0 transition-colors ${on ? "bg-raised text-fg" : at >= 0 ? "text-fg2 hover:bg-raised/70" : "text-muted hover:bg-raised/70 hover:text-fg2"}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${live ? "bg-success" : "bg-muted"}`} aria-hidden />{at >= 0 && cap > 1 && <span className="tnum text-2xs w-4 h-4 rounded grid place-items-center bg-[var(--surface-hover)] text-fg2">{at + 1}</span>}<span className="max-w-[160px] truncate">{x.title}</span>{x.projectId && <span className="hidden md:inline text-2xs text-muted max-w-[80px] truncate">{proj(x.projectId)}</span>}
          <button aria-label={`Fermer ${x.title}`} className="btn btn-ghost btn-icon !h-6 !w-6 opacity-50 group-hover:opacity-100" onClick={(e) => { e.stopPropagation(); void closeTerm(x); }}><X size={12} /></button></div>; })}
        <button className="btn btn-ghost btn-icon !h-7 !w-7 ml-1 shrink-0" aria-label="Nouveau terminal" onClick={() => setCreating(true)}><Plus size={14} /></button></div>
      {searchOpen && <div className="flex items-center gap-2 px-4 py-2 border-b border-line bg-panel anim-fade shrink-0"><Search size={14} className="text-muted" /><input autoFocus className="input !h-8 !w-64" placeholder={`Rechercher dans le terminal ${activeSlot + 1}…`} aria-label="Rechercher" value={q} onChange={(e) => { setQ(e.target.value); if (activeInst && e.target.value) activeInst.search.findNext(e.target.value); }} onKeyDown={(e) => { if (e.key === "Enter") doSearch(e.shiftKey ? "prev" : "next"); if (e.key === "Escape") { setSearchOpen(false); activeInst?.term.focus(); } }} />
        <button className="btn btn-sm btn-icon" aria-label="Précédent" onClick={() => doSearch("prev")}><ChevronUp size={14} /></button><button className="btn btn-sm btn-icon" aria-label="Suivant" onClick={() => doSearch("next")}><ChevronDown size={14} /></button><button className="btn btn-sm btn-ghost btn-icon ml-auto" aria-label="Fermer la recherche" onClick={() => { setSearchOpen(false); activeInst?.term.focus(); }}><X size={14} /></button></div>}
      <div className="flex-1 min-h-0 grid gap-px bg-[var(--border)]" style={gridStyle}>{visible.map((i) => { const x = infoOf(shown[i] ?? null); const style = zoom == null && def.span?.[i] ? { gridRow: def.span[i] } : undefined;
        return <div key={x ? x.id : `empty${i}`} className="min-w-0 min-h-0 flex flex-col" style={style}>{x
          ? <Pane info={x} slot={i} count={cap} all={list} shownIds={shownIds} active={activeSlot === i} zoomed={zoom === i} projectName={proj(x.projectId)} onActivate={() => setActiveSlot(i)} onSwitch={(id) => place(i, id)} onClose={() => void closeTerm(x)}
            onRestart={async () => { await closeTerm(x); setF({ ...f, kind: x.kind, projectId: x.projectId ?? f.projectId, count: 1 }); void launch(x.kind, x.projectId ?? f.projectId, 1, i); }} onSearch={() => { setActiveSlot(i); setSearchOpen(true); }} onZoom={() => setZoom(zoom === i ? null : i)} onFocusSlot={focusSlot} />
          : <EmptyPane slot={i} hasProject={!!projects?.length} onLaunch={(k) => { setActiveSlot(i); void launch(k, f.projectId, 1, i); }} onMore={() => { setActiveSlot(i); setCreating(true); }} />}</div>; })}</div></div>}

    <Modal open={creating} onClose={() => setCreating(false)} title="Nouveau terminal" footer={<><button className="btn" onClick={() => setCreating(false)}>{t("common.cancel")}</button><button className="btn btn-primary" disabled={busy || !f.projectId} onClick={() => void launch(f.kind, f.projectId, f.count, activeSlot)}>{f.count > 1 ? `Ouvrir ${f.count} terminaux` : "Ouvrir"}</button></>}>
      <div role="radiogroup" aria-label="Type de terminal" className="grid grid-cols-3 gap-2 mb-5">{KINDS.map(([k, l, d]) => <button key={k} role="radio" aria-checked={f.kind === k} onClick={() => setF({ ...f, kind: k })} className={`text-left p-3 rounded-xl border transition-colors ${f.kind === k ? "border-accent bg-accent-subtle" : "border-line hover:border-line-strong"}`}><div className="mb-1.5">{k === "shell" ? <span className="text-xs text-muted">Shell</span> : <Badge v={k} />}</div><div className="text-[13px] font-medium">{l}</div><div className="text-2xs text-muted mt-0.5">{d}</div></button>)}</div>
      {!projects?.length ? <p className="text-fg2 pb-3">Ajoutez d'abord un projet : le terminal s'ouvre dans son dossier.</p> : <Field label="Projet (dossier de travail)"><select className="input" value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}><option value="">Choisir un projet…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
      <Field label="Nombre de terminaux" hint="Ouvre plusieurs agents du même type d'un coup et les affiche côte à côte (jusqu'à 4)."><div className="flex items-center gap-2"><button type="button" className="btn btn-icon" aria-label="Moins" disabled={f.count <= 1} onClick={() => setF({ ...f, count: f.count - 1 })}><Minus size={14} /></button><span className="tnum w-8 text-center text-[15px] font-medium" aria-live="polite">{f.count}</span><button type="button" className="btn btn-icon" aria-label="Plus" disabled={f.count >= 4} onClick={() => setF({ ...f, count: f.count + 1 })}><Plus size={14} /></button></div></Field>
      <p className="text-xs text-muted pb-3">Mode abonnement exclusif : les variables de clé API sont retirées de l'environnement du terminal, et Claude Code / Codex ne s'ouvrent que si leur connexion est vérifiée comme abonnement.</p></Modal>
  </div>;
}
