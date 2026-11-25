import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { generateFile, parseCsv, parseSheets, parseSlides, parseBundle, kindOf, unsupportedReason, pdfHtml } from "../src/main/filegen";

const unzip = (b: Buffer) => unzipSync(new Uint8Array(b));
const text = (z: Record<string, Uint8Array>, name: string) => strFromU8(z[name]!);

describe("génération de fichiers depuis le texte de l'IA", () => {
  it("type de fichier selon l'extension ; formats binaires refusés avec une explication", () => {
    expect(kindOf("a.docx")).toBe("docx"); expect(kindOf("a.XLSX")).toBe("xlsx"); expect(kindOf("a.pdf")).toBe("pdf"); expect(kindOf("a.ipynb")).toBe("text"); expect(kindOf("Makefile")).toBe("text");
    expect(unsupportedReason("photo.png")).toMatch(/génération d'images/); expect(unsupportedReason("x.mp3")).toMatch(/Work ou Code/); expect(unsupportedReason("vieux.doc")).toMatch(/\.docx/); expect(unsupportedReason("ok.py")).toBeUndefined();
  });
  it("texte : écrit tel quel (UTF-8)", async () => { expect((await generateFile("a.csv", "é,b\n1,2")).toString("utf8")).toBe("é,b\n1,2"); await expect(generateFile("a.png", "x")).rejects.toThrow(/binaire/); });

  it("Word : Markdown → .docx valide (titres, liste, tableau, gras, lien)", async () => {
    const md = "# Rapport\n\nUn **mot** important et un [lien](https://exemple.fr).\n\n- point un\n- point deux\n\n1. premier\n2. second\n\n| Nom | Valeur |\n|---|---|\n| a | 1 |\n\n```js\nconst x = 1;\n```\n";
    const z = unzip(await generateFile("rapport.docx", md)); expect(Object.keys(z)).toContain("word/document.xml"); const doc = text(z, "word/document.xml");
    for (const s of ["Rapport", "mot", "point deux", "second", "Valeur", "const x = 1;"]) expect(doc).toContain(s); expect(doc).toContain("w:tbl"); expect(doc).toMatch(/Heading1/);
  });
  it("Excel : CSV (séparateur détecté, guillemets) et JSON multi-feuilles, formules, en-tête figé", async () => {
    expect(parseCsv('a;b\n"x;y";2\n')).toEqual([["a", "b"], ["x;y", "2"]]); expect(parseCsv('a,b\n"il dit ""oui""",2')[1]).toEqual(['il dit "oui"', "2"]);
    const z = unzip(await generateFile("d.xlsx", 'Produit;Prix\nPomme;1,5\nPoire;2\n=SUM(B2:B3);')); const s1 = text(z, "xl/worksheets/sheet1.xml"); expect(s1).toContain("Pomme"); expect(s1).toContain("<f>SUM(B2:B3)</f>"); expect(s1).toContain('state="frozen"'); expect(text(z, "xl/workbook.xml")).toContain("Feuille1");
    const j = unzip(await generateFile("m.xlsx", JSON.stringify({ sheets: [{ name: "Ventes", rows: [["Mois", "Total"], ["Jan", 10], ["Fév", 12.5]] }, { name: "Ventes", rows: [["x"]] }] })));
    expect(text(j, "xl/workbook.xml")).toMatch(/Ventes[\s\S]*Ventes 2/); expect(text(j, "xl/worksheets/sheet1.xml")).toContain("<v>12.5</v>"); expect(() => parseSheets("{bad")).toThrow(/JSON invalide/);
  });
  it("PowerPoint : Markdown ou JSON → .pptx (une diapositive par bloc ; les notes sont reconnues mais non reprises)", async () => {
    const slides = parseSlides("# Titre\nSous-titre\n---\n# Plan\n- un\n- deux\nNotes: dire bonjour"); expect(slides.map((s) => s.title)).toEqual(["Titre", "Plan"]); expect(slides[1]!.bullets).toEqual(["un", "deux"]); expect(slides[1]!.notes).toBe("dire bonjour");
    const z = unzip(await generateFile("p.pptx", "# Titre\nSous-titre\n---\n# Plan\n- un\n- deux\nNotes: dire bonjour")); const names = Object.keys(z); expect(names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))).toHaveLength(2); expect(text(z, "ppt/slides/slide2.xml")).toContain("deux");
    const j = unzip(await generateFile("q.pptx", JSON.stringify({ slides: [{ title: "A", bullets: ["x"] }] }))); expect(text(j, "ppt/slides/slide1.xml")).toContain("A");
  });
  it("ZIP : plusieurs fichiers, chemins nettoyés (jamais de remontée de dossier), doublons renommés", async () => {
    const src = "=== src/app.py ===\nprint('a')\n=== ../../evil.txt ===\nx\n=== C:\\win\\abs.txt ===\ny\n=== src/app.py ===\nprint('b')\n"; expect(parseBundle(src).map((f) => f.path)).toEqual(["src/app.py", "evil.txt", "C_/win/abs.txt", "src/app.py"]);
    const z = unzip(await generateFile("p.zip", src)); expect(Object.keys(z).sort()).toEqual(["C_/win/abs.txt", "evil.txt", "src/app-2.py", "src/app.py"]); expect(text(z, "src/app.py")).toBe("print('a')"); await expect(generateFile("v.zip", "rien")).rejects.toThrow(/Aucun fichier/);
  });
  it("PDF : HTML autonome, sans script ni réseau (CSP stricte), titre échappé", () => {
    const h = pdfHtml("# Bonjour\n\n<script>alert(1)</script>\n\n| a | b |\n|---|---|\n| 1 | 2 |", "<Rapport>"); expect(h).toContain("default-src 'none'"); expect(h).toContain("&lt;Rapport&gt;"); expect(h).toContain("<table>"); expect(h).toContain("<h1>Bonjour</h1>");
  });
});
