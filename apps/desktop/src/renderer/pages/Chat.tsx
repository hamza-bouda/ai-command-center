import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Asterisk, ImagePlus, Paperclip, Send, Lightbulb, PenLine, Code2, GraduationCap, MessageSquare, ListChecks, BarChart3, GitBranch, Sparkles } from "lucide-react";
import { api } from "../api"; import { useData } from "../hooks"; import { toast } from "../overlay";
import { ErrorState } from "../ui";
import { AIModelConfiguration, useDefaultConfig, AIConfig, Mode, PROVIDER_LABEL } from "../components/AIModelConfiguration"; import { ConversationList, ConversationView } from "../components/Conversations"; import { Composer, type Attach } from "../components/Composer"; import { useAttachFlow } from "../components/attachFlow"; import { useImageInput } from "../components/imageInput"; import { LimitBanner } from "../components/LimitBanner";

const SUGGESTIONS: [any, string, string][] = [[GraduationCap, "Expliquer un concept", "Explique-moi simplement le fonctionnement de "], [Lightbulb, "Analyser une idée", "Aide-moi à analyser cette idée, avec ses forces et ses risques : "], [PenLine, "Rédiger un texte", "Rédige un texte clair et soigné sur "], [Code2, "Comprendre du code", "Explique ce que fait ce code, étape par étape :\n\n"], [ListChecks, "Créer un QCM cliquable", "Crée un QCM de 5 questions pour réviser "], [BarChart3, "Comparer en graphique", "Compare sous forme de graphique, avec des chiffres réalistes : "], [GitBranch, "Expliquer avec un schéma", "Explique avec un diagramme : "], [Sparkles, "Créer une page interactive", "Crée une page HTML interactive : "]];

/** Composer d'un nouvel échange : crée la conversation au premier envoi (aucun projet requis en Chat). */
export function NewConversationComposer({ mode, projectId, title, subtitle, suggestions = false, onCreated, disabledReason, placeholder }: { mode: Mode; projectId?: string; title: string; subtitle?: string; suggestions?: boolean; onCreated: (id: string) => void; disabledReason?: string; placeholder?: string }) {
  const [cfg, setCfg, ready] = useDefaultConfig(mode); const [text, setText] = useState(""); const [style, setStyle] = useState<string | null>(null); const [web, setWeb] = useState(false); const [gen, setGen] = useState(false); const [kb, setKb] = useState<string | null>(null); const [attach, setAttach] = useState<Attach[]>([]); const af = useAttachFlow(setAttach); const [imgs, setImgs] = useState<{ name: string; mime: string; data: string }[]>([]); const im = useImageInput(setImgs); const [busy, setBusy] = useState(false); const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ta.current?.focus(); }, []);
  useEffect(() => { const t = ta.current; if (t) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 260) + "px"; } }, [text]);
  const go = async () => {
    if (!text.trim() || busy || disabledReason) return; setBusy(true);
    try { const id = await api("conv.create", { web, image: gen && cfg.provider === "codex", style, mode, submode: mode === "code" ? "direct" : undefined, provider: cfg.provider, model: cfg.model, effort: cfg.effort, projectId: mode === "code" ? projectId : undefined }); if (kb) await api("conv.setKb", id, kb); onCreated(id); const r = await api("conv.send", id, text.trim(), cfg, attach, imgs); if (r.notice) toast(r.notice, "info"); setText(""); setAttach([]); setImgs([]); }
    catch (e: any) { toast(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "error"); } finally { setBusy(false); }
  };
  return <div className="flex-1 flex flex-col items-center justify-center px-6 pb-10 min-h-0 overflow-auto">{af.element}
    <div className="w-full max-w-[720px] anim-page"><h1 className="text-[34px] leading-tight text-center mb-6 flex items-center justify-center gap-3"><Asterisk size={30} strokeWidth={2.4} className="text-accent shrink-0" aria-hidden />{title}</h1>{subtitle && <p className="text-fg2 text-center mb-8">{subtitle}</p>}
      <LimitBanner provider={cfg.provider} onSwitch={(p) => setCfg({ provider: p, model: null, effort: null })} />
      {disabledReason && <p role="alert" className="text-center text-warning text-[13px] mb-4">{disabledReason}</p>}
      <Composer value={text} onChange={setText} onSend={go} busy={false} sending={busy} placeholder={placeholder} mode={mode} cfg={cfg} onCfg={setCfg} rows={3} autoFocus canAttach
        attachments={attach} images={imgs}
        onAttach={() => void af.add()} styleValue={style} onStyle={setStyle} webValue={web} onWeb={setWeb} genValue={gen} onGen={setGen} kbValue={kb} onKb={setKb} onPasteImages={(f) => void im.paste(f)} onCapture={() => void im.capture()} onDropFiles={(files) => void af.drop(files, async (paths) => { try { const f = await api("doc.images", paths); if (f?.length) setImgs((i) => [...i, ...f].slice(0, 4)); } catch (e: any) { toast(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "error"); } })}
        onImage={async () => { try { const f = await api("dialog.images"); if (f?.length) setImgs([...imgs, ...f].slice(0, 4)); } catch (e: any) { toast(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "error"); } }}
        onRemoveAttach={(i) => setAttach(attach.filter((_, j) => j !== i))} onRemoveImage={(i) => setImgs(imgs.filter((_, j) => j !== i))} />
      {suggestions && <div className="grid grid-cols-2 gap-2 mt-5">{SUGGESTIONS.map(([I, l, p]) => <button key={l} className="card lift p-3 text-left flex items-center gap-3 cursor-pointer" onClick={() => { setText(p); ta.current?.focus(); }}><I size={16} className="text-muted shrink-0" /><span className="text-[13px]">{l}</span></button>)}</div>}
      {mode === "chat" && <p className="text-xs text-muted text-center mt-6">Chat simple : aucune commande, aucun fichier, aucun projet requis. Moteur {PROVIDER_LABEL[cfg.provider]} en conversation seule (ce n'est pas le Chat natif {cfg.provider === "claude" ? "claude.ai" : "ChatGPT"}).</p>}</div></div>;
}

export default function Chat() {
  const [sp, setSp] = useSearchParams(); const [sel, setSel] = useState<string | undefined>(sp.get("open") ?? undefined); const [bump, setBump] = useState(0);
  const { data: cl } = useData<any>("ai.catalog", ["claude"]); const { data: cx } = useData<any>("ai.catalog", ["codex"]);
  useEffect(() => { const o = sp.get("open"); if (o) { setSel(o); sp.delete("open"); setSp(sp, { replace: true }); } if (sp.get("new")) { setSel(undefined); sp.delete("new"); setSp(sp, { replace: true }); } }, [sp]);
  const none = cl && cx && !cl.available && !cx.available;
  return <div className="h-full flex min-h-0 anim-page">
    <ConversationList key={bump} mode="chat" selected={sel} onSelect={setSel} onNew={() => setSel(undefined)} emptyHint="Vos conversations apparaîtront ici." />
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      {none ? <div className="p-8"><ErrorState message={`Aucun fournisseur n'est utilisable. Claude Code : ${cl.reason} Codex : ${cx.reason}`} hint="Vérifiez les connexions dans Abonnements et quotas." /></div>
        : sel ? <ConversationView key={sel} id={sel} mode="chat" onChanged={() => setBump((b) => b)} onDeleted={() => { setSel(undefined); setBump((b) => b + 1); }} />
        : <NewConversationComposer mode="chat" title="Comment puis-je vous aider ?" suggestions onCreated={(id) => { setSel(id); setBump((b) => b + 1); }} />}</div></div>;
}
