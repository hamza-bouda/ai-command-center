import { useEffect, useState } from "react";
import { api } from "../api";
import { Md } from "./Sessions";
import { RichScope } from "../components/RichBlocks";

/**
 * Vue d'export d'une conversation (HTML autonome, PDF) : rendue dans une fenêtre cachée par le processus principal,
 * en thème clair, sans barre latérale ni actions. `body[data-ready="1"]` signale que les graphiques et diagrammes sont dessinés.
 */
export default function ExportView({ id }: { id: string }) {
  const [conv, setConv] = useState<any>(null); const [msgs, setMsgs] = useState<any[] | null>(null); const [err, setErr] = useState("");
  useEffect(() => { document.documentElement.dataset.theme = "light"; window.dispatchEvent(new Event("acc-theme")); }, []);
  useEffect(() => { Promise.all([api("conv.get", id), api("conv.messages", id)]).then(([c, m]) => { setConv(c); setMsgs(m); }).catch((e) => setErr(String(e?.message ?? e))); }, [id]);
  useEffect(() => {
    if (!msgs) return; let calm = 0; let tries = 0;
    const t = setInterval(() => { tries++; const pending = document.querySelectorAll('[role="status"], .animate-spin').length; calm = pending ? 0 : calm + 1; if (calm >= 3 || tries > 60) { clearInterval(t); document.body.dataset.ready = "1"; } }, 250);
    return () => clearInterval(t);
  }, [msgs]);
  if (err) { document.body.dataset.ready = "1"; return <p className="p-8 text-danger">{err}</p>; }
  if (!conv || !msgs) return <p className="p-8 text-muted">Préparation…</p>;
  return <article className="export-doc mx-auto max-w-[780px] px-8 py-10 text-fg" style={{ background: "var(--background)" }}>
    <header className="mb-8 pb-4 border-b border-line"><h1 className="font-display text-[30px] leading-tight mb-1">{conv.title}</h1>
      <p className="text-xs text-muted">{conv.mode === "chat" ? "Chat" : conv.mode === "work" ? "Work" : "Code"} · {conv.provider === "codex" ? "Codex" : "Claude"}{conv.model ? ` · ${conv.model}` : ""} · exporté le {new Date().toLocaleDateString("fr-FR")}</p></header>
    {msgs.map((m) => m.role === "user"
      ? <div key={m.id} className="flex justify-end mb-5"><div className="max-w-[85%] bg-raised border border-line rounded-2xl rounded-br-md px-4 py-2.5 text-[14px] whitespace-pre-wrap break-words">{m.content}</div></div>
      : <section key={m.id} className="mb-8 min-w-0">{m.status === "failed" || m.status === "cancelled" ? <p className="text-[13px] text-danger">{m.content}</p> : <RichScope.Provider value={{ scope: m.id, streaming: false, still: true }}><Md text={String(m.content)} /></RichScope.Provider>}</section>)}
    <footer className="mt-10 pt-3 border-t border-line text-2xs text-muted">Exporté depuis AI Command Center. Les aperçus HTML interactifs ne sont pas inclus dans cet export.</footer>
  </article>;
}
