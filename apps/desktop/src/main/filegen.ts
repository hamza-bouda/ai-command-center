import { zipSync, strToU8 } from "fflate";
import { marked, type Token, type Tokens } from "marked";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, ExternalHyperlink } from "docx";
import { extOf, kindOf, unsupportedReason, parseBundle, parseCsv, parseSheets, parseSlides, type Kind, type Slide } from "../shared/filetypes";
export { OFFICE_SOURCES, UNSUPPORTED, extOf, kindOf, unsupportedReason, parseBundle, parseCsv, parseSheets, parseSlides } from "../shared/filetypes";

/**
 * Génération de fichiers à partir du texte écrit par l'IA dans un bloc « file » (le Chat n'a aucun outil : c'est l'application qui fabrique le fichier).
 * Texte : écrit tel quel. Word, Excel, PowerPoint, ZIP : construits ici à partir d'un format source simple. PDF : rendu par la fenêtre de l'application (voir main.ts).
 */
// ---------- ZIP ----------
export function makeZip(content: string): Buffer {
  const files = parseBundle(content); if (!files.length) throw new Error("Aucun fichier dans l'archive : chaque fichier doit commencer par une ligne « === chemin/nom.ext === ».");
  if (files.length > 200) throw new Error("Trop de fichiers dans l'archive (200 maximum)."); const seen = new Set<string>(); const entries: Record<string, Uint8Array> = {};
  for (const f of files) { let p = f.path; for (let i = 2; seen.has(p); i++) p = f.path.replace(/(\.[^./]+)?$/, `-${i}$1`); seen.add(p); entries[p] = strToU8(f.data); }
  return Buffer.from(zipSync(entries, { level: 6 }));
}

// ---------- XLSX (écrit à la main : un classeur valide est un ZIP de quelques fichiers XML) ----------
const xml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const colName = (i: number) => { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
export function makeXlsx(content: string): Buffer {
  const sheets = parseSheets(content); if (!sheets.length) throw new Error("Classeur vide."); if (sheets.length > 30) throw new Error("30 feuilles maximum.");
  const names = new Set<string>(); const clean = sheets.map((s, i) => { let n = s.name.replace(/[\[\]:*?/\\]/g, " ").trim().slice(0, 31) || `Feuille${i + 1}`; for (let k = 2; names.has(n.toLowerCase()); k++) n = `${n.slice(0, 28)} ${k}`; names.add(n.toLowerCase()); return { ...s, name: n }; });
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${clean.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${clean.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${clean.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${clean.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`),
  };
  clean.forEach((s, si) => {
    const rows = s.rows.slice(0, 100000); const width: number[] = [];
    const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.slice(0, 16000).map((v, ci) => {
      const ref = `${colName(ci)}${ri + 1}`; const style = ri === 0 ? ' s="1"' : ""; if (v === null || v === undefined || v === "") return ""; const str = typeof v === "string" ? v : String(v); width[ci] = Math.max(width[ci] ?? 0, Math.min(60, str.length));
      if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`; if (typeof v === "boolean") return `<c r="${ref}" t="b"${style}><v>${v ? 1 : 0}</v></c>`;
      if (str.startsWith("=") && str.length > 1) return `<c r="${ref}"${style}><f>${xml(str.slice(1))}</f></c>`; if (/^-?\d+(\.\d+)?$/.test(str.trim()) && str.trim().length < 16) return `<c r="${ref}"${style}><v>${str.trim()}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(str)}</t></is></c>`; }).join("")}</row>`).join("");
    const cols = width.length ? `<cols>${width.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(8, (w ?? 8) + 2)}" customWidth="1"/>`).join("")}</cols>` : "";
    files[`xl/worksheets/sheet${si + 1}.xml`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${body}</sheetData></worksheet>`);
  });
  return Buffer.from(zipSync(files, { level: 6 }));
}

// ---------- DOCX ----------
type Run = TextRun | ExternalHyperlink;
function inlineRuns(tokens: Token[] | undefined, style: { bold?: boolean; italics?: boolean; code?: boolean } = {}): Run[] {
  const out: Run[] = []; for (const t of tokens ?? []) {
    if (t.type === "strong") out.push(...inlineRuns((t as Tokens.Strong).tokens, { ...style, bold: true })); else if (t.type === "em") out.push(...inlineRuns((t as Tokens.Em).tokens, { ...style, italics: true }));
    else if (t.type === "codespan") out.push(new TextRun({ text: (t as Tokens.Codespan).text, font: "Consolas", ...style })); else if (t.type === "br") out.push(new TextRun({ break: 1 }));
    else if (t.type === "link") out.push(new ExternalHyperlink({ link: (t as Tokens.Link).href, children: [new TextRun({ text: (t as Tokens.Link).text, style: "Hyperlink", color: "0563C1", underline: {} })] }));
    else if ("tokens" in t && Array.isArray((t as any).tokens)) out.push(...inlineRuns((t as any).tokens, style)); else out.push(new TextRun({ text: String((t as any).text ?? (t as any).raw ?? "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'"), ...style }));
  } return out;
}
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
function blocks(tokens: Token[], level = 0): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const t of tokens) {
    if (t.type === "heading") out.push(new Paragraph({ heading: HEADINGS[Math.min(5, (t as Tokens.Heading).depth - 1)], children: inlineRuns((t as Tokens.Heading).tokens) }));
    else if (t.type === "paragraph") out.push(new Paragraph({ spacing: { after: 120 }, children: inlineRuns((t as Tokens.Paragraph).tokens) }));
    else if (t.type === "list") { const l = t as Tokens.List; l.items.forEach((it, i) => { const inline = it.tokens.filter((x) => x.type === "text" || x.type === "paragraph"); const kids = it.tokens.filter((x) => x.type === "list");
      out.push(new Paragraph({ ...(l.ordered ? { numbering: { reference: "num", level: Math.min(level, 3) } } : { bullet: { level: Math.min(level, 3) } }), children: inlineRuns(inline.flatMap((x) => ("tokens" in x ? (x as any).tokens : [x]))) })); void i; out.push(...(blocks(kids, level + 1) as Paragraph[])); }); }
    else if (t.type === "code") out.push(...(t as Tokens.Code).text.split("\n").map((line) => new Paragraph({ shading: { fill: "F2F2F2" }, children: [new TextRun({ text: line || " ", font: "Consolas", size: 20 })] })), new Paragraph({ children: [] }));
    else if (t.type === "blockquote") out.push(...(t as Tokens.Blockquote).tokens.filter((x) => x.type === "paragraph").map((p) => new Paragraph({ indent: { left: 540 }, children: inlineRuns((p as Tokens.Paragraph).tokens, { italics: true }) })));
    else if (t.type === "hr") out.push(new Paragraph({ border: { bottom: { style: "single" as any, size: 6, color: "999999", space: 1 } }, children: [] }));
    else if (t.type === "table") { const tb = t as Tokens.Table; const mk = (cells: Tokens.TableCell[], head: boolean) => new TableRow({ tableHeader: head, children: cells.map((c) => new TableCell({ shading: head ? { fill: "E8E8E8" } : undefined, children: [new Paragraph({ alignment: AlignmentType.LEFT, children: inlineRuns(c.tokens, head ? { bold: true } : {}) })] })) });
      out.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [mk(tb.header, true), ...tb.rows.map((r) => mk(r, false))] }), new Paragraph({ children: [] })); }
    else if (t.type === "text") out.push(new Paragraph({ children: inlineRuns((t as any).tokens ?? [t]) }));
  } return out;
}
export async function makeDocx(markdown: string): Promise<Buffer> {
  const tokens = marked.lexer(markdown); const doc = new Document({ numbering: { config: [{ reference: "num", levels: [0, 1, 2, 3].map((l) => ({ level: l, format: "decimal" as any, text: `%${l + 1}.`, alignment: AlignmentType.START })) }] }, sections: [{ children: blocks(tokens) as any }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

// ---------- PPTX ----------
/** PowerPoint écrit à la main (un .pptx est un ZIP de fichiers XML) : texte uniquement, mise en page sobre, aucune image. Les « Notes: » ne sont pas reprises. */
const EMU = 914400; const emu = (inches: number) => Math.round(inches * EMU);
const rPr = (sz: number, color: string, bold = false) => `<a:rPr lang="fr-FR" sz="${sz}"${bold ? ' b="1"' : ""} dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Calibri"/><a:cs typeface="Calibri"/></a:rPr>`;
const textBox = (id: number, name: string, x: number, y: number, w: number, h: number, paras: string, anchor = "t") => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xml(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="${anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`;
const rect = (id: number, x: number, y: number, w: number, h: number, color: string) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Bandeau ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
const para = (text: string, sz: number, color: string, opts: { bold?: boolean; bullet?: boolean; after?: number } = {}) => `<a:p><a:pPr${opts.bullet ? ' marL="342900" indent="-342900"' : ""}><a:spcAft><a:spcPts val="${(opts.after ?? 0) * 100}"/></a:spcAft>${opts.bullet ? '<a:buFont typeface="Arial"/><a:buChar char="&#8226;"/>' : "<a:buNone/>"}</a:pPr><a:r>${rPr(sz, color, opts.bold)}<a:t>${xml(text)}</a:t></a:r></a:p>`;
const W = 13.333, H = 7.5, INK = "1F1E1D", ACC = "B4532F", MUTED = "5A5955";
function slideXml(s: Slide, i: number, total: number): string {
  const first = i === 0 && s.bullets.length <= 2; let shapes = "";
  if (first) { shapes += rect(2, 0, 0, 0.35, H, ACC) + textBox(3, "Titre", 0.9, 2.2, 11.5, 1.8, para(s.title, 4000, INK, { bold: true }), "ctr"); if (s.bullets.length) shapes += textBox(4, "Sous-titre", 0.9, 4.1, 11.5, 1.3, s.bullets.map((b) => para(b, 2000, MUTED, { after: 4 })).join("")); }
  else { shapes += rect(2, 0, 0, W, 0.12, ACC) + textBox(3, "Titre", 0.6, 0.4, 12.1, 1.0, para(s.title, 2800, INK, { bold: true }), "ctr"); if (s.bullets.length) shapes += textBox(4, "Contenu", 0.7, 1.6, 11.9, 5.2, s.bullets.map((b) => para(b, s.bullets.length > 8 ? 1600 : 2000, INK, { bullet: true, after: 8 })).join("")); }
  shapes += textBox(9, "Numéro", 12.0, 6.95, 1.0, 0.4, `<a:p><a:pPr algn="r"/><a:r>${rPr(1000, "8A8883")}<a:t>${i + 1} / ${total}</a:t></a:r></a:p>`);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${first ? "FAF9F5" : "FFFFFF"}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="AI Command Center"><a:themeElements><a:clrScheme name="ACC"><a:dk1><a:srgbClr val="1F1E1D"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="3D3D3A"/></a:dk2><a:lt2><a:srgbClr val="FAF9F5"/></a:lt2><a:accent1><a:srgbClr val="B4532F"/></a:accent1><a:accent2><a:srgbClr val="E0865F"/></a:accent2><a:accent3><a:srgbClr val="4B8F6B"/></a:accent3><a:accent4><a:srgbClr val="3B7DD8"/></a:accent4><a:accent5><a:srgbClr val="8B7CF6"/></a:accent5><a:accent6><a:srgbClr val="F59E0B"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="7F3F98"/></a:folHlink></a:clrScheme><a:fontScheme name="ACC"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="ACC"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
const EMPTY_TREE = `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>`;
export async function makePptx(content: string): Promise<Buffer> {
  const slides = parseSlides(content); if (!slides.length) throw new Error("Présentation vide."); if (slides.length > 80) throw new Error("80 diapositives maximum.");
  const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"; const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("")}</Types>`),
    "_rels/.rels": strToU8(`${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`),
    "ppt/presentation.xml": strToU8(`${head}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join("")}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`),
    "ppt/_rels/presentation.xml.rels": strToU8(`${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="${R}/theme" Target="theme/theme1.xml"/>${slides.map((_, i) => `<Relationship Id="rId${i + 3}" Type="${R}/slide" Target="slides/slide${i + 1}.xml"/>`).join("")}</Relationships>`),
    "ppt/slideMasters/slideMaster1.xml": strToU8(`${head}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${EMPTY_TREE}</p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr marL="342900" indent="-342900"><a:defRPr sz="2800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`),
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": strToU8(`${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${R}/theme" Target="../theme/theme1.xml"/></Relationships>`),
    "ppt/slideLayouts/slideLayout1.xml": strToU8(`${head}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Vide">${EMPTY_TREE}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`),
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": strToU8(`${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`),
    "ppt/theme/theme1.xml": strToU8(THEME),
  };
  slides.forEach((s, i) => { files[`ppt/slides/slide${i + 1}.xml`] = strToU8(slideXml(s, i, slides.length)); files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = strToU8(`${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`); });
  return Buffer.from(zipSync(files, { level: 6 }));
}

// ---------- PDF : HTML à imprimer par la fenêtre de l'application ----------
export function pdfHtml(markdown: string, title: string): string {
  const body = marked.parse(markdown, { async: false }) as string; const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>${esc(title)}</title><style>
    body{font:11pt/1.55 "Segoe UI",Calibri,Arial,sans-serif;color:#1f1e1d;margin:0}h1{font-size:22pt;margin:0 0 .4em}h2{font-size:16pt;margin:1.2em 0 .4em}h3{font-size:13pt;margin:1em 0 .3em}p{margin:.5em 0}
    table{border-collapse:collapse;width:100%;margin:.8em 0}th,td{border:1px solid #bbb;padding:5px 8px;text-align:left;vertical-align:top}th{background:#eee}code{font-family:Consolas,monospace;background:#f2f2f2;padding:1px 4px;border-radius:3px}
    pre{background:#f5f5f4;border:1px solid #ddd;border-radius:6px;padding:10px;overflow:hidden;white-space:pre-wrap}pre code{background:none;padding:0}blockquote{border-left:3px solid #bbb;margin:.8em 0;padding:.1em 1em;color:#555}img{max-width:100%}a{color:#0563c1}hr{border:0;border-top:1px solid #bbb}</style></head><body>${body}</body></html>`;
}

/** Fabrique le fichier (hors PDF). Lève une erreur claire pour un format impossible ou une source invalide. */
export async function generateFile(name: string, content: string): Promise<Buffer> {
  const why = unsupportedReason(name); if (why) throw new Error(why); if (content.length > 12_000_000) throw new Error("Contenu trop volumineux (12 Mo maximum).");
  switch (kindOf(name)) { case "docx": return makeDocx(content); case "xlsx": return makeXlsx(content); case "pptx": return makePptx(content); case "zip": return makeZip(content); case "pdf": throw new Error("Le PDF est rendu par la fenêtre de l'application."); default: return Buffer.from(content, "utf8"); }
}
