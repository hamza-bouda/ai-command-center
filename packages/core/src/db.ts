import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncT } from "node:sqlite";
const nodeRequire = createRequire(process.cwd() + "/");
const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type DB = DatabaseSyncT;
export const uid = () => randomUUID();
export const now = () => new Date().toISOString();

const MIGRATIONS: string[] = [
`CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE provider_auth_states (provider TEXT PRIMARY KEY, installed INTEGER, path TEXT, version TEXT, authenticated INTEGER, auth_mode TEXT, account TEXT, plan TEXT, warnings TEXT, blocked_reason TEXT, checked_at TEXT);
CREATE TABLE quota_snapshots (id TEXT PRIMARY KEY, provider TEXT NOT NULL, state TEXT, windows TEXT, note TEXT, created_at TEXT NOT NULL);
CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, path TEXT NOT NULL, git_repo INTEGER DEFAULT 0, main_branch TEXT, default_provider TEXT, default_model TEXT, instructions TEXT, permission TEXT DEFAULT 'workspace-write', max_concurrency INTEGER DEFAULT 3, use_worktrees INTEGER DEFAULT 0, archived INTEGER DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE agent_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, icon TEXT, color TEXT, provider TEXT NOT NULL, model TEXT, specialty TEXT, instructions TEXT, permission TEXT DEFAULT 'workspace-write', approval_policy TEXT DEFAULT 'never', priority INTEGER DEFAULT 5, max_concurrency INTEGER DEFAULT 1, project_id TEXT REFERENCES projects(id), created_at TEXT NOT NULL);
CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL, description TEXT, agent_id TEXT REFERENCES agent_profiles(id), provider TEXT, model TEXT, priority INTEGER DEFAULT 5, status TEXT NOT NULL DEFAULT 'todo', result TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, archived INTEGER DEFAULT 0);
CREATE TABLE task_dependencies (task_id TEXT NOT NULL REFERENCES tasks(id), depends_on TEXT NOT NULL REFERENCES tasks(id), PRIMARY KEY(task_id, depends_on));
CREATE TABLE agent_executions (id TEXT PRIMARY KEY, task_id TEXT REFERENCES tasks(id), agent_id TEXT REFERENCES agent_profiles(id), project_id TEXT REFERENCES projects(id), provider TEXT NOT NULL, model TEXT, prompt TEXT NOT NULL, cwd TEXT, worktree_id TEXT, status TEXT NOT NULL, attempt INTEGER DEFAULT 1, provider_session_id TEXT, priority INTEGER DEFAULT 5, pid INTEGER, error TEXT, result_text TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, duration_ms INTEGER, parent_execution_id TEXT);
CREATE INDEX idx_exec_status ON agent_executions(status);
CREATE INDEX idx_exec_project ON agent_executions(project_id);
CREATE INDEX idx_exec_task ON agent_executions(task_id);
CREATE TABLE exec_transitions (id TEXT PRIMARY KEY, execution_id TEXT NOT NULL REFERENCES agent_executions(id), from_status TEXT, to_status TEXT NOT NULL, detail TEXT, at TEXT NOT NULL);
CREATE TABLE exec_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, execution_id TEXT NOT NULL REFERENCES agent_executions(id), kind TEXT NOT NULL, content TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX idx_logs_exec ON exec_logs(execution_id);
CREATE TABLE usage_snapshots (counter_key TEXT PRIMARY KEY, execution_id TEXT, input INTEGER, output INTEGER, cache_read INTEGER, cache_write INTEGER, reasoning INTEGER, total INTEGER, baseline TEXT, updated_at TEXT);
CREATE TABLE usage_events (id TEXT PRIMARY KEY, idem_key TEXT NOT NULL UNIQUE, execution_id TEXT NOT NULL REFERENCES agent_executions(id), provider TEXT NOT NULL, model TEXT, task_id TEXT, agent_id TEXT, project_id TEXT, input INTEGER, output INTEGER, cache_read INTEGER, cache_write INTEGER, cache_write_1h INTEGER DEFAULT 0, reasoning INTEGER, total INTEGER, confidence TEXT NOT NULL, source TEXT NOT NULL, note TEXT, provider_cost_usd REAL, created_at TEXT NOT NULL);
CREATE INDEX idx_usage_time ON usage_events(created_at);
CREATE INDEX idx_usage_proj ON usage_events(project_id);
CREATE TABLE pricing_versions (id TEXT PRIMARY KEY, label TEXT NOT NULL, source TEXT, verified_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE model_pricing (id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES pricing_versions(id), provider TEXT NOT NULL, model_id TEXT NOT NULL, aliases TEXT, family TEXT, tier TEXT DEFAULT 'standard', input_per_m REAL, output_per_m REAL, cache_read_per_m REAL, cache_write_per_m REAL, cache_write_1h_per_m REAL, long_ctx_threshold INTEGER, long_input_per_m REAL, long_output_per_m REAL, long_cache_read_per_m REAL, long_cache_write_per_m REAL, currency TEXT DEFAULT 'USD', source_url TEXT, note TEXT);
CREATE INDEX idx_pricing_model ON model_pricing(provider, model_id);
CREATE TABLE cost_estimates (usage_event_id TEXT PRIMARY KEY REFERENCES usage_events(id), pricing_id TEXT, pricing_version TEXT, calculated_usd REAL, status TEXT NOT NULL, detail TEXT, calculated_at TEXT NOT NULL);
CREATE TABLE approvals (id TEXT PRIMARY KEY, execution_id TEXT NOT NULL, kind TEXT, summary TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT);
CREATE TABLE notifications (id TEXT PRIMARY KEY, level TEXT NOT NULL, title TEXT NOT NULL, body TEXT, category TEXT, read INTEGER DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE audit_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, provider TEXT, project_id TEXT, agent_id TEXT, task_id TEXT, execution_id TEXT, payload TEXT, at TEXT NOT NULL);
CREATE TABLE git_worktrees (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), execution_id TEXT, branch TEXT NOT NULL, path TEXT NOT NULL, base_branch TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL);`,
`ALTER TABLE tasks ADD COLUMN orchestration_id TEXT;
ALTER TABLE tasks ADD COLUMN node_key TEXT;
ALTER TABLE tasks ADD COLUMN node_kind TEXT DEFAULT 'agent';
ALTER TABLE tasks ADD COLUMN gate INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN role TEXT;
CREATE TABLE orchestrations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), goal TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL, planner_provider TEXT, planner_execution_id TEXT, planner_text TEXT, plan_json TEXT, report TEXT, use_worktrees INTEGER DEFAULT 0, error TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT);
CREATE TABLE handoffs (id TEXT PRIMARY KEY, orchestration_id TEXT NOT NULL REFERENCES orchestrations(id), from_task_id TEXT NOT NULL, to_task_id TEXT NOT NULL, from_execution_id TEXT, payload TEXT NOT NULL, chars INTEGER, created_at TEXT NOT NULL);
CREATE TABLE orch_gates (id TEXT PRIMARY KEY, orchestration_id TEXT NOT NULL REFERENCES orchestrations(id), task_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, summary TEXT, created_at TEXT NOT NULL, resolved_at TEXT);
CREATE TABLE orch_events (id TEXT PRIMARY KEY, orchestration_id TEXT NOT NULL REFERENCES orchestrations(id), type TEXT NOT NULL, detail TEXT, task_id TEXT, at TEXT NOT NULL);
CREATE INDEX idx_tasks_orch ON tasks(orchestration_id);
CREATE INDEX idx_handoffs_orch ON handoffs(orchestration_id);`,
`ALTER TABLE agent_executions ADD COLUMN mode TEXT DEFAULT 'code';
ALTER TABLE agent_executions ADD COLUMN conversation_id TEXT;
ALTER TABLE agent_executions ADD COLUMN effort_requested TEXT;
ALTER TABLE agent_executions ADD COLUMN effort_applied TEXT;
ALTER TABLE agent_executions ADD COLUMN policy_note TEXT;
CREATE TABLE conversations (id TEXT PRIMARY KEY, mode TEXT NOT NULL, submode TEXT, title TEXT NOT NULL, provider TEXT NOT NULL, model TEXT, effort TEXT, project_id TEXT REFERENCES projects(id), work_id TEXT, favorite INTEGER DEFAULT 0, archived INTEGER DEFAULT 0, provider_session_id TEXT, session_provider TEXT, pending_context TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE conversation_messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL, provider TEXT, model TEXT, effort_applied TEXT, execution_id TEXT, status TEXT, created_at TEXT NOT NULL);
CREATE TABLE conversation_config_history (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, kind TEXT NOT NULL, detail TEXT, config TEXT, at TEXT NOT NULL);
CREATE TABLE works (id TEXT PRIMARY KEY, title TEXT NOT NULL, goal TEXT, status TEXT NOT NULL DEFAULT 'active', conversation_id TEXT, dir TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE work_files (id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE, name TEXT NOT NULL, original_path TEXT, copied_path TEXT NOT NULL, added_at TEXT NOT NULL);
CREATE TABLE work_steps (id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'todo', note TEXT, position INTEGER NOT NULL, source TEXT DEFAULT 'user', updated_at TEXT NOT NULL);
CREATE TABLE work_events (id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE, type TEXT NOT NULL, detail TEXT, at TEXT NOT NULL);
CREATE INDEX idx_conv_mode ON conversations(mode, archived, updated_at);
CREATE INDEX idx_msg_conv ON conversation_messages(conversation_id, created_at);
CREATE INDEX idx_exec_conv ON agent_executions(conversation_id);
CREATE INDEX idx_exec_mode ON agent_executions(mode);`,
`ALTER TABLE agent_executions ADD COLUMN permission TEXT;
ALTER TABLE orchestrations ADD COLUMN workflow_id TEXT;
CREATE TABLE workflows (id TEXT PRIMARY KEY, key TEXT, name TEXT NOT NULL, description TEXT, nodes TEXT NOT NULL, builtin INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE comparisons (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), prompt TEXT NOT NULL, write INTEGER DEFAULT 0, status TEXT NOT NULL DEFAULT 'running', winner_run_id TEXT, note TEXT, synthesis_execution_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE comparison_runs (id TEXT PRIMARY KEY, comparison_id TEXT NOT NULL REFERENCES comparisons(id) ON DELETE CASCADE, label TEXT, provider TEXT NOT NULL, model TEXT, effort TEXT, execution_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE project_memory (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL, content TEXT NOT NULL, kind TEXT DEFAULT 'note', pinned INTEGER DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX idx_memory_project ON project_memory(project_id);
CREATE INDEX idx_wf_orch ON orchestrations(workflow_id);`,
`CREATE TABLE test_runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), kind TEXT NOT NULL, command TEXT NOT NULL, status TEXT NOT NULL, exit_code INTEGER, duration_ms INTEGER, passed INTEGER, failed INTEGER, total INTEGER, regression INTEGER DEFAULT 0, output_tail TEXT, source TEXT DEFAULT 'manual', ref_id TEXT, created_at TEXT NOT NULL);
CREATE INDEX idx_testruns_proj ON test_runs(project_id, kind, created_at);
CREATE TABLE reviews (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), provider TEXT NOT NULL, execution_id TEXT, files TEXT, diff_chars INTEGER, created_at TEXT NOT NULL);
CREATE TABLE automations (id TEXT PRIMARY KEY, name TEXT NOT NULL, trigger_kind TEXT NOT NULL, trigger_config TEXT NOT NULL, action_kind TEXT NOT NULL, action_config TEXT NOT NULL, enabled INTEGER DEFAULT 1, catchup INTEGER DEFAULT 0, max_runs_per_day INTEGER DEFAULT 20, trigger_state TEXT, last_run_at TEXT, next_run_at TEXT, last_status TEXT, confirmed_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE automation_runs (id TEXT PRIMARY KEY, automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE, at TEXT NOT NULL, trigger TEXT, status TEXT NOT NULL, detail TEXT, ref_id TEXT);
CREATE INDEX idx_autoruns ON automation_runs(automation_id, at);`,
`CREATE TABLE extensions (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, config TEXT NOT NULL, modes TEXT NOT NULL, enabled INTEGER DEFAULT 1, created_at TEXT NOT NULL, UNIQUE(kind, name));
ALTER TABLE conversations ADD COLUMN ext_disabled TEXT;`,
`ALTER TABLE conversations ADD COLUMN style TEXT;`,
`ALTER TABLE conversations ADD COLUMN parent_id TEXT;`,
`ALTER TABLE conversations ADD COLUMN web INTEGER DEFAULT 0;`,
`ALTER TABLE conversations ADD COLUMN image INTEGER DEFAULT 0;`,
];

export const MIGRATION_COUNT = () => MIGRATIONS.length;
export function openDb(file: string): DB {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  migrate(db);
  return db;
}
export function migrate(db: DB) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const cur = (db.prepare("SELECT COALESCE(MAX(version),0) v FROM schema_migrations").get() as { v: number }).v;
  for (let i = cur; i < MIGRATIONS.length; i++) {
    db.exec("BEGIN");
    try { db.exec(MIGRATIONS[i]!); db.prepare("INSERT INTO schema_migrations VALUES (?,?)").run(i + 1, now()); db.exec("COMMIT"); }
    catch (e) { db.exec("ROLLBACK"); throw e; }
  }
}
export function tx<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN");
  try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; }
}
export const all = <T = Record<string, any>>(db: DB, sql: string, ...p: any[]) => db.prepare(sql).all(...p) as T[];
export const one = <T = Record<string, any>>(db: DB, sql: string, ...p: any[]) => db.prepare(sql).get(...p) as T | undefined;
export const run = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).run(...p);
