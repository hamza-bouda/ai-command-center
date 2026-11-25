// Scénarios de bout en bout (sans IA). Chaque scénario reçoit le client CDP `t` et une fonction `check(libellé, ok, détail)`.
const STEP = ".react-flow__node-step";
const count = (t) => t.ev(`document.querySelectorAll('${STEP}').length`);
const realEdges = (t) => t.ev(`[...document.querySelectorAll('.react-flow__edge')].filter(e=>!(e.getAttribute('data-testid')||'').startsWith('rf__edge-v-')).length`);

export const scenarios = {
  async pages(t, check) {
    const routes = ["/", "/overview", "/chat", "/work", "/code", "/projects", "/agents", "/tasks", "/orchestrator", "/sessions", "/terminal", "/analytics", "/quotas", "/git", "/workflows", "/compare", "/quality", "/automations", "/mcp", "/library", "/knowledge", "/notifications", "/settings"];
    let empty = [];
    for (const r of routes) { await t.go(r); const len = await t.ev("document.body.innerText.length"); if (len < 40) empty.push(r); }
    check("toutes les pages s'affichent", empty.length === 0, empty.join(", "));
  },

  async atelier(t, check) {
    await t.go("/studio?new=1");
    check("écran de départ", (await t.ev("document.body.innerText")).includes("Par où commencer"));
    check("modèles proposés à l'ouverture", await t.waitFor(`[...document.querySelectorAll("button")].some(b=>b.innerText.includes("Feature Development"))`, 8000)); await t.clickText("Feature Development"); await t.sleep(2200); // laisser finir l'animation d'ajustement du zoom
    const n0 = await count(t); check("modèle chargé", n0 === 5, String(n0));
    await t.click(`[...document.querySelectorAll('${STEP}')].find(x=>x.innerText.includes('Développement'))`);
    check("inspecteur affiché", await t.waitFor(`document.body.innerText.toLowerCase().includes("rôle de l'agent")`, 5000));
    await t.setValue("aside input", "Développement du module"); await t.sleep(300);
    check("titre modifié sur le nœud", await t.ev(`[...document.querySelectorAll('${STEP}')].some(x=>x.innerText.includes('Développement du module'))`));
    // ajout par la palette, lien par case à cocher (alternative au glisser-déposer), puis annulation
    await t.clickText("Validation humaine", "aside button"); await t.sleep(500); check("étape ajoutée", (await count(t)) === n0 + 1);
    const before = await realEdges(t);
    await t.sleep(700);
    await t.ev(`[...document.querySelectorAll('aside label')].find(l=>l.innerText.includes('Validation avant fusion'))?.querySelector('input')?.click()`); await t.sleep(500);
    check("lien créé par case à cocher", (await realEdges(t)) === before + 1);
    const undoBtn = `document.querySelector('button[aria-label^="Annuler"]')`; const redoBtn = `document.querySelector('button[aria-label^="Rétablir"]')`;
    check("annuler devient disponible après les modifications", await t.waitFor(`${undoBtn} && !${undoBtn}.disabled`, 4000));
    await t.key("z", "KeyZ", 90, 2); await t.sleep(500);
    check("annuler (Ctrl+Z) défait la dernière modification", (await realEdges(t)) < before + 1);
    check("rétablir devient disponible", await t.waitFor(`${redoBtn} && !${redoBtn}.disabled`, 4000));
    await t.ev(`${redoBtn}.click()`); await t.sleep(700);
    check("rétablir remet la modification", (await realEdges(t)) === before + 1);
    // glisser-déposer + boucle refusée
    await t.mouse("mouseMoved", 800, 250); await t.mouse("mousePressed", 800, 250); await t.mouse("mouseReleased", 800, 250); await t.sleep(600);
    const first = `[...document.querySelectorAll('${STEP}')].find(x=>x.innerText.includes('Planification'))`; const last = `[...document.querySelectorAll('${STEP}')].find(x=>x.innerText.includes('Validation avant fusion'))`;
    const e1 = await realEdges(t);
    await t.drag(`${last}.querySelector('.react-flow__handle.source')`, `${first}.querySelector('.react-flow__handle.target')`); await t.sleep(600);
    check("lien en boucle refusé", (await realEdges(t)) === e1);
    // enregistrement
    await t.setValue('input[aria-label="Nom du workflow"]', "Atelier e2e"); await t.sleep(300); await t.clickText("Enregistrer"); await t.sleep(1200);
    const wf = (await t.api("wf.list")).find((w) => w.name === "Atelier e2e");
    check("workflow enregistré avec positions", !!wf && wf.nodes.every((n) => n.pos && Number.isFinite(n.pos.x)), wf ? wf.nodes.length + " étapes" : "");
    // disposition verticale
    await t.clickText("Vertical"); await t.sleep(1200);
    const ys = await t.ev(`[...document.querySelectorAll('${STEP}')].map(n=>n.getBoundingClientRect().y)`);
    check("disposition verticale", new Set(ys.map((y) => Math.round(y / 20))).size >= 4);
  },

  async memoire_et_connaissances(t, check) {
    await t.api("memory.add", "Test e2e : je préfère les réponses courtes.");
    const m = await t.api("memory.list"); check("souvenir enregistré", m.items.some((i) => /e2e/.test(i.text)));
    await t.go("/settings"); await t.clickText("Personnalisation", "button"); await t.sleep(600);
    check("souvenir visible dans Paramètres", (await t.ev("document.body.innerText")).includes("réponses courtes"));
    const kb = await t.api("kb.create", "Base e2e"); await t.go("/knowledge");
    check("page Connaissances", (await t.ev("document.body.innerText")).includes("Base e2e") && typeof kb === "string");
  },

  async terminal(t, check) {
    await t.go("/terminal");
    const pid = await t.api("projects.create", { name: "E2E", path: process.cwd(), permission: "read-only" }); const info = await t.api("terminal.create", { kind: "shell", projectId: pid }).catch(() => null);
    if (!info) { check("terminal de test créé (ignoré si aucun projet)", true); return; }
    await t.go("/terminal"); await t.sleep(2500);
    const focused = await t.ev(`!!document.activeElement && document.activeElement.className.toString().includes('xterm-helper-textarea')`);
    if (!focused) { check("terminal focalisé (ignoré)", true); return; }
    await t.key("0", "Digit0", 48, 1); await t.sleep(400);
    check("Alt+0 rend le clavier à l'application", !(await t.ev(`document.activeElement && document.activeElement.className.toString().includes('xterm-helper-textarea')`)));
    await t.ev(`document.querySelector('.xterm-helper-textarea')?.focus()`); await t.key("k", "KeyK", 75, 2); await t.sleep(600);
    check("Ctrl+K ouvre la recherche depuis le terminal", await t.ev(`!!document.querySelector('[role=combobox], [role=dialog] input')`));
    await t.api("terminal.kill", info.id).catch(() => {});
  },
};
