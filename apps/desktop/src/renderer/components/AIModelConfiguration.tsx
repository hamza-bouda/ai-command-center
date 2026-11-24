import { useEffect, useMemo, useState } from "react";
import { Info, ShieldCheck, ShieldAlert, ChevronDown, Check, Gauge } from "lucide-react";
import { useData } from "../hooks";

export type ProviderId = "claude" | "codex";
export interface AIConfig { provider: ProviderId; model: string | null; effort: string | null }
export type Mode = "chat" | "work" | "code";
interface EffortOption { value: string; description?: string }
interface ModelInfo { id: string; displayName: string; isDefault?: boolean; description?: string; efforts?: EffortOption[]; defaultEffort?: string; capabilities?: string[]; source?: string }
interface Catalog { provider: ProviderId; available: boolean; reason?: string; models: ModelInfo[]; defaultEfforts?: EffortOption[]; notes: string[] }

export const PROVIDER_LABEL: Record<ProviderId, string> = { claude: "Claude Code", codex: "Codex" };
const FAMILY: Record<ProviderId, string> = { claude: "Anthropic", codex: "OpenAI" };
// Descriptions indicatives (jamais présentées comme un réglage du fournisseur).
const INDICATIVE: Record<string, string> = { none: "Aucun raisonnement", minimal: "Très rapide", low: "Rapide", medium: "Équilibré", high: "Approfondi", xhigh: "Intensif", max: "Intensif+", ultra: "Intensif avec délégation" };
export const effortLabel = (v?: string | null) => (v ? v.charAt(0).toUpperCase() + v.slice(1) : "Automatique");

/** Les efforts réellement exposés pour (fournisseur, modèle) ; undefined = non configurable. */
export function effortsFor(cat: Catalog | undefined, model: string | null): EffortOption[] | undefined {
  if (!cat?.available) return undefined; const m = model ? cat.models.find((x) => x.id === model) : cat.models.find((x) => x.isDefault) ?? cat.models.find((x) => x.id === "");
  return (m?.efforts?.length ? m.efforts : model ? undefined : cat.defaultEfforts) ?? undefined;
}

/** Sélecteur d'effort : valeurs dynamiques du fournisseur (segments) ; sinon « Automatique — géré par le fournisseur ». */
export function ReasoningEffortSelector({ efforts, value, onChange, disabled, compact }: { efforts?: EffortOption[]; value: string | null; onChange: (v: string | null) => void; disabled?: boolean; compact?: boolean }) {
  const cur = efforts?.find((e) => e.value === value);
  if (!efforts?.length) return compact
    ? <div className="h-8 px-2.5 text-xs text-muted" title="Ce modèle n'expose pas de réglage d'effort : géré par le fournisseur." aria-label="Effort : automatique, géré par le fournisseur">Effort : Automatique</div>
    : <div className="flex items-center gap-2 rounded-xl border border-line bg-bg px-3 py-2.5 text-[13px] text-muted" aria-label="Effort : automatique, géré par le fournisseur"><Gauge size={15} className="shrink-0" /><span>Automatique — géré par le fournisseur pour ce modèle</span></div>;
  if (compact) return <select className="input !h-8 !text-xs !w-auto" aria-label="Effort de raisonnement" disabled={disabled} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}><option value="">Effort : Auto</option>{efforts.map((e) => <option key={e.value} value={e.value}>{`Effort : ${effortLabel(e.value)}`}</option>)}</select>;
  const opts: { v: string | null; label: string }[] = [{ v: null, label: "Auto" }, ...efforts.map((e) => ({ v: e.value, label: effortLabel(e.value) }))];
  return <div>
    <div role="radiogroup" aria-label="Effort de raisonnement" className="grid gap-1 p-1 rounded-xl border border-line bg-bg" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(58px, 1fr))" }}>{opts.map((o) => { const on = (value ?? null) === o.v; return <button key={o.label} type="button" role="radio" aria-checked={on} disabled={disabled} onClick={() => onChange(o.v)} className={`h-8 px-2 rounded-lg text-[13px] font-medium transition-colors disabled:opacity-50 ${on ? "bg-accent text-[var(--accent-fg)]" : "text-fg2 hover:bg-raised hover:text-fg"}`}>{o.label}</button>; })}</div>
    <p className="text-xs text-muted mt-2 min-h-[32px]">{cur ? <><span className="text-fg2 font-medium">{INDICATIVE[cur.value] ?? cur.value}</span>{cur.description ? ` — ${cur.description}` : ""} <span className="text-2xs">(indicatif)</span></> : "Le fournisseur choisit le niveau par défaut. Les descriptions sont indicatives."}</p></div>;
}

function PolicyPanel({ mode, provider }: { mode: Mode; provider: ProviderId }) {
  const { data } = useData<any>("ai.policy", [mode, provider]); const [open, setOpen] = useState(false);
  if (!data) return null; const d = data.description;
  return <div className="mt-1"><button type="button" className="text-xs text-muted hover:text-fg inline-flex items-center gap-1" aria-expanded={open} onClick={() => setOpen(!open)}><ShieldCheck size={13} />Permissions du mode {data.label}<ChevronDown size={12} className={open ? "rotate-180" : ""} /></button>
    {open && <div className="anim-fade mt-2 text-xs space-y-2 card p-3">{d.guaranteed.length > 0 && <div><div className="text-success font-medium mb-0.5 flex items-center gap-1"><ShieldCheck size={12} />Appliqué</div><ul className="list-disc pl-4 text-fg2 space-y-0.5">{d.guaranteed.map((g: string) => <li key={g}>{g}</li>)}</ul></div>}
      {d.bestEffort.length > 0 && <div><div className="text-warning font-medium mb-0.5">Au mieux</div><ul className="list-disc pl-4 text-fg2 space-y-0.5">{d.bestEffort.map((g: string) => <li key={g}>{g}</li>)}</ul></div>}
      {d.notGuaranteed.length > 0 && <div><div className="text-muted font-medium mb-0.5 flex items-center gap-1"><ShieldAlert size={12} />Non garanti / limites</div><ul className="list-disc pl-4 text-muted space-y-0.5">{d.notGuaranteed.map((g: string) => <li key={g}>{g}</li>)}</ul></div>}</div>}</div>;
}

/**
 * Configuration IA unifiée (fournisseur / modèle / effort / permissions du mode).
 * Les options viennent du catalogue des interfaces officielles ; une valeur non exposée n'est jamais proposée.
 */
export function AIModelConfiguration({ mode, value, onChange, variant = "form", showEffort = true, showPolicy = true, lockProvider, disabled }: { mode: Mode; value: AIConfig; onChange: (v: AIConfig) => void; variant?: "form" | "inline" | "stack"; showEffort?: boolean; showPolicy?: boolean; lockProvider?: boolean; disabled?: boolean }) {
  const { data: cl } = useData<Catalog>("ai.catalog", ["claude"], { every: 120000 }); const { data: cx } = useData<Catalog>("ai.catalog", ["codex"], { every: 120000 });
  const cats: Record<ProviderId, Catalog | undefined> = { claude: cl, codex: cx }; const cat = cats[value.provider]; const [note, setNote] = useState<string>();
  const models = cat?.models ?? []; const efforts = useMemo(() => effortsFor(cat, value.model), [cat, value.model]);
  useEffect(() => { // une valeur devenue invalide (modèle retiré, effort non pris en charge) est retirée visiblement, jamais envoyée
    if (!cat?.available) return; if (value.model && !models.some((m) => m.id === value.model)) { setNote(`Le modèle « ${value.model} » n'est plus disponible : modèle par défaut utilisé.`); onChange({ ...value, model: null, effort: null }); return; }
    if (value.effort && !efforts?.some((e) => e.value === value.effort)) { setNote("Effort réinitialisé : non pris en charge par ce modèle."); onChange({ ...value, effort: null }); } }, [cat, value.model, value.effort]);
  const setProvider = (p: ProviderId) => { setNote(undefined); onChange({ provider: p, model: null, effort: null }); };
  const setModel = (m: string) => { setNote(undefined); const nm = m || null; const nef = effortsFor(cat, nm); onChange({ ...value, model: nm, effort: value.effort && nef?.some((e) => e.value === value.effort) ? value.effort : null }); };
  const provOpts = (["claude", "codex"] as ProviderId[]).map((p) => { const c = cats[p]; return <option key={p} value={p} disabled={!!c && !c.available}>{PROVIDER_LABEL[p]} ({FAMILY[p]}){c && !c.available ? " — indisponible" : ""}</option>; });
  const modelOpts = [<option key="" value="">Défaut du fournisseur</option>, ...models.filter((m) => m.id).map((m) => <option key={m.id} value={m.id}>{m.displayName}{m.source === "cli-alias" ? " (alias)" : m.source === "observed" ? " (déjà utilisé)" : ""}</option>)];
  const cur = models.find((m) => m.id === (value.model ?? ""));

  if (variant === "stack") return <div className="space-y-2.5" role="group" aria-label="Configuration du modèle">
    <div role="radiogroup" aria-label="Fournisseur" className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-bg border border-line">{(["claude", "codex"] as ProviderId[]).map((p) => { const c = cats[p]; const on = value.provider === p; const off = !!c && !c.available;
      return <button key={p} type="button" role="radio" aria-checked={on} disabled={disabled || off || (lockProvider && !on)} title={off ? c?.reason : FAMILY[p]} onClick={() => setProvider(p)} className={`h-8 rounded-lg text-[13px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors ${on ? "bg-panel text-fg shadow-sm border border-line-strong" : "text-muted hover:text-fg border border-transparent"} disabled:opacity-45`}><span className={`w-2 h-2 rounded-full ${p === "claude" ? "bg-claude" : "bg-codex"}`} aria-hidden />{PROVIDER_LABEL[p]}</button>; })}</div>
    <select className="input !h-9 !text-[13px]" aria-label="Modèle" disabled={disabled || !cat?.available} value={value.model ?? ""} onChange={(e) => setModel(e.target.value)} title={cur?.description}>{cat ? modelOpts : <option>Chargement…</option>}</select>
    {showEffort && efforts && efforts.length > 0 && <div className="flex items-center gap-2"><span className="text-xs text-muted shrink-0">Effort</span><div className="min-w-0 flex-1"><ReasoningEffortSelector compact efforts={efforts} value={value.effort} disabled={disabled || !cat?.available} onChange={(e) => onChange({ ...value, effort: e })} /></div></div>}
    {cat && !cat.available && <p role="alert" className="text-xs text-warning">{cat.reason}</p>}{note && <p role="status" className="text-xs text-warning">{note}</p>}</div>;
  if (variant === "inline") return <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Configuration du modèle">
    <select className="input !h-8 !text-xs !w-auto" aria-label="Fournisseur" disabled={disabled || lockProvider} value={value.provider} onChange={(e) => setProvider(e.target.value as ProviderId)}>{provOpts}</select>
    <select className="input !h-8 !text-xs !w-auto max-w-[190px]" aria-label="Modèle" disabled={disabled || !cat?.available} value={value.model ?? ""} onChange={(e) => setModel(e.target.value)} title={cur?.description}>{cat ? modelOpts : <option>Chargement…</option>}</select>
    {showEffort && <ReasoningEffortSelector compact efforts={efforts} value={value.effort} disabled={disabled || !cat?.available} onChange={(e) => onChange({ ...value, effort: e })} />}
    {cat && !cat.available && <span className="text-xs text-warning" role="alert" title={cat.reason}>{PROVIDER_LABEL[value.provider]} indisponible</span>}{note && <span className="text-xs text-warning">{note}</span>}</div>;

  const rows: ModelInfo[] = [{ id: "", displayName: "Défaut du fournisseur", description: "Le fournisseur choisit le modèle recommandé pour votre abonnement." }, ...models.filter((m) => m.id)];
  return <div>
    <div className="label">Fournisseur</div>
    <div role="radiogroup" aria-label="Fournisseur" className="grid grid-cols-2 gap-2 mb-1">{(["claude", "codex"] as ProviderId[]).map((p) => { const c = cats[p]; const on = value.provider === p; const off = !!c && !c.available;
      return <button key={p} type="button" role="radio" aria-checked={on} disabled={disabled || off || (lockProvider && !on)} onClick={() => setProvider(p)} title={off ? c?.reason : undefined} className={`text-left p-3 rounded-xl border transition-colors ${on ? "border-accent bg-accent-subtle" : "border-line bg-bg hover:border-line-strong"} disabled:opacity-45 disabled:cursor-not-allowed`}>
        <div className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full shrink-0 ${p === "claude" ? "bg-claude" : "bg-codex"}`} aria-hidden /><span className="font-medium text-[13px]">{PROVIDER_LABEL[p]}</span>{on && <Check size={14} className="ml-auto text-accent" aria-hidden />}</div>
        <div className="text-2xs text-muted mt-0.5">{FAMILY[p]}{off ? " · indisponible" : ""}</div></button>; })}</div>
    {cat && !cat.available && <p role="alert" className="text-xs text-warning mt-1.5 flex gap-1.5"><Info size={13} className="mt-0.5 shrink-0" />{cat.reason}</p>}
    <div className="label mt-4">Modèle</div>
    <div role="radiogroup" aria-label="Modèle" className="rounded-xl border border-line bg-bg max-h-[230px] overflow-auto p-1">{!cat ? <p className="text-muted text-xs p-3">Chargement des modèles…</p> : rows.map((m) => { const on = (value.model ?? "") === m.id; return <button key={m.id || "default"} type="button" role="radio" aria-checked={on} disabled={disabled || !cat.available} onClick={() => setModel(m.id)} className={`w-full text-left flex items-start gap-2.5 px-2.5 py-2 rounded-lg transition-colors disabled:opacity-50 ${on ? "bg-accent-subtle" : "hover:bg-raised"}`}>
      <span className={`mt-1 w-3.5 h-3.5 rounded-full border shrink-0 grid place-items-center ${on ? "border-accent" : "border-line-strong"}`}>{on && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}</span>
      <span className="min-w-0 flex-1"><span className="flex items-center gap-1.5"><span className="text-[13px] font-medium truncate">{m.displayName}</span>{m.source === "cli-alias" && m.id && <span className="text-2xs text-muted border border-line rounded px-1">alias</span>}{m.source === "observed" && <span className="text-2xs text-muted border border-line rounded px-1">déjà utilisé</span>}{m.efforts?.length ? <span className="text-2xs text-muted ml-auto shrink-0">{m.efforts.length} niveaux d'effort</span> : null}</span>{m.description && <span className="block text-2xs text-muted leading-snug line-clamp-2">{m.description}</span>}</span></button>; })}</div>
    {cat?.notes.map((n) => <p key={n} className="text-2xs text-muted mt-1.5">{n}</p>)}
    {showEffort && <><div className="label mt-4">Effort de raisonnement</div><ReasoningEffortSelector efforts={efforts} value={value.effort} disabled={disabled || !cat?.available} onChange={(e) => onChange({ ...value, effort: e })} /></>}
    {note && <p role="status" className="text-xs text-warning mt-2">{note}</p>}{showPolicy && <div className="mt-3 pt-3 border-t border-line"><PolicyPanel mode={mode} provider={value.provider} /></div>}</div>;
}

/** Configuration initiale : défaut du mode si valide, sinon premier fournisseur disponible. */
export function useDefaultConfig(mode: Mode): [AIConfig, (c: AIConfig) => void, boolean] {
  const { data: defs } = useData<any>("ai.defaults", []); const { data: cl } = useData<Catalog>("ai.catalog", ["claude"]); const { data: cx } = useData<Catalog>("ai.catalog", ["codex"]);
  const [cfg, setCfg] = useState<AIConfig>({ provider: "claude", model: null, effort: null }); const [ready, setReady] = useState(false);
  useEffect(() => { if (ready || !defs || !cl || !cx) return; const d = defs[mode]; const ok = (p: ProviderId) => (p === "claude" ? cl : cx).available;
    const prov: ProviderId = d?.provider && ok(d.provider) ? d.provider : ok("claude") ? "claude" : "codex"; setCfg(d?.provider === prov ? { provider: prov, model: d.model ?? null, effort: d.effort ?? null } : { provider: prov, model: null, effort: null }); setReady(true); }, [defs, cl, cx, ready]);
  return [cfg, setCfg, ready];
}
