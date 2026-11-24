import { lazy, Suspense, useEffect, useState } from "react"; import { applyLanguage } from "./i18n";
import { HashRouter, Route, Routes } from "react-router-dom";
import { Shell } from "./Shell"; import { OverlayHost } from "./overlay"; import { LoadingSkeleton } from "./ui";
const Dashboard = lazy(() => import("./pages/Dashboard")); const Projects = lazy(() => import("./pages/Projects")); const Agents = lazy(() => import("./pages/Agents"));
const Tasks = lazy(() => import("./pages/Tasks")); const Sessions = lazy(() => import("./pages/Sessions")); const Analytics = lazy(() => import("./pages/Analytics"));
const Home = lazy(() => import("./pages/Home")); const Chat = lazy(() => import("./pages/Chat")); const Work = lazy(() => import("./pages/Work")); const Code = lazy(() => import("./pages/Code"));
const Workflows = lazy(() => import("./pages/Workflows")); const Compare = lazy(() => import("./pages/Compare")); const McpSkills = lazy(() => import("./pages/McpSkills"));
const Quality = lazy(() => import("./pages/Quality")); const Automations = lazy(() => import("./pages/Automations"));
const Terminal = lazy(() => import("./pages/Terminal")); const Quotas = lazy(() => import("./pages/Quotas")); const Settings = lazy(() => import("./pages/Settings")); const Orchestrator = lazy(() => import("./pages/Orchestrator"));
const Misc = lazy(() => import("./pages/Misc").then((m) => ({ default: m.Notifications }))); const Git = lazy(() => import("./pages/Misc").then((m) => ({ default: m.Git })));
const Activity = lazy(() => import("./pages/Misc").then((m) => ({ default: m.ActivityPage })));
const ExportView = lazy(() => import("./pages/Export")); const Quick = lazy(() => import("./pages/Quick")); const Onboarding = lazy(() => import("./components/Onboarding").then((m) => ({ default: m.Onboarding }))); const Library = lazy(() => import("./pages/Library"));
export default function App() {
  // Le lanceur rapide est une fenêtre à part : pas de barre latérale ni de barre du haut.
  if (window.location.hash.startsWith("#/quick")) return <Suspense fallback={null}><Quick /></Suspense>;
  if (window.location.hash.startsWith("#/export/")) return <Suspense fallback={null}><ExportView id={decodeURIComponent(window.location.hash.slice("#/export/".length))} /></Suspense>;
  return <MainApp />;
}
function MainApp() {
  const [welcome, setWelcome] = useState(false);
  useEffect(() => { void window.acc.call("onboarding.state").then((s: any) => { if (s.done) return; if (s.fresh) setWelcome(true); else void window.acc.call("onboarding.finish"); }).catch(() => {}); const open = () => setWelcome(true); window.addEventListener("acc-onboarding", open); return () => window.removeEventListener("acc-onboarding", open); }, []);
  useEffect(() => window.acc.onNavigate((h) => { window.location.hash = h; }), []); // ouvertures demandées par le lanceur ou l'icône de notification
  useEffect(() => { window.acc.call("settings.all").then((s: any) => { if (s?.["ui.language"]) void applyLanguage(s["ui.language"]); }).catch(() => {}); }, []);
  return <HashRouter><Shell><Suspense fallback={<div className="p-8"><LoadingSkeleton cards={4} rows={3} /></div>}><Routes>
    <Route path="/" element={<Home />} /><Route path="/overview" element={<Dashboard />} /><Route path="/chat" element={<Chat />} /><Route path="/work" element={<Work />} /><Route path="/code" element={<Code />} /><Route path="/projects" element={<Projects />} /><Route path="/agents" element={<Agents />} /><Route path="/tasks" element={<Tasks />} /><Route path="/orchestrator" element={<Orchestrator />} />
    <Route path="/sessions" element={<Sessions />} /><Route path="/terminal" element={<Terminal />} /><Route path="/analytics" element={<Analytics />} /><Route path="/quotas" element={<Quotas />} /><Route path="/git" element={<Git />} /><Route path="/activity" element={<Activity />} />
    <Route path="/notifications" element={<Misc />} /><Route path="/settings" element={<Settings />} />
    <Route path="/library" element={<Library />} /><Route path="/quality" element={<Quality />} /><Route path="/automations" element={<Automations />} /><Route path="/workflows" element={<Workflows />} /><Route path="/compare" element={<Compare />} /><Route path="/mcp" element={<McpSkills />} />
  </Routes></Suspense></Shell><OverlayHost />{welcome && <Suspense fallback={null}><Onboarding onClose={() => setWelcome(false)} /></Suspense>}</HashRouter>;
}
