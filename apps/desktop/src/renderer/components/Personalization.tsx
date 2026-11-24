import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Check } from "lucide-react";
import { api } from "../api"; import { useData } from "../hooks"; import { toast, confirmDialog } from "../overlay"; import { Card, Modal, Field } from "../ui";

const errMsg = (e: any) => String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
interface Style { id: string; name: string; prompt: string; builtin?: boolean }
const tok = (n: number) => Math.round(n / 4);

/** Sélecteur de style de réponse (dans la fenêtre du modèle du composer). `value` null = style par défaut des Paramètres. */
export function StyleSelect({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const { data: styles } = useData<Style[]>("style.list", [], { events: /settings/ }); const { data: prof } = useData<any>("profile.get", []);
  const def = styles?.find((s) => s.id === prof?.defaultStyle);
  return <div className="mt-3 pt-3 border-t border-line"><label className="label" htmlFor="style-select">Style de réponse</label>
    <select id="style-select" className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}><option value="">{def ? `Par défaut (${def.name})` : "Par défaut (aucun style)"}</option>{styles?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
    <p className="text-2xs text-muted mt-1.5">Ajoute une courte consigne à chaque message de cette conversation. Se gère dans Paramètres › Personnalisation.</p></div>;
}

/** Paramètres › Personnalisation : ce que l'IA doit savoir de vous, comment répondre, styles. */
/** Souvenirs retenus à la demande de l'utilisateur : visibles, supprimables, désactivables ; leur coût en tokens est affiché. */
function MemoryCard() {
  const { data, reload } = useData<any>("memory.list", []); const [text, setText] = useState(""); const items: { id: string; text: string }[] = data?.items ?? [];
  const add = async () => { try { await api("memory.add", text); setText(""); reload(); } catch (e: any) { toast(errMsg(e), "error"); } };
  return <Card title="Mémoire" sub="Ce que l'IA a retenu de vous, uniquement avec votre accord" className="mb-4">
    <label className="flex items-center gap-2.5 text-[13px] mb-3 cursor-pointer"><input type="checkbox" className="w-4 h-4 accent-[var(--accent)]" checked={data?.enabled !== false} onChange={async (e) => { await api("memory.setEnabled", e.target.checked); reload(); }} />Utiliser la mémoire (et laisser l'IA proposer des souvenirs)</label>
    {items.length === 0 ? <p className="text-xs text-muted mb-3">Aucun souvenir. L'IA peut en proposer pendant une conversation : rien n'est enregistré sans votre clic sur « Retenir ».</p>
      : <ul className="divide-y divide-line mb-3">{items.map((m) => <li key={m.id} className="py-2 flex items-start gap-3"><span className="text-[13px] flex-1 min-w-0">{m.text}</span><button className="btn btn-ghost btn-icon !h-7 !w-7" aria-label={`Oublier : ${m.text.slice(0, 40)}`} onClick={async () => { await api("memory.remove", m.id); reload(); }}><Trash2 size={13} /></button></li>)}</ul>}
    <div className="flex gap-2"><input className="input" maxLength={280} placeholder="Ajouter un souvenir à la main" aria-label="Nouveau souvenir" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && text.trim().length >= 3) void add(); }} /><button className="btn" disabled={text.trim().length < 3} onClick={() => void add()}><Plus size={14} />Ajouter</button></div>
    <p className="text-xs text-muted mt-2 tnum">{items.length} souvenir(s) · ≈ {data?.tokens ?? 0} tokens ajoutés à chaque message{items.length > 0 && <> · <button className="text-accent hover:underline" onClick={async () => { if (await confirmDialog({ title: "Tout oublier ?", body: "Tous les souvenirs seront supprimés.", confirmLabel: "Tout oublier", danger: true })) { await api("memory.clear"); reload(); } }}>Tout oublier</button></>}</p></Card>;
}
export function PersonalizationTab() {
  const { data: prof, reload } = useData<any>("profile.get", []); const { data: styles, reload: rs } = useData<Style[]>("style.list", []);
  const [about, setAbout] = useState(""); const [howto, setHowto] = useState(""); const [dirty, setDirty] = useState(false); const [edit, setEdit] = useState<Style | null>(null); const [isNew, setIsNew] = useState(false); const [err, setErr] = useState("");
  useEffect(() => { if (prof && !dirty) { setAbout(prof.about); setHowto(prof.howto); } }, [prof, dirty]);
  const custom = (styles ?? []).filter((s) => !s.builtin); const styleLen = styles?.find((s) => s.id === prof?.defaultStyle)?.prompt.length ?? 0; const cost = about.length + howto.length + styleLen === 0 ? 0 : tok(about.length + howto.length + styleLen) + 25; // + titres de section
  const save = async () => { try { await api("profile.save", { about, howto }); setDirty(false); reload(); toast("Préférences enregistrées.", "success"); } catch (e: any) { toast(errMsg(e), "error"); } };
  const saveStyles = async (list: Style[]) => { await api("style.saveCustom", list.map((s) => ({ id: s.id, name: s.name, prompt: s.prompt }))); rs(); reload(); };
  const submit = async () => { if (!edit) return; setErr(""); try { await saveStyles(isNew ? [...custom, edit] : custom.map((s) => (s.id === edit.id ? edit : s))); setEdit(null); toast("Style enregistré.", "success"); } catch (e: any) { setErr(errMsg(e)); } };
  return <div className="max-w-3xl">
    <Card title="Ce que l'IA doit savoir de vous" className="mb-4"><Field label="À propos de vous" hint="Métier, projets, langue préférée… Ajouté à chaque message, dans tous les modes."><textarea className="input" rows={3} maxLength={1000} value={about} onChange={(e) => { setAbout(e.target.value); setDirty(true); }} placeholder="Ex. Je suis développeuse web, je travaille surtout en TypeScript." /></Field>
      <Field label="Manière de répondre" hint="Consignes générales : longueur, format, ton…"><textarea className="input" rows={3} maxLength={1000} value={howto} onChange={(e) => { setHowto(e.target.value); setDirty(true); }} placeholder="Ex. Réponds en français, avec des exemples de code commentés." /></Field>
      <div className="flex items-center gap-3 flex-wrap"><button className="btn btn-primary" disabled={!dirty} onClick={save}>Enregistrer</button><span className="text-xs text-muted tnum">{about.length + howto.length} caractères · ≈ {cost} tokens ajoutés à chaque message{cost === 0 ? " (rien n'est ajouté tant que ces champs sont vides)" : ""}</span></div></Card>
    <MemoryCard />
    <Card title="Style par défaut" className="mb-4"><select className="input !w-64" aria-label="Style par défaut" value={prof?.defaultStyle ?? ""} onChange={async (e) => { try { await api("profile.save", { defaultStyle: e.target.value }); reload(); toast("Style par défaut enregistré.", "success"); } catch (x: any) { toast(errMsg(x), "error"); } }}><option value="">Aucun style</option>{styles?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <p className="text-xs text-muted mt-2">Appliqué aux nouvelles conversations. Chaque conversation peut choisir le sien depuis la fenêtre du modèle (sous la zone de saisie).</p></Card>
    <Card title="Styles" className="mb-4">
      <ul className="divide-y divide-line">{styles?.map((s) => <li key={s.id} className="py-2.5 flex items-start gap-3"><div className="min-w-0 flex-1"><div className="text-[13px] font-medium flex items-center gap-2">{s.name}{s.builtin && <span className="text-2xs text-muted border border-line rounded px-1.5">fourni</span>}{prof?.defaultStyle === s.id && <Check size={13} className="text-accent" aria-label="Style par défaut" />}</div><div className="text-xs text-muted mt-0.5">{s.prompt}</div></div>
        {!s.builtin && <><button className="btn btn-ghost btn-icon !h-7 !w-7" aria-label={`Modifier ${s.name}`} onClick={() => { setEdit(s); setIsNew(false); setErr(""); }}><Pencil size={13} /></button><button className="btn btn-ghost btn-icon !h-7 !w-7" aria-label={`Supprimer ${s.name}`} onClick={async () => { if (await confirmDialog({ title: `Supprimer le style « ${s.name} » ?`, body: "Les conversations qui l'utilisent reviendront au style par défaut.", confirmLabel: "Supprimer", danger: true })) { await saveStyles(custom.filter((x) => x.id !== s.id)); } }}><Trash2 size={13} /></button></>}</li>)}</ul>
      <button className="btn mt-3" disabled={custom.length >= 12} onClick={() => { setEdit({ id: "", name: "", prompt: "" }); setIsNew(true); setErr(""); }}><Plus size={14} />Nouveau style</button></Card>
    <Modal open={!!edit} onClose={() => setEdit(null)} title={isNew ? "Nouveau style" : "Modifier le style"} footer={<><button className="btn" onClick={() => setEdit(null)}>Annuler</button><button className="btn btn-primary" disabled={!edit?.name.trim() || !edit?.prompt.trim()} onClick={submit}>Enregistrer</button></>}>
      <Field label="Nom"><input className="input" maxLength={40} value={edit?.name ?? ""} onChange={(e) => setEdit(edit && { ...edit, name: e.target.value })} placeholder="Ex. Relecteur strict" /></Field>
      <Field label="Consigne" hint="Une ou deux phrases : elles sont ajoutées à chaque message."><textarea className="input" rows={4} maxLength={600} value={edit?.prompt ?? ""} onChange={(e) => setEdit(edit && { ...edit, prompt: e.target.value })} placeholder="Ex. Relis le texte comme un éditeur exigeant et liste les défauts avant de proposer une version corrigée." /></Field>
      {err && <p role="alert" className="text-danger text-[13px]">{err}</p>}</Modal></div>;
}
