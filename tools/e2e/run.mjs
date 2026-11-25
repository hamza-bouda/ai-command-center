// Tests de bout en bout de l'application construite (sans appel à une IA) : `npm run build -w @acc/desktop` puis `node tools/e2e/run.mjs`.
// Lance l'application avec un dossier de données temporaire, pilote l'interface par le port de débogage, vérifie ce qui doit l'être.
import { spawn } from "node:child_process"; import { mkdtempSync, rmSync } from "node:fs"; import { tmpdir } from "node:os"; import { join, resolve } from "node:path"; import { createRequire } from "node:module"; import { fileURLToPath } from "node:url";
import { connect } from "./cdp.mjs"; import { scenarios } from "./scenarios.mjs";
const require = createRequire(import.meta.url); const electron = require("electron"); const root = resolve(fileURLToPath(import.meta.url), "../../..");
const PORT = 9350 + Math.floor(Math.random() * 400); const data = mkdtempSync(join(tmpdir(), "acc-e2e-"));
const app = spawn(electron, [join(root, "apps/desktop"), `--remote-debugging-port=${PORT}`, `--user-data-dir=${data}`, "--disable-gpu"], { env: { ...process.env, ACC_E2E: "1" }, stdio: "ignore" });
let failed = 0, passed = 0;
try {
  const t = await connect(PORT); await t.api("onboarding.finish"); await t.send("Page.reload"); await t.sleep(2500); // installation vierge : l'introduction recouvrirait l'interface
  for (const [name, fn] of Object.entries(scenarios)) {
    const check = (label, ok, extra = "") => { if (ok) passed++; else failed++; console.log(`${ok ? "OK  " : "KO  "} [${name}] ${label}${extra ? "  " + extra : ""}`); };
    try { await fn(t, check); } catch (e) { failed++; console.log(`KO   [${name}] exception : ${String(e.message).slice(0, 300)}`); }
  }
  if (t.errors.length) { failed++; console.log("KO   erreurs JavaScript dans la page :", t.errors.slice(0, 3).join(" | ")); } else { passed++; console.log("OK   aucune erreur JavaScript dans la page"); }
  t.close();
} finally { app.kill(); await new Promise((r) => setTimeout(r, 800)); try { rmSync(data, { recursive: true, force: true }); } catch { /* fichiers encore verrouillés */ } }
console.log(`\n${passed} vérifications réussies, ${failed} échec(s).`); process.exit(failed ? 1 : 0);
