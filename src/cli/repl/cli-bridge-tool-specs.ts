// ═══ CLI-bridge tool catalog (born-596 TERM-TOOL-PARITY) ════════════════════
// The FULL set of deckent CLI subcommands the native REPL agent can drive
// through createCliToolDispatcher (chat-tool-bridge.ts). buildNativeToolRegistry
// (native-tool-registry.ts) registers every spec below as a provider-native
// ToolDefinition so the native-engine terminal SEES the whole surface, not just
// the read-only six it shipped with. Dispatch already supported all of these —
// only the advertisement to the model was missing.
//
// A name is listed ONLY when createCliToolDispatcher can build argv for it
// (a TOOL_COMMANDS key or an arg-aware builder in cliArgsFor). Excluded on
// purpose, because the bridge cannot run them headlessly:
//   deckent_watch — a live event stream would block the REPL turn forever
//   deckent_docs / deckent_init / deckent_help — no bridge builder resolves them
//
// Descriptions are technical, model-facing metadata (NOT user-facing i18n — the
// same convention as DESCRIPTIONS in native-tool-registry.ts). Schemas mirror
// the exact arg contracts cliArgsFor reads; _rest mirrors the bridge positional
// passthrough for static-map commands.

export interface CliBridgeToolSpec {
  /** deckent tool name (matches a TOOL_COMMANDS key or a cliArgsFor builder). */
  name: string;
  /** Model-facing description (technical metadata, English default, not i18n). */
  description: string;
  /** Structured arg schema; omitted falls back to the open generic passthrough. */
  schema?: Record<string, unknown>;
}

const REST_PROP: Record<string, unknown> = {
  _rest: {
    type: 'array',
    items: { type: 'string' },
    description: 'Positional CLI words appended to the subcommand.',
  },
};

export const CLI_BRIDGE_TOOLS: readonly CliBridgeToolSpec[] = [
  // ── Read-only (classifyTool: read → silent tier) ──
  { name: 'deckent_status', description: 'Show live sprint progress, agent activity, and alerts.' },
  { name: 'deckent_history', description: 'Show sprint history with agent and skill performance stats.' },
  { name: 'deckent_retro', description: 'Read the retrospective and learnings from the last sprint.' },
  { name: 'deckent_doctor', description: 'Run health checks: config, providers, locks, memory budget.' },
  { name: 'deckent_models', description: 'List the model catalog: providers, tiers, pricing.' },
  { name: 'deckent_analyze_project', description: 'Detect project stack, frameworks, and tech context.' },
  { name: 'deckent_explain', description: 'Explain sprint history and results in plain language.' },
  { name: 'deckent_agent_list', description: 'List registered agents, built-in and temp, with stats.' },
  { name: 'deckent_skill_list', description: 'List registered skills with manifest info.' },
  { name: 'deckent_feature_query', description: 'Query the feature and capability ledger.' },
  { name: 'deckent_cost', description: 'Show budget limits, per-model pricing, and spend for the current day.' },
  { name: 'deckent_kpi', description: 'Print the KPI scorecard for the current sprint.' },
  {
    name: 'deckent_memory_query',
    description: 'Search project memory (ADRs, sprint learnings, debt, patterns) via deckent recall.',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query for project memory.' },
        cursor: { type: 'string', description: 'Opaque continuation cursor returned by an earlier memory query.' },
        detail_ref: { type: 'string', description: 'Opaque detail reference for one deferred complete memory entry.' },
      },
      anyOf: [{ required: ['query'] }, { required: ['detail_ref'] }],
    },
  },
  {
    name: 'deckent_usage',
    description: 'Show token and cost usage, optionally filtered by sprint or date range.',
    schema: {
      type: 'object',
      properties: {
        sprint: { type: 'string', description: 'Filter to one sprint id.' },
        since: { type: 'string', description: 'Start date, ISO format.' },
        until: { type: 'string', description: 'End date, ISO format.' },
      },
    },
  },
  {
    name: 'deckent_resources',
    description: 'Show worker resource limits and live usage; optionally read the resource log.',
    schema: {
      type: 'object',
      properties: {
        log: { description: 'true to read the default resource log, or a log file path string.' },
      },
    },
  },
  // ── Write (classifyTool: confirm → ask once, session-rememberable) ──
  {
    name: 'deckent_config',
    description: 'Read or set deckent configuration. Positional words, for example set key value, or show.',
    schema: { type: 'object', properties: { ...REST_PROP }, additionalProperties: true },
  },
  { name: 'deckent_plan', description: 'Generate the task plan from DIRECTIVES.md and write .tasks JSON.' },
  { name: 'deckent_review', description: 'Evaluate sprint results (GO / NO_GO / GO_WITH_TECH_DEBT). Writes the review JSON and updates task state files — confirm-gated.' },
  { name: 'deckent_sync', description: 'Sync agent and skill manifests and update routing rules.' },
  { name: 'deckent_checkpoint', description: 'Approve or reject a checkpoint gate (positional args).' },
  {
    name: 'deckent_set_directives',
    description: 'Write sprint goals and task definitions to DIRECTIVES.md.',
    schema: {
      type: 'object',
      properties: { content: { type: 'string', description: 'Full DIRECTIVES.md content.' } },
      required: ['content'],
    },
  },
  {
    name: 'deckent_autonomous',
    description: 'Manage the autonomous engine. Read: status, pending, backlog_list. Mutate: approve, reject, backlog_add, stop. The start action is CLI-only because it is long-running.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'pending', 'backlog_list', 'approve', 'reject', 'backlog_add', 'stop'] },
        triggerId: { type: 'string', description: 'Trigger id for approve or reject.' },
        id: { type: 'string', description: 'Backlog item id for backlog_add.' },
        title: { type: 'string', description: 'Backlog item title for backlog_add.' },
        cron: { type: 'string', description: 'Optional cron expression for backlog_add.' },
      },
      required: ['action'],
    },
  },
  {
    name: 'deckent_audit',
    description: 'Run the self-audit gate, which writes a gate file and is slow, or read audit query or compliance.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['gate', 'query', 'compliance'], description: 'Defaults to gate.' },
        sprintId: { type: 'string', description: 'Sprint id for gate.' },
        channel: { type: 'string', description: 'Action filter for query.' },
      },
    },
  },
  // ── Execute and destructive (classifyTool: always → re-confirm EVERY call) ──
  {
    name: 'deckent_start',
    description: 'Start a sprint. Spawns real workers and runs detached; track via /status. Always requires confirmation.',
    schema: {
      type: 'object',
      properties: {
        autoApprove: { type: 'boolean' },
        sandbox: { type: 'boolean' },
        force: { type: 'boolean' },
        dryRun: { type: 'boolean' },
        timeout: { type: 'number', description: 'Sprint timeout override.' },
      },
    },
  },
  {
    name: 'deckent_run',
    description: 'Run a single task with a one-shot worker, detached; track via /status. Always requires confirmation.',
    schema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Task description.' },
        model: { type: 'string' },
        modelEffort: { type: 'string' },
        scope: { type: 'string', description: 'Write-scope directory.' },
        timeoutMs: { type: 'number' },
        keep: { type: 'boolean' },
        autoApprove: { type: 'boolean' },
      },
      required: ['description'],
    },
  },
  {
    name: 'deckent_process',
    description: 'Process-mode work. submit injects a new ExecutionRequest, detached; status and result poll by executionId.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['submit', 'status', 'result'] },
        description: { type: 'string', description: 'Work description for submit.' },
        kind: { type: 'string' },
        scopeDir: { type: 'string' },
        provider: { type: 'string' },
        model: { type: 'string' },
        executionId: { type: 'string', description: 'Execution id for status or result.' },
      },
      required: ['action'],
    },
  },
  { name: 'deckent_kill', description: 'Kill a running sprint or worker (destructive; always re-confirms).' },
  { name: 'deckent_cleanup', description: 'Archive task files and release locks (destructive; always re-confirms).' },
  { name: 'deckent_recover', description: 'Force-recover orphaned sprint state (destructive; always re-confirms).' },
];

/**
 * classifyTool is arg-aware, but a ToolDefinition tier is static. Classify each
 * arg-aware tool at its MOST-PRIVILEGED action so the static tier can only
 * over-ask, never under-ask.
 * - deckent_config: {} classifies read (bare show), but `config set` mutates
 *   config.json → pin to the write path.
 * - autonomous ({}→confirm), audit ({}→'gate' default→confirm) and process
 *   ({}→'submit' default→always) already classify at their worst case under
 *   empty args (verified against tool-permissions.ts:63-84 — the action
 *   extraction defaults to the most-privileged action, not '').
 */
export const WORST_CASE_CLASSIFY_ARGS: Readonly<Record<string, Record<string, unknown>>> = {
  deckent_config: { _rest: ['set'] },
};

// ─── deckent_propose_run (TERM-FLOW-UNIFY Sprint-3 dilim, 425-001) ──────────
// Flag-gated behind `terminal.run_flow_v2` (default OFF) via native-tool-
// registry.ts's `runFlow` option — deliberately NOT part of CLI_BRIDGE_TOOLS
// above: its dispatch is NOT createCliToolDispatcher/a CLI subcommand, it
// drives run-flow-controller.ts's host-owned RunFlow coordinator instead. The
// model supplies only a natural-language `intentSummary` — flowId/tenant/
// project/actor/origin/revision are host-derived by the controller, never
// model-invented (design doc: "model yalnız typed RunProposal üretir",
// simplified at the tool-input layer to the one field a model can meaningfully
// author; the rest is identity/session context, not something to prompt for).

export const RUN_FLOW_PROPOSAL_TOOL_NAME = 'deckent_propose_run';

export const RUN_FLOW_PROPOSAL_TOOL_SPEC: CliBridgeToolSpec = {
  name: RUN_FLOW_PROPOSAL_TOOL_NAME,
  description:
    'Propose a run from a natural-language intent summary. Compiles a real Brain plan preview ' +
    '(task summaries, gate/policy result, content-addressed digest) for human approval via the ' +
    'in-terminal plan-preview card — this call itself never starts anything and never requires ' +
    "confirmation (the card's approve/reject is the actual gate). Canonical entry point when " +
    'terminal.run_flow_v2 is on.',
  schema: {
    type: 'object',
    properties: {
      intentSummary: { type: 'string', description: 'Natural-language summary of the work to run.' },
    },
    required: ['intentSummary'],
  },
};

/** Appended (native-tool-registry.ts) to set/plan/start descriptions ONLY when
 *  terminal.run_flow_v2 is on — flag-off descriptions stay byte-identical
 *  (this constant is inert unless a caller opts in). Technical/model-facing
 *  metadata, same non-i18n convention as every other description in this file.
 *  Wording mirrors the design SSOT verbatim (term-flow-unify-design-
 *  2026-07-11.md: "Expert low-level escape hatch kalır") — Sprint-6 T6A closes
 *  the gap where "expert" existed only in a code comment, never in the actual
 *  model-facing string. */
export const RUN_FLOW_ESCAPE_HATCH_NOTE =
  '(Expert low-level escape hatch — when terminal.run_flow_v2 is on, the canonical path is deckent_propose_run.)';

/** The 3 tools this note applies to — the "expert escape-hatch" trio the
 *  design doc keeps around unchanged (set-directives/plan/start) once
 *  deckent_propose_run becomes the canonical native-flow entry point. */
export const RUN_FLOW_ESCAPE_HATCH_NAMES: ReadonlySet<string> = new Set([
  'deckent_set_directives',
  'deckent_plan',
  'deckent_start',
]);
