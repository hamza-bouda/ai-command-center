// Petit client CDP (port de débogage d'Electron) pour les scénarios de bout en bout.
export async function connect(port) {
  let pages; for (let i = 0; i < 60; i++) { try { pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (pages.some((p) => p.type === "page")) break; } catch { /* pas encore prêt */ } await new Promise((r) => setTimeout(r, 500)); }
  const page = pages?.find((p) => p.type === "page"); if (!page) throw new Error("fenêtre introuvable sur le port " + port);
  const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map(); const errors = [];
  ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } if (j.method === "Runtime.exceptionThrown") errors.push(JSON.stringify(j.params.exceptionDetails).slice(0, 300)); };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result.result.value; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const api = (m, ...a) => ev(`window.acc.call(${JSON.stringify(m)},${a.map((x) => JSON.stringify(x)).join(",")}).then(x=>JSON.stringify(x))`).then((v) => (v === undefined ? undefined : JSON.parse(v)));
  const rect = (js) => ev(`(()=>{const e=${js};if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  const mouse = (type, x, y) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
  const click = async (js) => { const r = await rect(js); if (!r) throw new Error("élément introuvable : " + js.slice(0, 80)); await mouse("mouseMoved", r.x, r.y); await mouse("mousePressed", r.x, r.y); await mouse("mouseReleased", r.x, r.y); };
  const drag = async (fromJs, toJs) => { const a = await rect(fromJs), b = await rect(toJs); if (!a || !b) throw new Error("poignée introuvable"); await mouse("mouseMoved", a.x, a.y); await mouse("mousePressed", a.x, a.y); await mouse("mouseMoved", (a.x + b.x) / 2, (a.y + b.y) / 2); await mouse("mouseMoved", b.x, b.y); await mouse("mouseReleased", b.x, b.y); };
  const key = (k, code, vk, mods = 0) => send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }).then(() => send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }));
  const setValue = (sel, v) => ev(`(()=>{const i=document.querySelector(${JSON.stringify(sel)});const proto=i.tagName==='TEXTAREA'?HTMLTextAreaElement:HTMLInputElement;Object.getOwnPropertyDescriptor(proto.prototype,'value').set.call(i,${JSON.stringify(v)});i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  const clickText = (t, sel = "button") => ev(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(sel)})].filter(x=>(x.innerText||x.getAttribute('aria-label')||'').includes(${JSON.stringify(t)})).pop();if(!b)return false;b.click();return true})()`);
  const waitFor = async (js, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(js)) return true; await sleep(150); } return false; };
  const go = async (hash) => { await ev("location.hash='/'"); await sleep(250); await ev(`location.hash=${JSON.stringify(hash)}`); await sleep(900); };
  await send("Runtime.enable"); await send("Page.bringToFront"); await send("Emulation.setFocusEmulationEnabled", { enabled: true }); await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  return { send, ev, sleep, api, rect, mouse, click, drag, key, setValue, clickText, waitFor, go, errors, close: () => ws.close() };
}
