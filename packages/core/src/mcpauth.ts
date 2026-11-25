import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { findExe, killTree } from "./providers/common.js";
import { terminalEnv, loadPty } from "./terminal.js";
import type { ProviderId } from "./types.js";

/**
 * Connexion OAuth d'un serveur MCP distant : l'application ne fait JAMAIS l'OAuth elle-même.
 * Elle lance la commande de connexion officielle de chaque CLI (`claude mcp login`, `codex mcp login`), qui ouvre la page web
 * d'authentification ; le jeton est enregistré par le CLI lui-même et n'est jamais lu par l'application.
 */
export const MCP_NAME = /^[a-z0-9_-]{1,40}$/;
export const MCP_URL = /^https:\/\/[^\s"'`$;&|<>\\]{4,300}$/;
export interface ConnectResult { ok: boolean; provider: ProviderId; message: string; needsClient?: boolean; url?: string }
export interface McpAuthStatus { provider: ProviderId; state: "connected" | "needs_auth" | "failed" | "unknown" | "absent"; detail?: string }

const NO_DCR = /dynamic client registration|Registration failed|Incompatible auth server/i;
const active = new Map<string, ChildProcess>();

/** Lecture d'état d'un serveur côté Claude (`claude mcp get`) : jamais de jeton, seulement l'état affiché par le CLI. */
export function claudeStatus(name: string, dir: string, exclusive = true): McpAuthStatus {
  const exe = findExe("claude"); if (!exe) return { provider: "claude", state: "absent", detail: "Claude Code n'est pas détecté." };
  mkdirSync(dir, { recursive: true }); const r = run(exe, ["mcp", "get", name], dir, exclusive, 40000);
  const t = `${r.out}\n${r.err}`; if (/No MCP server (named|found)/i.test(t)) return { provider: "claude", state: "unknown", detail: "Pas encore enregistré côté Claude." };
  if (/Connected/i.test(t) && !/Failed|Needs auth/i.test(t)) return { provider: "claude", state: "connected" }; if (/Needs auth/i.test(t)) return { provider: "claude", state: "needs_auth" };
  const issue = /Issue:\s*(.+)/.exec(t)?.[1]; return { provider: "claude", state: "failed", detail: issue ?? t.slice(0, 200) };
}
function run(exe: string, args: string[], cwd: string, exclusive: boolean, timeout: number, extraEnv: Record<string, string> = {}) {
  const r = spawnSync(exe, args, { cwd, env: { ...terminalEnv(exclusive), ...extraEnv }, encoding: "utf8", timeout, windowsHide: true });
  return { ok: r.status === 0, out: String(r.stdout ?? ""), err: String(r.stderr ?? "") };
}

export interface ConnectOpts { provider: ProviderId; name: string; url: string; dir: string; exclusive?: boolean; clientId?: string; clientSecret?: string; callbackPort?: number; timeoutMs?: number; onUrl?: (u: string) => void }
/** Lance la connexion officielle ; attend la fin (l'utilisateur autorise dans le navigateur). Annulable avec cancelConnect. */
export async function connectMcp(o: ConnectOpts): Promise<ConnectResult> {
  const { provider, name, url } = o; if (!MCP_NAME.test(name)) return { ok: false, provider, message: "Nom de serveur invalide (minuscules, chiffres, - et _)." }; if (!MCP_URL.test(url)) return { ok: false, provider, message: "L'adresse doit être en https." };
  if (o.callbackPort !== undefined && !(Number.isInteger(o.callbackPort) && o.callbackPort >= 1024 && o.callbackPort <= 65535)) return { ok: false, provider, message: "Port de retour invalide (1024 à 65535)." };
  if (o.clientId !== undefined && !/^[\w.\-:@]{1,200}$/.test(o.clientId)) return { ok: false, provider, message: "Identifiant client invalide." };
  const exclusive = o.exclusive !== false; const exe = findExe(provider); if (!exe) return { ok: false, provider, message: `${provider === "claude" ? "Claude Code" : "Codex"} n'est pas détecté sur cet ordinateur.` };
  mkdirSync(o.dir, { recursive: true }); const key = `${provider}:${name}`; if (active.has(key)) return { ok: false, provider, message: "Une connexion est déjà en cours pour ce serveur." };
  let args: string[]; const env: Record<string, string> = {};
  if (provider === "claude") {
    // 1) le serveur doit être connu de Claude (portée « local » limitée au dossier de l'application : aucun de vos projets n'est modifié)
    const st = claudeStatus(name, o.dir, exclusive);
    if (st.state === "unknown") { const add = ["mcp", "add", "--scope", "local", "--transport", "http", name, url]; if (o.clientId) add.push("--client-id", o.clientId); if (o.callbackPort) add.push("--callback-port", String(o.callbackPort)); if (o.clientSecret) { add.push("--client-secret"); env.MCP_CLIENT_SECRET = o.clientSecret; }
      const r = run(exe, add, o.dir, exclusive, 40000, env); if (!r.ok) return { ok: false, provider, message: `Enregistrement côté Claude impossible : ${(r.err || r.out).trim().slice(0, 240)}` }; }
    args = ["mcp", "login", name];
  } else {
    args = ["mcp", "login", "-c", `mcp_servers.${name}.url="${url}"`, name];
  }
  if (provider === "claude") return await connectViaPty(exe, args, o, env, key, exclusive);
  return await new Promise<ConnectResult>((resolve) => {
    const child = spawn(exe, args, { cwd: o.dir, env: { ...terminalEnv(exclusive), ...env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); active.set(key, child); let out = ""; let cancelled = false; (child as any).__cancel = () => { cancelled = true; };
    const grab = (d: Buffer) => { const s = String(d); out += s; const m = /https:\/\/[^\s"'<>]+/.exec(s); if (m && o.onUrl) o.onUrl(m[0]); }; child.stdout?.on("data", grab); child.stderr?.on("data", grab);
    const timer = setTimeout(() => { cancelled = true; killTree(child); }, o.timeoutMs ?? 5 * 60_000);
    child.on("error", (e) => { clearTimeout(timer); active.delete(key); resolve({ ok: false, provider, message: `Lancement impossible : ${e.message}` }); });
    child.on("close", (code) => { clearTimeout(timer); active.delete(key); const text = out.replace(/\x1b\[[0-9;]*m/g, "").trim(); const url0 = /https:\/\/[^\s"'<>]+/.exec(text)?.[0];
      if (cancelled) return resolve({ ok: false, provider, message: "Connexion annulée ou délai dépassé (5 minutes).", url: url0 });
      if (code === 0) { return resolve({ ok: true, provider, message: "Connexion terminée (Codex conserve le jeton lui-même)." }); }
      resolve({ ok: false, provider, needsClient: NO_DCR.test(text), message: NO_DCR.test(text) ? "Ce serveur n'accepte pas l'enregistrement automatique d'une application : il demande un identifiant client préenregistré." : (text.split(/\r?\n/).filter(Boolean).slice(-3).join(" ") || `Échec (code ${code}).`).slice(0, 300), url: url0 }); });
  });
}
/** `claude mcp login` exige un terminal interactif : on le lance dans un pseudo-terminal (rien n'est saisi à votre place ; la page web s'ouvre). */
const ptys = new Map<string, { cancel: () => void }>();
const clean = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "");
async function connectViaPty(exe: string, args: string[], o: ConnectOpts, env: Record<string, string>, key: string, exclusive: boolean): Promise<ConnectResult> {
  const { provider, name } = o; const pty = loadPty().spawn(exe, args, { name: "xterm-256color", cols: 400, rows: 30, cwd: o.dir, env: { ...terminalEnv(exclusive), ...env } as any });
  return await new Promise<ConnectResult>((resolve) => {
    let out = ""; let cancelled = false; let opened = false;
    const kill = () => { try { pty.kill(); } catch { /* déjà terminé */ } };
    const finish = (r: ConnectResult) => { clearTimeout(timer); ptys.delete(key); resolve(r); };
    const timer = setTimeout(() => { cancelled = true; kill(); }, o.timeoutMs ?? 5 * 60_000);
    ptys.set(key, { cancel: () => { cancelled = true; kill(); } });
    pty.onData((d: string) => { out += d; if (opened) return; const m = /https:\/\/[^\s"'<>]+/.exec(clean(out)); if (m && m[0].includes("state=")) { opened = true; o.onUrl?.(m[0]); } });
    pty.onExit((e: { exitCode: number }) => {
      const text = clean(out).trim(); const url0 = /https:\/\/[^\s"'<>]+/.exec(text)?.[0];
      if (cancelled) return finish({ ok: false, provider, message: "Connexion annulée ou délai dépassé (5 minutes).", url: url0 });
      const s = claudeStatus(name, o.dir, exclusive);
      if (e.exitCode === 0 || s.state === "connected") return finish({ ok: s.state === "connected", provider, message: s.state === "connected" ? "Connecté." : `Connexion terminée mais l'état reste « ${s.state} »${s.detail ? " : " + s.detail : ""}.`, needsClient: NO_DCR.test(s.detail ?? "") });
      const lastLines = text.split("\n").filter(Boolean).slice(-3).join(" ");
      finish({ ok: false, provider, needsClient: NO_DCR.test(text), message: NO_DCR.test(text) ? "Ce serveur n'accepte pas l'enregistrement automatique d'une application : il demande un identifiant client préenregistré." : (lastLines || `Échec (code ${e.exitCode}).`).slice(0, 300), url: url0 });
    });
  });
}
export function cancelConnect(provider: ProviderId, name: string): boolean { const pp = ptys.get(`${provider}:${name}`); if (pp) { pp.cancel(); return true; } const c = active.get(`${provider}:${name}`); if (!c) return false; (c as any).__cancel?.(); killTree(c); return true; }
