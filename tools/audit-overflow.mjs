// Audit de non-débordement : parcourt toutes les pages à plusieurs tailles de fenêtre via le port de débogage Electron.
// Usage : lancer `electron . --remote-debugging-port=9333`, puis `node tools/audit-overflow.mjs` (ROUTES et SIZES optionnels).
const pages = await (await fetch(`http://127.0.0.1:${process.env.PORT ?? 9333}/json`)).json();
const ws = new WebSocket(pages.find((p) => p.type === "page").webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r)); let id = 0; const pend = new Map();
ws.onmessage = (m) => { const j = JSON.parse(m.data); pend.get(j.id)?.(j); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result.result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const routes = process.env.ROUTES ? process.env.ROUTES.split(",") : ["/","/overview","/chat","/work","/code","/projects","/agents","/tasks","/orchestrator","/sessions","/terminal","/analytics","/quotas","/git","/activity","/notifications","/settings","/quality","/automations","/workflows","/compare","/mcp"];
const CHECK = `(()=>{const vw=innerWidth,vh=innerHeight,out=[];const doc=document.documentElement;
if(doc.scrollWidth>vw+1)out.push('PAGE-HSCROLL '+doc.scrollWidth+'>'+vw);
if(document.body.scrollWidth>vw+1)out.push('BODY-HSCROLL '+document.body.scrollWidth);
const desc=e=>e.tagName.toLowerCase()+(e.className&&typeof e.className==='string'?'.'+e.className.split(' ').slice(0,3).join('.'):'')+' "'+(e.textContent||'').trim().slice(0,28)+'"';
for(const e of document.querySelectorAll('body *')){const cs=getComputedStyle(e);if(cs.display==='none'||cs.visibility==='hidden'||cs.position==='fixed'&&0)continue;const r=e.getBoundingClientRect();if(!r.width||!r.height)continue;
 if(r.right>vw+1&&!e.closest('[data-scroll],.overflow-auto,.overflow-x-auto,.overflow-hidden,table')&&cs.position!=='fixed')out.push('OFF-RIGHT '+desc(e)+' r='+Math.round(r.right));
 const p=e.parentElement;if(p&&p!==document.body){const pr=p.getBoundingClientRect(),pcs=getComputedStyle(p);if(pcs.overflowX==='visible'&&pr.width>0&&(r.right>pr.right+2||r.left<pr.left-2)&&cs.position!=='absolute'&&cs.position!=='fixed'&&!/^(svg|path|circle|line|rect|polyline)$/i.test(e.tagName)&&pr.height>0)out.push('OUT-OF-PARENT '+desc(e)+' by '+Math.round(Math.max(r.right-pr.right,pr.left-r.left)));}
 if(e.children.length===0&&e.textContent.trim()&&(e.scrollWidth>e.clientWidth+2)&&cs.overflowX==='visible'&&cs.display!=='inline'&&e.clientWidth>0)out.push('TEXT-OVERFLOW '+desc(e)+' '+e.scrollWidth+'>'+e.clientWidth);}
return [...new Set(out)].slice(0,12)})()`;

const BTN = `(()=>{const out=[];const desc=e=>e.tagName.toLowerCase()+' "'+((e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,28))+'"';
for(const e of document.querySelectorAll('button,a,[role=tab],[role=button],label,select,input,.badge,.btn,.chip')){const cs=getComputedStyle(e);if(cs.display==='none'||cs.visibility==='hidden')continue;const r=e.getBoundingClientRect();if(!r.width||!r.height)continue;
 if(e.scrollWidth>e.clientWidth+2&&cs.overflowX==='visible'&&cs.display!=='inline')out.push('BTN-CONTENT-OVERFLOW '+desc(e)+' '+e.scrollWidth+'>'+e.clientWidth);
 if(r.height<22&&e.textContent.trim().length>0&&cs.display!=='inline')out.push('BTN-TOO-SMALL '+desc(e)+' h='+Math.round(r.height));
 if(r.right>innerWidth+1||r.bottom>innerHeight+60&&0)out.push('BTN-OFFSCREEN '+desc(e)+' r='+Math.round(r.right));
 for(const k of e.querySelectorAll(':scope > *')){const kr=k.getBoundingClientRect();if(kr.width&&(kr.right>r.right+1||kr.left<r.left-1)&&getComputedStyle(k).position!=='absolute')out.push('BTN-CHILD-OUT '+desc(e)+' > '+k.tagName.toLowerCase()+' by '+Math.round(Math.max(kr.right-r.right,r.left-kr.left)));}}
return [...new Set(out)].slice(0,12)})()`;
const sizes = process.env.SIZES ? JSON.parse(process.env.SIZES) : [[1440,900],[1100,720],[900,700],[760,600]];
let total = 0;
for (const [w,h] of sizes) { await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  for (const r of routes) { await ev(`location.hash='${r}'`); await sleep(1500); const o = [...((await ev(CHECK))||[]), ...((await ev(BTN))||[])]; if (o?.length) { total += o.length; console.log(`[${w}x${h}] ${r}`); o.forEach((x) => console.log("   ", x)); } } }
console.log("TOTAL issues:", total); process.exit(0);
