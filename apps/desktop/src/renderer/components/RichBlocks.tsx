import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy, CheckCircle2, XCircle, RotateCcw, MessageSquareText, Maximize2, Download, Code2, Eye, Loader2, ListChecks, BarChart3, GitBranch, ChevronLeft, ChevronRight, Send } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { currentTheme } from "../theme"; import { api } from "../api"; import { toast } from "../overlay"; import { Modal } from "../ui";

/** Actions de la conversation disponibles pour les blocs interactifs (envoyer une réponse cliquée au modèle). Absent hors conversation : les blocs deviennent en lecture seule. */
export const ChatActions = createContext<{ send?: (text: string) => void; busy?: boolean }>({});
/** Portée d'un bloc : identifiant du message (états mémorisés par message, pas par contenu) et mode « en cours de génération » (JSON/diagramme/page encore incomplets). */
export const RichScope = createContext<{ scope: string; streaming: boolean }>({ scope: "", streaming: false });
const Pending = ({ what }: { what: string }) => <div className="my-4 rounded-2xl border border-line bg-panel/50 px-4 py-6 flex items-center gap-2.5 text-[13px] text-muted not-prose" role="status"><Loader2 size={15} className="animate-spin text-accent" />Préparation {what}…</div>;

const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* indisponible */ } } };
const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
/** État mémorisé par bloc : une réponse déjà donnée reste visible quand on rouvre la conversation. */
function useStored<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => { try { const r = store.get(key); return r ? (JSON.parse(r) as T) : init; } catch { return init; } });
  return [v, (n) => { setV(n); store.set(key, JSON.stringify(n)); }];
}
const LETTERS = "ABCDEFGH";
const PALETTE = ["#e0865f", "#67c1f5", "#34d399", "#f472b6", "#fbbf24", "#a78bfa", "#94a3b8"];
const errBox = (what: string, raw: string, why: string) => <div className="my-3"><div role="alert" className="text-xs text-warning mb-1.5">{what} : {why} — affichage du contenu brut.</div><pre className="bg-bg border border-line rounded-xl p-4 overflow-auto text-[12.5px]">{raw}</pre></div>;
const parse = (raw: string): { ok: true; v: any } | { ok: false; e: string } => { try { return { ok: true, v: JSON.parse(raw) }; } catch (e: any) { return { ok: false, e: "JSON invalide" }; } };
const Shell = ({ icon: I, title, children, right }: { icon: any; title?: string; children: ReactNode; right?: ReactNode }) => <div className="my-4 rounded-2xl border border-line bg-panel/70 overflow-hidden not-prose"><div className="flex items-center gap-2 px-4 h-10 border-b border-line text-xs text-muted"><I size={14} className="text-accent shrink-0" /><span className="font-medium text-fg2 truncate">{title}</span><span className="ml-auto flex items-center gap-1">{right}</span></div>{children}</div>;

// ---------------------------------------------------------------- QCM
interface Q { q: string; options: string[]; answer?: number[]; multi: boolean; explain?: string }
export function parseQuiz(raw: string): { title?: string; questions: Q[] } | string {
  const p = parse(raw); if (!p.ok) return p.e; const s = p.v; const arr = Array.isArray(s) ? s : s?.questions; if (!Array.isArray(arr) || !arr.length) return "aucune question"; if (arr.length > 40) return "trop de questions (40 maximum)";
  const toIdx = (a: any): number | undefined => typeof a === "number" ? a : typeof a === "string" && /^[A-Ha-h]$/.test(a.trim()) ? LETTERS.indexOf(a.trim().toUpperCase()) : undefined;
  const questions: Q[] = []; for (const x of arr) {
    const options = (x?.options ?? x?.choices) as unknown; if (typeof (x?.q ?? x?.question) !== "string" || !Array.isArray(options) || options.length < 2 || options.length > 8) return "question mal formée";
    const raw = x.answer ?? x.correct; const list = Array.isArray(raw) ? raw.map(toIdx) : [toIdx(raw)]; const answer = list.every((n) => n !== undefined && n >= 0 && n < options.length) && raw !== undefined ? (list as number[]) : undefined;
    questions.push({ q: String(x.q ?? x.question), options: options.map(String), answer, multi: !!answer && answer.length > 1, explain: typeof x.explain === "string" ? x.explain : typeof x.explanation === "string" ? x.explanation : undefined });
  }
  return { title: typeof s?.title === "string" ? s.title : undefined, questions };
}
function QuizBlock({ raw }: { raw: string }) {
  const ctx = useContext(ChatActions); const sc = useContext(RichScope); const spec = parseQuiz(raw); const key = `acc.quiz.${sc.scope}.${hash(raw)}`;
  const [st, setSt] = useStored<{ picks: (number[] | null)[]; step: number }>(key, { picks: [], step: 0 }); const [draft, setDraft] = useState<number[]>([]);
  if (typeof spec === "string") return sc.streaming ? <Pending what="du QCM" /> : errBox("QCM", raw, spec);
  const { questions: qs } = spec; const n = qs.length; const step = Math.min(st.step, n); const q = qs[step]; const graded = qs.every((x) => x.answer);
  const ok = (i: number) => { const p = st.picks[i]; const a = qs[i]!.answer; return !!p && !!a && p.length === a.length && a.every((v) => p.includes(v)); };
  const score = qs.filter((_, i) => ok(i)).length;
  const answer = (picks: number[]) => { const next = [...st.picks]; next[step] = picks; setSt({ ...st, picks: next }); setDraft([]); };
  const go = (s: number) => { setSt({ ...st, step: Math.max(0, Math.min(n, s)) }); setDraft([]); };
  const sendRecap = () => { const wrong = qs.map((x, i) => ({ x, i })).filter(({ i }) => graded && !ok(i)); const lines = qs.map((x, i) => `${i + 1}${(st.picks[i] ?? []).map((k) => LETTERS[k]).join("") || "-"}`).join(", ");
    ctx.send?.(graded ? `J'ai obtenu ${score}/${n} au QCM (mes réponses : ${lines}).${wrong.length ? ` Explique-moi mes erreurs aux questions ${wrong.map((w) => w.i + 1).join(", ")}.` : " Peux-tu me proposer des questions plus difficiles ?"}` : `Voici mes réponses au QCM : ${lines}. Corrige-les.`); };
  const header = <div className="flex items-center gap-1" aria-label="Progression">{qs.map((_, i) => <button key={i} aria-label={`Question ${i + 1}`} onClick={() => go(i)} className={`h-1.5 rounded-full transition-all ${i === step ? "w-6 bg-accent" : st.picks[i] ? (graded ? (ok(i) ? "w-3 bg-success" : "w-3 bg-danger") : "w-3 bg-accent/60") : "w-3 bg-[var(--surface-hover)] hover:bg-line-strong"}`} />)}</div>;
  if (step >= n) return <Shell icon={ListChecks} title={spec.title ?? "QCM"} right={header}><div className="p-5">
    <div className="flex items-end gap-3 mb-4">{graded ? <><span className="font-display text-[44px] leading-none">{score}<span className="text-muted text-[26px]">/{n}</span></span><span className="text-fg2 pb-1.5 text-[14px]">{Math.round((score / n) * 100)} % de bonnes réponses</span></> : <span className="text-[15px] font-medium">{st.picks.filter(Boolean).length} réponse(s) enregistrée(s)</span>}</div>
    <ul className="space-y-1.5 mb-5">{qs.map((x, i) => <li key={i} className="flex items-start gap-2 text-[13px]">{graded ? (ok(i) ? <CheckCircle2 size={15} className="text-success mt-0.5 shrink-0" /> : <XCircle size={15} className="text-danger mt-0.5 shrink-0" />) : <span className="w-[15px]" />}<span className="min-w-0"><span className="text-fg2">{i + 1}. {x.q}</span>{graded && !ok(i) && <span className="block text-2xs text-muted">Votre réponse : {(st.picks[i] ?? []).map((k) => LETTERS[k]).join(", ") || "aucune"} · Bonne réponse : {x.answer!.map((k) => LETTERS[k]).join(", ")}</span>}</span></li>)}</ul>
    <div className="flex flex-wrap gap-2"><button className="btn" onClick={() => setSt({ picks: [], step: 0 })}><RotateCcw size={14} />Recommencer</button>{ctx.send && <button className="btn btn-primary" disabled={ctx.busy} onClick={sendRecap}><MessageSquareText size={14} />{graded ? "Discuter de mes résultats" : "Envoyer mes réponses"}</button>}</div></div></Shell>;
  const picked = st.picks[step]; const revealed = !!picked && graded;
  return <Shell icon={ListChecks} title={spec.title ?? "QCM"} right={<span className="tnum mr-2">{step + 1}/{n}</span>}><div className="p-5">
    <div className="mb-3">{header}</div><p className="text-[15px] font-medium mb-3 leading-snug">{step + 1}. {q!.q}</p>{q!.multi && !picked && <p className="text-2xs text-muted mb-2">Plusieurs réponses possibles</p>}
    <div role={q!.multi ? "group" : "radiogroup"} aria-label="Réponses" className="grid gap-2">{q!.options.map((o, i) => { const sel = (picked ?? draft).includes(i); const good = revealed && q!.answer!.includes(i); const bad = revealed && sel && !good;
      return <button key={i} role={q!.multi ? "checkbox" : "radio"} aria-checked={sel} disabled={!!picked} onClick={() => { if (picked) return; if (q!.multi) setDraft(draft.includes(i) ? draft.filter((x) => x !== i) : [...draft, i]); else answer([i]); }}
        className={`group flex items-center gap-3 text-left px-3.5 py-2.5 rounded-xl border text-[13.5px] transition-all ${good ? "border-success bg-[var(--success-subtle)]" : bad ? "border-danger bg-[var(--danger-subtle)]" : sel ? "border-accent bg-accent-subtle" : "border-line hover:border-line-strong hover:bg-raised active:scale-[.995]"} ${picked ? "cursor-default" : "cursor-pointer"}`}>
        <span className={`w-6 h-6 rounded-md grid place-items-center text-2xs font-semibold shrink-0 ${good ? "bg-success text-[var(--on-success)]" : bad ? "bg-danger text-[var(--on-danger)]" : "bg-[var(--surface-hover)] text-fg2 group-hover:text-fg"}`}>{good ? <Check size={13} /> : bad ? <XCircle size={13} /> : LETTERS[i]}</span><span className="min-w-0 flex-1">{o}</span></button>; })}</div>
    {q!.multi && !picked && <button className="btn btn-primary mt-3" disabled={!draft.length} onClick={() => answer(draft)}>Valider</button>}
    {revealed && <div className={`mt-3 text-[13px] rounded-xl px-3.5 py-2.5 anim-fade ${ok(step) ? "bg-[var(--success-subtle)] text-success" : "bg-[var(--danger-subtle)] text-danger"}`}><b>{ok(step) ? "Bonne réponse." : `Bonne réponse : ${q!.answer!.map((k) => LETTERS[k]).join(", ")}.`}</b>{q!.explain && <span className="text-fg2"> {q!.explain}</span>}</div>}
    <div className="flex items-center justify-between mt-4"><button className="btn btn-ghost btn-sm" disabled={step === 0} onClick={() => go(step - 1)}><ChevronLeft size={14} />Précédent</button><button className="btn btn-sm" disabled={!picked} onClick={() => go(step + 1)}>{step === n - 1 ? "Voir le résultat" : "Suivant"}<ChevronRight size={14} /></button></div></div></Shell>;
}

// ---------------------------------------------------------------- Choix posés par le modèle
function ChoicesBlock({ raw }: { raw: string }) {
  const ctx = useContext(ChatActions); const sc = useContext(RichScope); const p = parse(raw); const key = `acc.choice.${sc.scope}.${hash(raw)}`; const [done, setDone] = useStored<string[] | null>(key, null); const [sel, setSel] = useState<string[]>([]); const [other, setOther] = useState("");
  if (!p.ok) return sc.streaming ? <Pending what="de la question" /> : errBox("Choix", raw, p.e); const s = p.v; const opts: { label: string; description?: string }[] = (Array.isArray(s) ? s : s?.options ?? []).map((o: any) => typeof o === "string" ? { label: o } : { label: String(o?.label ?? ""), description: o?.description ? String(o.description) : undefined }).filter((o: any) => o.label);
  if (opts.length < 2 || opts.length > 10) return errBox("Choix", raw, "2 à 10 options attendues"); const multiple = !!s?.multiple; const locked = !!done || !ctx.send || sc.streaming;
  const submit = (labels: string[]) => { if (!ctx.send || ctx.busy) return; setDone(labels); ctx.send(labels.length === 1 ? `Mon choix : ${labels[0]}` : `Mes choix : ${labels.join(", ")}`); };
  return <Shell icon={ListChecks} title={typeof s?.question === "string" ? s.question : "Votre choix"}><div className="p-4"><div className="grid gap-2 sm:grid-cols-2">{opts.map((o, i) => { const on = (done ?? sel).includes(o.label);
    return <button key={i} disabled={locked && !on} aria-pressed={on} onClick={() => { if (locked) return; if (multiple) setSel(on ? sel.filter((x) => x !== o.label) : [...sel, o.label]); else submit([o.label]); }}
      className={`text-left px-3.5 py-2.5 rounded-xl border transition-all ${on ? "border-accent bg-accent-subtle" : "border-line hover:border-line-strong hover:bg-raised active:scale-[.99]"} ${locked && !on ? "opacity-50" : ""}`}><div className="flex items-center gap-2 text-[13.5px] font-medium">{multiple && <span className={`w-4 h-4 rounded border grid place-items-center shrink-0 ${on ? "bg-accent border-accent text-[var(--accent-fg)]" : "border-line-strong"}`}>{on && <Check size={11} />}</span>}{o.label}</div>{o.description && <div className="text-2xs text-muted mt-0.5">{o.description}</div>}</button>; })}</div>
    {multiple && !locked && <button className="btn btn-primary mt-3" disabled={!sel.length || ctx.busy} onClick={() => submit(sel)}>Valider ma sélection</button>}
    {s?.allowOther && !locked && <form className="flex gap-2 mt-3" onSubmit={(e) => { e.preventDefault(); if (other.trim()) submit([other.trim()]); }}><input className="input" placeholder="Autre réponse…" aria-label="Autre réponse" value={other} onChange={(e) => setOther(e.target.value)} /><button className="btn btn-icon" aria-label="Envoyer" disabled={!other.trim() || ctx.busy}><Send size={14} /></button></form>}
    {!ctx.send && !done && <p className="text-2xs text-muted mt-2">Lecture seule : répondez depuis la conversation.</p>}{done && <p className="text-2xs text-muted mt-2">Réponse envoyée : {done.join(", ")}</p>}</div></Shell>;
}

// ---------------------------------------------------------------- Graphiques
const num = (v: any) => typeof v === "number" && isFinite(v);
function ChartBlock({ raw }: { raw: string }) {
  const sc = useContext(RichScope); const p = parse(raw); const [ok, setOk] = useState(false); if (!p.ok) return sc.streaming ? <Pending what="du graphique" /> : errBox("Graphique", raw, p.e); const s = p.v;
  const data: Record<string, any>[] = Array.isArray(s?.data) ? s.data.filter((d: any) => d && typeof d === "object").slice(0, 500) : []; if (!data.length) return errBox("Graphique", raw, "aucune donnée");
  const keys = Object.keys(data[0]!); const x: string = typeof s.x === "string" && keys.includes(s.x) ? s.x : keys.find((k) => !num(data[0]![k])) ?? keys[0]!;
  const series: string[] = (Array.isArray(s.series) ? s.series : typeof s.y === "string" ? [s.y] : keys.filter((k) => k !== x && data.some((d) => num(d[k])))).filter((k: string) => keys.includes(k)).slice(0, 8); if (!series.length) return errBox("Graphique", raw, "aucune série numérique");
  const type = ["bar", "line", "area", "pie"].includes(s.type) ? s.type : "bar"; const axis = { stroke: "var(--text-muted)", fontSize: 12, tickLine: false, axisLine: { stroke: "var(--border)" } } as const;
  const tip = <Tooltip cursor={{ fill: "rgba(255,255,255,.04)" }} contentStyle={{ background: "var(--surface-raised)", border: "1px solid var(--border-strong)", borderRadius: 10, fontSize: 12, color: "var(--text-primary)" }} labelStyle={{ color: "var(--text-secondary)" }} />;
  const copy = () => { const csv = [keys.join(","), ...data.map((d) => keys.map((k) => JSON.stringify(d[k] ?? "")).join(","))].join("\n"); void navigator.clipboard?.writeText(csv); setOk(true); setTimeout(() => setOk(false), 1500); };
  return <Shell icon={BarChart3} title={typeof s.title === "string" ? s.title : "Graphique"} right={<button className="btn btn-ghost btn-sm" onClick={copy} aria-label="Copier les données en CSV" title="Copier les données (CSV)">{ok ? <Check size={13} /> : <Copy size={13} />}{ok ? "Copié" : "CSV"}</button>}>
    <div className="p-3 pr-5" style={{ height: 300 }} role="img" aria-label={`Graphique ${type}${typeof s.title === "string" ? " : " + s.title : ""}`}><ResponsiveContainer width="100%" height="100%">
      {type === "pie" ? <PieChart><Pie data={data} dataKey={series[0]!} nameKey={x} innerRadius="48%" outerRadius="82%" paddingAngle={2} stroke="var(--panel, #2d2c2a)">{data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}</Pie>{tip}<Legend wrapperStyle={{ fontSize: 12 }} /></PieChart>
        : type === "line" ? <LineChart data={data}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey={x} {...axis} /><YAxis {...axis} width={44} />{tip}{series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}{series.map((k, i) => <Line key={k} type="monotone" dataKey={k} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2.2} dot={{ r: 3 }} activeDot={{ r: 5 }} />)}</LineChart>
        : type === "area" ? <AreaChart data={data}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey={x} {...axis} /><YAxis {...axis} width={44} />{tip}{series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}{series.map((k, i) => <Area key={k} type="monotone" dataKey={k} stroke={PALETTE[i % PALETTE.length]} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.22} strokeWidth={2} stackId={s.stacked ? "a" : undefined} />)}</AreaChart>
        : <BarChart data={data}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey={x} {...axis} /><YAxis {...axis} width={44} />{tip}{series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}{series.map((k, i) => <Bar key={k} dataKey={k} fill={PALETTE[i % PALETTE.length]} radius={[5, 5, 0, 0]} stackId={s.stacked ? "a" : undefined} />)}</BarChart>}
    </ResponsiveContainer></div></Shell>;
}

// ---------------------------------------------------------------- Diagrammes Mermaid (chargés à la demande)
let mermaidP: Promise<any> | undefined;
const MERMAID_VARS = {
  dark: { background: "#2d2c2a", primaryColor: "#3d3c39", primaryTextColor: "#faf9f5", primaryBorderColor: "#e0865f", lineColor: "#9d9b92", secondaryColor: "#343330", tertiaryColor: "#262624", textColor: "#faf9f5", noteBkgColor: "#343330", noteTextColor: "#faf9f5" },
  light: { background: "#ffffff", primaryColor: "#f3f1ea", primaryTextColor: "#1f1e1d", primaryBorderColor: "#b4532f", lineColor: "#66645d", secondaryColor: "#e9e6db", tertiaryColor: "#faf9f5", textColor: "#1f1e1d", noteBkgColor: "#f3f1ea", noteTextColor: "#1f1e1d" },
} as const;
function MermaidBlock({ code }: { code: string }) {
  const sc = useContext(RichScope); if (sc.streaming) return <Pending what="du diagramme" />;
  return <MermaidView code={code} />;
}
function MermaidView({ code }: { code: string }) {
  const [svg, setSvg] = useState<string>(); const [err, setErr] = useState<string>(); const [src, setSrc] = useState(false); const id = useRef("m" + Math.random().toString(36).slice(2, 9)); const [th, setTh] = useState(currentTheme());
  useEffect(() => { const f = () => setTh(currentTheme()); window.addEventListener("acc-theme", f); return () => window.removeEventListener("acc-theme", f); }, []);
  useEffect(() => { let off = false; setErr(undefined);
    (mermaidP ??= import("mermaid").then((m) => m.default))
      .then((m) => { m.initialize({ startOnLoad: false, suppressErrorRendering: true, securityLevel: "strict", theme: "base", fontFamily: "Inter Variable, Segoe UI, sans-serif", themeVariables: MERMAID_VARS[th] }); return m.render(id.current + th, code); })
      .then((r: any) => { if (!off) setSvg(r.svg); }).catch((e: any) => { document.getElementById("d" + id.current + th)?.remove(); document.getElementById(id.current + th)?.remove(); if (!off) setErr(String(e?.message ?? e).split("\n")[0]!.slice(0, 160)); });
    return () => { off = true; }; }, [code, th]);
  return <Shell icon={GitBranch} title="Diagramme" right={<button className="btn btn-ghost btn-sm" onClick={() => setSrc(!src)}>{src ? <Eye size={13} /> : <Code2 size={13} />}{src ? "Diagramme" : "Code"}</button>}>
    {src || err ? <div className="p-3">{err && <div role="alert" className="text-xs text-warning mb-1.5">Diagramme invalide : {err}</div>}<pre className="bg-bg border border-line rounded-xl p-4 overflow-auto text-[12.5px]">{code}</pre></div>
      : svg ? <div className="p-4 overflow-auto flex justify-center [&_svg]:max-w-full [&_svg]:h-auto" dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="p-6 grid place-items-center text-muted text-[13px]"><Loader2 size={16} className="animate-spin" /></div>}</Shell>;
}

// ---------------------------------------------------------------- Aperçu HTML / SVG isolé (cadre sans accès réseau ni à l'application)
function ArtifactBlock({ code, kind }: { code: string; kind: "html" | "svg" }) {
  const sc = useContext(RichScope); if (sc.streaming) return <Pending what={kind === "svg" ? "de l'image" : "de l'aperçu"} />;
  return <ArtifactView code={code} kind={kind} />;
}
function ArtifactView({ code, kind }: { code: string; kind: "html" | "svg" }) {
  const [tab, setTab] = useState<"view" | "code">("view"); const [url, setUrl] = useState<string>(); const [full, setFull] = useState(false); const [ok, setOk] = useState(false);
  const html = kind === "svg" ? `<!doctype html><meta charset="utf-8"><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#fff">${code}</body>` : code;
  useEffect(() => { let off = false; setUrl(undefined); api("artifact.put", html).then((id: string) => { if (!off) setUrl(`acc-artifact://a/${id}`); }).catch(() => {}); return () => { off = true; }; }, [html]);
  const copy = () => { void navigator.clipboard?.writeText(code); setOk(true); setTimeout(() => setOk(false), 1500); };
  const frame = (h: string) => url ? <iframe title="Aperçu" src={url} sandbox="allow-scripts" referrerPolicy="no-referrer" className="w-full bg-white" style={{ height: h, border: 0 }} /> : <div className="grid place-items-center text-muted" style={{ height: h }}><Loader2 size={16} className="animate-spin" /></div>;
  return <Shell icon={kind === "svg" ? Eye : Code2} title={kind === "svg" ? "Image SVG" : "Aperçu HTML"} right={<>
    <div role="tablist" className="flex rounded-lg bg-bg border border-line p-0.5 mr-1">{(["view", "code"] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`px-2 h-6 rounded-md text-2xs ${tab === t ? "bg-[var(--surface-hover)] text-fg" : "text-muted hover:text-fg"}`}>{t === "view" ? "Aperçu" : "Code"}</button>)}</div>
    <button className="btn btn-ghost btn-icon !h-7 !w-7" aria-label="Plein écran" title="Plein écran" onClick={() => setFull(true)}><Maximize2 size={13} /></button>
    <button className="btn btn-ghost btn-icon !h-7 !w-7" aria-label="Enregistrer le fichier" title="Enregistrer" onClick={() => api("file.saveText", kind === "svg" ? "image.svg" : "page.html", code).then((p: string | null) => p && toast("Fichier enregistré.", "success")).catch((e: any) => toast(String(e.message), "error"))}><Download size={13} /></button>
    <button className="btn btn-ghost btn-icon !h-7 !w-7" aria-label="Copier le code" title="Copier le code" onClick={copy}>{ok ? <Check size={13} /> : <Copy size={13} />}</button></>}>
    {tab === "view" ? <div className="resize-y overflow-hidden" style={{ height: 380, minHeight: 160, maxHeight: 900 }}>{frame("100%")}</div> : <pre className="bg-bg p-4 overflow-auto text-[12.5px] max-h-[380px]">{code}</pre>}
    <Modal open={full} onClose={() => setFull(false)} width="max-w-5xl" title={kind === "svg" ? "Image SVG" : "Aperçu HTML"}><div className="-m-1">{frame("70vh")}</div></Modal></Shell>;
}

/** Image générée par Codex (abonnement ChatGPT), enregistrée dans le dossier de l'application et servie par le protocole local `acc-image`. */
function ImageBlock({ raw }: { raw: string }) {
  const { streaming } = useContext(RichScope); const [big, setBig] = useState(false); const [bad, setBad] = useState(false);
  let meta: { file?: string; prompt?: string } = {}; try { meta = JSON.parse(raw); } catch { /* en cours */ }
  if (!meta.file || !/^[A-Za-z0-9_-]{1,80}\/[A-Za-z0-9_-]{1,80}\.png$/.test(meta.file)) return streaming ? <Pending what="l'image" /> : <div className="my-4 rounded-2xl border border-line px-4 py-3 text-[13px] text-muted not-prose">Image indisponible.</div>;
  const src = `acc-image://f/${meta.file}`; const alt = meta.prompt || "Image générée";
  const save = async () => { try { const p = await api("image.save", meta.file); if (p) toast(`Image enregistrée : ${p}`, "success"); } catch (e: any) { toast(String(e.message), "error"); } };
  if (bad) return <div className="my-4 rounded-2xl border border-line px-4 py-3 text-[13px] text-muted not-prose">Image introuvable sur cet ordinateur (fichier supprimé ou conversation restaurée sans ses images).</div>;
  return <figure className="my-4 not-prose"><div className="relative inline-block max-w-full group"><img src={src} alt={alt} className="max-h-[420px] max-w-full rounded-2xl border border-line cursor-zoom-in" onError={() => setBad(true)} onClick={() => setBig(true)} />
    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"><button className="btn btn-icon !h-8 !w-8 bg-panel/90" aria-label="Agrandir l'image" onClick={() => setBig(true)}><Maximize2 size={14} /></button><button className="btn btn-icon !h-8 !w-8 bg-panel/90" aria-label="Enregistrer l'image" onClick={save}><Download size={14} /></button></div></div>
    {meta.prompt && <figcaption className="text-2xs text-muted mt-1.5 max-w-prose">{meta.prompt}</figcaption>}
    <Modal open={big} onClose={() => setBig(false)} width="max-w-4xl" title="Image générée" footer={<button className="btn" onClick={save}><Download size={14} />Enregistrer</button>}><img src={src} alt={alt} className="max-w-full max-h-[70vh] mx-auto rounded-xl" /></Modal></figure>;
}
/** Langages de blocs de code rendus de façon interactive. ```artifact = page HTML complète exécutée dans un cadre isolé (```html reste du code affiché tel quel). */
export const RICH_LANGS = new Set(["image", "quiz", "qcm", "choices", "chart", "mermaid", "artifact", "svg", "html"]);
export function richBlock(lang: string, code: string): ReactNode | null {
  switch (lang) {
    case "quiz": case "qcm": return <QuizBlock raw={code} />; case "choices": return <ChoicesBlock raw={code} />; case "chart": return <ChartBlock raw={code} />; case "mermaid": return <MermaidBlock code={code} />;
    case "image": return <ImageBlock raw={code} />;
    case "artifact": return <ArtifactBlock code={code} kind="html" />; case "html": return /^\s*(<!doctype html|<html[\s>])/i.test(code) ? <ArtifactBlock code={code} kind="html" /> : null;
    case "svg": return /<\s*svg/i.test(code) ? <ArtifactBlock code={code} kind="svg" /> : null; default: return null;
  }
}
