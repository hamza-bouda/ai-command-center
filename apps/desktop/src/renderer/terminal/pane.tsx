import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Terminal as XTerm } from "@xterm/xterm"; import { FitAddon } from "@xterm/addon-fit"; import { SearchAddon } from "@xterm/addon-search"; import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { Plus, X, Search, Copy, ClipboardPaste, Square, SquareTerminal, RotateCcw, ChevronUp, ChevronDown, Info, Maximize2, Minimize2, Minus } from "lucide-react";
import { api } from "../api"; import { useData } from "../hooks"; import { useT } from "../i18n"; import { toast, confirmDialog } from "../overlay"; import { currentTheme } from "../theme";
import { Page, Card, Modal, Field, EmptyState, Badge, ErrorState } from "../ui";


export const DARK = { background: "#1f1e1d", foreground: "#faf9f5", cursor: "#e0865f", cursorAccent: "#09090b", selectionBackground: "#e0865f40", selectionInactiveBackground: "#e0865f22",
  black: "#18181d", red: "#fb7185", green: "#34d399", yellow: "#fbbf24", blue: "#60a5fa", magenta: "#c4a8ff", cyan: "#67c1f5", white: "#d4d4d8",
  brightBlack: "#52525b", brightRed: "#fda4af", brightGreen: "#6ee7b7", brightYellow: "#fcd34d", brightBlue: "#93c5fd", brightMagenta: "#ddd0ff", brightCyan: "#a5dcfa", brightWhite: "#f5f5f7" };
export const LIGHT = { background: "#fbfaf6", foreground: "#1f1e1d", cursor: "#b4532f", cursorAccent: "#ffffff", selectionBackground: "#b4532f33", selectionInactiveBackground: "#b4532f1a",
  black: "#1f1e1d", red: "#be123c", green: "#047857", yellow: "#a35a06", blue: "#1d4ed8", magenta: "#7e22ce", cyan: "#0e7490", white: "#6b6a65",
  brightBlack: "#57554f", brightRed: "#e11d48", brightGreen: "#059669", brightYellow: "#b45309", brightBlue: "#2563eb", brightMagenta: "#9333ea", brightCyan: "#0891b2", brightWhite: "#1f1e1d" };
export const THEME = () => (currentTheme() === "light" ? LIGHT : DARK);

export interface Inst { term: XTerm; fit: FitAddon; search: SearchAddon; el: HTMLDivElement; ready: boolean; queue: { data: string; end: number }[]; offset: number; kind: string; exited?: number | null }
/** Les instances xterm vivent hors de React : changer de page ou d'onglet ne perd ni l'écran ni le scrollback. */
export const insts = new Map<string, Inst>(); let listening = false;
window.addEventListener("acc-theme", () => insts.forEach((i) => { i.term.options.theme = THEME(); })); // les terminaux ouverts suivent le thème
export function listen() {
  if (listening) return; listening = true;
  window.acc.onTerminal((e) => {
    const i = insts.get(e.id); if (!i) return;
    if (e.exit) { i.exited = e.exit.code; i.term.write(`\r\n\x1b[90m[processus terminé — code ${e.exit.code ?? "?"}]\x1b[0m\r\n`); window.dispatchEvent(new CustomEvent("acc-term-exit")); return; }
    if (e.data == null || e.end == null) return;
    if (!i.ready) { i.queue.push({ data: e.data, end: e.end }); return; }
    writeSlice(i, e.data, e.end);
  });
}
export function writeSlice(i: Inst, data: string, end: number) { const start = end - data.length; if (end <= i.offset) return; i.term.write(start < i.offset ? data.slice(i.offset - start) : data); i.offset = end; }

async function ensureInst(id: string, kind: string): Promise<Inst> {
  listen(); const ex = insts.get(id); if (ex) return ex;
  const el = document.createElement("div"); el.style.cssText = "width:100%;height:100%";
  const term = new XTerm({ fontFamily: '"JetBrains Mono Variable", "Cascadia Code", Consolas, monospace', fontSize: 13, lineHeight: 1.25, cursorBlink: true, scrollback: 10000, theme: THEME(), allowProposedApi: true, convertEol: false, macOptionIsMeta: true, windowsPty: navigator.platform.includes("Win") ? { backend: "conpty" } : undefined });
  const fit = new FitAddon(); const search = new SearchAddon(); term.loadAddon(fit); term.loadAddon(search); term.loadAddon(new WebLinksAddon((_, uri) => window.open(uri, "_blank")));
  term.open(el);
  const inst: Inst = { term, fit, search, el, ready: false, queue: [], offset: 0, kind };
  insts.set(id, inst);
  term.onData((d) => { if (!inst.exited && inst.exited !== 0) void api("terminal.write", id, d).catch(() => {}); });
  term.onResize(({ cols, rows }) => void api("terminal.resize", id, cols, rows).catch(() => {}));
  const a = await api("terminal.attach", id); term.write(a.buffer); inst.offset = a.total; inst.ready = true; inst.queue.forEach((q) => writeSlice(inst, q.data, q.end)); inst.queue = [];
  return inst;
}
export const disposeInst = (id: string) => { const i = insts.get(id); if (i) { i.term.dispose(); insts.delete(id); } };

export const KINDS: [string, string, string][] = [["claude", "Claude Code", "CLI officiel, interface interactive, avec votre abonnement."], ["codex", "Codex", "CLI officiel, interface interactive, avec votre abonnement."], ["shell", "Shell", "Invite de commandes classique dans le dossier du projet."]];

// ---------- Dispositions : plusieurs terminaux dans la même page ----------
export type LayoutId = "one" | "cols2" | "rows2" | "main2" | "cols3" | "grid4";
export interface LayoutDef { id: LayoutId; label: string; cols: string; rows: string; rects: [number, number, number, number][]; span?: Record<number, string> }
export const LAYOUTS: LayoutDef[] = [
  { id: "one", label: "1 terminal", cols: "1fr", rows: "1fr", rects: [[0, 0, 1, 1]] },
  { id: "cols2", label: "2 colonnes", cols: "1fr 1fr", rows: "1fr", rects: [[0, 0, .5, 1], [.5, 0, .5, 1]] },
  { id: "rows2", label: "2 lignes", cols: "1fr", rows: "1fr 1fr", rects: [[0, 0, 1, .5], [0, .5, 1, .5]] },
  { id: "main2", label: "1 grand + 2", cols: "1.5fr 1fr", rows: "1fr 1fr", rects: [[0, 0, .6, 1], [.6, 0, .4, .5], [.6, .5, .4, .5]], span: { 0: "1 / span 2" } },
  { id: "cols3", label: "3 colonnes", cols: "1fr 1fr 1fr", rows: "1fr", rects: [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]] },
  { id: "grid4", label: "Grille 2 × 2", cols: "1fr 1fr", rows: "1fr 1fr", rects: [[0, 0, .5, .5], [.5, 0, .5, .5], [0, .5, .5, .5], [.5, .5, .5, .5]] },
];
export const layoutOf = (id: LayoutId) => LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[0]!;
export const forCount = (n: number): LayoutId => n <= 1 ? "one" : n === 2 ? "cols2" : n === 3 ? "cols3" : "grid4";
export const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* indisponible */ } } };
export function Glyph({ l, on }: { l: LayoutDef; on?: boolean }) {
  return <svg width="20" height="15" viewBox="0 0 20 15" aria-hidden>{l.rects.map(([x, y, w, h], i) => <rect key={i} x={1 + x * 18 + .6} y={1 + y * 13 + .6} width={w * 18 - 1.2} height={h * 13 - 1.2} rx="1.6" fill={on ? "currentColor" : "none"} fillOpacity={on ? .28 : 0} stroke="currentColor" strokeWidth="1.2" />)}</svg>;
}

/** Collage sécurisé : confirmation si plusieurs lignes dans un shell (risque d'exécution immédiate). */
async function pasteSafe(inst: Inst, text?: string) {
  const s = text ?? await navigator.clipboard.readText().catch(() => ""); if (!s) return;
  if (inst.kind === "shell" && /[\r\n]/.test(s.trim())) { const ok = await confirmDialog({ title: "Coller plusieurs lignes ?", body: `Le texte contient ${s.trim().split(/\r?\n/).length} lignes et peut être exécuté immédiatement par le shell.`, confirmLabel: "Coller" }); if (!ok) return; }
  inst.term.paste(s); inst.term.focus();
}
export const alive = (x: any) => !x.exited && insts.get(x.id)?.exited === undefined;

export interface PaneProps { info: any; slot: number; count: number; all: any[]; shownIds: string[]; active: boolean; zoomed: boolean; projectName?: string;
  onActivate: () => void; onSwitch: (id: string) => void; onClose: () => void; onRestart: () => void; onSearch: () => void; onZoom: () => void; onFocusSlot: (n: number) => void; }
/** Un panneau : en-tête (sélecteur, actions) + zone xterm. L'instance xterm persiste hors de React. */
export function Pane(p: PaneProps) {
  const host = useRef<HTMLDivElement>(null); const cb = useRef(p); cb.current = p; const { info } = p; const live = alive(info);
  useEffect(() => {
    const h = host.current; if (!h) return; let cancelled = false; let ro: ResizeObserver | undefined; let tm: any;
    void ensureInst(info.id, info.kind).then((inst) => { if (cancelled) return; h.replaceChildren(inst.el);
      const doFit = () => { try { if (h.clientWidth > 40 && h.clientHeight > 40) inst.fit.fit(); } catch { /* conteneur masqué */ } };
      doFit(); if (cb.current.active) inst.term.focus(); ro = new ResizeObserver(() => { clearTimeout(tm); tm = setTimeout(doFit, 60); }); ro.observe(h);
      inst.term.attachCustomKeyEventHandler((e) => {
        if (e.type !== "keydown") return true; const mod = e.ctrlKey || e.metaKey;
        if (e.altKey && !mod && /^[1-6]$/.test(e.key)) { cb.current.onFocusSlot(Number(e.key) - 1); return false; }
        if (mod && e.key.toLowerCase() === "k" && !e.shiftKey) return false; // Ctrl+K : palette de l'application (laissé passer, jamais envoyé au shell)
        if (e.altKey && !mod && e.key === "0") { inst.term.blur(); (document.activeElement as HTMLElement | null)?.blur(); return false; } // Alt+0 : sortir du terminal (le clavier revient à l'application)
        if (mod && e.key.toLowerCase() === "f" && !e.shiftKey) { cb.current.onSearch(); return false; }
        if (mod && e.key.toLowerCase() === "c" && (e.shiftKey || inst.term.hasSelection())) { if (inst.term.hasSelection()) { void navigator.clipboard.writeText(inst.term.getSelection()); inst.term.clearSelection(); } return false; } // Ctrl+C sans sélection = interruption
        if (mod && e.shiftKey && e.key.toLowerCase() === "v") { e.preventDefault(); void pasteSafe(inst); return false; }
        return true;
      });
    });
    const onPaste = (e: ClipboardEvent) => { const i = insts.get(info.id); if (!i) return; e.preventDefault(); e.stopPropagation(); void pasteSafe(i, e.clipboardData?.getData("text") ?? ""); };
    h.addEventListener("paste", onPaste, true);
    return () => { cancelled = true; ro?.disconnect(); clearTimeout(tm); h.removeEventListener("paste", onPaste, true); };
  }, [info.id]);
  useEffect(() => { if (p.active) insts.get(info.id)?.term.focus(); }, [p.active, info.id, p.zoomed]);
  const ic = "btn btn-ghost btn-icon !h-7 !w-7";
  return <section aria-label={`Terminal ${p.slot + 1} : ${info.title}`} onMouseDownCapture={() => { if (!p.active) p.onActivate(); }} className="relative flex flex-col flex-1 min-w-0 min-h-0 bg-bg" style={{ boxShadow: p.active && p.count > 1 ? "inset 0 0 0 1px var(--accent)" : undefined }}>
    <header className="flex items-center gap-1.5 h-10 pl-3 pr-1.5 border-b border-line shrink-0 min-w-0 bg-panel/60">
      {p.count > 1 && <span className="tnum text-2xs w-4 h-4 rounded grid place-items-center bg-raised text-muted shrink-0" title={`Alt+${p.slot + 1} pour y aller`}>{p.slot + 1}</span>}
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${live ? "bg-success pulse-dot" : "bg-muted"}`} aria-hidden /><span className="sr-only">{live ? "en cours" : "terminé"}</span>
      <select aria-label="Terminal affiché dans ce panneau" value={info.id} onChange={(e) => p.onSwitch(e.target.value)} className="min-w-0 flex-1 h-8 bg-transparent text-[13px] font-medium truncate cursor-pointer outline-none hover:text-accent focus-visible:text-accent transition-colors" >
        {p.all.map((x) => <option key={x.id} value={x.id}>{x.title}{p.shownIds.includes(x.id) && x.id !== info.id ? "  (affiché ailleurs)" : ""}</option>)}</select>
      {p.projectName && <span className="hidden xl:inline text-2xs text-muted max-w-[110px] truncate shrink-0" title={info.cwd}>{p.projectName}</span>}
      <button className={ic} aria-label="Rechercher dans ce terminal" title="Rechercher (Ctrl+F)" onClick={p.onSearch}><Search size={13} /></button>
      <button className={`${ic} hidden sm:grid`} aria-label="Copier la sélection" title="Copier (Ctrl+Maj+C)" onClick={() => { const i = insts.get(info.id); if (i?.term.hasSelection()) { void navigator.clipboard.writeText(i.term.getSelection()); toast("Copié.", "success"); } else toast("Sélectionnez du texte à copier.", "info"); }}><Copy size={13} /></button>
      <button className={`${ic} hidden sm:grid`} aria-label="Coller" title="Coller (Ctrl+Maj+V)" onClick={() => { const i = insts.get(info.id); if (i) void pasteSafe(i); }}><ClipboardPaste size={13} /></button>
      {live ? <button className={`${ic} hover:!text-danger`} aria-label="Arrêter le processus" title="Arrêter le processus" onClick={() => api("terminal.kill", info.id)}><Square size={12} /></button>
        : <button className={ic} aria-label="Relancer" title="Relancer ce terminal" onClick={p.onRestart}><RotateCcw size={13} /></button>}
      {p.count > 1 && <button className={ic} aria-label={p.zoomed ? "Réduire le panneau" : "Agrandir le panneau"} title={p.zoomed ? "Revenir à la disposition" : "Agrandir ce panneau"} onClick={p.onZoom}>{p.zoomed ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>}
      <button className={`${ic} hover:!text-danger`} aria-label={`Fermer ${info.title}`} title="Fermer ce terminal" onClick={p.onClose}><X size={14} /></button></header>
    {info.kind !== "shell" && <div className="hidden 2xl:flex items-center gap-1.5 px-3 h-6 text-2xs text-warning border-b border-line shrink-0" title="Le CLI interactif n'expose pas de mesures structurées : les tokens de ce terminal ne sont pas suivis."><Info size={11} />Consommation non mesurée en mode terminal</div>}
    <div ref={host} className="flex-1 min-h-0 min-w-0 p-2" role="region" aria-label={`Zone du terminal ${p.slot + 1}`} /></section>;
}

/** Panneau libre : lancement rapide d'un agent ou d'un shell directement à cet emplacement. */
export function EmptyPane({ slot, onLaunch, onMore, hasProject }: { slot: number; onLaunch: (kind: string) => void; onMore: () => void; hasProject: boolean }) {
  return <section aria-label={`Emplacement libre ${slot + 1}`} className="flex flex-col flex-1 items-center justify-center gap-3 min-w-0 min-h-0 bg-bg/60 p-4 text-center">
    <span className="tnum text-2xs w-5 h-5 rounded grid place-items-center bg-raised text-muted">{slot + 1}</span><p className="text-[13px] text-fg2">Emplacement libre</p>
    <div className="flex flex-wrap justify-center gap-2">{KINDS.map(([k, l]) => <button key={k} className="chip" disabled={!hasProject} onClick={() => onLaunch(k)}>{k === "shell" ? <SquareTerminal size={13} /> : <Badge v={k} text="" />}{l}</button>)}</div>
    {!hasProject && <p className="text-2xs text-muted">Ajoutez d'abord un projet.</p>}<button className="text-2xs text-accent hover:underline" onClick={onMore}>Plus d'options…</button></section>;
}

