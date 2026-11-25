import { describe, it, expect } from "vitest";
import { connectMcp, cancelConnect, MCP_NAME, MCP_URL } from "../src/mcpauth.js";

describe("connexion OAuth des serveurs MCP distants : garde-fous", () => {
  it("noms et adresses strictement validés (aucune injection possible dans la ligne de commande)", () => {
    for (const ok of ["canva", "mon-serveur_2"]) expect(MCP_NAME.test(ok)).toBe(true); for (const bad of ["", "Canva", "a b", "x;rm", "../x", "a".repeat(41)]) expect(MCP_NAME.test(bad)).toBe(false);
    expect(MCP_URL.test("https://mcp.canva.com/mcp")).toBe(true); for (const bad of ["http://x.com/mcp", "https://x.com/a b", "https://x.com/a\"b", "https://x.com/$(id)", "https://x.com/;ls", "javascript:alert(1)", "https://x.com/a`b"]) expect(MCP_URL.test(bad)).toBe(false);
  });
  it("refuse les paramètres invalides sans lancer aucun processus", async () => {
    const base = { provider: "claude" as const, dir: "x", name: "canva", url: "https://mcp.canva.com/mcp" };
    expect((await connectMcp({ ...base, name: "Mauvais Nom" })).message).toMatch(/Nom de serveur invalide/); expect((await connectMcp({ ...base, url: "http://x.com" })).message).toMatch(/https/);
    expect((await connectMcp({ ...base, callbackPort: 80 })).message).toMatch(/Port/); expect((await connectMcp({ ...base, clientId: "a b; c" })).message).toMatch(/Identifiant/);
  });
  it("annulation sans connexion en cours : sans effet", () => { expect(cancelConnect("claude", "canva")).toBe(false); });
});
