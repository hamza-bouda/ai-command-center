import { defineConfig } from "vitest/config";
// Les tests qui lancent de vrais processus (PTY, CLI) sont lents sur les machines d'intégration continue : délai large.
export default defineConfig({ test: { testTimeout: 30000, hookTimeout: 30000 } });
