import { useEffect, useState } from "react";
import { Asterisk, CheckCircle2, AlertTriangle, XCircle, Copy, Check, RefreshCw, MessageSquare, Briefcase, Code2, Loader2, ArrowRight } from "lucide-react";
import { api } from "../api"; import { useData } from "../hooks"; import { Modal, Segmented } from "../ui"; import { getThemeMode, setThemeMode, type ThemeMode } from "../theme";

const STEPS = ["Bienvenue", "Connexion", "Préférences", "Prêt"] as const;
const errMsg = (e: any) => String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

/** Commande à copier : jamais exécutée par l'application (la connexion se fait dans le CLI officiel, hors de notre vue). */
function Cmd({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return <div className="flex items-center gap-2 bg-bg border border-line rounded-lg pl-3 pr-1 h-9"><code className="mono text-[12.5px] flex-1 truncate select-text">{text}</code>
    <button className="btn btn-ghost btn-icon !h-7 !w-7" aria-label={`Copier ${text}`} onClick={() => { void navigator.clipboard?.writeText(text).catch(() => {}); setOk(true); setTimeout(() => setOk(false), 1400); }}>{ok ? <Check size={13} /> : <Copy size={13} />}</button></div>;
}
function ProviderRow({ id, label, s, loginCmd, installHint, docs }: { id: string; label: string; s: any; loginCmd: string; installHint: string; docs: string }) {
  const ok = s?.authenticated && s.authMode === "subscription"; const state = !s ? "check" : !s.installed ? "absent" : ok ? "ok" : "login";
  return <div className="rounded-xl border border-line p-3.5"><div className="flex items-center gap-2">{state === "ok" ? <CheckCircle2 size={17} className="text-success shrink-0" /> : state === "check" ? <Loader2 size={17} className="animate-spin text-muted shrink-0" /> : state === "absent" ? <XCircle size={17} className="text-danger shrink-0" /> : <AlertTriangle size={17} className="text-warning shrink-0" />}
    <span className="font-medium text-[14px]">{label}</span><span className="ml-auto text-xs text-muted">{state === "ok" ? `Connecté par abonnement${s?.plan ? ` · plan ${s.plan}` : ""}` : state === "check" ? "Vérification…" : state === "absent" ? "Non installé" : s?.authMode === "api_key" ? "Clé API détectée : abonnement requis" : "À connecter"}</span></div>
    {state === "absent" && <div className="mt-2.5 space-y-2"><p className="text-xs text-fg2">Installez le CLI officiel ({installHint}), puis connectez-le. <a className="text-accent hover:underline" href={docs} target="_blank" rel="noreferrer">Documentation officielle</a></p><Cmd text={loginCmd} /></div>}
    {state === "login" && <div className="mt-2.5 space-y-2"><p className="text-xs text-fg2">Dans un terminal, connectez-vous avec votre abonnement (le navigateur s'ouvre) :</p><Cmd text={loginCmd} /></div>}
    {s?.warnings?.length > 0 && state !== "ok" && <p className="text-2xs text-warning mt-2">{String(s.warnings[0])}</p>}</div>;
}

/** Parcours de bienvenue : présentation, état des abonnements (sans jamais lancer de connexion), préférences, premier pas. */
export function Onboarding({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0); const { data: prov, reload } = useData<any>("providers.all", [], { every: 5000 }); const [checking, setChecking] = useState(false);
  const [name, setName] = useState(""); const [mode, setMode] = useState<ThemeMode>(getThemeMode());
  useEffect(() => { void api("settings.all").then((s: any) => { if (s?.["profile.name"]) setName(String(s["profile.name"])); }).catch(() => {}); }, []);
  const recheck = async () => { setChecking(true); try { await api("providers.all", true); reload(); } finally { setChecking(false); } };
  const finish = async (to?: string) => { try { if (name.trim()) await api("settings.set", "profile.name", name.trim().slice(0, 40)); await api("onboarding.finish"); } catch { /* non bloquant */ } onClose(); if (to) window.location.hash = to; };
  const last = step === STEPS.length - 1; const anyOk = ["claude", "codex"].some((k) => prov?.[k]?.authenticated && prov[k].authMode === "subscription");
  return <Modal open onClose={() => void finish()} width="max-w-xl" title="Introduction" footer={<>
    <button className="btn btn-ghost mr-auto" onClick={() => void finish()}>{last ? "Fermer" : "Passer l'introduction"}</button>
    {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}>Retour</button>}
    {!last && <button className="btn btn-primary" onClick={() => setStep(step + 1)}>{step === 1 && !anyOk ? "Continuer quand même" : "Suivant"}<ArrowRight size={14} /></button>}</>}>
    <div className="flex items-center gap-1.5 mb-5" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1} aria-label={`Étape ${step + 1} sur ${STEPS.length} : ${STEPS[step]}`}>{STEPS.map((s, i) => <span key={s} className={`h-1.5 rounded-full transition-all ${i === step ? "w-8 bg-accent" : i < step ? "w-4 bg-accent/60" : "w-4 bg-[var(--surface-hover)]"}`} />)}</div>
    {step === 0 && <div className="anim-fade"><div className="flex items-center gap-3 mb-3"><Asterisk size={34} strokeWidth={2.4} className="text-accent" aria-hidden /><h2 className="font-display text-[30px] leading-tight">Bienvenue</h2></div>
      <p className="text-[14px] text-fg2 mb-4">AI Command Center réunit <b>Claude Code</b> et <b>Codex</b> dans une seule application, avec <b>vos abonnements</b> : aucune clé API, aucune facturation à l'usage.</p>
      <div className="grid gap-2.5">{[[MessageSquare, "Chat", "Posez une question, rédigez, analysez. Graphiques, QCM et diagrammes s'affichent directement."], [Briefcase, "Work", "Un travail structuré avec vos documents et des livrables."], [Code2, "Code", "Programmez sur un projet, seul ou avec plusieurs agents en parallèle."]].map(([I, t, d]: any) => <div key={t} className="flex items-start gap-3 rounded-xl border border-line p-3"><span className="w-9 h-9 rounded-lg bg-accent-subtle text-accent grid place-items-center shrink-0"><I size={17} /></span><div><div className="text-[14px] font-medium">{t}</div><div className="text-xs text-muted">{d}</div></div></div>)}</div></div>}
    {step === 1 && <div className="anim-fade"><h2 className="font-display text-[26px] leading-tight mb-1">Vos abonnements</h2><p className="text-[13px] text-fg2 mb-4">L'application utilise les programmes officiels installés sur cet ordinateur. Elle ne vous demande jamais de mot de passe : la connexion se fait dans leur propre fenêtre.</p>
      <div className="space-y-3"><ProviderRow id="claude" label="Claude Code" s={prov?.claude} loginCmd="claude auth login" installHint="npm install -g @anthropic-ai/claude-code" docs="https://docs.claude.com/en/docs/claude-code/overview" /><ProviderRow id="codex" label="Codex (OpenAI)" s={prov?.codex} loginCmd="codex login" installHint="voir le dépôt officiel" docs="https://github.com/openai/codex" /></div>
      <button className="btn mt-4" disabled={checking} onClick={recheck}><RefreshCw size={14} className={checking ? "animate-spin" : ""} />Revérifier</button>
      <p className="text-2xs text-muted mt-3">Un seul des deux suffit pour commencer. Vous pourrez connecter l'autre plus tard (Suivi › Abonnements et quotas).</p></div>}
    {step === 2 && <div className="anim-fade"><h2 className="font-display text-[26px] leading-tight mb-4">Vos préférences</h2>
      <div className="mb-5"><label className="label" htmlFor="ob-name">Votre prénom (facultatif)</label><input id="ob-name" className="input" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="Pour la salutation de l'accueil" /></div>
      <div className="mb-5"><span className="label">Thème</span><Segmented label="Thème" value={mode} onChange={(m: ThemeMode) => { setMode(m); void setThemeMode(m); }} options={[["system", "Système"], ["light", "Clair"], ["dark", "Sombre"]]} /></div>
      <p className="text-xs text-muted">Astuce : <span className="kbd">Ctrl</span> <span className="kbd">Alt</span> <span className="kbd">Espace</span> ouvre un lanceur rapide depuis n'importe quelle application ; <span className="kbd">Ctrl</span> <span className="kbd">K</span> cherche partout. Pour dicter, utilisez <span className="kbd">Windows</span> <span className="kbd">H</span> dans la zone de saisie. Tout se règle dans Paramètres.</p></div>}
    {step === 3 && <div className="anim-fade text-center py-2"><span className="inline-grid place-items-center w-14 h-14 rounded-2xl bg-accent-subtle text-accent mb-3"><CheckCircle2 size={28} /></span><h2 className="font-display text-[28px] leading-tight mb-1">{name.trim() ? `C'est prêt, ${name.trim()}` : "C'est prêt"}</h2>
      <p className="text-[13px] text-fg2 mb-5">{anyOk ? "Vos abonnements sont connectés. Par où commencer ?" : "Connectez un abonnement pour envoyer votre premier message, puis revenez ici. Par où commencer ?"}</p>
      <div className="grid gap-2 sm:grid-cols-3"><button className="btn btn-primary" onClick={() => void finish("/chat?new=1")}><MessageSquare size={14} />Un chat</button><button className="btn" onClick={() => void finish("/code")}><Code2 size={14} />Code</button><button className="btn" onClick={() => void finish("/")}>Accueil</button></div>
      <p className="text-2xs text-muted mt-4">Cette introduction se rouvre depuis Paramètres › Application.</p></div>}
  </Modal>;
}
