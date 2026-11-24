/** Lecture à voix haute des réponses, avec les voix installées sur l'ordinateur (aucun service en ligne). */
const strip = (md: string) => md
  .replace(/```[\s\S]*?```/g, " ")           // blocs de code et blocs riches : pas lus
  .replace(/`([^`]+)`/g, "$1").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/\$\$[\s\S]*?\$\$/g, " formule ").replace(/^#{1,6}\s*/gm, "").replace(/[*_>~|]/g, "").replace(/^\s*[-+]\s+/gm, "").replace(/\s+/g, " ").trim();
export const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;
export function speak(markdown: string, lang: string, onEnd: () => void): boolean {
  if (!canSpeak()) return false; const text = strip(markdown).slice(0, 6000); if (!text) return false;
  const synth = window.speechSynthesis; synth.cancel();
  const u = new SpeechSynthesisUtterance(text); u.lang = lang; const v = synth.getVoices().find((x) => x.lang?.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase())); if (v) u.voice = v;
  u.onend = onEnd; u.onerror = onEnd; synth.speak(u); return true;
}
export const stopSpeaking = () => { if (canSpeak()) window.speechSynthesis.cancel(); };
export { strip as plainTextForSpeech };
