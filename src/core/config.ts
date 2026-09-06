import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import {
  PROJECT_CONFIG_PATH,
  GLOBAL_CONFIG_PATH,
  DEFAULT_LANGUAGE,
  DEFAULT_MODE,
  DECKENT_VERSION,
  SUPPORTED_LANGUAGES,
} from './constants.js';
import { readJsonSafeAsync, debugLog } from './utils.js';
import { needsMigration, migrateConfig, removeDuplicateKeys } from './config-migration.js';
import { canonicalizeProviderConfigAliases } from './provider-config-canonicalizer.js';
import { canonicalizeModelConfigAliases } from './model-config-canonicalizer.js';
import { modelRegistry } from './model-registry.js';
import { validateXVerifyVerifierTierAuthority } from './xverify-verifier-tier-authority.js';
import {
  withConfigWriteLock,
  writeConfigJsonAtomic,
} from './config-write-authority.js';
// 593-002: the task-class profile defaults live in the work-model kind-SSOT, next
// to the other reverse helpers; config only RE-EXPORTS them as the resolved
// `prompt.task_profiles` default (import is type-erased-safe: work-model imports
// only types, so no runtime cycle).
import { DEFAULT_TASK_PROFILES } from './work-model.js';
import { loadApprovalRules } from './approval-rules-load.js';
import {
  ApprovalLifecyclePolicyError,
  resolveApprovalLifecyclePolicy,
} from './approval-lifecycle-policy.js';
// Import cycle note: routing3/config.ts imports deepMerge from THIS module. The
// cycle is init-safe — each side references the other's bindings only inside
// function bodies (routing3's top-level code builds zod schemas only), never at
// module-initialization time.
import { resolveRoutingV3Config } from './routing/config.js';
import { DEFAULT_MEMORY_READ_LIMITS, MEMORY_READ_CONSUMERS, resolveMemoryReadLimits, validateMemoryReadLimitsPatch } from './memory-read-contract.js';
import type { MemoryReadConsumerV1, MemoryReadLimitsV1 } from './memory-read-contract.js';
// T4a: the global-config PATH resolution moved down to global-scope-resolver.ts
// (a pure path module) so a caller that only needs the path — e.g. the API's
// sync tenant-flag reader — does not have to import this heavyweight, widely
// vi.mock'ed module. Re-exported here so every existing importer is unchanged.
export { resolveGlobalConfigPaths, resolveGlobalConfigReadPath } from './global-scope-resolver.js';
import { resolveGlobalConfigReadPath } from './global-scope-resolver.js';
import type {
  AutoDocsConfig,
  BrainPlanningMode,
  DeckentConfig,
  ModelType,
  PlanMode,
  PlanModeConfig,
  PromptConfig,
  ResolvedApprovalLifecycleConfig,
  ResolvedConfig,
  SystemProfile,
  TerminalConfig,
  TimeoutConfig,
  RuntimeArtifactFamilyRetentionConfig,
  RuntimeArtifactRetentionConfig,
} from './types.js';
import {
  ALL_PROVIDER_NAMES,
  DEFAULT_FIX_CIRCUIT_BREAKER_CONFIG,
  DEFAULT_LIFECYCLE_RECOVERY_CONFIG,
  getAllKnownModelIds,
  PROVIDER_MODEL_MAP,
} from './types.js';
import type { ProviderName } from './types.js';
// core/ → cli/helpers/messages.ts is an established i18n-catalog exception
// already used by cost-gate.ts, scope-gate.ts, directive-interrogator.ts —
// see ADR-D-004 C1 background note (warn-level signal only on the scanned
// core/→orchestra edge; this core/→cli edge is not yet mechanically gated).
import { getMessage } from '../cli/helpers/messages.js';
import { MODE_PRESETS } from './mode-presets.js';
import type { ModelStrategy } from './mode-presets.js';
import { metric } from './observability.js';
import { interpolateConfig } from './deck-interpolation.js';
import { assertExecutionBudgetPolicyConfig } from './execution-budget-policy.js';
import { NATIVE_PROVIDER_NAMES, isNativeProviderName } from './native-provider-names.js';
import {
  assertProviderLimitPolicyLayerPrecedence,
  assertProviderLimitsConfig,
  createProviderLimitPolicyAuthoritySnapshot,
} from './provider-limit-policy.js';

/**
 * Local intersection alias for `token_throttle_ms` — the pre-spawn quota gate
 * pacing knob added in Sprint 202 Task 202-004. Declared here so callers can
 * read `config.token_throttle_ms` without modifying config-types.ts (out of
 * this task's scope). Default 500 ms.
 *
 * (Sprint 428 SCHED-7 note: this WAS one of a small family of such local-cast
 * aliases alongside `DeckentConfigWithPipeline` for `dependency_pipeline_enabled`
 * — 428-011 promoted that FIFO/dependency-behavior field directly onto
 * `DeckentConfig` [config-types.ts] and removed its alias. `token_throttle_ms`
 * is a cost-pacing knob, not a FIFO/dependency switch, so it is intentionally
 * left as a local-cast idiom here.)
 */
type DeckentConfigWithThrottle = DeckentConfig & { token_throttle_ms?: number };

/**
 * ResolvedConfig augmented with `token_throttle_ms` so the field can flow
 * through `loadConfig`/`mergeConfigs` without modifying config-types.ts
 * (out of Sprint 202 Task 202-004 scope). Consumers should read the field
 * via {@link getTokenThrottleMs}.
 */
type ResolvedConfigWithThrottle = ResolvedConfig & { token_throttle_ms?: number };

/**
 * Sprint 220 Task 220-001 — `chat_provider` is the optional override for the
 * native REPL (`deckent` argümansız → `deckent chat --native`) provider. It
 * sits next to `brain_provider` so users can decouple the planner provider
 * (e.g. opus) from the REPL provider (e.g. ollama-local). Local intersection
 * aliases follow the existing `…WithPipeline`/`…WithThrottle` pattern so the
 * shared `config-types.ts` interface stays untouched.
 */
export type ChatProviderName = 'claude' | 'codex' | 'gemini' | 'ollama';
type DeckentConfigWithChatProvider = DeckentConfig & { chat_provider?: ChatProviderName };
type ResolvedConfigWithChatProvider = ResolvedConfig & { chat_provider?: ChatProviderName };

/**
 * Sprint 319 Task B-MAXWORKERS-WIRE — the **top-level** `max_workers` is a real
 * raw-config field (read by cli/resources.ts + cli/doctor.ts, written by
 * cli/init-steps.ts, preserved by config-migration `removeDuplicateKeys`
 * Decision 2) but was historically DEAD: never surfaced onto `ResolvedConfig`,
 * so {@link resolveEffectiveWorkers} ignored it and the active-mode preset always
 * won. These local intersection aliases follow the existing
 * `…WithThrottle`/`…WithChatProvider` pattern so the shared `config-types.ts`
 * interface stays untouched. The field is carried through `mergeConfigs`/
 * `loadConfig` and honored as an explicit override (numeric wins; 'auto' takes the
 * auto path; absent preserves the prior preset behavior).
 */
type DeckentConfigWithMaxWorkers = DeckentConfig & { max_workers?: number | 'auto' };
type ResolvedConfigWithMaxWorkers = ResolvedConfig & { max_workers?: number | 'auto' };

/**
 * Resolve the REPL chat provider via the documented fallback chain:
 *   1. config.chat_provider (explicit REPL override)
 *   2. config.brain_provider (project's primary provider)
 *   3. 'claude' (safe default — most users have `claude` installed)
 *
 * Returns 'claude' for any value outside the allowed set so a corrupt config
 * cannot crash the REPL boot path. Pure function; safe for sync callers.
 */
export function resolveChatProvider(
  config: Partial<ResolvedConfig> | Partial<DeckentConfig> | undefined | null,
): ChatProviderName {
  if (!config) return 'claude';
  const widened = config as Partial<ResolvedConfigWithChatProvider & DeckentConfigWithChatProvider>;
  const candidate = widened.chat_provider ?? widened.brain_provider ?? 'claude';
  return (candidate === 'claude' || candidate === 'codex' || candidate === 'gemini' || candidate === 'ollama')
    ? candidate
    : 'claude';
}

/** Typed error thrown by {@link assertChatProviderAvailable}. */
export class ChatProviderError extends Error {
  readonly code: 'PROVIDER_UNAVAILABLE';
  readonly provider: ChatProviderName;
  constructor(provider: ChatProviderName, detail?: string) {
    const msg = `[deckent] Chat provider '${provider}' is unavailable.${detail ? ' ' + detail : ''} Check your config or run \`deckent doctor\`.`;
    super(msg);
    this.name = 'ChatProviderError';
    this.code = 'PROVIDER_UNAVAILABLE';
    this.provider = provider;
  }
}

/**
 * Resolve the REPL chat provider with optional local-model fallback.
 *
 * Extended fallback chain:
 *   1. config.chat_provider (explicit REPL override)
 *   2. config.brain_provider (project's primary provider)
 *   3. config.chat?.local_fallback (e.g. 'ollama') when set
 *   4. 'claude' (safe default)
 *
 * @param isAvailable Optional sync probe — when provided, if the resolved provider
 *   returns false the function falls back to `chat.local_fallback` (if configured).
 *   Does NOT throw; throwing is left to {@link assertChatProviderAvailable}.
 */
export function resolveChatProviderWithFallback(
  config: Partial<ResolvedConfig> | Partial<DeckentConfig> | undefined | null,
  isAvailable?: (provider: ChatProviderName) => boolean,
): ChatProviderName {
  const primary = resolveChatProvider(config);
  if (!isAvailable || isAvailable(primary)) return primary;

  // Primary unavailable — check chat.local_fallback
  const chatBlock = (config as Record<string, unknown>)?.['chat'] as Record<string, unknown> | undefined;
  const localFallback = chatBlock?.['local_fallback'];
  if (localFallback === 'ollama') return 'ollama';
  return primary; // caller decides what to do; assertChatProviderAvailable can throw
}

/**
 * Assert that a resolved provider is available. Throws {@link ChatProviderError}
 * with a clear, actionable message (not a skeleton / silent failure).
 */
export function assertChatProviderAvailable(
  provider: ChatProviderName,
  available: boolean,
  detail?: string,
): void {
  if (!available) throw new ChatProviderError(provider, detail);
}

// ─── Default Timeout Config ─────────────────────────────────────────
// Sprint 192 (Task 192-011, W-INTEGRITY I-5): adaptive timeout knobs added
// without mutating `TimeoutConfig` in config-types.ts (out of this task's
// scope). The local intersection type carries the two new fields so the
// default object stays statically typed; consumers that read these through
// `ResolvedConfig.timeout` use the helpers in sprint-controller.ts which
// perform a runtime-safe lookup with the same defaults.
export type AdaptiveTimeoutFields = {
  /**
   * Multiplier applied on top of `brainEstimateTimeout` (effort × loc × scope
   * × history × backend) to enforce the user rule "zaman sınırlarını daha
   * geniş tutalım". 1.0 = no change; values < 1 are rejected by validation.
   */
  adaptive_multiplier: number;
  /**
   * Maximum heartbeat-aware runtime extensions granted per task (raised from
   * the legacy hard-coded `3` cap in sprint-phases.ts; the helper
   * `getRuntimeExtensionMax` in sprint-controller.ts is the wire-point).
   */
  runtime_extension_max: number;
};

export const DEFAULT_ADAPTIVE_MULTIPLIER = 1.5;
export const DEFAULT_RUNTIME_EXTENSION_MAX = 5;
/** Single source of truth for the number of FIX attempts allowed after an original attempt. */
export const DEFAULT_MAX_FIX_RETRIES = 2;

export const DEFAULT_TIMEOUT_CONFIG: TimeoutConfig & AdaptiveTimeoutFields = {
  docker_min_timeout: 1200,
  docker_max_timeout: 7200,
  tmux_min_timeout: 900,
  tmux_max_timeout: 5400,
  subprocess_min_timeout: 600,
  subprocess_max_timeout: 3600,
  effort_base: { low: 600, normal: 1200, high: 2400 },
  loc_scaling_enabled: true,
  history_scaling_enabled: true,
  // Sprint 191 (Task 191-002): default flipped false → true. With ADR-064
  // continuous-dispatch already landing high-effort opus tasks that legitimately
  // run past the structured timeout (Sprint 190 dogfood: 4 partial workers
  // confirmed via .hb freshness + non-empty git diff), the safer default is
  // to grant a bounded heartbeat-aware extension rather than declare a
  // synthetic NO_GO. Wire: evaluateRuntimeExtension in sprint-phases.ts.
  runtime_extension_enabled: true,
  adaptive_multiplier: DEFAULT_ADAPTIVE_MULTIPLIER,
  runtime_extension_max: DEFAULT_RUNTIME_EXTENSION_MAX,
};

// ─── Default Auto Docs Config ───────────────────────────────────────
export const DEFAULT_AUTO_DOCS: AutoDocsConfig = {
  tier1: true,
  tier2: false,
  tier3: false,
};

// ─── Default Terminal Config ────────────────────────────────────────
// Single source of truth for embedded web terminal defaults (Sprint 175).
// Mirrors the DEFAULT_TIMEOUT_CONFIG / DEFAULT_AUTO_DOCS pattern: one named
// const, structuredClone()'d at each use-site to keep instances independent.
// M5-NATIVE-FLIP (376-003): `native_agent` is intentionally NOT listed here —
// `TerminalConfig.native_agent` (config-types.ts) stays absent-by-default
// (undefined), and `isNativeAgentSelected` (src/cli/repl/run.tsx) treats
// "undefined" as the native-ON default, only `false` as the rollback signal.
// Baking `native_agent: true` into this const would change its key-shape,
// which tests/core/config-terminal.test.ts locks with an exact `toEqual`
// snapshot — the default lives in the call-site check instead. TERM-FLOW-
// UNIFY Sprint-1 (422-001) adds a second absent-by-default field for the
// same key-shape reason: `run_flow_v2` (default OFF, opposite direction
// from `native_agent`'s default-ON) has no reader yet this slice, so there
// is no call site to bake a default into at all — omission here already
// resolves it to `undefined` (falsy / off), which is exactly what the flag
// needs. Both
// loadConfig and mergeConfigs already deepMerge `config.terminal` over this
// const in one shared line each, so a project's
// `{ terminal: { native_agent: false } }` override still reaches both
// resolvers with zero further wiring (unlike the flat born-464 fields, which
// needed per-resolver pass-through because they weren't part of an existing
// deepMerge'd block).
export const DEFAULT_TERMINAL_CONFIG: TerminalConfig = {
  enabled: true,
  bind: '127.0.0.1',
  maxSessions: 10,
  idleTimeoutMs: 1_800_000,
  scrollbackBytes: 262_144,
  allowShellKind: true,
};

// ─── Default Prompt Config (Sprint 182 PQ-5 / F7) ───────────────────
// Lenient default threshold (0.3) keeps the ADR set roughly equivalent to
// pre-F7 behaviour while filtering out the long tail of low-relevance ADRs
// that previously inflated worker prompts.
export const DEFAULT_PROMPT_CONFIG: Required<PromptConfig> = {
  adr_min_relevance: 0.3,
  adr_render: 'full',
  // ADR-G-027 sanctioned condensed+pointer shape for persona content. Default
  // 'full' keeps worker prompts byte-identical to pre-U4 behavior.
  persona_render: 'full',
  // F3.1: stabilize the claude system-prompt prefix for cache reuse (git-status &
  // other per-machine sections move to the first user message). Verified via
  // real-binary smoke; opt-out with `false`.
  exclude_dynamic_system_prompt_sections: true,
  // 7094-F3→product default (owner 2026-08-20): three consecutive fully clean
  // measurement rounds (582/583/584) met the owner's bar — deckent-owned
  // worker composition is now the default for every claude docker worker.
  worker_core_system_prompt: true,
  // Owner decision 2026-08-25: default ON after the sealed-cohort A/B bar was
  // met (sprint-667 OFF vs sprint-668 ON: −41.2% total tokens, full quality
  // parity, worker prompt 36.8KB→32.2KB). `false` restores the stock path.
  codex_core_channel: true,
  codex_suppress_project_doc: true,
  // 593-001 F2c: catalog mount mask OFF by default — flag-gated, so worker
  // `docker run` argv stays byte-identical until it is explicitly enabled.
  catalog_mount_mask: false,
  // Usage prompt-cost canary PROMOTE/REJECT policy (KANUN 10: flow values live
  // in config, not in the CLI caller). The defaults are the strictest bar:
  // full quality parity, zero cost/cache regression tolerated.
  canary_thresholds: {
    minimumQualityPassRate: 1,
    maximumQualityPassRateRegression: 0,
    maximumCostPerLineageIncreaseRatio: 0,
    minimumCacheHitRatio: 0,
    maximumCacheHitRatioRegression: 0,
  },
  // Owner decision 2026-08-25: subscription arms (no provider USD) settle the
  // cost threshold on the token-total measurement; mixed pricing still HOLDs.
  canary_cost_authority: 'auto',
  // 593-002: task-class profile SSOT (`resolveTaskPromptProfile`). The default IS
  // the set of literals the three former inline predicates carried, so resolving
  // through config changes NO classification — only where the values live.
  task_profiles: DEFAULT_TASK_PROFILES,
};

/**
 * Default per-tenant outbound byte quota over a 24h window (W4-10, invariant I5).
 * Exposed as a separate const so `DEFAULT_TERMINAL_CONFIG` stays the locked
 * Sprint 175 secure-default snapshot; callers wire this into `OutboundLimiter`
 * via `config.terminal.outboundDailyQuotaBytes ?? DEFAULT_OUTBOUND_DAILY_QUOTA_BYTES`.
 */
export const DEFAULT_OUTBOUND_DAILY_QUOTA_BYTES = 1_073_741_824; // 1 GiB

// ─── Heartbeat & Approval Window SSOT Constants ──────────────────────────────
/** ms equivalent of config.heartbeat_timeout default (120s × 1000).
 *  Single SSOT: auditor.scanHeartbeats and StaleWorkerDetector both default to this. */
export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 120_000;

/**
 * Persona integrity floor default (owner D-G(a)): a resolved persona smaller
 * than this many bytes is machine-classified `undersized`. Config-resolved via
 * `persona_integrity.min_bytes`; this constant is the single default source.
 */
export const DEFAULT_PERSONA_INTEGRITY_MIN_BYTES = 40;
/** Default for config key nervous_system.approve_timeout_attended_ms (30s, interactive sessions). */
export const DEFAULT_APPROVE_TIMEOUT_ATTENDED_MS = 30_000;
/** Default for config key nervous_system.approve_timeout_unattended_ms (5s, CI/background). */
export const DEFAULT_APPROVE_TIMEOUT_UNATTENDED_MS = 5_000;

// ─── Nervous System Zod Schemas (Sprint 180 W0 — Step F) ─────────────
// Runtime validation that mirrors the NervousSystemConfig TypeScript
// interface from config-types.ts. Used by tests and integration
// boundaries to enforce shape + value invariants on incoming config.

/** Per-detector configuration schema (mirrors NervousDetectorConfig). */
export const NERVOUS_DETECTOR_SCHEMA = z
  .object({
    enabled: z.boolean(),
    threshold_ms: z.number().nonnegative().optional(),
    threshold_rate: z.number().min(0).max(1).optional(),
    anomaly_threshold: z.number().min(0).max(1).optional(),
    auto_restore: z.boolean().optional(),
    reserve_for: z.string().optional(),
    pending_age_threshold_ms: z.number().nonnegative().optional(),
  })
  .strict();

const NERVOUS_AUTHORITY_MODE_SCHEMA = z.enum(['strict', 'balanced', 'autopilot', 'full-auto']);
const NERVOUS_SEVERITY_MIN_SCHEMA = z.enum(['info', 'warning', 'critical', 'emergency']);
const NERVOUS_APPROVAL_POLICY_SCHEMA = z.enum(['autonomous', 'suggest-30m', 'suggest-5m', 'approve']);
const NERVOUS_SAFETY_FLOOR_ACTION_SCHEMA = z.enum([
  'KILL_LIVE_SPRINT',
  'MANUAL_FILE_DELETE',
  'COST_OVER_THRESHOLD',
  'DESTRUCTIVE_GIT',
  'ADR_DEPRECATE_ACCEPTED',
]);

/** Full Nervous System configuration schema (mirrors NervousSystemConfig). */
export const NERVOUS_SYSTEM_SCHEMA = z
  .object({
    enabled: z.boolean(),
    mode: NERVOUS_AUTHORITY_MODE_SCHEMA,
    actionOverrides: z.record(z.string(), NERVOUS_APPROVAL_POLICY_SCHEMA),
    safety_floor: z.object({
      locked_actions: z.array(NERVOUS_SAFETY_FLOOR_ACTION_SCHEMA),
      cost_threshold_usd: z.number().nonnegative(),
      bypass_allowed: z.boolean(),
    }),
    notifications: z.object({
      channels: z.object({
        mcp: z.boolean(),
        cli: z.boolean(),
        file: z.boolean(),
        desktop: z.boolean(),
      }),
      throttle_ms: z.number().nonnegative(),
      group_info_window_ms: z.number().nonnegative(),
      severity_min: NERVOUS_SEVERITY_MIN_SCHEMA,
      quiet_hours: z.object({
        start: z.string(),
        end: z.string(),
        timezone: z.string(),
      }),
      cross_channel_dedup: z.boolean(),
    }),
    detectors: z.object({
      stale_worker: NERVOUS_DETECTOR_SCHEMA,
      scope_collision: NERVOUS_DETECTOR_SCHEMA,
      debt_trend: NERVOUS_DETECTOR_SCHEMA,
      agent_routing: NERVOUS_DETECTOR_SCHEMA,
      directives_protection: NERVOUS_DETECTOR_SCHEMA,
      dead_event_stream: NERVOUS_DETECTOR_SCHEMA,
      cost_threshold: NERVOUS_DETECTOR_SCHEMA,
      prompt_quality: NERVOUS_DETECTOR_SCHEMA,
      worker_output_variance: NERVOUS_DETECTOR_SCHEMA,
      self_modifying_warner: NERVOUS_DETECTOR_SCHEMA,
      // Sprint 180 W0 — NERVOUS-TODO §11.2 Step F: 6 new detectors.
      task_mode_idle: NERVOUS_DETECTOR_SCHEMA,
      build_failure_recurrence: NERVOUS_DETECTOR_SCHEMA,
      token_spike: NERVOUS_DETECTOR_SCHEMA,
      agent_routing_anomaly: NERVOUS_DETECTOR_SCHEMA,
      scope_collision_rate: NERVOUS_DETECTOR_SCHEMA,
      notification_delivery_health: NERVOUS_DETECTOR_SCHEMA,
    }),
    history_retention_days: z.number().int().min(1),
  })
  .strict();

// ─── Chat Config Schema (Sprint 221 Task 221-010) ────────────────────
// Single source of truth for the `chat` config block. All fields are
// optional — absence produces sade/default behaviour. Tasks 221-004,
// 221-007, and 221-009 consume this schema.

/** Zod schema for the optional `chat` block in .deckent/config.json. */
export const CHAT_CONFIG_SCHEMA = z
  .object({
    provider: z.enum(['claude', 'codex', 'gemini', 'ollama']).optional(),
    mode: z.enum(['user', 'enterprise']).optional(),
    status_line: z.union([z.boolean(), z.array(z.string())]).optional(),
    local_fallback: z.literal('ollama').optional(),
    slash_extra: z.array(z.string()).optional(),
  })
  .strict();

/** TypeScript type derived from {@link CHAT_CONFIG_SCHEMA}. */
export type ChatConfig = z.infer<typeof CHAT_CONFIG_SCHEMA>;

/**
 * Extract and Zod-validate the `chat` block from any config shape.
 * Returns an empty ChatConfig (sade defaults) when the block is absent,
 * non-object, or fails validation.
 */
export function resolveChatConfig(
  config: Partial<ResolvedConfig> | Partial<DeckentConfig> | undefined | null,
): ChatConfig {
  if (!config) return {};
  const raw = (config as Record<string, unknown>)['chat'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result = CHAT_CONFIG_SCHEMA.safeParse(raw);
  return result.success ? result.data : {};
}

// ─── Mode Aliases ────────────────────────────────────────────────────

/**
 * User-friendly aliases for canonical plan mode names.
 * Accepted in config.mode and --mode CLI flag.
 */
export const MODE_ALIASES: Readonly<Record<string, PlanMode>> = {
  // Legacy aliases → new canonical names
  max_plan: 'performance',
  max5x_plan: 'balanced',
  pro_plan: 'economic',
  unlimited: 'api',
} as const;

/**
 * Resolve a mode string (alias or canonical) to a canonical PlanMode name.
 * Returns the input as-is when it is already canonical or unknown.
 */
export function resolveMode(mode: string): string {
  return MODE_ALIASES[mode] ?? mode;
}

// ─── Default Mode Definitions (Blueprint 13) ────────────────────────

const VALID_MODES: readonly PlanMode[] = ['performance', 'balanced', 'economic', 'api'] as const;
const VALID_BRAIN_PLANNING = ['ai', 'structured', 'auto'] as const;

/** All valid provider names, derived from the canonical provider/model map. */
export const VALID_PROVIDERS: readonly ProviderName[] = Object.keys(PROVIDER_MODEL_MAP) as ProviderName[];

/**
 * VALID_PROVIDERS_ALL — compatibility projection of the canonical provider set.
 *
 * Used by validateConfig() below; all local and remote providers now enter via
 * PROVIDER_MODEL_MAP, so the string projection cannot drift from ProviderName.
 * This constant also gates DIRECTIVES parsing — `task-builder.ts:1138-1148` checks
 * membership and SILENTLY drops an unknown `- Provider:` value, after which a
 * provider-less `resolveCanonicalModelIdentity` throws
 * `E_MODEL_PROVIDER_UNVERIFIED`. So a missing entry here does not merely fail
 * validation, it makes the provider unaddressable from a directive.
 */
export const VALID_PROVIDERS_ALL: readonly string[] = VALID_PROVIDERS;

function requireDefaultModel(provider: ProviderName, tier: ModelStrategy['brain_tier']): ModelType {
  const model = modelRegistry.getByProviderAndTier(provider, tier);
  if (!model) {
    throw new Error(`No canonical default model for provider=${provider}, tier=${tier}`);
  }
  return model.id;
}

/**
 * Default mode definitions derived from MODE_PRESETS (single source of truth).
 * max_workers comes from MODE_PRESETS; model names are v1 backward-compat layer.
 *
 * Sprint 150: Consolidated — mode-presets.ts is the canonical source for max_workers.
 * Brain/default model names kept for PlanModeConfig backward compat.
 */
export const DEFAULT_MODES: Record<string, PlanModeConfig> = {
  performance: {
    max_workers: MODE_PRESETS['performance']!.max_workers,
    brain_model: requireDefaultModel('claude', 'premium'),
    default_model: requireDefaultModel('claude', 'premium'),
    haiku_allowed: true,
    brain_planning: 'auto',
  },
  balanced: {
    max_workers: MODE_PRESETS['balanced']!.max_workers,
    brain_model: requireDefaultModel('claude', 'standard'),
    default_model: requireDefaultModel('claude', 'premium'),
    haiku_allowed: true,
    brain_planning: 'auto',
  },
  economic: {
    max_workers: MODE_PRESETS['economic']!.max_workers,
    brain_model: requireDefaultModel('claude', 'standard'),
    default_model: requireDefaultModel('claude', 'standard'),
    haiku_allowed: false,
    brain_planning: 'auto',
  },
  api: {
    max_workers: MODE_PRESETS['api']!.max_workers,
    brain_model: requireDefaultModel('claude', 'premium'),
    default_model: requireDefaultModel('claude', 'standard'),
    haiku_allowed: true,
    budget_per_sprint: 5.0,
    requires: 'ANTHROPIC_API_KEY',
    brain_planning: 'auto',
  },
};

/**
 * Resolve the effective Brain model for a config — single-source reader for
 * `config.modes[mode].brain_model` (Task 431-002, born-683 drift fix: this lookup
 * was previously re-implemented ad-hoc at every call site).
 *
 * Lookup chain:
 *   1. `mode = config?.mode ?? 'balanced'`
 *   2. `modes = config?.modes ?? DEFAULT_MODES`
 *   3. `modes[mode]?.brain_model`
 *   4. Unknown mode / missing modes → `DEFAULT_MODES['balanced']` fallback
 *
 * Defensive: undefined/null/malformed config never throws — always resolves to a
 * valid ModelType. Mirrors {@link resolveChatProvider}'s null-safe pattern.
 */
export function resolveBrainModel(
  config: Partial<ResolvedConfig> | Partial<DeckentConfig> | undefined | null,
): ModelType {
  const mode = config?.mode ?? 'balanced';
  const modes = config?.modes ?? DEFAULT_MODES;
  return modes[mode]?.brain_model ?? DEFAULT_MODES['balanced']!.brain_model;
}

/**
 * Resolve the effective default (worker) model for a config — single-source reader
 * for `config.modes[mode].default_model`. See {@link resolveBrainModel} for the
 * shared lookup chain and rationale.
 */
export function resolveDefaultModel(
  config: Partial<ResolvedConfig> | Partial<DeckentConfig> | undefined | null,
): ModelType {
  const mode = config?.mode ?? 'balanced';
  const modes = config?.modes ?? DEFAULT_MODES;
  return modes[mode]?.default_model ?? DEFAULT_MODES['balanced']!.default_model;
}

// ─── Config Validation Error ─────────────────────────────────────────

export class ConfigValidationError extends Error {
  public readonly errors: string[];

  constructor(errors: string[]) {
    super(`Config validation failed:\n  - ${errors.join('\n  - ')}`);
    this.name = 'ConfigValidationError';
    this.errors = errors;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveApprovalLifecycleLayer(
  config: Partial<DeckentConfig> | null,
  parent?: ResolvedApprovalLifecycleConfig,
): ResolvedApprovalLifecycleConfig {
  try {
    return resolveApprovalLifecyclePolicy(config?.approval?.lifecycle, parent);
  } catch (error) {
    if (error instanceof ApprovalLifecyclePolicyError) {
      throw new ConfigValidationError([error.message]);
    }
    throw error;
  }
}

/** Project the canonical grouped provider block onto legacy runtime readers. */
function projectCanonicalProviderFields(config: DeckentConfig): void {
  if (!config.providers) return;
  if (config.providers.brain) config.brain_provider = config.providers.brain;
  if (config.providers.worker) config.worker_provider = config.providers.worker;
  if (config.providers.fallback) config.fallback_provider = config.providers.fallback;
  if (config.providers.overrides) config.provider_overrides = config.providers.overrides;
}

/**
 * Deep-merge two plain objects, returning a new object with all keys from base
 * overridden by non-undefined keys from override. Nested objects are merged recursively.
 * @param base - The base object to start from
 * @param override - Partial override whose values take precedence
 * @returns A new deep-cloned object with merged values
 */
export function deepMerge<T>(base: T, override: Partial<T>): T {
  const result = structuredClone(base);
  // safe: generic T is always a plain object type; Record view needed for dynamic key iteration
  const resultObj = result as Record<string, unknown>;
  const overrideObj = override as Record<string, unknown>;

  for (const key of Object.keys(overrideObj)) {
    const overrideVal = overrideObj[key];
    if (overrideVal === undefined) continue;

    const baseVal = resultObj[key];
    if (isPlainObject(baseVal) && isPlainObject(overrideVal)) {
      resultObj[key] = deepMerge(baseVal, overrideVal);
    } else {
      resultObj[key] = structuredClone(overrideVal);
    }
  }

  return result;
}

/** Safe, explicit runtime-artifact retention defaults; no cleanup runs by default. */
export const DEFAULT_RUNTIME_ARTIFACT_RETENTION_CONFIG: Readonly<RuntimeArtifactRetentionConfig> = Object.freeze({
  enabled: false,
  apply_on_finalize: false,
  archive_path: '.deckent/archive/runtime-artifacts/',
  families: Object.freeze({
    runtime: Object.freeze({ max_age_days: 30, max_count: 1_000, max_size_mb: 1_024 }),
    recent: Object.freeze({ max_age_days: 14, max_count: 500, max_size_mb: 512 }),
  }),
});

function resolveRuntimeArtifactRetention(config: DeckentConfig): RuntimeArtifactRetentionConfig {
  const defaults = structuredClone(DEFAULT_RUNTIME_ARTIFACT_RETENTION_CONFIG);
  const authored = config.runtime_artifact_retention;
  const families: Record<string, RuntimeArtifactFamilyRetentionConfig> = { ...defaults.families };
  for (const [familyName, override] of Object.entries(authored?.families ?? {})) {
    const fallback = defaults.families[familyName];
    const maxAgeDays = override.max_age_days ?? fallback?.max_age_days;
    const maxCount = override.max_count ?? fallback?.max_count;
    const maxSizeMb = override.max_size_mb ?? fallback?.max_size_mb;
    if (maxAgeDays === undefined || maxCount === undefined || maxSizeMb === undefined) {
      throw new ConfigValidationError([
        `runtime_artifact_retention.families.${familyName} must define all bounds`,
      ]);
    }
    families[familyName] = {
      max_age_days: maxAgeDays,
      max_count: maxCount,
      max_size_mb: maxSizeMb,
    };
  }
  return {
    enabled: authored?.enabled ?? defaults.enabled,
    apply_on_finalize: authored?.apply_on_finalize ?? defaults.apply_on_finalize,
    archive_path: authored?.archive_path ?? defaults.archive_path,
    families,
  };
}

/**
 * Public validation ceilings for runtime-artifact retention authoring.
 * Keeping these next to the defaults makes every accepted bound inspectable.
 */
export const RUNTIME_ARTIFACT_RETENTION_LIMITS = Object.freeze({
  max_age_days: 3_650,
  max_count: 1_000_000,
  max_size_mb: 1_048_576,
});

/**
 * Validate a complete DeckentConfig object against all known rules.
 * Checks mode validity, language support, worker counts, model names,
 * brain planning mode, and skills config.
 * @param config - The full configuration object to validate
 * @returns Array of warning strings (non-fatal); empty if no warnings
 * @throws {ConfigValidationError} When validation errors are found
 */
export function validateConfig(config: DeckentConfig): string[] {
  const errors: string[] = [];
  const maxWorkersWarnings: string[] = [];

  if (!VALID_MODES.includes(config.mode)) {
    errors.push(`Invalid value '${config.mode}' for field 'mode'. Valid options: performance, balanced, economic, api (legacy: max_plan, max5x_plan, pro_plan)`);
  }

  if (config.language !== undefined && !(SUPPORTED_LANGUAGES as readonly string[]).includes(config.language)) {
    errors.push(`Invalid value '${config.language}' for field 'language'. Valid options: ${SUPPORTED_LANGUAGES.join(', ')}`);
  }

  for (const modeName of VALID_MODES) {
    const mc = config.modes[modeName];
    if (!mc) {
      errors.push(`Missing mode config for "${modeName}"`);
      continue;
    }

    const prefix = `modes.${modeName}`;

    if (mc.max_workers === 'auto') {
      // 'auto' is valid — resolved at runtime
    } else if (typeof mc.max_workers !== 'number' || mc.max_workers < 1 || mc.max_workers > 100) {
      errors.push(`${prefix}.max_workers must be a number between 1 and 100, or 'auto'`);
    } else if (mc.max_workers >= 20) {
      // Warning only — collected separately, not as error
      maxWorkersWarnings.push(`${prefix}.max_workers is ${mc.max_workers} (>=20) — high worker count may cause resource contention`);
    }

    // born-683 (zero-hardcode): validasyon LIVE registry-listesiyle — donmuş
    // ALL_MODELS snapshot'ı opt-in aileleri (gpt-5.6-sol vb.) tanımıyordu ve
    // meşru brain-devrini düşürüyordu (2026-07-12 canlı-vakası).
    const knownModels = getAllKnownModelIds();
    if (!knownModels.includes(mc.brain_model)) {
      errors.push(`Invalid value '${mc.brain_model}' for field '${prefix}.brain_model'. Valid: ${knownModels.join(', ')}`);
    }

    if (!knownModels.includes(mc.default_model)) {
      errors.push(`Invalid value '${mc.default_model}' for field '${prefix}.default_model'. Valid: ${knownModels.join(', ')}`);
    }

    if (typeof mc.haiku_allowed !== 'boolean') {
      errors.push(`${prefix}.haiku_allowed must be a boolean`);
    }

    if (mc.brain_planning !== undefined &&
        !(VALID_BRAIN_PLANNING as readonly string[]).includes(mc.brain_planning)) {
      errors.push(`Invalid value '${mc.brain_planning}' for field '${prefix}.brain_planning'. Valid: ${VALID_BRAIN_PLANNING.join(', ')}`);
    }

    if (modeName === 'api' && mc.budget_per_sprint !== undefined) {
      if (typeof mc.budget_per_sprint !== 'number' || mc.budget_per_sprint <= 0) {
        errors.push(`${prefix}.budget_per_sprint must be a positive number`);
      }
    }
  }

  // ─── Top-level brain_planning validation (Task 429-006 PLNR1) ───────
  // Mirrors the per-mode check above — the top-level override must be one of
  // the same valid values, since it takes precedence over the preset's own.
  if (config.brain_planning !== undefined &&
      !(VALID_BRAIN_PLANNING as readonly string[]).includes(config.brain_planning)) {
    errors.push(`Invalid value '${config.brain_planning}' for field 'brain_planning'. Valid: ${VALID_BRAIN_PLANNING.join(', ')}`);
  }

  // ─── Approval channel config validation ────────────────────────────
  if (config.approval_channels !== undefined) {
    const channels: unknown = config.approval_channels;
    if (!isPlainObject(channels)) {
      errors.push('approval_channels must be an object');
    } else {
      for (const name of ['slack', 'teams', 'telegram'] as const) {
        const entry = channels[name];
        if (entry === undefined) continue;
        if (!isPlainObject(entry)) {
          errors.push(`approval_channels.${name} must be an object`);
          continue;
        }
        if (entry['enabled'] !== undefined && typeof entry['enabled'] !== 'boolean') {
          errors.push(`approval_channels.${name}.enabled must be a boolean`);
        }
        const idField = name === 'telegram' ? 'chat_id' : 'channel_id';
        if (entry[idField] !== undefined && typeof entry[idField] !== 'string') {
          errors.push(`approval_channels.${name}.${idField} must be a string`);
        }
        if (name !== 'telegram') {
          if (entry['token'] !== undefined && typeof entry['token'] !== 'string') {
            errors.push(`approval_channels.${name}.token must be a string`);
          }
          if (entry['lang'] !== undefined && typeof entry['lang'] !== 'string') {
            errors.push(`approval_channels.${name}.lang must be a string`);
          }
        }
      }
    }
  }

  // ─── Skills config validation ───────────────────────────────────────
  if (config.skills !== undefined) {
    const skills = config.skills;
    if (typeof skills !== 'object' || skills === null || Array.isArray(skills)) {
      errors.push('skills must be an object');
    } else {
      if (skills.enabled !== undefined && typeof skills.enabled !== 'boolean') {
        errors.push('skills.enabled must be a boolean');
      }
      if (skills.maxPerTask !== undefined) {
        if (typeof skills.maxPerTask !== 'number' || skills.maxPerTask < 1 || skills.maxPerTask > 10) {
          errors.push('skills.maxPerTask must be a number between 1 and 10');
        }
      }
      if (skills.autoDetectStack !== undefined && typeof skills.autoDetectStack !== 'boolean') {
        errors.push('skills.autoDetectStack must be a boolean');
      }
      if (skills.preferredSkills !== undefined) {
        if (!Array.isArray(skills.preferredSkills)) {
          errors.push('skills.preferredSkills must be an array of strings');
        } else {
          for (const item of skills.preferredSkills) {
            if (typeof item !== 'string') {
              errors.push('skills.preferredSkills must be an array of strings');
              break;
            }
          }
        }
      }
    }
  }

  // ─── Provider config validation ─────────────────────────────────────
  // VALID_PROVIDERS_ALL includes 'ollama' (local LLM) on top of the typed
  // VALID_PROVIDERS list — see Sprint 190 W-F F-11.
  if (config.brain_provider !== undefined &&
      !VALID_PROVIDERS_ALL.includes(config.brain_provider)) {
    errors.push(`Invalid value '${config.brain_provider}' for field 'brain_provider'. Valid: ${VALID_PROVIDERS_ALL.join(', ')}`);
  }

  // TERMINAL-PROVIDER-VOCAB-001 — native_provider (the native transport pin
  // the Terminal picker's "save as default" writes) accepts exactly the native
  // transport names; a typo is refused, never silently resolved.
  if (config.native_provider !== undefined && !isNativeProviderName(config.native_provider)) {
    errors.push(`Invalid value '${String(config.native_provider)}' for field 'native_provider'. Valid: ${NATIVE_PROVIDER_NAMES.join(', ')}`);
  }

  // Sprint 220 Task 220-001 — chat_provider validation (optional REPL override).
  const cfgWithChat = config as DeckentConfigWithChatProvider;
  if (cfgWithChat.chat_provider !== undefined &&
      !VALID_PROVIDERS_ALL.includes(cfgWithChat.chat_provider)) {
    errors.push(`Invalid value '${cfgWithChat.chat_provider}' for field 'chat_provider'. Valid: ${VALID_PROVIDERS_ALL.join(', ')}`);
  }

  if (config.worker_provider !== undefined &&
      !VALID_PROVIDERS_ALL.includes(config.worker_provider)) {
    errors.push(`Invalid value '${config.worker_provider}' for field 'worker_provider'. Valid: ${VALID_PROVIDERS_ALL.join(', ')}`);
  }

  if (config.fallback_provider !== undefined &&
      !VALID_PROVIDERS_ALL.includes(config.fallback_provider)) {
    errors.push(`Invalid value '${config.fallback_provider}' for field 'fallback_provider'. Valid: ${VALID_PROVIDERS_ALL.join(', ')}`);
  }

  // Role-aware fallback is a dispatch-safety policy, so malformed shapes and
  // misspelled keys must fail at the config boundary. In particular, accepting
  // a string here would let a downstream `for ... of` iterate provider-name
  // characters as individual fallback candidates.
  if (config.provider_fallback !== undefined) {
    const providerFallback: unknown = config.provider_fallback;
    if (!isPlainObject(providerFallback)) {
      errors.push('provider_fallback must be an object');
    } else {
      const allowedKeys = new Set([
        'global',
        'brain',
        'worker',
        'auditor',
        'auditor_provider',
        'unattended',
      ]);
      for (const key of Object.keys(providerFallback)) {
        if (!allowedKeys.has(key)) {
          errors.push(`Unknown field 'provider_fallback.${key}'`);
        }
      }

      for (const role of ['global', 'brain', 'worker', 'auditor'] as const) {
        const chain = providerFallback[role];
        if (chain === undefined) continue;
        if (!Array.isArray(chain)) {
          errors.push(`provider_fallback.${role} must be an array of providers`);
          continue;
        }
        for (const candidate of chain) {
          if (typeof candidate !== 'string' || !VALID_PROVIDERS_ALL.includes(candidate)) {
            errors.push(`Invalid provider '${String(candidate)}' in provider_fallback.${role}. Valid: ${VALID_PROVIDERS_ALL.join(', ')}`);
          }
        }
      }

      const auditorProvider = providerFallback['auditor_provider'];
      if (auditorProvider !== undefined &&
          (typeof auditorProvider !== 'string' || !VALID_PROVIDERS_ALL.includes(auditorProvider))) {
        errors.push(`Invalid value '${String(auditorProvider)}' for field 'provider_fallback.auditor_provider'. Valid: ${VALID_PROVIDERS_ALL.join(', ')}`);
      }
      if (providerFallback['unattended'] !== undefined &&
          typeof providerFallback['unattended'] !== 'boolean') {
        errors.push('provider_fallback.unattended must be a boolean');
      }
    }
  }

  if (config.execution_budget !== undefined) {
    try {
      assertExecutionBudgetPolicyConfig(config.execution_budget);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (config.provider_limits !== undefined) {
    try {
      assertProviderLimitsConfig(config.provider_limits);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (config.provider_overrides !== undefined) {
    if (typeof config.provider_overrides !== 'object' || config.provider_overrides === null || Array.isArray(config.provider_overrides)) {
      errors.push('provider_overrides must be an object');
    } else {
      for (const [key, value] of Object.entries(config.provider_overrides)) {
        if (!VALID_PROVIDERS_ALL.includes(value)) {
          errors.push(`Invalid provider "${value}" in provider_overrides["${key}"]. Must be one of: ${VALID_PROVIDERS_ALL.join(', ')}`);
        }
      }
    }
  }

  if (config.cost_optimization !== undefined && typeof config.cost_optimization !== 'boolean') {
    errors.push('cost_optimization must be a boolean');
  }

  if (config.api_keys !== undefined) {
    if (typeof config.api_keys !== 'object' || config.api_keys === null || Array.isArray(config.api_keys)) {
      errors.push('api_keys must be an object');
    }
  }

  // ─── Memory config validation ──────────────────────────────────────
  if (config.memory_budget !== undefined) {
    if (typeof config.memory_budget !== 'number' || config.memory_budget < 100 || config.memory_budget > 10000) {
      errors.push('memory_budget must be a number between 100 and 10000');
    }
  }

  if (config.decay_after_sprints !== undefined) {
    if (typeof config.decay_after_sprints !== 'number' || config.decay_after_sprints < 1 || config.decay_after_sprints > 100) {
      errors.push('decay_after_sprints must be a number between 1 and 100');
    }
  }

  if (config.patterns_enabled !== undefined && typeof config.patterns_enabled !== 'boolean') {
    errors.push('patterns_enabled must be a boolean');
  }

  if (config.project_identity_enabled !== undefined && typeof config.project_identity_enabled !== 'boolean') {
    errors.push('project_identity_enabled must be a boolean');
  }

  if (config.memory_export !== undefined) {
    const memoryExport = config.memory_export;
    if (!memoryExport || typeof memoryExport !== 'object' || Array.isArray(memoryExport)) {
      errors.push('memory_export must be an object');
    } else {
      const allowed = new Set([
        'max_inline_lines', 'max_inline_bytes', 'summary_inline_lines', 'summary_inline_bytes',
      ]);
      for (const key of Object.keys(memoryExport)) {
        if (!allowed.has(key)) errors.push(`memory_export.${key} is not supported`);
      }
      for (const key of ['max_inline_lines', 'max_inline_bytes'] as const) {
        const value = memoryExport[key];
        if (value !== undefined
            && (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)) {
          errors.push(`memory_export.${key} must be a positive integer`);
        }
      }
      for (const key of ['summary_inline_lines', 'summary_inline_bytes'] as const) {
        const value = memoryExport[key];
        if (value !== undefined
            && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)) {
          errors.push(`memory_export.${key} must be a non-negative integer`);
        }
      }
    }
  }

  if (config.memory_read !== undefined) {
    try {
      resolveMemoryReadLimits(config.memory_read);
    } catch {
      errors.push(getMessage('memory_read.invalid_limits', config.language ?? DEFAULT_LANGUAGE));
    }
  }

  try {
    resolveMemoryReadProfiles(config);
  } catch {
    errors.push(getMessage('memory_read.invalid_profiles', config.language ?? DEFAULT_LANGUAGE));
  }

  // ─── Auditor config validation ─────────────────────────────────────
  if (config.scan_interval !== undefined) {
    if (typeof config.scan_interval !== 'number' || config.scan_interval < 5 || config.scan_interval > 600) {
      errors.push('scan_interval must be a number between 5 and 600');
    }
  }

  if (config.heartbeat_timeout !== undefined) {
    if (typeof config.heartbeat_timeout !== 'number' || config.heartbeat_timeout < 30 || config.heartbeat_timeout > 600) {
      errors.push('heartbeat_timeout must be a number between 30 and 600');
    }
  }

  if (config.lock_stale_threshold !== undefined) {
    if (typeof config.lock_stale_threshold !== 'number' || config.lock_stale_threshold < 30 || config.lock_stale_threshold > 3600) {
      errors.push('lock_stale_threshold must be a number between 30 and 3600');
    }
  }

  if (config.boundary_enforcement !== undefined && typeof config.boundary_enforcement !== 'boolean') {
    errors.push('boundary_enforcement must be a boolean');
  }

  // ─── Sprint config validation ──────────────────────────────────────
  if (config.retry_transient_failures !== undefined && typeof config.retry_transient_failures !== 'boolean') {
    errors.push('retry_transient_failures must be a boolean');
  }

  if (config.fix_phase_enabled !== undefined && typeof config.fix_phase_enabled !== 'boolean') {
    errors.push('fix_phase_enabled must be a boolean');
  }

  if (config.max_fix_retries !== undefined) {
    if (typeof config.max_fix_retries !== 'number' || config.max_fix_retries < 0 || config.max_fix_retries > 10) {
      errors.push('max_fix_retries must be a number between 0 and 10');
    }
  }

  if (config.fix_circuit_breaker !== undefined) {
    const policy = config.fix_circuit_breaker;
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
      errors.push('fix_circuit_breaker must be an object');
    } else {
      if (typeof policy.enabled !== 'boolean') {
        errors.push('fix_circuit_breaker.enabled must be a boolean');
      }
      if (
        typeof policy.max_unresolved_tasks !== 'number'
        || !Number.isInteger(policy.max_unresolved_tasks)
        || policy.max_unresolved_tasks < 1
        || policy.max_unresolved_tasks > 10_000
      ) {
        errors.push('fix_circuit_breaker.max_unresolved_tasks must be an integer between 1 and 10000');
      }
      if (
        typeof policy.min_unresolved_ratio_percent !== 'number'
        || policy.min_unresolved_ratio_percent <= 0
        || policy.min_unresolved_ratio_percent > 100
      ) {
        errors.push('fix_circuit_breaker.min_unresolved_ratio_percent must be a number greater than 0 and at most 100');
      }
    }
  }

  if (config.lifecycle_recovery !== undefined) {
    const policy = config.lifecycle_recovery;
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
      errors.push('lifecycle_recovery must be an object');
    } else {
      const boundedMs = (
        key: keyof typeof policy,
        min: number,
        max: number,
      ): void => {
        const value = policy[key];
        if (
          typeof value !== 'number'
          || !Number.isInteger(value)
          || value < min
          || value > max
        ) {
          errors.push(`lifecycle_recovery.${key} must be an integer between ${min} and ${max}`);
        }
      };
      boundedMs('coordinator_termination_grace_ms', 100, 60_000);
      boundedMs('termination_poll_interval_ms', 10, 5_000);
      boundedMs('forced_termination_verify_ms', 100, 60_000);
      if (
        typeof policy.termination_poll_interval_ms === 'number'
        && typeof policy.coordinator_termination_grace_ms === 'number'
        && policy.termination_poll_interval_ms > policy.coordinator_termination_grace_ms
      ) {
        errors.push('lifecycle_recovery.termination_poll_interval_ms must not exceed coordinator_termination_grace_ms');
      }
      if (
        typeof policy.termination_poll_interval_ms === 'number'
        && typeof policy.forced_termination_verify_ms === 'number'
        && policy.termination_poll_interval_ms > policy.forced_termination_verify_ms
      ) {
        errors.push('lifecycle_recovery.termination_poll_interval_ms must not exceed forced_termination_verify_ms');
      }
    }
  }

  // ─── Rollback config validation ────────────────────────────────────
  if (config.rollback_policy !== undefined) {
    const validPolicies = ['never', 'on_failure', 'always'] as const;
    if (!(validPolicies as readonly string[]).includes(config.rollback_policy)) {
      errors.push(`Invalid value '${config.rollback_policy}' for field 'rollback_policy'. Valid: ${validPolicies.join(', ')}`);
    }
  }

  // ─── Timeout config validation ─────────────────────────────────────
  if (config.timeout !== undefined) {
    const t = deepMerge(DEFAULT_TIMEOUT_CONFIG, config.timeout as Partial<TimeoutConfig>);

    // effort_base ordering: high > normal > low
    if (t.effort_base.high <= t.effort_base.normal) {
      errors.push('timeout.effort_base.high must be greater than effort_base.normal');
    }
    if (t.effort_base.normal <= t.effort_base.low) {
      errors.push('timeout.effort_base.normal must be greater than effort_base.low');
    }

    // per-backend min >= 300
    const minFields = ['docker_min_timeout', 'tmux_min_timeout', 'subprocess_min_timeout'] as const;
    for (const field of minFields) {
      if (t[field] < 300) {
        errors.push(`timeout.${field} must be >= 300`);
      }
    }

    // per-backend max <= 86400 (24h). Sprint 186 raised from 14400 (4h) to 86400 (24h)
    // to support long-running per-file audit sprints (479 tasks × opus ≈ 13h).
    const maxFields = ['docker_max_timeout', 'tmux_max_timeout', 'subprocess_max_timeout'] as const;
    for (const field of maxFields) {
      if (t[field] > 86400) {
        errors.push(`timeout.${field} must be <= 86400`);
      }
    }

    // max > min consistency per backend
    const backends = ['docker', 'tmux', 'subprocess'] as const;
    for (const backend of backends) {
      const minKey = `${backend}_min_timeout` as keyof TimeoutConfig;
      const maxKey = `${backend}_max_timeout` as keyof TimeoutConfig;
      if ((t[maxKey] as number) <= (t[minKey] as number)) {
        errors.push(`timeout.${maxKey} must be greater than timeout.${minKey}`);
      }
    }

    // Sprint 192 (Task 192-011): adaptive multiplier + extension cap.
    // Read from the raw user partial so we surface the failure even when
    // the deep-merged `t` would have fallen back to a sane default.
    const adaptive = (config.timeout as Partial<AdaptiveTimeoutFields>);
    if (adaptive.adaptive_multiplier !== undefined) {
      const v = adaptive.adaptive_multiplier;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 1.0) {
        errors.push(
          `Invalid value '${v}' for field 'timeout.adaptive_multiplier'. Must be a finite number >= 1.0.`,
        );
      }
    }
    if (adaptive.runtime_extension_max !== undefined) {
      const v = adaptive.runtime_extension_max;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
        errors.push(
          `Invalid value '${v}' for field 'timeout.runtime_extension_max'. Must be an integer >= 1.`,
        );
      }
    }

    // born-667a (Task 427-023, TIMEOUT-TIER): optional model-tier multiplier.
    // Absent entirely = 1.0 for every tier (today's behavior, unchanged).
    const modelMultiplier = (config.timeout as Partial<TimeoutConfig>).model_multiplier;
    if (modelMultiplier !== undefined) {
      const validTiers = ['economy', 'standard', 'premium', 'premium_plus'] as const;
      for (const [tier, value] of Object.entries(modelMultiplier)) {
        if (!(validTiers as readonly string[]).includes(tier)) {
          errors.push(
            `Invalid tier '${tier}' for field 'timeout.model_multiplier'. Valid: ${validTiers.join(', ')}`,
          );
          continue;
        }
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
          errors.push(
            `Invalid value '${value}' for field 'timeout.model_multiplier.${tier}'. Must be a finite number > 0.`,
          );
        }
      }
    }
  }

  // ─── Nervous System validation ─────────────────────────────────────
  if (config.nervous_system !== undefined) {
    const ns = config.nervous_system;
    const validNsModes = ['strict', 'balanced', 'autopilot', 'full-auto'] as const;
    if (!(validNsModes as readonly string[]).includes(ns.mode)) {
      errors.push(`Invalid value '${ns.mode}' for field 'nervous_system.mode'. Valid: ${validNsModes.join(', ')}`);
    }
    if (ns.notifications?.throttle_ms !== undefined && ns.notifications.throttle_ms < 0) {
      errors.push('nervous_system.notifications.throttle_ms must be >= 0');
    }
    if (ns.detectors !== undefined) {
      const sw = ns.detectors.stale_worker;
      if (sw?.threshold_ms !== undefined && sw.threshold_ms < 0) {
        errors.push('nervous_system.detectors.stale_worker.threshold_ms must be >= 0');
      }
      const dt = ns.detectors.debt_trend;
      if (dt?.threshold_rate !== undefined && (dt.threshold_rate < 0 || dt.threshold_rate > 1)) {
        errors.push('nervous_system.detectors.debt_trend.threshold_rate must be between 0 and 1');
      }
      const ar = ns.detectors.agent_routing;
      if (ar?.anomaly_threshold !== undefined && (ar.anomaly_threshold < 0 || ar.anomaly_threshold > 1)) {
        errors.push('nervous_system.detectors.agent_routing.anomaly_threshold must be between 0 and 1');
      }
    }
    if (ns.history_retention_days !== undefined && ns.history_retention_days < 1) {
      errors.push('nervous_system.history_retention_days must be >= 1');
    }
  }

  // ─── Autonomous Engine validation ──────────────────────────────────
  if (config.autonomous !== undefined) {
    const au = config.autonomous;
    if (typeof au.enabled !== 'boolean') {
      errors.push('autonomous.enabled must be a boolean');
    }
    if (au.interval_ms !== undefined && (typeof au.interval_ms !== 'number' || au.interval_ms < 0)) {
      errors.push('autonomous.interval_ms must be >= 0');
    }
    if (au.pool_size !== undefined && (typeof au.pool_size !== 'number' || !Number.isInteger(au.pool_size) || au.pool_size < 1)) {
      errors.push('autonomous.pool_size must be an integer >= 1');
    }
    const reactive = au.reactive;
    if (reactive !== undefined) {
      if (typeof reactive.enabled !== 'boolean') {
        errors.push('autonomous.reactive.enabled must be a boolean');
      }
      if (reactive.map_path !== undefined && typeof reactive.map_path !== 'string') {
        errors.push('autonomous.reactive.map_path must be a string');
      }
    }
    const workGen = au.work_generator;
    if (workGen !== undefined) {
      if (typeof workGen.enabled !== 'boolean') {
        errors.push('autonomous.work_generator.enabled must be a boolean');
      }
      if (workGen.interval_ms !== undefined && (typeof workGen.interval_ms !== 'number' || workGen.interval_ms < 0)) {
        errors.push('autonomous.work_generator.interval_ms must be >= 0');
      }
    }
    const rbacPolicy = au.rbac_policy;
    if (rbacPolicy !== undefined) {
      if (typeof rbacPolicy.enabled !== 'boolean') {
        errors.push('autonomous.rbac_policy.enabled must be a boolean');
      }
      if (rbacPolicy.role !== undefined && !['admin', 'operator', 'viewer'].includes(rbacPolicy.role)) {
        errors.push('autonomous.rbac_policy.role must be admin|operator|viewer');
      }
    }
  }

  // ─── Resource Monitor validation ────────────────────────────────────
  if (config.resource_monitor !== undefined) {
    const rm = config.resource_monitor;
    if (typeof rm.enabled !== 'boolean') {
      errors.push('resource_monitor.enabled must be a boolean');
    }
    if (rm.interval_ms !== undefined) {
      if (typeof rm.interval_ms !== 'number' || rm.interval_ms < 1000) {
        errors.push('resource_monitor.interval_ms must be a number >= 1000');
      }
    }
    if (rm.log_path !== undefined && typeof rm.log_path !== 'string') {
      errors.push('resource_monitor.log_path must be a string');
    }
  }


  // ─── Cross Verify validation (Sprint 276 XVER-1) ─────────────────────
  if (config.cross_verify !== undefined) {
    const cv = config.cross_verify;
    if (typeof cv.enabled !== 'boolean') {
      errors.push('cross_verify.enabled must be a boolean');
    }
    if (cv.high_stakes_only !== undefined && typeof cv.high_stakes_only !== 'boolean') {
      errors.push('cross_verify.high_stakes_only must be a boolean');
    }
    if (cv.enforce_refuted !== undefined && typeof cv.enforce_refuted !== 'boolean') {
      errors.push('cross_verify.enforce_refuted must be a boolean');
    }
    if (cv.allow_non_reservable_subscription_adjudication !== undefined
      && typeof cv.allow_non_reservable_subscription_adjudication !== 'boolean') {
      errors.push('cross_verify.allow_non_reservable_subscription_adjudication must be a boolean');
    }
    if (cv.max_verifications_per_sprint !== undefined
      && (typeof cv.max_verifications_per_sprint !== 'number'
        || !Number.isInteger(cv.max_verifications_per_sprint)
        || cv.max_verifications_per_sprint < 0)) {
      errors.push('cross_verify.max_verifications_per_sprint must be a non-negative integer');
    }
    if (cv.verifier_priority !== undefined) {
      if (!Array.isArray(cv.verifier_priority)) {
        errors.push('cross_verify.verifier_priority must be an array of strings');
      } else {
        for (const item of cv.verifier_priority) {
          if (typeof item !== 'string') {
            errors.push('cross_verify.verifier_priority must be an array of strings');
            break;
          }
          // 592-003: a provider-name typo (e.g. "cursro") silently passed as a
          // plain string before — surface it as a typed config error against
          // the live ALL_PROVIDER_NAMES set instead of a quiet no-op verifier.
          if (!(ALL_PROVIDER_NAMES as readonly string[]).includes(item)) {
            errors.push(getMessage('config.cross_verify_unknown_verifier_priority', 'en', {
              provider: item,
              providers: ALL_PROVIDER_NAMES.join(', '),
            }));
          }
        }
      }
    }
    if (cv.verifier_model !== undefined) {
      // Shape only — model identity is validated at resolution time against the
      // registry, so a typo surfaces as a loud model-resolution skip with the
      // offending ID, not as a config error that hides which provider it was for.
      if (typeof cv.verifier_model !== 'object'
        || cv.verifier_model === null
        || Array.isArray(cv.verifier_model)) {
        errors.push('cross_verify.verifier_model must be an object mapping provider → exact model API ID');
      } else {
        for (const [provider, model] of Object.entries(cv.verifier_model)) {
          // 592-003: the map's key is itself a provider name and gets the same
          // typed membership check as verifier_priority — see above.
          if (!(ALL_PROVIDER_NAMES as readonly string[]).includes(provider)) {
            errors.push(getMessage('config.cross_verify_unknown_verifier_model_provider', 'en', {
              provider,
              providers: ALL_PROVIDER_NAMES.join(', '),
            }));
          }
          if (typeof model !== 'string' || model.trim() === '') {
            errors.push(`cross_verify.verifier_model.${provider} must be a non-empty exact model API ID`);
          }
        }
      }
    }
    if (cv.verifier_tier_authority !== undefined) {
      errors.push(...validateXVerifyVerifierTierAuthority(cv.verifier_tier_authority).map(
        error => `cross_verify.verifier_tier_authority ${error}`,
      ));
    }
  }

  // ─── Worker Comms validation (Sprint 278 COMM-1) ─────────────────────
  if (config.worker_comms !== undefined) {
    const wc = config.worker_comms;
    if (typeof wc.enabled !== 'boolean') {
      errors.push('worker_comms.enabled must be a boolean');
    }
    if (wc.shared_memory_ttl_ms !== undefined && typeof wc.shared_memory_ttl_ms !== 'number') {
      errors.push('worker_comms.shared_memory_ttl_ms must be a number');
    }
    if (wc.inject_handoffs !== undefined && typeof wc.inject_handoffs !== 'boolean') {
      errors.push('worker_comms.inject_handoffs must be a boolean');
    }
    if (wc.inject_shared !== undefined && typeof wc.inject_shared !== 'boolean') {
      errors.push('worker_comms.inject_shared must be a boolean');
    }
  }

  // ─── Cost Guard validation (Sprint 279 WK-cost) ─────────────────────
  if (config.cost_guard !== undefined) {
    const cg = config.cost_guard;
    if (typeof cg.enabled !== 'boolean') {
      errors.push('cost_guard.enabled must be a boolean');
    }
    if (cg.max_limit_cost_usd !== undefined) {
      if (typeof cg.max_limit_cost_usd !== 'number' || cg.max_limit_cost_usd <= 0) {
        errors.push('cost_guard.max_limit_cost_usd must be a positive number');
      }
    }
  }

  // ─── Scheduler shadow-reducer validation (SCHED4) ───────────────────
  if (config.scheduler !== undefined) {
    const sch = config.scheduler;
    if (sch.shadow_reducer !== undefined && typeof sch.shadow_reducer !== 'boolean') {
      errors.push('scheduler.shadow_reducer must be a boolean');
    }
    // SCHED5 (docs/analysis/scheduler-unify-design-2026-07-11.md dilim-5):
    // `engine` selects the live scheduler driver (default 'legacy', see
    // scheduler-driver.ts's resolveSchedulerEngine). Promoted onto
    // SchedulerConfig (config-types.ts) by SCHED-7 (428-011) — typed directly,
    // no local cast needed.
    if (sch.engine !== undefined && sch.engine !== 'legacy' && sch.engine !== 'reducer') {
      errors.push("scheduler.engine must be 'legacy' or 'reducer'");
    }
  }

  // ─── Scheduler shadow-retention validation ─────────────────────────
  if (config.scheduler_shadow_retention?.retention_days !== undefined) {
    const v = config.scheduler_shadow_retention.retention_days;
    if (typeof v !== 'number' || v < 1 || v > 365) {
      errors.push('scheduler_shadow_retention.retention_days must be a number between 1 and 365');
    }
  }

  // Runtime artifact retention is fail-closed: every family must carry all
  // three finite positive bounds and each bound has a hard upper ceiling.
  if (config.runtime_artifact_retention !== undefined) {
    const policy = config.runtime_artifact_retention;
    if (typeof policy !== 'object' || policy === null || Array.isArray(policy)) {
      errors.push('runtime_artifact_retention must be an object');
    } else {
      const allowedPolicyFields = new Set(['enabled', 'apply_on_finalize', 'archive_path', 'families']);
      for (const field of Object.keys(policy)) {
        if (!allowedPolicyFields.has(field)) {
          errors.push(`runtime_artifact_retention.${field} is not a recognized field`);
        }
      }
      if (typeof policy.enabled !== 'boolean') {
        errors.push('runtime_artifact_retention.enabled must be a boolean');
      }
      if (typeof policy.apply_on_finalize !== 'boolean') {
        errors.push('runtime_artifact_retention.apply_on_finalize must be a boolean');
      }
      if (typeof policy.archive_path !== 'string'
        || policy.archive_path.trim().length === 0
        || policy.archive_path.startsWith('/')
        || policy.archive_path.startsWith('\\\\')
        || /^[A-Za-z]:[\\/]/u.test(policy.archive_path)
        || policy.archive_path.split(/[\\/]+/u).includes('..')) {
        errors.push('runtime_artifact_retention.archive_path must be a safe project-relative path');
      }
      if (typeof policy.families !== 'object' || policy.families === null
        || Array.isArray(policy.families) || Object.keys(policy.families).length === 0) {
        errors.push('runtime_artifact_retention.families must be a non-empty object');
      } else {
        for (const [familyName, family] of Object.entries(policy.families)) {
          if (familyName.trim().length === 0
            || familyName === '.'
            || familyName === '..'
            || familyName.includes('/')
            || familyName.includes('\\')) {
            errors.push('runtime_artifact_retention family names must be safe non-empty path segments');
            continue;
          }
          if (typeof family !== 'object' || family === null || Array.isArray(family)) {
            errors.push(`runtime_artifact_retention.families.${familyName} must be an object`);
            continue;
          }
          const boundFields = ['max_age_days', 'max_count', 'max_size_mb'] as const;
          const allowedBoundFields = new Set<string>(boundFields);
          for (const field of Object.keys(family)) {
            if (!allowedBoundFields.has(field)) {
              errors.push(`runtime_artifact_retention.families.${familyName}.${field} is not a recognized bound`);
            }
          }
          for (const field of boundFields) {
            const value = family[field];
            if (typeof value !== 'number' || !Number.isInteger(value)
              || value < 1 || value > RUNTIME_ARTIFACT_RETENTION_LIMITS[field]) {
              errors.push(`runtime_artifact_retention.families.${familyName}.${field} must be an integer between 1 and ${RUNTIME_ARTIFACT_RETENTION_LIMITS[field]}`);
            }
          }
        }
      }
    }
  }

  // ─── Gate config validation (Sprint 325) ───────────────────────────
  if (config.gate !== undefined) {
    const g = config.gate;
    if (g.max_tech_debt_ratio !== undefined) {
      const v = g.max_tech_debt_ratio;
      if (typeof v !== 'number' || Number.isNaN(v) || v < 0 || v > 1) {
        errors.push(`Invalid value '${v}' for field 'gate.max_tech_debt_ratio'. Must be a number in [0, 1].`);
      }
    }
    if (g.verify_delta_downgrade !== undefined && typeof g.verify_delta_downgrade !== 'boolean') {
      errors.push(`Invalid value '${g.verify_delta_downgrade}' for field 'gate.verify_delta_downgrade'. Must be a boolean.`);
    }
    if (g.enforce_adr_compliance !== undefined && typeof g.enforce_adr_compliance !== 'boolean') {
      errors.push(`Invalid value '${g.enforce_adr_compliance}' for field 'gate.enforce_adr_compliance'. Must be a boolean.`);
    }
  }

  // ─── Approval config validation (Sprint 355 CFG-APR-WIRE) ───────────
  // NOTE: `approval.rules` is intentionally NOT validated here — a malformed
  // rule must never throw / break config load. Rule-level validation is
  // fully owned by `loadApprovalRules` (approval-rules-load.ts), invoked
  // fail-soft from `loadConfig`/`mergeConfigs` via `resolveApprovalConfig`
  // (warnings only, routed through `debugLog`). Only the gate/relay
  // activation flags get a shallow throwing type-check here, mirroring the
  // other opt-in blocks above.
  if (config.approval !== undefined) {
    const apr = config.approval;
    if (typeof apr !== 'object' || apr === null || Array.isArray(apr)) {
      errors.push('approval must be an object');
    } else {
      if (apr.gate_enabled !== undefined && typeof apr.gate_enabled !== 'boolean') {
        errors.push('approval.gate_enabled must be a boolean');
      }
      if (apr.relay_enabled !== undefined && typeof apr.relay_enabled !== 'boolean') {
        errors.push('approval.relay_enabled must be a boolean');
      }
      try {
        resolveApprovalLifecyclePolicy(apr.lifecycle);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  // ─── deckent_style validation ───────────────────────────────────────
  if (config.deckent_style !== undefined && !['sprint', 'task', 'process'].includes(config.deckent_style)) {
    errors.push(`Invalid value '${config.deckent_style}' for field 'deckent_style'. Valid options: sprint, task, process`);
  }

  // ─── Routing Engine validation ──────────────────────────────────────
  // V1/V2 retired: only the provider-independent vector pipeline is valid.
  if (config.routing_engine !== undefined) {
    const validRoutingEngines = ['v3'] as const;
    if (!(validRoutingEngines as readonly string[]).includes(config.routing_engine)) {
      errors.push(`Invalid value '${config.routing_engine}' for field 'routing_engine'. Valid: ${validRoutingEngines.join(', ')}`);
    }
  }

  // ─── Routing behaviour flags validation (T6) ───────────────────────
  // Only the block SHAPE is validated. The individual tuning flags carry no
  // dedicated type-check: skill_agent_affinity/agent_cache validation was
  // removed with those dead flags (S3 cut-over); `effort_tiering` is an opt-in
  // boolean read defensively (`?? false`) at its single call site.
  if (
    config.routing !== undefined &&
    (typeof config.routing !== 'object' || config.routing === null || Array.isArray(config.routing))
  ) {
    errors.push('routing must be an object');
  }

  // ─── Prompt config validation (Sprint 182 PQ-5 / F7) ────────────────
  if (config.prompt?.adr_min_relevance !== undefined) {
    const v = config.prompt.adr_min_relevance;
    if (typeof v !== 'number' || Number.isNaN(v) || v < 0 || v > 1) {
      errors.push(
        `Invalid value '${v}' for field 'prompt.adr_min_relevance'. Must be a number in [0, 1].`,
      );
    }
  }
  // TERMINAL-POSTURE-001 — a typo in the boot posture is refused, never
  // silently resolved to a posture the operator did not choose.
  if (config.terminal?.posture !== undefined) {
    const validPostures = ['ask', 'run', 'control'];
    const posture = config.terminal.posture;
    if (typeof posture !== 'string' || !validPostures.includes(posture.toLowerCase())) {
      errors.push(
        `Invalid value '${String(posture)}' for field 'terminal.posture'. Valid: ${validPostures.join(', ')}.`,
      );
    }
  }
  // TERMINAL-READABILITY-002 — the hyperlink override is a closed enum; a typo
  // must not silently fall back to `auto`.
  if (config.terminal?.links !== undefined) {
    const validLinks = ['auto', 'on', 'off'];
    const links = config.terminal.links;
    if (typeof links !== 'string' || !validLinks.includes(links.toLowerCase())) {
      errors.push(
        `Invalid value '${String(links)}' for field 'terminal.links'. Valid: ${validLinks.join(', ')}.`,
      );
    }
  }
  if (config.prompt?.adr_render !== undefined) {
    const validAdrRender = ['full', 'operative'];
    if (!validAdrRender.includes(config.prompt.adr_render)) {
      errors.push(
        `Invalid value '${config.prompt.adr_render}' for field 'prompt.adr_render'. Valid: ${validAdrRender.join(', ')}.`,
      );
    }
  }
  if (config.prompt?.persona_render !== undefined) {
    const validPersonaRender = ['full', 'guidance'];
    if (!validPersonaRender.includes(config.prompt.persona_render)) {
      errors.push(
        `Invalid value '${config.prompt.persona_render}' for field 'prompt.persona_render'. Valid: ${validPersonaRender.join(', ')}.`,
      );
    }
  }
  if (
    config.prompt?.exclude_dynamic_system_prompt_sections !== undefined &&
    typeof config.prompt.exclude_dynamic_system_prompt_sections !== 'boolean'
  ) {
    errors.push(
      `Invalid value '${config.prompt.exclude_dynamic_system_prompt_sections}' for field ` +
      `'prompt.exclude_dynamic_system_prompt_sections'. Must be a boolean.`,
    );
  }

  // ─── Plan config validation (Sprint 276 PLAN-INT-1) ─────────────────
  if (config.plan?.interrogate !== undefined && typeof config.plan.interrogate !== 'boolean') {
    errors.push(`Invalid value '${String(config.plan.interrogate)}' for field 'plan.interrogate'. Must be a boolean.`);
  }

  // ─── Chat config validation (Sprint 221 Task 221-010) ───────────────
  const chatBlock = (config as unknown as Record<string, unknown>)['chat'];
  if (chatBlock !== undefined) {
    const chatResult = CHAT_CONFIG_SCHEMA.safeParse(chatBlock);
    if (!chatResult.success) {
      for (const issue of chatResult.error.issues) {
        const path = issue.path.length > 0 ? `chat.${issue.path.join('.')}` : 'chat';
        errors.push(`${path}: ${issue.message}`);
      }
    }
  }

  // ─── API OIDC validation (Sprint 267 T-267-001) ─────────────────────
  // Optional block — absent means today's static-token-only behavior. NEVER
  // echo `key` material into an error message (secret-leak guard).
  if (config.api_oidc !== undefined) {
    const oidc = config.api_oidc as unknown as Record<string, unknown>;
    if (typeof oidc['enabled'] !== 'boolean') {
      errors.push('api_oidc.enabled must be a boolean');
    }
    const oidcAlgorithm = oidc['algorithm'];
    if (oidcAlgorithm !== undefined && oidcAlgorithm !== 'HS256' && oidcAlgorithm !== 'RS256') {
      errors.push(`Invalid value '${String(oidcAlgorithm)}' for field 'api_oidc.algorithm'. Valid: HS256, RS256`);
    }
    if (oidc['audience'] !== undefined && typeof oidc['audience'] !== 'string') {
      errors.push('api_oidc.audience must be a string');
    }
    if (oidc['enabled'] === true) {
      if (typeof oidc['issuer'] !== 'string' || oidc['issuer'].length === 0) {
        errors.push('api_oidc.issuer must be a non-empty string when api_oidc.enabled is true');
      }
      if (typeof oidc['key'] !== 'string' || oidc['key'].length === 0) {
        errors.push('api_oidc.key must be a non-empty string when api_oidc.enabled is true');
      }
      if (oidcAlgorithm === undefined) {
        errors.push('api_oidc.algorithm is required when api_oidc.enabled is true. Valid: HS256, RS256');
      }
    }
  }

  const approvalAuthority = config.approval?.authority;
  if (approvalAuthority !== undefined) {
    if (typeof approvalAuthority.enabled !== 'boolean') {
      errors.push('approval.authority.enabled must be a boolean');
    }
    if (approvalAuthority.enabled === true) {
      const oidc = approvalAuthority.oidc;
      const terminal = approvalAuthority.terminal;
      if (typeof approvalAuthority.tenant_id !== 'string' || approvalAuthority.tenant_id.trim().length === 0) {
        errors.push('approval.authority.tenant_id must be a non-empty string when enabled');
      }
      // At least one live re-authentication channel must be authored: the OIDC
      // policy (HTTP decision ingress) or the local-terminal window (K6). A
      // channel-less enabled authority could never mint a trusted decision.
      if (!oidc && !terminal) {
        errors.push('approval.authority requires an oidc or terminal channel block when enabled');
      }
      if (terminal !== undefined
        && (typeof terminal.max_auth_age_seconds !== 'number'
          || !Number.isFinite(terminal.max_auth_age_seconds)
          || terminal.max_auth_age_seconds <= 0)) {
        errors.push('approval.authority.terminal.max_auth_age_seconds must be a positive finite number');
      }
      if (approvalAuthority.decision_window_seconds !== undefined
        && (typeof approvalAuthority.decision_window_seconds !== 'number'
          || !Number.isFinite(approvalAuthority.decision_window_seconds)
          || approvalAuthority.decision_window_seconds <= 0)) {
        errors.push('approval.authority.decision_window_seconds must be a positive finite number');
      }
      if (oidc !== undefined && (!oidc || typeof oidc !== 'object')) {
        errors.push('approval.authority.oidc must be an object when configured');
      } else if (oidc) {
        for (const [field, value] of [
          ['authority_ref', oidc.authority_ref],
          ['tenant_claim', oidc.tenant_claim],
        ] as const) {
          if (typeof value !== 'string' || value.trim().length === 0) {
            errors.push(`approval.authority.oidc.${field} must be a non-empty string when enabled`);
          }
        }
        for (const [field, value] of [
          ['max_auth_age_seconds', oidc.max_auth_age_seconds],
          ['max_session_seconds', oidc.max_session_seconds],
        ] as const) {
          if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
            errors.push(`approval.authority.oidc.${field} must be a positive finite number when enabled`);
          }
        }
        for (const [field, value] of [
          ['required_acr', oidc.required_acr],
          ['required_amr', oidc.required_amr],
        ] as const) {
          if (value !== undefined
            && (!Array.isArray(value)
              || value.length === 0
              || value.some(item => typeof item !== 'string' || item.trim().length === 0))) {
            errors.push(`approval.authority.oidc.${field} must be a non-empty string array when configured`);
          }
        }
      }
      // The OIDC channel needs the API's signature material; the terminal
      // channel authenticates interactively and has no api_oidc dependency.
      if (oidc !== undefined
        && (config.api_oidc?.enabled !== true
          || typeof config.api_oidc.audience !== 'string'
          || config.api_oidc.audience.trim().length === 0)) {
        errors.push('approval.authority.oidc requires enabled api_oidc with an explicit audience');
      }
    }
  }

  if (errors.length > 0) {
    throw new ConfigValidationError(errors);
  }

  return maxWorkersWarnings;
}

// ─── Worker Resolution ───────────────────────────────────────────────

/**
 * Resolves the effective number of workers to spawn.
 *
 * Precedence (Sprint 319 Task B-MAXWORKERS-WIRE):
 *   1. top-level `config.max_workers` (numeric)  → explicit override, wins outright
 *   2. top-level `config.max_workers === 'auto'`  → systemProfile auto path
 *   3. `config.activeModeConfig.max_workers`       → mode preset / per-mode value
 *
 * - 'auto' (top-level or per-mode): uses systemProfile.recommendedMaxWorkers,
 *   capped by an optional plan_limit
 * - number: returns the configured value directly
 *
 * The top-level override lets a user pin `max_workers` in config.json without
 * editing every mode preset. A non-numeric / non-'auto' top-level value (or an
 * absent one) falls through to the prior mode-config behavior unchanged.
 */
export function resolveEffectiveWorkers(
  config: ResolvedConfig,
  systemProfile: SystemProfile,
  planLimit?: number,
): number {
  // Sprint 319 (B-MAXWORKERS-WIRE): honor the explicit top-level override first.
  const topLevel = (config as ResolvedConfigWithMaxWorkers).max_workers;
  if (typeof topLevel === 'number' && Number.isFinite(topLevel) && topLevel >= 1) {
    return topLevel;
  }

  const maxWorkers = topLevel === 'auto' ? 'auto' : config.activeModeConfig.max_workers;
  if (maxWorkers === 'auto') {
    const recommended = systemProfile.recommendedMaxWorkers;
    return planLimit !== undefined ? Math.min(recommended, planLimit) : recommended;
  }
  return maxWorkers;
}

/**
 * Resolve the effective Brain planning mode.
 *
 * Precedence (Task 429-006 — PLNR1, eski-🔴 Bug-1):
 *   1. explicit top-level `config.brain_planning`        → wins outright
 *   2. `config.activeModeConfig.brain_planning` (preset)  → today's behavior
 *   3. 'auto'
 *
 * The top-level field lets a user pin `brain_planning` in config.json without
 * editing every mode preset — mirroring the `max_workers` top-level override
 * pattern (Sprint 319 B-MAXWORKERS-WIRE / {@link resolveEffectiveWorkers}).
 * An absent top-level value falls through to the prior preset-only behavior
 * unchanged. Callers (e.g. sprint-planner.ts) MUST resolve through this
 * helper instead of reading `config.activeModeConfig.brain_planning` directly.
 */
export function resolveBrainPlanningMode(config: ResolvedConfig): BrainPlanningMode {
  return config.brain_planning ?? config.activeModeConfig.brain_planning ?? 'auto';
}

// ─── Coverage gate resolver (Sprint 179 W2-4) ────────────────────────

/**
 * Resolve the coverage gate split fields:
 *   - `coverage_hard_floor`   immutable EVALUATE gate (default 50)
 *   - `coverage_aspirational` finalizer-tunable target (default 90)
 *   - `coverage_threshold`    legacy field, mirrored to aspirational
 *
 * Precedence for the aspirational target:
 *   explicit `coverage_aspirational` > legacy `coverage_threshold` > 90.
 * The hard floor is clamped at the aspirational value so the floor never
 * exceeds the target.
 */
export function resolveCoverageGates(
  config: Partial<DeckentConfig>,
): { coverage_hard_floor: number; coverage_aspirational: number; coverage_threshold: number } {
  const aspirational =
    config.coverage_aspirational ?? config.coverage_threshold ?? 90;
  const requestedFloor = config.coverage_hard_floor ?? 50;
  const hardFloor = Math.min(requestedFloor, aspirational);
  return {
    coverage_hard_floor: hardFloor,
    coverage_aspirational: aspirational,
    coverage_threshold: aspirational, // back-compat mirror
  };
}

/**
 * Resolve the `approval` config block (Sprint 355 CFG-APR-WIRE) — the single
 * authority turning raw `approval.rules` JSON into a validated
 * `ApprovalPolicyRule[]` plus the gate/relay activation flags. Rule
 * validation itself is fully owned by `loadApprovalRules`
 * (approval-rules-load.ts, READ-ONLY here — never re-implemented); a
 * malformed rule entry is skipped with a warning routed through `debugLog`,
 * never thrown — a broken `approval.rules` block must not break config load
 * or a sprint. Called from both `loadConfig` and `mergeConfigs`, mirroring
 * `resolveCoverageGates`.
 */
export function resolveApprovalConfig(
  config: Partial<DeckentConfig>,
): NonNullable<ResolvedConfig['approval']> {
  const { rules, warnings } = loadApprovalRules(config);
  for (const warning of warnings) {
    debugLog('cfg-apr-wire', warning);
  }
  return {
    rules,
    gate_enabled: config.approval?.gate_enabled ?? false,
    relay_enabled: config.approval?.relay_enabled ?? false,
    question_bridge: config.approval?.question_bridge === true,
    lifecycle: resolveApprovalLifecyclePolicy(config.approval?.lifecycle),
    ...(config.approval?.authority
      ? {
          authority: {
            ...config.approval.authority,
            ...(config.approval.authority.oidc
              ? {
                  oidc: {
                    ...config.approval.authority.oidc,
                    ...(config.approval.authority.oidc.required_acr
                      ? { required_acr: [...config.approval.authority.oidc.required_acr] }
                      : {}),
                    ...(config.approval.authority.oidc.required_amr
                      ? { required_amr: [...config.approval.authority.oidc.required_amr] }
                      : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
  };
}

/** Env twin forcing `live_trace.enabled` ON for one process tree (583/N5) —
 *  interactive launch-sites (detached-start.ts) export it to the coordinator
 *  child; workers inherit it. Same `=1`-only contract as
 *  `DECKENT_CONTROL_MUTATIONS` (api/server.ts). */
export const LIVE_TRACE_ENV = 'DECKENT_LIVE_TRACE';

/**
 * Resolve the effective `live_trace.enabled` flag (583/N5 TRACE-FLIP) — the
 * ONE gate every producer reads (sprint-spawner / scheduler-effects spawn
 * opts, worker.ts heartbeat tap, agentic-worker-entry progress stream).
 * `DECKENT_LIVE_TRACE=1` in the process env wins first — interactive-origin
 * runs (REPL card `s`, `deckent runs --start`, desktop/API start) stream live
 * without flipping the GLOBAL config default, so headless/CI fleets keep the
 * zero-cost no-op tap (worker-activity.ts). Falls back to the config block;
 * absent = off, exactly as before N5.
 */
export function resolveLiveTraceEnabled(
  config?: { live_trace?: { enabled?: boolean } } | null,
): boolean {
  if (process.env[LIVE_TRACE_ENV] === '1') return true;
  return config?.live_trace?.enabled === true;
}

// ─── File Reading ────────────────────────────────────────────────────

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  return readJsonSafeAsync<T>(filePath);
}

// ─── Config Cache ───────────────────────────────────────────────────
let cachedConfig: ResolvedConfig | null = null;
let cacheStamp = '';
let cachedProjectRoot: string | null = null;

/**
 * Clear the module-level config cache. Useful for testing.
 */
export function clearConfigCache(): void {
  cachedConfig = null;
  cacheStamp = '';
  cachedProjectRoot = null;
}

/**
 * Return the already-resolved config snapshot for an exact project root.
 *
 * This synchronous read is intentionally cache-only: synchronous construction
 * seams must never reimplement the layered async config loader or observe a
 * snapshot resolved for another project.
 */
export function getLoadedConfig(projectRoot: string): ResolvedConfig | undefined {
  return cachedConfig !== null && cachedProjectRoot === resolve(projectRoot)
    ? cachedConfig
    : undefined;
}

/**
 * Bind cache validity to both authored config layers. Including the effective
 * global path prevents a platform/legacy-path switch from reusing an authority
 * snapshot produced from a different file.
 */
function getConfigCacheStamp(projectRoot: string): string {
  const projectPath = join(projectRoot, PROJECT_CONFIG_PATH);
  const globalPath = resolveGlobalConfigReadPath();
  const fileStamp = (path: string): string => {
    try {
      const stat = statSync(path);
      return `${stat.mtimeMs}:${stat.size}:${stat.ino}`;
    } catch {
      return 'missing';
    }
  };
  return `${globalPath}\0${fileStamp(globalPath)}\0${projectPath}\0${fileStamp(projectPath)}`;
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Create a fresh default DeckentConfig with default mode and mode definitions.
 * @returns A new DeckentConfig instance with default values
 */
export function createDefaultConfig(): DeckentConfig {
  const config: DeckentConfigWithThrottle = {
    mode: DEFAULT_MODE,
    modes: structuredClone(DEFAULT_MODES),
    // Provider (Sprint 150 Decision 4 — grouped `providers` is canonical; flat keys deprecated)
    providers: {
      brain: 'claude',
      worker: 'claude',
      registry: [{
        name: 'local-llm',
        type: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:8080/v1',
        apiKeyEnv: '',
        authMode: 'none',
        executionCostClass: 'local',
        models: ['Qwen3.8-27B'],
      }],
    },
    provider_overrides: undefined,
    cost_optimization: false,
    // claude_backend removed (Sprint 150 Decision 3 — use spawn_backend instead)
    // Sprint 177: default changed from undefined/tmux to 'docker' (ADR-027, Sprint 176 evidence).
    // KN2 (2026-08-08): 'docker' → 'auto'. The 2026-08-07 cold-start smoke measured
    // that a docker-less host got the docker backend anyway and every spawn died.
    // 'auto' is now capability-probed at resolve time (docker when the daemon is
    // reachable, else subprocess with a one-time typed log); a user who writes
    // 'docker' explicitly keeps the honest hard failure.
    spawn_backend: 'auto',
    // KN2 (GR-2026-08-08-DOGFOOD-KN2-01): default worker execution-budget POLICY.
    // The budget authority (resolveExecutionBudgetPolicy) is deliberately
    // owner-authored with no runtime default — absence is a typed `hold`, which
    // is exactly what the cold-start smoke measured: no policy, so no spawn
    // could ever be admitted. Authoring the default HERE keeps that philosophy
    // intact: init writes this block into the project's own config.json where
    // the owner can see and edit it — it is explicit config, not a hidden
    // runtime fallback. Ceilings are the outer authority only; the planner
    // stamps per-task estimate-anchored REQUESTED budgets that narrowBudget
    // reduces to the field-wise minimum. Final-only-usage providers
    // (codex/gemini) still fail closed without an owner grant — claude reports
    // incremental usage, so the default provider path runs.
    execution_budget: {
      roles: {
        worker: {
          default: {
            maxTurns: 40,
            maxTokens: 4_000_000,
          },
        },
      },
      landing: { reserve_ratio: 0.25 },
    },
    auth_mode: 'subscription',
    evaluation: { tsc_settlement_gate: true },
    // Human Checkpoints (empty = fully autonomous)
    human_checkpoints: [],
    // Sprint
    fix_phase_enabled: true,
    max_fix_retries: DEFAULT_MAX_FIX_RETRIES,
    fix_circuit_breaker: { ...DEFAULT_FIX_CIRCUIT_BREAKER_CONFIG },
    lifecycle_recovery: { ...DEFAULT_LIFECYCLE_RECOVERY_CONFIG },
    // @deprecated retained as the aspirational seed for legacy configs.
    coverage_threshold: 90,
    // Sprint 179 W2-4 — split single threshold into immutable floor +
    // adaptive aspirational target. Defaults are also asserted by
    // `resolveCoverageGates`, which is the single resolver consulted by
    // `mergeConfigs`/`loadConfig` BEFORE the deep-merge with defaults so the
    // legacy `coverage_threshold` precedence is preserved.
    coverage_hard_floor: 50,
    coverage_aspirational: 90,
    max_reroutes: 3,
    reroute_on_tech_debt: false,
    sprint_timeout_minutes: 0,
    // Memory
    memory_budget: 5000, // Sprint 140 pre-flight: 900→5000 (Self-Analysis Ayna Sprint)
    decay_after_sprints: 20, // Sprint 140 pre-flight: 5→20 (self-analysis raporları hemen silinmesin)
    patterns_enabled: true,
    project_identity_enabled: true,
    memory_export: {
      max_inline_lines: 3000,
      max_inline_bytes: 256 * 1024,
      summary_inline_lines: 200,
      summary_inline_bytes: 16 * 1024,
    },
    // Auditor
    scan_interval: 30,
    heartbeat_timeout: 120,
    boundary_enforcement: true,
    lock_stale_threshold: 300,
    // Skill-Based Provider Routing
    skill_routing: undefined,
    // Search & Documentation
    search_enabled: true,
    search_provider: 'context7',
    search_cache_ttl: 3600,
    // Notifications
    notify_on_complete: false,
    // Bot-daemon durable owner-notification outbox drain cadence (671-001).
    notify_outbox_drain_interval_ms: 30_000,
    notify_channel: null,
    notify_url: null,
    // Telemetry
    telemetry_enabled: false,
    telemetry_anonymous: true,
    // Environment Detection
    detected_env: null,
    multi_ide_mode: false,
    // Output & Display
    output_splash: true,
    output_mode: 'normal',
    output_theme: 'default',
    // Rollback
    rollback_policy: 'never',
    // Rubric-Based Evaluation
    evaluation_rubric: undefined,
    rubric_max_retries: 0,
    acceptance_matrix: undefined,
    acceptance_enforcement: 'observe',
    // Adaptive Thresholds
    adaptive_thresholds: false,
    agent_min_score: 5,
    adaptive_config: { min_samples: 3, no_go_threshold: 0.3, coverage_lookback: 3 },
    // Routing Engine v3
    routing_engine: 'v3',
    // Cleanup delay: wait before deleting .tasks/ files (ms)
    cleanup_delay_ms: 180_000,
    // Dependency pipeline enabled — see DeckentConfig.dependency_pipeline_enabled
    // (config-types.ts) for the full history/rollback note. Default true.
    dependency_pipeline_enabled: true,
    // Debt pre-flight revalidation at PLAN time (Dogfood-449 B5) — see
    // DeckentConfig.debt_preflight_enabled for rationale/rollback. Default true.
    debt_preflight_enabled: true,
    // Sprint checkpoint interval: how many terminal tasks before writing a checkpoint
    sprint_checkpoint_interval: 5,
    // Sprint 202 Task 202-004 — pre-spawn pacing in ms (computeBackoff floor).
    // 0 disables; 500 ms is the conservative default that prevented the
    // Sprint 198 30k tpm Tier-1 burst.
    token_throttle_ms: 500,
    // Timeout
    timeout: structuredClone(DEFAULT_TIMEOUT_CONFIG),
    // Observability (Sprint 150 Task 030 — metrics rotation defaults)
    observability: {
      rotation: {
        maxSizeMB: 1,
        archiveFormat: 'gzip',
        keepLastN: 10,
      },
    },
    // Sprint File Retention (Sprint 150 Task 035 — Hybrid keep_last_n + size_cap_mb)
    sprint_file_retention: {
      keep_last_n: 10,
      size_cap_mb: 500,
      archive_path: '.deckent/archive/sprints/',
    },
    // Scheduler Shadow Retention (kullanıcı talebi: 14 gün)
    scheduler_shadow_retention: {
      retention_days: 14,
      archive_path: '.deckent/archive/scheduler-shadow/',
    },
    runtime_artifact_retention: structuredClone(DEFAULT_RUNTIME_ARTIFACT_RETENTION_CONFIG),
    // Runtime Style
    deckent_style: 'sprint',
    // Terminal (Sprint 175 — embedded web terminal)
    terminal: structuredClone(DEFAULT_TERMINAL_CONFIG),
    // Worker prompt tuning (Sprint 182 PQ-5 / F7 — ADR relevance threshold)
    prompt: structuredClone(DEFAULT_PROMPT_CONFIG),
    // Autonomous Engine (disabled by default — flag-gated, ADR-040)
    autonomous: {
      enabled: false,
      interval_ms: 5000,
      backlog_path: '.deckent/autonomous/backlog.json',
      pool_size: 1,
      reactive: { enabled: false, map_path: '.deckent/autonomous/reactive-map.json' },
      work_generator: { enabled: false, interval_ms: 600000 },
      rbac_policy: { enabled: false, role: 'viewer' },
    },
    // Nervous System (disabled by default — Sprint 148 will activate)
    nervous_system: {
      enabled: false,
      mode: 'balanced',
      actionOverrides: {},
      safety_floor: {
        locked_actions: [
          'KILL_LIVE_SPRINT',
          'MANUAL_FILE_DELETE',
          'COST_OVER_THRESHOLD',
          'DESTRUCTIVE_GIT',
          'ADR_DEPRECATE_ACCEPTED',
        ],
        cost_threshold_usd: 110,
        bypass_allowed: false,
      },
      notifications: {
        channels: { mcp: true, cli: true, file: true, desktop: false },
        throttle_ms: 300000,
        group_info_window_ms: 600000,
        severity_min: 'info',
        quiet_hours: { start: '22:00', end: '08:00', timezone: 'TRT' },
        cross_channel_dedup: true,
      },
      detectors: {
        stale_worker: { enabled: true, threshold_ms: 120000 },
        scope_collision: { enabled: true },
        debt_trend: { enabled: true, threshold_rate: 0.15 },
        agent_routing: { enabled: true, anomaly_threshold: 0.40 },
        directives_protection: { enabled: true, auto_restore: true },
        // Sprint 165: kod hazır — reserve_for kaldırıldı (Sprint 180 W0).
        dead_event_stream: { enabled: false },
        cost_threshold: { enabled: false, reserve_for: 'sprint-148' },
        prompt_quality: { enabled: false, reserve_for: 'sprint-148' },
        worker_output_variance: { enabled: false, reserve_for: 'sprint-148' },
        self_modifying_warner: { enabled: false, reserve_for: 'sprint-148' },
        // Sprint 180 W0 — NERVOUS-TODO §11.2 Step F: 6 yeni detector default
        // enabled:false. Faz 2/3'te aktive edilir.
        task_mode_idle: { enabled: false },
        build_failure_recurrence: { enabled: false },
        token_spike: { enabled: false },
        agent_routing_anomaly: { enabled: false },
        scope_collision_rate: { enabled: false },
        // pending_age_threshold_ms (671-001): several multiples of the default
        // notify_outbox_drain_interval_ms (30s) so a healthy drain never self-alarms.
        notification_delivery_health: { enabled: false, pending_age_threshold_ms: 300_000 },
      },
      history_retention_days: 30,
    },
  };
  return config;
}

/**
 * Alias for createDefaultConfig. Returns a fresh default configuration.
 * @returns A new DeckentConfig instance with default values
 */
export function getDefaultConfig(): DeckentConfig {
  return createDefaultConfig();
}

/**
 * Get a deep clone of the default mode definitions for all plan modes.
 * @returns A record mapping each PlanMode to its default PlanModeConfig
 */
export function getDefaultModes(): Record<string, PlanModeConfig> {
  return structuredClone(DEFAULT_MODES);
}

export interface ConfigPreimageIdentity {
  sha256: string;
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
}

export type HealCorruptProjectConfigResult =
  | {
      kind: 'healed';
      config: DeckentConfig;
      backupPath: string;
      preimageIdentity: ConfigPreimageIdentity;
    }
  | {
      kind: 'heldConcurrentRevision';
      adoptedConfig?: Partial<DeckentConfig>;
      preimageIdentity: ConfigPreimageIdentity;
    }
  | {
      kind: 'failed';
      error: unknown;
      preimageIdentity?: ConfigPreimageIdentity;
    };

const CONFIG_CONCURRENT_REVISION_HOLD =
  '[deckent] CONFIG_CONCURRENT_REVISION_HOLD: heal sırasında config başka bir ' +
  'writer tarafından yenilendi — dosyaya dokunulmadı; yeni revizyon geçerli sayılır';

function sha256Text(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Heal a confirmed-corrupt config without replacing a newer revision. */
export function healCorruptProjectConfig(
  projectConfigPath: string,
  rawPreimageText: string,
): HealCorruptProjectConfigResult {
  let preimageIdentity: ConfigPreimageIdentity | undefined;
  try {
    const preimageStat = statSync(projectConfigPath);
    const identity: ConfigPreimageIdentity = {
      sha256: sha256Text(rawPreimageText),
      dev: preimageStat.dev,
      ino: preimageStat.ino,
      size: preimageStat.size,
      mtimeMs: preimageStat.mtimeMs,
    };
    preimageIdentity = identity;

    return withConfigWriteLock(projectConfigPath, () => {
      const freshDefault = createDefaultConfig();
      const stagedPath = `${projectConfigPath}.${process.pid}.tmp`;
      writeConfigJsonAtomic(stagedPath, freshDefault);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${projectConfigPath}.corrupted.${timestamp}.bak`;

      const currentText = readFileSync(projectConfigPath, 'utf-8');
      if (sha256Text(currentText) !== identity.sha256) {
        try {
          unlinkSync(stagedPath);
        } catch {
          // Best-effort cleanup; the concurrent canonical revision stays untouched.
        }
        console.error(CONFIG_CONCURRENT_REVISION_HOLD);

        try {
          return {
            kind: 'heldConcurrentRevision',
            adoptedConfig: JSON.parse(currentText) as Partial<DeckentConfig>,
            preimageIdentity: identity,
          };
        } catch {
          return { kind: 'heldConcurrentRevision', preimageIdentity: identity };
        }
      }

      renameSync(projectConfigPath, backupPath);
      renameSync(stagedPath, projectConfigPath);
      return {
        kind: 'healed',
        config: freshDefault,
        backupPath,
        preimageIdentity: identity,
      };
    });
  } catch (error: unknown) {
    return { kind: 'failed', error, preimageIdentity };
  }
}


/**
 * Load and resolve the full configuration by merging defaults, global config,
 * and project-level config. Resolves mode aliases and validates the result.
 *
 * Results are cached at module level. Cache is invalidated when:
 * - `options.force` is true
 * - The project config file mtime has changed
 * - `DECKENT_CONFIG_RELOAD=1` environment variable is set
 * - A different `projectRoot` is requested
 *
 * @param projectRoot - Project root directory; defaults to process.cwd()
 * @param options - Optional: `{ force: true }` to bypass cache
 * @returns Fully resolved configuration ready for use
 * @throws {ConfigValidationError} When merged config fails validation or API key is missing
 */
/**
 * Synchronous, read-only projection for memory readers. Uses the same global and
 * project paths/precedence as loadConfig without config healing/default writes.
 * No cache: the caller binds these resolved view settings to its read snapshot.
 * Only memory_read and language are returned; this is not a policy/auth resolver.
 */
type MemoryReadConfigLayer = Pick<DeckentConfig, 'memory_read' | 'memory_read_profiles'>;

export const DEFAULT_MEMORY_READ_PROFILES = Object.freeze({
  worker: Object.freeze({ maxBytes: 131_072, maxLines: 512 }),
});

/**
 * Resolve raw authored layers before shared defaults obscure which limits were
 * explicit. A consumer default is never a floor that overrides an owner's cap.
 * Within shared limits and named overrides, project wins over global. Explicit
 * named overrides are most specific and win over the authored shared limits.
 */
export function resolveMemoryReadProfiles(
  ...layers: readonly (MemoryReadConfigLayer | null | undefined)[]
): Readonly<Record<MemoryReadConsumerV1, Readonly<MemoryReadLimitsV1>>> {
  let shared: Partial<MemoryReadLimitsV1> = {};
  const named: Partial<Record<MemoryReadConsumerV1, Partial<MemoryReadLimitsV1>>> = {};
  for (const layer of layers) {
    if (!layer) continue;
    if (layer.memory_read !== undefined) {
      validateMemoryReadLimitsPatch(layer.memory_read);
      shared = { ...shared, ...layer.memory_read };
    }
    const profiles = layer.memory_read_profiles;
    if (profiles === undefined) continue;
    if (profiles === null || Array.isArray(profiles) || typeof profiles !== 'object') {
      throw new TypeError('MEMORY_READ_PROFILES_INVALID');
    }
    for (const key of Object.keys(profiles)) {
      if (!(MEMORY_READ_CONSUMERS as readonly string[]).includes(key)) {
        throw new TypeError('MEMORY_READ_PROFILES_INVALID');
      }
      const consumer = key as MemoryReadConsumerV1;
      const profile = profiles[consumer];
      if (profile === undefined) throw new TypeError('MEMORY_READ_PROFILES_INVALID');
      validateMemoryReadLimitsPatch(profile);
      named[consumer] = { ...named[consumer], ...profile };
    }
  }
  return Object.freeze(Object.fromEntries(MEMORY_READ_CONSUMERS.map(consumer => [
    consumer,
    resolveMemoryReadLimits({
      ...(consumer === 'worker' ? DEFAULT_MEMORY_READ_PROFILES.worker : {}),
      ...shared,
      ...named[consumer],
    }),
  ])) as Record<MemoryReadConsumerV1, Readonly<MemoryReadLimitsV1>>);
}

/** Accepts raw or already-resolved config; resolved named profiles preserve provenance. */
export function resolveMemoryReadLimitsForConsumer(
  config: MemoryReadConfigLayer,
  consumer: MemoryReadConsumerV1,
): Readonly<MemoryReadLimitsV1> {
  return resolveMemoryReadProfiles(config)[consumer];
}

export function resolveMemoryReadConfig(projectRoot: string, consumer: MemoryReadConsumerV1 = 'planner'): Readonly<{
  memory_read: Readonly<MemoryReadLimitsV1>;
  language: string;
}> {
  let projected: Record<string, unknown> = {
    memory_read: { ...DEFAULT_MEMORY_READ_LIMITS },
    language: DEFAULT_LANGUAGE,
  };
  const layers: MemoryReadConfigLayer[] = [];
  for (const file of [resolveGlobalConfigReadPath(), join(resolve(projectRoot), PROJECT_CONFIG_PATH)]) {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw new Error('MEMORY_READ_CONFIG_UNAVAILABLE');
    }
    let layer: unknown;
    try {
      layer = JSON.parse(text);
    } catch {
      throw new Error('MEMORY_READ_CONFIG_UNAVAILABLE');
    }
    if (layer === null || Array.isArray(layer) || typeof layer !== 'object') {
      throw new Error('MEMORY_READ_CONFIG_UNAVAILABLE');
    }
    const values = layer as Record<string, unknown>;
    const selected = Object.fromEntries(['memory_read', 'memory_read_profiles', 'language']
      .filter(key => values[key] !== undefined)
      .map(key => [key, values[key]]));
    projected = deepMerge(projected, selected);
    layers.push(selected as MemoryReadConfigLayer);
  }
  if (typeof projected['language'] !== 'string'
    || !(SUPPORTED_LANGUAGES as readonly string[]).includes(projected['language'])) {
    throw new Error('MEMORY_READ_CONFIG_UNAVAILABLE');
  }
  return Object.freeze({
    memory_read: resolveMemoryReadProfiles(...layers)[consumer],
    language: projected['language'],
  });
}

export async function loadConfig(projectRoot?: string, options?: { force?: boolean }): Promise<ResolvedConfig> {
  const root = resolve(projectRoot ?? process.cwd());

  // ─── Cache check ────────────────────────────────────────────────────
  const forceReload = options?.force === true || process.env['DECKENT_CONFIG_RELOAD'] === '1';
  if (!forceReload && cachedConfig !== null && cachedProjectRoot === root) {
    const currentStamp = getConfigCacheStamp(root);
    if (currentStamp === cacheStamp) {
      metric('config.cache', 1, { result: 'hit' });
      return cachedConfig;
    }
  }

  let config = createDefaultConfig();
  let approvalLifecycle = resolveApprovalLifecycleLayer(null);

  const rawGlobalConfig = await readJsonFile<Partial<DeckentConfig>>(resolveGlobalConfigReadPath());
  let globalConfig: Partial<DeckentConfig> | null = null;
  if (rawGlobalConfig) {
    const { config: providerCanonicalGlobalConfig } = canonicalizeProviderConfigAliases(
      rawGlobalConfig as Record<string, unknown>,
      'global',
    );
    const { config: canonicalGlobalConfig } = canonicalizeModelConfigAliases(
      providerCanonicalGlobalConfig,
      'global',
    );
    globalConfig = canonicalGlobalConfig as Partial<DeckentConfig>;
    approvalLifecycle = resolveApprovalLifecycleLayer(globalConfig, approvalLifecycle);
    config = deepMerge(config, globalConfig);
  }

  const projectConfigPath = join(root, PROJECT_CONFIG_PATH);

  let projectConfig = await readJsonFile<Partial<DeckentConfig>>(projectConfigPath);

  // Self-healing: if readJsonFile returned null but the file exists on disk,
  // it means the JSON is corrupted. Backup + fresh default.
  // 2026-08-25 incident hardening: a concurrent non-atomic writer made a VALID
  // config read as half-written once, and this healer then moved the intact
  // file aside and lost it in the write race. Re-read once after a short beat —
  // a genuinely corrupted file stays corrupted; a mid-write file heals itself.
  if (projectConfig === null && existsSync(projectConfigPath)) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    projectConfig = await readJsonFile<Partial<DeckentConfig>>(projectConfigPath);
  }
  // Strike-5 hardening (2026-08-25 night incident, owner-directed): readJsonFile
  // returns null for BOTH parse failures and transient io failures (EMFILE-class
  // fd pressure under a running full suite destroyed a healthy 92-key config
  // twice tonight). Only a file that EXISTS, READS, and still FAILS TO PARSE is
  // corrupted; an unreadable file is left untouched with a typed warning — a
  // quarantine there loses data it never inspected.
  if (projectConfig === null && existsSync(projectConfigPath)) {
    let rawText: string | null = null;
    let parseCorrupt = false;
    try {
      rawText = readFileSync(projectConfigPath, 'utf-8');
    } catch (ioErr) {
      console.error(
        `[deckent] CONFIG_READ_IO_HOLD: config okunamadı (geçici io hatası — dosyaya DOKUNULMADI): `
        + `${ioErr instanceof Error ? ioErr.message : String(ioErr)}. Defaults ile devam ediliyor; `
        + `dosya diskte duruyor, bir sonraki yükleme yeniden dener.`,
      );
    }
    if (rawText !== null) {
      try {
        projectConfig = JSON.parse(rawText) as Partial<DeckentConfig>;
        // Parses now → the earlier nulls were transient; the file is healthy.
      } catch {
        parseCorrupt = true; // exists + reads + does not parse = real corruption
      }
    }
    if (parseCorrupt) {
      const healResult = healCorruptProjectConfig(projectConfigPath, rawText!);
      if (healResult.kind === 'healed') {
        console.error(
          `[deckent] Config dosyanız bozulmuştu, yedeklendi: ${healResult.backupPath}\n` +
          `Defaults ile devam ediliyor. Düzeltme için: deckent config read`,
        );
        projectConfig = healResult.config;
      } else if (healResult.kind === 'heldConcurrentRevision') {
        projectConfig = healResult.adoptedConfig ?? null;
      } else {
        console.error(
          `[deckent] Config recovery failed: ${healResult.error instanceof Error
            ? healResult.error.message
            : String(healResult.error)}`,
        );
      }
    }
  }

  if (projectConfig) {
    const rawProjectConfig = projectConfig as Record<string, unknown>;
    const providerCanonicalization = canonicalizeProviderConfigAliases(rawProjectConfig, 'project');
    const modelCanonicalization = canonicalizeModelConfigAliases(providerCanonicalization.config, 'project');
    projectConfig = modelCanonicalization.config as Partial<DeckentConfig>;
    approvalLifecycle = resolveApprovalLifecycleLayer(projectConfig, approvalLifecycle);

    // Preserve the unrelated spawn_backend/claude_backend compatibility rule.
    removeDuplicateKeys(projectConfig as Record<string, unknown>);

    config = deepMerge(config, projectConfig);

    // Compatibility aliases must be persisted, not repeatedly normalized only
    // in memory. Provider conflicts have already failed above and are never
    // swallowed by the legacy non-fatal migration path.
    if (
      existsSync(projectConfigPath)
      && (providerCanonicalization.changes.length > 0 || modelCanonicalization.changes.length > 0 || needsMigration(rawProjectConfig))
    ) {
      try {
        migrateConfig(projectConfigPath);
      } catch {
        // Non-fatal: migration failure should not block config load
      }
    }
  }

  try {
    assertProviderLimitPolicyLayerPrecedence(
      globalConfig?.provider_limits,
      projectConfig?.provider_limits,
    );
  } catch (error) {
    throw new ConfigValidationError([
      error instanceof Error ? error.message : String(error),
    ]);
  }

  // Resolve legacy mode aliases so 'max_plan' → 'performance' etc.
  config.mode = resolveMode(config.mode) as PlanMode;

  // V3 cut-over: old v1/v2 labels both point at retired implementations.
  // Upgrade them before validation; migrateConfig persists the same projection.
  if (['v1', 'v2'].includes((config as { routing_engine?: string }).routing_engine ?? '')) {
    (config as { routing_engine?: string }).routing_engine = 'v3';
  }

  // ─── Grouped providers → flat provider fields ──────────────────────
  // Runtime-only projection. Must run BEFORE env var overrides so env vars win.
  // (Sprint 150 Decision 4 — grouped `providers` is canonical in JSON; flat
  //  fields stay available at runtime for backward compatibility.)
  projectCanonicalProviderFields(config);

  // ─── Env var overrides ─────────────────────────────────────────────
  // Env vars override grouped→flat projection above.
  const envBrainProvider = process.env['DECKENT_BRAIN_PROVIDER'];
  if (envBrainProvider) {
    config.brain_provider = envBrainProvider as ProviderName;
  }
  const envWorkerProvider = process.env['DECKENT_WORKER_PROVIDER'];
  if (envWorkerProvider) {
    config.worker_provider = envWorkerProvider as ProviderName;
  }
  const envMode = process.env['DECKENT_MODE'];
  if (envMode) {
    config.mode = resolveMode(envMode) as PlanMode;
  }
  const envLanguage = process.env['DECKENT_LANGUAGE'] || process.env['DECKENT_LANG'];
  if (envLanguage) {
    config.language = envLanguage;
  }
  const envDeckentStyle = process.env['DECKENT_STYLE'];
  if (envDeckentStyle) {
    config.deckent_style = envDeckentStyle as 'sprint' | 'task' | 'process';
  }

  // ─── Mode preset → model_strategy merge ────────────────────────────
  // Start from the mode preset (if any), then overlay user config overrides
  const preset = MODE_PRESETS[config.mode];
  let resolvedModelStrategy: ModelStrategy | undefined;
  if (preset) {
    resolvedModelStrategy = { ...preset.model_strategy };
    if (config.model_strategy) {
      Object.assign(resolvedModelStrategy, config.model_strategy);
    }
  } else if (config.model_strategy) {
    // Custom mode with explicit model_strategy — fill defaults from 'balanced'
    const fallbackPreset = MODE_PRESETS['balanced'];
    if (fallbackPreset) {
      resolvedModelStrategy = { ...fallbackPreset.model_strategy, ...config.model_strategy };
    }
  }

  // ─── haiku_allowed backward compat → min_tier ─────────────────────
  // If min_tier is already set (via model_strategy), it takes precedence.
  // Otherwise, derive from haiku_allowed for backward compatibility.
  for (const modeName of Object.keys(config.modes)) {
    const mc = config.modes[modeName];
    if (mc && mc.min_tier === undefined && mc.haiku_allowed === false) {
      mc.min_tier = 'standard';
    }
  }

  validateConfig(config);

  // Mode is validated above — activeModeConfig is guaranteed to exist
  const activeModeConfig = (config.modes[config.mode] ?? config.modes['performance']) as PlanModeConfig;

  if (config.mode === 'api' && activeModeConfig.requires) {
    const envVar = activeModeConfig.requires;
    if (!process.env[envVar]) {
      throw new ConfigValidationError([
        `API mode requires environment variable "${envVar}" to be set`,
      ]);
    }
  }

  const resolved: ResolvedConfigWithThrottle & ResolvedConfigWithChatProvider & ResolvedConfigWithMaxWorkers = {
    mode: config.mode,
    activeModeConfig,
    modes: config.modes,
    language: config.language ?? DEFAULT_LANGUAGE,
    projectName: config.projectName ?? 'deckent-project',
    projectRoot: root,
    version: config.version ?? DECKENT_VERSION,
    // Sprint 319 (B-MAXWORKERS-WIRE): carry the top-level explicit worker-count
    // override into the resolved config so resolveEffectiveWorkers can honor it.
    // Absent → undefined → prior activeModeConfig/preset behavior is preserved.
    max_workers: (config as DeckentConfigWithMaxWorkers).max_workers,
    // Task 429-006 (PLNR1): carry the top-level explicit brain_planning override
    // through so resolveBrainPlanningMode can honor it. Absent → undefined →
    // prior activeModeConfig/preset behavior is preserved.
    brain_planning: config.brain_planning,
    model_strategy: resolvedModelStrategy,
    auto_docs: config.auto_docs ?? { ...DEFAULT_AUTO_DOCS },
    spawn_backend: config.spawn_backend,
    auth_mode: config.auth_mode,
    docker_image: config.docker_image,
    docker_timeout: config.docker_timeout,
    worker_memory_limit_by_kind: config.worker_memory_limit_by_kind,
    worker_memory_limit: config.worker_memory_limit,
    worker_home_tmpfs_size: config.worker_home_tmpfs_size, // WORKER-ENV-TMPFS-001 carry
    worker_memory_swap: config.worker_memory_swap,
    skills: config.skills,
    brain_provider: config.brain_provider,
    worker_provider: config.worker_provider,
    fallback_provider: config.fallback_provider,
    provider_overrides: config.provider_overrides,
    // F1-012 — carry grouped `providers` (incl. config-driven `registry`) so
    // bootstrapProviders can register config-declared providers. Routing fields
    // are already flattened above; this preserves `registry` for the registry loop.
    providers: config.providers,
    // FAZ-1 local-llm lifecycle command — preserve the owner-authored launch
    // authority through the resolved config boundary instead of stripping it.
    local_llm: config.local_llm,
    // Sprint 220 Task 220-001 — optional native REPL provider override.
    chat_provider: (config as DeckentConfigWithChatProvider).chat_provider,
    // Native transport + BOT-1 bot-agent — pass through so loadConfig does not
    // strip them (the REPL native agent + bot-agent read these from config).
    ollama_host: config.ollama_host,
    native_provider: config.native_provider,
    native_model: config.native_model,
    native_context_tokens: config.native_context_tokens,
    openai_base_url: config.openai_base_url,
    bot_agent: config.bot_agent,
    // Memory
    memory_budget: config.memory_budget,
    decay_after_sprints: config.decay_after_sprints,
    patterns_enabled: config.patterns_enabled,
    project_identity_enabled: config.project_identity_enabled,
    memory_export: config.memory_export,
    memory_read: resolveMemoryReadLimits(config.memory_read),
    memory_read_profiles: resolveMemoryReadProfiles(globalConfig, projectConfig),
    // Auditor
    scan_interval: config.scan_interval,
    heartbeat_timeout: config.heartbeat_timeout,
    boundary_enforcement: config.boundary_enforcement,
    lock_stale_threshold: config.lock_stale_threshold,
    // Human Checkpoints
    human_checkpoints: config.human_checkpoints,
    // Sprint
    retry_transient_failures: config.retry_transient_failures,
    fix_phase_enabled: config.fix_phase_enabled,
    max_fix_retries: config.max_fix_retries,
    fix_circuit_breaker: config.fix_circuit_breaker,
    lifecycle_recovery: config.lifecycle_recovery,
    // Sprint 179 W2-4: coverage gate split.
    // - hard_floor (default 50) is the immutable EVALUATE gate.
    // - aspirational (default 90) is auto-learned by the finalizer.
    // - legacy `coverage_threshold` seeds aspirational when set explicitly.
    // Resolve from the raw user partials so user-supplied legacy
    // `coverage_threshold` is honored over the default aspirational of 90
    // pre-populated by `createDefaultConfig`.
    ...resolveCoverageGates({
      ...(rawGlobalConfig ?? {}),
      ...(projectConfig ?? {}),
    }),
    max_reroutes: config.max_reroutes ?? 3,
    reroute_on_tech_debt: config.reroute_on_tech_debt ?? false,
    sprint_timeout_minutes: config.sprint_timeout_minutes ?? 0,
    // Adaptive Thresholds
    adaptive_thresholds: config.adaptive_thresholds ?? false,
    agent_min_score: config.agent_min_score ?? 5,
    adaptive_config: config.adaptive_config ?? { min_samples: 3, no_go_threshold: 0.3, coverage_lookback: 3 },
    // Rollback
    rollback_policy: config.rollback_policy,
    // Rubric-Based Evaluation
    evaluation_rubric: config.evaluation_rubric,
    rubric_max_retries: config.rubric_max_retries,
    acceptance_matrix: config.acceptance_matrix,
    acceptance_enforcement: config.acceptance_enforcement,
    // Routing Engine v3
    routing_engine: config.routing_engine,
    routing_config: config.routing_config,
    routing: config.routing,
    // Cleanup delay
    cleanup_delay_ms: config.cleanup_delay_ms,
    // Dependency pipeline (Sprint 156: default true; user/project config can override)
    dependency_pipeline_enabled: config.dependency_pipeline_enabled ?? true,
    // Debt pre-flight revalidation (Dogfood-449 B5: default true; fail-open design)
    debt_preflight_enabled: config.debt_preflight_enabled ?? true,
    // Pre-sprint full-vitest baseline (Sprint 255: default FALSE — the full suite
    // blocks sprint start; opt-in only). Speeds sprint start dramatically.
    pre_sprint_tests: config.pre_sprint_tests ?? false,
    // Strict multi-tenant isolation (Sprint 261 ENT-2: default FALSE — backward-compat
    // permissive mode includes NULL-tenant rows). Set true to close NULL-tenant leak.
    strict_tenant_isolation: config.strict_tenant_isolation ?? false,
    // PRINCIPAL-001 P1d — identity-assurance hard-gate carry (default FALSE).
    // resolveConfig carries fields EXPLICITLY: a key that only exists in
    // config-types never reaches runtime. P1b added the type and the seam but
    // not this line, so the enforce branch was unreachable in every real run
    // (measured: loadConfig dropped the key). Default-off keeps v1 behaviour.
    enforce_principal_assurance: config.enforce_principal_assurance ?? false,
    // AI planner timeout
    ai_planner_timeout: config.ai_planner_timeout,
    // Sprint checkpoint interval
    sprint_checkpoint_interval: config.sprint_checkpoint_interval,
    // Sprint 202 Task 202-004 — pre-spawn pacing (computeBackoff wire).
    token_throttle_ms:
      (config as DeckentConfigWithThrottle).token_throttle_ms ?? 500,
    // Timeout
    timeout: config.timeout
      ? deepMerge(DEFAULT_TIMEOUT_CONFIG, config.timeout as Partial<TimeoutConfig>)
      : structuredClone(DEFAULT_TIMEOUT_CONFIG),
    // Nervous System — passed through from project config
    nervous_system: config.nervous_system,
    // Autonomous Engine — passed through from project config
    autonomous: config.autonomous,
    // Resource Monitor — passed through from project config (opt-in, absent = disabled)
    resource_monitor: config.resource_monitor,
    runtime_artifact_retention: resolveRuntimeArtifactRetention(config),
    // Worker Comms — passed through (opt-in, absent = disabled)
    worker_comms: config.worker_comms,
    // Cost Guard — passed through (opt-in, absent = disabled)
    cost_guard: config.cost_guard,
    // Routing Engine v3 (445 Slice-0) — resolved to the full defaulted+validated
    // shape (config already carries the merged overrides, passed as the project
    // layer; defaults live solely in routing3/config.ts).
    routing_v3: resolveRoutingV3Config(null, config),
    // Scheduler shadow-reducer (SCHED4) — passed through (opt-in, absent = disabled)
    scheduler: config.scheduler,
    // Gate — passed through (opt-in, default-off)
    gate: config.gate,
    evaluation: {
      tsc_settlement_gate: config.evaluation?.tsc_settlement_gate ?? true,
    },
    // Approval — validated + defaulted via resolveApprovalConfig (Sprint 355 CFG-APR-WIRE)
    approval: resolveApprovalConfig(config),
    api_oidc: config.api_oidc,
    // ERP connector — passed through (opt-in, absent = disabled; secret-free)
    erp: config.erp,
    // Plan config (Sprint 276 PLAN-INT-1) — passed through (opt-in, absent = disabled)
    plan: config.plan,
    // born-464 (Alperen live-test 2026-07-02): the five overnight opt-in flag
    // blocks were declared on the type but never passed through in EITHER
    // resolver (this one nor mergeConfigs) — on the live path every flag
    // silently resolved to undefined (off) no matter what the user set.
    // W1-EXPERIENCE-ON (#492, Alperen 2026-07-06): the terminal experience layer
    // (live footer, mode indicator, approval card) ships ON by default — months
    // of UX stayed invisible behind absent config blocks (user-truth-audit §2).
    // An explicit { enabled: false } still turns it off (opt-out, not opt-in).
    repl_surface: config.repl_surface ?? { enabled: true, approvals: true },
    // TOOL-QB-FLIP (376-001, continuing #492's default-flip package): the
    // progressive-disclosure meta-tool surface ships ON by default too — same
    // opt-out rationale as repl_surface above (explicit { enabled: false } still
    // disables it).
    // born-607 P1 (advisor): FIELD-level default — a partial block like
    // `{ riskThreshold: 'safe' }` must not silently disable the default-ON surface.
    // born-612 (405-002 + CC son-mil): plugin-security bloğu passthrough (born-464 üçlüsü).
    plugins: config.plugins,
    tool_surface: { ...(config.tool_surface ?? {}), enabled: config.tool_surface?.enabled ?? true },
    deck_broker: config.deck_broker,
    // ROLE-AWARE-PROVIDER-FALLBACK (row 607): declared on DeckentConfig +
    // ResolvedConfig but never wired here — the born-464 shape, caught by
    // `config-flag-roundtrip.test.ts`'s type-vs-live parity guard. Same
    // twin-literal rule as `openrouter` below applies.
    provider_fallback: config.provider_fallback,
    execution_budget: config.execution_budget,
    // Authored input only. The production authority must resolve the separately
    // loaded parent/project layers through provider-limit-policy.ts.
    provider_limits: config.provider_limits,
    persona_integrity: {
      min_bytes: config.persona_integrity?.min_bytes ?? DEFAULT_PERSONA_INTEGRITY_MIN_BYTES,
    },
    provider_limit_authority: createProviderLimitPolicyAuthoritySnapshot({
      parent: globalConfig?.provider_limits,
      project: projectConfig?.provider_limits,
    }),
    // XVERIFY-TOOL (S1): cross_verify was a pinned born-464 gap since 358-014 —
    // declared on both config types, never passed through, so `runCrossVerify`'s
    // `enabled !== true` guard could NEVER pass from a real config file and the
    // whole adversarial-verification feature was config-unreachable. Wired now
    // because the xverify advisory tool builds on it. Absent block → undefined →
    // disabled (behavior unchanged for every existing config).
    cross_verify: config.cross_verify,
    // OPENROUTER-PROVIDER (row 477): opt-in flag passthrough. Absent → undefined
    // → `bootstrapProviders` skips registration entirely (default-OFF preserved).
    // The `loadConfig` / `mergeConfigs` resolved-config literals are hand-synced
    // TWINS — this field must appear in BOTH. Dropping either reintroduces
    // born-464 (declared on the type, silently undefined on the live path).
    openrouter: config.openrouter,
    training_trace: config.training_trace,
    live_trace: config.live_trace,
    mcp_client_enabled: config.mcp_client_enabled,
    // Sprint 369-005/008 follow-up (born-464 pattern): TOOL-CU + V1-strict-report
    // flag blocks — declared on the type in 369, wired here by CC hand-fix.
    computer_use: config.computer_use,
    worker_output_contract: config.worker_output_contract,
    // Tool allowlist (born-674, W674B 428-002) — task-based worker tool-surface
    // reduction. Opt-in, default-off: absent block ⇒ buildWorkerPrompt's
    // toolAllowlist stays undefined, full default tool surface (pre-674 bit-exact).
    tools: config.tools,
    // Messaging connectors (BOT-001) — passed through; tokens .deck-interpolated below.
    notify_connectors: (config as DeckentConfig).notify_connectors,
    approval_channels: config.approval_channels,
    notify_on_complete: (config as DeckentConfig).notify_on_complete,
    // Bot-daemon durable owner-notification outbox drain cadence (671-001) — passed through.
    notify_outbox_drain_interval_ms: (config as DeckentConfig).notify_outbox_drain_interval_ms,
    // Bot capabilities config — passed through (opt-in, default-off).
    bot_capabilities: (config as DeckentConfig).bot_capabilities,
    // Per-user identity↔RBAC config (ADR-092) — passed through (opt-in, default-off).
    identity: (config as DeckentConfig).identity,
    // Runtime Style
    deckent_style: config.deckent_style ?? 'sprint',
    // Terminal (Sprint 175) — deepMerge'd `config` already carries defaults from
    // createDefaultConfig(); fallback is defensive for hot-reload scenarios.
    terminal: config.terminal
      ? deepMerge(DEFAULT_TERMINAL_CONFIG, config.terminal as Partial<TerminalConfig>)
      : structuredClone(DEFAULT_TERMINAL_CONFIG),
    // Prompt tuning (Sprint 182 PQ-5 / F7) — mirrors the terminal pattern: user
    // override deep-merged over DEFAULT_PROMPT_CONFIG so unspecified fields keep
    // their defaults. Always populated so prompt-god-template consumers can rely
    // on `resolved.prompt.adr_min_relevance` being defined.
    prompt: config.prompt
      ? deepMerge(DEFAULT_PROMPT_CONFIG, config.prompt as Partial<PromptConfig>)
      : structuredClone(DEFAULT_PROMPT_CONFIG),
  };

  // ─── $DECK: interpolation ────────────────────────────────────────────
  // Sprint 202 Task 202-004: interpolation walks the object preserving all
  // numeric fields, so `token_throttle_ms` survives. Cast to the wider type
  // so callers (via `getTokenThrottleMs`) can read it without losing the
  // attached field on the cached object.
  const interpolated = interpolateConfig(resolved, root) as ResolvedConfigWithThrottle & ResolvedConfigWithChatProvider;
  if (interpolated.token_throttle_ms === undefined) {
    interpolated.token_throttle_ms = resolved.token_throttle_ms;
  }
  // Sprint 220 Task 220-001 — preserve chat_provider through interpolation.
  if (interpolated.chat_provider === undefined) {
    interpolated.chat_provider = resolved.chat_provider;
  }
  // Authority provenance is not an interpolated user-value surface. Preserve
  // the canonical deeply frozen object; the generic interpolation clone would
  // otherwise silently turn it back into mutable last-wins data.
  interpolated.provider_limit_authority = resolved.provider_limit_authority;

  // ─── Update cache ───────────────────────────────────────────────────
  cachedConfig = interpolated;
  cacheStamp = getConfigCacheStamp(root);
  cachedProjectRoot = root;

  metric('config.cache', 1, { result: 'miss' });
  return interpolated;
}

/**
 * Read the auth_mode from the merged (global + project) config without full validation.
 * Returns 'subscription' when the config file is missing or auth_mode is not set.
 * @param projectRoot - Project root directory; defaults to process.cwd()
 */
export async function readAuthMode(
  projectRoot?: string,
): Promise<'subscription' | 'api' | 'hybrid'> {
  const root = resolve(projectRoot ?? process.cwd());

  let authMode: 'subscription' | 'api' | 'hybrid' = 'subscription';

  const globalConfig = await readJsonFile<Partial<DeckentConfig>>(resolveGlobalConfigReadPath());
  if (globalConfig?.auth_mode) {
    authMode = globalConfig.auth_mode;
  }

  const projectConfigPath = join(root, PROJECT_CONFIG_PATH);
  const projectConfig = await readJsonFile<Partial<DeckentConfig>>(projectConfigPath);
  if (projectConfig?.auth_mode) {
    authMode = projectConfig.auth_mode;
  }

  return authMode;
}

/**
 * Validate a partial config by merging it over defaults and running full validation.
 * Useful for checking user-provided overrides before persisting.
 * @param partial - Partial configuration to validate
 * @throws {ConfigValidationError} When the merged result fails validation
 */
export function validatePartialConfig(partial: Partial<DeckentConfig>): void {
  // CFG-1: normalize a legacy `mode` alias (e.g. pro_plan → economic) IN PLACE
  // before validation, mirroring the read path (loadConfig → resolveMode at the
  // top of mergeConfigs). VALID_MODES intentionally lists only canonical names,
  // so a legacy `mode` left on disk would otherwise make validateConfig reject
  // EVERY `config set <unrelated-key>` write. Normalizing here both unblocks the
  // write AND persists the canonical value, because callers (config set / import
  // / MCP set) write the SAME object back to disk after this returns. Canonical
  // and unknown values pass through unchanged (resolveMode is a no-op for them).
  if (typeof partial.mode === 'string') {
    const canonical = resolveMode(partial.mode);
    if (canonical !== partial.mode) {
      partial.mode = canonical as PlanMode;
    }
  }
  // ROUTE-V1-PURGE (ADR-G-006): same legacy-normalize for routing_engine — a
  // stale on-disk 'v1' must not reject an unrelated `config set` write.
  if (['v1', 'v2'].includes((partial as { routing_engine?: string }).routing_engine ?? '')) {
    (partial as { routing_engine?: string }).routing_engine = 'v3';
  }
  const merged = deepMerge(createDefaultConfig(), partial);
  validateConfig(merged);
}

// ─── Global Config ───────────────────────────────────────────────────

/**
 * Load a global config file (partial DeckentConfig).
 * Returns null when the file does not exist or contains malformed JSON.
 * Default `configPath` is dual-read (M1): platform-correct path, falling
 * back to the legacy `~/.deckent/config.json` — see
 * {@link resolveGlobalConfigReadPath}.
 */
export async function loadGlobalConfig(
  configPath?: string,
): Promise<Partial<DeckentConfig> | null> {
  const cfgPath = configPath ?? resolveGlobalConfigReadPath();
  return readJsonFile<Partial<DeckentConfig>>(cfgPath);
}

/**
 * Save a partial config to the global config path.
 * Creates parent directories if needed.
 */
export async function saveGlobalConfig(
  config: Partial<DeckentConfig>,
  configPath?: string,
): Promise<void> {
  const cfgPath = configPath ?? GLOBAL_CONFIG_PATH;
  const dir = dirname(cfgPath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  withConfigWriteLock(cfgPath, () => writeConfigJsonAtomic(cfgPath, config));
}

// ─── Config Regen Guard ──────────────────────────────────────────────

/**
 * Safe template defaults applied when regenerating a project config.
 * These represent deckent-dev project settings that must be preserved
 * even if the config file is lost or regenerated from scratch.
 *
 * Sprint 177 — Sprint 176 evidence: `git rm --cached` + regen caused the
 * template to overwrite all user fields including spawn_backend.
 */
export const REGEN_TEMPLATE_DEFAULTS: Record<string, unknown> = {
  spawn_backend: 'docker',
  dependency_pipeline_enabled: false,
  haiku_allowed: false,
  brain_planning: 'structured',
} as const;

export interface RegenConfigResult {
  /** Absolute path of the backup file created before regen */
  backupPath: string;
  /** The merged config written back to disk */
  merged: Record<string, unknown>;
  /** Keys that were missing from the existing config and were added from template */
  added: string[];
}

/**
 * Safely regenerate the project config by merging the existing config OVER the
 * template defaults. User fields are never overwritten — only missing fields are
 * filled from the template. A timestamped backup is created before any write.
 *
 * Sprint 176 root cause: `deckent init` regenerated from template, overwriting
 * all user fields. This function prevents that by always treating existing
 * config as the higher-priority source.
 *
 * @param projectRoot — project root directory; defaults to process.cwd()
 * @returns RegenConfigResult with backupPath, merged config, and added keys
 */
export function regenerateConfigSafe(projectRoot?: string): RegenConfigResult {
  const root = resolve(projectRoot ?? process.cwd());
  const configPath = join(root, PROJECT_CONFIG_PATH);

  return withConfigWriteLock(configPath, () => {
    let existingConfig: Record<string, unknown> = {};

    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw) as unknown;
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          existingConfig = parsed as Record<string, unknown>;
        }
      } catch {
        // Unparseable config — treat as empty, template fills in all fields
      }

      const iso = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
      const backupPath = `${configPath}.bak.regen-${iso}`;
      copyFileSync(configPath, backupPath);

      const added = Object.keys(REGEN_TEMPLATE_DEFAULTS).filter(
        (k) => !(k in existingConfig),
      );

      // Template is the base; existing config overlays it — user fields always win
      const merged = deepMerge(
        REGEN_TEMPLATE_DEFAULTS as Record<string, unknown>,
        existingConfig,
      ) as Record<string, unknown>;

      writeConfigJsonAtomic(configPath, merged);

      return { backupPath, merged, added };
    }

    // Config file does not exist — write template defaults as the new config.
    // Atomic publication throws naturally if the parent directory is missing.
    const deckentDir = join(root, '.deckent');
    if (!existsSync(deckentDir)) {
      // Preserve the existing missing-parent failure behavior.
    }

    const merged = structuredClone(REGEN_TEMPLATE_DEFAULTS) as Record<string, unknown>;
    const iso = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
    const backupPath = `${configPath}.bak.regen-${iso}`;

    writeConfigJsonAtomic(configPath, merged);

    return { backupPath, merged, added: Object.keys(REGEN_TEMPLATE_DEFAULTS) };
  });
}

// ─── Config Metadata ─────────────────────────────────────────────────

/** Metadata descriptor for a single config parameter. */
export interface ConfigMetadataEntry {
  description: string;
  /** Turkish description for localized config-reference consumers. */
  descriptionTr?: string;
  type: string;
  default: unknown;
  options?: string[];
  category: string;
  required?: boolean;
}

/**
 * Metadata for every top-level DeckentConfig key.
 * Consumed by `getConfigHelp`, `listConfigByCategory`, and `generateConfigReference`.
 */
// TERMINAL-PROVIDER-VOCAB-001 — the provider option lists and their type
// strings derive from the validation authority (VALID_PROVIDERS_ALL /
// NATIVE_PROVIDER_NAMES); a literal list here drifted narrower than the
// values validation accepts (KANUN 10: one source).
const PROVIDER_TYPE_UNION = VALID_PROVIDERS_ALL.map((p) => `'${p}'`).join(' | ');
const NATIVE_PROVIDER_TYPE_UNION = NATIVE_PROVIDER_NAMES.map((p) => `'${p}'`).join(' | ');

export const CONFIG_METADATA: Readonly<Record<string, ConfigMetadataEntry>> = {
  native_provider: {
    description: 'Native transport the Terminal binds at boot (the /provider picker\'s "save as default" writes it). Only transports with a native tool-use adapter are valid.',
    descriptionTr: 'Terminal\'in açılışta bağlandığı native taşıma (/provider seçicisinin "varsayılan yap" adımı bunu yazar). Yalnız native araç-kullanım adaptörü olan taşımalar geçerlidir.',
    type: `${NATIVE_PROVIDER_TYPE_UNION} | undefined`,
    default: undefined,
    options: [...NATIVE_PROVIDER_NAMES],
    category: 'Provider',
  },
  'prompt.codex_core_channel': {
    description: 'Enable the Codex-owned core prompt channel after an owner-approved canary default decision.',
    descriptionTr: 'Owner onaylı canary default kararından sonra Codex-owned core prompt kanalını etkinleştirir.',
    type: 'boolean',
    default: DEFAULT_PROMPT_CONFIG.codex_core_channel,
    options: ['true', 'false'],
    category: 'Prompt',
  },
  'prompt.codex_suppress_project_doc': {
    description: 'Suppress Codex project-document loading after an owner-approved canary default decision.',
    descriptionTr: 'Owner onaylı canary default kararından sonra Codex project-document yüklemesini baskılar.',
    type: 'boolean',
    default: DEFAULT_PROMPT_CONFIG.codex_suppress_project_doc,
    options: ['true', 'false'],
    category: 'Prompt',
  },
  'prompt.canary_cost_authority': {
    description: 'Usage canary cost-authority policy: auto settles fully-unpriced subscription arms on token totals; provider-usd-strict holds without full provider USD.',
    descriptionTr: 'Usage canary maliyet-otoritesi politikası: auto tamamen fiyatsız abonelik kollarını token toplamıyla karara bağlar; provider-usd-strict tam provider USD olmadan HOLD verir.',
    type: "'auto' | 'provider-usd-strict'",
    default: DEFAULT_PROMPT_CONFIG.canary_cost_authority,
    options: ['auto', 'provider-usd-strict'],
    category: 'Prompt',
  },
  'prompt.catalog_mount_mask': {
    description: 'Mask repository design catalogs inside Docker workers with empty read-only mounts.',
    descriptionTr: 'Repository tasarım kataloglarını Docker worker’larında boş ve salt okunur mount’larla maskeler.',
    type: 'boolean',
    default: DEFAULT_PROMPT_CONFIG.catalog_mount_mask,
    options: ['true', 'false'],
    category: 'Prompt',
  },
  // TERMINAL-POSTURE-001 (owner decision 2026-09-03) — the Ask/Run/Control
  // posture a Terminal session starts in. Absent-by-default in
  // DEFAULT_TERMINAL_CONFIG (its key-shape is pinned); the REPL resolves the
  // default (`run`) at boot via term-mode.ts resolveConfiguredPosture.
  'terminal.posture': {
    description: 'Authority posture a Terminal session starts in: ask (read-only), run (reads, edits, execution) or control (everything incl. autonomous actions).',
    descriptionTr: 'Terminal oturumunun başladığı yetki duruşu: ask (salt-okunur), run (okuma, düzenleme, çalıştırma) veya control (otonom eylemler dahil her şey).',
    type: "'ask' | 'run' | 'control'",
    default: 'run',
    options: ['ask', 'run', 'control'],
    category: 'Terminal',
  },
  // TERMINAL-READABILITY-002 — OSC 8 hyperlinks: auto (only on a host proven
  // to render them: VS Code/Cursor, iTerm2, WezTerm, Ghostty, kitty, Windows
  // Terminal, VTE ≥ 0.50, Konsole; never through a multiplexer), on, off.
  'terminal.links': {
    description: 'Clickable OSC 8 hyperlinks in Terminal replies: auto (only where the host terminal is proven to render them), on, or off (URLs stay visible as text either way).',
    descriptionTr: 'Terminal cevaplarında tıklanabilir OSC 8 bağlantılar: auto (yalnız host terminalin bunları çizdiği kanıtlıysa), on veya off (URL metni her durumda görünür kalır).',
    type: "'auto' | 'on' | 'off'",
    default: 'auto',
    options: ['auto', 'on', 'off'],
    category: 'Terminal',
  },
  mode: {
    description: 'Active plan mode — controls worker count and model tier.',
    type: "'performance' | 'balanced' | 'economic' | 'api'",
    default: 'balanced',
    options: ['performance', 'balanced', 'economic', 'api'],
    category: 'Sprint',
    required: true,
  },
  modes: {
    description: 'Per-mode configuration overrides (worker count, model, budget).',
    type: 'Record<PlanMode, PlanModeConfig>',
    default: null,
    category: 'Sprint',
  },
  spawn_backend: {
    description: "Worker spawn mechanism: 'docker' (isolated), 'tmux' (interactive), 'subprocess' (headless), 'auto'.",
    type: "'docker' | 'tmux' | 'subprocess' | 'auto'",
    default: undefined,
    options: ['docker', 'tmux', 'subprocess', 'auto'],
    category: 'Sprint',
  },
  docker_timeout: {
    description: 'Docker container timeout in seconds. Workers killed after this duration.',
    type: 'number',
    default: 1200,
    category: 'Sprint',
  },
  worker_memory_limit_by_kind: {
    description: 'Opt-in per-kind Docker memory limits. Keys are canonical TaskKind values. Swap is auto-derived at limit × 1.5.',
    type: 'Record<string, string>',
    default: undefined,
    category: 'Sprint',
  },
  worker_memory_limit: {
    description: 'Default per-worker Docker memory limit (docker --memory), e.g. "2g". Falls back to 4g when unset.',
    type: 'string',
    default: undefined,
    category: 'Sprint',
  },
  worker_memory_swap: {
    description: 'Per-worker Docker swap ceiling (docker --memory-swap). Unset derives limit × 1.5; must be >= worker_memory_limit.',
    type: 'string',
    default: undefined,
    category: 'Sprint',
  },
  brain_provider: {
    description: 'AI provider used for the Brain orchestrator (planning and evaluation).',
    type: PROVIDER_TYPE_UNION,
    default: 'claude',
    options: [...VALID_PROVIDERS_ALL],
    category: 'Provider',
  },
  chat_provider: {
    description: 'Native REPL provider override (deckent argümansız). Fallback chain: chat_provider → brain_provider → claude. Set independently from brain_provider to decouple planner from REPL (e.g. brain=opus, repl=ollama).',
    type: `${PROVIDER_TYPE_UNION} | undefined`,
    default: undefined,
    options: [...VALID_PROVIDERS_ALL],
    category: 'Provider',
  },
  worker_provider: {
    description: 'Default AI provider for worker agents executing tasks.',
    type: PROVIDER_TYPE_UNION,
    default: 'claude',
    options: [...VALID_PROVIDERS_ALL],
    category: 'Provider',
  },
  fallback_provider: {
    description: 'Provider to use when the primary provider is unavailable.',
    type: `${PROVIDER_TYPE_UNION} | undefined`,
    default: undefined,
    options: [...VALID_PROVIDERS_ALL],
    category: 'Provider',
  },
  provider_overrides: {
    description: 'Per-task-type provider overrides, keyed by task type.',
    type: 'Record<string, ProviderName> | undefined',
    default: undefined,
    category: 'Provider',
  },
  cost_optimization: {
    description: 'Automatically select the cheapest capable provider for each task.',
    type: 'boolean',
    default: false,
    options: ['true', 'false'],
    category: 'Provider',
  },
  claude_backend: {
    description: "Claude execution backend: 'tmux' (default), 'subprocess' (headless/CI), 'mcp' (future).",
    type: "'tmux' | 'subprocess' | 'mcp'",
    default: 'tmux',
    options: ['tmux', 'subprocess', 'mcp'],
    category: 'Provider',
  },
  auth_mode: {
    description: "Auth mode: 'subscription' (Claude.ai plan), 'api' (ANTHROPIC_API_KEY), 'hybrid'.",
    type: "'subscription' | 'api' | 'hybrid'",
    default: 'subscription',
    options: ['subscription', 'api', 'hybrid'],
    category: 'Provider',
  },
  api_keys: {
    description: 'Optional API key overrides (prefer environment variables).',
    type: 'Record<string, string> | undefined',
    default: undefined,
    category: 'Provider',
  },
  skills: {
    description: 'Skill system: enabled flag, max skills per task, auto-detection, preferred skills.',
    type: 'SkillConfig | undefined',
    default: undefined,
    category: 'Skills',
  },
  skill_routing: {
    description: 'Route specific skill types (design, testing, docs) to dedicated providers.',
    type: '{ design?: string; testing?: string; docs?: string; default?: string } | undefined',
    default: undefined,
    category: 'Skills',
  },
  search_enabled: {
    description: 'Enable online documentation search during task execution.',
    type: 'boolean',
    default: true,
    options: ['true', 'false'],
    category: 'Search',
  },
  search_provider: {
    description: "Documentation search provider: 'context7' (curated), 'web' (general), 'none'.",
    type: "'context7' | 'web' | 'none'",
    default: 'context7',
    options: ['context7', 'web', 'none'],
    category: 'Search',
  },
  search_cache_ttl: {
    description: 'How long to cache search results in seconds (default: 3600; 0 = no cache).',
    type: 'number',
    default: 3600,
    category: 'Search',
  },
  notify_on_complete: {
    description: 'Send a notification when a sprint finishes.',
    type: 'boolean',
    default: false,
    options: ['true', 'false'],
    category: 'Notifications',
  },
  notify_outbox_drain_interval_ms: {
    description: 'Bot-daemon durable owner-notification outbox drain interval in ms (671-001).',
    type: 'number',
    default: 30_000,
    category: 'Notifications',
  },
  'nervous_system.detectors.notification_delivery_health.pending_age_threshold_ms': {
    description: 'notification_delivery_health-only pending-age threshold (ms) before a queued owner notification is flagged undelivered (671-001).',
    type: 'number',
    default: 300_000,
    category: 'Nervous System',
  },
  notify_channel: {
    description: 'Notification delivery channel.',
    type: "'slack' | 'discord' | 'email' | 'webhook' | null",
    default: null,
    options: ['slack', 'discord', 'email', 'webhook'],
    category: 'Notifications',
  },
  notify_url: {
    description: 'Webhook URL for slack/discord/webhook notification channels.',
    type: 'string | null',
    default: null,
    category: 'Notifications',
  },
  telemetry_enabled: {
    description: 'Send anonymous usage telemetry to help improve Deckent.',
    type: 'boolean',
    default: false,
    options: ['true', 'false'],
    category: 'Telemetry',
  },
  telemetry_anonymous: {
    description: 'Strip all identifying information before sending telemetry data.',
    type: 'boolean',
    default: true,
    options: ['true', 'false'],
    category: 'Telemetry',
  },
  detected_env: {
    description: 'Auto-detected IDE/shell environment (set automatically on first run).',
    type: "'vscode' | 'codex' | 'gemini' | 'cursor' | 'tmux' | 'shell' | null",
    default: null,
    options: ['vscode', 'codex', 'gemini', 'cursor', 'tmux', 'shell'],
    category: 'Environment',
  },
  multi_ide_mode: {
    description: 'Enable multi-IDE mode for projects open in multiple editors simultaneously.',
    type: 'boolean',
    default: false,
    options: ['true', 'false'],
    category: 'Environment',
  },
  output_splash: {
    description: 'Show the Deckent ASCII splash screen on init and version commands.',
    type: 'boolean',
    default: true,
    options: ['true', 'false'],
    category: 'Output',
  },
  output_mode: {
    description: "Output verbosity: 'quiet' (minimal), 'normal' (default), 'verbose' (extra detail).",
    type: "'quiet' | 'normal' | 'verbose'",
    default: 'normal',
    options: ['quiet', 'normal', 'verbose'],
    category: 'Output',
  },
  output_theme: {
    description: "Visual theme: 'default', 'minimal' (no color), 'rich' (extra formatting).",
    type: "'default' | 'minimal' | 'rich'",
    default: 'default',
    options: ['default', 'minimal', 'rich'],
    category: 'Output',
  },
  language: {
    description: 'Primary programming language of the project for context-aware planning.',
    type: 'string | undefined',
    default: undefined,
    category: 'Project',
  },
  projectName: {
    description: 'Display name for the project, used in sprint logs and notifications.',
    type: 'string | undefined',
    default: undefined,
    category: 'Project',
  },
  version: {
    description: 'Pinned Deckent version for reproducible runs (defaults to installed version).',
    type: 'string | undefined',
    default: undefined,
    category: 'Project',
  },
  auto_docs: {
    description: 'Auto-doc tiers: tier1 (CHANGELOG/SPRINT-LOG), tier2 (README), tier3 (BLUEPRINT).',
    type: 'AutoDocsConfig | undefined',
    default: { tier1: true, tier2: false, tier3: false },
    category: 'Project',
  },
  auto_clean_locks: {
    description: 'Automatically remove stale lock files (>5 min old) during auditor scans.',
    type: 'boolean | undefined',
    default: false,
    options: ['true', 'false'],
    category: 'Advanced',
  },
  // ─── Memory ─────────────────────────────────────────────────────────
  memory_budget: {
    description: 'Maximum retained Brain entries before decay is evaluated.',
    descriptionTr: 'Decay değerlendirilmeden önce tutulacak azami Brain kaydı.',
    type: 'number',
    default: 5000,
    category: 'Memory',
  },
  memory_read: {
    description: 'Whole-record query view budgets with explicit continuation; never a storage retention limit.',
    descriptionTr: 'Açık devam bağlantılı tam kayıt sorgu görünümü bütçeleri; depolama sınırı değildir.',
    type: 'object | undefined',
    default: { ...DEFAULT_MEMORY_READ_LIMITS },
    category: 'Memory',
  },
  memory_read_profiles: {
    description: 'Consumer-specific whole-record read budgets. Precedence: consumer default, authored shared limits, authored consumer overrides; project overrides global within each layer.',
    descriptionTr: 'Tüketiciye özel tam kayıt okuma bütçeleri. Öncelik: tüketici varsayılanı, yazılmış ortak limitler, yazılmış tüketici ayarları; her katmanda proje globale üstün gelir.',
    type: 'object | undefined',
    default: DEFAULT_MEMORY_READ_PROFILES,
    category: 'Memory',
  },
  memory_export: {
    description: 'Optional bounded human-view limits for guarded Memory exports; durable records remain complete.',
    descriptionTr: 'Korumalı Memory exportları için isteğe bağlı sınırlı insan görünümü limitleri; dayanıklı kayıtlar tam kalır.',
    type: 'object | undefined',
    default: {
      max_inline_lines: 3000,
      max_inline_bytes: 256 * 1024,
      summary_inline_lines: 200,
      summary_inline_bytes: 16 * 1024,
    },
    category: 'Memory',
  },
  decay_after_sprints: {
    description: 'Decay memory entries older than this many sprints.',
    type: 'number',
    default: 5,
    category: 'Memory',
  },
  patterns_enabled: {
    description: 'Enable automatic pattern detection and recording in PATTERNS.md.',
    type: 'boolean',
    default: true,
    options: ['true', 'false'],
    category: 'Memory',
  },
  project_identity_enabled: {
    description: 'Enable PROJECT-IDENTITY.md updates after each sprint.',
    type: 'boolean',
    default: true,
    options: ['true', 'false'],
    category: 'Memory',
  },
  // ─── Auditor ────────────────────────────────────────────────────────
  scan_interval: {
    description: 'Auditor scan interval in seconds.',
    type: 'number',
    default: 30,
    category: 'Auditor',
  },
  heartbeat_timeout: {
    description: 'Seconds before a worker heartbeat is considered stale.',
    type: 'number',
    default: 120,
    category: 'Auditor',
  },
  boundary_enforcement: {
    description: 'Enforce worker scope boundaries via git diff checks.',
    type: 'boolean',
    default: true,
    options: ['true', 'false'],
    category: 'Auditor',
  },
  // ─── Sprint ─────────────────────────────────────────────────────────
  fix_phase_enabled: {
    description: 'Enable a fix phase after initial task execution for failed tasks.',
    type: 'boolean',
    default: true,
    options: ['true', 'false'],
    category: 'Sprint',
  },
  max_fix_retries: {
    description: 'Maximum number of fix retries per task during the fix phase.',
    type: 'number',
    default: DEFAULT_MAX_FIX_RETRIES,
    category: 'Sprint',
  },
  fix_circuit_breaker: {
    description: 'Post-FIX circuit breaker evaluated over logical task lineages, not raw attempts.',
    type: 'object',
    default: { ...DEFAULT_FIX_CIRCUIT_BREAKER_CONFIG },
    category: 'Sprint',
  },
  lifecycle_recovery: {
    description: 'Mode-independent coordinator containment timings used by finalize and recovery.',
    type: 'LifecycleRecoveryConfig',
    default: { ...DEFAULT_LIFECYCLE_RECOVERY_CONFIG },
    category: 'Lifecycle',
  },
  // ─── Rollback ───────────────────────────────────────────────────────
  rollback_policy: {
    description: "Rollback policy: 'never' (default), 'on_failure' (revert failed tasks), 'always'.",
    type: "'never' | 'on_failure' | 'always'",
    default: 'never',
    options: ['never', 'on_failure', 'always'],
    category: 'Sprint',
  },
  deckent_style: {
    description: 'Active runtime style: "sprint" for developer orchestration, "task" for one-shot life assistant, "process" for continuous request-handling (ERP / business automation via MCP + REST).',
    type: "'sprint' | 'task' | 'process'",
    default: 'sprint',
    options: ['sprint', 'task', 'process'],
    category: 'Sprint',
  },
} as const;

/**
 * Return metadata for a single config key.
 * Returns undefined when the key is unknown.
 */
export function getConfigHelp(key: string): ConfigMetadataEntry | undefined {
  return CONFIG_METADATA[key];
}

/**
 * Return all config keys grouped by category, keys sorted alphabetically within each group.
 */
export function listConfigByCategory(): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [key, entry] of Object.entries(CONFIG_METADATA)) {
    const cat = entry.category;
    if (!result[cat]) result[cat] = [];
    result[cat].push(key);
  }
  for (const cat of Object.keys(result)) {
    result[cat]?.sort();
  }
  return result;
}

/**
 * Generate markdown content for CONFIG-REFERENCE.md from CONFIG_METADATA.
 */
export function generateConfigReference(): string {
  const grouped = listConfigByCategory();
  const categories = Object.keys(grouped).sort();

  const lines: string[] = [
    '# Deckent Config Reference',
    '',
    '> Auto-generated from `CONFIG_METADATA`. Do not edit manually.',
    '',
    '## Table of Contents',
    '',
  ];

  for (const cat of categories) {
    lines.push(`- [${cat}](#${cat.toLowerCase()})`);
  }
  lines.push('');

  for (const cat of categories) {
    lines.push(`## ${cat}`, '');
    const keys = grouped[cat];
    if (!keys) continue;
    for (const key of keys) {
      const meta = CONFIG_METADATA[key];
      if (!meta) continue;
      lines.push(`### \`${key}\``, '');
      lines.push(`**Description:** ${meta.description}`, '');
      lines.push(`**Type:** \`${meta.type}\``);
      const defVal =
        meta.default === undefined
          ? '*(not set)*'
          : meta.default === null
            ? '`null`'
            : `\`${JSON.stringify(meta.default)}\``;
      lines.push(`**Default:** ${defVal}`);
      if (meta.options && meta.options.length > 0) {
        lines.push(`**Options:** ${meta.options.map((o) => `\`${o}\``).join(', ')}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Merge global + project partial configs over defaults into a ResolvedConfig.
 * Both parameters may be null.
 */
export function mergeConfigs(
  globalConfig: Partial<DeckentConfig> | null,
  projectConfig: Partial<DeckentConfig> | null,
): ResolvedConfig {
  try {
    assertProviderLimitPolicyLayerPrecedence(
      globalConfig?.provider_limits,
      projectConfig?.provider_limits,
    );
  } catch (error) {
    throw new ConfigValidationError([
      error instanceof Error ? error.message : String(error),
    ]);
  }
  let config = createDefaultConfig();
  let approvalLifecycle = resolveApprovalLifecycleLayer(null);

  if (globalConfig) {
    const { config: providerCanonicalGlobalConfig } = canonicalizeProviderConfigAliases(
      globalConfig as Record<string, unknown>,
      'global',
    );
    const { config: canonicalGlobalConfig } = canonicalizeModelConfigAliases(
      providerCanonicalGlobalConfig,
      'global',
    );
    approvalLifecycle = resolveApprovalLifecycleLayer(
      canonicalGlobalConfig as Partial<DeckentConfig>,
      approvalLifecycle,
    );
    config = deepMerge(config, canonicalGlobalConfig as Partial<DeckentConfig>);
  }
  if (projectConfig) {
    const { config: providerCanonicalProjectConfig } = canonicalizeProviderConfigAliases(
      projectConfig as Record<string, unknown>,
      'project',
    );
    const { config: canonicalProjectConfig } = canonicalizeModelConfigAliases(
      providerCanonicalProjectConfig,
      'project',
    );
    approvalLifecycle = resolveApprovalLifecycleLayer(
      canonicalProjectConfig as Partial<DeckentConfig>,
      approvalLifecycle,
    );
    config = deepMerge(config, canonicalProjectConfig as Partial<DeckentConfig>);
  }

  projectCanonicalProviderFields(config);

  // Resolve legacy mode aliases so 'max_plan' → 'performance' etc.
  config.mode = resolveMode(config.mode) as PlanMode;

  // V3 cut-over: normalize legacy v1/v2 labels before validation.
  if (['v1', 'v2'].includes((config as { routing_engine?: string }).routing_engine ?? '')) {
    (config as { routing_engine?: string }).routing_engine = 'v3';
  }

  validateConfig(config);

  const activeModeConfig = (config.modes[config.mode] ?? config.modes['performance']) as PlanModeConfig;

  // Sprint 179 W2-4: resolve coverage gates from the raw user partials
  // (NOT the post-default-merge config) so user-supplied legacy
  // `coverage_threshold` correctly seeds `coverage_aspirational` even though
  // `createDefaultConfig` pre-populates an aspirational default of 90.
  const userCoverageInput: Partial<DeckentConfig> = {
    ...(globalConfig ?? {}),
    ...(projectConfig ?? {}),
  };
  const coverageGates = resolveCoverageGates(userCoverageInput);

  const merged: ResolvedConfigWithThrottle & ResolvedConfigWithChatProvider & ResolvedConfigWithMaxWorkers = {
    mode: config.mode,
    activeModeConfig,
    modes: config.modes,
    language: config.language ?? DEFAULT_LANGUAGE,
    projectName: config.projectName ?? 'deckent-project',
    projectRoot: resolve(process.cwd()),
    version: config.version ?? DECKENT_VERSION,
    // Sprint 319 (B-MAXWORKERS-WIRE): carry the top-level explicit worker-count
    // override (see loadConfig + resolveEffectiveWorkers). Absent → undefined.
    max_workers: (config as DeckentConfigWithMaxWorkers).max_workers,
    // Task 429-006 (PLNR1): carry the top-level explicit brain_planning override
    // (see loadConfig + resolveBrainPlanningMode). Absent → undefined.
    brain_planning: config.brain_planning,
    auto_docs: config.auto_docs ?? { ...DEFAULT_AUTO_DOCS },
    memory_export: config.memory_export,
    memory_read: resolveMemoryReadLimits(config.memory_read),
    memory_read_profiles: resolveMemoryReadProfiles(globalConfig, projectConfig),
    skills: config.skills,
    // F1-012 — pass grouped `providers` (incl. config-driven `registry`) through.
    providers: config.providers,
    brain_provider: config.brain_provider,
    worker_provider: config.worker_provider,
    fallback_provider: config.fallback_provider,
    provider_overrides: config.provider_overrides,
    // Sprint 220 Task 220-001 — optional native REPL provider override.
    chat_provider: (config as DeckentConfigWithChatProvider).chat_provider,
    // Sprint 179 W2-4: see resolveCoverageGates docstring for split semantics.
    ...coverageGates,
    max_reroutes: config.max_reroutes ?? 3,
    reroute_on_tech_debt: config.reroute_on_tech_debt ?? false,
    sprint_timeout_minutes: config.sprint_timeout_minutes ?? 0,
    adaptive_thresholds: config.adaptive_thresholds ?? false,
    agent_min_score: config.agent_min_score ?? 5,
    adaptive_config: config.adaptive_config ?? { min_samples: 3, no_go_threshold: 0.3, coverage_lookback: 3 },
    deckent_style: config.deckent_style ?? 'sprint',
    // Sprint 156: default true unless overridden by user/project config
    dependency_pipeline_enabled: config.dependency_pipeline_enabled ?? true,
    // Sprint 202 Task 202-004 — pre-spawn pacing (computeBackoff wire).
    token_throttle_ms:
      (config as DeckentConfigWithThrottle).token_throttle_ms ?? 500,
    // Terminal (Sprint 175) — deepMerge applies any partial project override on
    // top of DEFAULT_TERMINAL_CONFIG so unspecified keys inherit defaults,
    // mirroring the model_strategy nested-merge pattern.
    terminal: config.terminal
      ? deepMerge(DEFAULT_TERMINAL_CONFIG, config.terminal as Partial<TerminalConfig>)
      : structuredClone(DEFAULT_TERMINAL_CONFIG),
    // Resource Monitor — passed through (opt-in, absent = disabled)
    resource_monitor: config.resource_monitor,
    runtime_artifact_retention: resolveRuntimeArtifactRetention(config),
    // Worker Comms — passed through (opt-in, absent = disabled)
    worker_comms: config.worker_comms,
    // Cost Guard — passed through (opt-in, absent = disabled)
    cost_guard: config.cost_guard,
    // Routing Engine v3 (445 Slice-0) — resolved to the full defaulted+validated
    // shape (config already carries the merged overrides, passed as the project
    // layer; defaults live solely in routing3/config.ts).
    routing_v3: resolveRoutingV3Config(null, config),
    // Scheduler shadow-reducer (SCHED4) — passed through (opt-in, absent = disabled)
    scheduler: config.scheduler,
    // Gate — passed through (opt-in, default-off)
    gate: config.gate,
    evaluation: {
      tsc_settlement_gate: config.evaluation?.tsc_settlement_gate ?? true,
    },
    // Approval — validated + defaulted via resolveApprovalConfig (Sprint 355 CFG-APR-WIRE)
    approval: resolveApprovalConfig(config),
    api_oidc: config.api_oidc,
    // ERP connector — passed through (opt-in, absent = disabled; secret-free)
    erp: config.erp,
    // Plan config (Sprint 276 PLAN-INT-1) — passed through (opt-in, absent = disabled)
    plan: config.plan,
    // born-464 (Alperen live-test 2026-07-02): the five overnight opt-in flag
    // blocks below were declared on the type but never passed through here —
    // hermetic tests injected configs directly, so on the LIVE loadConfig path
    // every flag silently resolved to undefined (off) no matter what the user
    // set. Each is a plain pass-through: absent = disabled, exactly like
    // resource_monitor/worker_comms above.
    // W1-EXPERIENCE-ON (#492, Alperen 2026-07-06): the terminal experience layer
    // (live footer, mode indicator, approval card) ships ON by default — months
    // of UX stayed invisible behind absent config blocks (user-truth-audit §2).
    // An explicit { enabled: false } still turns it off (opt-out, not opt-in).
    repl_surface: config.repl_surface ?? { enabled: true, approvals: true },
    // TOOL-QB-FLIP (376-001, continuing #492's default-flip package): the
    // progressive-disclosure meta-tool surface ships ON by default too — same
    // opt-out rationale as repl_surface above (explicit { enabled: false } still
    // disables it).
    // born-607 P1 (advisor): FIELD-level default — a partial block like
    // `{ riskThreshold: 'safe' }` must not silently disable the default-ON surface.
    // born-612 (405-002 + CC son-mil): plugin-security bloğu passthrough (born-464 üçlüsü).
    plugins: config.plugins,
    tool_surface: { ...(config.tool_surface ?? {}), enabled: config.tool_surface?.enabled ?? true },
    deck_broker: config.deck_broker,
    // ROLE-AWARE-PROVIDER-FALLBACK (row 607): declared on DeckentConfig +
    // ResolvedConfig but never wired here — the born-464 shape, caught by
    // `config-flag-roundtrip.test.ts`'s type-vs-live parity guard. Same
    // twin-literal rule as `openrouter` below applies.
    provider_fallback: config.provider_fallback,
    execution_budget: config.execution_budget,
    // Authored input only; never an effective policy authority.
    provider_limits: config.provider_limits,
    persona_integrity: {
      min_bytes: config.persona_integrity?.min_bytes ?? DEFAULT_PERSONA_INTEGRITY_MIN_BYTES,
    },
    provider_limit_authority: createProviderLimitPolicyAuthoritySnapshot({
      parent: globalConfig?.provider_limits,
      project: projectConfig?.provider_limits,
    }),
    // XVERIFY-TOOL (S1): cross_verify was a pinned born-464 gap since 358-014 —
    // declared on both config types, never passed through, so `runCrossVerify`'s
    // `enabled !== true` guard could NEVER pass from a real config file and the
    // whole adversarial-verification feature was config-unreachable. Wired now
    // because the xverify advisory tool builds on it. Absent block → undefined →
    // disabled (behavior unchanged for every existing config).
    cross_verify: config.cross_verify,
    // OPENROUTER-PROVIDER (row 477): opt-in flag passthrough. Absent → undefined
    // → `bootstrapProviders` skips registration entirely (default-OFF preserved).
    // The `loadConfig` / `mergeConfigs` resolved-config literals are hand-synced
    // TWINS — this field must appear in BOTH. Dropping either reintroduces
    // born-464 (declared on the type, silently undefined on the live path).
    openrouter: config.openrouter,
    training_trace: config.training_trace,
    live_trace: config.live_trace,
    mcp_client_enabled: config.mcp_client_enabled,
    // Sprint 369-005/008 follow-up (born-464 pattern) — see loadConfig twin above.
    computer_use: config.computer_use,
    worker_output_contract: config.worker_output_contract,
    // Tool allowlist (born-674, W674B 428-002) — see loadConfig twin above.
    tools: config.tools,
  };
  return merged;
}
