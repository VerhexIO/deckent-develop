// ─── run-proposal-compiler — TERM-FLOW-UNIFY Sprint-2 dilim (424-001) ──────
//                              + N678A planner-core mount (429-001, born-678)
//
// docs/analysis/term-flow-unify-design-2026-07-11.md ("Organ nakli olacak
// parçalar"): directives-builder.ts stays the code-repo proposal ADAPTER —
// this module is that adapter's other end. It turns a domain-general
// `RunProposal` (core/run-flow-contract.ts, sprint-422 contract — no
// DIRECTIVES/files/scope fields by design) into a `DirectiveBuildIntent` and
// then calls the UNCHANGED `buildDirectives()` to render markdown. Zero
// modification to directives-builder.ts — it is called, never touched.
//
// born-678 (P0): the original 424-001 slice stopped at a single-task
// TODO-SCAFFOLD (`compileRunProposalIntent`'s own comment called real
// decomposition "an explicit native-flow follow-up") — the prompt-gate
// correctly rejected that, so a RunProposal never became a runnable plan.
// This slice replaces the scaffold with an INJECTABLE planner-seam
// (`RunProposalPlanner`): production delegates to the same AI/structured
// planner core sprint-planner.ts itself uses for NL splitting
// (`callZeroConfigPlanner`, orchestra/planner.ts) to turn `intentSummary`
// into a REAL multi-task plan (task decomposition + file scope + per-task
// verifiable goCriteria/nogo). Tests inject a hermetic fake planner instead
// — never a real AI/provider call. A planner failure is a typed
// `RunProposalPlanError`, never a silent fall-back to a scaffold.
//
// `buildPlanNlIntent` (cli/commands/plan-nl.ts) draws the same single-task
// scaffold boundary for a raw NL goal string — it stays canonical-dead here;
// this module does not import or revive it, it goes straight to the
// planner core instead.
//
// Proposal metadata (flowId/tenant/project/actor/origin/revision) is folded
// into each task's description as plain traceability prose — never as a
// "Label: value" line — so it can never collide with directives-builder's
// RESERVED_LABEL_RE / heading guards (assertSafeField, buildTaskBlock).

import type { RunProposal } from '../core/run-flow-contract.js';
import type { DeckentConfig, PlannerResult, PlannerTask } from '../core/types.js';
import { createGoNoGoCriterionItem } from '../core/task-types.js';
import type { ResolvedConfig } from '../core/config-types.js';
import { readAuthMode, resolveBrainModel, resolveDefaultModel } from '../core/config.js';
import { buildDirectives, type DirectiveBuildIntent, type DirectiveBuildTask } from './directives-builder.js';
import { spawn } from 'node:child_process';
import {
  callZeroConfigPlanner,
  createPlannerTaskModelPolicy,
  resolvePlanTimeoutMs,
} from './planner.js';

export interface RunProposalCompileResult {
  readonly intent: DirectiveBuildIntent;
  readonly directivesMarkdown: string;
}

/**
 * Injectable NL -> plan seam. Production default (`defaultRunProposalPlanner`)
 * calls the real AI/structured planner core; tests inject a hermetic fake that
 * returns a canned `PlannerResult` — never a real subprocess/provider call.
 * The optional `config` param (Task 431-003) lets a caller drive the planner's
 * model choice via `resolveBrainModel(config)`; omitted by every fake planner
 * that ignores it, so existing single-param injected planners stay assignable.
 */
/** Config shape accepted by the planner seam — same union `resolveBrainModel` takes,
 *  so call sites can forward a live `ResolvedConfig` directly (born-690). */
export type RunProposalPlannerConfig = Partial<DeckentConfig> | Partial<ResolvedConfig>;

export type RunProposalPlanner = (
  proposal: RunProposal,
  config?: RunProposalPlannerConfig,
) => PlannerResult | Promise<PlannerResult>;

/**
 * Thrown when NL -> plan compilation fails to produce a real, usable plan —
 * the planner core threw, returned nothing, or returned zero tasks. Never
 * swallowed into a TODO scaffold (born-678): a proposal that cannot be
 * planned is a typed failure for the caller to handle, not a silently
 * degraded placeholder task.
 */
export class RunProposalPlanError extends Error {
  public readonly flowId: string;

  constructor(flowId: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RunProposalPlanError';
    this.flowId = flowId;
  }
}

function describeActor(proposal: RunProposal): string {
  const { actor } = proposal;
  return actor.role ? `${actor.id} (${actor.role})` : actor.id;
}

// U1-G2: traceabilityLine kaldırıldı — traceability artık DirectiveBuildTask.meta alanında taşınır (desc'e gömme yasak).

/**
 * Production planner: delegates to the SAME AI/structured planner core
 * sprint-planner.ts uses for zero-config NL splitting (`callZeroConfigPlanner`
 * — buildZeroConfigPlanPrompt + provider spawn + parsePlannerResponse),
 * scoped to this proposal's `intentSummary`. A null/empty result throws the
 * typed `RunProposalPlanError` directly (error-registry lint: no generic
 * throws in orchestra/) — `compileRunProposalIntent` still guarantees ANY
 * planner failure (this default OR an injected one) surfaces as the same
 * typed class, so both paths honor the "never scaffold" contract.
 *
 * Model selection (Task 431-003, born-683 continuation): `resolveBrainModel(config)`
 * replaces the former bare `'sonnet'` literal. `config` is left WITHOUT a default
 * value on purpose — every current call site omits it, and `resolveBrainModel(undefined)`
 * already falls back to `DEFAULT_MODES['balanced'].brain_model` = `'sonnet'`, so existing
 * behavior is reproduced exactly. Do not default `config` to `createDefaultConfig()`: that
 * resolves `mode: 'performance'` -> `brain_model: 'opus'`, a silent regression.
 */
/** F-1: ground the zero-config planner in the REAL tracked file tree — a
 *  planner that cannot see the repo invents paths (the sparse-project
 *  path-sprawl class: bare "README.md", fictional "tests/x"). Fail-soft: no
 *  git / not a repo / slow git → empty tree, and the prompt engages its
 *  greenfield guidance instead. Async spawn (SURF-5 hardening of the F-1
 *  original): the daemon serves /api/run-flow/propose on this path, so even a
 *  fast `git ls-files` must not block the event loop — same F-2 discipline as
 *  the planner LLM calls, with a SIGTERM deadline against a hung git. */
function readTrackedFileTree(timeoutMs = 10_000): Promise<string[]> {
  return new Promise((resolve) => {
    let stdout = '';
    let done = false;
    const finish = (lines: string[]): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(lines);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('git', ['ls-files'], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve([]);
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch { /* already gone */ }
      finish([]);
    }, timeoutMs);
    child.stdout?.setEncoding('utf-8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.on('error', () => finish([]));
    child.on('close', (code) => {
      if (code !== 0 || stdout.length === 0) {
        finish([]);
        return;
      }
      finish(stdout.trim().split('\n').filter((line) => line.length > 0));
    });
  });
}

async function defaultRunProposalPlanner(proposal: RunProposal, config?: RunProposalPlannerConfig): Promise<PlannerResult> {
  const description = proposal.intentSummary.trim();
  const projectRoot = process.cwd();
  const brainModel = resolveBrainModel(config);
  const configuredProvider = config?.brain_provider ?? null;
  const taskModelPolicy = createPlannerTaskModelPolicy(
    resolveDefaultModel(config),
    config?.worker_provider,
  );
  // F-2: async planner call (event loop stays free — `deckent do` can render
  // its planning heartbeat) + the SAME config-resolved timeout every planning
  // path uses (resolvePlanTimeoutMs — brain_plan_timeout_ms honored here too).
  // F-1: the real tracked file tree grounds the planner (no more blind planning).
  const result = await callZeroConfigPlanner(
    description, brainModel, proposal.project, await readTrackedFileTree(), undefined,
    resolvePlanTimeoutMs(config as { brain_plan_timeout_ms?: number; ai_planner_timeout?: number } | undefined),
    undefined,
    {
      tenantId: proposal.tenant,
      projectRoot,
      runId: `${proposal.flowId}:revision:${proposal.revision}`,
      configuredProvider,
      requestedProvider: configuredProvider,
      configuredModel: brainModel,
      requestedModel: brainModel,
      authMode: await readAuthMode(projectRoot),
    },
    taskModelPolicy,
  );
  if (!result) {
    throw new RunProposalPlanError(
      proposal.flowId,
      'AI planner core returned no usable plan (provider unavailable, timed out, or produced an ' +
        'unparseable response).',
    );
  }
  return result;
}

/**
 * Canonical task-title sanitizer — the SINGLE deterministic transform applied to
 * every planner task title on BOTH ends of a DIRECTIVES dependency edge: where the
 * title is emitted as a `## Task N:` heading AND where another task references it by
 * title in its `- Dependencies:` list. Both directives-builder join delimiters —
 * ',' (Files/Scope/Dependencies/Skills lines) and ';' (goCriteria/nogo lines) — plus
 * any surrounding whitespace are folded to a safe spaced hyphen so a title can never
 * split a comma-joined dependency list nor trip assertNoDelimiterCollision, and so a
 * dependency reference always maps to the IDENTICAL canonical title its target task
 * carries (DIRECTIVES round-trip consistency — born-692). Identity on delimiter-free
 * titles, so existing single-word/phrase titles are unchanged.
 */
function canonicalTaskTitle(title: string): string {
  return title.replace(/\s*[,;]+\s*/g, ' - ').trim();
}

/**
 * born-677 goal-flow slice: directives-builder's `buildDirectives` applies exactly one guard
 * to `DirectiveBuildIntent.goal` — `assertNoHeadingCollision`, which throws if the goal text
 * contains a line matching a "## Task N:"/"## Görev N:" heading or a "### Description"/
 * "### goNogo" section heading (both line-anchored). Those two patterns are private to
 * directives-builder.ts, so they are mirrored here rather than exported, keeping the fix
 * entirely inside this compile layer (directives-builder.ts stays untouched).
 *
 * A raw NL goal that happens to quote/describe such a line (plausible free-form user text —
 * e.g. a goal that pastes a previous plan) must not crash proposal compilation, the same
 * born-677 class directives-builder already closed for goCriteria/nogo items via reversible
 * escaping (escapeListItem/unescapeListItem). A zero-width space inserted right before the
 * colliding "##"/"###" marker breaks the line-start anchor without changing how the text
 * reads — invisible in any renderer, and nothing parses `## Goal` back into structured data
 * (buildDirectives' own header: goal/title are "purely cosmetic — discarded by
 * parseStructuredDirectives"), so there is no reader to reverse this insertion for.
 * Every OTHER goal — including the full born-677 delimiter corpus (';', '"', backtick,
 * newline, '&&', mixed) — never matches either pattern, so this is byte-for-byte identity
 * for them.
 */
const GOAL_HEADING_COLLISION_RE = /^(\s*)(##\s+(?:G[öo]rev|Task)\s+\d+[^:]*:|###\s+(?:Description|goNogo)\b)/gim;

function escapeGoalHeadingCollisions(goal: string): string {
  return goal.replace(GOAL_HEADING_COLLISION_RE, (_match, indent: string, heading: string) => `${indent}​${heading}`);
}

/**
 * Map one real, AI-decomposed `PlannerTask` to a `DirectiveBuildTask` — no TODO
 * placeholders. Enforces two compiler-boundary invariants BEFORE the intent can reach
 * the (unchanged) directives-builder, so a bare `DeckentError` never leaks from that
 * builder for these two production cases (born-691 / born-692):
 *   - every task must declare at least one non-blank writable file — an empty
 *     `scope.filesWrite` is a typed {@link RunProposalPlanError} naming the ORIGINAL
 *     (unsanitized) task title, never a silent TODO scaffold;
 *   - the task title and every dependency reference are run through the SAME
 *     {@link canonicalTaskTitle} sanitizer so a delimiter-bearing title round-trips
 *     and its dependency edges still resolve to the identical canonical title.
 */
function toDirectiveTask(task: PlannerTask, proposal: RunProposal): DirectiveBuildTask {
  if (!task.scope.filesWrite.some((f) => f.trim().length > 0)) {
    throw new RunProposalPlanError(
      proposal.flowId,
      `run-proposal-compiler: planner task "${task.title}" declares no writable file ` +
        `(scope.filesWrite is empty) — a real task must write at least one file. ` +
        `Planner reason: ${task.reason || '(none given)'}. Refusing to fall back to a TODO scaffold.`,
    );
  }
  const criteriaItems = task.goNogo.items && task.goNogo.items.length > 0
    ? task.goNogo.items
    : [
        createGoNoGoCriterionItem({
          polarity: 'go',
          statement: task.goNogo.goCriteria,
          evidenceRequirements: [task.goNogo.goCriteria],
        }),
        createGoNoGoCriterionItem({
          polarity: 'no-go',
          statement: task.goNogo.noGoCriteria,
          evidenceRequirements: [task.goNogo.noGoCriteria],
        }),
      ];
  return {
    title: canonicalTaskTitle(task.title),
    // U1-G2 (PCOMP-8): traceability is METADATA, not content — embedding it in
    // desc poisoned intent classification ('cd' matched the flowId hex, A1-İz#2).
    // It now travels in the structured `meta` field; desc stays pure content.
    desc: `${task.description}\n\nReason: ${task.reason}`,
    meta: {
      flowId: proposal.flowId,
      revision: String(proposal.revision),
      tenant: proposal.tenant,
      project: proposal.project,
      actor: describeActor(proposal),
      origin: proposal.origin,
    },
    files: [...task.scope.filesWrite],
    scope: [...task.scope.directories],
    deps: task.dependencies.map(canonicalTaskTitle),
    model: task.model,
    effort: task.effort,
    skills: task.forceSkills,
    goCriteria: [task.goNogo.goCriteria],
    nogo: [task.goNogo.noGoCriteria],
    criteriaItems,
    ...(task.productionWiring ? { productionWiring: task.productionWiring } : {}),
  };
}

/**
 * Map a `RunProposal` to a real, multi-task {@link DirectiveBuildIntent} via
 * the injectable planner seam (`planner` defaults to the production AI/
 * structured planner core — see {@link defaultRunProposalPlanner}). Throws
 * {@link RunProposalPlanError} rather than degrading to a scaffold when the
 * planner cannot produce at least one real task. The optional `config`
 * (Task 431-003) is forwarded to `planner` untouched, driving
 * `resolveBrainModel(config)` in the production default.
 */
export async function compileRunProposalIntent(
  proposal: RunProposal,
  planner: RunProposalPlanner = defaultRunProposalPlanner,
  config?: RunProposalPlannerConfig,
): Promise<DirectiveBuildIntent> {
  let plan: PlannerResult;
  try {
    // F-2: the seam accepts sync AND async planners — await tolerates both,
    // so every existing hermetic fake planner stays assignable unchanged.
    plan = await planner(proposal, config);
  } catch (e) {
    if (e instanceof RunProposalPlanError) throw e;
    throw new RunProposalPlanError(
      proposal.flowId,
      `run-proposal-compiler: planner failed to produce a real plan for flowId=${proposal.flowId}: ` +
        `${e instanceof Error ? e.message : String(e)} — refusing to fall back to a TODO scaffold.`,
      { cause: e },
    );
  }
  if (!plan.tasks || plan.tasks.length === 0) {
    throw new RunProposalPlanError(
      proposal.flowId,
      `run-proposal-compiler: planner returned zero tasks for flowId=${proposal.flowId} — ` +
        'a real plan must contain at least one task.',
    );
  }

  return {
    title: `RunProposal ${proposal.flowId}`,
    goal: escapeGoalHeadingCollisions(proposal.intentSummary.trim()),
    tasks: plan.tasks.map((task) => toDirectiveTask(task, proposal)),
  };
}

/**
 * Compile a `RunProposal` straight to DIRECTIVES.md markdown. Calls
 * buildDirectives() purely (in-memory, no fs) — this function never writes
 * DIRECTIVES.md or any other file itself; that stays the caller's job. The
 * optional `config` (Task 431-003) is forwarded to `compileRunProposalIntent`.
 */
export async function compileRunProposal(
  proposal: RunProposal,
  planner: RunProposalPlanner = defaultRunProposalPlanner,
  config?: RunProposalPlannerConfig,
): Promise<RunProposalCompileResult> {
  const intent = await compileRunProposalIntent(proposal, planner, config);
  let directivesMarkdown: string;
  try {
    directivesMarkdown = buildDirectives(intent);
  } catch (e) {
    // Defense-in-depth: the two known leak vectors (empty filesWrite / delimiter-bearing
    // titles) are already closed at intent construction (toDirectiveTask), so the common
    // path never reaches here. Any RESIDUAL directives-builder DeckentError from another
    // free-text field (e.g. a file path or reserved-label collision) must still not surface
    // to the caller as a bare builder error — rewrap it as this module's typed plan error.
    if (e instanceof RunProposalPlanError) throw e;
    throw new RunProposalPlanError(
      proposal.flowId,
      `run-proposal-compiler: directives-builder rejected the compiled plan for flowId=${proposal.flowId}: ` +
        `${e instanceof Error ? e.message : String(e)}.`,
      { cause: e },
    );
  }
  return { intent, directivesMarkdown };
}
