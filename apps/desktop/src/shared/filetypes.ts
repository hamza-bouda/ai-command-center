/** Parties pures de la génération de fichiers (types, analyse des formats sources) : utilisées par l'interface (aperçu) et par le processus principal (fabrication). */
export const OFFICE_SOURCES: Record<string, string> = {
  docx: "Markdown (titres #, listes, tableaux, gras, liens)",
  xlsx: "CSV, ou JSON {\"sheets\":[{\"name\":\"…\",\"rows\":[[…],[…]]}]} ; une cellule « =FORMULE » devient une formule",
  pptx: "Markdown : une diapositive par bloc séparé d'une ligne « --- », titre en « # », puces en « - » ; ou JSON {\"slides\":[{\"title\":\"…\",\"bullets\":[…],\"notes\":\"…\"}]}",
  pdf: "Markdown (rendu en PDF A4)",
  zip: "plusieurs fichiers : chaque fichier commence par une ligne « === chemin/nom.ext === »",
};
/** Formats binaires que le Chat ne peut pas fabriquer (il faudrait exécuter du code) : message clair plutôt qu'un fichier corrompu. */
export const UNSUPPORTED = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "tiff", "psd", "mp3", "wav", "ogg", "flac", "mp4", "mov", "avi", "mkv", "webm", "exe", "dll", "msi", "bin", "so", "dylib", "iso", "7z", "rar", "gz", "tar", "sqlite", "db", "pkl", "parquet", "npy", "h5", "doc", "xls", "ppt", "odt", "ods", "odp", "pages", "numbers", "key", "epub", "mobi"]);
export type Kind = "text" | "docx" | "xlsx" | "pptx" | "zip" | "pdf";
export const extOf = (name: string) => (/\.([A-Za-z0-9]{1,10})$/.exec(name)?.[1] ?? "").toLowerCase();
export function kindOf(name: string): Kind { const e = extOf(name); return e === "docx" || e === "xlsx" || e === "pptx" || e === "zip" || e === "pdf" ? e : "text"; }
export function unsupportedReason(name: string): string | undefined {
  const e = extOf(name); if (!UNSUPPORTED.has(e)) return undefined;
  const hint = ["png", "jpg", "jpeg", "gif", "webp"].includes(e) ? " Pour une image, activez la génération d'images (Codex) ou demandez un SVG." : ["doc", "xls", "ppt"].includes(e) ? ` Demandez plutôt le format moderne (.${e}x).` : " Utilisez le mode Work ou Code, qui peut exécuter du code et produire ce fichier.";
  return `Le format .${e} est binaire : le Chat ne peut pas le fabriquer.${hint}`;
}

const safeEntry = (p: string) => p.replace(/\\/g, "/").split("/").filter((s) => s && s !== "." && s !== "..").map((s) => s.replace(/[<>:"|?*\u0000-\u001f]/g, "_")).join("/");
export function parseBundle(content: string): { path: string; data: string }[] {
  const out: { path: string; data: string }[] = []; const re = /^={3,}\s*(.+?)\s*={3,}\s*$/gm; const marks: { path: string; start: number; end: number }[] = []; let m: RegExpExecArray | null;
  while ((m = re.exec(content))) marks.push({ path: m[1]!, start: m.index, end: m.index + m[0].length });
  for (let i = 0; i < marks.length; i++) { const path = safeEntry(marks[i]!.path); if (!path) continue; const body = content.slice(marks[i]!.end, i + 1 < marks.length ? marks[i + 1]!.start : content.length).replace(/^\r?\n/, "").replace(/\r?\n$/, ""); out.push({ path, data: body }); }
  return out;
}
export function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? ""; const delim = [";", "\t", ","].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i]!; if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; } else if (c === '"') q = true; else if (c === delim) { row.push(cell); cell = ""; } else if (c === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; } else cell += c; }
  if (cell !== "" || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); } return rows;
}
export interface Sheet { name: string; rows: unknown[][] }
export function parseSheets(content: string): Sheet[] {
  const t = content.trim();
  if (t.startsWith("{") || t.startsWith("[")) { let j: any; try { j = JSON.parse(t); } catch { throw new Error("JSON invalide pour le classeur Excel."); } const sheets = Array.isArray(j) ? [{ name: "Feuille1", rows: j }] : Array.isArray(j?.sheets) ? j.sheets : null; if (!sheets) throw new Error("JSON attendu : {\"sheets\":[{\"name\":\"…\",\"rows\":[[…]]}]}."); return sheets.map((s: any, i: number) => ({ name: String(s?.name ?? `Feuille${i + 1}`), rows: (Array.isArray(s?.rows) ? s.rows : []).map((r: any) => (Array.isArray(r) ? r : Object.values(r ?? {}))) })); }
  return [{ name: "Feuille1", rows: parseCsv(content) }];
}
export interface Slide { title: string; bullets: string[]; notes?: string }
export function parseSlides(content: string): Slide[] {
  const t = content.trim();
  if (t.startsWith("{") || t.startsWith("[")) { let j: any; try { j = JSON.parse(t); } catch { throw new Error("JSON invalide pour la présentation."); } const list = Array.isArray(j) ? j : j?.slides; if (!Array.isArray(list)) throw new Error("JSON attendu : {\"slides\":[{\"title\":\"…\",\"bullets\":[…]}]}."); return list.map((s: any, i: number) => ({ title: String(s?.title ?? `Diapositive ${i + 1}`), bullets: (Array.isArray(s?.bullets) ? s.bullets : []).map(String), notes: s?.notes ? String(s.notes) : undefined })); }
  return t.split(/^\s*-{3,}\s*$/m).map((b) => b.trim()).filter(Boolean).map((block, i) => { const lines = block.split("\n").map((l) => l.trimEnd()); const h = lines.findIndex((l) => /^#{1,3}\s+/.test(l)); const title = h >= 0 ? lines[h]!.replace(/^#{1,3}\s+/, "") : `Diapositive ${i + 1}`; const rest = lines.filter((_, k) => k !== h).map((l) => l.replace(/^\s*[-*+]\s+/, "").replace(/^\s*\d+[.)]\s+/, "")).filter(Boolean); const noteAt = rest.findIndex((l) => /^notes?\s*:/i.test(l)); const bullets = noteAt >= 0 ? rest.slice(0, noteAt) : rest; const notes = noteAt >= 0 ? rest.slice(noteAt).join(" ").replace(/^notes?\s*:\s*/i, "") : undefined; return { title, bullets, notes }; });
}
