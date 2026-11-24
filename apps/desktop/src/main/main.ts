import { app, BrowserWindow, ipcMain, dialog, Notification, shell, screen, protocol, Tray, Menu, nativeImage, globalShortcut, desktopCapturer, nativeTheme } from "electron";
import { randomUUID } from "node:crypto";
// Aperçus HTML/SVG générés par le modèle : servis par un schéma dédié, avec une politique de sécurité qui autorise les scripts de la page mais aucun accès réseau ; affichés dans un iframe sandbox (origine opaque).
protocol.registerSchemesAsPrivileged([{ scheme: "acc-artifact", privileges: { standard: true, secure: true } }, { scheme: "acc-image", privileges: { standard: true, secure: true } }]);
/** Fichier d'image générée : « dossier/nom.png » strictement alphanumérique, résolu sous userData/images (jamais ailleurs). */
const IMG_REF = /^[A-Za-z0-9_-]{1,80}\/[A-Za-z0-9_-]{1,80}\.png$/;
const imagePath = (ref: string) => { if (!IMG_REF.test(ref)) throw new Error("Référence d'image invalide."); const root = join(app.getPath("userData"), "images"); const p = join(root, ...ref.split("/")); if (!p.startsWith(root + sep)) throw new Error("Référence d'image invalide."); return p; };
const artifacts = new Map<string, string>();
const ARTIFACT_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; base-uri 'none'; form-action 'none'";
import { readFileSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { createCore, type Core } from "@acc/core";
import { autoUpdater } from "electron-updater";

let core: Core; let win: BrowserWindow | null = null; let pickedRestore: string | null = null;
const isDev = !!process.env.ACC_DEV;

/** Liste blanche des méthodes IPC : le renderer ne peut appeler que ces entrées. */
function handlers(c: Core): Record<string, (...a: any[]) => unknown> {
  return {
    "app.info": () => ({ version: app.getVersion(), dataDir: app.getPath("userData"), platform: process.platform, disclaimer: c.disclaimer, recovered: c.recovered }),
    "providers.all": (force?: boolean) => c.allProviders(!!force), "providers.models": (p: any) => c.models(p), "providers.capabilities": (p: any) => c.capabilities(p), "providers.quota": (p: any) => c.quota(p),
    "billing.get": () => ({ exclusive: c.billing.exclusive(), env: c.billing.env() }), "billing.setExclusive": (v: boolean) => c.billing.setExclusive(!!v),
    "projects.list": () => c.projects.list(), "projects.create": (p: any) => c.projects.create(p), "projects.update": (id: string, p: any) => c.projects.update(id, p), "projects.archive": (id: string) => c.projects.archive(id), "projects.isGit": (p: string) => c.git.isRepo(p),
    "templates.list": () => c.templates, "agents.list": () => c.agents.list(), "agents.create": (a: any) => c.agents.create(a), "agents.update": (id: string, a: any) => c.agents.update(id, a), "tasks.edges": () => c.tasks.edges(), "tasks.update": (id: string, t: any) => c.tasks.update(id, t), "agents.duplicate": (id: string) => c.agents.duplicate(id), "agents.remove": (id: string) => c.agents.remove(id),
    "tasks.list": (pid?: string) => c.tasks.list(pid), "tasks.create": (t: any) => c.tasks.create(t), "tasks.setStatus": (id: string, s: string) => c.tasks.setStatus(id, s), "tasks.start": (id: string, wt?: boolean) => c.tasks.start(id, !!wt),
    "run": (i: any) => c.run(i), "cancel": (id: string) => c.cancel(id), "retry": (id: string) => c.retry(id), "approval.resolve": (id: string, ok: boolean) => c.resolveApproval(id, !!ok),
    "executions.list": (f?: any) => c.executions.list(f), "executions.get": (id: string) => c.executions.get(id), "executions.logs": (id: string, after?: number) => c.executions.logs(id, after), "executions.transitions": (id: string) => c.executions.transitions(id), "executions.usage": (id: string) => c.executions.usage(id), "approvals.pending": () => c.executions.pendingApprovals(),
    "dashboard": () => c.dashboard(), "analytics.totals": (f?: any) => c.analytics.totals(f), "analytics.by": (b: any, f?: any, l?: number) => c.analytics.by(b, f, l), "analytics.rows": (f?: any) => c.analytics.rows(f), "shell.openPath": async (p: string) => { const ok = c.projects.list().some((x: any) => x.path === p) || c.git.worktrees().some((w: any) => w.path === p); if (!ok) throw new Error("Chemin non autorisé"); return shell.openPath(p); }, "analytics.series": (b: any, f?: any) => c.analytics.series(b, f), "analytics.execStats": (f?: any) => c.analytics.execStats(f),
    "pricing.list": () => c.pricing.list(),
    "notifications.list": () => c.notifications.list(), "notifications.markRead": (id?: string) => c.notifications.markRead(id),
    "settings.all": () => c.settings.all(), "settings.set": (k: string, v: unknown) => c.settings.set(k, v), "audit.list": () => c.audit(),
    "git.worktrees": (pid?: string) => c.git.worktrees(pid), "git.changes": (p: string) => c.git.changes(p), "git.diff": (p: string) => c.git.diff(p), "git.merge": (id: string, ok: boolean) => c.git.merge(id, !!ok),
    "orch.list": (pid?: string) => c.orchestrator.list(pid), "orch.get": (id: string) => c.orchestrator.get(id), "orch.tasks": (id: string) => c.orchestrator.tasks(id), "orch.handoffs": (id: string) => c.orchestrator.handoffs(id), "orch.events": (id: string) => c.orchestrator.events(id), "orch.gates": (id: string) => c.orchestrator.gates(id), "orch.pendingGates": () => c.orchestrator.pendingGates(),
    "orch.create": (o: any) => c.orchestrator.create({ projectId: String(o.projectId), goal: String(o.goal ?? ""), mode: ["manual", "assisted", "auto"].includes(o.mode) ? o.mode : "assisted", plannerProvider: o.plannerProvider === "codex" ? "codex" : "claude", useWorktrees: !!o.useWorktrees }),
    "orch.replan": (id: string) => c.orchestrator.requestPlan(id), "orch.checkPlan": (id: string, plan: any) => c.orchestrator.checkPlan(id, plan), "orch.setPlan": (id: string, plan: any) => c.orchestrator.setPlan(id, plan), "orch.approve": (id: string) => c.orchestrator.approve(id), "orch.resume": (id: string) => c.orchestrator.resume(id), "orch.cancel": (id: string) => c.orchestrator.cancel(id), "orch.retryTask": (id: string) => c.orchestrator.retryTask(id), "orch.resolveGate": (id: string, ok: boolean) => c.orchestrator.resolveGate(id, !!ok),
    "ai.catalog": (p: any, force?: boolean) => c.ai.catalog(p === "codex" ? "codex" : "claude", !!force), "ai.policy": (m: any, p: any) => c.ai.policy(m, p === "codex" ? "codex" : "claude"), "ai.defaults": () => c.ai.defaults(), "ai.setDefault": (m: any, v: any) => { if (!["chat", "work", "code"].includes(m)) throw new Error("Mode inconnu"); c.ai.setDefault(m, v); },
    "conv.create": (o: any) => c.conversations.create({ web: !!o.web, image: !!o.image, style: o.style || null, mode: o.mode, submode: o.submode, title: o.title, provider: o.provider === "codex" ? "codex" : "claude", model: o.model || null, effort: o.effort || null, projectId: o.projectId || null, workId: o.workId || null }),
    "conv.list": (f: any) => c.conversations.list({ mode: f.mode, archived: !!f.archived, favorite: !!f.favorite, q: f.q, projectId: f.projectId, submode: f.submode }), "conv.get": (id: string) => c.conversations.get(id), "conv.messages": (id: string) => c.conversations.messages(id), "conv.history": (id: string) => c.conversations.history(id), "conv.active": (id: string) => c.conversations.activeExecution(id) ?? null,
    "conv.rename": (id: string, t: string) => c.conversations.rename(id, t), "conv.favorite": (id: string, v: boolean) => c.conversations.setFavorite(id, !!v), "conv.archive": (id: string, v: boolean) => c.conversations.setArchived(id, !!v), "conv.remove": (id: string) => c.conversations.remove(id),
    "conv.send": (id: string, text: string, cfg?: any, att?: any[], img?: any[]) => c.conversations.send(id, String(text), cfg ? { provider: cfg.provider, model: cfg.model, effort: cfg.effort } : undefined, (att ?? []).map((a: any) => ({ name: String(a.name), content: String(a.content) })), (img ?? []).map((i: any) => ({ name: String(i.name), mime: String(i.mime), data: String(i.data) }))), "conv.stop": (id: string) => c.conversations.stop(id), "conv.regenerate": (id: string) => c.conversations.regenerate(id), "conv.continueInCode": (id: string, pid: string, sel?: string) => c.conversations.continueInCode(id, pid, sel),
    "conv.export": async (id: string, fmt: "md" | "json") => { const data = c.conversations.export(id, fmt === "json" ? "json" : "md"); const r = await dialog.showSaveDialog(win!, { defaultPath: `conversation.${fmt === "json" ? "json" : "md"}` }); if (r.canceled || !r.filePath) return null; (await import("node:fs")).writeFileSync(r.filePath, data); return r.filePath; },
    "work.create": (o: any) => c.works.create({ title: String(o.title ?? ""), goal: o.goal, provider: o.provider === "codex" ? "codex" : "claude", model: o.model || null, effort: o.effort || null }), "work.list": (f?: any) => c.works.list(f ?? {}), "work.get": (id: string) => c.works.get(id) ?? null, "work.update": (id: string, p: any) => c.works.update(id, p), "work.remove": (id: string) => c.works.remove(id),
    "work.steps": (id: string) => c.works.steps(id), "work.addStep": (id: string, t: string) => c.works.addStep(id, t), "work.setStep": (sid: string, p: any) => c.works.setStep(sid, p), "work.removeStep": (sid: string) => c.works.removeStep(sid), "work.moveStep": (sid: string, d: number) => c.works.moveStep(sid, d < 0 ? -1 : 1), "work.planPrompt": (goal: string) => c.works.planPrompt(goal), "work.importPlan": (id: string) => c.works.importPlan(id),
    "work.files": (id: string) => c.works.files(id), "work.addFiles": (id: string, paths: string[]) => c.works.addFiles(id, paths), "work.removeFile": (fid: string) => c.works.removeFile(fid), "work.deliverables": (id: string) => c.works.deliverables(id), "work.readDeliverable": (id: string, rel: string) => c.works.readDeliverable(id, rel), "work.events": (id: string) => c.works.events(id),
    "work.openDeliverable": async (id: string, rel: string) => { const p = c.works.deliverablePath(id, rel); const SAFE = /\.(md|txt|csv|json|html?|pdf|docx?|xlsx?|pptx?|png|jpe?g|svg)$/i; if (SAFE.test(p)) return shell.openPath(p); shell.showItemInFolder(p); return ""; },
    "dialog.textFiles": async () => { const r = await dialog.showOpenDialog(win!, { properties: ["openFile", "multiSelections"], filters: [{ name: "Fichiers texte et code", extensions: ["txt", "md", "csv", "tsv", "json", "xml", "yml", "yaml", "html", "css", "js", "jsx", "ts", "tsx", "py", "java", "c", "cpp", "h", "cs", "go", "rs", "rb", "php", "sh", "sql", "toml", "ini", "log"] }] }); if (r.canceled) return []; const fs = await import("node:fs"); const out: { name: string; content: string }[] = []; for (const p of r.filePaths.slice(0, 5)) { const st = fs.statSync(p); if (st.size > 200_000) throw new Error(`« ${p.split(String.fromCharCode(92)).join("/").split("/").pop()} » dépasse 200 Ko.`); out.push({ name: p.split(String.fromCharCode(92)).join("/").split("/").pop()!, content: fs.readFileSync(p, "utf8") }); } return out; },
    "dialog.images": async () => { const r = await dialog.showOpenDialog(win!, { properties: ["openFile", "multiSelections"], filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }] }); if (r.canceled) return []; const fs = await import("node:fs"); const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" }; const out: any[] = []; for (const p of r.filePaths.slice(0, 4)) { const st = fs.statSync(p); if (st.size > 5 * 1024 * 1024) throw new Error("Image de plus de 5 Mo : " + p.split(String.fromCharCode(92)).pop()); const ext = (p.split(".").pop() ?? "").toLowerCase(); out.push({ name: p.split(String.fromCharCode(92)).join("/").split("/").pop(), mime: MIME[ext] ?? "application/octet-stream", data: fs.readFileSync(p).toString("base64") }); } return out; },
    "dialog.files": async () => { const r = await dialog.showOpenDialog(win!, { properties: ["openFile", "multiSelections"] }); return r.canceled ? [] : r.filePaths; },
    "wf.list": () => c.workflows.list(), "wf.runs": (id: string) => c.workflows.runs(id), "wf.save": (w: any) => c.workflows.save(w), "wf.duplicate": (id: string) => c.workflows.duplicate(id), "wf.remove": (id: string) => c.workflows.remove(id), "wf.commands": (id: string, goal: string) => c.workflows.commands(id, String(goal ?? "")), "wf.run": (o: any) => c.workflows.run({ workflowId: o.workflowId, projectId: o.projectId, goal: String(o.goal ?? ""), useWorktrees: !!o.useWorktrees }),
    "cmp.list": () => c.comparisons.list(), "cmp.get": (id: string) => c.comparisons.get(id) ?? null, "cmp.create": (o: any) => c.comparisons.create({ projectId: o.projectId, prompt: String(o.prompt ?? ""), write: !!o.write, runs: (o.runs ?? []).map((r: any) => ({ provider: r.provider === "codex" ? "codex" : "claude", model: r.model || null, effort: r.effort || null })) }), "cmp.choose": (id: string, rid: string | null, note?: string) => c.comparisons.choose(id, rid, note), "cmp.synthesize": (id: string, p?: any) => c.comparisons.synthesize(id, p === "codex" ? "codex" : "claude"), "cmp.remove": (id: string) => c.comparisons.remove(id),
    "mem.list": (pid: string) => c.memory.list(pid), "mem.add": (pid: string, m: any) => c.memory.add(pid, m), "mem.update": (id: string, p: any) => c.memory.update(id, p), "mem.remove": (id: string) => c.memory.remove(id), "mem.context": (pid: string) => c.memory.context(pid),
    "sys.mcp": (force?: boolean) => c.system.mcp(!!force), "sys.skills": () => c.system.skills(), "router.advice": (p?: any) => c.router.advice(p === "codex" ? "codex" : p === "claude" ? "claude" : undefined),
    "sys.backup": async () => { const r = await dialog.showSaveDialog(win!, { defaultPath: `ai-command-center-${new Date().toISOString().slice(0, 10)}.sqlite`, filters: [{ name: "Sauvegarde", extensions: ["sqlite"] }] }); if (r.canceled || !r.filePath) return null; const { size, stripped } = c.system.backup(r.filePath); return { path: r.filePath, size, stripped }; },
    "sys.restore": async () => { const r = await dialog.showOpenDialog(win!, { defaultPath: c.system.backupsDir, properties: ["openFile"], filters: [{ name: "Sauvegarde", extensions: ["sqlite"] }] }); if (r.canceled || !r.filePaths[0]) return null; const info = c.system.inspectBackup(r.filePaths[0]); if (!info.ok) throw new Error(info.error); pickedRestore = r.filePaths[0]; return { path: r.filePaths[0], ...info }; },
    "sys.restoreApply": async (file: string) => { if (!pickedRestore || file !== pickedRestore) throw new Error("Sélectionnez d'abord le fichier de sauvegarde via la boîte de dialogue."); c.system.stageRestore(pickedRestore); setTimeout(() => { app.relaunch(); app.exit(0); }, 400); return true; },
    "q.scripts": (pid: string) => c.quality.scripts(pid), "q.setScripts": (pid: string, s: any) => c.quality.setScripts(pid, s), "q.run": (pid: string, kind: any) => c.quality.run(pid, kind), "q.runAll": (pid: string) => c.quality.runAll(pid), "q.history": (pid: string, kind?: string) => c.quality.history(pid, kind), "q.summary": (pid: string) => c.quality.summary(pid), "q.review": (pid: string, p: any) => c.quality.review(pid, p === "codex" ? "codex" : "claude"), "q.reviews": (pid: string) => c.quality.reviews(pid),
    "auto.list": () => c.automations.list(), "auto.runs": (id: string) => c.automations.runs(id), "auto.create": (a: any) => c.automations.create(a), "auto.setEnabled": (id: string, v: boolean) => c.automations.setEnabled(id, !!v), "auto.remove": (id: string) => c.automations.remove(id), "auto.fire": (id: string) => c.automations.fire(id, "manual"),
    // Mise à jour : flux « generic » configurable (URL d'un dossier contenant latest.yml). Rien n'est téléchargé ni installé sans action explicite.
    "update.get": () => ({ url: c.settings.get<string>("update.feedUrl", ""), version: app.getVersion(), packaged: app.isPackaged }),
    "update.setUrl": (u: string) => { const v = String(u ?? "").trim(); if (v && !/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)/.test(v)) throw new Error("L'URL doit être en https (ou http://localhost pour un test)."); c.settings.set("update.feedUrl", v); },
    "update.check": async () => { const url = c.settings.get<string>("update.feedUrl", ""); if (!url) throw new Error("Aucune URL de mise à jour configurée."); if (!app.isPackaged) throw new Error("La mise à jour n'est disponible que dans l'application installée."); autoUpdater.autoDownload = false; autoUpdater.autoInstallOnAppQuit = false; autoUpdater.setFeedURL({ provider: "generic", url }); const r = await autoUpdater.checkForUpdates(); const v = r?.updateInfo?.version; return { current: app.getVersion(), latest: v ?? null, available: !!v && v !== app.getVersion() && !!r?.isUpdateAvailable }; },
    "update.download": async () => { await autoUpdater.downloadUpdate(); return true; }, "update.install": () => { autoUpdater.quitAndInstall(); return true; },
    "ext.list": (k?: string) => c.extensions.list(k === "mcp" || k === "skill" ? k : undefined), "ext.addMcp": (a: any) => c.extensions.addMcp({ name: String(a.name ?? ""), config: a.config, modes: a.modes }), "ext.addSkill": (a: any) => c.extensions.addSkill({ name: String(a.name ?? ""), description: String(a.description ?? ""), body: String(a.body ?? ""), modes: a.modes }),
    "ext.setModes": (id: string, m: any[]) => c.extensions.setModes(id, m), "ext.setEnabled": (id: string, v: boolean) => c.extensions.setEnabled(id, !!v), "ext.remove": (id: string) => c.extensions.remove(id), "ext.test": (cfg: any) => c.extensions.test(cfg),
    "ext.importSkill": async (modes?: any[]) => { const r = await dialog.showOpenDialog(win!, { properties: ["openFile", "openDirectory"], title: "Choisir un dossier de skill ou un fichier SKILL.md" }); if (r.canceled || !r.filePaths[0]) return null; return c.extensions.importSkill(r.filePaths[0], modes); },
    "ext.testSaved": async (id: string) => { const e = (c.db.prepare("SELECT * FROM extensions WHERE id=? AND kind='mcp'").get(id) as any); if (!e) throw new Error("Serveur introuvable"); return c.extensions.test(JSON.parse(e.config)); },
    "ext.importSkillPath": (p: string, modes?: any[]) => { if (!c.system.skills().some((s: any) => s.path === p)) throw new Error("Skill non détectée dans les dossiers connus."); return c.extensions.importSkill(p, modes); },
    "artifact.put": (html: unknown) => { const s = String(html ?? ""); if (s.length > 1_000_000) throw new Error("Aperçu trop volumineux (1 Mo maximum)."); const id = randomUUID(); artifacts.set(id, s); if (artifacts.size > 100) artifacts.delete(artifacts.keys().next().value as string); return id; },
    "conv.exportRich": (id: unknown, fmt: unknown, testPath?: unknown) => exportConversation(String(id), fmt === "pdf" ? "pdf" : "html", typeof testPath === "string" ? testPath : undefined),
    "image.save": async (ref: unknown) => { const p = imagePath(String(ref ?? "")); const r = await dialog.showSaveDialog(win!, { defaultPath: "image.png", filters: [{ name: "Image PNG", extensions: ["png"] }] }); if (r.canceled || !r.filePath) return null; (await import("node:fs")).copyFileSync(p, r.filePath); return r.filePath; },
    "file.saveText": async (name: unknown, content: unknown) => { const r = await dialog.showSaveDialog(win!, { defaultPath: String(name ?? "fichier.txt") }); if (r.canceled || !r.filePath) return null; (await import("node:fs")).writeFileSync(r.filePath, String(content ?? ""), "utf8"); return r.filePath; },
    // Capture de l'écran où se trouve la fenêtre, après l'avoir masquée (sinon l'application se capturerait elle-même).
    "screen.capture": async () => {
      const w = win; if (!w || w.isDestroyed()) throw new Error("Fenêtre indisponible."); const disp = screen.getDisplayMatching(w.getBounds()); const wasVisible = w.isVisible() && !w.isMinimized();
      try { if (wasVisible) { w.hide(); await new Promise((r) => setTimeout(r, 350)); }
        const sz = { width: Math.min(2560, Math.round(disp.size.width * disp.scaleFactor)), height: Math.min(1600, Math.round(disp.size.height * disp.scaleFactor)) }; const srcs = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: sz });
        const src = srcs.find((s) => s.display_id === String(disp.id)) ?? srcs[0]; if (!src || src.thumbnail.isEmpty()) throw new Error("Capture impossible (aucun écran détecté).");
        return { mime: "image/png", data: src.thumbnail.toPNG().toString("base64") };
      } finally { if (wasVisible) { w.show(); w.focus(); } }
    },
    // ---- Lanceur global, icône de notification, arrière-plan ----
    "app.setTheme": (mode: unknown) => { const m = mode === "light" || mode === "dark" ? mode : "system"; c.settings.set("ui.theme", m); nativeTheme.themeSource = m; for (const w of BrowserWindow.getAllWindows()) w.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#262624" : "#faf9f5"); return m; },
    "app.setZoom": (f: unknown) => { const z = Math.min(1.4, Math.max(0.8, Number(f) || 1)); c.settings.set("ui.zoom", z); win?.webContents.setZoomFactor(z); return z; },
    "launcher.info": () => ({ trayOk, packaged: app.isPackaged, shortcut: currentShortcut, shortcutOk, defaultShortcut: DEFAULT_SHORTCUT, keepRunning: !!c.settings.get("app.keepRunning", false), autostart: !!c.settings.get("app.autostart", false) }),
    "app.setShortcut": (accel: unknown) => { const a = String(accel ?? "").trim(); const r = registerShortcut(a); if (r.ok) c.settings.set("app.shortcut", a); return { ...r, shortcut: currentShortcut }; },
    "app.setKeepRunning": (v: unknown) => { c.settings.set("app.keepRunning", !!v); return true; },
    "app.setAutostart": (v: unknown) => { if (!app.isPackaged) throw new Error("Disponible dans l'application installée uniquement."); c.settings.set("app.autostart", !!v); app.setLoginItemSettings({ openAtLogin: !!v, args: ["--hidden"] }); return true; },
    "app.openConversation": (mode: unknown, id: unknown) => { hideQuick(); const m = mode === "code" ? "code" : "chat"; navigateMain(`/${m}?open=${encodeURIComponent(String(id))}`); return true; },
    "app.hideQuick": () => { hideQuick(); return true; },
    "app.quit": () => { quitApp(); return true; },
    "conv.branch": (id: string, msgId: string, text: string, cfg: any) => c.conversations.branchFrom(String(id), String(msgId), String(text ?? ""), cfg ?? undefined),
    "lib.list": (f: any) => c.library.list({ kind: f?.kind || undefined, q: f?.q || undefined, limit: f?.limit }), "lib.get": (id: string) => c.library.get(String(id)),
    // Première ouverture : l'introduction ne s'affiche que sur une installation vierge (aucune conversation, aucun projet, aucune exécution) et jamais deux fois.
    "onboarding.state": () => { const n = (tb: string) => Number((c.db.prepare(`SELECT COUNT(*) n FROM ${tb}`).get() as any).n); return { done: !!c.settings.get("onboarding.done", false), fresh: n("conversations") === 0 && n("projects") === 0 && n("agent_executions") === 0 }; },
    "onboarding.finish": () => { c.settings.set("onboarding.done", true); return true; },
    "conv.setWeb": (id: string, on: unknown) => c.conversations.setWeb(String(id), !!on),
    "conv.setImage": (id: string, on: unknown) => c.conversations.setImage(String(id), !!on),
    "kb.list": () => c.knowledge.list(), "kb.create": (n: unknown) => c.knowledge.create(String(n ?? "")), "kb.remove": (id: unknown) => { c.knowledge.remove(String(id)); return true; }, "kb.docs": (id: unknown) => c.knowledge.docs(String(id)), "kb.removeDoc": (id: unknown) => { c.knowledge.removeDoc(String(id)); return true; }, "kb.search": (id: unknown, q: unknown) => c.knowledge.search(String(id), String(q ?? ""), 8), "conv.setKb": (id: unknown, kb: unknown) => { c.conversations.setKb(String(id), kb ? String(kb) : null); return true; },
    "kb.addFiles": async (kbId: unknown) => { const r = await dialog.showOpenDialog(win!, { properties: ["openFile", "multiSelections"], title: "Ajouter à la base", filters: [{ name: "Documents, texte et code", extensions: ["pdf", "docx", "pptx", "xlsx", "xls", "html", "htm", "epub", "txt", "md", "csv", "tsv", "json", "xml", "yml", "yaml", "log", "sql", "py", "js", "ts", "tsx", "jsx", "java", "c", "cpp", "cs", "go", "rs", "rb", "php", "sh", "ipynb"] }] }); if (r.canceled || !r.filePaths.length) return null; const paths = r.filePaths.slice(0, 5); const res = await c.converter.load(paths); let added = 0, chunks = 0; const problems: string[] = res.skipped.map((s: any) => `${s.name} : ${s.reason}`); for (const f of res.files) { try { const d = c.knowledge.addDoc(String(kbId), f.name, f.content); added++; chunks += d.chunks; } catch (e: any) { problems.push(String(e.message)); } } return { added, chunks, problems, needsConverter: res.needsConverter.length }; },
    "memory.list": () => ({ items: c.userMemory.list(), enabled: c.userMemory.enabled(), tokens: c.userMemory.tokens() }), "memory.add": (t: unknown) => c.userMemory.add(String(t ?? "")), "memory.remove": (id: unknown) => { c.userMemory.remove(String(id)); return true; }, "memory.clear": () => { c.userMemory.clear(); return true; }, "memory.setEnabled": (on: unknown) => { c.userMemory.setEnabled(!!on); return true; },
    "profile.get": () => c.profile.get(), "profile.save": (p: any) => c.profile.save({ about: p?.about, howto: p?.howto, defaultStyle: p?.defaultStyle }),
    "style.list": () => c.profile.list(), "style.saveCustom": (list: any) => c.profile.saveCustom(Array.isArray(list) ? list : []), "conv.setStyle": (id: string, style: string | null) => c.conversations.setStyle(String(id), style ? String(style) : null),
    "doc.status": () => c.converter.status(), "doc.install": () => c.converter.install(),
    "doc.pick": async () => { const r = await dialog.showOpenDialog(win!, { properties: ["openFile", "multiSelections"], title: "Joindre des documents", filters: [{ name: "Documents, texte et code", extensions: ["pdf", "docx", "pptx", "xlsx", "xls", "html", "htm", "epub", "txt", "md", "csv", "tsv", "json", "xml", "yml", "yaml", "log", "sql", "py", "js", "ts", "tsx", "jsx", "java", "c", "cpp", "cs", "go", "rs", "rb", "php", "sh", "ipynb"] }, { name: "Tous les fichiers", extensions: ["*"] }] }); if (r.canceled) return []; r.filePaths.forEach(approve); return r.filePaths; },
    "doc.images": async (paths: unknown) => { const fs = await import("node:fs"); const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" }; const out: any[] = []; for (const p of (Array.isArray(paths) ? paths : []).map(String).filter((q) => approved.has(q)).slice(0, 4)) { const ext = (p.split(".").pop() ?? "").toLowerCase(); if (!MIME[ext]) continue; const st = fs.statSync(p); if (st.size > 5 * 1024 * 1024) throw new Error("Image de plus de 5 Mo : " + p.split(String.fromCharCode(92)).pop()); out.push({ name: p.split(String.fromCharCode(92)).join("/").split("/").pop(), mime: MIME[ext], data: fs.readFileSync(p).toString("base64") }); } return out; },
    "doc.enableAgents": () => { const s = c.converter.status(); if (!s.mcp) throw new Error("Installez d'abord le convertisseur."); if (!c.extensions.list("mcp").some((e: any) => e.name === "markitdown")) c.extensions.addMcp({ name: "markitdown", config: { transport: "stdio", command: s.mcp, args: [] }, modes: ["work", "code"] });
      if (!c.extensions.list("skill").some((e: any) => e.name === "lire-documents")) c.extensions.addSkill({ name: "lire-documents", description: "Lire PDF, Word, PowerPoint, Excel, HTML via MarkItDown pour économiser des tokens", body: "Pour lire un document PDF, Word (.docx), PowerPoint (.pptx), Excel (.xlsx/.xls), HTML ou EPUB, n'ouvre pas le fichier brut : appelle l'outil `convert_to_markdown` du serveur MCP « markitdown » avec l'URI du fichier (ex. file:///C:/dossier/rapport.pdf). Le Markdown obtenu consomme beaucoup moins de tokens. Lis ensuite seulement les parties utiles à la demande.", modes: ["work", "code"] }); return true; },
    "doc.load": async (paths: unknown) => { const list = (Array.isArray(paths) ? paths : []).map(String).filter((p) => approved.has(p)); if (!list.length) throw new Error("Aucun fichier sélectionné."); return c.converter.load(list); },
    "ext.forConv": (id: string) => c.conversations.extensions(id), "ext.setConv": (id: string, ext: string, on: boolean) => c.conversations.setExtensionActive(id, ext, !!on),
    "terminal.create": async (o: any) => { const p = o.projectId ? c.projects.get(o.projectId) as any : undefined; const cwd = p?.path ?? o.cwd ?? app.getPath("home"); if (p ? false : o.cwd && !c.projects.list().some((x: any) => x.path === o.cwd)) throw new Error("Dossier non autorisé : choisissez un projet."); return c.terminals.create({ kind: ["claude", "codex", "shell"].includes(o.kind) ? o.kind : "shell", cwd, projectId: p?.id, cols: o.cols, rows: o.rows, title: o.title }); },
    "terminal.list": () => c.terminals.list(), "terminal.attach": (id: string) => c.terminals.attach(id), "terminal.write": (id: string, d: string) => c.terminals.write(id, String(d)), "terminal.resize": (id: string, cols: number, rows: number) => c.terminals.resize(id, cols | 0, rows | 0), "terminal.kill": (id: string) => c.terminals.kill(id), "terminal.close": (id: string) => c.terminals.close(id),
    "dialog.folder": async () => { const r = await dialog.showOpenDialog(win!, { properties: ["openDirectory"] }); return r.canceled ? null : r.filePaths[0]; },
    "export.usage": async (f: any, fmt: "csv" | "json") => { const data = c.analytics.export(f ?? {}, fmt); const r = await dialog.showSaveDialog(win!, { defaultPath: `usage.${fmt}` }); if (r.canceled || !r.filePath) return null; (await import("node:fs")).writeFileSync(r.filePath, data); return r.filePath; },
  };
}

/** Géométrie de fenêtre : proportionnelle à l'écran (jamais une taille fixe), mémorisée, et revalidée si l'écran a changé. */
interface WinState { x?: number; y?: number; width: number; height: number; maximized?: boolean }
const stateFile = () => join(app.getPath("userData"), "window-state.json");
function loadWinState(): WinState | undefined { try { const s = JSON.parse(readFileSync(stateFile(), "utf8")); return typeof s.width === "number" && typeof s.height === "number" ? s : undefined; } catch { return undefined; } }
function initialBounds(): WinState {
  const wa = screen.getPrimaryDisplay().workArea; const saved = loadWinState();
  if (saved) { // réutilisée seulement si elle tient encore sur un écran connecté
    const disp = screen.getDisplayMatching({ x: saved.x ?? wa.x, y: saved.y ?? wa.y, width: saved.width, height: saved.height }).workArea;
    const w = Math.min(saved.width, disp.width), h = Math.min(saved.height, disp.height);
    const x = saved.x === undefined ? undefined : Math.min(Math.max(saved.x, disp.x), disp.x + disp.width - w), y = saved.y === undefined ? undefined : Math.min(Math.max(saved.y, disp.y), disp.y + disp.height - h);
    return { x, y, width: w, height: h, maximized: saved.maximized };
  }
  const width = Math.round(wa.width * 0.9), height = Math.round(wa.height * 0.9); // 90 % de la zone utile, centrée
  return { x: wa.x + Math.round((wa.width - width) / 2), y: wa.y + Math.round((wa.height - height) / 2), width, height };
}
function trackWinState(w: BrowserWindow) {
  let t: NodeJS.Timeout | undefined;
  const save = () => { if (w.isDestroyed() || w.isMinimized() || w.isFullScreen()) return; const max = w.isMaximized(); const b = max ? (loadWinState() ?? w.getNormalBounds()) : w.getBounds(); try { writeFileSync(stateFile(), JSON.stringify({ ...(max ? w.getNormalBounds() : b), maximized: max })); } catch { /* disque en lecture seule : non bloquant */ } };
  const later = () => { clearTimeout(t); t = setTimeout(save, 400); };
  w.on("resize", later); w.on("move", later); w.on("maximize", later); w.on("unmaximize", later); w.on("close", save);
}

/** Chemins que l'utilisateur a réellement choisis (sélecteur de fichiers ou glisser-déposer authentique) : le renderer ne peut pas faire lire un chemin arbitraire. */
const approved = new Set<string>(); const approve = (p: string) => { if (approved.size > 500) approved.clear(); approved.add(p); };
ipcMain.on("acc:approve", (_e, p: unknown) => { if (typeof p === "string" && p.length < 1024) approve(p); });

// ---------------------------------------------------------------- Instance unique, arrière-plan, lanceur global
const DEFAULT_SHORTCUT = "Ctrl+Alt+Space"; // Alt+Espace ouvrirait le menu système de Windows
const gotLock = app.requestSingleInstanceLock(); // une seule instance par dossier de données : sinon deux processus partageraient la base et lanceraient les automatisations en double
let quitting = false; let trayOk = false; let tray: Tray | undefined; let quick: BrowserWindow | undefined; let currentShortcut = ""; let shortcutOk = true; const startHidden = process.argv.includes("--hidden");
const quitApp = () => { quitting = true; app.quit(); };
function showMain() { if (!win || win.isDestroyed()) { void createWindow(); return; } if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
function navigateMain(hash: string) { showMain(); const send = () => win?.webContents.send("acc:navigate", hash); if (!win || win.webContents.isLoading()) win?.webContents.once("did-finish-load", send); else send(); }
app.on("second-instance", () => showMain());
function guard(w: BrowserWindow) {
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: "deny" }; });
  w.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("http://localhost:5173") && !url.startsWith("file:")) e.preventDefault(); });
}
async function loadRenderer(w: BrowserWindow, hash = "") { if (isDev) await w.loadURL("http://localhost:5173/" + (hash ? "#" + hash : "")); else await w.loadFile(join(__dirname, "../renderer/index.html"), hash ? { hash } : undefined); }
async function ensureQuick(): Promise<BrowserWindow> {
  if (quick && !quick.isDestroyed()) return quick;
  quick = new BrowserWindow({ width: 700, height: 200, show: false, frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false, title: "Lanceur rapide", webPreferences: { preload: join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  guard(quick); quick.on("blur", () => { if (quick && !quick.webContents.isDevToolsOpened()) quick.hide(); }); quick.on("closed", () => { quick = undefined; });
  await loadRenderer(quick, "/quick"); return quick;
}
/** Export mis en page d'une conversation (HTML autonome ou PDF) : rendu par l'application elle-même dans une fenêtre cachée, graphiques et diagrammes compris. */
const SERIALIZE = `(() => { const css = [...document.styleSheets].map((s) => { try { return [...s.cssRules].map((r) => r.cssText).join(String.fromCharCode(10)); } catch { return ""; } }).join(String.fromCharCode(10));
  const clone = document.getElementById("root").cloneNode(true);
  clone.querySelectorAll("iframe").forEach((f) => { const p = document.createElement("p"); p.textContent = "[Aperçu HTML interactif non inclus dans l'export]"; p.setAttribute("style", "font-size:12px;color:#777;border:1px dashed #aaa;padding:12px;border-radius:12px"); f.replaceWith(p); });
  clone.querySelectorAll("button[aria-label]").forEach((b) => { if (/copier|agrandir|enregistrer|télécharger|plein écran|exporter|réinitialiser/i.test(b.getAttribute("aria-label"))) b.remove(); });
  return JSON.stringify({ css, body: clone.innerHTML, title: document.querySelector("h1")?.textContent || "Conversation" }); })()`;
const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
async function exportConversation(id: string, fmt: "html" | "pdf", testPath?: string): Promise<string | null> {
  const conv = core.conversations.get(id); if (!conv) throw new Error("Conversation introuvable");
  const safe = String(conv.title).replace(/[^\p{L}\p{N} _().-]/gu, " ").replace(/ +/g, " ").trim().slice(0, 60) || "conversation";
  const r = testPath && process.env.ACC_E2E === "1" ? { canceled: false, filePath: testPath } : await dialog.showSaveDialog(win!, { defaultPath: `${safe}.${fmt}`, filters: [fmt === "pdf" ? { name: "PDF", extensions: ["pdf"] } : { name: "Page web", extensions: ["html"] }] });
  if (r.canceled || !r.filePath) return null;
  const ew = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { preload: join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: false } });
  try {
    await loadRenderer(ew, `/export/${id}`);
    const t0 = Date.now(); while (Date.now() - t0 < 25000) { if (await ew.webContents.executeJavaScript('document.body.dataset.ready === "1"')) break; await new Promise((res) => setTimeout(res, 200)); }
    const fs = await import("node:fs");
    if (fmt === "pdf") { fs.writeFileSync(r.filePath, await ew.webContents.printToPDF({ printBackground: true, pageSize: "A4", margins: { marginType: "default" } })); return r.filePath; }
    const d = JSON.parse(await ew.webContents.executeJavaScript(SERIALIZE)) as { css: string; body: string; title: string };
    const inline = (txt: string) => txt
      .replace(/acc-image:\/\/f\/([A-Za-z0-9_\-\/]+\.png)/g, (m, ref) => { try { return "data:image/png;base64," + fs.readFileSync(imagePath(ref)).toString("base64"); } catch { return m; } });
    const root = join(__dirname, "../renderer");
    const css = inline(d.css).replace(/url\((['"]?)(?:\.\.?\/|\/)?(assets\/[A-Za-z0-9_.\-]+\.(woff2|woff))\1\)/g, (m, _q, rel, ext) => { try { const p = join(root, rel); if (!p.startsWith(root + sep)) return m; return `url(data:font/${ext};base64,${fs.readFileSync(p).toString("base64")})`; } catch { return m; } });
    const html = `<!doctype html><html lang="fr" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"><title>${escHtml(d.title)}</title><style>${css}</style></head><body><div id="root">${inline(d.body)}</div></body></html>`;
    fs.writeFileSync(r.filePath, html, "utf8"); return r.filePath;
  } finally { if (!ew.isDestroyed()) ew.destroy(); }
}
function hideQuick() { if (quick && !quick.isDestroyed()) quick.hide(); }
async function toggleQuick() {
  const q = await ensureQuick(); if (q.isVisible()) { q.hide(); return; }
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea; q.setBounds({ x: Math.round(d.x + (d.width - 700) / 2), y: Math.round(d.y + d.height * 0.16), width: 700, height: 200 }); q.show(); q.focus();
}
function registerShortcut(accel: string): { ok: boolean; error?: string } {
  const prev = currentShortcut; if (prev) globalShortcut.unregister(prev);
  if (!accel) { currentShortcut = ""; shortcutOk = true; return { ok: true }; }
  try { if (globalShortcut.register(accel, () => void toggleQuick())) { currentShortcut = accel; shortcutOk = true; return { ok: true }; } } catch { /* accélérateur invalide */ }
  if (prev) { try { globalShortcut.register(prev, () => void toggleQuick()); } catch { /* ignoré */ } }
  shortcutOk = !!prev; return { ok: false, error: "Ce raccourci est invalide ou déjà utilisé par une autre application." };
}
function createTray(): boolean {
  try {
    const img = nativeImage.createFromPath(join(__dirname, "../../build/icon.png")); if (img.isEmpty()) return false; tray = new Tray(img.resize({ width: 20, height: 20 })); tray.setToolTip("AI Command Center");
    tray.setContextMenu(Menu.buildFromTemplate([{ label: "Ouvrir AI Command Center", click: () => showMain() }, { label: "Nouveau chat", click: () => navigateMain("/chat?new=1") }, { label: "Lanceur rapide", click: () => void toggleQuick() }, { type: "separator" }, { label: "Quitter", click: () => quitApp() }]));
    tray.on("click", () => showMain()); return true;
  } catch { return false; /* icône indisponible : l'application reste utilisable, mais le retour depuis l'arrière-plan passe par le raccourci du Bureau */ }
}

async function createWindow() {
  const b = initialBounds(); const wa = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({ ...b, minWidth: Math.min(900, wa.width), minHeight: Math.min(600, wa.height), show: false, backgroundColor: nativeTheme.shouldUseDarkColors ? "#262624" : "#faf9f5", title: "AI Command Center", autoHideMenuBar: true, icon: join(__dirname, "../../build/icon.png"),
    webPreferences: { preload: join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  if (b.maximized) win.maximize(); win.once("ready-to-show", () => { if (!(startHidden && core?.settings.get("app.keepRunning", false))) win?.show(); }); trackWinState(win);
  // Fermer la fenêtre : mise en arrière-plan (icône près de l'horloge) si activé, sinon l'application se ferme. « Quitter » du menu de l'icône quitte vraiment.
  win.webContents.on("did-finish-load", () => { const z = Number(core?.settings.get("ui.zoom", 1)); if (z && z !== 1) win?.webContents.setZoomFactor(z); });
  win.on("close", (e) => { if (!quitting && core?.settings.get("app.keepRunning", false)) { e.preventDefault(); win?.hide(); } });
  win.on("closed", () => { win = null; if (!quitting) quitApp(); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("http://localhost:5173") && !url.startsWith("file:")) e.preventDefault(); });
  if (isDev) await win.loadURL("http://localhost:5173"); else await win.loadFile(join(__dirname, "../renderer/index.html"));
}

if (process.platform === "win32") app.setAppUserModelId("local.ai-command-center"); // même identifiant que le raccourci de l'installateur : épinglage et regroupement corrects dans la barre des tâches
app.whenReady().then(async () => {
  if (!gotLock) { app.quit(); return; }
  protocol.handle("acc-image", async (req) => { try { const u = new URL(req.url); const p = imagePath(decodeURIComponent(u.pathname.replace(/^\//, ""))); const { readFileSync } = await import("node:fs"); return new Response(readFileSync(p), { headers: { "content-type": "image/png", "x-content-type-options": "nosniff" } }); } catch { return new Response("Introuvable", { status: 404 }); } });
  protocol.handle("acc-artifact", (req) => { const html = artifacts.get(new URL(req.url).pathname.replace(/^\//, "")); if (html === undefined) return new Response("Introuvable", { status: 404 }); return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": ARTIFACT_CSP, "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } }); });
  core = createCore({ dataDir: app.getPath("userData"), onTerminalEvent: (e) => { if (win && !win.isDestroyed()) win.webContents.send("acc:term", e); } });
  try { if (core.settings.get("backup.auto", true)) core.system.autoBackup(); } catch { /* non bloquant */ }
  const table = handlers(core);
  ipcMain.handle("acc:call", async (_e, method: string, args: unknown[]) => {
    const fn = Object.prototype.hasOwnProperty.call(table, method) ? table[method] : undefined;
    if (!fn) throw new Error(`Méthode IPC non autorisée: ${method}`);
    if (!Array.isArray(args) || args.length > 6) throw new Error("Arguments invalides");
    return fn(...args);
  });
  core.bus.on((ev) => {
    if (ev.type === "execution.text" && win && !win.isDestroyed()) { win.webContents.send("acc:event", ev); return; }
    win?.webContents.send("acc:event", ev);
    if (ev.type === "notification" && Notification.isSupported() && core.settings.get("notifications.desktop", true)) new Notification({ title: String(ev.payload.title), body: String(ev.payload.body ?? "") }).show();
  });
  nativeTheme.themeSource = (["light", "dark"].includes(String(core.settings.get("ui.theme", "system"))) ? String(core.settings.get("ui.theme", "system")) : "system") as "light" | "dark" | "system";
  await createWindow(); trayOk = createTray(); registerShortcut(String(core.settings.get("app.shortcut", DEFAULT_SHORTCUT)));
  if (app.isPackaged) { try { app.setLoginItemSettings({ openAtLogin: !!core.settings.get("app.autostart", false), args: ["--hidden"] }); } catch { /* non bloquant */ } }
  core.allProviders(true).catch(() => {});
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
});
app.on("before-quit", async (e) => { if (core && !(app as any).__closing) { e.preventDefault(); (app as any).__closing = true; await core.close().catch(() => {}); app.quit(); } });
app.on("will-quit", () => { globalShortcut.unregisterAll(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") quitApp(); });
