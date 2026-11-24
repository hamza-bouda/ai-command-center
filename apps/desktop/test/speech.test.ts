import { describe, it, expect } from "vitest";
import { plainTextForSpeech } from "../src/renderer/speech";

describe("lecture à voix haute : texte lu", () => {
  it("retire le balisage, les blocs de code et les blocs riches, garde le texte utile", () => {
    const md = "## Titre\n\nUn **mot** et un [lien](https://x.y) avec `code`.\n\n```quiz\n{\"questions\":[]}\n```\n\n- point un\n- point deux\n\n$$E=mc^2$$\n\n![img](a.png)";
    const t = plainTextForSpeech(md); expect(t).toBe("Titre Un mot et un lien avec code. point un point deux formule"); expect(t).not.toMatch(/quiz|questions|https|\*|#|\$/);
  });
  it("vide si rien à lire", () => { expect(plainTextForSpeech("```chart\n{}\n```")).toBe(""); });
});
