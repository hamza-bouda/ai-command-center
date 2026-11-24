import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { AgentProviderAdapter, RunSink, checkEnv, childEnv, execCapture, findExe, killTree, trunc } from "./common.js";
import type { ModelInfo, ProviderStatus, QuotaStatus, QuotaWindow, RunHandle, RunRequest, Tokens } from "../types.js";

const toTokens = (b: any): Tokens => {
  const cached = b.cachedInputTokens ?? 0, cw = b.cacheWriteInputTokens ?? 0;
  // OpenAI : inputTokens inclut les tokens cachés. On sépare : input = non cachés.
  const input = Math.max(0, (b.inputTokens ?? 0) - cached - cw);
  return { input, output: b.outputTokens ?? 0, cacheRead: cached, cacheWrite: cw, reasoning: b.reasoningOutputTokens ?? 0, total: b.totalTokens ?? 0 };
};
export function parseRateLimits(rl: any): QuotaStatus {
  const r = rl?.rateLimits ?? rl; const windows: QuotaWindow[] = [];
  const add = (label: string, w: any) => w && windows.push({ label, usedPercent: w.usedPercent ?? null, windowMinutes: w.windowDurationMins, resetsAt: w.resetsAt ? new Date(w.resetsAt * 1000).toISOString() : undefined });
  add("Fenêtre 5 h", r?.primary); add("Fenêtre 7 jours", r?.secondary);
  const max = Math.max(0, ...windows.map((w) => w.usedPercent ?? 0));
  const reached = !!r?.rateLimitReachedType || rl?.ordinaryUsageAllowed === false;
  return { provider: "codex", state: reached ? "exhausted" : max >= 85 ? "limited" : "available", windows, checkedAt: new Date().toISOString(), note: r?.planType ? `Plan ${r.planType}` : undefined };
}

class Rpc {
  private id = 0; private pend = new Map<number, { res: (v: any) => void; rej: (e: any) => void }>();
  onNotification: (method: string, params: any) => void = () => {};
  onRequest: (id: number, method: string, params: any) => void = () => {};
  constructor(private write: (s: string) => void) {}
  request(method: string, params?: any, timeoutMs = 60000): Promise<any> {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.pend.delete(id); rej(new Error(`Timeout ${method}`)); }, timeoutMs);
      this.pend.set(id, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
      this.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  notify(method: string, params?: any) { this.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n"); }
  respond(id: number, result: any) { this.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n"); }
  respondError(id: number, message: string) { this.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message } }) + "\n"); }
  handle(j: any) {
    if (j.method && j.id !== undefined) return this.onRequest(j.id, j.method, j.params);
    if (j.method) return this.onNotification(j.method, j.params);
    const p = this.pend.get(j.id); if (!p) return; this.pend.delete(j.id);
    j.error ? p.rej(new Error(j.error.message ?? "rpc error")) : p.res(j.result);
  }
}

/** Réglages passés à `thread/start|resume` : serveurs MCP activés par l'utilisateur et, en Chat, état explicite de la recherche web (« disabled » par défaut : sans cela Codex peut chercher sur le web selon sa configuration locale). */
/** Lecture seule de la fiche de la compétence « imagegen » de Codex : Codex la lit avant de générer une image ; c'est le seul accès autorisé en plus de l'outil d'image. */
export function isImagegenSkillRead(it: any): boolean { const a = it?.commandActions; return Array.isArray(a) && a.length > 0 && a.every((x: any) => x?.type === "read" && /[\\/]\.codex[\\/]skills[\\/]\.system[\\/]imagegen[\\/][^\\/]+$/i.test(String(x.path ?? "")) && !/\.\./.test(String(x.path))); }
export function codexConfig(req: RunRequest): Record<string, unknown> | undefined {
  const cfg: Record<string, unknown> = {};
  if (req.mcp?.length) cfg.mcp_servers = Object.fromEntries(req.mcp.map((m) => [m.name, m.transport === "http" ? { url: m.url, http_headers: m.headers ?? {}, default_tools_approval_mode: "approve" } : { command: m.command, args: m.args ?? [], env: m.env ?? {}, default_tools_approval_mode: "approve" }]));
  if (req.policy === "chat") { cfg.web_search = req.web ? "live" : "disabled"; cfg.features = { image_generation: !!req.image }; }
  return Object.keys(cfg).length ? cfg : undefined;
}
export class CodexAdapter implements AgentProviderAdapter {
  readonly id = "codex" as const;
  private exe?: string;
  constructor(private override?: string) {}
  async detectInstallation(override?: string) { this.exe = findExe("codex", override ?? this.override); return { installed: !!this.exe, path: this.exe }; }
  async getVersion() { if (!this.exe) await this.detectInstallation(); if (!this.exe) return undefined; const r = execCapture(this.exe, ["--version"]); return r.ok ? r.out.replace(/^codex-cli\s*/, "") : undefined; }
  async getAuthStatus(): Promise<ProviderStatus> {
    const base: ProviderStatus = { provider: "codex", installed: false, authenticated: false, authMode: "unavailable", warnings: [], checkedAt: new Date().toISOString() };
    const d = await this.detectInstallation(); if (!d.installed) return base;
    base.installed = true; base.path = d.path; base.version = await this.getVersion();
    const env = checkEnv("codex"); if (!env.ok) base.warnings.push(`Variables API détectées (${env.flagged.join(", ")}) : ignorées en mode abonnement exclusif.`);
    const r = execCapture(d.path!, ["login", "status"], 20000); const txt = (r.out + " " + r.err).trim();
    if (/chatgpt/i.test(txt)) { base.authenticated = true; base.authMode = "subscription"; }
    else if (/api key/i.test(txt)) { base.authenticated = true; base.authMode = "api_key"; base.blockedReason = "Codex est connecté par clé API (facturation à l'usage) : bloqué en mode abonnement exclusif."; }
    else if (/not logged/i.test(txt)) base.authMode = "unavailable";
    else { base.authMode = "unknown"; base.blockedReason = "Statut d'authentification non vérifiable."; }
    // plan / compte via app-server (sans jamais lire auth.json)
    try { const acc = await this.withServer((rpc) => rpc.request("account/read", { refreshToken: false })); base.plan = acc?.account?.planType; base.account = acc?.account?.email; } catch { /* optionnel */ }
    return base;
  }
  private async withServer<T>(fn: (rpc: Rpc) => Promise<T>): Promise<T> {
    const exe = this.exe ?? findExe("codex", this.override); if (!exe) throw new Error("Codex introuvable");
    const child = spawn(exe, ["app-server"], { env: childEnv("codex", true), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const rpc = new Rpc((s) => child.stdin.write(s));
    createInterface({ input: child.stdout }).on("line", (l) => { try { rpc.handle(JSON.parse(l)); } catch {} });
    try {
      await rpc.request("initialize", { clientInfo: { name: "ai-command-center", title: "AI Command Center", version: "0.1.0" }, capabilities: {} }, 20000);
      rpc.notify("initialized");
      return await fn(rpc);
    } finally { const exited = new Promise<void>((r) => child.once("close", () => r())); killTree(child); await Promise.race([exited, new Promise((r) => setTimeout(r, 4000))]); }
  }
  async getSupportedModels(): Promise<ModelInfo[]> {
    try { const r = await this.withServer((rpc) => rpc.request("model/list", {})); return (r.data ?? []).filter((m: any) => !m.hidden).map((m: any): ModelInfo => ({ id: m.model ?? m.id, displayName: m.displayName ?? m.id, isDefault: !!m.isDefault, description: m.description ?? undefined, source: "provider",
      efforts: (m.supportedReasoningEfforts ?? []).map((e: any) => ({ value: e.reasoningEffort, description: e.description })), defaultEffort: m.defaultReasoningEffort ?? undefined, capabilities: (m.inputModalities ?? []).map((x: string) => "entrée " + x) })); }
    catch { return []; }
  }
  getCapabilities() { return { streaming: "supported", resume: "supported", usageTokens: "supported", usageCostReported: "unsupported", quotaWindows: "supported", subAgentUsage: "unknown", approvalsInStructuredMode: "supported", interactiveTerminal: "supported" } as const; }
  async getQuotaStatus(): Promise<QuotaStatus> {
    try { return parseRateLimits(await this.withServer((rpc) => rpc.request("account/rateLimits/read"))); }
    catch (e: any) { return { provider: "codex", state: "unknown", windows: [], note: e.message, checkedAt: new Date().toISOString() }; }
  }
  startSession(req: RunRequest, sink: RunSink, opts: { exclusive: boolean }): RunHandle {
    // Erreur transitoire connue : verrou SQLite de ~/.codex pendant l'arrêt d'un autre app-server → une relance unique.
    let retried = false; let inner = this.startOnce(req, sink, opts, (m) => !retried && /sqlite state runtime/i.test(m) ? ((retried = true), true) : false);
    return { done: (async () => { await inner.done; if (retried) { await new Promise((r) => setTimeout(r, 800)); inner = this.startOnce(req, sink, opts, () => false); await inner.done; } })(), cancel: () => inner.cancel() };
  }
  private startOnce(req: RunRequest, sink: RunSink, opts: { exclusive: boolean }, shouldRetry: (m: string) => boolean): RunHandle {
    const exe = this.exe ?? findExe("codex", this.override); if (!exe) throw new Error("Codex introuvable");
    const child = spawn(exe, ["app-server"], { cwd: req.cwd, env: childEnv("codex", opts.exclusive), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    sink.setPid(child.pid);
    const cancelHook: { fn: () => Promise<void> } = { fn: async () => { cancelled = true; killTree(child); } };
    const rpc = new Rpc((s) => { if (!child.stdin.destroyed) child.stdin.write(s); });
    const mcpState: Record<string, { status: string; error?: string }> = {};
    let threadId = "", turnId = "", model: string | undefined = req.model, finished = false, cancelled = false, lastText = ""; let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    const finish = (ok: boolean, message?: string) => { if (finished) return; if (!ok && message && shouldRetry(message)) { finished = true; return; } finished = true; sink.event({ type: "done", ok, message }); };
    rpc.onNotification = (m, p) => {
      switch (m) {
        case "item/agentMessage/delta": if (p?.delta) sink.event({ type: "text", text: p.delta }); break;
        case "item/started": case "item/completed": {
          const it = p?.item; if (!it) break; const st = m === "item/started" ? "started" : "completed";
          if (it.type === "agentMessage" && st === "completed") lastText = it.text ?? lastText;
          else if (it.type === "commandExecution") sink.event({ type: "tool", id: it.id, name: isImagegenSkillRead(it) ? "imagegen_skill_read" : "shell", summary: trunc(String(it.command ?? "")), state: st === "completed" && (it.exitCode ?? 0) !== 0 ? "failed" : st });
          else if (it.type === "fileChange") { sink.event({ type: "tool", id: it.id, name: "apply_patch", summary: trunc((it.changes ?? []).map((c: any) => c.path).join(", ")), state: st }); if (st === "completed") sink.event({ type: "file_change", paths: (it.changes ?? []).map((c: any) => c.path).filter(Boolean) }); }
          else if (it.type === "mcpToolCall" || it.type === "dynamicToolCall" || it.type === "webSearch") sink.event({ type: "tool", id: it.id, name: it.type === "mcpToolCall" ? `mcp__${it.server}__${it.tool}` : it.tool ?? it.type, summary: trunc(JSON.stringify(it.arguments ?? it.query ?? {})), state: st });
          else if (it.type === "imageGeneration") {
            sink.event({ type: "tool", id: it.id, name: "image_generation", summary: "Génération d'image", state: st === "completed" && it.status === "failed" ? "failed" : st });
            if (st === "completed") { if (it.result && it.status !== "failed" && !it.failure) sink.event({ type: "image", id: it.id, mime: "image/png", data: String(it.result), prompt: it.revisedPrompt ?? undefined }); else sink.event({ type: "error", message: `Génération d'image impossible : ${it.failure ? JSON.stringify(it.failure).slice(0, 200) : "aucune image reçue (le plan ChatGPT n'inclut peut-être pas cette fonction, ou le quota est atteint)"}` }); }
          }
          else if (it.type === "collabAgentToolCall" || it.type === "subAgentActivity") sink.event({ type: "tool", id: it.id, name: "sub-agent", summary: trunc(JSON.stringify(it).slice(0, 200)), state: st });
          break;
        }
        case "thread/tokenUsage/updated": {
          const tu = p.tokenUsage; if (!tu) break;
          const total = toTokens(tu.total);
          sink.event({ type: "usage", report: { model: model ?? "unknown", mode: "cumulative", counterKey: `codex-thread:${p.threadId}`, eventKey: `${p.turnId}:${tu.total.totalTokens}`, confidence: "reported", tokens: total, lastStep: toTokens(tu.last), fresh: !req.resumeSessionId } });
          break;
        }
        case "mcpServer/startupStatus/updated": if (p?.name) { mcpState[p.name] = { status: p.status, error: p.error ?? undefined }; } break;
        case "account/rateLimits/updated": sink.event({ type: "quota", quota: parseRateLimits(p) }); break;
        case "turn/completed": {
          const t = p.turn; if (t.status === "completed") { sink.event({ type: "text", text: lastText, final: true }); finish(true, lastText); }
          else { const msg = t.error?.message ?? (t.status === "interrupted" ? "Interrompu" : "Échec du tour"); sink.event({ type: "error", message: msg, quota: /limit|quota|usage/i.test(msg), auth: /auth|login/i.test(msg) }); finish(false, msg); }
          void shutdown(); break;
        }
        case "error": if (p?.error?.message) sink.event({ type: "status", detail: `erreur: ${p.error.message}` }); break;
      }
    };
    rpc.onRequest = async (id, method, params) => {
      if (/requestApproval/i.test(method)) {
        const summary = trunc(String(params?.command ?? params?.reason ?? JSON.stringify(params ?? {})));
        const ok = await sink.requestApproval(method.includes("fileChange") ? "file_change" : "command", summary);
        rpc.respond(id, { decision: ok ? "accept" : "decline" });
      } else rpc.respondError(id, `Requête serveur non prise en charge: ${method}`);
    };
    const shutdown = async () => { await new Promise((r) => setTimeout(r, 300)); killTree(child); };
    createInterface({ input: child.stdout }).on("line", (l) => { try { rpc.handle(JSON.parse(l)); } catch {} });
    const done = new Promise<void>((resolve) => {
      child.on("close", (code) => { if (!finished) finish(false, cancelled ? "Annulé" : `app-server arrêté (code ${code}). ${trunc(stderr, 300)}`); resolve(); });
      child.on("error", (e) => { sink.event({ type: "error", message: e.message }); finish(false, e.message); resolve(); });
    });
    (async () => {
      try {
        await rpc.request("initialize", { clientInfo: { name: "ai-command-center", title: "AI Command Center", version: "0.1.0" }, capabilities: {} }, 30000);
        rpc.notify("initialized");
        const sandbox = req.permission === "read-only" ? "read-only" : "workspace-write";
        const base = { cwd: req.cwd, approvalPolicy: req.approvalPolicy === "on-request" ? "on-request" : "never", sandbox, ...(req.model ? { model: req.model } : {}), ...(req.instructions ? { developerInstructions: req.instructions } : {}), ...(codexConfig(req) ? { config: codexConfig(req) } : {}) };
        const th = req.resumeSessionId ? await rpc.request("thread/resume", { threadId: req.resumeSessionId, ...base }) : await rpc.request("thread/start", base);
        threadId = th.thread.id; model = th.thread.model ?? model;
        sink.event({ type: "session", providerSessionId: threadId });
        sink.event({ type: "applied", model, effort: req.effort ?? th.thread.reasoningEffort ?? null, effortSource: req.effort ? "requested" : th.thread.reasoningEffort ? "provider_default" : "not_configurable" });
        sink.event({ type: "status", detail: `thread ${threadId} modèle ${model}` });
        if (req.mcp?.length) { // les outils MCP ne sont visibles du modèle que si les serveurs sont prêts avant le tour
          const names = req.mcp.map((m) => m.name); const t0 = Date.now();
          while (Date.now() - t0 < 25000 && !names.every((n) => mcpState[n] && mcpState[n]!.status !== "starting")) await new Promise((r) => setTimeout(r, 150));
          for (const n of names) { const s = mcpState[n]; sink.event({ type: "status", detail: s ? `MCP « ${n} » : ${s.status}${s.error ? " — " + s.error.slice(0, 160) : ""}` : `MCP « ${n} » : état inconnu (délai)` }); }
        }
        const t = await rpc.request("turn/start", { threadId, input: [{ type: "text", text: req.prompt }, ...(req.images ?? []).map((i) => ({ type: "image", url: `data:${i.mime};base64,${i.data}` }))], ...(req.model ? { model: req.model } : {}), ...(req.effort ? { effort: req.effort } : {}) });
        turnId = t.turn.id;
        (cancelHook.fn = async () => { cancelled = true; try { await rpc.request("turn/interrupt", { threadId, turnId }, 5000); } catch {} setTimeout(() => killTree(child), 3000); });
      } catch (e: any) { sink.event({ type: "error", message: e.message }); finish(false, e.message); killTree(child); }
    })();
    return { done, cancel: () => cancelHook.fn() };
  }
  resumeSession(req: RunRequest & { resumeSessionId: string }, sink: RunSink, opts: { exclusive: boolean }) { return this.startSession(req, sink, opts); }
  async cancelExecution(h: RunHandle) { await h.cancel(); }
  async dispose() {}
}
