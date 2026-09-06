// ─── Configuration Domain Types ─────────────────────────────────────────────
// Split from types.ts — Config, setup, CLI, and project analysis types

import type { DecisionEngineConfig, LearningConfig, CollaborationConfig } from './decision-config.js';
import type { NotificationConfig } from './notifications.js';
import type { ModelType, ProviderName, EvaluationRubric } from './task-types.js';
import type { ModelStrategy } from './mode-presets.js';
import type { ModelTier } from './model-equivalence.js';
import type { MemoryReadConsumerV1, MemoryReadLimitsV1 } from './memory-read-contract.js';
import type { AcceptanceMatrixOverride } from './acceptance-matrix.js';
import type { ErpRuntimeConfig } from './erp/factory.js';
import type { BotCapabilitiesConfig } from '../connectors/capabilities/types.js';
import type { ApprovalPolicyRule } from './approval-policy.js';
import type { ToolRiskLevel } from './tool-registry.js';
import type { ComputerUseConfig } from './computer-use-contract.js';
import type { ExecutionBudget, TaskKind, TaskProfileConfig } from './work-model.js';
import type {
  InvocationAuthMode,
  InvocationExecutionBackend,
  InvocationTransport,
} from './invocation-receipt.js';
import type {
  ProviderLimitSourceKind,
  ProviderLimitUnit,
} from './provider-limit-truth.js';

// ─── Timeout Configuration ──────────────────────────────────────────
export interface TimeoutConfig {
  /** Docker backend minimum timeout in seconds (default: 1200) */
  docker_min_timeout: number;
  /** Docker backend maximum timeout in seconds (default: 7200) */
  docker_max_timeout: number;
  /** Tmux backend minimum timeout in seconds (default: 900) */
  tmux_min_timeout: number;
  /** Tmux backend maximum timeout in seconds (default: 5400) */
  tmux_max_timeout: number;
  /** Subprocess backend minimum timeout in seconds (default: 600) */
  subprocess_min_timeout: number;
  /** Subprocess backend maximum timeout in seconds (default: 3600) */
  subprocess_max_timeout: number;
  /** Base timeout per effort level in seconds */
  effort_base: { low: number; normal: number; high: number };
  /**
   * Optional model-tier timeout multiplier (born-667a / TIMEOUT-TIER, Task 427-023).
   * Keyed by the provider-agnostic {@link ModelTier} (economy/standard/premium/
   * premium_plus) so an opus-equivalent model on any provider (gpt-5, gemini-2.5-pro, ...)
   * gets the same widened timeout as Claude opus — not just a Claude-literal name.
   * Applied on top of `effort_base` in `brainEstimateTimeout` (timeout-estimator.ts).
   * Absent tier or absent field entirely = 1.0 (no change) — backward-compatible: a
   * config with no `model_multiplier` produces today's timeout values bit-for-bit.
   */
  model_multiplier?: Partial<Record<ModelTier, number>>;
  /** Scale timeout based on lines-of-code estimate (default: true) */
  loc_scaling_enabled: boolean;
  /** Scale timeout based on historical sprint data (default: true) */
  history_scaling_enabled: boolean;
  /** Allow runtime extension of timeout (default: false) */
  runtime_extension_enabled: boolean;
}

// ─── Terminal Configuration ─────────────────────────────────────────
export interface TerminalConfig {
  enabled: boolean;
  /** TERMINAL-POSTURE-001 — the Ask/Run/Control posture a Terminal session
   *  starts in. Absent-by-default (DEFAULT_TERMINAL_CONFIG's key-shape is
   *  pinned); the REPL resolves `run` when unset. */
  posture?: 'ask' | 'run' | 'control';
  /** TERMINAL-READABILITY-002 — OSC 8 hyperlink policy: auto (host evidence
   *  decides), on, off. Absent-by-default (resolved to `auto` at boot). */
  links?: 'auto' | 'on' | 'off';
  /** Bind address for the terminal WS. Default 127.0.0.1. */
  bind: string;
  /** Max concurrent PTY sessions. */
  maxSessions: number;
  /** Idle reaper timeout (ms) for shell/ai kinds; deckent kind exempt. */
  idleTimeoutMs: number;
  /** Per-session in-memory scrollback ring buffer size (bytes). */
  scrollbackBytes: number;
  /** Whether the plain `shell` session kind is allowed. */
  allowShellKind: boolean;
  /**
   * Per-tenant outbound byte quota over a 24h window (W4-10, invariant I5).
   * Crossing 50% triggers a one-shot warn event; reaching 100% kills the
   * session and closes the WS with code 4429.
   */
  outboundDailyQuotaBytes?: number;
  /**
   * M5-NATIVE-FLIP (376-003): whether the Ink REPL's native-agent tool-use
   * loop is the active engine. Default true (native ON). Set `false` to roll
   * back to the legacy `runChatNativeLoop` engine — the other rollback path
   * is the `--legacy-loop` CLI flag (src/cli/entry.ts), which wins over this
   * config value when both are present.
   */
  native_agent?: boolean;
  /**
   * TERM-FLOW-UNIFY Sprint-1 dilim (422-001,
   * docs/analysis/term-flow-unify-design-2026-07-11.md): gates the
   * host-owned RunFlow state machine (`core/run-flow-contract.ts` +
   * `orchestra/run-flow-reducer.ts`). Opt-in — absent/`false` = off
   * (default: false). Unlike `native_agent` above, undefined here means OFF,
   * not ON — this slice ships contract + pure reducer only, with ZERO
   * production caller; no code reads this flag yet.
   */
  run_flow_v2?: boolean;
}

// ─── Resource Monitor Config ────────────────────────────────────────
/** Docker worker resource monitoring (Sprint 271). Opt-in — absent block = disabled. */
export interface ResourceMonitorConfig {
  /** Enable resource monitoring (required). */
  enabled: boolean;
  /** Sampling interval in ms (default: 5000, min: 1000). */
  interval_ms?: number;
  /** JSONL log path relative to project root (default: '.deckent/settings/resource-log.jsonl'). */
  log_path?: string;
}

// ─── Cross Verify Config ─────────────────────────────────────────────
/** One owner decision over one exact author/verifier model pair. */
export interface XVerifyVerifierTierDecision {
  author_model: string;
  verifier_model: string;
  decision: 'allow' | 'refuse';
  /** Opaque, canonical reference to the immutable owner decision. */
  decision_ref: string;
}

/** Versioned authority for the sole exception to the verifier capability-tier floor. */
export interface XVerifyVerifierTierAuthority {
  schema_version: 1;
  decisions: XVerifyVerifierTierDecision[];
}

/** Cross-provider adversarial verification configuration (Sprint 276 XVER-1). Opt-in — absent block = disabled. */
export interface CrossVerifyConfig {
  /** Enable cross-provider adversarial verification (required). */
  enabled: boolean;
  /** Only verify high-stakes tasks (security/auth/P0/risk-tagged) — default true. */
  high_stakes_only?: boolean;
  /** Provider priority order for verifier selection (default: ['codex','gemini','claude']). */
  verifier_priority?: string[];
  /**
   * 7094/7081 xverify-ux: freshness window (ms) for owner-approved provider
   * reachability evidence. The old fixed 60s guaranteed an approval carousel
   * (every verifier run outlives 60s, so each xverify re-asked for a one-shot
   * approval). Default: 1_800_000 (30 min). Composition threads this into the
   * evidence producer; absent = producer default.
   */
  reachability_ttl_ms?: number;
  /**
   * Enforce a REFUTED verdict as a real block (default false → advisory-only).
   * When true, a high-stakes DONE/GO_WITH_TECH_DEBT task that the adversarial
   * verifier REFUTES is downgraded to NO_GO by the evaluation layer, triggering
   * the standard FIX path (Task 323-004 / A18). Default-off preserves the
   * byte-for-byte advisory behavior (ADR-070): the verdict is still persisted +
   * surfaced as an event, just never enforced.
   */
  enforce_refuted?: boolean;
  /**
   * Owner ceiling on how many verifiers ONE sprint may dispatch. Each dispatch is
   * a real, billed provider call, so a broad rollout starts as a bounded canary
   * (`1`) before it is widened. Absent = no ceiling. Reaching the ceiling is an
   * honest, logged skip — never a silent stop.
   */
  max_verifications_per_sprint?: number;
  /**
   * Exact verifier model API ID per verifier provider — `{ codex: 'gpt-5.6-sol' }`.
   *
   * Without it the sprint path can only derive the verifier from capability-tier
   * equivalence with the task's own model, which by construction cannot express
   * "judge this with a named model": a standard-tier task resolves to a
   * standard-tier verifier, so a premium judge is unreachable. The CLI/MCP
   * `xverify --verifier-model` surface already accepted an exact ID; this is the
   * same authority for the in-sprint path, read from owner config instead of an
   * ad-hoc flag (MASTER-PLAN 669).
   *
   * Keyed by provider so each `verifier_priority` entry carries its own identity.
   * A provider absent from the map keeps tier equivalence unchanged. Values are
   * exact registry API IDs — an unknown ID or one owned by a different provider
   * is a loud model-resolution error and an honest skip, never a silent
   * substitution.
   */
  verifier_model?: Record<string, string>;
  /** Exact-pair owner decisions for verifier tier-floor admission. */
  verifier_tier_authority?: XVerifyVerifierTierAuthority;
  /**
   * Owner-bounded allowance for the xverify verifier-adjudication dispatch to
   * proceed against a SUBSCRIPTION provider whose only limit windows are advisory
   * `percent`-unit — never numerically reservable. Default-off → byte-identical
   * (composition holds at `xverify_limit_unit_unreservable`). When true, the
   * verifier-adjudication path (ONLY) may admit via a typed
   * `non_reservable_subscription` outcome: no numeric reservation is forged, the
   * advisory floor policy still gates admission, and usage is captured solely
   * from what the canonical transport reports (a typed `usage_unavailable` HOLD
   * when absent — never a fabricated figure, never a usd on a subscription). The
   * metered/API reservation path and general heavy-task reservation rules are
   * unaffected. Reaching a gate is an honest, logged HOLD — never a silent stop.
   */
  allow_non_reservable_subscription_adjudication?: boolean;
}

// ─── Worker Comms Config ─────────────────────────────────────────────
/** Worker-to-worker communication configuration (Sprint 278 COMM-1). Opt-in — absent block = disabled. */
export interface WorkerCommsConfig {
  /** Enable worker comms (required). */
  enabled: boolean;
  /** Shared memory entry TTL in ms (default: 3600000 = 1 hour). */
  shared_memory_ttl_ms?: number;
  /** Inject upstream handoffs into downstream worker prompts (default: true when enabled). */
  inject_handoffs?: boolean;
  /** Inject shared memory context into worker prompts (default: true when enabled). */
  inject_shared?: boolean;
}

// ─── Gate Config ─────────────────────────────────────────────────────
/** Sprint outcome gate configuration (Sprint 325, flag-gated default-off).
 *  Controls post-evaluation outcome downgrade triggers. All fields optional;
 *  absent block or all-zero values leave behavior byte-identical to pre-gate. */
export interface GateConfig {
  /** Maximum allowed tech-debt ratio (0–1). When the sprint's
   *  (techDebtTasks / totalTasks) exceeds this value, the sprint outcome is
   *  downgraded via applyTechDebtDowngrade: mild debt → GO_WITH_TECH_DEBT,
   *  severe debt (completionRatio < 0.5) → GATE_FAILURE.
   *  Absent or 0 = feature disabled (default-off). */
  max_tech_debt_ratio?: number;
  /** Per-task EVALUATE-phase verify-delta downgrade (DECKENT-TRIAGE A14, Sprint 343).
   *  When true, a DONE task whose task-start verify-delta baseline shows the
   *  delivered files-changed delta fell short is downgraded via
   *  applyTechDebtDowngrade (DONE → GO_WITH_TECH_DEBT; severe < 0.5 → NO_GO).
   *  Absent/false = disabled (default-off, byte-identical). No baseline on disk
   *  → no downgrade. */
  verify_delta_downgrade?: boolean;
  /** Per-task EVALUATE-phase ADR-compliance enforcement (DECKENT-TRIAGE A9, Sprint 343).
   *  When true, the worker's changed files are scanned for ADR-006/008/010
   *  violations; a failing verdict downgrades the task to NO_GO so the standard
   *  FIX path triggers. The enforcer fails OPEN (an internal error never blocks
   *  the task). Absent/false = disabled (default-off, byte-identical). */
  enforce_adr_compliance?: boolean;
}

/** Final settlement truth checks. Defaults are resolved in config.ts. */
export interface EvaluationConfig {
  /** Require a clean TypeScript compilation before publishing a pure COMPLETE. */
  tsc_settlement_gate?: boolean;
}

// ─── Approval Config (runtime-wide ApprovalBroker, APR family) ───────
export const APPROVAL_LIFECYCLE_ORIGINS = [
  'confirmation',
  'autonomous-trigger',
  'gateway-pairing',
  'broker-native',
] as const;

export const APPROVAL_RISK_TIERS = ['routine', 'elevated', 'critical'] as const;
export const APPROVAL_TIMEOUT_DISPOSITIONS = [
  'request-default',
  'park-alert',
  'park-undecidable',
  'deny-expire',
] as const;
export const APPROVAL_LIFECYCLE_BLOCKING_SCOPES = [
  'request',
  'trigger',
  'run',
  'security',
] as const;
export const APPROVAL_LIFECYCLE_SLA_STAGES = [
  'initial',
  'renotify',
  'alternate-channel',
  'park-alert',
  'expired',
] as const;

export type ApprovalLifecycleOrigin = typeof APPROVAL_LIFECYCLE_ORIGINS[number];
export type ApprovalRiskTier = typeof APPROVAL_RISK_TIERS[number];
export type ApprovalTimeoutDisposition = typeof APPROVAL_TIMEOUT_DISPOSITIONS[number];
export type ApprovalLifecycleBlockingScope = typeof APPROVAL_LIFECYCLE_BLOCKING_SCOPES[number];
export type ApprovalLifecycleStage = typeof APPROVAL_LIFECYCLE_SLA_STAGES[number];

/** A tenant/project profile may only provide values that tighten its parent. */
export interface ApprovalLifecycleProfileOverride {
  /** Positive integer ceiling measured from the immutable source `createdAt`. */
  ttlMs?: number;
  /** Strictly increasing due offsets: renotify, alternate-channel, park-alert. */
  slaMs?: [number, number, number];
  /** Minimum effective risk. Overrides may raise, never lower, this floor. */
  riskTier?: ApprovalRiskTier;
  /** Typed system action applied at the immutable TTL boundary. */
  timeoutDisposition?: ApprovalTimeoutDisposition;
  /** Smallest execution boundary that remains blocked while/after pending. */
  blocking?: ApprovalLifecycleBlockingScope;
}

export interface ResolvedApprovalLifecycleProfile {
  ttlMs: number;
  slaMs: [number, number, number];
  riskTier: ApprovalRiskTier;
  timeoutDisposition: ApprovalTimeoutDisposition;
  blocking: ApprovalLifecycleBlockingScope;
}

export interface ApprovalLifecycleConfig {
  /** Fail-closed rollout gate. False blocks new governed writes, but never draining. */
  enabled?: boolean;
  profiles?: Partial<Record<ApprovalLifecycleOrigin, ApprovalLifecycleProfileOverride>>;
}

export interface ResolvedApprovalLifecycleConfig {
  enabled: boolean;
  profiles: Record<ApprovalLifecycleOrigin, ResolvedApprovalLifecycleProfile>;
}

/**
 * `approval` config block — policy rules + gate/relay activation flags for the
 * runtime-wide ApprovalBroker (strategic-pivot §11.2, ADR-G-020). Sprint 355
 * CFG-APR-WIRE. `rules` describes the declarative JSON shape a user writes;
 * `loadApprovalRules` (approval-rules-load.ts) is the SOLE owner of rule
 * validation semantics — a malformed entry is skipped with a warning at
 * config-load time and never breaks the sprint (fail-soft by design). Absent
 * block, absent/null/empty `rules` -> `loadApprovalRules`'s own
 * `SAFE_DEFAULT_APPROVAL_RULES`.
 */
export interface ApprovalConfig {
  /** Policy rules evaluated by `decidePolicy` (approval-policy.ts) in list
   *  order — first match wins. Validated fail-soft via `loadApprovalRules`
   *  at config-load time; this field only describes the raw JSON shape. */
  rules?: ApprovalPolicyRule[];
  /** Single resolved authority for approval clocks, risk floors and timeout actions. */
  lifecycle?: ApprovalLifecycleConfig;
  /** Activate the worker-side `WorkerApprovalGate` (approval-worker-gate.ts) —
   *  gates a risky worker action on a broker decision before it executes.
   *  Default: false. Wiring the gate into the live worker runtime is a
   *  separate follow-up task; this flag only reserves the config surface.
   *  Same flag `agents/agentic-worker-tools.ts` (WORKERGATE-WIRE, 354-005)
   *  refers to informally as `approval_gate.enabled` in its comments — there
   *  is no separate `approval_gate` top-level block. */
  gate_enabled?: boolean;
  /** Activate the runtime-wide `ApprovalRelay` (approval-relay.ts) — routes
   *  pending approvals out to external decision channels (terminal/telegram/
   *  ...). Default: false. Channel wiring is a separate follow-up task; this
   *  flag only reserves the config surface. */
  relay_enabled?: boolean;
  /** Activate `POST /api/approvals/:id/decision` (356-002, ADR-G-033/G-020).
   *  Default: false — an absent block/key or a non-boolean value disables the
   *  endpoint. NOTE: `api/server.ts`'s `isApprovalApiDecideEnabled` currently
   *  reads this straight off raw `config.json` (config-types.ts was out of
   *  that task's write scope) rather than through `ResolvedConfig` — this
   *  field types the raw `DeckentConfig.approval` shape for `.deckent/
   *  config.json` authors; it is intentionally NOT mirrored onto
   *  `ResolvedConfig.approval` (see that type's doc comment). */
  api_decide?: boolean;
  /**
   * Production attended-execution authority. Default-off and open-only:
   * enabling this never provisions custody. OIDC signature material comes
   * from the existing `api_oidc` block; this block defines authorization and
   * fresh-session policy only.
   */
  authority?: {
    enabled: boolean;
    tenant_id: string;
    /** OIDC channel policy — required for the HTTP decision ingress; a
     *  terminal-only composition may omit it (the OIDC bootstrap then holds
     *  honestly while `decideTerminal` stays available). */
    oidc?: {
      authority_ref: string;
      tenant_claim: string;
      role_claim?: string;
      max_auth_age_seconds: number;
      max_session_seconds: number;
      required_acr?: string[];
      required_amr?: string[];
    };
    /** Local-terminal live re-auth channel policy (K6). Bounds the interactive
     *  re-authentication assertion window used by `decideTerminal`. */
    terminal?: {
      max_auth_age_seconds: number;
    };
    /** How long a probe-approval request stays decidable while a preparation
     *  waits (seconds). Defaults to the preparation's bounded 120s window —
     *  raise it when decisions arrive via a human round-trip. */
    decision_window_seconds?: number;
  };
  /** Activate the brain-side question→approval bridge (question-approval-bridge.ts
   *  via ipc-registry's CKPT-QUESTION-BRIDGE-WIRE seam): a CLI worker's `.question`
   *  becomes a runtime-wide ApprovalRequest decidable from the terminal/API instead
   *  of the hardcoded 'continue' auto-answer. Default: false. Timeout falls back to
   *  the historical 'continue' (fail-open — a QUESTION is consultation, not a risky
   *  action; enforcement is `gate_enabled`'s job on in-process workers). */
  question_bridge?: boolean;
}

// ─── Night-Landed Flag Configs (Sprint 356, Task 356-012 TRACE-CONFIG-TYPES) ──
// Each block below already has a real consumer on disk that duck-types or
// caller-resolves the shape described in its doc comment; this task's job is
// only to give that shape a typed, discoverable home on DeckentConfig/
// ResolvedConfig. None of these are threaded through `mergeConfigs`/
// `loadConfig` yet (that remains each feature's own follow-up wiring task) —
// registering the type here does not change `validateConfig`'s behavior
// (unknown/untyped blocks were already tolerated, and stay so).

/** Sprint-worker structured-log → training-trace recording (TRN-1). Opt-in — absent block = disabled.
 *  @see recordSprintWorkerTrace (orchestra/output-collector.ts), which expects its
 *  caller to resolve `enabled` from this block (no caller is wired yet). */
export interface TrainingTraceConfig {
  /** Enable sprint-worker training-trace recording (default: false). */
  enabled?: boolean;
}

/** Worker-runner ordered progress-stream, `.tasks/task-<id>.progress.jsonl` (ADR-G-025 §4,
 *  WORKER-LIVE-TRACE). Opt-in — absent block = disabled; flag-off performs ZERO fs I/O.
 *  @see AgenticRunnerOptions.liveTrace (agents/agentic-worker-runner.ts). */
export interface LiveTraceConfig {
  /** Enable the worker progress-stream (default: false — but see the env twin:
   *  `DECKENT_LIVE_TRACE=1` forces it ON for one process tree, which is how
   *  interactive-origin runs stream live while headless/CI fleets stay
   *  zero-cost; 583/N5. Resolve via `resolveLiveTraceEnabled` (config.ts),
   *  never by reading this field directly). */
  enabled?: boolean;
}

/** Native-REPL progressive-disclosure meta-tools — `deckent_search_tools` /
 *  `deckent_describe_tool` / `deckent_call_tool` (TOOL-REPL-WIRE, 354-002; canlıya
 *  alınışı born-607). Config-resolve default-ON (a778151a, sprint-376) — an absent
 *  block resolves `{ enabled: true }`; explicit `enabled: false` opts out.
 *  @see ToolSurfaceOptions + resolveToolSurfaceOptions (cli/repl/native-tool-registry.ts). */
export interface ToolSurfaceConfig {
  /** Enable the 3 progressive-disclosure meta-tools (resolved default: true). */
  enabled?: boolean;
  /** EXPLICIT ask-floor for `deckent_call_tool`'s nested dispatch (born-607): when
   *  set, a nested call whose target risk meets this threshold asks EVEN IF the
   *  engine-parity gate would allow it (silent tier / grant / full-auto). Absent
   *  (default) → pure engine-parity, no extra floor. Invalid values are dropped
   *  at resolve time (fail-open guard). */
  riskThreshold?: ToolRiskLevel;
}

/** Native-REPL mode-indicator + live-footer + approval-card surface
 *  (REPL-SURFACE-WIRE 354-001 / APP-APPROVAL-WIRE 355-011). Opt-in — every field
 *  independently default-off; flag-off render stays byte-identical to pre-354-001.
 *  @see ReplAppProps.replSurfaceEnabled / .approvalsEnabled (cli/repl/app.tsx). */
export interface ReplSurfaceConfig {
  /** Enable the mode-indicator + live-footer surface (default: false). */
  enabled?: boolean;
  /** Enable the approval-card + dual-stream + terminal-channel bridge (355-011).
   *  Independent of `enabled` — a pending approval can render even when the base
   *  mode-indicator/live-footer surface is off. Default: false. */
  approvals?: boolean;
  /**
   * Reserved for a future gate over the background-turn-queue surface
   * (`cli/repl/chat-turn-queue.ts`, TERM-2). The queue itself already runs
   * unconditionally in `app.tsx` today (buffers background-completed work and
   * drains it between user turns) — no code reads `bg_turns` yet. This field
   * only reserves the config surface for the follow-up task that gates it.
   */
  bg_turns?: boolean;
}

/** Task-based worker tool-surface reduction (born-664 / 559, ALLOW-WIRE 427-014,
 *  wired 428-002/W674B). Opt-in — absent block/`allowlist_enabled` = the full
 *  default tool surface (pre-674 behavior, byte-exact-pinned). When true,
 *  `buildWorkerPrompt` (orchestra/task-builder.ts) populates
 *  `SprintContext.toolAllowlist` via `computeToolAllowlist`
 *  (core/tool-allowlist.ts), which `buildToolAllowlistBlock`
 *  (orchestra/prompt-god-template.ts) renders as a narrowed-surface block.
 *  @see ToolAllowlistResult (core/tool-allowlist.ts) */
export interface ToolsConfig {
  /** Populate the per-task narrowed tool allowlist in the worker prompt (default: false). */
  allowlist_enabled?: boolean;
}

/** Host-side `DeckBroker` credential minting for spawned tasks (DECKBROKER-WIRE,
 *  354-006, ADR-G-005/G-017 row 422). Opt-in — absent block/`enabled` = the pre-
 *  existing `applyDeckSecretsToEnv`/`process.env` credential path is unaffected.
 *  @see bootstrapProviders's inline `deck_broker` param (core/provider.ts). */
export interface DeckBrokerConfig {
  /** Mint a host-side `DeckBroker` in `bootstrapProviders` (default: false). */
  enabled?: boolean;
}

/** OpenRouter provider registration (OPENROUTER-PROVIDER, row 477). Opt-in —
 *  absent block/`enabled` = `bootstrapProviders` never registers the adapter and
 *  bootstrap output is byte-for-byte identical to the pre-flag behavior.
 *  Registration is further gated on `$DECK:OPENROUTER_API_KEY` resolving via the
 *  adapter's own `isAvailable()` (`providers/openrouter.ts`) — flag-on + key
 *  absent is skipped with an honest reason, never registered broken. */
export interface OpenRouterConfig {
  /** Register the OpenRouter adapter in `bootstrapProviders` (default: false). */
  enabled?: boolean;
  /**
   * OpenRouter `reasoning` request field, forwarded verbatim to
   * `/chat/completions` (row 477). OpenRouter-specific: it is NOT part of the
   * OpenAI base schema, so it travels through the adapter's `extraBody` seam.
   *
   * Why this is worth configuring: reasoning is DEFAULT-ON at the API level and
   * measured (2026-07-20) at ~85% of the response cost — an identical
   * evaluator verdict took 20.7s with reasoning on vs 3.1s with
   * `{ enabled: false }`, with 233 vs 0 reasoning tokens and no loss of
   * judgement quality on that probe. For orchestration throughput (20 req/min
   * cap) that difference dominates.
   *
   * Absent → nothing is sent and OpenRouter's own default applies (reasoning ON).
   * Shape is intentionally open (`enabled` / `effort` / `max_tokens` / `exclude`)
   * because OpenRouter owns this contract, not Deckent.
   */
  reasoning?: {
    /** false → disable reasoning entirely (fastest, measured 6.7x on the probe). */
    enabled?: boolean;
    /** Reasoning depth when enabled. */
    effort?: 'low' | 'medium' | 'high';
    /** Upper bound on reasoning tokens. */
    max_tokens?: number;
    /** Keep reasoning server-side but omit it from the response. */
    exclude?: boolean;
  };
}

/** Flag-gated NO_GO file-revert at EVALUATE time (ROLLBACK-DECIDE, born-427,
 *  ADR-D-006). Opt-in — absent block/`enabled` = no revert (pre-existing
 *  behavior). Distinct from `rollback_policy` (legacy sprint-level
 *  always/on_failure/never policy) — this block governs the newer per-task,
 *  files-changed-aware revert decision. */
export interface RollbackConfig {
  /** Enable evaluate-time NO_GO revert for files-changed tasks (default: false). */
  enabled?: boolean;
}

/**
 * Worker structured-result strictness (TOOL-CU-DILIM-1, Sprint 369-005) —
 * consumed by a future Task-8 (not yet implemented). Opt-in — absent block/
 * `strict_report` = today's lenient `.result` parsing is unaffected.
 * @see WORKER-GUIDE.md's .result field-shape rules for the lenient baseline
 * this flag would eventually tighten (e.g. reject an array `notes`, a
 * non-literal `selfAssessment`) once its consumer lands.
 */
export interface WorkerOutputContractConfig {
  /** Master switch — the block is inert unless true (default: false). */
  enabled?: boolean;
  /** Reject a malformed `.result` file instead of best-effort-parsing it
   *  (default: false — lenient parsing preserved until Task-8 wires this). */
  strict_report?: boolean;
}

/** RoutingEngineV3 axis-weight distribution (spec §2, `.analysis/routing-v3-secenek-b-detay-2026-07-14.md`).
 *  `content` + `positional` + `numerical` MUST sum to 1.0 — enforced by
 *  `resolveRoutingV3Config`/`validateRoutingV3Config` (core/routing/config.ts), not here (this
 *  file has no runtime validation, types only). */
export interface RoutingV3Weights {
  /** Content-fit axis weight — LLM semantic match against the closed work-type/domain vocabulary. */
  content: number;
  /** Positional-evidence axis weight — derived deterministically from a task's filesWrite → DeliverableType. */
  positional: number;
  /** Numerical/statistical axis weight — agent historical success-rate signal. */
  numerical: number;
}

/** Governance strategy for ambiguous/low-confidence RoutingEngineV3 decisions. */
export type RoutingV3GovernanceMode = 'ai' | 'deterministic';

/** Variable skill-composition policy. Selection is 0..N by marginal utility;
 * `hardMaxSkills` is a safety ceiling, never a target cardinality. */
export interface RoutingV3SkillCompositionConfig {
  /** Maximum aggregate prompt tokens reserved for skill packages. */
  promptTokenBudget: number;
  /** Absolute safety ceiling after hard applicability and budget gates. */
  hardMaxSkills: number;
  /** Stop when the best remaining candidate adds less utility than this. */
  marginalUtilityFloor: number;
  /** Penalty applied to overlap with already selected domain coverage. */
  redundancyPenalty: number;
  /** Reward for requirement-domain weight not yet covered. */
  uncoveredCoverageBonus: number;
}

/**
 * Full RoutingEngineV3 configuration schema (Sprint 445 Slice-0 foundation, Task 445-010) — the
 * **single source of truth** for the `routing_v3` block's shape, referenced by both
 * {@link DeckentConfig} and {@link ResolvedConfig}.
 *
 * Unlike {@link NervousSystemConfig} above (whose mirrored zod schema lives in `core/config.ts`,
 * `NERVOUS_SYSTEM_SCHEMA`), this schema's zod mirror + `DEFAULT_ROUTING_V3_CONFIG` (the ONE place
 * defaults live) + weights-sum validation live in `core/routing/config.ts`
 * (`ROUTING_V3_SCHEMA` / `resolveRoutingV3Config`) — `routing_v3` is exclusively consumed by the
 * routing3 subsystem, so its schema stays scoped there instead of growing `config.ts` (out of this
 * task's write scope). `loadConfig`/`mergeConfigs` (config.ts) assign this field via
 * `resolveRoutingV3Config(null, config)` (config.ts:1855/2608), so `resolved.routing_v3` is
 * populated on the real runtime path.
 *
 * `enabled` is VESTIGIAL post-S3 cut-over (2026-07-15): the planner runs V3 unconditionally
 * (sprint-planner.ts — no enabled-gate), so nothing reads this flag. It is retained as an
 * optional, ignored key purely so a pre-cut-over config that still sets it validates against the
 * strict schema instead of hard-failing at load (back-compat).
 */
export interface RoutingV3Config {
  /** VESTIGIAL no-op — V3 routing is unconditional (S3 cut-over). Retained optional for
   *  back-compat: an old config that sets it still validates; nothing consumes it. */
  enabled?: boolean;
  /** Axis weight distribution — MUST sum to 1.0 (default: content 0.5, positional 0.3, numerical 0.2). */
  weights: RoutingV3Weights;
  /** Minimum composite confidence required to accept a vector-routing decision before falling
   *  back to the deterministic/legacy path (0-1, default: 0.6). */
  confidenceFloor: number;
  /** Governance mode for ambiguous/low-confidence decisions: 'ai' (LLM tiebreak) |
   *  'deterministic' (fixed fallback rule) (default: 'ai'). */
  governanceMode: RoutingV3GovernanceMode;
  /** Number of top-scoring candidates considered before the governance tiebreak (default: 5). */
  topK: number;
  /** Minimum structural-evidence confidence (positional axis) required to treat a deliverable-type
   *  match as trustworthy (0-1, default: 0.7). */
  structuralConfidence: number;
  /** K1 (581-kalibrasyon, 2026-07-19): drop decision-wide signal-free numerical
   *  components (cold cells / absent live signals) from the axis mean instead of
   *  neutral-flattening every candidate — the 65-decision analysis measured
   *  numerical spread 0.051 vs content 0.368 and a 71% low-confidence rate.
   *  Default: true. Rollback: `signalGatedNumerical: false`. */
  signalGatedNumerical: boolean;
  /** Exploration share (0-1). Default: 0 (OFF); exploration activates only
   *  when explicitly configured. Rollback: `explorationBonus: 0`. */
  explorationBonus: number;
  /** Variable, budgeted skill composition; never a fixed top-three slice. */
  skillComposition: RoutingV3SkillCompositionConfig;
}

// ─── Cost Guard Config ───────────────────────────────────────────────
/** Mid-sprint token-usage abort guard (Sprint 279 WK-cost). Opt-in — absent block = disabled. */
export interface CostGuardConfig {
  /** Enable mid-sprint cost guard (required). */
  enabled: boolean;
  /** Dispatch stops when sprint limit-cost reaches this threshold in USD (default-off when absent). */
  max_limit_cost_usd?: number;
}

// ─── Scheduler Shadow Config (SCHED4, docs/analysis/scheduler-unify-design-2026-07-11.md Sprint-4 dilimi) ──
/** Full-reducer SHADOW-only observation config — execution-impact ZERO (never
 *  drives spawn/kill). Opt-in — absent block = disabled. */
export interface SchedulerConfig {
  /** Run `reduceSchedulerTick()` (scheduler-reducer.ts) alongside the live
   *  dispatch tick, purely for differential-journal comparison against the
   *  live-observed outcome (default: false). */
  shadow_reducer?: boolean;
  /**
   * Live scheduler driver gate (SCHED5, docs/analysis/scheduler-unify-design-2026-07-11.md
   * "Continuous live switch", Sprint-5 dilimi / Task 426-xxx). Formalizes the
   * `resolveSchedulerEngine` local-cast idiom (scheduler-driver.ts) — SCHED-7
   * (428-011) promotes it onto this typed block; `resolveSchedulerEngine`'s
   * runtime resolution semantics are UNCHANGED by this promotion (still: any
   * value except the literal `'reducer'` resolves to `'legacy'`).
   * - `'legacy'` (default, or field absent): `createSchedulerDriver` is a pure
   *   passthrough — the pre-SCHED5 imperative closures (processQueue +
   *   maybeRespawn [+ forceRescanIfIdle] + dispatchReadyTasks) run unmodified.
   * - `'reducer'`: the driver captures a `SchedulerSnapshot`, runs the pure
   *   `reduceSchedulerTick` (scheduler-reducer.ts), and executes its
   *   SpawnTask/KillWorker effects through the canonical `executeSpawnTask`
   *   path (scheduler-effects.ts). CascadeSkip/Blocked/checkpoint effects are
   *   NOT executed via this path yet (dilim-6/7 scope) — the pre-existing
   *   cascadeSkipDeadBlocked/DEPENDENCY_BLOCKED/checkpoint mechanisms in
   *   result-collector.ts keep running unconditionally, independent of engine.
   * @see resolveSchedulerEngine (orchestra/scheduler-driver.ts)
   */
  engine?: 'legacy' | 'reducer';
}

// ─── Identity Provider Config (ADR-092 Faz-1b) ───────────────────────────

/** Built-in local identity provider — roles/bindings managed directly in config. */
export interface LocalIdentityProviderConfig {
  kind: 'local';
}

/** SCIM 2.0 identity provider — syncs users/groups from a SCIM 2.0 endpoint.
 *  `token` supports `$DECK:` interpolation (resolved at config load). */
export interface ScimIdentityProviderConfig {
  kind: 'scim';
  scim: {
    /** SCIM 2.0 base URL, e.g. https://scim.example.com/v2 */
    baseUrl: string;
    /** Bearer token for SCIM API auth. Use "$DECK:SCIM_TOKEN" for secret resolution. */
    token: string;
    /** Optional SCIM filter for user queries, e.g. 'userName sw "a"' */
    userFilter?: string;
  };
}

/** OIDC-claims identity provider — derives roles/groups from JWT claims in the
 *  bearer token. Requires `api_oidc` or `dashboard_oidc` for token verification. */
export interface OidcClaimsIdentityProviderConfig {
  kind: 'oidc-claims';
  oidc: {
    /** Expected `iss` claim of the OIDC token. */
    issuer: string;
    /** Expected `aud` claim (optional — defaults to any audience). */
    audience?: string;
    /** JWT claim name carrying group membership, e.g. 'groups'. */
    groupsClaim?: string;
    /** JWT claim name carrying the role, e.g. 'https://example.com/role'. */
    roleClaim?: string;
  };
}

/** Discriminated union of all supported identity provider configurations.
 *  Discriminant field: `kind`. */
export type IdentityProviderConfig =
  | LocalIdentityProviderConfig
  | ScimIdentityProviderConfig
  | OidcClaimsIdentityProviderConfig;

// ─── Configuration (Blueprint 13) ───────────────────────────────────
export interface PlanModeConfig {
  max_workers: number | 'auto';
  brain_model: ModelType;
  default_model: ModelType;
  haiku_allowed: boolean;
  /** Tier-based minimum model tier. Preferred over haiku_allowed.
   *  When set, haiku_allowed is ignored. Backward compat: haiku_allowed=false → min_tier='standard'. */
  min_tier?: ModelTier;
  budget_per_sprint?: number;
  requires?: string;
  brain_planning?: BrainPlanningMode;
}

export type BrainPlanningMode = 'ai' | 'structured' | 'auto';

export type PlanMode = 'performance' | 'balanced' | 'economic' | 'api' | 'max_plan' | 'max5x_plan' | 'pro_plan';

export interface SkillConfig {
  enabled: boolean;
  maxPerTask: number;         // default 3
  autoDetectStack: boolean;   // default true
  preferredSkills: string[];
}

/** Tuning parameters for adaptive threshold adjustment */
export interface AdaptiveConfig {
  /** Minimum number of past sprints required before adjusting (default: 3) */
  min_samples: number;
  /** NO_GO rate threshold (0-1) above which agent_min_score is lowered (default: 0.3) */
  no_go_threshold: number;
  /** Number of recent sprints to consider for coverage averaging (default: 3) */
  coverage_lookback: number;
}

/**
 * BOT-1 bot-agent — rephrases/summarizes outbound connector messages into natural
 * language. Default OFF (explicit opt-in). The completer is resolved as a fallback
 * chain (ollama-local → claude → openai); the first available provider is used.
 */
export interface BotAgentConfig {
  /** Turn the bot-agent on (default false). */
  enabled?: boolean;
  /** Tone/persona injected into the rephrase prompt (user-customizable). */
  persona?: string;
  /** Output language (e.g. 'en', 'tr'). */
  lang?: string;
  /** Override the model used for humanizing (else the per-provider cheap default). */
  model?: string;
  /** Provider preference order (default ['ollama','claude','openai']). */
  providers?: Array<'ollama' | 'claude' | 'openai'>;
  /** Hard timeout (ms) for the LLM call before falling back to raw (default 8000;
   *  raise for slow local models, e.g. a large ollama model on first call). */
  timeout_ms?: number;
}

/**
 * Adapter kind that backs a config-driven provider (F1-012).
 * - `openai-compatible` — generic HTTP adapter; points at ANY OpenAI
 *   `/chat/completions`-compatible base URL, enabling fully config-driven
 *   registration with zero code change.
 * - `claude | codex | gemini | ollama` — alias a built-in adapter under a
 *   custom registry name.
 */
export type ProviderAdapterKind = 'claude' | 'codex' | 'gemini' | 'ollama' | 'openai-compatible';

export type LocalLlmAccelerationBackend = 'auto' | 'cpu' | 'cuda' | 'vulkan' | 'metal';
export type LocalLlmGpuLayers = 'auto' | 'all' | number;
export type LocalLlmFlashAttention = 'auto' | 'on' | 'off';

/** Config-resolved hardware placement for a directly managed llama.cpp server. */
export interface LocalLlmAccelerationConfig {
  backend: LocalLlmAccelerationBackend;
  /** Dynamic ggml backend shared library; required for explicit CUDA/Vulkan loading. */
  backendLibrary?: string;
  /** Ordered runtime library directories prepended to the platform loader path. */
  runtimeLibraryDirectories?: string[];
  /** llama.cpp device identifier returned by `--list-devices` (for example CUDA0). */
  device?: string;
  /** Maximum model layers placed on the selected device. Zero is valid only for CPU placement. */
  gpuLayers?: LocalLlmGpuLayers;
  flashAttention?: LocalLlmFlashAttention;
}

/** Owner-authored launch authority for a directly managed OpenAI-compatible local model server. */
export interface LocalLlmLaunchConfig {
  serverBinary: string;
  modelArtifact: string;
  endpoint: string;
  host: string;
  port: number;
  contextSize: number;
  modelAlias: string;
  /** Omitted preserves portable llama.cpp auto-discovery and the pre-acceleration argv. */
  acceleration?: LocalLlmAccelerationConfig;
}

/**
 * Role-aware provider fallback policy (454-007) — the config surface for the
 * shared role-aware resolution contract (`core/role-invocation-resolver.ts`).
 * It is threaded through `mergeConfigs`/`loadConfig` and validated fail-loud;
 * `orderedRoleProviders` (core/provider.ts) honors the ORDER given (configured
 * order beats provider registration order). Production role consumers remain a
 * separate wiring boundary.
 */
export interface ProviderFallbackPolicyConfig {
  /** Ordered global fallback chain — applies to every role UNLESS a per-role
   *  chain below overrides it. Config order is authoritative; it is never
   *  re-sorted by provider registration order. */
  global?: ProviderName[];
  /** Per-role ordered fallback chain for the Brain role (planning). */
  brain?: ProviderName[];
  /** Per-role ordered fallback chain for the Worker role (execution). */
  worker?: ProviderName[];
  /** Per-role ordered fallback chain for the Auditor role (audit-evaluation) —
   *  gives the Auditor a first-class policy surface, not a brain-inherited one. */
  auditor?: ProviderName[];
  /** Configured PRIMARY provider for the Auditor role. The Auditor is
   *  brain-family, so this defaults to `brain_provider` when unset; Brain and
   *  Worker primaries stay on `brain_provider` / `worker_provider`. */
  auditor_provider?: ProviderName;
  /** Unattended/autonomous execution (default: true). When true, a candidate
   *  whose reachability/limit evidence is unknown/stale/unavailable is never
   *  treated as reachable — the load-bearing safety rule of the resolver. */
  unattended?: boolean;
}

export type ExecutionBudgetRole = 'brain' | 'worker' | 'auditor';

export interface ExecutionBudgetRolePolicyConfig {
  /** Role-wide owner ceiling. A task-kind profile replaces it when present. */
  default?: ExecutionBudget;
  /** Canonical TaskKind override; no model/provider aliases are accepted here. */
  by_task_kind?: Partial<Record<TaskKind, ExecutionBudget>>;
}

export interface ExecutionLandingPolicyConfig {
  /** Fraction of every hard ceiling reserved for landing; owner-authored, no runtime default. */
  reserve_ratio: number;
  /** Explicit attended-only escape hatch. Absence is the fail-closed `hold`. */
  attended_unsupported?: 'hold' | 'allow-hard-stop';
}

/**
 * Owner authorization for providers whose CLI reports usage only once, at the end
 * of the call (`ProviderCommandSpec.liveUsage === 'final-only'`, e.g. codex).
 *
 * A live token ceiling cannot be enforced in flight against such a provider, so
 * the default (absent block, or `action: 'hold'`) keeps today's fail-closed
 * refusal. When the owner explicitly authorizes it, the token ceilings become
 * POST-HOC settlement evidence and the only in-flight containment is the
 * host-enforced wall clock declared here — never a fabricated live cap.
 */
export interface FinalOnlyUsagePolicyConfig {
  /** Absent/'hold' = fail closed (current behavior). */
  action: 'hold' | 'allow-wall-clock-containment';
  /** Roles the authorization applies to; absent means no role is authorized. */
  roles?: ExecutionBudgetRole[];
  /** Hard host-enforced container lifetime for an authorized call. Required. */
  max_wall_clock_seconds?: number;
}

/** Owner policy that produces remote invocation budgets before side effects. */
export interface ExecutionBudgetPolicyConfig {
  roles: Partial<Record<ExecutionBudgetRole, ExecutionBudgetRolePolicyConfig>>;
  /** ADR-G-037: metered work may request landing only from an owner-authored reserve. */
  landing?: ExecutionLandingPolicyConfig;
  /** Explicit final-only-usage authorization; absence is the fail-closed `hold`. */
  final_only_usage?: FinalOnlyUsagePolicyConfig;
  /** Missing block defaults to the safe `hold` behavior. Reroute order is owner-authored. */
  unmetered_backend?: {
    action: 'hold' | 'reroute-or-hold';
    ordered_backends?: Array<'docker' | 'subprocess' | 'tmux'>;
  };
  /** NATIVE-AGENT-HORIZON-001: multi-dimension terminal/native-agent session
   *  budget. Every field optional — defaults are the bounded deep/extended
   *  profile in execution-budget-policy.ts (never provider-name-keyed). */
  native_agent?: NativeAgentBudgetConfig;
}

/** Owner-authored overrides for the native-agent session budget (all optional,
 *  positive safe integers; unknown keys fail loudly at validation). */
export interface NativeAgentBudgetConfig {
  maxModelRounds?: number;
  maxToolCalls?: number;
  maxWallTimeMs?: number;
  maxCumulativeTokens?: number;
  maxNoProgressRounds?: number;
  checkpointEveryRounds?: number;
  checkpointEveryToolCalls?: number;
  outputReserveTokens?: number;
  contextSafetyReserveTokens?: number;
}

export interface ProviderLimitPolicySourceScopeConfig {
  sourceKind: ProviderLimitSourceKind;
  authority: 'authoritative' | 'advisory';
  transport: InvocationTransport;
  executionBackend: InvocationExecutionBackend;
  endpointRefHash: string | null;
}

export interface ProviderLimitPolicySelectorConfig {
  tenantId: string;
  provider: string;
  accountRefHash: string | null;
  quotaScopeRefHash: string;
  authMode: Exclude<InvocationAuthMode, 'unknown'>;
  backend: {
    transport: InvocationTransport;
    executionBackend: Exclude<InvocationExecutionBackend, 'unknown'>;
    endpointRefHash: string | null;
  };
  requiredWindowIds: string[];
  sourceScopes: ProviderLimitPolicySourceScopeConfig[];
}

export interface ProviderLimitPolicyValuesConfig {
  /**
   * Controls only warn/block ratio enforcement. `observe_only` keeps the
   * measured pressure visible but does not turn a crossed ratio into HOLD.
   * Absolute `minimumRemaining` floors and unknown/stale evidence remain
   * fail-closed. Absent is the backward-compatible `enforce` default.
   */
  ratioEnforcement?: 'enforce' | 'observe_only';
  warnAtRatio?: number;
  blockAtRatio?: number;
  minimumRemaining?: Partial<Record<ProviderLimitUnit, number>>;
}

export interface ProviderLimitPolicyEntryConfig {
  selector: ProviderLimitPolicySelectorConfig;
  values: ProviderLimitPolicyValuesConfig;
}

/**
 * Authored provider account/window policy. Generic config merge may carry this
 * value for inspection, but only provider-limit-policy.ts may resolve it into
 * an effective policy from separate parent/project layers.
 */
export interface ProviderLimitsConfig {
  schemaVersion: 1;
  authorityRef: string;
  policies: ProviderLimitPolicyEntryConfig[];
}

/** Canonical authored layer retained before generic config merging. */
export interface ProviderLimitPolicyAuthoredLayerSnapshot {
  readonly scope: 'global' | 'tenant' | 'project';
  readonly config: ProviderLimitsConfig;
}

/**
 * Runtime-safe provenance envelope for provider-limit policy resolution.
 * `provider_limits` on ResolvedConfig remains inspection-only; consumers must
 * use these separately authored layers and the authority digest.
 */
export interface ProviderLimitPolicyAuthoritySnapshot {
  readonly schemaVersion: 1;
  readonly authorityRef: string;
  readonly parent: ProviderLimitPolicyAuthoredLayerSnapshot | null;
  readonly project: ProviderLimitPolicyAuthoredLayerSnapshot | null;
}

/**
 * A single config-driven provider definition (F1-012, zero-hardcode).
 * Declared under `config.providers.registry`; bootstrap registers each entry
 * generically so adding a provider needs NO source change.
 */
export interface ProviderDefinition {
  /** Unique registry name (any string), e.g. 'groq' | 'mistral' | 'claude-fast'. */
  name: string;
  /** Adapter kind backing this provider. */
  type?: ProviderAdapterKind;
  /** Alias for `type` (either key is accepted). */
  adapter?: ProviderAdapterKind;
  /** OpenAI-compatible base URL, e.g. https://api.groq.com/openai/v1 (type='openai-compatible'). */
  baseUrl?: string;
  /** Env var holding the API key (type='openai-compatible'). */
  apiKeyEnv?: string;
  /** Authentication mode; local/none providers require no credential. */
  authMode?: 'api_key' | 'none' | 'local';
  /** Provider execution cost classification for admission and budgeting. */
  executionCostClass?: 'remote' | 'local';
  /** Model ids this provider serves (type='openai-compatible'). */
  models?: string[];
}

/**
 * Post-FIX lineage circuit-breaker policy.
 *
 * The breaker evaluates logical root tasks after their configured FIX retry
 * budget is exhausted. Fix attempts never inflate the denominator.
 */
export interface FixCircuitBreakerConfig {
  /** Enable the post-FIX unresolved-lineage pause gate. Default: true. */
  enabled: boolean;
  /**
   * Absolute unresolved-lineage ceiling. Scale-honest (PLANNER-TRUTH,
   * 2026-08-18): applied as authored — never scaled down for small runs, so a
   * small sprint cannot trip the breaker before a genuine cascade reaches
   * this count. Default: 5.
   */
  max_unresolved_tasks: number;
  /** Minimum unresolved root-task ratio required to pause. Default: 50. */
  min_unresolved_ratio_percent: number;
}

export const DEFAULT_FIX_CIRCUIT_BREAKER_CONFIG: Readonly<FixCircuitBreakerConfig> = Object.freeze({
  enabled: true,
  max_unresolved_tasks: 5,
  min_unresolved_ratio_percent: 50,
});

/**
 * Mode-independent lifecycle containment used by finalize/recovery.
 *
 * Values are effective-config authority: callers must not invent a separate
 * grace/poll constant. Platform adapters may implement the signals
 * differently, but they preserve these bounded timings and the same
 * death-proof contract.
 */
export interface LifecycleRecoveryConfig {
  /** Grace after graceful termination before escalation. */
  coordinator_termination_grace_ms: number;
  /** Liveness observation cadence during graceful/forced containment. */
  termination_poll_interval_ms: number;
  /** Bounded proof window after forced containment. */
  forced_termination_verify_ms: number;
}

export const DEFAULT_LIFECYCLE_RECOVERY_CONFIG: Readonly<LifecycleRecoveryConfig> = Object.freeze({
  coordinator_termination_grace_ms: 5_000,
  termination_poll_interval_ms: 100,
  forced_termination_verify_ms: 5_000,
});

/** Plugin-security rejection stance. The default remains advisory until an owner-approved flip. */
export type PluginSecurityEnforcement = 'advisory' | 'enforce';

/** Optional bounded human-view limits for guarded Memory V2 exports. */
export interface MemoryExportConfig {
  max_inline_lines?: number;
  max_inline_bytes?: number;
  summary_inline_lines?: number;
  summary_inline_bytes?: number;
}

export interface DeckentConfig {
  mode: PlanMode;
  modes: Record<string, PlanModeConfig>;
  /**
   * Top-level Brain planning-mode override ('ai' | 'structured' | 'auto').
   * Explicit top-level value wins over `modes.<mode>.brain_planning` (the
   * active preset); absent → the active mode preset's `brain_planning`
   * continues to apply unchanged (Task 429-006 PLNR1 — previously a dead
   * field advertised by `deckent init` templates but never wired). Resolve
   * via `resolveBrainPlanningMode()` (config.ts) — never read directly.
   */
  brain_planning?: BrainPlanningMode;
  language?: string;
  projectName?: string;
  /** Last completed sprint ID (e.g. 'sprint-091') */
  last_sprint_id?: string;
  version?: string;
  auto_docs?: AutoDocsConfig;
  /** Run the full pre-sprint vitest baseline before SPAWN (default: false — the
   *  full suite is slow and blocks sprint start). Opt-in for the honesty
   *  verify-delta baseline. */
  pre_sprint_tests?: boolean;
  /** Strict multi-tenant isolation (default: false).
   *  When false (default), tenant-scoped queries include global NULL-tenant rows
   *  (backward-compat). When true, OMIT the `OR tenant_id IS NULL` clause so a
   *  tenant sees ONLY its own rows — closes the NULL-tenant leak for strict
   *  multi-tenant deployments. */
  strict_tenant_isolation?: boolean;
  /** PRINCIPAL-001 P1b/P1d — identity-assurance hard-gate (default: false).
   *  When false: an actor with missing or `unverified` assurance reaches
   *  authorization and only produces the advisory finding (v1 behaviour).
   *  When true: the finding becomes a typed `PrincipalAssuranceError` BEFORE
   *  admission — no synthetic or header-derived identity can authorize work.
   *  Carried explicitly by resolveConfig (config.ts). @see assertActorAssurance */
  enforce_principal_assurance?: boolean;
  /** F8-003 — capability least-privilege hard-flip (default: false).
   *  When true, capability invocations auto-derive grants from `ROLE_CAPABILITY_MAP[actor.role]`
   *  and hard-deny missing capabilities with a `capability.denied` audit event.
   *  Default-off: permissive v1 behavior preserved. */
  enforce_least_privilege?: boolean;
  /** F10-002 — risk-gate hard-park for HIGH-risk capability verbs (default: false).
   *  When true, the autonomous policy-engine parks entries whose resolved risk class
   *  is HIGH (shell / db-write / erp-write verbs) even after a 'permit' verdict.
   *  Flag-gated, additive; default-off preserves v1 permissive behavior. */
  risk_gate_enabled?: boolean;
  /** Spawn backend: 'docker' | 'tmux' | 'subprocess' | 'auto' (default: 'auto') */
  spawn_backend?: 'docker' | 'tmux' | 'subprocess' | 'auto';
  /** Docker image for worker containers (default: 'deckent-worker:latest') */
  docker_image?: string;
  /** Docker container timeout in seconds (default: 1200 = 20 minutes) */
  docker_timeout?: number;
  /**
   * Opt-in per-kind Docker memory limits. Keys are canonical TaskKind values
   * (work-model.ts SSOT): 'code-development', 'documentation', 'test', etc.
   * When a spawned task's kind matches, that limit overrides the global default 4g.
   * Swap is auto-derived at limit × 1.5. Absent block = no change from current behavior.
   * Example: { "code-development": "1536m", "documentation": "768m" }
   */
  worker_memory_limit_by_kind?: Record<string, string>;
  /**
   * Default per-worker Docker memory limit (docker `--memory`), e.g. "2g".
   * Falls back to DEFAULT_WORKER_MEMORY_LIMIT ('4g') when unset. Sprint 318
   * (B-WORKERMEM): wired into the spawn factory — was previously display-only.
   */
  worker_memory_limit?: string;
  /** WORKER-ENV-TMPFS-001: docker worker HOME tmpfs size (e.g. '256m'). Default 100m. */
  worker_home_tmpfs_size?: string;
  /**
   * Per-worker Docker swap ceiling (docker `--memory-swap`). Unset → derived
   * from `worker_memory_limit` at × 1.5 (the documented ratio). Must be at or
   * above the limit; docker rejects a smaller value. MASTER-PLAN 666: this key
   * existed in user configs but was read by nothing until it was wired.
   */
  worker_memory_swap?: string;
  /** Skill system configuration */
  skills?: SkillConfig;
  /** Decision engine configuration */
  decision_engine?: DecisionEngineConfig;
  /** Learning system configuration */
  learning?: LearningConfig;
  /** Collaboration configuration */
  collaboration?: CollaborationConfig;
  /** Notification configuration */
  notifications?: NotificationConfig;
  /** Auto-remove stale locks (>5min) during auditor scan. Default: false */
  auto_clean_locks?: boolean;
  /** Provider for Brain planning (default: 'claude') */
  brain_provider?: ProviderName;
  /** Default provider for workers (default: 'claude') */
  worker_provider?: ProviderName;
  /** Fallback when primary provider unavailable */
  fallback_provider?: ProviderName;
  /** Role-aware provider fallback policy (454-007) — ordered role/global
   *  fallback chains + per-role primary + unattended gate. @see ProviderFallbackPolicyConfig */
  provider_fallback?: ProviderFallbackPolicyConfig;
  /** Parametric role/task-kind remote execution budget producer. */
  execution_budget?: ExecutionBudgetPolicyConfig;
  /** Authored provider account/window policy; never trusted from last-wins merge. */
  provider_limits?: ProviderLimitsConfig;
  /** Persona integrity floor (owner D-G(a)); default resolved in config.ts. */
  persona_integrity?: PersonaIntegrityConfig;
  /** Per-task-type provider overrides */
  provider_overrides?: Record<string, ProviderName>;
  /** Tier-based model selection strategy. Merged with mode preset defaults.
   *  Partial — unset fields fall back to the active mode preset. */
  model_strategy?: Partial<ModelStrategy>;
  /** Canonical provider config. Legacy flat aliases are promoted per authored
   *  config layer; equal dual definitions are deduplicated and conflicting dual
   *  definitions fail loudly instead of applying implicit precedence. */
  providers?: {
    brain?: ProviderName;
    worker?: ProviderName;
    fallback?: ProviderName;
    overrides?: Record<string, ProviderName>;
    /** Config-driven provider registry (F1-012, zero-hardcode). When present,
     *  bootstrap registers each definition — adding a provider needs NO code
     *  change. Absent → built-in claude/codex/gemini/ollama behavior is
     *  unchanged (backward-safe default). */
    registry?: ProviderDefinition[];
  };
  /** Direct llama.cpp lifecycle configuration used by `deckent local-llm`. */
  local_llm?: LocalLlmLaunchConfig;
  /** Host-side `DeckBroker` credential minting (DECKBROKER-WIRE, 354-006).
   *  @see DeckBrokerConfig */
  deck_broker?: DeckBrokerConfig;
  /** OpenRouter provider registration (OPENROUTER-PROVIDER, row 477).
   *  @see OpenRouterConfig */
  openrouter?: OpenRouterConfig;
  /** Auto-select cheapest capable provider (default: false) */
  cost_optimization?: boolean;
  /** Claude execution backend: 'tmux' (default), 'subprocess' (headless), 'mcp' (future) */
  claude_backend?: 'tmux' | 'subprocess' | 'mcp';
  /** Optional API keys (prefer env vars) */
  api_keys?: Record<string, string>;

  // ─── Output & Display ──────────────────────────────────────────────
  /** Show kraken splash on init/version (default: true) */
  output_splash?: boolean;
  /** Output verbosity: quiet (minimal), normal (default), verbose (extra detail) */
  output_mode?: 'quiet' | 'normal' | 'verbose';
  /** Output theme (default: 'default') */
  output_theme?: 'default' | 'minimal' | 'rich';
  /** Output render mode for formatStatus() dispatcher.
   *  'explainatory' — emoji + multi-line + Türkçe + ★ Insight blocks (default)
   *  'standart'     — minimal single-line summary + markdown table
   *  'verbose'      — full worker output stream + timestamps + metric snapshot
   *  'json'         — JSON.stringify
   */
  output_render_mode?: 'explainatory' | 'standart' | 'verbose' | 'json';

  // ─── Skill-Based Provider Routing ──────────────────────────────────
  /** Skill-based provider routing overrides */
  skill_routing?: {
    design?: string | null;
    testing?: string | null;
    docs?: string | null;
    default?: string;
  };

  // ─── Search & Documentation ────────────────────────────────────────
  /** Enable online search for documentation (default: true) */
  search_enabled?: boolean;
  /** Search provider (default: 'context7') */
  search_provider?: 'context7' | 'web' | 'none';
  /** Search cache TTL in seconds (default: 3600) */
  search_cache_ttl?: number;

  // ─── Notifications ─────────────────────────────────────────────────
  /** Notify on sprint completion (default: false) */
  notify_on_complete?: boolean;
  /**
   * Durable owner-notification outbox drain interval in ms (671-001). Consumer:
   * the bot-daemon's durable owner-notification outbox drain loop
   * (src/connectors/bot-daemon.ts), which polls the outbox at this cadence and
   * redelivers pending owner notifications (e.g. sprint-pause alerts). Default:
   * 30_000 (30s) — kept well under an operator's tolerance for a stuck
   * pause-notification, so a drain stall surfaces quickly without hammering the
   * outbox. Absent → the default applies.
   */
  notify_outbox_drain_interval_ms?: number;
  /** Notification channel. 'webhook' is wired (R4/B11): notify_channel='webhook' +
   *  notify_url posts notifications to a generic outbound HTTP endpoint via the
   *  NotifyDispatcher webhook adapter. slack/discord/email here remain legacy —
   *  rich connector delivery goes through notify_connectors. */
  notify_channel?: 'slack' | 'discord' | 'email' | 'webhook' | null;
  /** Outbound webhook URL — delivered when notify_channel='webhook' (R4/B11 WIRE). */
  notify_url?: string | null;
  /**
   * Outbound messaging connectors (BOT-001, §4G). Sprint notifications fan out
   * to each enabled connector at its chat_id. Tokens via .deck ($DECK:NAME),
   * resolved at config load. Supersedes the legacy notify_channel/notify_url.
   */
  notify_connectors?: Partial<Record<'telegram' | 'discord', {
    enabled: boolean;
    /** Bot token — use "$DECK:TELEGRAM_TOKEN" (resolved from .deck). */
    token: string;
    /** Target chat/channel id the notifications are sent to. */
    chat_id: string;
  }>>;

  /** Approval relay delivery channels. Telegram reuses an already-built
   * transport, so no bot token is authored in this block. */
  approval_channels?: {
    slack?: {
      enabled?: boolean;
      token?: string;
      channel_id?: string;
      lang?: string;
    };
    teams?: {
      enabled?: boolean;
      token?: string;
      channel_id?: string;
      lang?: string;
    };
    telegram?: {
      enabled?: boolean;
      chat_id?: string;
    };
  };

  // ─── Bot Capabilities (flag-gate + per-capability policies + mail/.deck) ──
  /** Bot capability framework configuration (flag-gate, opt-in default-off).
   *  Controls which bot capabilities are active, their approval policies per capability,
   *  per-chat policy overrides, and SMTP mail config with $DECK: secret resolution. */
  bot_capabilities?: BotCapabilitiesConfig;

  /**
   * Per-user identity↔RBAC authorization for connector message surface (ADR-092).
   * Default-off: when absent or enabled:false, connectors keep per-channel behavior.
   */
  identity?: {
    enabled: boolean;
    provider?: IdentityProviderConfig;
    owner?: { connector: string; externalId: string; tenantId: string };
    roleMap?: Record<string, { role: 'admin' | 'operator' | 'viewer'; permissions?: string[] }>;
    channels?: Record<string, { tenantId: string; projectPath: string; mode: 'tenant-locked' | 'per-user'; guestRole?: 'admin' | 'operator' | 'viewer' }>;
    verify?: { ttlSeconds?: number; maxAttempts?: number };
    enforcement?: 'strict' | 'permissive';
  };

  // ─── Native transport + bot-agent (REPL native agent + BOT-1) ──────
  /** Local Ollama endpoint (e.g. "http://127.0.0.1:11434") — native agent + bot-agent. */
  ollama_host?: string;
  /** Pin the native-agent provider from settings ('claude' | 'openai' | 'ollama'
   *  | 'deepseek' | 'qwen' | 'glm'). Unset → env/config transport detection.
   *  An unresolvable pin fails honestly at boot (no silent fallback). */
  native_provider?: string;
  /** Wire/alias model id for the native transport (e.g. "fable", "qwen3.6:27b"). */
  native_model?: string;
  /** Prompt-side context budget for the native agent (estimated tokens).
   *  Unset → per-provider default (ollama 24k · claude 160k · else 100k). */
  native_context_tokens?: number;
  /** OpenAI-compatible base URL (OpenAI/OpenRouter/vLLM). */
  openai_base_url?: string;
  /** BOT-1 bot-agent — humanizes/summarizes connector (Telegram/Discord) messages. */
  bot_agent?: BotAgentConfig;

  // ─── Telemetry ─────────────────────────────────────────────────────
  /** Telemetry enabled (default: false) */
  telemetry_enabled?: boolean;
  /** Anonymous telemetry (default: true) */
  telemetry_anonymous?: boolean;

  // ─── Environment Detection ─────────────────────────────────────────
  /** Auto-detected environment */
  detected_env?: 'vscode' | 'codex' | 'gemini' | 'cursor' | 'tmux' | 'shell' | null;
  /** Multi-IDE mode (default: false) */
  multi_ide_mode?: boolean;

  // ─── Auth ──────────────────────────────────────────────────────────
  /** Auth mode (default: 'subscription') */
  auth_mode?: 'subscription' | 'api' | 'hybrid';
  /** Bearer token for HTTP API authentication. Falls back to DECKENT_API_TOKEN env var. */
  api_auth_token?: string;
  /**
   * OIDC JWT verification for the HTTP API bearer middleware (Sprint 267).
   * Optional block — when absent, behavior is unchanged (static token only).
   * A Bearer value is checked against the static token FIRST (constant-time);
   * on mismatch it is verified as a JWT via `verifyJwt` (src/core/auth-oidc.ts).
   * When enabled WITHOUT a static token, auth becomes ACTIVE: a valid Bearer
   * JWT is required for non-exempt requests. `key` supports `$DECK:KEY`
   * references (the whole config passes through deck-interpolation on load).
   */
  api_oidc?: {
    /** Master switch — the block is inert unless true. */
    enabled: boolean;
    /** Expected `iss` claim (required non-empty when enabled). */
    issuer: string;
    /** Expected `aud` claim (optional). */
    audience?: string;
    /** Pinned signature algorithm — key material is routed only to this slot. */
    algorithm: 'HS256' | 'RS256';
    /** HS256 shared secret or RS256 PEM public key (required non-empty when enabled). */
    key: string;
  };
  /**
   * Dashboard SSO via the OIDC authorization-code + PKCE flow (Sprint 277, ENT-5).
   * Optional block — default-off; when absent or `enabled: false` the dashboard
   * SSO surface is inert and `POST /api/auth/oidc/exchange` responds 404
   * (disabled). When enabled, the backend token-exchange endpoint discovers the
   * IdP (`<issuer>/.well-known/openid-configuration`), exchanges the
   * authorization `code` (+ PKCE `code_verifier`) at the IdP token endpoint, and
   * verifies the returned `id_token` against the issuer's JWKS (auth-jwks.ts SSOT,
   * RS256-pinned) before handing it to the dashboard. `client_secret` supports
   * `$DECK:KEY` references (the whole config passes through deck-interpolation).
   */
  dashboard_oidc?: {
    /** Master switch — the block is inert unless true. */
    enabled: boolean;
    /** OIDC issuer base URL — discovery hits `<issuer>/.well-known/openid-configuration`. */
    issuer: string;
    /** Public client id registered with the IdP (also the expected id_token `aud`). */
    client_id: string;
    /** Confidential-client secret (optional — omit for public PKCE clients). */
    client_secret?: string;
    /** Redirect URI registered with the IdP (must match the authorize request). */
    redirect_uri: string;
    /** OAuth scopes sent in the authorize request (optional; default "openid profile email"). */
    scope?: string;
  };

  // ─── Memory (V1 — flat .md files) ───────────────────────────────────
  /** @deprecated Use memory.backend instead. Kept for V1 backward compat. */
  /** Retained entry target before decay evaluation; not a context/view line budget. */
  memory_budget?: number;
  /** @deprecated Use memory.decay_after_sprints instead. Kept for V1 backward compat. */
  /** Decay entries older than N sprints (default: 5) */
  decay_after_sprints?: number;
  /** Enable pattern detection (default: true) */
  patterns_enabled?: boolean;
  /** Enable PROJECT-IDENTITY.md updates (default: true) */
  project_identity_enabled?: boolean;
  /** Human-view limits only; durable Brain records are never truncated. */
  memory_export?: MemoryExportConfig;
  /** Whole-unit query view budgets; never a durable storage limit. */
  memory_read?: Partial<MemoryReadLimitsV1>;
  /** Explicit per-consumer overrides, after authored shared read budgets. */
  memory_read_profiles?: Partial<Record<MemoryReadConsumerV1, Partial<MemoryReadLimitsV1>>>;

  // ─── Memory V2 ─────────────────────────────────────────────────────
  /** Memory V2 configuration. If present, DB-first mode is active. */
  memory?: {
    /** Storage backend (default: 'sqlite') */
    backend?: 'sqlite' | 'json';
    /** Search mode (default: 'fts5') */
    search?: 'fts5' | 'semantic' | 'hybrid';
    /** Semantic search provider (requires search='semantic'|'hybrid') */
    semantic_provider?: 'claude' | 'openai' | 'local' | null;
    /** Soft-delete entries older than N sprints (default: 20) */
    decay_after_sprints?: number;
    /** Export .md snapshots from DB (default: true) */
    export_md?: boolean;
    /** When to trigger export (default: 'sprint_end') */
    export_trigger?: 'sprint_end' | 'every_write' | 'manual';
    /** User-defined entry types beyond built-in ones */
    custom_types?: string[];
    /** i18n keyword aliases for cross-language search */
    keyword_aliases?: Record<string, string[]>;
  };

  // ─── Auditor ────────────────────────────────────────────────────────
  /** Auditor scan interval in seconds (default: 30) */
  scan_interval?: number;
  /** Heartbeat timeout in seconds — stale after this (default: 120) */
  heartbeat_timeout?: number;
  /** Enforce worker scope boundaries (default: true) */
  boundary_enforcement?: boolean;
  /** Lock stale threshold in seconds (default: 300) */
  lock_stale_threshold?: number;

  // ─── Human Checkpoints ──────────────────────────────────────────────
  /** Human approval checkpoints in sprint lifecycle.
   *  Valid values: 'plan', 'evaluate', 'fix'. Empty array = fully autonomous. */
  human_checkpoints?: ('plan' | 'evaluate' | 'fix')[];

  // ─── Sprint ─────────────────────────────────────────────────────────
  /**
   * Task dependency pipeline (SCHED-7 / 428-011 promotion — formalizes the
   * pre-existing `DeckentConfigWithPipeline` local-cast idiom in config.ts;
   * this is the field that idiom's own doc comment named as its follow-up).
   * Default: **true** (Sprint 156 Task 2 flipped false→true; Sprint 169 Task 9
   * confirmed it as the production default per ADR-045, Wave-Based Execution
   * Semantics). `loadConfig`/`mergeConfigs` resolve an absent value to `true`
   * — this optional field only types the raw `.deckent/config.json` shape a
   * user may override; the default itself is asserted in config.ts, not here.
   * When true, `sprint-spawner.ts` uses wave-based spawning, applies
   * cascade-on-NO_GO (dependents → PAUSED/cascade-skip) and unblock-on-DONE
   * (dependents → PENDING). When false, `task.dependencies` is ignored
   * (legacy FIFO — all PENDING tasks are eligible in sprint order).
   * Rollback: set `dependency_pipeline_enabled: false` in `.deckent/config.json`.
   */
  dependency_pipeline_enabled?: boolean;
  /**
   * Dogfood-449 B5 — pre-flight revalidation of CRITICAL debt at PLAN time.
   * When true (default), debt notes that assert completion AND carry
   * allowlisted evidence commands (`npx tsc --noEmit`, `npm run lint`,
   * `npx vitest run <paths>`) get those commands re-run host-side before a
   * fix task is dispatched; all-green ⇒ the debt auto-resolves instead of
   * spawning a no-op worker (sprint-449: 3 such workers per run, one debt
   * re-dispatched 15 sprints). Fail-open: any red/timeout/error keeps the
   * debt dispatched. Rollback: set `debt_preflight_enabled: false`.
   */
  debt_preflight_enabled?: boolean;
  /** Retry tasks that failed due to transient errors (network blip, timeout). Default: false (opt-in). */
  retry_transient_failures?: boolean;
  /** Enable fix phase after initial execution (default: true) */
  fix_phase_enabled?: boolean;
  /** Max retries during fix phase (default: 2) */
  max_fix_retries?: number;
  /** Post-FIX logical-task circuit breaker. */
  fix_circuit_breaker?: FixCircuitBreakerConfig;
  /** Mode-independent recovery/finalize containment timings. */
  lifecycle_recovery?: LifecycleRecoveryConfig;
  /** AI planner subprocess timeout in milliseconds (default: 60000) */
  ai_planner_timeout?: number;
  /** @deprecated Use `coverage_aspirational` (auto-learn target) +
   *  `coverage_hard_floor` (immutable EVALUATE gate) instead.
   *  When set, this value is mapped to `coverage_aspirational` on load
   *  for backward compatibility. */
  coverage_threshold?: number;
  /** Immutable coverage floor used by the EVALUATE gate (default: 50).
   *  Finalizer auto-learn never lowers `coverage_aspirational` below
   *  this value. Sprint 179 W2-4. */
  coverage_hard_floor?: number;
  /** Auto-learn coverage target (default: 90). Lowered by finalizer
   *  when recent avg coverage falls below it, but clamped at
   *  `coverage_hard_floor`. Sprint 179 W2-4. */
  coverage_aspirational?: number;
  /** Max reroute attempts per task during mid-sprint adapter (default: 3) */
  max_reroutes?: number;
  /** Also reroute GO_WITH_TECH_DEBT tasks, not just NO_GO (default: false) */
  reroute_on_tech_debt?: boolean;
  /** Sprint timeout in minutes. 0 = unlimited (no timeout). Positive = minutes. Default: 0 */
  sprint_timeout_minutes?: number;

  // ─── Rollback ───────────────────────────────────────────────────────
  /** Rollback policy: 'never' | 'on_failure' | 'always' (default: 'never') */
  rollback_policy?: 'never' | 'on_failure' | 'always';
  /** Evaluate-time NO_GO file-revert (ROLLBACK-DECIDE, born-427). @see RollbackConfig */
  rollback?: RollbackConfig;

  // ─── Rubric-Based Evaluation ──────────────────────────────────────
  /** Custom evaluation rubric overrides (merged with DEFAULT_RUBRIC) */
  evaluation_rubric?: Partial<EvaluationRubric>;
  /** Final settlement truth checks. */
  evaluation?: EvaluationConfig;
  /** ADR-G-040 acceptance-matrix per-cell overrides (task-kind × verdict →
   *  ACCEPT/ROUTE/REJECT). Invalid rules are dropped with typed reasons at
   *  resolution time — a malformed line never changes acceptance silently. */
  acceptance_matrix?: AcceptanceMatrixOverride;
  /** Acceptance-policy mode: 'observe' stamps audit records only (default);
   *  'enforce' lets the policy cap/route the verdict (REJECT caps at NO_GO
   *  unsalvageably; ROUTE downgrades DONE to tech-debt and persists a typed
   *  ConfirmationRequest for the adapter surface). */
  acceptance_enforcement?: 'observe' | 'enforce';
  /** Max retries when rubric evaluation fails (default: 0, max: 3) */
  rubric_max_retries?: number;

  // ─── Adaptive Thresholds ────────────────────────────────────────────
  /** Auto-adjust routing parameters based on sprint NO_GO rate (default: false) */
  adaptive_thresholds?: boolean;
  /** Minimum agent score for routing selection (default: 5, range: 2-8) */
  agent_min_score?: number;
  /** Adaptive threshold tuning parameters */
  adaptive_config?: AdaptiveConfig;

  // ─── Routing Engine v3 ─────────────────────────────────────────────
  /** Routing engine version. Only provider-independent vector routing v3 is
   * supported. Legacy v1/v2 config values migrate to v3. Default: 'v3'. */
  routing_engine?: 'v3';
  /** Routing behaviour tuning flags (all default-off, opt-in). `effort_tiering` is the sole
   *  surviving flag — skill_agent_affinity/agent_cache/kindAffinity/languagePenalty were removed
   *  with the V2 routing engine (S3 cut-over 2026-07-15); their consumer (core/routing-engine.ts)
   *  is gone and V3 folds those signals into its capability/requirement vectors. A pre-cut-over
   *  config that still carries them is harmless: `routing` is not strict-validated, so unknown
   *  JSON keys pass through untouched (config.ts whole-object passthrough). */
  routing?: {
    /** born-636-K2 (407-003 + CC son-mil): task-type→effort tiering (documentation/config
     *  → 'low' · security/migration/audit → 'high'); explicit `Effort:` hint always wins.
     *  Default-off = byte-identical planning. */
    effort_tiering?: boolean;
  };
  /** Delay in ms before cleanup deletes .tasks/ files. Default: 180000 (180s). Set 0 for immediate. */
  cleanup_delay_ms?: number;
  /** Routing engine tuning parameters (v2 only) */
  routing_config?: {
    agentMinScore?: number;
    skillMinScore?: number;
    confidenceThreshold?: number;
    maxSkillsDefault?: number;
  };
  /** How many terminal tasks (DONE/NO_GO) before writing a checkpoint. Default: 5. */
  sprint_checkpoint_interval?: number;

  // ─── Plugin Security ──────────────────────────────────────────────
  /** Require valid SHA-256 signature for plugin hook modules (default: false).
   *  When true, unsigned plugins are rejected. When false, they emit a warning. */
  plugin_require_signature?: boolean;

  // ─── Timeout ───────────────────────────────────────────────────────
  /** Unified timeout configuration for all backends */
  timeout?: Partial<TimeoutConfig>;

  // ─── Observability ──────────────────────────────────────────────────
  /** Observability configuration: metrics rotation, archiving, sprintId tagging */
  observability?: {
    rotation?: {
      /** Max size in MB before auto-rotate (default: 1) */
      maxSizeMB?: number;
      /** Archive format (default: 'gzip') */
      archiveFormat?: 'gzip';
      /** Keep last N archived files (default: 10) */
      keepLastN?: number;
    };
  };

  // ─── Sprint File Retention ───────────────────────────────────────────
  /** Retention policy for sprint-prefixed files in .deckent/ (events, checkpoints, gates, pre-archives).
   *  Hybrid strategy: keep_last_n + size_cap_mb — whichever triggers first wins. */
  sprint_file_retention?: Partial<SprintFileRetentionConfig>;
  /** Retention policy for scheduler-shadow JSONL files (age-based archive). */
  scheduler_shadow_retention?: Partial<SchedulerShadowRetentionConfig>;
  /** Bounded policy for runtime/recent artifact families. Safe default is disabled. */
  runtime_artifact_retention?: RuntimeArtifactRetentionConfigInput;

  // ─── Nervous System ─────────────────────────────────────────────────
  /** Proactive meta-orchestrator nervous system configuration (Sprint 147+) */
  nervous_system?: NervousSystemConfig;

  // ─── Resource Monitor ───────────────────────────────────────────────
  /** Docker worker resource monitoring configuration (Sprint 271). Default-disabled (opt-in). */
  resource_monitor?: ResourceMonitorConfig;


  // ─── Cross Verify ────────────────────────────────────────────────────
  /** Cross-provider adversarial verification configuration (Sprint 276 XVER-1). Default-disabled (opt-in). */
  cross_verify?: CrossVerifyConfig;

  // ─── Worker Comms ────────────────────────────────────────────────────
  /** Worker-to-worker communication configuration (Sprint 278 COMM-1). Default-disabled (opt-in). */
  worker_comms?: WorkerCommsConfig;

  // ─── Trace (training + live progress-stream) ────────────────────────
  /** Sprint-worker training-trace recording (TRN-1). @see TrainingTraceConfig */
  training_trace?: TrainingTraceConfig;
  /** Worker-runner ordered progress-stream (ADR-G-025 §4). @see LiveTraceConfig */
  live_trace?: LiveTraceConfig;

  // ─── External MCP client (REPL `/mcp` + native tool surface) ─────────
  /**
   * Opt-in gate for the REPL's EXTERNAL MCP client (387-013 MCP-CLIENT-GATE,
   * wired for real 2026-07-15 / REPL-575 K1). Only an explicit `true` connects
   * configured MCP servers (`.mcp.json` / `.mcp.local.json` / `~/.deckent/mcp.json`)
   * at native-REPL boot or on `/mcp` in the legacy loop; absent/`false` = no
   * external MCP surface — with an honest disabled-notice when servers ARE
   * configured. Truth-table lives in `isMcpClientEnabled()`
   * (src/cli/repl/mcp-bridge.ts).
   */
  mcp_client_enabled?: boolean;

  // ─── Routing Engine v3 (Sprint 445 Slice-0 foundation) ───────────────
  /** RoutingEngineV3 vector-selection config — raw project-config override shape (mirrors
   *  `timeout?: Partial<TimeoutConfig>`). Resolve via `resolveRoutingV3Config()`
   *  (core/routing/config.ts), not by reading this field directly — it is a partial user
   *  override, not the defaulted/validated shape. Default: enabled=false. @see RoutingV3Config */
  routing_v3?: Partial<RoutingV3Config>;

  // ─── Doc-Tracking (ADR-090) ──────────────────────────────────────────
  /** Doc-tracking options. */
  doc_tracking?: {
    /** Run a DB-only doc-tracking sync at sprint finalize (default: false). */
    sync_on_finalize?: boolean;
  };

  // ─── Cost Guard ──────────────────────────────────────────────────────
  /** Mid-sprint token-usage abort guard (Sprint 279 WK-cost). Default-disabled (opt-in). */
  cost_guard?: CostGuardConfig;

  // ─── Scheduler (SCHED4 shadow-reducer) ───────────────────────────────
  /** Full-reducer SHADOW-only observation config (docs/analysis/scheduler-unify-design-2026-07-11.md). Default-disabled (opt-in). */
  scheduler?: SchedulerConfig;

  // ─── Gate (Sprint 325 — outcome downgrade triggers) ──────────────────
  /** Sprint outcome gate configuration (flag-gated, default-off).
   *  Absent block or max_tech_debt_ratio=0 → byte-identical behavior. */
  gate?: GateConfig;

  // ─── Approval (Sprint 355 CFG-APR-WIRE — runtime-wide ApprovalBroker) ─
  /** Approval policy rules + gate/relay activation flags (flag-gated,
   *  default-off for gate/relay; rules default to the loader's own safe set).
   *  @see ApprovalConfig */
  approval?: ApprovalConfig;

  // ─── ERP (capability-broker erp.read) ───────────────────────────────
  /** ERP connector for the `erp.read` capability (process + autonomous). Opt-in
   *  (`enabled` default-off); secret-free — the credential is read from an env
   *  var, never stored here. CORE-W5: IFS is the first live driver. */
  erp?: ErpRuntimeConfig;

  // ─── Computer-Use (TOOL-CU dilim-1, Sprint 369-005) ─────────────────
  /** Computer-use capability pack — contract layer only (no adapter yet, see
   *  computer-use-contract.ts). Opt-in (`enabled` default-off); even when
   *  enabled, only capabilities named in `allowed_capabilities` are granted
   *  (fail-closed allowlist). @see ComputerUseConfig */
  computer_use?: ComputerUseConfig;

  // ─── Worker Output Contract (Task-8, consumed by a future task) ─────
  /** Worker `.result` strictness — reserved for a future consumer (Task-8).
   *  Opt-in (`enabled`/`strict_report` default-off); no code reads this block
   *  yet. @see WorkerOutputContractConfig */
  worker_output_contract?: WorkerOutputContractConfig;

  // ─── Autonomous Engine ──────────────────────────────────────────────
  /** Autonomous execution engine configuration (Sprint 226 — Task 7). Default-disabled. */
  autonomous?: {
    /** Enable autonomous engine (default: false — flag-gated, ADR-040). */
    enabled: boolean;
    /** Idle-tick interval in ms (default: 5000). */
    interval_ms?: number;
    /** Path to backlog.json relative to project root (default: '.deckent/autonomous/backlog.json'). */
    backlog_path?: string;
    /** Max concurrent autonomous executions (default: 1 — serial). */
    pool_size?: number;
    /** Reactive trigger sub-block (flag-gated, default-off). Sprint autonomous-reactive. */
    reactive?: {
      /** Enable reactive trigger bridge (default: false). */
      enabled: boolean;
      /** Path to the reactive trigger map JSON, relative to project root. */
      map_path?: string;
      /** N2: repo-watch reactive source — working-tree changes → backlog (default-off). */
      repo_watch?: { enabled: boolean };
      /** N2: webhook reactive source — drains .deckent/autonomous/reactive-inbox.jsonl
       *  (POST /api/reactive/webhook ingress) → backlog (default-off). */
      webhook?: { enabled: boolean };
    };
    /** Work-generator sub-block (flag-gated, default-off): self-generated work
     *  from active tech-debt records → backlog candidates. */
    work_generator?: {
      /** Enable debt→backlog work generation (default: false). */
      enabled: boolean;
      /** Minimum ms between debt scans (default: 600000 — 10 min). */
      interval_ms?: number;
    };
    /** RBAC policy enforcement on machine-initiated dispatch (flag-gated,
     *  default-off). When enabled, every backlog/work-gen/reactive entry is
     *  gated through evaluatePolicy's RBAC layer under `role` — a role
     *  without 'execute' (viewer) hard-DENIES autonomous execution. */
    rbac_policy?: {
      /** Enable RBAC enforcement for autonomous dispatch (default: false). */
      enabled: boolean;
      /** Role the autonomous engine acts under (default: 'viewer' — deny-by-default). */
      role?: 'admin' | 'operator' | 'viewer';
    };
  };

  // ─── Runtime Style ─────────────────────────────────────────────────
  /** Active runtime style — sprint (developer orchestration) or task (one-shot life assistant) */
  deckent_style?: 'sprint' | 'task' | 'process';

  // ─── Terminal ──────────────────────────────────────────────────────
  /** Embedded web terminal configuration (Sprint 175). */
  terminal?: TerminalConfig;

  // ─── Plugin Security (born-612, 405-002 + CC son-mil) ────────────────
  /** Plugin authenticity policy: Ed25519 trust-root + unsigned-plugin stance.
   *  Shape mirrors PluginsRawConfig (src/core/plugin-loader.ts) — resolved
   *  there via resolvePluginSecurityConfig(). */
  plugins?: {
    /** Whether security findings warn-and-load or fail closed. Default: 'advisory'. */
    security_enforcement?: PluginSecurityEnforcement;
    /** When true, unsigned plugins are rejected (fail-closed). Default false = load + loud-warn. */
    require_signature?: boolean;
    /** Trusted publisher keys ({ keyId, publicKey } records) — the signature trust-root. */
    trusted_publisher_keys?: Array<{ keyId: string; publicKey: string }>;
  };

  // ─── Native REPL Surface ─────────────────────────────────────────────
  /** Native-REPL progressive-disclosure meta-tools (TOOL-REPL-WIRE, 354-002). @see ToolSurfaceConfig */
  tool_surface?: ToolSurfaceConfig;
  /** Native-REPL mode-indicator + live-footer + approval-card surface (354-001/355-011). @see ReplSurfaceConfig */
  repl_surface?: ReplSurfaceConfig;
  /** Task-based worker tool-surface reduction (born-674, ALLOW-WIRE 427-014 / W674B 428-002). @see ToolsConfig */
  tools?: ToolsConfig;

  // ─── Prompt Generation (Sprint 182 PQ-5 / F7) ──────────────────────
  /** Worker prompt generation tuning. */
  prompt?: PromptConfig;

  // ─── Plan Phase (Sprint 276 PLAN-INT-1) ─────────────────────────────
  /** Plan phase behavior tuning. */
  plan?: PlanConfig;
}

/** Plan phase configuration (Sprint 276 PLAN-INT-1). */
export interface PlanConfig {
  /** Enable directive interrogation before planning (default: false). */
  interrogate?: boolean;
}

/** Worker prompt generation tuning (Sprint 182 PQ-5 / F7). */
export interface PromptConfig {
  /**
   * Minimum ADR relevance score required to include an ADR in the worker
   * prompt's mandatory rules block. ADRs whose computed score falls below
   * this threshold are dropped; if every selected ADR is filtered out the
   * entire `=== Mandatory Architecture Rules (ADR) ===` block is omitted
   * (no empty header). Default: 0.3 (lenient).
   */
  adr_min_relevance?: number;
  /**
   * ADR render mode for worker prompt injection (Sprint 273 F1-TOK).
   * 'full' (default): full ADR content emitted as-is.
   * 'operative': if content contains <!-- worker-operative-start --> /
   * <!-- worker-operative-end --> markers, only that section is emitted
   * with footnote "[full text: .brain/memory.db adr-NNN]"; ADRs without
   * markers fall back to full content. No content is auto-summarized.
   */
  adr_render?: 'full' | 'operative';
  /**
   * Persona render mode for worker prompt injection (ADR-G-027 sanctioned
   * condensed+pointer shape — content-completeness bound WITHOUT access-loss).
   * 'full' (default): full persona/agent-prompt content emitted as-is
   * (byte-identical to pre-existing behavior).
   * 'guidance': a focused, condensed persona render — active-constraint head +
   * summary + pointer to the full source, mirroring the `adr_render: 'operative'`
   * shape for persona content. No content is ever dropped from disk/access, only
   * from the transport render.
   */
  persona_render?: 'full' | 'guidance';
  /**
   * Pass the Claude CLI `--exclude-dynamic-system-prompt-sections` flag on every
   * claude worker spawn (F3.1). The flag moves per-machine sections (cwd, env,
   * memory paths, git status) out of the default system prompt and into the first
   * user message, so the system-prompt PREFIX stays byte-stable across spawns and
   * across the sprint — most importantly, a mid-sprint `git` commit (git status
   * changes) no longer invalidates whatever prompt-cache does apply
   * (single-session / subscription level). Only takes effect with the default
   * system prompt (deckent never passes `--system-prompt`), and only for the claude
   * provider — other providers ignore it. Default: true. Set false to restore the
   * pre-F3.1 spawn args byte-for-byte.
   */
  exclude_dynamic_system_prompt_sections?: boolean;
  /**
   * 7094-F3 deckent-owned worker composition (default: true — owner decision
   * 2026-08-20 after the measured bar was met: three consecutive fully clean
   * rounds, sprints 582/583/584, each 6/6 attempt-1 DONE with zero fixes;
   * cumulative cost vs the 567 baseline: comprehensive -70%, simple ~-60%).
   * Externalizes the task-invariant worker CORE to a content-addressed file
   * and starts claude workers with `--system-prompt-file <core>` +
   * `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` + `--disable-slash-commands` (F2b) —
   * composition fully deckent-owned; auth and the stock tool set stay intact
   * (the F3-v1 `--bare` variant was measured and rejected: it broke
   * credential discovery). Set false to restore the stock-CLI composition
   * byte-for-byte (the pre-F3 spawn args and prompt).
   */
  worker_core_system_prompt?: boolean;
  /**
   * Codex-owned core prompt channel (default: true — owner decision 2026-08-25
   * after the canary bar was met: sealed-cohort A/B sprint-667 (OFF) vs
   * sprint-668 (ON) measured −41.2% total tokens at full quality parity, and
   * the worker prompt shrank 36.8KB→32.2KB). Set false to restore the
   * pre-channel prompt path byte-for-byte.
   */
  codex_core_channel?: boolean;
  /**
   * Suppress Codex project-document loading (default: true — same owner
   * decision and sealed-cohort evidence as `codex_core_channel`, 2026-08-25;
   * the two flags were measured together as one candidate feature). Set false
   * to restore stock project-document discovery.
   */
  codex_suppress_project_doc?: boolean;
  /**
   * Usage prompt-cost canary PROMOTE/REJECT thresholds (KANUN 10: flow values
   * are config-owned — the CLI caller must not hardcode policy). Every field
   * is a ratio in [0,1] except maximumCostPerLineageIncreaseRatio (>= 0).
   */
  canary_thresholds?: {
    minimumQualityPassRate?: number;
    maximumQualityPassRateRegression?: number;
    maximumCostPerLineageIncreaseRatio?: number;
    minimumCacheHitRatio?: number;
    maximumCacheHitRatioRegression?: number;
  };
  /**
   * Usage prompt-cost canary cost-authority policy (owner decision 2026-08-25).
   * `auto` (default): full provider USD on both arms keeps USD authority; two
   * fully-unpriced subscription arms settle the cost threshold on the
   * total-token measurement (`token-total`, digest-bound in the kernel plan);
   * partial/mixed pricing always HOLDs. `provider-usd-strict`: only full
   * provider-reported USD settles — unpriced arms HOLD as before.
   */
  canary_cost_authority?: 'auto' | 'provider-usd-strict';
  /**
   * 593-001 F2c catalog mount mask (default: **false** — behavior stays
   * byte-identical until the flag is explicitly turned on).
   *
   * The docker backend bind-mounts the WHOLE project root read-write at
   * `/workspace`, so the repo's design catalogs travel into every worker
   * container: `.claude/skills/` (11 SKILL.md, ~118.8KB measured) and
   * `.claude/agents/` (3 files, ~8KB) — irrelevant to a typical worker task and
   * pure discovery surface. When true, the docker backend overlays an empty
   * read-only directory on those two paths, so a worker sees them EMPTY.
   *
   * **ADR-G-027 safe by construction:** the assigned skill bodies and the agent
   * persona are injected VERBATIM into the prompt itself (`buildSkillBlock`,
   * `prompt-god-template.ts`) — the mask only closes MOUNT-side discovery of
   * catalogs the task was never assigned. Prompt-side injection is untouched, so
   * content-completeness (skill + scope-relevant ADR never truncated) holds.
   *
   * Default stays false until the mask is validated on a live sprint; flipping
   * the default is a separate decision.
   */
  catalog_mount_mask?: boolean;
  /**
   * 593-002: task-class profile SSOT surface (`prompt.task_profiles`).
   *
   * Tunes the ONE canonical classifier (`resolveTaskPromptProfile`,
   * `src/core/work-model.ts`) that the prompt compiler (core system prompt /
   * scope block / verify tier) and the coverage validator now share instead of
   * three drifting inline predicates. Partial: every unspecified field falls back
   * to `DEFAULT_TASK_PROFILES`, whose values are exactly the literals those
   * predicates carried — so the default resolution is behavior-identical to the
   * pre-593-002 output.
   *
   * ADR-G-027: the profile selects prompt COMPOSITION; it never truncates skill,
   * ADR or task content.
   */
  task_profiles?: Partial<TaskProfileConfig>;
}

// ─── Nervous System Config Types ────────────────────────────────────

/** Authority mode for Nervous System — controls how autonomously it acts */
export type NervousAuthorityMode = 'strict' | 'balanced' | 'autopilot' | 'full-auto';

/** Severity levels for Nervous System notifications */
export type NervousSeverityMin = 'info' | 'warning' | 'critical' | 'emergency';

/** Approval policy types */
export type NervousApprovalPolicy = 'autonomous' | 'suggest-30m' | 'suggest-5m' | 'approve';

/** Safety floor locked actions — never auto-executed */
export type NervousSafetyFloorAction =
  | 'KILL_LIVE_SPRINT'
  | 'MANUAL_FILE_DELETE'
  | 'COST_OVER_THRESHOLD'
  | 'DESTRUCTIVE_GIT'
  | 'ADR_DEPRECATE_ACCEPTED';

/** Individual detector configuration */
export interface NervousDetectorConfig {
  /** Whether this detector is active */
  enabled: boolean;
  /** Stale worker threshold in ms (stale_worker only) */
  threshold_ms?: number;
  /** Debt trend rate threshold 0-1 (debt_trend only) */
  threshold_rate?: number;
  /** Agent routing anomaly threshold 0-1 (agent_routing only) */
  anomaly_threshold?: number;
  /** Auto-restore DIRECTIVES.md on corruption (directives_protection only) */
  auto_restore?: boolean;
  /** Reserved for future sprint (reserve detectors only) */
  reserve_for?: string;
  /**
   * Owner-notification pending-age threshold in ms (notification_delivery_health
   * only). Distinct from `threshold_ms` (documented stale_worker-only above) so
   * the two detectors' semantics stay unambiguous — this field is never read by
   * stale_worker. Default: 300_000 (5 min) — several multiples of the bot-daemon
   * outbox drain cadence (`notify_outbox_drain_interval_ms`, default 30s) so a
   * healthy drain cycle never trips this detector on its own latency.
   */
  pending_age_threshold_ms?: number;
}

/**
 * Full Nervous System configuration schema (V2) — the **single source of truth** for the
 * `nervous_system` block, referenced by both {@link DeckentConfig} and {@link ResolvedConfig}.
 *
 * The narrow camelCase runtime view consumed by the nervous modules
 * (`NervousSystemConfigV1` in `core/nervous-types.ts`) is **derived from this type** as a documented
 * backward-compat shim — it does not redefine the schema, so the two can never drift (Sprint 323
 * V1→V2 migration). Runtime validation mirroring this interface lives in `core/config.ts`
 * (`NERVOUS_SYSTEM_SCHEMA`).
 */
/** Persona integrity detection thresholds (owner D-G(a), sprint-523 task 5). */
export interface PersonaIntegrityConfig {
  /** Bytes below which a resolved persona is classified `undersized`. */
  min_bytes?: number;
}

export interface NervousSystemConfig {
  /** Enable nervous system (default: false — Sprint 148 will set true) */
  enabled: boolean;
  /** Authority mode preset (default: 'balanced') */
  mode: NervousAuthorityMode;
  /** Hard timeout (ms) before a non-safety-floor 'approve' action AUTO-PROCEEDS
   *  if not approved (default 10000). Set to 0 (or negative) to DISABLE
   *  auto-proceed: such actions then stay pending until you explicitly accept or
   *  reject (safety-floor actions never auto-proceed regardless). */
  approve_timeout_ms?: number;
  /** APPROVAL-LOOP fix (sprint-443): how long (ms) a REJECTED finding-fingerprint
   *  stays suppressed — the same finding is NOT re-asked within this window
   *  (default: decision-memory DEFAULT_REJECT_SUPPRESS_MS = 6h). */
  reject_suppress_ms?: number;
  /** APPROVAL-LOOP fix (sprint-443): cool-down (ms) after an ACCEPTED/EXECUTED
   *  finding-fingerprint — the same finding is not re-asked while the action takes
   *  effect; if it re-fires AFTER the window it is surfaced as a repeat-escalation
   *  (default: decision-memory DEFAULT_ACCEPT_COOLDOWN_MS = 30m). */
  accept_cooldown_ms?: number;
  /** N3 (default false): opt-in cooperative worker respawn. When true, the nervous
   *  WORKER_RESPAWN action writes a durable respawn-REQUEST the sprint-controller
   *  drains + actions through its own lifecycle (no race). False → propose. */
  worker_respawn?: boolean;
  /** Per-action policy overrides — override preset for specific actions */
  actionOverrides: Record<string, NervousApprovalPolicy>;
  /** Safety floor configuration */
  safety_floor: {
    /** Actions that require explicit user approval even in full-auto mode */
    locked_actions: NervousSafetyFloorAction[];
    /** Cost threshold in USD — COST_OVER_THRESHOLD triggers above this */
    cost_threshold_usd: number;
    /** Whether safety floor can be bypassed (always false — code-locked) */
    bypass_allowed: boolean;
  };
  /** Notification channel and throttle configuration */
  notifications: {
    /** Output channels */
    channels: {
      mcp: boolean;
      cli: boolean;
      file: boolean;
      desktop: boolean;
    };
    /** Minimum ms between same-group notifications */
    throttle_ms: number;
    /** Window for grouping info notifications (ms) */
    group_info_window_ms: number;
    /** Minimum severity level to surface notifications */
    severity_min: NervousSeverityMin;
    /** Quiet hours — no non-critical notifications in this window */
    quiet_hours: {
      start: string;   // "HH:MM" format
      end: string;     // "HH:MM" format
      timezone: string;
    };
    /** Deduplicate notification across channels by ID */
    cross_channel_dedup: boolean;
  };
  /** Per-detector configuration — Sprint 180 W0: 16 detectors (3 Faz-1 active + 13 reserved/optional).
   *  Sprint 165'te dead_event_stream kod hazır → reserve_for kaldırıldı.
   *  Sprint 180 W0 (NERVOUS-TODO §11.2 Step F): 6 yeni detector default enabled:false. */
  detectors: {
    stale_worker: NervousDetectorConfig;
    scope_collision: NervousDetectorConfig;
    debt_trend: NervousDetectorConfig;
    agent_routing: NervousDetectorConfig;
    directives_protection: NervousDetectorConfig;
    dead_event_stream: NervousDetectorConfig;
    cost_threshold: NervousDetectorConfig;
    prompt_quality: NervousDetectorConfig;
    worker_output_variance: NervousDetectorConfig;
    self_modifying_warner: NervousDetectorConfig;
    task_mode_idle: NervousDetectorConfig;
    build_failure_recurrence: NervousDetectorConfig;
    token_spike: NervousDetectorConfig;
    agent_routing_anomaly: NervousDetectorConfig;
    scope_collision_rate: NervousDetectorConfig;
    notification_delivery_health: NervousDetectorConfig;
  };
  /** Retention for history JSONL file in days */
  history_retention_days: number;
}

/** Configuration for sprint-prefixed file retention in .deckent/ directory.
 *  Hybrid strategy: keep_last_n sprints + size_cap_mb — whichever triggers first.
 *  Files beyond retention window are archived to archive_path/<sprint-id>/. */
export interface SprintFileRetentionConfig {
  /** Number of most-recent sprints to keep in .deckent/ root (default: 10) */
  keep_last_n: number;
  /** Maximum total size in MB for sprint files before oldest are archived (default: 500) */
  size_cap_mb: number;
  /** Archive destination path relative to project root (default: '.deckent/archive/sprints/') */
  archive_path: string;
}

/** Configuration for scheduler-shadow JSONL file retention in
 *  .deckent/runtime/scheduler-shadow/ directory. Age-based strategy:
 *  files older than retention_days are archived to archive_path. */
export interface SchedulerShadowRetentionConfig {
  /** Age in days after which a scheduler-shadow JSONL file is archived (default: 14) */
  retention_days: number;
  /** Archive destination path relative to project root (default: '.deckent/archive/scheduler-shadow/') */
  archive_path: string;
}

/** Bounds applied independently to one owned runtime artifact family. */
export interface RuntimeArtifactFamilyRetentionConfig {
  /** Maximum artifact age before archival. */
  max_age_days: number;
  /** Maximum number of artifacts retained in the live family. */
  max_count: number;
  /** Maximum aggregate live-family size in MiB. */
  max_size_mb: number;
}

/** Config-resolved runtime artifact retention authority. */
export interface RuntimeArtifactRetentionConfig {
  /** Enables policy evaluation. Default false preserves existing configs. */
  enabled: boolean;
  /** Applies the policy during sprint finalization. Default false. */
  apply_on_finalize: boolean;
  /** Archive destination relative to the project root. */
  archive_path: string;
  /** Explicit bounds keyed by owned artifact-family name. */
  families: Record<string, RuntimeArtifactFamilyRetentionConfig>;
}

/** Authoring shape; layered config may override any subset of resolved policy. */
export type RuntimeArtifactRetentionConfigInput =
  Partial<Omit<RuntimeArtifactRetentionConfig, 'families'>> & {
    families?: Record<string, Partial<RuntimeArtifactFamilyRetentionConfig>>;
  };

export interface ResolvedConfig {
  mode: PlanMode;
  activeModeConfig: PlanModeConfig;
  modes: Record<string, PlanModeConfig>;
  /** Explicit top-level Brain planning-mode override; see DeckentConfig.brain_planning.
   *  Precedence (Task 429-006): explicit top-level > modes.<mode>.brain_planning
   *  (preset) > 'auto'. Resolve via `resolveBrainPlanningMode()` (config.ts) —
   *  never read this field directly. */
  brain_planning?: BrainPlanningMode;
  language: string;
  projectName: string;
  projectRoot: string;
  version: string;
  /** Show the Kraken ASCII splash on first sprint start (default: true).
   *  @see DeckentConfig.output_splash — gated via showSplashIfEnabled (ADR-021). */
  output_splash?: boolean;
  /** Resolved tier-based model strategy (from mode preset + config overrides) */
  model_strategy?: ModelStrategy;
  auto_docs?: AutoDocsConfig;
  /** Run the full pre-sprint vitest baseline before SPAWN (default: false). */
  pre_sprint_tests?: boolean;
  /** Strict multi-tenant isolation (default: false).
   *  When true, tenant-scoped queries omit the `OR tenant_id IS NULL` clause.
   *  @see DeckentConfig.strict_tenant_isolation */
  strict_tenant_isolation?: boolean;
  /** ENT-1 — HARD RBAC enforcement on the autonomous spawn paths (default: false).
   *  When false (ADR-037 V1.0): a role-denied capability is warn-only + audit-trailed but
   *  still proceeds. When true: the backlog-entry / sprint worker-spawn gates HARD-deny a
   *  request whose `actor.role` lacks a required capability. Additive + backward-safe; the
   *  permissive default keeps v1 allow-all for role-less requests.
   *  @see checkWorkerAuthority (src/nervous/authority-matrix.ts) */
  enforce_rbac?: boolean;
  /** PRINCIPAL-001 P1b — identity-assurance hard-gate (default: false).
   *  When false: an actor with missing or `unverified` assurance reaches
   *  authorization and only produces the advisory finding (P1a behaviour,
   *  byte-identical to v1). When true: the same finding becomes a typed
   *  `PrincipalAssuranceError` BEFORE the work is admitted — no synthetic or
   *  header-derived identity can authorize anything. Flag-gated and
   *  default-off on purpose: enforcement flips only after an owner-approved
   *  rollout, never blind (quality bar). @see assertActorAssurance */
  enforce_principal_assurance?: boolean;
  /** F8-003 — capability least-privilege hard-flip (default: false).
   *  When false: capability invocations proceed regardless of actor role (permissive v1-default).
   *  When true: sets `CapabilityRegistry.leastPrivilegeEnabled = true` — every invocation
   *  auto-derives grants from `ROLE_CAPABILITY_MAP[actor.role]`; a missing capability is
   *  HARD-denied + audit-trailed (`action: 'capability.denied'`). Flag-gated, additive. */
  enforce_least_privilege?: boolean;
  /** F10-002 — risk-gate hard-park for HIGH-risk capability verbs (default: false).
   *  When true + autonomous policy-engine verdict is 'permit', entries whose resolved
   *  risk class is HIGH (shell / db-write / erp-write verbs) are PARKED rather than
   *  executed. Flag-gated, additive; default-off preserves v1 permissive behavior.
   *  @see DeckentConfig.risk_gate_enabled */
  risk_gate_enabled?: boolean;
  /** Spawn backend: 'docker' | 'tmux' | 'subprocess' | 'auto' (default: 'auto') */
  spawn_backend?: 'docker' | 'tmux' | 'subprocess' | 'auto';
  /** Effective provider billing/auth regime used by runtime USD admission. */
  auth_mode?: 'subscription' | 'api' | 'hybrid';
  /** Docker image for worker containers (default: 'deckent-worker:latest') */
  docker_image?: string;
  /** Docker container timeout in seconds (default: 1200 = 20 minutes) */
  docker_timeout?: number;
  /** Opt-in per-kind Docker memory limits. Keys are canonical TaskKind values. Swap derived at × 1.5. */
  worker_memory_limit_by_kind?: Record<string, string>;
  /** Default per-worker Docker memory limit (docker `--memory`), e.g. "2g". Default '4g'. */
  worker_memory_limit?: string;
  /** WORKER-ENV-TMPFS-001: docker worker HOME tmpfs size (e.g. '256m'). Default 100m. */
  worker_home_tmpfs_size?: string;
  worker_memory_swap?: string;
  /** Skill system configuration */
  skills?: SkillConfig;
  /** Provider for Brain planning (default: 'claude') */
  brain_provider?: ProviderName;
  /** Default provider for workers (default: 'claude') */
  worker_provider?: ProviderName;
  /** Fallback when primary provider unavailable */
  fallback_provider?: ProviderName;
  /** Role-aware provider fallback policy (454-007), validated and passed
   *  through from project config. @see ProviderFallbackPolicyConfig */
  provider_fallback?: ProviderFallbackPolicyConfig;
  /** Resolved owner policy; numerical defaults are never fabricated. */
  execution_budget?: ExecutionBudgetPolicyConfig;
  /** Authored provider-limit input only; resolve parent/project layers separately. */
  provider_limits?: ProviderLimitsConfig;
  /** Persona integrity floor (owner D-G(a)); default resolved in config.ts. */
  persona_integrity?: PersonaIntegrityConfig;
  /**
   * Separately authored, immutable provider-limit authority layers.
   * Absent on manually constructed/legacy runtime config means unavailable,
   * never permission to reinterpret the merged inspection value.
   */
  provider_limit_authority?: ProviderLimitPolicyAuthoritySnapshot;
  /** Per-task provider overrides resolved from grouped or legacy config. */
  provider_overrides?: Record<string, ProviderName>;
  /** Grouped provider config pass-through (F1-012). Routing fields are already
   *  flattened into brain_provider/worker_provider/fallback_provider above; this
   *  carries `registry` (config-driven provider definitions) to bootstrap. */
  providers?: DeckentConfig['providers'];
  /** Resolved direct llama.cpp lifecycle configuration; never synthesized at runtime. */
  local_llm?: DeckentConfig['local_llm'];
  /** Host-side `DeckBroker` credential minting (passed through from DeckentConfig, 354-006). */
  deck_broker?: DeckentConfig['deck_broker'];
  /** OpenRouter provider registration (passed through from DeckentConfig, row 477). */
  openrouter?: DeckentConfig['openrouter'];
  // Memory
  memory_budget?: number;
  decay_after_sprints?: number;
  patterns_enabled?: boolean;
  project_identity_enabled?: boolean;
  memory_export?: MemoryExportConfig;
  memory_read?: Partial<MemoryReadLimitsV1>;
  memory_read_profiles?: Partial<Record<MemoryReadConsumerV1, Partial<MemoryReadLimitsV1>>>;
  /** Outbound messaging connectors (BOT-001, §4G) — passed through from project config, tokens .deck-resolved. */
  notify_connectors?: DeckentConfig['notify_connectors'];
  /** Approval relay delivery channels — passed through without secrets for Telegram. */
  approval_channels?: DeckentConfig['approval_channels'];
  /** Bot capability framework config — passed through from project config (opt-in, default-off). */
  bot_capabilities?: BotCapabilitiesConfig;
  /** Per-user identity↔RBAC config (ADR-092) — passed through from project config
   *  (opt-in, default-off). Consumed by the connector bootstrap to seed channel
   *  bindings + activate the L2 gate. */
  identity?: DeckentConfig['identity'];
  /** Native transport + BOT-1 bot-agent (passed through from project config). */
  ollama_host?: string;
  native_provider?: string;
  native_model?: string;
  native_context_tokens?: number;
  openai_base_url?: string;
  bot_agent?: BotAgentConfig;
  /** Notify on sprint completion (passed through). */
  notify_on_complete?: boolean;
  /** Durable owner-notification outbox drain interval — passed through from
   *  project config (671-001). @see DeckentConfig.notify_outbox_drain_interval_ms */
  notify_outbox_drain_interval_ms?: number;
  // Auditor
  scan_interval?: number;
  heartbeat_timeout?: number;
  boundary_enforcement?: boolean;
  lock_stale_threshold?: number;
  // Human Checkpoints
  human_checkpoints?: ('plan' | 'evaluate' | 'fix')[];
  // Sprint
  /** Retry tasks that failed due to transient errors (default: false). */
  retry_transient_failures?: boolean;
  fix_phase_enabled?: boolean;
  max_fix_retries?: number;
  /** Post-FIX logical-task circuit breaker. */
  fix_circuit_breaker?: FixCircuitBreakerConfig;
  /** Resolved mode-independent recovery/finalize containment timings. */
  lifecycle_recovery?: LifecycleRecoveryConfig;
  /** AI planner subprocess timeout in milliseconds (default: 60000) */
  ai_planner_timeout?: number;
  /** @deprecated Use `coverage_aspirational` + `coverage_hard_floor`.
   *  Retained on ResolvedConfig as the resolved aspirational value
   *  (mirrors `coverage_aspirational`) so legacy consumers keep working. */
  coverage_threshold: number;
  /** Immutable EVALUATE gate floor (Sprint 179 W2-4, default: 50).
   *  Optional on the type to keep existing ResolvedConfig literals valid;
   *  `loadConfig`/`mergeConfigs` always populate it via `resolveCoverageGates`.
   *  Consumers should `?? 50` defensively. */
  coverage_hard_floor?: number;
  /** Auto-learn aspirational coverage target (Sprint 179 W2-4, default: 90).
   *  Optional on the type — see `coverage_hard_floor` note. */
  coverage_aspirational?: number;
  /** Max reroute attempts per task during mid-sprint adapter (default: 3) */
  max_reroutes: number;
  /** Also reroute GO_WITH_TECH_DEBT tasks, not just NO_GO (default: false) */
  reroute_on_tech_debt: boolean;
  /** Sprint timeout in minutes. 0 = unlimited. Default: 0 */
  sprint_timeout_minutes: number;
  // Adaptive Thresholds
  adaptive_thresholds: boolean;
  agent_min_score: number;
  adaptive_config: AdaptiveConfig;
  // Rollback
  rollback_policy?: 'never' | 'on_failure' | 'always';
  /** Evaluate-time NO_GO file-revert (passed through from DeckentConfig, born-427). */
  rollback?: DeckentConfig['rollback'];
  // Rubric-Based Evaluation
  evaluation_rubric?: Partial<EvaluationRubric>;
  rubric_max_retries?: number;
  acceptance_matrix?: AcceptanceMatrixOverride;
  acceptance_enforcement?: 'observe' | 'enforce';
  // Routing Engine v3 (legacy v1/v2 values migrate at config ingress)
  routing_engine?: 'v3';
  routing_config?: {
    agentMinScore?: number;
    skillMinScore?: number;
    confidenceThreshold?: number;
    maxSkillsDefault?: number;
  };
  /** Routing behaviour tuning flags (all default-off, opt-in). */
  routing?: DeckentConfig['routing'];
  /** Delay in ms before cleanup deletes .tasks/ files. Default: 180000 (180s) */
  cleanup_delay_ms?: number;
  /** Enable task dependency pipeline — only spawn tasks whose deps are DONE.
   *  Resolved default: **true** (ADR-045; see {@link DeckentConfig.dependency_pipeline_enabled}
   *  for the full history/rollback note). Always populated by `loadConfig`/
   *  `mergeConfigs` — optional here only for literal-construction convenience. */
  dependency_pipeline_enabled?: boolean;
  /** Pre-flight revalidation of CRITICAL debt at PLAN time (Dogfood-449 B5).
   *  Resolved default: **true** — see {@link DeckentConfig.debt_preflight_enabled}. */
  debt_preflight_enabled?: boolean;
  /** How many terminal tasks (DONE/NO_GO) must complete before a checkpoint is written.
   * Lower values → more frequent checkpoints → safer for long sprints.
   * Default: 5. Sprint 139 override: 3. */
  sprint_checkpoint_interval?: number;
  /** Resolved timeout configuration (always populated from defaults + overrides) */
  timeout?: TimeoutConfig;
  /** Nervous system configuration (passed through from DeckentConfig) */
  nervous_system?: NervousSystemConfig;
  /** Autonomous engine configuration (passed through from DeckentConfig). Default-disabled. */
  autonomous?: DeckentConfig['autonomous'];
  /** ERP connector configuration (passed through from DeckentConfig). Opt-in, secret-free. */
  erp?: ErpRuntimeConfig;
  /** Computer-use capability pack config (passed through from DeckentConfig,
   *  TOOL-CU dilim-1). NOTE: type-only pass-through today — `loadConfig`/
   *  `mergeConfigs` (config.ts) do not yet assign this field in their resolved-
   *  object literal (that wiring is out of 369-005's write scope; tracked as a
   *  named, pinned gap in tests/core/config-flag-roundtrip.test.ts pending a
   *  dedicated follow-up task). @see ComputerUseConfig */
  computer_use?: DeckentConfig['computer_use'];
  /** Worker output-contract strictness config (passed through from DeckentConfig,
   *  reserved for a future Task-8 consumer). Same type-only-pass-through caveat
   *  as `computer_use` above — not yet wired into config.ts's resolvers.
   *  @see WorkerOutputContractConfig */
  worker_output_contract?: DeckentConfig['worker_output_contract'];
  /** Resource monitor configuration (passed through from DeckentConfig). Default-disabled. */
  resource_monitor?: ResourceMonitorConfig;
  /** Fully resolved runtime artifact retention policy. */
  runtime_artifact_retention: RuntimeArtifactRetentionConfig;
  /** Cross-provider adversarial verification configuration (passed through from DeckentConfig). Default-disabled. */
  cross_verify?: CrossVerifyConfig;
  /** Worker-to-worker communication configuration (passed through from DeckentConfig). Default-disabled. */
  worker_comms?: WorkerCommsConfig;
  /** Sprint-worker training-trace recording (passed through from DeckentConfig, TRN-1). */
  training_trace?: DeckentConfig['training_trace'];
  /** Worker-runner ordered progress-stream (passed through from DeckentConfig, ADR-G-025 §4). */
  live_trace?: DeckentConfig['live_trace'];
  /** External MCP client opt-in (passed through from DeckentConfig; 387-013 wired 2026-07-15). */
  mcp_client_enabled?: boolean;
  /** Fully-resolved RoutingEngineV3 config (Sprint 445 Slice-0). NOTE: type-only pass-through
   *  today — `loadConfig`/`mergeConfigs` (config.ts) do not yet assign this field in their
   *  resolved-object literal (same caveat as `computer_use`/`worker_output_contract` above; out of
   *  this task's write scope). Call `resolveRoutingV3Config()` (core/routing/config.ts) directly
   *  until that follow-up wiring task lands. @see RoutingV3Config */
  routing_v3?: RoutingV3Config;
  /** Doc-tracking options (passed through from DeckentConfig, ADR-090). */
  doc_tracking?: {
    /** Run a DB-only doc-tracking sync at sprint finalize (default: false). */
    sync_on_finalize?: boolean;
  };
  /** Mid-sprint cost guard configuration (passed through from DeckentConfig). Default-disabled. */
  cost_guard?: CostGuardConfig;
  /** Full-reducer SHADOW-only scheduler observation config (passed through from
   *  DeckentConfig, SCHED4). Default-disabled — execution-impact ZERO even when on. */
  scheduler?: SchedulerConfig;
  /** Sprint outcome gate configuration (passed through from DeckentConfig). Default-disabled. */
  gate?: GateConfig;
  /** Resolved final settlement truth checks (default: enabled). */
  evaluation: Required<EvaluationConfig>;
  /** Resolved approval config (Sprint 355 CFG-APR-WIRE). Unlike the other
   *  passed-through opt-in blocks above, `rules` here is ALWAYS populated —
   *  `loadConfig`/`mergeConfigs` resolve it via `resolveApprovalConfig`
   *  (config.ts), which validates+defaults through `loadApprovalRules`
   *  (approval-rules-load.ts) fail-soft. Never the raw/unvalidated JSON. */
  approval?: {
    rules: ApprovalPolicyRule[];
    gate_enabled: boolean;
    relay_enabled: boolean;
    question_bridge: boolean;
    lifecycle: ResolvedApprovalLifecycleConfig;
    authority?: ApprovalConfig['authority'];
  };
  /** Pinned API OIDC verifier input, passed through after config validation/interpolation. */
  api_oidc?: DeckentConfig['api_oidc'];
  /** Observability configuration (passed through from DeckentConfig) */
  observability?: DeckentConfig['observability'];
  /** Resolved runtime style — always 'sprint' or 'task' */
  deckent_style: 'sprint' | 'task' | 'process';
  /** Resolved embedded web terminal configuration. Mirrors the `model_strategy`
   * optional-on-both-sides pattern: optional on the type, runtime-populated by
   * `loadConfig`/`mergeConfigs` (DEFAULT_TERMINAL_CONFIG) so consumers can rely
   * on it being present without forcing every ResolvedConfig literal to spell
   * it out. Sprint 175. */
  terminal?: TerminalConfig;
  /** Plugin authenticity policy (passed through from DeckentConfig, born-612 405-002+CC). */
  plugins?: DeckentConfig['plugins'];
  /** Native-REPL progressive-disclosure meta-tools (passed through from DeckentConfig, 354-002). */
  tool_surface?: DeckentConfig['tool_surface'];
  /** Native-REPL mode-indicator + live-footer + approval-card surface (passed through from DeckentConfig, 354-001/355-011). */
  repl_surface?: DeckentConfig['repl_surface'];
  /** Task-based worker tool-surface reduction (passed through from DeckentConfig, born-674 / W674B 428-002). */
  tools?: DeckentConfig['tools'];
  /** Resolved worker prompt generation tuning (Sprint 182 PQ-5 / F7).
   *  Same optional-on-both-sides pattern as `terminal`; `loadConfig`/`mergeConfigs`
   *  always populate it with DEFAULT_PROMPT_CONFIG. Consumers may rely on it. */
  prompt?: PromptConfig;
  /** Plan phase behavior tuning (Sprint 276 PLAN-INT-1). Passed through from DeckentConfig. */
  plan?: PlanConfig;
}

// ─── Config Metadata ──────────────────────────────────────────────
export type ConfigCategory =
  | 'provider'
  | 'sprint'
  | 'memory'
  | 'auditor'
  | 'skill_routing'
  | 'search'
  | 'notifications'
  | 'telemetry'
  | 'environment'
  | 'output'
  | 'rollback'
  | 'auto_docs';

export interface ConfigFieldMeta {
  description: string;
  type: string;
  default: unknown;
  category: ConfigCategory;
  options?: readonly string[];
}

// ─── Auto Docs Config ─────────────────────────────────────────────
export interface AutoDocsConfig {
  tier1: boolean;  // CHANGELOG, SPRINT-LOG
  tier2: boolean;  // README counts, CONTRIBUTING, HEALTH-CHECK
  tier3: boolean;  // BLUEPRINT, ARCHITECTURE
}

// ─── CLI Types ──────────────────────────────────────────────────────
// autoApprove: passed to tmux as --dangerously-skip-permissions (CLI/spawn only)
// sandboxMode: Docker sandbox flag (not yet implemented)
// haikuAllowed (PlanModeConfig): model selection constraint only — never used for permissions
export interface StartOptions {
  autoApprove?: boolean;
  sandboxMode?: boolean;
}

export interface DoctorResult {
  ok: boolean;
  checks: {
    name: string;
    passed: boolean;
    message: string;
    required: boolean;
  }[];
}

// ─── Subscription ───────────────────────────────────────────────────
export type SubscriptionDetected = 'max' | 'pro' | 'unknown';
export type DetectionMethod = 'opus_probe' | 'cli_missing' | 'timeout' | 'error';

export interface SubscriptionProfile {
  detected: SubscriptionDetected;
  opusAvailable: boolean;
  testedAt: string;
  method: DetectionMethod;
}

// ─── Setup Recommendation ──────────────────────────────────────────
export interface SetupRecommendation {
  mode: PlanMode;
  maxWorkers: number;
  /** @deprecated Use brain_tier instead. Kept for backward compatibility. */
  brainModel: ModelType;
  /** @deprecated Use worker_tier instead. Kept for backward compatibility. */
  defaultModel: ModelType;
  /** Tier-based brain model selection (provider-agnostic). */
  brain_tier: ModelTier;
  /** Tier-based worker model selection (provider-agnostic). */
  worker_tier: ModelTier;
  planning: BrainPlanningMode;
  reasons: string[];
}

// ─── Project Analysis ──────────────────────────────────────────────
export type DetectedFramework = 'react' | 'next' | 'express' | 'nest' | 'vue' | 'angular' | 'svelte' | 'django' | 'flask' | 'fastapi' | 'spring' | 'unknown';
export type DetectedLanguage = 'typescript' | 'javascript' | 'python' | 'rust' | 'go' | 'java' | 'c' | 'cpp' | 'mixed' | 'unknown';
export type DetectedTestFramework = 'vitest' | 'jest' | 'mocha' | 'pytest' | 'unittest' | 'junit' | 'go_test' | 'cargo_test' | 'ctest' | 'unknown';
export type DetectedBuildTool = 'tsc' | 'vite' | 'webpack' | 'esbuild' | 'turbo' | 'cargo' | 'go' | 'maven' | 'gradle' | 'cmake' | 'make' | 'meson' | 'setuptools' | 'unknown';
export type DetectedCI = 'github-actions' | 'gitlab-ci' | 'circleci' | 'unknown';
export type ProjectSize = 'small' | 'medium' | 'large';
export type MethodologyRecommendation = 'micro-sprint' | 'sprint' | 'agile' | 'hybrid';

export interface AnalyzerSuggestion {
  field: string;
  value: string;
  reason: string;
}

export interface ProjectAnalysis {
  framework: DetectedFramework;
  language: DetectedLanguage;
  detectedLanguages: string[];
  testFramework: DetectedTestFramework;
  buildTool: DetectedBuildTool;
  ci: DetectedCI;
  fileCount: number;
  locCount: number;
  authorCount: number;
  size: ProjectSize;
  methodology: MethodologyRecommendation;
  subProjects: string[];
  configSuggestions: AnalyzerSuggestion[];
}

// ─── System Profile ─────────────────────────────────────────────────
export interface SystemProfile {
  cpuCores: number;
  totalMemMB: number;
  freeMemMB: number;
  recommendedMaxWorkers: number;
}
