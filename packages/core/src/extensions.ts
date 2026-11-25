import { spawn } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { DB, all, one, run, uid, now } from "./db.js";
import { terminalEnv } from "./terminal.js";
import { getSetting } from "./settings.js";
import type { ExperienceMode } from "./policies.js";

export type ExtKind = "mcp" | "skill";
export interface McpConfig { transport: "stdio" | "http"; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string> }
export interface SkillConfig { description: string; body: string }
export interface McpSpec { name: string; transport: "stdio" | "http"; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string> }
export interface ResolvedExtensions { mcp: McpSpec[]; skills: { name: string; description: string; body: string }[]; skillsText: string }

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const MODES: ExperienceMode[] = ["chat", "work", "code"];
export const SKILLS_MAX_CHARS = 8000;

/** Frontmatter YAML minimal d'un SKILL.md (name, description) + corps. */
export function parseSkillMd(text: string): { name?: string; description?: string; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text); if (!m) return { body: text.trim() };
  const g = (k: string) => new RegExp(`^${k}:\\s*(.+)$`, "m").exec(m[1]!)?.[1]?.trim().replace(/^["']|["']$/g, "");
  return { name: g("name"), description: g("description"), body: m[2]!.trim() };
}

/** Registre d'extensions de l'application : serveurs MCP et skills ajoutés par l'utilisateur, activés par mode (Chat, Work, Code) puis par conversation. */
export class Extensions {
  constructor(private db: DB) {}
  private row(r: any) { const cfg = JSON.parse(r.config); if (r.kind === "mcp") { cfg.envKeys = Object.keys(cfg.env ?? {}); delete cfg.env; cfg.headerKeys = Object.keys(cfg.headers ?? {}); delete cfg.headers; } return { ...r, config: cfg, modes: JSON.parse(r.modes) as ExperienceMode[], enabled: !!r.enabled }; }
  /** Liste pour l'interface : jamais les valeurs d'environnement ni les en-têtes (secrets). */
  list(kind?: ExtKind) { return all<any>(this.db, `SELECT * FROM extensions ${kind ? "WHERE kind=?" : ""} ORDER BY kind, name`, ...(kind ? [kind] : [])).map((r) => this.row(r)); }
  private checkName(name: string, kind: ExtKind, exceptId?: string) { if (!NAME_RE.test(name)) throw new Error("Nom invalide : minuscules, chiffres, - et _ (40 caractères max)."); const ex = one<any>(this.db, "SELECT id FROM extensions WHERE kind=? AND name=?", kind, name); if (ex && ex.id !== exceptId) throw new Error(`Une extension « ${name} » existe déjà.`); }
  private modes(m?: ExperienceMode[]) { const v = (m ?? ["code"]).filter((x) => MODES.includes(x)); return JSON.stringify([...new Set(v)]); }

  addMcp(a: { name: string; config: McpConfig; modes?: ExperienceMode[] }): string {
    const name = a.name.trim().toLowerCase(); this.checkName(name, "mcp"); const c = a.config;
    if (c.transport === "stdio") { if (!c.command?.trim()) throw new Error("Commande requise pour un serveur stdio."); }
    else if (c.transport === "http") { if (!/^https?:\/\//.test(c.url ?? "")) throw new Error("URL http(s) requise."); } else throw new Error("Transport inconnu.");
    const id = uid(); run(this.db, "INSERT INTO extensions (id,kind,name,config,modes,enabled,created_at) VALUES (?,?,?,?,?,?,?)", id, "mcp", name, JSON.stringify({ transport: c.transport, command: c.command?.trim(), args: (c.args ?? []).map(String), env: c.env ?? {}, url: c.url?.trim(), headers: c.headers ?? {} }), this.modes(a.modes), 1, now());
    run(this.db, "INSERT INTO audit_events (id,type,payload,at) VALUES (?,?,?,?)", uid(), "extension.added", JSON.stringify({ kind: "mcp", name, transport: c.transport, modes: JSON.parse(this.modes(a.modes)) }), now()); return id;
  }
  addSkill(a: { name: string; description: string; body: string; modes?: ExperienceMode[] }): string {
    const name = a.name.trim().toLowerCase(); this.checkName(name, "skill"); if (!a.body.trim()) throw new Error("Les instructions de la skill sont vides."); if (a.body.length > 20000) throw new Error("Instructions trop longues (20 000 caractères max).");
    const id = uid(); run(this.db, "INSERT INTO extensions (id,kind,name,config,modes,enabled,created_at) VALUES (?,?,?,?,?,?,?)", id, "skill", name, JSON.stringify({ description: (a.description ?? "").trim().slice(0, 300), body: a.body.trim() }), this.modes(a.modes), 1, now());
    run(this.db, "INSERT INTO audit_events (id,type,payload,at) VALUES (?,?,?,?)", uid(), "extension.added", JSON.stringify({ kind: "skill", name }), now()); return id;
  }
  /** Importe une skill depuis un dossier contenant SKILL.md (ou depuis le fichier SKILL.md lui-même). */
  importSkill(path: string, modes?: ExperienceMode[]): string {
    const file = existsSync(path) && statSync(path).isDirectory() ? join(path, "SKILL.md") : path; if (!existsSync(file)) throw new Error("SKILL.md introuvable.");
    const p = parseSkillMd(readFileSync(file, "utf8")); const base = basename(existsSync(path) && statSync(path).isDirectory() ? path : join(path, ".."));
    const name = (p.name ?? base).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "skill"; return this.addSkill({ name, description: p.description ?? "", body: p.body, modes });
  }
  setModes(id: string, modes: ExperienceMode[]) { run(this.db, "UPDATE extensions SET modes=? WHERE id=?", this.modes(modes), id); }
  setEnabled(id: string, v: boolean) { run(this.db, "UPDATE extensions SET enabled=? WHERE id=?", v ? 1 : 0, id); }
  remove(id: string) { run(this.db, "DELETE FROM extensions WHERE id=?", id); }

  /** Extensions applicables à une exécution : activées pour le mode, hors celles désactivées pour cette conversation. */
  resolve(mode: ExperienceMode, disabled: string[] = []): ResolvedExtensions {
    const mcp: McpSpec[] = []; const skills: ResolvedExtensions["skills"] = [];
    for (const r of all<any>(this.db, "SELECT * FROM extensions WHERE enabled=1 ORDER BY kind, name")) { if (!JSON.parse(r.modes).includes(mode) || disabled.includes(r.id)) continue; const c = JSON.parse(r.config);
      if (r.kind === "mcp") mcp.push({ name: r.name, ...c }); else skills.push({ name: r.name, description: c.description, body: c.body }); }
    let text = ""; for (const s of skills) { const block = `### Skill « ${s.name} »${s.description ? ` — ${s.description}` : ""}\n${s.body}\n\n`; if ((text + block).length > SKILLS_MAX_CHARS) break; text += block; }
    return { mcp, skills, skillsText: text ? `[Skills activées — applique-les quand elles sont pertinentes]\n${text.trim()}` : "" };
  }

  /** Teste réellement un serveur : handshake MCP (initialize) puis liste des outils. stdio : lancement du processus ; http : requête d'initialisation. */
  async test(cfg: McpConfig): Promise<{ ok: boolean; tools: { name: string; description?: string }[]; error?: string; ms: number }> {
    const t0 = Date.now(); const fail = (error: string) => ({ ok: false, tools: [], error, ms: Date.now() - t0 });
    const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "ai-command-center", version: "0.1.0" } } };
    if (cfg.transport === "http") {
      try { const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 10000); const r = await fetch(cfg.url!, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(cfg.headers ?? {}) }, body: JSON.stringify(INIT), signal: ctl.signal }); clearTimeout(to);
        if (r.status === 401 || r.status === 403) return fail(`Authentification requise (HTTP ${r.status}) : ce serveur utilise probablement une connexion en ligne (OAuth). Connectez-le avec la commande officielle affichée sur sa carte (« Ce serveur demande une connexion en ligne »), puis relancez le test. Si le serveur attend une clé, ajoutez-la dans ses en-têtes (ex. Authorization).`); if (!r.ok) return fail(`Réponse HTTP ${r.status}.`); return { ok: true, tools: [], ms: Date.now() - t0 }; } catch (e: any) { return fail(e.name === "AbortError" ? "Délai dépassé (10 s)." : String(e.message)); }
    }
    if (!cfg.command?.trim()) return fail("Commande manquante.");
    return await new Promise((res) => {
      const env = { ...terminalEnv(!!getSetting(this.db, "billing.exclusive", true)), ...(cfg.env ?? {}) }; let child; try { child = spawn(cfg.command!, cfg.args ?? [], { env, windowsHide: true, shell: process.platform === "win32" && !/\.exe$/i.test(cfg.command!) }); } catch (e: any) { return res(fail(String(e.message))); }
      let buf = ""; let done = false; let stderr = ""; const finish = (r: any) => { if (done) return; done = true; clearTimeout(timer); try { child.kill(); } catch { /* déjà arrêté */ } res(r); };
      const timer = setTimeout(() => finish(fail("Délai dépassé (15 s) : le serveur n'a pas répondu au handshake MCP." + (stderr ? ` ${stderr.slice(0, 160)}` : ""))), 15000);
      const send = (o: any) => child.stdin.write(JSON.stringify(o) + "\n");
      child.stderr.on("data", (d) => (stderr += d)); child.on("error", (e) => finish(fail(String(e.message)))); child.on("close", (c) => finish(fail(`Le processus s'est arrêté (code ${c}). ${stderr.slice(0, 200)}`)));
      child.stdout.on("data", (d) => { buf += d; let n; while ((n = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, n).trim(); buf = buf.slice(n + 1); if (!l) continue; let m: any; try { m = JSON.parse(l); } catch { continue; }
        if (m.id === 1) { if (m.error) return finish(fail(String(m.error.message ?? "initialize refusé"))); send({ jsonrpc: "2.0", method: "notifications/initialized" }); send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }); }
        else if (m.id === 2) finish({ ok: true, tools: (m.result?.tools ?? []).map((t: any) => ({ name: t.name, description: t.description })), ms: Date.now() - t0 }); } });
      send(INIT);
    });
  }
}
