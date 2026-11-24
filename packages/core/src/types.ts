export type ProviderId = "claude" | "codex";
export type ExecStatus = "draft"|"queued"|"preparing"|"running"|"waiting_approval"|"blocked"|"completed"|"failed"|"cancelled"|"interrupted";
export type TaskStatus = "backlog"|"todo"|"in_progress"|"review"|"done"|"blocked";
export type AuthMode = "subscription" | "api_key" | "unknown" | "unavailable";
export type Confidence = "reported" | "calculated" | "estimated" | "unknown";
export type CapState = "supported"|"unsupported"|"unknown"|"requires_approval"|"requires_billing"|"blocked_by_policy";

export interface Tokens {
  /** subset of cacheWrite billed at the 1h rate (Claude only) */ cacheWrite1h?: number;
  input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number; total: number;
}
export const zeroTokens = (): Tokens => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 });

export interface ProviderStatus {
  provider: ProviderId; installed: boolean; path?: string; version?: string;
  authenticated: boolean; authMode: AuthMode; account?: string; plan?: string;
  warnings: string[]; blockedReason?: string; checkedAt: string;
}
export interface EffortOption { value: string; description?: string }
export interface ModelInfo { id: string; displayName: string; isDefault?: boolean; description?: string; efforts?: EffortOption[]; defaultEffort?: string; capabilities?: string[]; category?: string; source?: "provider" | "cli-alias" | "observed" }
export interface QuotaWindow { label: string; usedPercent: number | null; windowMinutes?: number; resetsAt?: string; status?: string }
export interface QuotaStatus { provider: ProviderId; state: "available"|"limited"|"exhausted"|"auth_required"|"offline"|"unknown"; windows: QuotaWindow[]; note?: string; checkedAt: string }

export interface UsageReport {
  model: string; tokens: Tokens;
  mode: "incremental" | "cumulative" | "final";
  /** key identifying the counter being reported (thread id / session id) */
  counterKey: string;
  /** monotonic idempotency discriminator (turn id, message id, ...) */
  eventKey: string;
  providerCostUsd?: number;
  confidence: Confidence;
  /** for cumulative sources: the "last" step counters, allowing baseline inference on resumed threads */
  lastStep?: Tokens;
  /** compteur cumulatif démarré à zéro pour cette exécution (nouveau thread) */
  fresh?: boolean;
}

export type ExecEvent =
  | { type: "status"; detail?: string }
  | { type: "text"; text: string; final?: boolean }
  | { type: "tool"; id: string; name: string; summary: string; state: "started"|"completed"|"failed" }
  | { type: "file_change"; paths: string[] }
  | { type: "image"; id: string; mime: string; data: string; prompt?: string }
  | { type: "usage"; report: UsageReport }
  | { type: "quota"; quota: QuotaStatus }
  | { type: "session"; providerSessionId: string }
  | { type: "approval"; id: string; kind: string; summary: string }
  | { type: "applied"; model?: string; effort?: string | null; effortSource: "requested" | "provider_default" | "not_configurable" }
  | { type: "error"; message: string; quota?: boolean; auth?: boolean }
  | { type: "done"; ok: boolean; message?: string };

export interface RunRequest {
  executionId: string; prompt: string; cwd: string; model?: string;
  permission: "read-only" | "workspace-write";
  instructions?: string; resumeSessionId?: string;
  approvalPolicy: "never" | "on-request";
  /** Politique du mode d'expérience : conditionne outils, dossier et permissions réellement appliqués. */
  policy?: "chat" | "work" | "code"; effort?: string;
  /** Images jointes (base64) : transmises par les mécanismes officiels de chaque fournisseur. */
  images?: { name: string; mime: string; data: string }[];
  /** Serveurs MCP activés par l'utilisateur pour ce mode/cette conversation. */
  /** Chat uniquement : autorise la recherche web (WebSearch/WebFetch côté Claude, web_search côté Codex) pour cette exécution. */
  web?: boolean;
  /** Génération d'images (Codex, abonnement ChatGPT) : activée explicitement en Chat. */
  image?: boolean;
  mcp?: { name: string; transport: "stdio" | "http"; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string> }[];
}
export interface RunHandle { cancel(): Promise<void>; done: Promise<void> }
export interface ProviderEnvCheck { ok: boolean; stripped: string[]; flagged: string[] }
