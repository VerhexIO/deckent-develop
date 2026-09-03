#!/usr/bin/env node
// Source-derived test hermeticity registry and fail-loud policy gate.
//
// Exit: 0 = clean, 1 = policy violations, 2 = scan/infrastructure error.

import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import {
  join,
  dirname,
  relative,
  resolve,
  sep,
  posix as posixPath,
  win32 as win32Path,
} from 'node:path';
import { builtinModules } from 'node:module';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
// 523 (CI-HERMETIC-SCAN-BUDGET-001): measured recalibration. A local build-free
// full scan is ~18s, but a saturated 2-core CI runner blew the old 60s per-phase
// wall twice (run 31053488358: writer-analysis 60000.8ms; run 31050457808:
// analysis-context) — 180s keeps the ~3x runner multiplier used by 519/522.
const MAX_SCAN_WALL_MS = 180_000;
const NODE_BUILTIN_MODULES = new Set(
  builtinModules.flatMap(name => [
    name,
    name.startsWith('node:') ? name.slice(5) : `node:${name}`,
  ]),
);

export function createScanBudget(
  startedAt = performance.now(),
  maxMs = MAX_SCAN_WALL_MS,
  {
    // 523: measured peaks are 576-615MiB rss / ~350MiB heap; the old 1GiB caps
    // left so little GC slack that V8's lazy collection tripped them on healthy
    // runs (the documented --max-old-space-size=640 workaround). 2GiB still
    // catches runaway growth while eliminating that flake class.
    maxRssBytes = 2 * 1024 * 1024 * 1024,
    maxHeapBytes = 2 * 1024 * 1024 * 1024,
    memorySampler = () => process.memoryUsage(),
    clock = () => performance.now(),
  } = {},
) {
  let operations = 0;
  let peakRssBytes = 0;
  let peakHeapBytes = 0;
  return {
    startedAt,
    maxMs,
    maxRssBytes,
    maxHeapBytes,
    elapsedMs() {
      return clock() - startedAt;
    },
    check(phase, force = false) {
      operations += 1;
      if (!force && operations % 512 !== 0) return;
      const elapsedMs = clock() - startedAt;
      if (elapsedMs > maxMs) {
        throw new Error(
          '[E_HERMETIC_SCAN_BUDGET]'
          + ` ${phase} exceeded ${maxMs}ms`
          + ` (elapsedMs=${elapsedMs}, operations=${operations})`,
        );
      }
      const memory = memorySampler();
      const rssBytes = Number(memory?.rss ?? 0);
      const heapBytes = Number(memory?.heapUsed ?? 0);
      peakRssBytes = Math.max(peakRssBytes, rssBytes);
      peakHeapBytes = Math.max(peakHeapBytes, heapBytes);
      if (rssBytes > maxRssBytes || heapBytes > maxHeapBytes) {
        throw new Error(
          '[E_HERMETIC_SCAN_BUDGET:memory]'
          + ` ${phase} exceeded memory budget`
          + ` (rssBytes=${rssBytes}/${maxRssBytes},`
          + ` heapBytes=${heapBytes}/${maxHeapBytes},`
          + ` operations=${operations})`,
        );
      }
    },
    snapshot() {
      return {
        elapsedMs: this.elapsedMs(),
        operations,
        peakRssBytes,
        peakHeapBytes,
      };
    },
  };
}

// ⚠️ Baselines are computed on a BUILD-FREE tree (no `dist/`). CI's Type Check job
// runs `npm run lint` straight after install, so `dist/` does not exist there; a local
// tree that has been built produces a different graph (2026-08-02: 12392 vs 12463,
// 1196 vs 1200) and this gate then fails for the wrong reason. Before refreshing these
// numbers: `mv dist /tmp/x && npm run lint:hermetic && mv /tmp/x dist`.
// Root cause of the long-running CI red (chronic since at least 2026-08-01): baselines
// were being refreshed on built trees. Making the scan dist-blind is a MASTER-PLAN item.
export const UNRESOLVED_BASELINE = Object.freeze({
  // 2026-08-06 (build-free, COVDEBT-SWEEP): +1 from the nerv-w1 scheduler-
  // fence task-file fixture writes. Prior: COVDEBT-DOCKER-02 (12477).
  // 533 dist-blind: same 12478 count, digest reflects the deterministic
  // build-output edge classification — verified IDENTICAL on built and
  // build-free trees (the point of the fix).
  // 2026-08-06 (P1a): +7 principal contract tests and consumer-pin edits —
  // same 12478 count, digest only. Prior: 533 dist-blind.
  // 2026-08-06 (XPLAT-SKIP-GUARD): +guard test — same 12478, digest only.
  // 2026-08-06 (487 yaprak-dilimi): +2 real-binary replay/fault-injection
  // cases. Prior: XPLAT-SKIP-GUARD (12478).
  // 2026-08-06 (485a): +4 dashboard overlay tests — same 12480, digest only.
  // 2026-08-06 (P1d): +1 config-carry fixture test. Prior: 485a (12480).
  // 2026-08-07 (P1e): +2 end-to-end denial pins. Prior: P1d (12481).
  // 2026-08-08 (APPROVAL-001 T1): unknown-ID fail-closed guard + one canonical
  // autonomousPendingPath resolver (core/constants) shared by every autonomous
  // surface. Already-tracked approval test files gained fail-closed pins, the
  // endpoint test parks through the shared resolver, and approval-redrive gained
  // the park↔read producer→consumer pin; same 12499 count, content digest only.
  // Prior: P1e (a2be3787).
  // 2026-08-09 (STALE-SPRINT-LOCK): +10 — six new stale-sprint liveness fixtures
  // in clean-active-execution-guard.test, each writing a sprint-state.json into a
  // tmpdir fixtureRoot (the same helper the file's existing cases use); the scan
  // counts each write site. Prior: DRIFT-VISIBILITY (12499).
  // 2026-08-11 (NIGHT-DOGFOOD sprints 508-509): −304 — the runtime-floor,
  // heartbeat-contract, annotation-parity, xverify-ux, bot-lifecycle,
  // sprint-log-projection and clean-dashboard-policy suites landed hermetic
  // (tmpdir fixtures) and the doctor fixture modernization retired unresolved
  // entries. Measured on a clean HEAD worktree (b381c03fd) — the dirty
  // shared-worktree scan is ineligible by rule. Prior: STALE-SPRINT-LOCK (12517).
  // 2026-08-11 (sprint-510 harvest): +2 — the generated-skill-durability and
  // plugin-sandbox-wire suites add two tracked tmpdir write sites. Measured on
  // a clean HEAD worktree (27d9bdec4). Prior: NIGHT-DOGFOOD 508-509 (12213).
  // 2026-08-11 (B5/B6 hasadı + mutabakat): +120 — runner-death, archive-authority,
  // status-liveness, error-registry-integrity, fix-spawn, retirement ve force-
  // finalize suite'lerinin tmpdir yazım siteleri. Temiz HEAD worktree (a8c6c0d8d).
  // 2026-08-11 (B10+B11 hasadı): +339 — born-intake, binary-staging, adr-sync,
  // npm-pack, capability-resolution ve config-truth suite'lerinin tmpdir yazım
  // siteleri. Temiz HEAD worktree (0f951956d).
  // 2026-08-08 (TOOL-AUTHORITY filesystem-write-guard): resolveWriteScopeShellEscape
  // predicate pins in provider-command-spec.test + the TASK_ASSIGN wiring pin in
  // spawn-spawner-wire.test (both already-tracked); same 12499 count, digest only.
  // 2026-08-09 (DRIFT-VISIBILITY): exact-plan drift diagnosis + spawn-hint pins
  // in exact-plan-spawn-authority.test (already tracked); same 12499, digest only.
  // 2026-08-12 (FRONT-DOOR-COMPOSITION-HEALTH): the empty-candidate CLI/worker
  // preflight became composition-health-only; ready-path pins replaced the
  // permanent candidate_authority_unavailable pins in the ingress-authority,
  // process-runtime and spawn-spawner-wire suites (all already tracked); same
  // 12774 count, digest only.
  // 2026-08-12 (T2B-PRODUCTION-WIRING): +35 — the sprint-528 hand-closure wave:
  // cross-verify-evidence-preparation + cross-verify-progression suites (tmpdir
  // stores), the codex docker reachability source pins, the producer budget
  // projection pins, and the §12.2-clause-3 follower supersede. Prior:
  // FRONT-DOOR-COMPOSITION-HEALTH (12774).
  // 2026-08-12 (INTERACTIVE-REAUTH-CLOCK): +7 — the ingress interactive-latency
  // regression pin (bulgu #8: post-prompt clock for authenticatedAt, expired-
  // during-prompt fail-closed). Prior: T2B-PRODUCTION-WIRING (12809).
  // 2026-08-12 (PROVIDER-WINDOW-SHAPE): +6 — bulgu #9 pin (codex secondary:null
  // is provider shape, required windows follow the valid snapshot) + the
  // decision-card i18n surfaces. Prior: INTERACTIVE-REAUTH-CLOCK (12816).
  // 2026-08-12 (PROBE-STDIN-I): same 12822 count, digest only — the docker
  // probe `-i` stdin pin (bulgu #10). Prior: PROVIDER-WINDOW-SHAPE (12822).
  // 2026-08-13 (ADVISORY-PROBE-ADMISSION, Öneri-A): same 12822 count, digest
  // only — the producer probe-scoped advisory-limit admission split test.
  // 2026-08-13 (FABLE-SOL-CLOSURE-HARDENING): +25 — the §12.2 closure-hardening
  // wave's new tmpdir-based hermetic sites: the owner-bounded adjudication budget
  // overrun/settle pins (task-result-settlement), the terminally-closed verdict
  // receipt + open-reject + host-decoded CAS tamper pins (cross-verify-evidence-
  // broker), and the durable-fence-across-closure pin. All tmpdir-based (fixture()
  // helpers), never real .tasks/.deckent writes. Prior: PROBE-STDIN-I (12822).
  // 2026-08-13 (CLOSURE-HARDENING-MIGRATE): +2 — the error-migration turn: the
  // DECKENT_E081/E082 reachability-budget catalog entries + the mission-worker
  // parked-HOLD migration re-classified two source sites; digest-and-count only.
  // Prior: FABLE-SOL-CLOSURE-HARDENING (12847).
  // 2026-08-14 (MCP-INSTRUCTIONS-DRIFT-CLOSE): same 12849 count, digest only —
  // the DECKENT_MCP_INSTRUCTIONS `## Tools (49→50)` header + the deckent_approvals
  // list line (Gate G's registered tool was missing from the server instructions
  // string, failing the CI Type Check job's lint-mcp-instructions step). Adding
  // the one template-literal line in src/mcp/server.ts shifted the line numbers of
  // that file's already-tracked unresolved entries; no unresolved symbol added or
  // removed. Prior: CLOSURE-HARDENING-MIGRATE (12849).
  // 2026-08-14 (APPROVAL-PARITY-FIXTURE-CLOSE): same 12849 count, digest only —
  // the first-run test-contract closure (command-registry.ts approvals row,
  // messages.ts summary key, index.test.ts 49→50 pins, scheduler-spawn-executor
  // fixture rewire to the candidate-bound hold seam) shifted the line numbers of
  // those already-tracked files' unresolved entries; no unresolved symbol added or
  // removed. Prior: MCP-INSTRUCTIONS-DRIFT-CLOSE (12849).
  // 2026-08-14 (VERSION-0.100.0-REBASELINE): same 12849 count, digest only — the
  // version/changelog rebaseline edited already-tracked test files (index.test,
  // changelog-update, release.test workflow) and doc-updaters/changelog.ts, and
  // added the fully-resolved tests/release/version-rebaseline.test.ts (all imports
  // resolve → no new unresolved symbol); the line-number shifts move existing
  // entries only. Prior: APPROVAL-PARITY-FIXTURE-CLOSE (12849).
  // 2026-08-14 (REBASELINE-NOGO-FIXES): same 12849 count, digest only — the Codex
  // NO-GO fixes: the upgrade.ts product-successor policy (fully-resolved new exports),
  // the validate-publish.mjs duplicate-heading gate, release.yml/release-prepare.mjs
  // owner-manual edits, and the expanded version-rebaseline/release tests. All imports
  // resolve; line shifts only. Prior: VERSION-0.100.0-REBASELINE (12849).
  // 2026-08-15 (CLOSURE-CLASSIFICATION-PHASE-4.3): +1 — the governance test's
  // MANDATED tmpdir cleanup (Codex phase-4.3 req-3 "add tmpdir cleanup"): an
  // afterAll() that recursive-rmSync's the suite's mkdtemp fixtures. That recursive
  // removal of a dynamic tmpdir path is the ONE new unresolved fs-mutation effect —
  // proven provenance: deleting the afterAll block restores 12849 exactly, and the
  // process.execPath spawn change contributes nothing (original structure +
  // process.execPath = 12849). All the test's imports still resolve; no production
  // module added (production-inventory stays 1232). Prior: REBASELINE-NOGO-FIXES (12849).
  // 2026-08-15 (CLOSURE-CLASSIFICATION-PHASE-4.4): +1 (12850→12851) — Codex phase-4.4
  // req-1 rewrote the governance test's subprocess capture from execFile PIPES to an
  // async spawn whose child stdout/stderr are redirected to OS fds on tmpdir files
  // (immune to the hermetic runtime guard's empty-pipe capture); that spawn+fd-redirect
  // callsite is the ONE new unresolved command effect (proven: reverting only the
  // spawn structure restores 12850). The digest also folds the phase-4.4 req-2/req-3
  // line shifts in lint-master-plan.mjs (canonical extraction to master-plan-integrity.mjs)
  // and the gate — all imports resolve, no other unresolved symbol added.
  // Prior: CLOSURE-CLASSIFICATION-PHASE-4.3 (12850).
  // 2026-08-16 (OWNER-MODEL-POLICY-LOCAL-LLM): +12 — the new hermetic local-llm
  // command/transport/worker suites exercise real tmpdir lifecycle, process probing,
  // file-backed daemon state and child-process boundaries instead of fixture-local
  // reimplementations. Three additional registry-resolved typed error edges replace
  // raw throws at local config/PID and immutable evaluation-receipt boundaries; the
  // model-activation and settlement suites also moved existing effect sites as the
  // production wiring closed. The final effect is a tmpdir-only malformed-receipt
  // write proving immutable audit bytes fail closed instead of being overwritten.
  // Measured from the complete FAZ-0/FAZ-1 closure tree; no live `.tasks`, `.brain`
  // or owner runtime path is admitted.
  // Prior: CLOSURE-CLASSIFICATION-PHASE-4.4 (12851).
  // 2026-08-16 (CLOSURE-OS-GENESIS-ANCHOR): +2 (12863→12865) — the new
  // tests/governance/closure-genesis-anchor.test.ts spawns the genesis
  // provisioning tool (scripts/closure-ledger/genesis-anchor.mjs) via the same
  // real-fd async-spawn harness the ledger governance test uses. The TWO new
  // unresolved effects are (1) its suite mkdtemp + afterAll recursive-rmSync
  // tmpdir cleanup and (2) the spawn+fd-redirect callsite — the identical pair
  // charged for the phase-4.3/4.4 governance test. No production module added
  // (the tool is a scripts/closure-ledger/ subdir script, exempt from the
  // top-level script-registry and outside the production inventory); all imports
  // resolve. Count verified IDENTICAL on the built tree AND with `dist/` moved
  // away (build-free), per the header procedure. Prior: OWNER-MODEL-POLICY-LOCAL-LLM (12863).
  // 2026-08-16 (CLOSURE-OS-GENESIS-ANCHOR-SECURITY-REAUDIT): same 12865 count,
  // digest only. The Codex re-audit fix expanded the genesis test with the
  // fail-closed filesystem corpus (existing private/anchors/fingerprint sentinel
  // refusal, POSIX 0600, symlink/repo-local rejection, --adopt-public-key with
  // zero private artifact, non-ed25519 / malformed reject) — all through the SAME
  // single spawn+fd-redirect callsite and the SAME suite tmpdir lifecycle, so the
  // unresolved-effect COUNT is unchanged; the digest folds the added test line
  // positions. The tool rewrite (O_EXCL/preflight/adopt) is a spawned
  // scripts/closure-ledger/ script, not in the test graph. Verified IDENTICAL
  // built AND build-free. Prior: CLOSURE-OS-GENESIS-ANCHOR (12865).
  // 2026-08-17 (LOCAL-LLM-CI-CLOSURE): post-#126 CI-contract hotfix realigned five
  // test files (config, provider-bootstrap-register, provider-registry-config,
  // eaa-atomic, tmux-prompt-filename) — count-neutral, digest-only on main (12863).
  // Prior: OWNER-MODEL-POLICY-LOCAL-LLM (12863).
  // 2026-08-17 (MERGE genesis←main 0dbefb32c): union of the genesis test file
  // (+2 → 12865) and the local-llm hotfix's count-neutral test edits. Count stays
  // 12865; the digest folds BOTH change sets and is recomputed on the merged tree,
  // verified build-free. Prior: CLOSURE-OS-GENESIS-ANCHOR-SECURITY-REAUDIT (12865)
  // + LOCAL-LLM-CI-CLOSURE (12863).
  // 2026-08-17 (DEV-OPERATING-CONTRACT-001): +94 — the operating-policy gate
  // pair enters the graph for the first time: scripts/lint-operating-policy.mjs
  // (fs read/write/readdir effect sites behind its --check/--write CLI) and the
  // tmpdir-hermetic suite tests/scripts/lint-operating-policy.test.ts. Delta
  // attributed empirically: with ONLY these two files moved out, the scan
  // reproduces the prior 12865:932a83e1… exactly (build-free, dist absent).
  // Prior: MERGE genesis←main (12865).
  // 2026-08-17 (DEV-CONTROL amendment): +56 — lint-operating-policy.mjs gains the
  // DECKENT-DEV-CONTROL parser/validator (one added host readFileSync site + new
  // exported pure functions) and its suite gains 9 control-block negative cases
  // (tmpdir fixture writes). Attributed empirically: with ONLY these two files at
  // their prior HEAD the scan reproduces 12959:2de6a4ba… exactly (build-free).
  // Prior: DEV-OPERATING-CONTRACT-001 (12959).
  // 2026-08-17 (RUN-POLICY-DELIVERY-001): +4 — the Paket B suites enter the
  // graph (run-policy-delivery tmpdir fixture read/write sites + the core
  // authority/settlement suite). Structurally attributed: the only
  // graph-relevant edits in this slice are the two new suites and the
  // production modules they import (which land in the production inventory,
  // not here). Prior: DEV-CONTROL amendment (13015).
  // 2026-08-17 (RUN-POLICY correction turu): same 13019 count, digest only —
  // the owner-analysis correction edits already-tracked files (canonical
  // terminal-boundary gate in result-evaluator/sprint-phases/backlog-eval and
  // the production-entrypoint cases added to the existing Paket B suite).
  // Prior: RUN-POLICY-DELIVERY-001 (13019).
  // 2026-08-17 (RUN-POLICY correction, boundary internalization): same 13019
  // count, digest only — the gate moved INSIDE result-evaluator's three
  // terminal producers (grader wrapper + reconcile wrapper + reconstruction
  // tail); sprint-phases/backlog-eval external wraps reverted.
  // 2026-08-17 (PHASE5-S1, sprint-538 dogfood): +13 — the dry-run bundle
  // builder (scripts/closure-ledger/phase5-dry-run.mjs staging fs sites) and
  // its tmpdir-hermetic governance suite enter the graph. First fully-DONE
  // dogfood-authored code slice under the task-carried run policy.
  // 2026-08-17 (PHASE5-S3, sprint-539 dogfood): +1299 — the signed-writer pair
  // (phase5-writer.mjs claim/append fs+broker sites, phase5-sign.mjs ceremony
  // sites) and their tmpdir suites enter the graph; the writer suite's
  // ApprovalBroker import closure pulls the src/core broker subtree into the
  // test graph for the first time. Only these four new files changed the graph
  // in this slice (sprint records are md/json outside the scan).
  // 2026-08-17 (PHASE5 live-batch closure): same 14331 count, digest only —
  // phase5-writer.mjs claim identity fixed to userInfo().username (approval
  // authority compares live actorId to request.userId; the 'owner' literal
  // failed real decide). No graph membership change.
  // 2026-08-17 (xverify live-channel repair): same 14331 count, digest only —
  // solo tenant mint 'local'→'main' (runtime bootstrap + composition default),
  // xverify claim envelope carries the author model, coordinator identity gate
  // names mismatched facets, ingress task snapshot binds the same arm-aware
  // adjudication budget as its contract. No graph membership change.
  // 2026-08-17 (RUN-INSPECTOR-001 package 1, sprint-541 + Brain completion):
  // net +1 — src/core/run-inspector-read-model.ts + its core suite +
  // tests/api/sprint-inspector-endpoints.test.ts enter the graph while
  // src/orchestra/sprint-live-service.ts and its orchestra suite retire
  // (the API suite's server import closure was already in the graph).
  // 2026-08-17 (RUN-INSPECTOR-001 package 2, sprint-542 + Brain completion):
  // +1 — src/cli/commands/inspect.ts + tests/cli/inspect.test.ts enter the
  // graph; read-model/api/desktop suites changed content only.
  // 2026-08-17 (RUN-INSPECTOR-001 package 3, sprint-543 + Brain completion):
  // +1 — src/mcp/tools/inspect.ts + tests/mcp/inspect.test.ts enter the graph
  // (observer/SSE/Desktop slices changed existing-file content only).
  // 2026-08-17 (RUN-INSPECTOR-001 package 4, sprint-544): +3 — the follow-mode
  // and log-tail slices grew the cli/api/core suites' import closures (new graph
  // members via the observer-injection test seams); no test files were removed.
  // 2026-08-17 (CATALOG-STATS-AUTHORITY-001 correction, sprint-545 + Brain
  // completion): +4 — the three filled stub suites/module (catalog-stats
  // outcome-truth, catalog-stats read-model + its test) and their import
  // closures enter the graph; finalizer/skill-pool/generator/template/collector
  // changed content only.
  // 2026-08-17 (LOCAL-LLM-MODEL-IDENTITY-001): same 14341 count, digest only —
  // openai adapter (typed http/connect errors), native-transport (discovery +
  // identity validation, hardcoded fallback removed), messages and their two
  // suites changed content; no graph membership change.
  // 2026-08-18 (NATIVE-AGENT-HORIZON-001 package 1, sprint-547 + Brain
  // completion): +5 — loop-budget, scratch-checkpoint and native-agent-budget-
  // wiring suites plus the scratch-checkpoint production module and their
  // import closures enter the graph.
  // 2026-08-18 (HORIZON package 2, sprint-548 + Brain completion): +4 —
  // shell-risk module+suite, permission-grants and permission-parity suites
  // enter the graph; loop/permission/events/context-budget/transport/local-llm
  // changed content.
  // 2026-08-18 (ORCHESTRA-RELIABILITY-001, sprint-549 + Brain wiring): +8 —
  // stale-spawnlock-watchdog and result-json-control-char-tolerance suites and
  // their import closures (spawn-coordinator, sanitize seam) enter the graph;
  // worker/collector/evaluator/file-lock/landing-proposal/spawner changed content.
  // 2026-08-18 (NATIVE-AGENT-HORIZON-001 NT-correction, sprint-553 + Brain
  // hand-completion): +7 — tool-result-broker, context-admission,
  // native-agent-scratch-wire and qwen-incident-regression suites plus their
  // import closures enter the graph; loop/transcript/native-transport/run.tsx/
  // bridge/trace-wire/landing-proposal changed content.
  // 2026-08-18 (NT-06 progressive tool surface, sprint-554): +1 net —
  // tool-exposure, loop-exposure-wire and tool-surface-scale suites plus the
  // exposure module enter the graph; loop/session/bridge/registry changed content.
  // 2026-08-18 (556 landing full-suite debt payment): +4 — realigned suites
  // (release/publish owner-contract pins, retirement pins, collector
  // settlement-authority regression guard) changed graph content.
  // 2026-08-18 (7083, sprint-557): same count, digest only — renewal +
  // bootstrap suites and session/bridge/run.tsx/registry content moved.
  // 2026-08-18 (7085 CLI-SURFACE-TRUTH, sprint-559): +6 — new suites
  // (lang-authority, cli-description-catalog, json-output-contract,
  // mcp-description-catalog, lint-cli-surface, cli-surface-truth-battery)
  // enter the graph; ~80 CLI command files + messages.ts content moved.
  // 2026-08-18 (559 landing debt): same count, digest only — mock realigns
  // (getLanguage/resolveLanguage exports), census pin, retro-json stderr
  // realign, doctor/init MCP catalog pins moved graph content.
  // 2026-08-18 (7086 NATIVE-CONTEXT-LIFECYCLE, sprint-560): +1 — new suites
  // (request-measurement, output-ceiling-parity, reasoning-continuation,
  // context-epoch-lineage, context-lifecycle-ux, context-lifecycle-battery)
  // + realigned admission/signal/renewal/transport pins; agent core content moved.
  // 2026-08-18 (skill-unlock, sprint-561): +61 — new suites (profile
  // derivation, routing eligibility, force-delivery, unlock battery, D10
  // lint tests) + 25 task-builder mock realigns + probe/v1 fix pins.
  // 2026-08-18 (7087 @ref tool-mediated read, sprint-562): same count,
  // digest only — at-ref budget/descriptor suites, ranged-read suite,
  // tool-mediated battery + realigned at-ref/describe-tool pins moved content.
  // 2026-08-19 (7088 Faz-1, sprint-563): +2 — stale-adr scan/battery suites
  // enter; web.test.ts retired; index/cli-inventory/messages pins moved.
  // 2026-08-19 (7089 NATIVE-SESSION-LEDGER, sprint-564 + ADR-D-007 el-kapama):
  // +9 — session-ledger + project-slug suites enter (tmpdir/injected-root
  // fixtures), scratch-checkpoint recovery-reuse/reaper fixtures, the
  // registry contentStore spill pin and the bridge nextTurnIndex continuity
  // pin; app-surface/trace-wire pins moved content. Prior: 7088 Faz-1 (14440).
  // 2026-08-19 (7091 CURSOR-PROVIDER, sprint-565 + el-kapama): +15 — cursor
  // adapter/spec/capability/discovery/auth-probe suites + cursor-evidence-sources
  // stub suite enter; provider pins realigned. Prior: 7089 (14449).
  // 2026-08-19 (7094-F1 Fable-subprocess dalgası): same 14464 count, digest
  // only — F1a/F1c/F1d pin realignments (landing-coordinator order, routing
  // domain-overlap pins, plan/hb protocol pins) moved tracked content.
  // 2026-08-19 (7094-R debt/dependency onarım paketi): +1 — the
  // debt-injection-success-echo suite enters (pure in-memory fixtures);
  // dep-ref-loud gains debt-prepend index pins, result-evaluator gains the
  // doc-honesty pins, task-lineage gains blocked-edge pins (content moves).
  // 2026-08-19 (7094-R full-suite triage): +2 — F1d fixture-mtime alignment
  // (utimesSync write sites in task-restoration + evaluate-trigger-gate +
  // runtime-extension + liveness-adopt count as tracked writes); brain/
  // honesty-replay/brain-skill pins realigned to the F1d/573-ceiling wording.
  // 2026-08-20 (7097 evaluator-honesty package): same 14467 count, digest
  // only — typed-suite gains the B3 unevidenced-claim ceiling pins; existing
  // evaluator pins' tracked content moved.
  // 2026-08-20 (7093+7081 truth wave): +4 — the broker slice suite writes
  // two pinned-fixture files and the schema-normalization pins land in
  // live-execution-budget; token-counter/xverify-ux pins realigned.
  // 2026-08-20 (7081 carousel layer-2): same 14471 count, digest only —
  // preparation/truth-store/producer pins realigned to the approval-skip +
  // canonical-refresh reuse contract.
  // 2026-08-20 (EVALUATION-001 first brick + 7098 canary): same 14471 count,
  // digest only — criterion-evaluation kernel suite (tmpdir fixtures) plus
  // the canary-landed skill-force-delivery/forced-skill-lineage-wire pins.
  // 2026-08-20 (cadence full-suite reconciliation): same 14471 count, digest
  // only — salvage-gate pins, chat-suite spawnSync mocks and the 7093/7091
  // pin realignments moved tracked test content; measured on the final
  // landing tree.
  // 2026-08-20 (ADR-G-040 verdict vocabulary + decision wave): −3 — the
  // chat-suite child_process mocks' rework retired three unresolved write
  // sites; the verdict-types suite's tmpdir fixture is tracked clean.
  // 2026-08-20 (acceptance-matrix slice): +2 — the acceptance-matrix audit
  // suite's two tmpdir fixture writes (observe-stamp + unstamped-HOLD pins).
  // 2026-08-20 (adapter-runtime slice): +2 — the acceptance-enforcement
  // suite's confirmation-store tmpdir fixtures (create/settle + CLI decide).
  // 2026-08-20 (codex usage-log selection fix): +1 — the probe-debris
  // shadowing regression pin writes a second sibling rollout fixture.
  // 2026-08-20 (D1 federated inbox): same 14473 count, digest only — the
  // federation suite's tmpdir store fixtures are tracked clean.
  // 2026-08-20 (DE1 short codes): same 14473 count, digest only — the
  // short-code suite is pure-compute; tracked content moved.
  // 2026-08-20 (DE2a rules): drift from the approval-rules suite fixtures.
  // 2026-08-20 (D2a bridge): drift from the decision-federation suite fixtures.
  // 2026-08-20 (sprint-589 i18n factory package): tracked content moved.
  // 2026-08-20 (590 + D2b-1): status-output suite + federation fixtures.
  // 2026-08-20 (591 i18n wave + D2b-2a rules engine): +1 — the rules-engine
  // suite's tmpdir approval-rules fixtures; the new approvals-endpoint API
  // suite is tracked clean.
  // 2026-08-20 (D2b-2a live-proof fixes): same 14478 count, digest only —
  // the rules-engine suite gained the end-to-end broker/ingress and
  // consumer-validation pins (tracked content moved).
  // 2026-08-21 (7094 wave-2/3/4 + 7091): +5 — the docker-mounts suite's
  // catalog-mask tmpdir fixtures, the work-model profile suite, and the
  // wave-4 fail-soft/allowlist fixture writes.
  // 2026-08-21 (codex-prefix waves + handoff tooling): same 14483 count,
  // digest only — the authority-handoff CLI sandbox suite and the prefix
  // spec/config pin realignments moved tracked test content.
  // 2026-08-21 (D3+DE3 waves 599-603 + live-defect fixes): +22 — the channel
  // authenticator / bot-relay / bootstrap / callback / clients suites' tmpdir
  // and mock-transport fixtures across the five waves.
  // 2026-08-21 (3322 Docker evidence recovery closure): +11 — the provider-
  // limits authoring and Claude-Docker integration suites' tmpdir cleanup,
  // Codex evidence/config and provider-bootstrap tmpdir fixtures, plus the two
  // task-artifact projection-parity fixture writes. Every site is bounded to a
  // suite-owned tmpdir or injected filesystem seam; the 10-file scoped battery
  // passed 122/122 and the registry attribution was measured from these exact
  // changed test paths. Prior: D3+DE3 waves (14505).
  // 2026-08-21 (3322 observe-only/CAS correction): +8 — the producer's
  // source-revision cooldown regression and the Docker probe's provider-exit /
  // response-envelope classification pins extend the same injected-store,
  // injected-runner and suite-owned tmpdir family. The combined final battery
  // passed 15 files / 201 tests; no live .tasks, .brain or owner runtime path
  // entered test authority. Prior: 3322 Docker evidence recovery (14516).
  // 2026-08-21 (4056 D4 approval lifecycle): +139 — 65 lifecycle suites cover
  // private/FWW CAS, injected clocks, restart-safe stores, child-process
  // pairing proof, read-only projections and suite-owned tmpdir cleanup across
  // confirmation, autonomous, pairing and broker-native origins. The combined
  // battery passed 298/298; the scanner measured 0 confirmed violations and no
  // test writes to the repository's live .tasks/.brain/runtime authority.
  // Prior: 3322 observe-only/CAS correction (14524).
  // 2026-08-22 (9040 acceptance authority-restart closure): +155 — the
  // confirmation contract/store/reconciler/composition, tenant-CAS debt,
  // controller-branch, CLI/API and 10k restart/race suites add only
  // suite-owned tmpdir/SQLite fixtures, injected clocks and hermetic child
  // process proof. The 33-file acceptance family passed 226/226 and the 17-file
  // evaluator/routing neighbour battery passed 305/305; no live repo task,
  // memory or runtime authority is admitted. Prior: 4056 D4 (14663).
  // 2026-08-22 runtime hygiene follow-up: count unchanged; digest-only update
  // because the existing hermetic gitignore suite now enumerates the new
  // acceptance-reconciliation SQLite DB plus WAL/SHM sidecars.
  // 2026-08-22 (7092 RECOVERY-TRUTH): +128 — the result-write, corrupt-result,
  // immutable-receipt, task-terminal, landing-consumer, review, continuous-
  // quiescence, recovery-policy/status/finalizer and nine-case/real-binary
  // suites add suite-owned tmpdir fixtures, injected platform adapters and
  // bounded async child-process proof. Root verification passed the 27-file
  // recovery battery (200 pass, 2 skip) plus 253 adjacent regressions; the
  // measured 10k case remained below ten seconds and no live repo task,
  // memory or runtime authority entered test ownership. Prior: 9040 runtime
  // hygiene follow-up (14818).
  // 2026-08-22 (canonical sprint archive handoff): +3 — the new archive
  // reconciliation suite uses only suite-owned tmpdir/SQLite fixtures to pin
  // lossless retirement, hash-addressed conflicts, Brain semantic indexing,
  // tamper detection and read-only dry-run behavior. The wider archive/finalizer
  // battery passed with zero live-repository authority writes. Prior: 7092
  // RECOVERY-TRUTH (14946).
  // 2026-08-22 archive ownership hardening: count unchanged; digest-only update
  // after the hermetic fixtures began pinning exact sprint ownership and the
  // canonical DIRECTIVES reference instead of the retired Brain raw path.
  // 2026-08-22 (completed-checkpoint dynamic FIX evidence recovery): same
  // 14949 count, digest only — the existing terminalizer suite now pins the
  // canonical finalizer loader's dynamically discovered FIX-task evidence.
  // 2026-08-22 (crash-before-prepare terminal identity recovery): same count,
  // digest only — task-result authority now projects a closed host recovery
  // settlement as deterministic zero-work pre-dispatch evidence.
  // 2026-08-22 (PROVIDER-OBS-MIGRATION-001): +21 — the migration, adoption,
  // approval and real-process CLI proof suites plus adjacent legacy-store and
  // connector partial-start cases add only suite-owned tmpdir/SQLite lifecycle,
  // tamper and symlink effects. The source-derived registry reported zero
  // confirmed violations; no live repo database, task or owner authority entered
  // test ownership. Notification drain tests are injected-timer/adapter based.
  // 2026-08-22 (provider-observation canonical-path closure): +2 — suite-owned
  // tmpdir SQLite fixtures now prove the real CLI default selects the canonical
  // `.db` authority without WAL/SHM/migration writes, and pin text-source NUL
  // hygiene. Source-derived scanning still reports zero confirmed violations.
  // 2026-08-22 (durable provider-adoption closure): +50 — the receipt-store,
  // adversarial and real compiled-process suites add only suite-owned tmpdir /
  // SQLite fixtures, create-only private receipt files, bounded child-process
  // restart/replay and finalizer durable-task fixtures. Host-policy coverage
  // pins owner-controlled 0755 `.deckent`, rejects group-writable 0775, and
  // keeps every receipt descendant 0700/0600. The 24-file scoped battery passed
  // 315 tests (4 intentional skips); no live repo authority path is admitted.
  // 2026-08-23 (sprint identity recovery): +2 — the existing tmpdir-backed
  // sequence tests now pin legacy epoch-ID exclusion and reject a timestamp
  // identity at the config-write boundary. Both sites use mocked fs effects;
  // no live `.deckent`, `.tasks` or Brain authority is mutated by the suite.
  // 2026-08-23 (runtime hygiene + repository cleanup landing): +93 — archive,
  // retention, provider-adoption and runtime-hygiene suites use suite-owned
  // tmpdir/SQLite fixtures and bounded compiled-process smoke paths. The
  // source-derived scan measured zero confirmed live-authority violations;
  // removal of the unwired `.deckent/i18n` fixture also retires its legacy
  // live-read exception instead of grandfathering it.
  // 2026-08-23 (retired-plan identity floor recovery): count unchanged;
  // digest-only update after the existing run-flow decision suite began
  // pinning that an approved but unstarted exact plan consumes its ordinal
  // identity when durably retired. The proof remains suite-owned tmpdir state.
  // 2026-08-23 (final-only manual-spawn real-binary canary): +1 — the new
  // built-CLI proof launches one bounded child process against a suite-owned
  // tmpdir project/host fixture and fails before Docker/provider dispatch when
  // the canonical task lacks its owner grant. No live repo config or runtime
  // authority is read or mutated.
  // 2026-08-23 terminal archive seal: suite-owned journal/seq/Brain fixtures,
  // including retired-counter replay and detached live-WAL projection reads.
  // 2026-08-24 sprint-635 acceptance: same-commit outer-finalizer projection
  // regression plus protected-root debt scope fixtures.
  // 2026-08-24 provider-observation reconciliation: +25 — planning, approval,
  // receipt, CLI and fan-in suites use only suite-owned tmpdir/SQLite stores,
  // live-auth test doubles and bounded durable files. The source-derived scan
  // reports zero violations; no repository task, Brain or owner state is test-
  // owned. The digest also binds the all-vs-filtered TOCTOU and forged-capability
  // landing regressions.
  // 2026-08-24 retired-flow settlement + bot readiness: +5 suite-owned task
  // projection/receipt fixture writes pin exact NOT_DISPATCHED fan-out and
  // start→ownership-record readiness. All roots remain disposable tmpdirs;
  // the source-derived scan measured zero confirmed live-authority violations.
  // The terminal-only reconciliation composition regression remains in the
  // same tmpdir/mock inventory; count unchanged, digest binds the no-OIDC pin.
  // Root landing verification: +4 real scratch filesystem/MemoryStore fixture
  // boundaries replace module-global DB/process doubles in finalizer/debt
  // integration. Every root remains tmpdir-owned and is removed after the
  // suite; the compiled runtime-hygiene fixture likewise uses a valid scratch
  // Brain DB instead of counterfeit bytes. Production authority is never
  // opened or mutated by these tests.
  // 2026-08-24 D4 formal-closure recovery: same 15823 count, digest only — two
  // pre-cutover assertions now pin the canonical read-only terminal projection
  // and legacy human-command routing contract. No fixture root or effect class
  // changed; the dedicated time-drift regression remains tmpdir-owned.
  // 2026-08-24 Cursor production wiring: count unchanged, digest only — the
  // Docker probe now exercises the logical-provider auth bridge and the fan-in
  // suite uses async-disposable tmpdirs. No new unresolved effect is admitted.
  // 2026-08-24 runtime-adoption closure: +16 — immutable receipt, compiled
  // entrypoint, process-ownership and database byte-stability suites exercise
  // suite-owned tmpdir/SQLite stores, permission/symlink fault injection and
  // bounded child processes. The source-derived scan reports zero confirmed
  // live-authority violations; no repository runtime state is test-owned.
  // 2026-08-24 prompt-cost canary authority: +13 — the archive reader,
  // immutable receipt and real compiled-CLI fan-in suites add 9 core-fixture
  // and 4 integration-fixture effects. Every path is rooted in a suite-owned
  // mkdtemp checkout; production archive sealing, tamper/symlink refusal and
  // no-replace receipt replay are exercised without repository-state writes.
  // Plan-time task-authority and FIX-inheritance proofs move the unresolved
  // callsite fingerprint without changing its measured count. The source-
  // derived scan still reports zero confirmed live-authority violations.
  // 2026-08-24 bot clean-guard schema-v2 closure: +11 unresolved static
  // callsites exercise active/dead/malformed v2 PID records in suite-owned
  // tmpdirs; runtime identity digests are synthetic non-secret fixtures. The
  // prompt-cost archive-rejection assertion moves only callsite fingerprints.
  // The source-derived scan reports zero confirmed live-authority violations.
  // 2026-08-24 XVERIFY-WIRE-001: +140 — exact-pair authority, hostile runner
  // composition and compiled-CLI integration suites exercise only suite-owned
  // tmpdir/config/task/receipt fixtures and bounded child processes. Existing
  // settlement/config/message tests move tracked callsite fingerprints. The
  // final causal rewrite adds seven tmpdir/store/settlement effects while
  // replacing the disconnected synthetic invocation fixture with the real
  // preparation → production-ingress → runner chain. The source-derived scan
  // reports zero confirmed live-authority violations.
  // 2026-08-24 XVERIFY-RESPONSE-BUDGET-001: +5 — exact semantic/raw budget
  // parity exercises suite-owned tmpdir settlement roots and durable receipt
  // boundaries. Parser-only limits remain effect-free; the source-derived scan
  // reports zero confirmed live-authority violations.
  // 2026-08-24 XVerify settlement projection parity: +1 — the production fan-in
  // regression writes only its suite-owned tmpdir task projection and proves
  // exact closed-settlement PENDING→DONE convergence. Scanner: zero confirmed
  // live-authority violations.
  // 2026-08-24 Closure trust-anchor identity wiring: +1 — Phase-5 dry-run
  // rotation/conflict coverage writes only suite-owned tmpdir bundles and
  // trust-anchor fixtures. Scanner: zero confirmed live-authority violations.
  // 2026-08-24 sprint-649 archive replay hardening: +8 — sequential Brain
  // adoption, historical terminal replay and FIX-attempt archive fixtures use
  // only suite-owned tmpdirs. Scanner: zero confirmed live-authority violations.
  // 2026-08-24 sprint-652 evaluator applicability closure: +4 — the FIX
  // production fan-in regression creates, reads and removes only its own
  // async mkdtemp root. The evaluator-consistency pin now accounts for the
  // two explicit applicability audit rows; no live repository authority is
  // read or mutated by either suite.
  // Root acceptance recovery keeps the count unchanged: recordFixEvaluationAudit
  // restores its documented direct/recovery receipt while the live ingest path
  // declares its already-written canonical receipt. The digest moves only with
  // the existing sprint-phases production callsites; scanner violations remain 0.
  // 2026-08-24 prompt compile authority P0: +2 — the production-chain canary's
  // additional parse→Task→prompt case creates and retires only its suite-owned
  // mkdtemp root. No live repository authority is read or mutated.
  // 2026-08-24 prompt-delivery settlement closure: +25 — current/malformed
  // receipt fixtures plus the real route→body resolver→prompt→Docker settlement
  // chain operate only inside suite-owned mkdtemp projects. Compile-only prompt
  // callers no longer attempt a live `.tasks` write; scanner violations remain 0.
  // 2026-08-24 typed verification authority follow-through: count unchanged;
  // digest binds the registry/evaluator regression that makes the canonical
  // task.verification block authoritative while preserving the legacy prose
  // adapter, plus authority-matched structured PASSED evidence consumption.
  // The fixtures are pure in-memory task/result shapes.
  // 2026-08-24 sprint-661 execution-authority recovery: +2 — canonical scope
  // admission and scheduler settlement regressions use only suite-owned
  // fixtures. The source-derived scan reports zero confirmed violations.
  // 2026-08-24 sprint-661 manual ADR-D-007 closure: +32 — worker-activity
  // heartbeat v1, execution-write-scope-policy and host-primary stale-worker
  // suites (9 new descriptors + reworked result/heartbeat fixtures), all
  // suite-owned in-memory shapes; scan reports zero confirmed violations.
  // 2026-08-24 HIGH-3/4 closure: +7 — hostTerminalProjection passthrough,
  // legacy-evaluation resolution, depth-2 fix-chain and config-owned canary
  // threshold regressions; all suite-owned in-memory/tmpdir fixtures.
  // 2026-08-24 HIGH-5 + 7091 fold: count unchanged, digest moved — bot-daemon
  // token-proven legacy stop pin reworked in place; suite-owned fixtures only.
  // 2026-08-25 coordinator string-shape recovery: +2 — canonical FileChange
  // regression pin (quality-assessor) and worker-authored 664 suites.
  // 2026-08-25 canary token-authority (owner decision): count unchanged, digest
  // moved — kernel/default-flip pins reworked in place; suite-owned fixtures only.
  // 2026-08-25 directives pipeline gate: +10 — tests/scripts/lint-directives.test.ts
  // (typed-problem pins + tmpdir import-scan roundtrip; fully tmpdir-hermetic).
  // 2026-08-25 sprint-670 manual closure: count unchanged, digest moved —
  // nervous-flow host-primary fixture + finalize-orphan logicalMetrics mock
  // realigned in place (both suite-owned; no new tests).
  // 2026-08-25 sprint-671 wave harvest: +4 — worker-authored pins across
  // notification-delivery/multi-ide/event-stream/auditor suites plus the new
  // config-notification-outbox-fields suite (all tmpdir-hermetic).
  // 2026-08-25 config-loss hardening follow-up: +2 — additional worker pins
  // landed with the 671 harvest sweep (suite-owned tmpdir fixtures).
  // 2026-08-25 cli-surface-truth merge: +189 — the lane's three new guard
  // suites (lint-cli-surface, cli-docs-contract, gen-reference-docs) and
  // reworked cli test fixtures; all suite-owned.
  // 2026-08-25 A3 event-truth wave (sprint-674+675 + landing hand-fixes): +7 —
  // worker-authored suites (worker-heartbeat-file, worker-heartbeat-single-writer,
  // event-stream-monotonic, run-status-readiness, status-readiness-parity,
  // event-truth-wave-evidence) + the owner-directed task-result-field-order pin;
  // all tmpdir-hermetic, suite-owned.
  // 2026-08-25 exploration-bonus wave (sprint-676): +1 — worker-authored
  // tests/core/routing/exploration-bonus.test.ts (default-0 neutrality +
  // nonzero behavior pins; tmpdir-hermetic, suite-owned).
  // 2026-08-25 gece C-dalgasi + strike-5 + mock-drift onarimi: +8 —
  // strike-5 EISDIR pini (config-corrupted-recovery) + C-dalgasi worker
  // suite'leri (temp-agent-dryrun-purity, plan-preview-parity,
  // build-clean-hold-exit) + slice-onarimlarindaki fixture-effect ekleri;
  // hepsi tmpdir-hermetik, suite-owned.
  // 2026-08-26 xverify-onarim dalgasi (sprint-678): +2 — worker-authored
  // tests/cli/xverify-evidence-scope.test.ts + fencing/ingress pin ekleri
  // (tmpdir-hermetik, suite-owned).
  // 2026-08-26 23:4x: 16511→16513 — Dalga-1 (sprint-692) worker-suite'leri:
  // tests/cli/sync-skill.test.ts + tests/cli/skill-create-gate.test.ts
  // (tmpdir-hermetik, suite-owned) + v2-derivation fixture eklentileri.
  // 2026-08-27 02:0x: 16513→16514 — Dalga-3 (sprint-697) worker-suite'i:
  // tests/cli/sync-workspace.test.ts (tmpdir-hermetik, suite-owned).
  // 2026-08-27 11:4x: ayni 16579, digest-only — CI-hizalama: race-barrier taban
  // hizasi + ingress-pin 739 + PLATFORM.md regen (taranan metin kaydi).
  // 2026-08-27 20:5x: 16611→16613 — sprint-703 (publication-contract) suite'leri
  // (terminal-publication + mixed-outcome classifier + block-trace probe).
  // 2026-08-27 19:2x: 16604→16611 — sprint-702 (do-kaynakli reform-batch) suite'leri
  // (alias-forwarding/folds/federation/limits/truth/catalog) + el-kapanis kaymalari.
  // 2026-08-27 17:2x: help-revizyonu (owner): dikey liste + deprecated-blok kaldirildi;
  // pin-hizalari. digest-only ya da kucuk sayim.
  // 2026-08-27 17:0x: 16592→16604 — sprint-701 (CLI dilim-1a) suite'leri:
  // surface-registry + root-help + lint-cli-surface + parity-registry testleri
  // (tmpdir-hermetik) + ana-serit el-kapanis pin/fixture hizalari.
  // 2026-08-27 16:2x: digest-only — 3301 son-metre seam zinciri src kaymalari
  // (policy-terminal helper + lineage POLICY_FIX_EXEMPT + controller/finalizer
  // normalizasyon + honesty-muafiyet + cascade-skip host-kimlik + cleanup-filter).
  // 2026-08-27 15:5x: 16588→16592 — sprint-700 (do-kaynakli 3284-dilimi) suite'leri:
  // fix-gate + constraint-inheritance + scheduler-effects/reducer testleri
  // (tmpdir-hermetik, suite-owned) + 699-zincir pin-hizasi.
  // 2026-08-27 15:1x: ayni 16588, digest-only — c204e09fe kirmizisi: canli-sinir
  // kablosu (sprint-phases prepare-boundary) pin-SONRASI eklenip digest tazelenmeden
  // commitlenmisti; digest-en-son ritueli ihlal kaydi + duzeltme.
  // 2026-08-27 14:3x: 16579→16588 — sprint-699 disposition-suite'leri (tmpdir-hermetik,
  // suite-owned): failure-disposition-policy + collector-disposition + disposition-event
  // + chain-seal; ana-serit seam-fix kaymalari dahil.
  // 2026-08-27 10:5x: 16522→16579 — sprint-698 mekanizma-suite'leri (tmpdir-hermetik,
  // suite-owned): skill-package-sync-proof e2e + sync-skill body/profil pinleri +
  // clean-guard orphan-disposal senaryolari + run-flow truncation testleri; ayrica
  // ana-serit hermetiklik-onarimi (cross-process reason çift-sinif kabulü).
  // 2026-08-27 10:3x: ayni 16522, digest-only — CI-onarim paketi (3219f3ae2 kirmizisi):
  // doctor-suite constants-mock spread donusumleri + platform-registry drift-suite
  // in-sync cevirimi + output.test budget-sabiti; taranan metin kaydi.
  // 2026-08-27 08:2x: 16514→16522 — owner-onaylı sabah paketi: yeni regresyon-pini
  // tests/core/preflight-typecheck-preference.test.ts (tmpdir-hermetik, suite-owned,
  // child_process spawnSync mock'lu — gerçek komut koşmaz) + budget-fix test ekleri
  // (output.test.ts config-default pini, doctor.test.ts iki budget senaryosu).
  // 2026-08-28 10:1x: 16627→16689 — MASTER 3356 P1: doc↔CLI-surface truth gate'inin
  // hermetik süiti (fixture repo tmpdir'de kurulur; gerçek repo okunmaz).
  // 2026-08-28 10:0x: 16621→16627 — MASTER 3356 P0 paketi: worker-core teslimatının
  // backend-yetenek kapısı (worker-core-backend-capability suite'i) + MCP karar-disposition
  // kapısının catalog-parity pinleri; ikisi de tmpdir-hermetik, gerçek process/DB yok.
  // 2026-08-28 09:0x: 16613→16621 — MASTER 3284 çekirdek dilimi (sprint-704):
  // repair-overflow-dispatch / repair-queue-authority / repair-quiescence-gate /
  // repair-dispatch-chain-seal suite'leri (hepsi tmpdir-hermetik, spawnWorkers ve
  // waitForResults seam'leri inject edilir; gerçek process doğmaz).
  // 2026-08-29 SKILL_ROUTING_CONTROL_PLANE_P0: 16708→16783 — applicability,
  // 1000-skill/concurrent selection, journal replay, causal attribution,
  // logical-outcome projection, crash-resumable migration and measured 39-task
  // archive replay suites, plus the catalog-mediated atomic writer boundary.
  // The writer resolves its operation catalog on first mutation instead of at
  // module load, retiring six eager unresolved edges and preserving import
  // hermeticity without weakening its fail-closed authority assertion.
  // All test writes are confined to suite-owned tmpdirs;
  // the real-binary migration fixture is operator-run evidence, not a test write.
  // 2026-08-29 OPERATION-COVERAGE-MODEL-001 bounded ADR-D-007 recovery:
  // 16783→16801 — canonical-catalog provenance, exact unbound-attribution,
  // unknown-effect refusal, comparative baseline migration and POSIX/Windows/WSL
  // identity cases. Async child execution remains tmpdir-owned with real-fd
  // capture; the source-derived scan reports zero confirmed violations.
  // 2026-08-29 OPERATION-001 ADR-D-007 recovery: source-derived rescan after
  // the fixture mutation loop and bounded child timeout were corrected.
  // 2026-08-29 OPERATION-INVOCATION-CONTEXT-001 Task1-10 plus the blocking
  // 4031↔4032 canonical generated-catalog provenance repair: source-derived
  // final-tree rescan; 0 confirmed violations; unresolved 16817/56d4ae65,
  // production 1372/7a0322c7.
  // 2026-09-03 Terminal/Fable main landing ratchet: 17711→18130. The complete
  // native Terminal picker, readability, session-authority, provider-evidence
  // and model-catalog graph is present together with its hermetic proof suites.
  // A build-free source scan reports zero confirmed live-authority violations;
  // unresolved entries remain exact source-derived fingerprints, never a path
  // allowlist or hand-authored success registry.
  // 2026-09-03 final model-authority fail-closed proof: 18130→18132 from two
  // corrupt-existing-store fixtures; both stay tmpdir-owned and provider-free.
  count: 18132,
  // 2026-08-28 OPERATION-001 O3 ratchet: count unchanged, digest-only —
  // operation-ingress audit moved from report-only proof to a fail-closed
  // lint:gates member with hermetic regression coverage.
  // 2026-08-29 dogfood-surface F1/F2/F3 closure: count unchanged, digest-only —
  // prompt-gate authority pins, exact run file-scope contracts and the
  // file-backed async script-registry CLI harness update scanned source text.
  // 2026-08-29 settlement-recovery O4: 16696→16708 — dispatched-result,
  // abandoned-dispatch and receipt-reprojection authority cases plus clean's
  // exact terminal-recognition assertions remain suite-owned and hermetic.
  // 2026-08-25 B-sweep: digest moved — --fix roundtrip pin, multi-label
  // parser pin, same-line rule downgraded to WARN (all suite-owned).
  // 2026-08-25 7141 wave: count unchanged, digest moved — the src-side
  // throw->DeckentError conversion shifted scanned text; tests/ untouched.
  // 2026-08-25 tail alignment: +1 — auditor suites re-pinned to the canonical
  // progress contract (path-aware read-model harness) + incident-contract pins.
  // 2026-08-25 strike-4 fix: count unchanged, digest moved — config.ts
  // self-heal reordered to write-then-swap; scanned text shifted.
  // 2026-08-25 A2 routing-fairness wave: lane harvest + manual closure
  // (cells contract, journal coverage, doctor health, ci-guardian manifest).
  // 2026-08-25 docs consolidation: dead github-pages-deploy test removed with
  // its PAUSED workflow (one unresolved entry retired).
  // 2026-08-25 A3 wave: digest folds the seven new suites plus src-side shifts
  // (hb primitive, event-seq CAS, read-model CAS/readiness, flow-terminal join,
  // status readiness cutover, dependency shape-fix, result field-order serializer).
  // 2026-08-25 exploration-bonus wave: digest folds the new suite plus
  // config-knob/blend/story src shifts and worker test-file edits.
  // 2026-08-25 gece: digest yedi yeni/duzenlenmis suite + C-dalgasi ve
  // el-fix src kaymalarini katlar (heal-gate, plan-purity, lock-ownership,
  // close-stale, budget-authoring, classifier, spawn-authority).
  // 2026-08-26 00:05 landing-kuyrugu: ayni 16315, digest-only — suite-4
  // kalanlarinin onarimi (mcp-plan approve-override, contract SSOT x2,
  // EXECUTE_OPT_IN_RE bilesik-bayrak fix'i, error-baseline ratchet).
  // 2026-08-26 xverify dalgasi: digest evidence-scope/fence/detail src+test
  // kaymalarini katlar.
  // 2026-08-26 01:00: ayni 16317, digest-only — oversize-filtre el-fix'i +
  // evidence-scope pini + lessons-doc.
  // 2026-08-26 02:10: ayni 16317, digest-only — sprint-679 hasadi
  // (dockerignore-pin suite + messages.ts oksuz-anahtar silimi).
  // 2026-08-26 07:35: 16317→16415 — G0-A config-containment dalgasi (sprint-680
  // + ADR-D-007 el-tamamlama): yeni suite'ler config-write-authority /
  // heal-preimage / heal-race / lint-config-writers + init.test.ts mock-genisletme.
  // 2026-08-26 08:35: 16415→16497 — Node-2 kalite-kapilari dalgasi (sprint-681):
  // tsc-settlement-gate / honest-gate-deletion-aware / lint-mock-factories /
  // lint-directives selfchange + errors.test.ts forensic-kanal eklentileri.
  // 2026-08-26 10:02: 16497→16502 — Node-5 settlement-atomigi (sprint-682 4/4):
  // landing-proposal-entry + checkpoint-freshness + causal-authority +
  // descendant-cancellation suite eklentileri.
  // 2026-08-26 10:36: 16502→16504 — Node-4 recovery-born mikro-paketi
  // (sprint-683 6/6 + sidecar-loader hotfix): heartbeat-fence / classifier /
  // attribution-baseline / finalize-retirement + isCanonicalTaskFilename pinleri.
  // 2026-08-26 11:04: 16504→16506 — Node-6a mekanik supurme (sprint-684 3/3):
  // death-sweep hijyen + worker-identity-hostbound + docker-git-async suiteleri.
  // 2026-08-28 12:1x: 16692→16696 — MASTER 6181 dilim-3 (sprint-707): watch-capability ·
  // watch-flow · flow-scheduler-timezone · intelligence CLI · watch-closure-integration
  // süitleri; gerçek-binary vakası authored ve build-ritüeli gerekçesiyle açıkça skip.
  // 2026-08-28 11:2x: 16689→16692 — MASTER 6181 dilim-2 (sprint-706): source-retrieval ·
  // event-history · alert-formatter · watch-service süitleri; hepsi enjekte fetch/store/saat
  // ile koşar, gerçek ağ ve gerçek DB yok.
  // 2026-08-28 10:5x: digest 4c78772b→8b1349fe — 3356 P5: self-audit hold'unun süreç-kanıtı
  // pinleri (timeout · adapter-hold · sızıntı-yokluğu · sınır-çökmesi ayrımı).
  // 2026-08-28 10:1x: digest 3f71a5e1→4c78772b — doc-command-truth süiti.
  // 2026-08-28 10:0x: digest 10164164→3f71a5e1 — 3356 P0 paketi suite'leri + iki eski
  // externalization pininin backend-argümanıyla güncellenmesi.
  // 2026-08-28 09:0x: digest 6820cbff→10164164 — sprint-704 repair-queue suite'leri
  // + sprintId/settle el-kapanışının test-metni etkisi.
  // 2026-08-29 ADR-D-007 planner recovery: count unchanged; digest-only update
  // after planner prompt delivery moved from argv to the owned child stdin.
  // Post-build closure scripts changed after the first T14 ratchet; the count
  // remains exact while this digest seals their final source bytes.
  // 2026-09-03 T14 final seal: recovery-only diagnostic branches were removed
  // before the production build; the exact unresolved count stays unchanged.
  // 2026-09-03 Terminal/Fable closure: project-scoped active-model guards and
  // corrupt/invalid-store HOLD tests replace the final fail-open execution edge.
  // 2026-09-04 (3331 RECOVERY-BORN-NATIVE-DO-SLASH-PROVIDER-BOOTSTRAP-001): +1 i18n key
  // `do.slash_no_providers` shifted messages.ts production:eager-call-unresolved callsite
  // digests — same 18132 count, digest only (HEAD-vs-tree diff: only messages.ts
  // identities moved, no new unresolved edge).
  digest: '36336895d901c2317b776f41b21bad3115322e37103ebc0f618db523abf94572',
  // 2026-08-27 04:0x: ayni 16514, digest-only — full-suite hizalama batch'i
  // (pin/mock/census guncellemeleri + sync guard).
  // 2026-08-27 03:1x: ayni 16514, digest-only — CI-hizalama paketi
  // (profil-haritasi 4-entry + count-pin 21→22 + skill-pool readJsonSafe).
  // 2026-08-26 17:4x: ayni 16511, digest-only — Faz-B test-slim merge
  // (66 kaynak emekli, equality 57/57) + CI-F004 guard flag-siniflandirmasi
  // (runtime-write-guard open-patch + probe/matris eklentileri) + CI-F005
  // mock-factory ledger guncellemesi (1 canonical path + 1 dusum + 3 dupe
  // birlesimi, pin-testi 276→272).
  // 2026-08-26 15:1x: ayni 16511, digest-only — CI-kapanis S1 src-fix'leri
  // (fsync 'r+' x3 + heartbeat dir-guard + i18n key) satir-kaydirmasi.
  // 13:5x: 16508→16511 — sprint-691 66-dosya hizalama + init semantik-koruma pini.
  // 12:1x: ayni 16508, digest-only — 689 multi-provider dalga test-kaymalari.
  // 2026-08-26 11:48: 16506→16508 — 7141 devam-dalgalari (687-001 + 688 2/2):
  // typed-throw donusumu test-eklentileri.
});

export const PRODUCTION_INVENTORY_BASELINE = Object.freeze({
  // 2026-08-06 (COVDEBT-SWEEP): README docs-link absolutization + the scan-
  // budget param — same 1197 count, content digest only. Prior: 523.
  // 533 dist-blind: same 1197 count, digest-only (deterministic classification).
  // 2026-08-06 (P1a): +1 REAL production module — src/core/principal.ts
  // (VerifiedPrincipal authority). Prior: 533 dist-blind (1197).
  // 2026-08-06 (537 hygiene): dead HB_PID lines removed from the wrapper
  // template — same 1198 count, digest only. Prior: P1a (+principal module).
  // 2026-08-06 (485a): status-summary export + dashboard overlay — same 1198
  // count, digest only. Prior: 537 hygiene.
  // 2026-08-06 (P1b): config key + enforcement seam + plan-service wiring —
  // same 1198 count, digest only. Prior: 485a.
  // 2026-08-06 (P1c): CLI plan identity conversion — same 1198, digest only.
  // 2026-08-06 (P1d): config carry line + type decls — same 1198, digest only.
  // 2026-08-08 (APPROVAL-001 T1): unknown-ID fail-closed guard + a single
  // canonical autonomousPendingPath resolver (core/constants, sibling of
  // NERVOUS_PENDING_FILE) that the approval-adapter and api/mcp/cli/connectors
  // autonomous ingresses all import — every local pendingPath helper deleted so
  // one resolver remains. Edits to already-inventoried modules only — same 1203
  // count, content digest only.
  // 2026-08-11 (NIGHT-DOGFOOD sprint-509): +1 — scripts/build-dashboard.mjs
  // enters the inventory as a test-support production dependency for the first
  // time via the new clean-dashboard-policy suite (row 3325's single typed
  // preserve-then-overwrite decision is proven from the real script). Measured
  // on a clean HEAD worktree (b381c03fd). Prior: MODEL-ACTIVATION-001 (1206).
  // 2026-08-11 (B5/B6 hasadı): +4 — error-registry, recover-helpers, status ve
  // runner-entry modülleri yeni suite'lerin test-support bağımlılığı olarak
  // envantere girdi. Temiz HEAD worktree (a8c6c0d8d).
  // 2026-08-11 (B10+B11): +4 — census/registry/lint modülleri yeni suite'lerin
  // test-support bağımlılığı olarak envantere girdi. Temiz worktree (0f951956d).
  // 2026-08-08 (TOOL-AUTHORITY filesystem-write-guard): resolveWriteScopeShellEscape
  // predicate in provider-command-spec + writeScopeShellEscape wiring in sprint-spawner
  // (both already-inventoried); same 1203 count, content digest only.
  // 2026-08-08 (CAPABILITY-001 design+G1): resolveCapabilityEnforcement predicate +
  // advisory debugLog surface in capability-runtime (already-inventoried); same 1203
  // count, content digest only.
  // 2026-08-09 (DRIFT-VISIBILITY): computeExactPlanDrift + enriched authority
  // error in sprint-spawner, typed exact-plan branch in sprint-utils (both
  // already-inventoried); same 1203 count, content digest only.
  // 2026-08-09 (STALE-SPRINT-LOCK): liveness-aware sprint classification in the
  // clean active-execution authority (already-inventoried); same 1203 count,
  // content digest only.
  // 2026-08-09 (MODEL-ACTIVATION-001): +1 REAL production module —
  // src/core/model-activation-store.ts (owner model-activation authority), plus
  // the auto-detect enforcement and CLI edits. Prior: STALE-SPRINT-LOCK (1203).
  // 2026-08-11 (sprint-510 harvest): edits to already-inventoried modules only
  // (parser, verify, controller, finalizer, plugin, catalog) — same 1207 count,
  // content digest only. Measured on a clean HEAD worktree (27d9bdec4).
  // 2026-08-12 (FRONT-DOOR-COMPOSITION-HEALTH): edits to already-inventoried
  // modules only (provider-execution-ingress-authority ready arm, CLI/API
  // front-door docs+type, autonomous ready mapping) — same 1227 count, content
  // digest only.
  // 2026-08-12 (T2B-PRODUCTION-WIRING): +4 REAL production modules — the
  // cross-verify evidence preparation orchestrator, the `deckent approvals`
  // local-terminal decision surface, the codex docker reachability source
  // additions and the probe-contract/producer budget alignment. Prior:
  // FRONT-DOOR-COMPOSITION-HEALTH (1227).
  // 2026-08-12 (INTERACTIVE-REAUTH-CLOCK): approval-decision-ingress post-prompt
  // clock fix (already-inventoried); same 1231 count, content digest only.
  // 2026-08-12 (PROVIDER-WINDOW-SHAPE): codex required-window shape fix +
  // decision-card render + decision-window config (already-inventoried); same
  // 1231 count, content digest only.
  // 2026-08-12 (PROBE-STDIN-I + i18n polish): docker probe `-i` flag, codex
  // window shape, decision-card render + human date (already-inventoried);
  // same 1231 count, content digest only.
  // 2026-08-13 (ADVISORY-PROBE-ADMISSION, Öneri-A): producer probe-scoped
  // advisory-limit admission + evaluateProviderLimitWindows export
  // (already-inventoried); same 1231 count, content digest only.
  // 2026-08-13 (ADVISORY-CANDIDATE-ELIGIBILITY): candidate eligibility admits an
  // advisory-under-block subscription-CLI verifier + limit key content-versioning
  // + reuse receipt relaxation (already-inventoried); same 1231 count, digest only.
  // 2026-08-13 (FABLE-SOL-CLOSURE-HARDENING): +1 REAL production module —
  // src/mcp/tools/approvals.ts (read-only MCP approval-inbox surface over the
  // canonical ApprovalBroker, closing the CLI↔MCP parity gap; no decide/allow/
  // deny). Prior: ADVISORY-CANDIDATE-ELIGIBILITY (1231).
  // 2026-08-13 (CLOSURE-HARDENING-MIGRATE): same 1232 count, digest only — the
  // DECKENT_E081/E082 catalog entries (errors.ts), the two reachability-budget
  // raw-throw migrations (execution-budget-derivation.ts) and the mission-worker
  // parked-HOLD migration. Prior: FABLE-SOL-CLOSURE-HARDENING (1232).
  // 2026-08-14 (MCP-INSTRUCTIONS-DRIFT-CLOSE): same 1232 count, digest only — the
  // DECKENT_MCP_INSTRUCTIONS `## Tools (49→50)` header + deckent_approvals list
  // line in src/mcp/server.ts (an inventoried production module); adding the one
  // template-literal line shifted the module's line-numbered inventory
  // fingerprint. No production module added or removed. Prior:
  // CLOSURE-HARDENING-MIGRATE (1232).
  // 2026-08-14 (APPROVAL-PARITY-FIXTURE-CLOSE): same 1232 count, digest only — the
  // approvals COMMAND_REGISTRY row (command-registry.ts) and its en+tr summary key
  // (messages.ts), both inventoried production modules, shifted their line-numbered
  // inventory fingerprints. No production module added or removed. Prior:
  // MCP-INSTRUCTIONS-DRIFT-CLOSE (1232).
  // 2026-08-14 (VERSION-0.100.0-REBASELINE): same 1232 count, digest only — the
  // sprint-finalizer changelog automation (src/orchestra/doc-updaters/changelog.ts,
  // an inventoried production module) dropped readPackageVersion and stopped deriving
  // a product-version-shaped sprint header, shifting its line-numbered inventory
  // fingerprint. No production module added or removed. Prior:
  // APPROVAL-PARITY-FIXTURE-CLOSE (1232).
  // 2026-08-14 (REBASELINE-NOGO-FIXES): same 1232 count, digest only — the Codex NO-GO
  // fix added the retired-lineage product-successor policy to src/cli/commands/upgrade.ts
  // (an inventoried production module), shifting its line-numbered inventory fingerprint.
  // No production module added or removed. Prior: VERSION-0.100.0-REBASELINE (1232).
  // 2026-08-14 (CLOSURE-CLASSIFICATION-FOUNDATION): same 1232 count, digest only — the
  // package.json `lint:gates` chain gained `node scripts/lint-closure-dispositions.mjs`
  // (the Closure OS sidecar-ledger gate; Codex final-disposition req #5). package.json is
  // an inventoried production manifest, so the one-token chain addition shifted its
  // fingerprint. No production module added or removed. Provenance: reverting ONLY the
  // lint:gates addition restored digest 22bcd4d3… exactly, proving nothing else in this
  // worktree touches the fingerprint. Prior: REBASELINE-NOGO-FIXES (1232).
  // 2026-08-15 (CLOSURE-CLASSIFICATION-PHASE-4.4): +1 (1232→1233) — Codex phase-4.4 req-2
  // extracted the master-plan integrity canonical (registryIntegrity = sha256(canonical-json-utf8))
  // into ONE shared authority, scripts/master-plan-integrity.mjs, so the Closure OS gate
  // reuses MASTER's byte-semantic algorithm verbatim instead of reimplementing it. That new
  // module is reachable from the test graph (tests/scripts/lint-master-plan.test.ts →
  // lint-master-plan.mjs → master-plan-integrity.mjs), so it joins the production inventory.
  // lint-master-plan --check still passes (registryIntegrity recomputed byte-identical), so
  // the extraction changed no MASTER output. Prior: CLOSURE-CLASSIFICATION-FOUNDATION (1232).
  // 2026-08-15 (CLOSURE-CLASSIFICATION-PHASE-4.4a): +1 (1233→1234) — Codex phase-4.4a pinned
  // the gate's ApprovalBroker identity (requestId canonical + claimRef === approval:<id>) to
  // the SOLE authority src/core/approval-contract.ts::approvalIdSchema via a buildless MIRROR,
  // scripts/approval-identity.mjs, cross-checked by tests/governance/approval-identity-parity.test.ts.
  // That parity test IMPORTS the mirror, so the new pure module joins the production inventory.
  // No second identifier authority (the test proves mirror ≡ approvalIdSchema over the corpus);
  // UNRESOLVED_BASELINE unchanged (the mirror is pure, no command effects). Prior: PHASE-4.4 (1233).
  // 2026-08-15 (CLOSURE-CLASSIFICATION-PHASE-4.4a-commit): same 1234 count, digest only — the
  // foundation-commit corrected approval-identity.mjs's header comment (a trailing hyphen/underscore
  // IS accepted by the regex; only a trailing dot/space is not), which shifts that inventoried
  // module's content digest. Comment-only; no behavior change (gate 124/124 + parity 3/3 unchanged).
  // Prior: CLOSURE-CLASSIFICATION-PHASE-4.4a (1234).
  // 2026-08-16 (OWNER-MODEL-POLICY-LOCAL-LLM): +1 REAL production module —
  // src/cli/commands/local-llm.ts provides the config-resolved start/status/stop
  // lifecycle for a keyless local provider, including explicit fail-loud hardware
  // placement. The digest also records the connected provider/registry/Terminal/worker
  // edits, mandatory receipt-file fsync/fail-closed malformed-receipt handling,
  // and the DECKENT_E092/E093/E094 typed error metadata in already-inventoried
  // modules. Prior: PHASE-4.4a-commit (1234).
  // 2026-08-17 (LOCAL-LLM-CI-CLOSURE): same 1235 count, digest only. The post-#126
  // CI-contract hotfix edited four already-inventoried production modules
  // (src/cli/commands/local-llm.ts group description; src/cli/helpers/messages.ts
  // en/tr descriptions; src/core/command-registry.ts local-llm registration;
  // src/core/config.ts VALID_PROVIDERS/provider-map parity + stale-bootstrap message)
  // to realign with the landed local-llm contracts — no new production module (count
  // unchanged), only content digests shift. Value verified IDENTICAL with dist present
  // and build-free (dist-blind). Prior: OWNER-MODEL-POLICY-LOCAL-LLM (1235).
  // 2026-08-17 (DEV-OPERATING-CONTRACT-001): +1 — scripts/lint-operating-policy.mjs
  // enters the inventory as a test-support production dependency via its new
  // tmpdir-hermetic suite (build-dashboard.mjs precedent), and the
  // already-inventoried package.json gains the lint:operating-policy(:write)
  // entries + the lint:gates append (digest component). Attributed empirically:
  // with the script/test pair moved out AND package.json reverted the scan
  // reproduces 1235:309c1f2a… exactly (build-free).
  // Prior: LOCAL-LLM-CI-CLOSURE (1235).
  // 2026-08-17 (DEV-CONTROL amendment): same 1236 count, digest only —
  // already-inventoried lint-operating-policy.mjs gains the DECKENT-DEV-CONTROL
  // parser/validator content. Prior: DEV-OPERATING-CONTRACT-001 (1236).
  // 2026-08-17 (RUN-POLICY-DELIVERY-001): +1 — src/orchestra/run-policy-resolver.ts
  // enters the inventory as the plan-time run-policy producer consumed by the new
  // Paket B suites; already-inventoried task-types/settlement/schema/planner/
  // debt-manager/prompt-god-template/task-builder/result-evaluator content
  // digests shift with the task-carried delivery chain (digest component).
  // Prior: DEV-CONTROL amendment (1236).
  // 2026-08-17 (RUN-POLICY correction turu): same 1237 count, digest only —
  // already-inventoried result-evaluator/sprint-phases/backlog-eval/task-builder
  // content shifts with the canonical terminal-boundary gate + honest
  // observation naming. Prior: RUN-POLICY-DELIVERY-001 (1237).
  // 2026-08-17 (boundary internalization): same 1237 count, digest only — the
  // gate now lives inside result-evaluator's terminal producers; downstream
  // sprint-phases/backlog-eval external wraps reverted.
  // 2026-08-17 (correction-2): same 1237 count, digest only — sprint-planner
  // gains the pre-persistence stamp, sprint-finalizer gains the terminal-input
  // parity veto (enforceRunPolicyParityOnTerminalInputs).
  // 2026-08-17 (A′/ADR-D-007 zero-task publication guard): same 1237 count,
  // digest only — sprint-finalizer gains the pre-write COMPLETE-receipt HOLDs
  // (TERMINAL_PUBLICATION_ZERO_TASK_HOLD / _EVIDENCE_HOLD /
  // _NOT_CLEANUP_CANDIDATE_*).
  // 2026-08-17 (PHASE5-S1, sprint-538 dogfood): +2 — phase5-dry-run.mjs and
  // (via its suite imports) an adjacent closure-ledger module enter the
  // inventory as test-support production dependencies.
  // 2026-08-17 (PHASE5-S3, sprint-539 dogfood): +4 — phase5-writer.mjs,
  // phase5-sign.mjs and the broker-subtree modules their suites import enter
  // the inventory as test-support production dependencies.
  // 2026-08-17 (PHASE5 live-batch closure): same 1243 count, digest only —
  // phase5-writer.mjs content hash moved with the userInfo().username claim
  // identity fix; inventory membership unchanged.
  // 2026-08-17 (xverify live-channel repair): same 1243 count, digest only —
  // the five production-module content hashes moved with the tenant-mint,
  // author-model, identity-gate and adjudication-budget fixes; membership unchanged.
  // 2026-08-17 (RUN-INSPECTOR-001 package 1): same 1243 count — the new
  // run-inspector-read-model production module replaces the retired
  // sprint-live-service one-for-one; server/api-client content hashes moved.
  // 2026-08-17 (RUN-INSPECTOR-001 package 2): +1 — src/cli/commands/inspect.ts
  // enters the production inventory (new CLI face over the core read-model);
  // read-model/server/api-client/messages content hashes moved.
  // 2026-08-17 (RUN-INSPECTOR-001 package 3): +1 — src/mcp/tools/inspect.ts
  // (deckent_inspect MCP twin) enters the inventory; server/Shell/RunsView/
  // api-client/read-model content hashes moved.
  // 2026-08-17 (RUN-INSPECTOR-001 package 4): same 1245 count, digest only —
  // core read-model, server, inspect CLI, messages, desktop shell content hashes
  // moved with the log-tail/follow/stream-adoption slices; membership unchanged.
  // 2026-08-17 (CATALOG-STATS-AUTHORITY-001 correction): +1 — the canonical
  // src/core/catalog-stats-read-model.ts production module enters the inventory;
  // finalizer/skill-pool/generator/planner/collector/template/cli/mcp hashes moved.
  // 2026-08-17 (LOCAL-LLM-MODEL-IDENTITY-001): same 1246 count, digest only —
  // openai adapter / native-transport / messages production hashes moved.
  // 2026-08-17 (PLANNER-TRUTH correction, sprint-546): same 1246 count, digest
  // only — task-lineage (scale-honest breaker), sprint-utils/criteria-deriver
  // (authored criteria), sprint-planner (declared-files scope) hashes moved.
  // 2026-08-18 (NATIVE-AGENT-HORIZON-001 package 1): +1 — the scratch-checkpoint
  // production module enters the inventory; loop/session/transcript/events/
  // recursion/config/bridge/run.tsx/messages hashes moved.
  // 2026-08-18 (HORIZON package 2): +1 — src/agent/guards/shell-risk.ts enters
  // the inventory; loop/permission/events/context-budget/transport hashes moved.
  // 2026-08-18 (ORCHESTRA-RELIABILITY-001): same 1248 count, digest only —
  // worker/collector/evaluator/file-lock/landing-proposal/spawn-coordinator/
  // spawner production hashes moved; membership unchanged.
  // 2026-08-18 (NATIVE-AGENT-HORIZON-001 NT-correction, sprint-553): +1 —
  // src/agent/tool-result-broker.ts enters the inventory; loop/transcript/
  // native-transport/run.tsx/bridge/trace-wire/chat-tool-exec/chat-tool-bridge
  // production hashes moved.
  // 2026-08-18 (NT-06, sprint-554): +1 — src/agent/tools/exposure.ts enters the
  // inventory; loop/session/bridge/registry production hashes moved.
  // 2026-08-18 (556 landing): production hashes moved — collector settlement
  // guard, killSingle typed result, xverify channel truth, exposure optional.
  // 2026-08-18 (7083): session/bridge/run.tsx/native-tool-registry/slash
  // production hashes moved; membership unchanged.
  // 2026-08-18 (7085, sprint-559): +1 — src/mcp/tools/description-catalog.ts
  // (MCP↔CLI shared description resolver) enters the inventory; ~80 CLI
  // command files + messages.ts + mcp tools production hashes moved.
  // 2026-08-18 (559 landing debt): same count, digest only — /renew registry
  // entry (command-registry.ts) moved production content.
  // 2026-08-18 (7086, sprint-560): same count, digest only — measurement/
  // admission (context-budget, native-transport), ceiling parity (openai/
  // anthropic), continuation (loop/events/sse/types), epochs (session,
  // bridge, run.tsx) and lifecycle i18n (messages) production hashes moved.
  // 2026-08-18 (skill-unlock, sprint-561): +2 — skill-profile-derivation.ts
  // (canonical V3 derivation authority) and the delivery-evidence surface in
  // task-builder enter the inventory; adapter/pool/spawner/probe hashes moved.
  // 2026-08-18 (7087, sprint-562): same count, digest only — at-ref
  // budget/descriptor mode, app.tsx budget wiring, bridge getContextBudgetTokens
  // expose and ranged deckent_read_file moved production content.
  // 2026-08-19 (7088 Faz-1, sprint-563): -1 — web.ts leaves the inventory;
  // messages/doctor/agent/index/command-registry hashes moved.
  // 2026-08-19 (7089 NATIVE-SESSION-LEDGER, sprint-564 + ADR-D-007 el-kapama):
  // +2 — session-ledger.ts (per-turn JSONL chat ledger) and project-slug.ts
  // (canonical CC-parity slug) enter the inventory; scratch-checkpoint,
  // tool-result-broker, session, identity, loop, bridge, app.tsx, run.tsx,
  // native-tool-registry, trace-wire and session-usage-store hashes moved.
  // 2026-08-19 (7091 CURSOR-PROVIDER, sprint-565 + el-kapama): +2 —
  // providers/cursor.ts (adapter) and providers/cursor-provider-evidence-sources.ts
  // enter the inventory; spine/spec/registry/auth/doctor/bootstrap hashes moved.
  // 2026-08-19 (7094-F1): same 1256 count, digest only — coordinator order,
  // route-task-v3 domain-overlap, prompt-template plan/hb text, nervous
  // stale-worker veto, timeout-watcher/sprint-phases/sprint-checkpoint/status
  // probe wiring moved production content.
  // 2026-08-19 (7094-R debt/dependency onarım paketi): same 1256 count,
  // digest only — task-builder directive-only index refs, result-evaluator
  // doc-honesty + self-NO_GO ceiling, debt-manager success-echo classifier,
  // sprint-planner injector skip/title/description, task-lineage blocked
  // edges, sprint-controller edge-form pause reason moved production content.
  // 2026-08-19 (7094-R landing find): same 1256 count, digest only —
  // route-task-v3 skillDomainOverlap treats evidence-with-zero-weight
  // (directories-only scope, totalWrites=0) as presence so those tasks keep
  // skill selection.
  // 2026-08-19 (7094-F4a+F1b): same 1256 count, digest only —
  // TURN_ECONOMY_BLOCK rules 5-6 (single-Write authoring, two-turn shape),
  // adr-selector governing-tier marker slice + pointer, and the
  // worker-default rule template realigned to the F1d protocol (the
  // finalize→regenerateRules producer had been re-emitting the pre-F1d text).
  // 2026-08-20 (7094-F2b): same 1256 count, digest only — spawn-backend-docker
  // adds --disable-slash-commands to the F3 core args (deckent-owned
  // composition drops the CLI slash/skill catalog from the worker prefix).
  // 2026-08-20 (7097 evaluator-honesty package): same 1256 count, digest
  // only — result-evaluator (B3 ceiling, residualDebt-aware evidence,
  // testsApplicableForTaskClass export), sprint-phases (verdict-source
  // chain, class-aware concrete-failure veto), debt-manager (residualDebt
  // ledger preference), task-types/prompt-template (residualDebt field +
  // contract line) moved production content.
  // 2026-08-20 (7093+7081 truth wave): same 1256 count, digest only —
  // live-execution-budget fresh-input schema rule, budget projections
  // totalTokens, token-counter cli-log total, broker decoded-slice export,
  // runtime-bootstrap ranged entries, xverify CLI ranged requirements,
  // composition reachabilityTtlMs passthrough + 30-min producer default.
  // 2026-08-20 (7081 approval-carousel layer-1): same 1256 count, digest
  // only — provider-truth reachability lifetime = ttl (admission clamps
  // removed; approval window enforced as run-window via freshness assertion).
  // 2026-08-20 (7081 carousel layer-2): same 1256 count, digest only —
  // truth-store account-agnostic lookup, producer probe-gated approval
  // requirement (nullable approval on refresh), preparation approval-skip +
  // canonical-refresh reuse moved production content.
  // 2026-08-20 (EVALUATION-001 first brick + 7098 canary): +1 — the new
  // criterion-evaluation deterministic kernel module; result-evaluator
  // rubric bridge and the canary's task-mode-runner/routing-plan-adapter
  // force-preserving merge moved production content.
  // 2026-08-20 (salvage-gate closure): same 1257 count, digest only — the
  // contract-failure guards in mid-sprint-adapter/result-evaluator and the
  // kernel's hasUnsalvageableContractFailure export moved production content.
  // 2026-08-20 (ADR-G-040): +1 — the new verdict-types vocabulary module;
  // evaluation-audit-trail gained the normativeVerdict projection and the
  // decision-wave moved chat/test-discovery production content.
  // 2026-08-20 (acceptance-matrix slice): +1 — the new acceptance-matrix
  // policy module; rubric-registry gained resolveCanonicalTaskKind,
  // sprint-phases/audit-trail gained the observe stamp, and the criterion
  // kernel's adapter union moved to its canonical core home.
  // 2026-08-20 (adapter-runtime slice): +3 — confirmation-store,
  // acceptance-enforcement and the `deckent confirmations` CLI; config
  // gained the acceptance fields and sprint-phases the enforce wiring.
  // 2026-08-20 (codex usage-log selection fix): same 1262 count, digest
  // only — codex-provider-evidence-sources moved production content
  // (bounded newest-named candidate list + single-read descent).
  // 2026-08-20 (D1 federated inbox): +1 — the new approval-inbox-federation
  // module; approvals CLI/MCP gained the federated read-only section.
  // 2026-08-20 (DE1 short codes): +1 — the new approval-short-code module;
  // approvals CLI/MCP rows gained the #code prefix and decide gained
  // fail-closed short-code resolution.
  // 2026-08-20 (DE2a rules): +1 — the approval-rules store module; CLI
  // gained the rules subcommands, --always promotion and advisory lines.
  // 2026-08-20 (D2a bridge): +1 — the approval-decision-federation module;
  // approvals decide gained the mirror + settle-back path.
  // 2026-08-20 (sprint-589 i18n factory package): mcp/lifecycle/checkpoint
  // surfaces moved user-facing text into the catalog.
  // 2026-08-20 (590 + D2b-1): bridge moved to orchestra + origins extended;
  // status output localized.
  // 2026-08-20 (591 + D2b-2a): +1 REAL production module —
  // src/core/approval-rules-engine.ts (rule-decision authenticator + allowlist);
  // six gate/MCP/API surfaces moved user-facing text into the catalog.
  // 2026-08-20 (D2b-2a live-proof fixes): same 1267 count, digest only —
  // ingress rule-actor pre-check branch + ruleSessions consumer routing +
  // runtime wiring moved tracked production content.
  // 2026-08-21 (7094 wave-2/3/4 + 7091 + debt sweep): same 1267 count,
  // digest only — catalog-mask/profile-SSOT/fail-soft/tier threading,
  // provider-aware coreExternalized, confirmation-store typed error and the
  // command-registry confirmations entry moved tracked production content.
  // 2026-08-21 (codex-prefix waves): same 1267 count, digest only — spec
  // prefix fields, config flags, spec-driven core-emit branch, capability
  // gate and the tmux dead-seam removal moved tracked production content.
  // 2026-08-21 (D3+DE3): +1 REAL production module —
  // src/core/approval-channel-authenticator.ts; relay/bootstrap/bot/rpc
  // surfaces moved tracked production content.
  // 2026-08-21 (3322 Docker evidence recovery closure): +1 REAL production
  // module — src/providers/docker-bounded-reachability-evidence.ts; the
  // Claude/Codex evidence registrations, provider-authority runtime factory,
  // CLI consumer and task-artifact classifier moved already-inventoried
  // production content. Prior: D3+DE3 (1268).
  // 2026-08-21 (3322 observe-only/CAS correction): same 1269 count, digest
  // only — explicit ratio mode, additive/CAS publication, source-versioned
  // cooldown and bounded Docker envelope classification moved already-
  // inventoried production modules; no second production module was added.
  // 2026-08-21 (4056 D4 approval lifecycle): +4 inventoried modules — three
  // new canonical core authorities (lifecycle policy, deterministic migration
  // and durable SLA journal) plus one newly reachable existing production
  // module through the full-correlation test graph. Every changed production
  // path is inside the frozen D4 manifest; 65 files / 298 tests and tsc passed.
  // Prior: 3322 observe-only/CAS correction (1269).
  // 2026-08-22 (9040 acceptance authority-restart closure): +8 inventoried
  // modules — canonical confirmation contract, settlement reducer,
  // reconciliation store, decision authority, service, composition,
  // reconciler and its syntax-aware authority ratchet. Existing evaluator,
  // controller, CLI/API and debt-store modules moved content to consume this
  // single production chain; 531 scoped tests, tsc, build and real serve tick
  // passed. Prior: 4056 D4 (1273).
  // 2026-08-22 (7092 RECOVERY-TRUTH): +7 inventoried modules — six canonical
  // core authorities (artifact policy, finalizer gate, status reconciliation,
  // result writer, terminal projection, xverify settlement) plus the recovery
  // authority ratchet imported by its CLI suite. Existing worker, Docker,
  // collector, scheduler, checkpoint, controller, finalizer, CLI and status
  // modules moved content to consume those authorities. Root proof: 200 pass,
  // 2 skip scoped; 253 adjacent; tsc and real compiled CLI green. Prior: 9040
  // acceptance authority-restart closure (1281).
  // 2026-08-22 (canonical sprint archive handoff): +2 — the canonical
  // src/core/sprint-archive.ts authority and its operator-only archive CLI
  // surface enter the inventory. Existing finalizer, recovery, retention,
  // auditor, SDK, MCP read-side and task-reader modules now consume this single
  // dual-read/new-write authority. Prior: 7092 RECOVERY-TRUTH (1288).
  // 2026-08-22 archive ownership hardening: count unchanged; digest-only update
  // for the central non-clobber publisher, exact ownership filter and fail-
  // closed finalizer wiring in the same two inventoried modules.
  // 2026-08-22 completed-checkpoint recovery: count unchanged; digest-only
  // update after terminal evidence collection began consuming the canonical
  // finalizer attempt-task loader, including dynamic FIX attempts.
  // 2026-08-22 crash-before-prepare terminal identity recovery: count
  // unchanged; digest-only update for the shared pre-dispatch projection,
  // Docker recovery writer and authoritative result reader wiring.
  // 2026-08-22 (PROVIDER-OBS-MIGRATION-001): +4 — canonical migration,
  // adoption, approval-bridge and CLI composition modules enter inventory.
  // Existing observation store/status and notification composition modules move
  // content only; the digest binds their fail-closed and lifecycle wiring.
  // 2026-08-22 canonical-path closure: count unchanged; digest-only update after
  // the store exported one `.db` path authority and every production reader,
  // finalizer and CLI default consumed it. No new production module was added.
  // 2026-08-22 durable provider-adoption closure: +1 — the content-addressed
  // src/core/provider-execution-observation-adoption-receipt-store.ts enters
  // inventory. The adoption CLI consumes its no-replace/fsync/fresh-read chain;
  // the final host-policy correction changes only the shared-control-directory
  // trust boundary and keeps the scoped receipt store private.
  // 2026-08-23 (sprint identity recovery): +1 — the provider-neutral
  // execution-job identity module separates detached job IDs from sprint
  // ordinals while preserving legacy timestamp ordering during migration.
  // 2026-08-23 (runtime hygiene + canonical archive landing): +8 — the
  // maintenance archive, recent-work, run-flow, artifact classifier,
  // evaluation, job, log and unified hygiene authorities enter the production
  // inventory through their hermetic suites. Existing finalizer/CLI wiring
  // moves content only; the measured registry contains zero confirmed
  // violations.
  // 2026-08-23 (retired-plan identity floor recovery): count unchanged;
  // digest-only update for shared run-flow coordinator retirement wiring to
  // the existing canonical config-floor authority. No module was added.
  // 2026-08-23 (final-only containment parity): +1 — the shared canonical
  // final-only-usage resolver enters inventory; manual spawn, initial
  // scheduler and retry/FIX/continuation consumers now fail closed over the
  // exact task-stamped grant before provider work.
  // 2026-08-23 (ADR-D-007 pre-plan recovery): count unchanged; digest-only
  // update after model selection began accepting an owner-active
  // premium_plus model as the stronger substitute when an explicit-active
  // provider has no selectable exact-premium model. Inactive exact-tier
  // identities remain non-executable and no provider/model policy is mutated.
  // 2026-08-23 terminal archive seal: writer ratchet enters the test graph;
  // live-WAL/replay hardening changes already-inventoried production modules.
  // 2026-08-24 provider-observation reconciliation: +3 — deterministic batch
  // planning, live-approval capability and content-addressed receipt modules
  // enter inventory. Existing store, settlement, finalizer, XVerify and CLI
  // consumers move content to close the producer→consumer→entrypoint chain.
  // 2026-08-24 retired-flow settlement + bot readiness: count unchanged;
  // digest binds shared retire application-service wiring and the daemon's
  // ownership-record readiness fence before STARTED is surfaced.
  // Terminal reconciliation now opens the shared approval runtime directly;
  // API OIDC remains adapter-specific and is not a CLI admission dependency.
  // Root landing verification binds retired-row exclusion in the canonical
  // concurrency reader and replay-time status projection repair; the governed
  // production inventory count is unchanged.
  // 2026-08-24 D4 formal-closure recovery: count unchanged; the confirmations
  // CLI now consumes the existing side-effect-free projection instead of the
  // expiry-settling store API. No new production module or effect entered the
  // graph.
  // 2026-08-24 Cursor production wiring: count unchanged; digest binds image
  // CLI/i18n, canonical catalog enrichment, and logical-provider Docker auth
  // consumer wiring. No new production module entered the inventory.
  // Root consumer repair keeps the count unchanged and bounds unsupported
  // remote-catalog diagnostics to one deterministic aggregate warning.
  // 2026-08-24 runtime-adoption closure: +2 — the canonical composite plan
  // contract and immutable no-replace/fsync receipt store enter production
  // inventory; CLI, build identity and bot ownership consumers move content.
  // 2026-08-24 prompt-cost canary authority: +3 — deterministic comparison
  // kernel, canonical sealed-archive cohort reader and immutable scoped receipt
  // store enter inventory; the existing usage CLI is their production ingress.
  // Producer closure: +1 — stable cross-sprint task authority enters inventory;
  // planSprint persists it before first write, FIX paths inherit it exactly,
  // and the archive reader consumes terminal lineageUsage plus provider envelopes.
  // 2026-08-24 bot clean-guard schema-v2 closure: count unchanged; digest binds
  // the canonical v2 runtime-identity validation used by the build clean gate.
  // 2026-08-24 XVERIFY-WIRE-001: +1 — the canonical exact author/verifier
  // tier-authority module enters the governed inventory; config, runner,
  // settlement and CLI consumers move existing production fingerprints.
  // The final causal candidate-window integration rewrite changes only which
  // already-inventoried production modules are reachable from that suite;
  // inventory membership remains count-neutral.
  // 2026-08-24 XVERIFY-RESPONSE-BUDGET-001: +1 — the dependency-free canonical
  // response-limit authority enters the governed inventory; adjudication,
  // prompt, broker, bootstrap and runner consumers bind the same finite budget.
  // 2026-08-24 XVerify settlement projection parity: +1 — one shared
  // closed-settlement projection service is consumed by manual spawn and the
  // mandatory exact-coordinator ingress; no provider prose can finalize it.
  // 2026-08-24 Closure identity closure: count unchanged; digest binds Phase-5
  // dry-run/claim/append to the canonical trust-anchor tenant/project scope
  // and removes the unwired generated-MASTER identity assumption.
  // 2026-08-24 sprint-649 archive replay hardening: count unchanged; digest
  // binds per-sprint guarded-summary adoption, exact FIX-attempt cohort lineage
  // and replay-safe finalizer verification in existing production modules.
  // 2026-08-24 sprint-652 evaluator applicability closure: count unchanged;
  // digest binds the frozen applicability matrix, canonical rubric/recovery
  // resolver and initial/FIX durable audit fan-in in existing modules.
  // Root acceptance recovery is count-neutral; the digest additionally binds
  // the direct/recovery FIX audit contract without adding a production module.
  // 2026-08-24 prompt compile authority P0: +1 — the immutable deterministic
  // PromptCompilePlan IR enters production inventory; directive parsing,
  // worker prompt ingress and evaluator consumers bind its digest and typed
  // verification/criterion projections.
  // 2026-08-24 prompt-delivery settlement closure: +1 — the versioned prompt
  // delivery receipt authority is now a production module. The digest binds
  // its route/spawn producer and Docker/finalizer/result consumers.
  // 2026-08-24 typed verification authority follow-through: count unchanged;
  // digest binds the canonical task.verification-first rubric consumer and
  // its explicit legacy-description fallback in the existing registry, plus
  // authority-matched structured execution evidence at the debt ceiling.
  // 2026-08-24 sprint-661 execution-authority recovery: -1 production entry;
  // the scope/scheduler contract moved existing modules without adding an
  // unclassified runtime writer. Digest also binds collision relevance to the
  // authored selector scope. The source-derived scan remains violation-free.
  // 2026-08-24 sprint-661 manual ADR-D-007 closure: +2 — worker-activity
  // heartbeat v1 authority (core) and the extracted layer-clean canonical
  // result-ingress module (ADR-G-041 SCC fix). Scan remains violation-free.
  // 2026-08-24 read-path purity fix: count unchanged, digest moved — the
  // EXPIRE-SWEEP read hook was retired from pending-approvals (status/bot
  // polls no longer write expiry decisions; settlement is driver-owned).
  // 2026-08-24 HIGH-3/4 closure: count unchanged, digest moved — canary
  // archive reader (legacy-evaluation resolution, fix-chain walk), config-owned
  // canary thresholds and result-schema hostTerminalProjection passthrough.
  // 2026-08-24 HIGH-5 + 7091 fold: count unchanged, digest moved — bot-daemon
  // token-proven legacy stop path and cursor image build-arg fold.
  // 2026-08-25 canary token-authority (owner decision): count unchanged, digest
  // moved — kernel costAuthority, usage auto-policy resolution, config default
  // flips (codex_core_channel/codex_suppress_project_doc ON, canary_cost_authority).
  // 2026-08-25 cache-regression waiver (owner decision): count unchanged, digest
  // moved — kernel waives the regression guard only under measured cost
  // reduction, typed reason; the absolute floor is never waived.
  // 2026-08-25 directives pipeline: +2 REAL gate/generator scripts —
  // scripts/lint-directives.mjs (pre-start gate over the compiled production
  // parser) and scripts/gen-repair-directives.mjs (deterministic repair-wave
  // DIRECTIVES generator); both registered in script-registry.
  // 2026-08-25 sprint-670 manual closure: count unchanged, digest moved —
  // cleanup.ts --json prose guard (say helper + machine projections) and
  // provider-observations bilingual catalog descriptions (670-004/002).
  // 2026-08-25 same closure, follow-up: digest moved — the two --json machine
  // projections were removed as dead code (the legacy cleanup path holds on
  // --json before reaching them); the say guard stays.
  // 2026-08-25 sprint-671 wave harvest + manual closure: count unchanged,
  // digest moved — canonical done-counters (auditor/tracker), owner-notification
  // producers/drain wiring, terminal-aware sprint.lock release, event-stream
  // self-healing, live-events single-source, T0 config fields.
  // 2026-08-25 cli-surface-truth merge: lane production modules
  // (cli-command-contract SSOT, governance catalog, generators).
  // 2026-08-25 exploration-bonus wave: +1 — the route-task-v3 exploration
  // bonus derivation adds one production effect site (cells ledger read).
  // 2026-08-27 19:2x: 1341→1342 — sprint-702 src (alias/fold/federation/limits/truth + status --debt).
  // 2026-08-27 20:5x: sprint-703 src (evidence settled-states + finalizer terminalTruth).
  // 2026-08-28 09:0x: 1342→1343 — sprint-704 src: yeni üretim modülü
  // src/orchestra/repair-queue-authority.ts (durable admitted-repair kuyruğu).
  // 2026-08-28 09:4x: 1343→1351 — sprint-705 (MASTER 6181 dilim-1): yeni saf
  // src/intelligence/ katmanı (types · baseline-catalog · baseline ·
  // competitor-universe · terminology · comparison · significance-gate ·
  // alarm-prompt); ağ/IO yok, tamamı enjekte edilebilir okuyucuyla çalışır.
  // 2026-08-29 SKILL_ROUTING_CONTROL_PLANE_P0: 1361→1366 — four production
  // authorities enter the inventory: hard applicability, task-local evidence,
  // causal attribution receipts and crash-resumable attribution migration;
  // the fifth is their catalog-mediated atomic file-operation authority. Its
  // catalog assertion is lazy at import and fail-closed at first mutation;
  // production inventory count is unchanged and the digest records that move.
  // 2026-08-29 OPERATION-001 ADR-D-007 recovery: compile-clean catalog
  // convergence implementation, source-derived with no policy relaxation.
  // 2026-09-03 Terminal/Fable main landing ratchet: 1396→1420. New entries are
  // the provider-neutral Terminal control, rendering, picker, evidence and
  // model-catalog modules reached by the final source graph. Inventory and
  // content edges are scanner-derived; no module is manually listed here.
  // 2026-09-04 (3331 RECOVERY-BORN-NATIVE-DO-SLASH-PROVIDER-BOOTSTRAP-001): +1 production
  // module src/cli/repl/provider-bootstrap.ts (the ONE lazy provider-bootstrap seam). Prior: 1420.
  count: 1421,
  // 2026-08-29 OPERATION-COVERAGE-MODEL-001 bounded ADR-D-007 recovery:
  // count unchanged; digest records the canonical catalog-backed semantic
  // inventory and comparative schema-3 baseline authority.
  // 2026-08-28 OPERATION-001 O3 ratchet: count unchanged, digest-only —
  // audit-operation-ingress production text now implements the fail-closed
  // baseline comparison used by lint:gates.
  // 2026-08-29 dogfood-surface F1/F2/F3 closure: count unchanged, digest-only —
  // prompt-gate authority semantics and exact run scope contracts move the
  // scanned production inventory without adding a production module.
  // 2026-08-29 settlement-recovery O4: count unchanged, digest-only — receipt,
  // settlement authority, CLI and clean terminal-recognition production text
  // is rewired without introducing a new scanned module.
  // 2026-08-25 config-loss incident hardening: digest moved — atomic
  // last_sprint_id writer (refuse-mint + tmp+rename) and loadConfig
  // self-heal re-read-once + atomic fresh-default.
  // 2026-08-25 B-sweep: digest moved — parser multi-label merge in
  // extractScopeFromDirective (task-builder).
  // 2026-08-25 7141 wave: digest moved — 131 raw throws converted to typed
  // DeckentError across 28 files (sprint-672 harvest + 1 manual serve.ts site).
  // 2026-08-25 strike-4 fix: digest moved — config.ts self-heal reordered
  // to write-then-swap (production text shifted).
  // 2026-08-25 A2 routing-fairness wave: digest moved — production modules
  // (dominantDomain/failureClass threading, cells contract, journal
  // coverage, doctor journal-health, ci-guardian manifest).
  // 2026-08-25 docs consolidation follow-up: auditor dependency-inventory read
  // path moved to docs/en/reference/dependencies.md.
  // 2026-08-25 A3 event-truth wave: same 1335 count, digest only — src-side
  // effect-site text shifted (hb primitive rewires, event-seq CAS, read-model
  // CAS, status readiness cutover, result field-order serializer).
  // 2026-08-25 exploration-bonus wave: digest folds the rank blend,
  // config knob and story visibility src shifts.
  // 2026-08-25 gece: ayni 1336 count, digest-only — strike-5 heal-gate +
  // C-dalgasi src kaymalari (plan-purity, lock-ownership, close-stale,
  // budget-authoring, classifier) + landing el-fix'leri.
  // 2026-08-26 00:05: ayni 1336, digest-only — landing-kuyrugu src kaymalari.
  // 2026-08-26 xverify dalgasi: ayni 1336, digest-only — CLI/ingress src kaymalari.
  // 2026-08-26 01:00: ayni 1336, digest-only — oversize-filtre src kaymasi.
  // 2026-08-26 02:10: ayni 1336, digest-only — messages.ts silme kaymasi.
  // 2026-08-26 07:36: 1336→1338 — G0-A: yeni src/core/config-write-authority.ts
  // uretim moduli + dalga src kaymalari (config/mcp/cli/orchestra kablolama).
  // 2026-08-26 08:36: 1338→1339 — Node-2: evaluation.tsc_settlement_gate zinciri
  // (finalizer runner-seam) + ERRORS-critical kanal + selfchange-WARN kaymalari.
  // 2026-08-27 17:0x: 1340→1341 — sprint-701 src: surface-registry + help
  // renderer modulleri + messages katalog-eki + parity/gate script degisimleri.
  // 2026-08-27 16:2x: ayni 1340, digest-only — 3301 son-metre seam zinciri.
  // 2026-08-27 15:5x: ayni 1340, digest-only — sprint-700 src kaymalari
  // (scheduler-reducer/effects + task-builder inheritance + phases/evaluator).
  // 2026-08-27 15:1x: ayni 1340, digest-only — ayni ritüel-ihlali duzeltmesi
  // (pin-sonrasi sprint-phases/evaluator/collector src kaymalari).
  // 2026-08-27 14:3x: 1339→1340 — sprint-699: yeni uretim modulu
  // src/core/failure-disposition-policy.ts + collector/evaluator kaymalari.
  // 2026-08-27 10:5x: ayni 1339, digest-only — sprint-698 src kaymalari
  // (skill-pool uc-yonlu senkron + run-flow-coordinator truncation).
  // 2026-08-27 10:3x: ayni 1339, digest-only — CI-onarim: fallback-otoritesi
  // getDefaultConfig()'ten BRAIN_TOTAL_LINE_BUDGET sabitine cekildi (partial-mock
  // patlama sinifi); output.ts + doctor-checks.ts kaymalari.
  // 2026-08-27 08:2x: ayni 1339, digest-only — budget-authority el-fix src kaymalari
  // (output.ts config-resolved memoryBudget, doctor-checks.ts resolveMemoryBudget,
  // status.ts iki callsite kablolamasi).
  // 2026-08-26 10:03: ayni 1339, digest-only — Node-5 src kaymalari
  // (landing-proposal-entry + coordinator/worker/lineage/controller edits).
  // 2026-08-26 10:37: ayni 1339, digest-only — Node-4 src kaymalari
  // (heartbeat-authority / classifier / recovery-service / scheduler /
  // finalizer + sidecar-loader hotfix).
  // 2026-08-26 11:05: ayni 1339, digest-only — Node-6a src kaymalari
  // (death-sweep / prompt-template kimlik-esigi / docker async-git).
  // 2026-08-28 09:0x: digest 120cadc2→873b946d — repair-queue-authority modülü +
  // sprint-phases/sprint-controller kablolaması.
  // 2026-08-28 12:1x: 1358→1361 — MASTER 6181 dilim-3: watch-capability · watch-flow ·
  // CLI intelligence komutu; entrypoint composition capability'yi bilerek bağlamaz
  // (üretim interpretSource seam'i yok), komut tipli hata bildirir.
  // 2026-08-28 11:2x: 1354→1358 — MASTER 6181 dilim-2: src/intelligence/ servis katmanı
  // (source-retrieval · event-history · alert-formatter · watch-service) + index barrel;
  // ağ yalnız enjekte edilmiş fetch üzerinden, ham gövde saklanmaz.
  // 2026-08-28 10:5x: 1353→1354 — 3356 P5: paylaşımlı src/core/output-digest.ts
  // (framedOutputDigest tek kaynak; planner ve iki doğrulama adapter'ı tüketir).
  // 2026-08-28 10:4x: aynı 1353, digest-only 50e7a4e8→25266de8 — 3356 P3: dizin-niyeti
  // typed HOLD'u (DIRECTORY_INTENT_REQUIRES_DIRECTORIES); yeni üretim modülü yok.
  // 2026-08-28 10:3x: aynı 1353, digest-only 38422e58→50e7a4e8 — 3356 typed planner-failure
  // kanıt zarfı (framedOutputDigest + PlannerFailureEvidence); ham stderr/stdout
  // interpolasyonu kaldırıldı, yeni üretim modülü eklenmedi.
  // 2026-08-28 10:1x: 1351→1353 — 3356 P1: scripts/lint-doc-command-truth.mjs gate'i
  // (+ package.json lint:gates zinciri) taranan üretim envanterine girdi.
  // 2026-08-28 10:0x: aynı 1351, digest-only b127e8b9→85eddc38 — 3356 P0 paketi:
  // worker-core backend-yetenek kapısı (task-builder/spawn-backend) + MCP karar-disposition
  // kapısı; yeni üretim modülü eklenmedi, taranan metin değişti.
  // 2026-08-28 09:4x: digest 873b946d→b127e8b9 — src/intelligence/ katmanı.
  // 2026-08-29: same 1366, digest-only — run-policy DIRECTIVES heading is
  // case-normalized at the consumer so a declared contract cannot disappear.
  // 2026-08-29 ADR-D-007 planner recovery: count unchanged; digest-only update
  // after the canonical Codex planner profile gained isolated stdin transport,
  // cross-platform wrapper dispatch and timeout-preserving single-settlement
  // EPIPE handling.
  // Same post-build closure pass: no production site was added or removed;
  // this digest records the final validator/harness source bytes.
  // 2026-09-03 T14 final seal: diagnostic-only recovery branches were removed
  // before the final binary; the production inventory count stays unchanged.
  // 2026-09-03 Terminal landing closure: generateCodexConfig gained an
  // injectable homeDir so hermetic tests cannot mutate the operator's real
  // ~/.codex/config.toml; production behavior remains the OS-home default.
  // The same closure pass binds an explicit --verifier-model to both candidate
  // evidence preparation and dispatch, preventing an exact Fable 5.1 request
  // from preparing evidence for the configured Claude default. The production
  // site count is unchanged; only its source digest moves. Project-scoped
  // activation is enforced at task, XVerify and native ingresses; an existing
  // but unreadable/invalid authority is a typed HOLD rather than implicit
  // activation; absent-store detection is race-safe.
  digest: 'f9ee5fc1be5d52e913198b3aef0fb99a265fe4011741494a53bc3c838d7d9e42',
  // 2026-08-27 04:0x: ayni 1339, digest-only — sync workspace-guard + drift-normalize.
  // 2026-08-27 03:1x: ayni 1339, digest-only — skill-pool readJsonSafe donusumu.
  // 2026-08-27 02:0x: ayni 1339, digest-only — Dalga-3 src kaymalari
  // (workspace-artifacts render + sync workspace-kolu).
  // 2026-08-27 00:5x: ayni 1339, digest-only — Dalga-2 + preflight-fix
  // (plugin-hooks runTscCheck typecheck-tercihi) src kaymalari.
  // 2026-08-26 23:4x: ayni 1339, digest-only — Dalga-1 src kaymalari
  // (skill-profile-derivation v2, sync skill kolu, skill-create gate,
  // stack-detector scripts-cozumu + tsc-residual el-kapanisi).
  // 2026-08-26 17:4x: ayni 1339, digest-only — Faz-B merge test-korpusu
  // kaymasi (production inventory metni ayni, referans-graf kaydi).
  // 2026-08-26 15:1x: ayni 1339, digest-only — CI-kapanis S1 fsync/i18n src kaymalari.
  // 12:5x: ayni 1339, digest-only — spawn sync-restorasyonu + lastSpawnCompletion seam.
  // 12:1x: ayni 1339, digest-only — 689 8-dosya typed-throw src kaymalari.
  // 11:49: ayni 1339, digest-only — 7141 typed-throw src kaymalari (12 dosya).
});

const PROTECTED_ROOT_POLICY = new Map([
  ['.tasks', {
    provenance: 'live-tasks',
    code: 'E_HERMETIC_TASKS_WRITE',
  }],
  ['.locks', {
    provenance: 'live-locks',
    code: 'E_HERMETIC_PROJECT_WRITE',
  }],
  ['dist', {
    provenance: 'live-dist',
    code: 'E_HERMETIC_DIST_CLEAN',
  }],
  ['.brain', {
    provenance: 'live-brain',
    code: 'E_HERMETIC_PROJECT_WRITE',
  }],
  ['.deckent', {
    provenance: 'live-deckent',
    code: 'E_HERMETIC_PROJECT_WRITE',
  }],
]);

// Legacy read exemptions remain narrowly scoped to skip-if-absent or tracked-state
// readers. They NEVER suppress writer-registry or child-effect findings.
export const ALLOWLIST = [
  'tests/scripts/adr-validator.test.ts',
  'tests/core/nervous-enabled-integration.test.ts',
  'tests/orchestra/spawn-backend-docker.test.ts',
  'tests/scripts/lint-test-hermeticity.test.ts',
  'tests/docs/api-md-no-stale-refs.test.ts',
  'tests/core/debt-002.test.ts',
  'tests/core/features-manifest.test.ts',
];

export const LEGACY_READ_MIGRATION_BASELINE = Object.freeze([
  'tests/core/debt-002.test.ts:3ad99766549f71dd4975c5136f314bab6305062af608a53de6d31fd180049a33',
  'tests/core/features-manifest.test.ts:b7b9c3987127fea3ad886be3903adc86e3252966c997c0b1d0e52d11bac065ac',
  'tests/core/nervous-enabled-integration.test.ts:2a6ad86be5a4e6cade1a7b07c8866d28c3bbde48f0b9207c8acc62aa8871f8ce',
  'tests/core/nervous-enabled-integration.test.ts:86ab13031d7ee490e260117cf984fb7e9741915e481286a7c9507f95ad688ddf',
  'tests/core/nervous-enabled-integration.test.ts:a52fe8030f86d8bf3ed544ff39030d4cdea3139e5bf4cc5fdbe08cf3db323804',
  'tests/docs/api-md-no-stale-refs.test.ts:184a3e5aaae0b00194e82219e6796717755cace61bd6bf1dab822282a2055aec',
  'tests/docs/api-md-no-stale-refs.test.ts:301f4c688b1b01b1e5dde1b12dd5b5baca1a9c2c54c52f98718ae330423d804f',
  'tests/docs/api-md-no-stale-refs.test.ts:4f75f8d46fbaaf9187569bf62482ec7b259130e04271c69f43ccee58ffbe383a',
  'tests/scripts/adr-validator.test.ts:4caf67a0563d8c3648ed6f17a2a56e47b005b19bfad2f26127d99b56bf0e3705',
  'tests/scripts/adr-validator.test.ts:b5ded85101c0b6a0c8150c04fbea6505ad2b34c104165753f7d884c10ffb7650',
  'tests/scripts/adr-validator.test.ts:c5e3bb78e99849d549d869fb5105298865eed503f3b90eea01fbc7d990e0356a',
  'tests/scripts/adr-validator.test.ts:ee0961ec81de08d3d868893b8d586b5d449231e95cf9a12a32e966b4f24ce4f7',
]);

export const HERMETIC_PATTERNS = [
  { re: /process\.cwd\(\)[^;\n]*\.deckent/, label: 'process.cwd() + .deckent (live root)' },
  { re: /process\.cwd\(\)[^;\n]*\.brain/, label: 'process.cwd() + .brain (live root)' },
  { re: /readFileSync\s*\([^)]*['"]\.deckent\/config\.json['"]/, label: '.deckent/config.json direct readFileSync' },
  { re: /readFileSync\s*\([^)]*['"]\.brain\/memory\.db['"]/, label: '.brain/memory.db direct readFileSync' },
];

export const HERMETIC_LINE_EXEMPTIONS = [
  /tmpdir\s*\(\)/,
  /mkdtempSync\s*\(/,
  /\btmpDir\b|\btempDir\b|\bsandboxDir\b|\bsandbox\b/,
  /withSandboxHome/,
];

const WRITE_SINKS = new Map([
  ['appendFile', [0]],
  ['appendFileSync', [0]],
  ['chmod', [0]],
  ['chmodSync', [0]],
  ['chown', [0]],
  ['chownSync', [0]],
  ['copyFile', [1]],
  ['copyFileSync', [1]],
  ['cp', [1]],
  ['cpSync', [1]],
  ['createWriteStream', [0]],
  ['link', [0, 1]],
  ['linkSync', [0, 1]],
  ['lchown', [0]],
  ['lchownSync', [0]],
  ['lutimes', [0]],
  ['lutimesSync', [0]],
  ['mkdir', [0]],
  ['mkdirSync', [0]],
  ['mkdtemp', [0]],
  ['mkdtempDisposable', [0]],
  ['mkdtempDisposableSync', [0]],
  ['mkdtempSync', [0]],
  ['open', [0]],
  ['openSync', [0]],
  ['rename', [0, 1]],
  ['renameSync', [0, 1]],
  ['rm', [0]],
  ['rmSync', [0]],
  ['rmdir', [0]],
  ['rmdirSync', [0]],
  ['symlink', [1]],
  ['symlinkSync', [1]],
  ['truncate', [0]],
  ['truncateSync', [0]],
  ['unlink', [0]],
  ['unlinkSync', [0]],
  ['utimes', [0]],
  ['utimesSync', [0]],
  ['writeFile', [0]],
  ['writeFileSync', [0]],
]);

const LEGACY_READ_SINKS = new Set([
  'access',
  'accessSync',
  'createReadStream',
  'existsSync',
  'glob',
  'globSync',
  'lstat',
  'lstatSync',
  'open',
  'openSync',
  'opendir',
  'opendirSync',
  'readFile',
  'readFileSync',
  'readdir',
  'readdirSync',
  'readlink',
  'readlinkSync',
  'realpath',
  'realpathSync',
  'stat',
  'statSync',
  'watch',
]);

const SPAWN_METHODS = new Set(['spawn', 'start', 'run']);
const SCRIPT_CALLERS = new Set([
  'runScript',
  'runScriptAsync',
  'spawnAsync',
]);

/** @typedef {'repo'|'repo-scratch'|'live-tasks'|'live-locks'|'live-dist'|'live-brain'|'live-deckent'|'temp'|'fragment'|'deferred'|'unknown'} Provenance */
/** @typedef {{ kind: 'namespace'|'function'|'builtin-loader', module: string, name?: string }} Trust */
/** @typedef {{
 *   id: number,
 *   name: string,
 *   declaration: import('typescript').Node,
 *   initializer?: import('typescript').Expression,
 *   trust?: Trust,
 *   projection?: {
 *     source: import('typescript').Expression,
 *     property?: string,
 *     index?: number,
 *     path?: Array<{ property?: string, index?: number }>,
 *   },
 *   deferred?: boolean,
 *   varScoped?: boolean,
 *   assignments: Array<{
 *     position: number,
 *     operator: import('typescript').SyntaxKind,
 *     expression: import('typescript').Expression,
 *     projection?: {
 *       source: import('typescript').Expression,
 *       path: Array<{ property?: string, index?: number }>,
 *     },
 *     conditional?: boolean,
 *   }>,
 *   propertyAssignments: Array<{
 *     position: number,
 *     operator: import('typescript').SyntaxKind,
 *     path: string[],
 *     expression: import('typescript').Expression,
 *     conditional?: boolean,
 *   }>,
 * }} Binding */

function normalizeRelative(value) {
  return value.split(sep).join('/');
}

function canonicalSourceText(value) {
  return value.replaceAll(/\r\n?/g, '\n');
}

function sourceKind(filePath) {
  return filePath.endsWith('.tsx') || filePath.endsWith('.jsx')
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
}

function lineFor(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function calleeName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

function receiverName(expression) {
  if (!ts.isPropertyAccessExpression(expression)) return undefined;
  return ts.isIdentifier(expression.expression) ? expression.expression.text : undefined;
}

function literalText(node) {
  if (!node) return undefined;
  if (
    ts.isStringLiteralLike(node)
    || ts.isNoSubstitutionTemplateLiteral(node)
    || ts.isRegularExpressionLiteral(node)
  ) {
    return node.text;
  }
  return undefined;
}

function staticPropertyName(expression) {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression)) return literalText(expression.argumentExpression);
  return undefined;
}

function staticPropertyNames(expression, context) {
  const direct = staticPropertyName(expression);
  if (direct !== undefined) return [direct];
  if (ts.isElementAccessExpression(expression) && context) {
    return staticTextValues(expression.argumentExpression, context);
  }
  return [];
}

function propertyNameText(name) {
  if (
    ts.isIdentifier(name)
    || ts.isStringLiteralLike(name)
    || ts.isNumericLiteral(name)
  ) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name)) return literalText(name.expression);
  return undefined;
}

function normalizeBuiltinModule(moduleName) {
  const normalized = moduleName.startsWith('node:') ? moduleName.slice(5) : moduleName;
  if (normalized === 'fs/promises') return 'fs';
  if (
    ['fs', 'path', 'os', 'child_process', 'crypto', 'util', 'module', 'url']
      .includes(normalized)
  ) {
    return normalized;
  }
  return undefined;
}

function trustForNamedImport(moduleName, importedName) {
  if (moduleName === 'fs' && importedName === 'promises') {
    return { kind: 'namespace', module: 'fs' };
  }
  if (moduleName === 'module' && importedName === 'createRequire') {
    return { kind: 'function', module: 'module', name: 'createRequire' };
  }
  return { kind: 'function', module: moduleName, name: importedName };
}

function scopeKind(node) {
  if (ts.isFunctionLike(node)) return 'function';
  if (
    ts.isBlock(node)
    || ts.isCatchClause(node)
    || ts.isForStatement(node)
    || ts.isForInStatement(node)
    || ts.isForOfStatement(node)
  ) {
    return 'block';
  }
  return undefined;
}

function isConditionallyExecuted(node) {
  let cursor = node.parent;
  while (cursor && !ts.isFunctionLike(cursor) && !ts.isSourceFile(cursor)) {
    if (
      ts.isIfStatement(cursor)
      || ts.isConditionalExpression(cursor)
      || ts.isSwitchStatement(cursor)
      || ts.isCaseClause(cursor)
      || ts.isDefaultClause(cursor)
      || ts.isForStatement(cursor)
      || ts.isForInStatement(cursor)
      || ts.isForOfStatement(cursor)
      || ts.isWhileStatement(cursor)
      || ts.isDoStatement(cursor)
      || ts.isTryStatement(cursor)
      || ts.isCatchClause(cursor)
    ) {
      return true;
    }
    cursor = cursor.parent;
  }
  return false;
}

function createAnalysisContext(sourceFile, scanBudget) {
  let nextBindingId = 1;
  const nodeScopes = new WeakMap();
  const rootScope = { parent: undefined, kind: 'source', bindings: new Map() };
  const bindings = [];
  const mockedModules = new Set();

  const addBinding = (
    scope,
    name,
    declaration,
    initializer,
    trust,
    deferred = false,
    projection,
    varScoped = false,
  ) => {
    /** @type {Binding} */
    const binding = {
      id: nextBindingId,
      name,
      declaration,
      initializer,
      trust,
      projection,
      deferred,
      varScoped,
      assignments: [],
      propertyAssignments: [],
    };
    nextBindingId += 1;
    const sameName = scope.bindings.get(name) ?? [];
    sameName.push(binding);
    scope.bindings.set(name, sameName);
    bindings.push(binding);
    return binding;
  };

  const visit = (node, inheritedScope) => {
    scanBudget?.check('analysis-context');
    const outerScope = inheritedScope;
    const nextScopeKind = node !== sourceFile ? scopeKind(node) : undefined;
    const scope = nextScopeKind
      ? { parent: inheritedScope, kind: nextScopeKind, bindings: new Map() }
      : inheritedScope;
    nodeScopes.set(node, scope);

    if (
      ts.isCallExpression(node)
      && (
        ts.isPropertyAccessExpression(node.expression)
        || ts.isElementAccessExpression(node.expression)
      )
      && staticPropertyName(node.expression) === 'mock'
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === 'vi'
    ) {
      const mocked = literalText(node.arguments[0]);
      const normalized = mocked ? normalizeBuiltinModule(mocked) : undefined;
      if (normalized) mockedModules.add(normalized);
    }

    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const moduleName = normalizeBuiltinModule(node.moduleSpecifier.text);
      const clause = node.importClause;
      if (moduleName && clause) {
        if (clause.name) {
          addBinding(scope, clause.name.text, clause.name, undefined, {
            kind: 'namespace',
            module: moduleName,
          });
        }
        const namedBindings = clause.namedBindings;
        if (namedBindings && ts.isNamespaceImport(namedBindings)) {
          addBinding(scope, namedBindings.name.text, namedBindings.name, undefined, {
            kind: 'namespace',
            module: moduleName,
          });
        } else if (namedBindings && ts.isNamedImports(namedBindings)) {
          for (const element of namedBindings.elements) {
            addBinding(
              scope,
              element.name.text,
              element.name,
              undefined,
              trustForNamedImport(moduleName, (element.propertyName ?? element.name).text),
            );
          }
        }
      } else if (node.moduleSpecifier.text === 'vitest' && clause?.namedBindings) {
        if (ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            const importedName = (element.propertyName ?? element.name).text;
            if (importedName === 'expect' || importedName === 'vi') {
              addBinding(scope, element.name.text, element.name, undefined, {
                kind: 'function',
                module: 'vitest',
                name: importedName,
              });
            }
          }
        }
      }
    } else if (
      ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
      && ts.isStringLiteral(node.moduleReference.expression)
    ) {
      const moduleName = normalizeBuiltinModule(node.moduleReference.expression.text);
      if (moduleName) {
        addBinding(scope, node.name.text, node.name, undefined, {
          kind: 'namespace',
          module: moduleName,
        });
      }
    }

    if (ts.isFunctionDeclaration(node) && node.name) {
      addBinding(outerScope, node.name.text, node.name);
    } else if (ts.isFunctionExpression(node) && node.name) {
      addBinding(scope, node.name.text, node.name);
    } else if (ts.isClassDeclaration(node) && node.name) {
      addBinding(outerScope, node.name.text, node.name);
    } else if (ts.isVariableDeclaration(node)) {
      const declarationList = ts.isVariableDeclarationList(node.parent)
        ? node.parent
        : undefined;
      const blockScoped = declarationList === undefined
        || Boolean(declarationList.flags & ts.NodeFlags.BlockScoped);
      let declarationScope = scope;
      if (!blockScoped) {
        while (
          declarationScope.parent
          && declarationScope.kind !== 'function'
          && declarationScope.kind !== 'source'
        ) {
          declarationScope = declarationScope.parent;
        }
      }

      const projectedObjectValue = (source, propertyName) => {
        if (!source || !ts.isObjectLiteralExpression(source)) return undefined;
        for (const property of source.properties) {
          if (
            ts.isPropertyAssignment(property)
            && propertyNameText(property.name) === propertyName
          ) {
            return property.initializer;
          }
          if (
            ts.isShorthandPropertyAssignment(property)
            && property.name.text === propertyName
          ) {
            return property.name;
          }
        }
        return undefined;
      };
      const addPattern = (pattern, source, inheritedProjection) => {
        if (ts.isIdentifier(pattern)) {
          if (!blockScoped) {
            const existing = (declarationScope.bindings.get(pattern.text) ?? [])
              .find(binding => binding.varScoped);
            if (existing) {
              if (source) {
                existing.assignments.push({
                  position: pattern.getStart(sourceFile),
                  operator: ts.SyntaxKind.EqualsToken,
                  expression: source,
                  conditional: isConditionallyExecuted(pattern),
                });
              }
              return;
            }
          }
          addBinding(
            declarationScope,
            pattern.text,
            pattern,
            source,
            undefined,
            false,
            inheritedProjection,
            !blockScoped,
          );
          return;
        }
        pattern.elements.forEach((element, index) => {
          if (ts.isOmittedExpression(element)) return;
          const propertyName = ts.isObjectBindingPattern(pattern)
            ? (
              element.propertyName
                ? propertyNameText(element.propertyName)
                : ts.isIdentifier(element.name) ? element.name.text : undefined
            )
            : undefined;
          let projected;
          if (ts.isArrayBindingPattern(pattern) && source && ts.isArrayLiteralExpression(source)) {
            const arrayElement = source.elements[index];
            if (arrayElement && !ts.isSpreadElement(arrayElement)) projected = arrayElement;
          } else if (propertyName) {
            projected = projectedObjectValue(source, propertyName);
          }
          const fallback = projected ?? element.initializer;
          const step = propertyName === undefined ? { index } : { property: propertyName };
          const projection = fallback === undefined
            ? source
              ? { source, path: [step] }
              : inheritedProjection
                ? {
                  source: inheritedProjection.source,
                  path: [...(inheritedProjection.path ?? []), step],
                }
                : undefined
            : undefined;
          if (ts.isIdentifier(element.name)) {
            addBinding(
              declarationScope,
              element.name.text,
              element.name,
              fallback,
              undefined,
              fallback === undefined,
              projection,
              !blockScoped,
            );
          } else {
            addPattern(element.name, fallback, projection);
          }
        });
      };
      addPattern(node.name, node.initializer);
    } else if (ts.isParameter(node)) {
      const addParameterPattern = pattern => {
        if (ts.isIdentifier(pattern)) {
          addBinding(scope, pattern.text, pattern, node.initializer, undefined, true);
          return;
        }
        for (const element of pattern.elements) {
          if (ts.isOmittedExpression(element)) continue;
          addParameterPattern(element.name);
        }
      };
      addParameterPattern(node.name);
    }

    node.forEachChild(child => visit(child, scope));
  };
  visit(sourceFile, rootScope);

  const context = {
    sourceFile,
    nodeScopes,
    rootScope,
    bindings,
    mockedModules,
    resolveBinding(name, node) {
      let scope = nodeScopes.get(node) ?? rootScope;
      while (scope) {
        const candidates = scope.bindings.get(name);
        if (candidates?.length) {
          const preceding = candidates
            .filter(binding => binding.declaration.getStart(sourceFile) <= node.getStart(sourceFile))
            .sort((left, right) =>
              right.declaration.getStart(sourceFile) - left.declaration.getStart(sourceFile));
          // A lexical declaration shadows its parent for the whole scope. Before
          // initialization it resolves to unknown (TDZ), never to the outer binding.
          return preceding[0] ?? candidates[0];
        }
        scope = scope.parent;
      }
      return undefined;
    },
  };

  const assignmentOperators = new Set([
    ts.SyntaxKind.EqualsToken,
    ts.SyntaxKind.PlusEqualsToken,
    ts.SyntaxKind.BarBarEqualsToken,
    ts.SyntaxKind.AmpersandAmpersandEqualsToken,
    ts.SyntaxKind.QuestionQuestionEqualsToken,
  ]);
  const assignmentIsConditional = node =>
    isConditionallyExecuted(node)
    || node.operatorToken.kind === ts.SyntaxKind.BarBarEqualsToken
    || node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken
    || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionEqualsToken;
  const recordPatternAssignment = (pattern, source, node, path = []) => {
    const target = unwrapExpression(pattern);
    if (ts.isIdentifier(target)) {
      const binding = context.resolveBinding(target.text, target);
      binding?.assignments.push({
        position: node.getStart(sourceFile),
        operator: node.operatorToken.kind,
        expression: source,
        ...(path.length > 0 ? { projection: { source, path } } : {}),
        conditional: assignmentIsConditional(node),
      });
      return;
    }
    if (ts.isObjectLiteralExpression(target)) {
      for (const property of target.properties) {
        if (ts.isPropertyAssignment(property)) {
          const propertyName = propertyNameText(property.name);
          if (propertyName !== undefined) {
            recordPatternAssignment(
              property.initializer,
              source,
              node,
              [...path, { property: propertyName }],
            );
          }
        } else if (ts.isShorthandPropertyAssignment(property)) {
          recordPatternAssignment(
            property.name,
            source,
            node,
            [...path, { property: property.name.text }],
          );
        }
      }
      return;
    }
    if (ts.isArrayLiteralExpression(target)) {
      target.elements.forEach((element, index) => {
        if (!ts.isOmittedExpression(element) && !ts.isSpreadElement(element)) {
          recordPatternAssignment(element, source, node, [...path, { index }]);
        }
      });
    }
  };
  const memberAssignmentTarget = expression => {
    const path = [];
    let cursor = unwrapExpression(expression);
    while (
      ts.isPropertyAccessExpression(cursor)
      || ts.isElementAccessExpression(cursor)
    ) {
      const names = staticPropertyNames(cursor, context);
      if (names.length !== 1) return undefined;
      path.unshift(names[0]);
      cursor = unwrapExpression(cursor.expression);
    }
    return ts.isIdentifier(cursor) && path.length > 0
      ? { root: cursor, path }
      : undefined;
  };
  const collectAssignments = node => {
    if (ts.isBinaryExpression(node) && assignmentOperators.has(node.operatorToken.kind)) {
      if (
        ts.isIdentifier(unwrapExpression(node.left))
        || ts.isObjectLiteralExpression(unwrapExpression(node.left))
        || ts.isArrayLiteralExpression(unwrapExpression(node.left))
      ) {
        recordPatternAssignment(node.left, node.right, node);
      } else {
        const target = memberAssignmentTarget(node.left);
        const binding = target
          ? context.resolveBinding(target.root.text, target.root)
          : undefined;
        binding?.propertyAssignments.push({
          position: node.getStart(sourceFile),
          operator: node.operatorToken.kind,
          path: target.path,
          expression: node.right,
          conditional: assignmentIsConditional(node),
        });
      }
    }
    node.forEachChild(collectAssignments);
  };
  sourceFile.forEachChild(collectAssignments);

  const collectMockedCapabilities = node => {
    if (
      ts.isCallExpression(node)
      && (
        ts.isPropertyAccessExpression(node.expression)
        || ts.isElementAccessExpression(node.expression)
      )
      && staticPropertyName(node.expression) === 'spyOn'
      && ts.isIdentifier(node.expression.expression)
    ) {
      const viBinding = context.resolveBinding(
        node.expression.expression.text,
        node.expression.expression,
      );
      const namespace = node.arguments[0]
        ? trustedNamespace(node.arguments[0], context)
        : undefined;
      if (
        viBinding?.trust?.module === 'vitest'
        && viBinding.trust.name === 'vi'
        && namespace
      ) {
        mockedModules.add(namespace.module);
      }
    }
    node.forEachChild(collectMockedCapabilities);
  };
  sourceFile.forEachChild(collectMockedCapabilities);
  return context;
}

function sameTrust(left, right) {
  return left?.kind === right?.kind
    && left?.module === right?.module
    && left?.name === right?.name;
}

function bindingValuesAtUse(binding, useNode, context) {
  const usePosition = useNode.getStart(context.sourceFile);
  let values = (
    binding.initializer
    && binding.declaration.getStart(context.sourceFile) <= usePosition
  )
    ? [{ expression: binding.initializer }]
    : [];
  for (const assignment of [...binding.assignments].sort((left, right) =>
    left.position - right.position)) {
    if (assignment.position >= usePosition) continue;
    const value = assignment.projection
      ? { projection: assignment.projection }
      : { expression: assignment.expression };
    if (assignment.operator === ts.SyntaxKind.EqualsToken) {
      values = assignment.conditional ? [...values, value] : [value];
    } else if (assignment.conditional) {
      values = [...values, value];
    } else {
      values = [];
    }
  }
  return values;
}

function bindingExpressionsAtUse(binding, useNode, context) {
  return bindingValuesAtUse(binding, useNode, context).flatMap(value =>
    value.projection
      ? bindingProjectionExpressions(value.projection, context)
      : [value.expression]);
}

function bindingTrust(binding, useNode, context, bindingStack = new Set()) {
  if (binding.trust && binding.assignments.length === 0) return binding.trust;
  if (bindingStack.has(binding.id)) return undefined;
  const nextStack = new Set(bindingStack);
  nextStack.add(binding.id);

  if (binding.projection) {
    const projectedTrust = trustForBindingProjection(
      binding.projection,
      context,
      nextStack,
    );
    if (projectedTrust) return projectedTrust;
  }

  const candidates = bindingValuesAtUse(binding, useNode, context)
    .map(value => value.projection
      ? trustForBindingProjection(value.projection, context, nextStack)
      : trustedCapability(value.expression, context, nextStack))
    .filter(value => value !== undefined);
  if (
    candidates.length > 0
    && candidates.every(candidate => sameTrust(candidate, candidates[0]))
  ) {
    return candidates[0];
  }
  return undefined;
}

function trustedBuiltinLoader(expression, context, bindingStack = new Set()) {
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) {
    const binding = context.resolveBinding(unwrapped.text, unwrapped);
    if (!binding) return unwrapped.text === 'require';
    const ambientDeclaration = ts.isVariableDeclaration(binding.declaration.parent)
      && !binding.initializer
      && (
        ts.getCombinedModifierFlags(binding.declaration.parent.parent.parent)
        & ts.ModifierFlags.Ambient
      ) !== 0;
    if (unwrapped.text === 'require' && ambientDeclaration) return true;
    return bindingTrust(binding, unwrapped, context, bindingStack)?.kind === 'builtin-loader';
  }
  if (
    (
      ts.isPropertyAccessExpression(unwrapped)
      || ts.isElementAccessExpression(unwrapped)
    )
    && staticPropertyName(unwrapped) === 'require'
    && ts.isIdentifier(unwrapped.expression)
    && unwrapped.expression.text === 'module'
    && !context.resolveBinding('module', unwrapped.expression)
  ) {
    return true;
  }
  if (ts.isCallExpression(unwrapped)) {
    return trustedCapability(unwrapped, context, bindingStack)?.kind === 'builtin-loader';
  }
  return false;
}

function trustedNamespace(expression, context, bindingStack = new Set()) {
  if (
    ts.isParenthesizedExpression(expression)
    || ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression)
    || ts.isNonNullExpression(expression)
    || ts.isAwaitExpression(expression)
    || ts.isSatisfiesExpression(expression)
  ) {
    return trustedNamespace(expression.expression, context, bindingStack);
  }
  if (ts.isIdentifier(expression)) {
    const binding = context.resolveBinding(expression.text, expression);
    if (!binding) return undefined;
    const trust = bindingTrust(binding, expression, context, bindingStack);
    return trust?.kind === 'namespace' ? trust : undefined;
  }
  if (ts.isCallExpression(expression)) {
    let moduleText;
    if (
      expression.expression.kind === ts.SyntaxKind.ImportKeyword
      && expression.arguments.length === 1
    ) {
      moduleText = literalText(expression.arguments[0]);
    } else if (
      trustedBuiltinLoader(expression.expression, context, bindingStack)
      && expression.arguments.length === 1
    ) {
      moduleText = literalText(expression.arguments[0]);
      if (moduleText === undefined) {
        return { kind: 'namespace', module: 'unknown-builtin' };
      }
    } else if (
      (
        ts.isPropertyAccessExpression(expression.expression)
        || ts.isElementAccessExpression(expression.expression)
      )
      && staticPropertyName(expression.expression) === 'getBuiltinModule'
      && ts.isIdentifier(expression.expression.expression)
      && expression.expression.expression.text === 'process'
      && !context.resolveBinding('process', expression.expression.expression)
      && expression.arguments.length === 1
    ) {
      moduleText = literalText(expression.arguments[0]);
    }
    const moduleName = moduleText ? normalizeBuiltinModule(moduleText) : undefined;
    if (moduleName) return { kind: 'namespace', module: moduleName };
  }
  const property = staticPropertyName(expression);
  if (
    property === 'promises'
    && (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression))
  ) {
    const receiver = trustedNamespace(expression.expression, context, bindingStack);
    if (receiver?.module === 'fs') return receiver;
  }
  return undefined;
}

function trustedFunction(expression, context, bindingStack = new Set()) {
  if (
    ts.isParenthesizedExpression(expression)
    || ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression)
    || ts.isNonNullExpression(expression)
    || ts.isSatisfiesExpression(expression)
  ) {
    return trustedFunction(expression.expression, context, bindingStack);
  }
  if (ts.isIdentifier(expression)) {
    const binding = context.resolveBinding(expression.text, expression);
    if (!binding) return undefined;
    const trust = bindingTrust(binding, expression, context, bindingStack);
    return trust?.kind === 'function' ? trust : undefined;
  }
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    const receiver = trustedNamespace(expression.expression, context, bindingStack);
    const names = staticPropertyNames(expression, context);
    if (receiver && names.length > 0 && names.every(name => name === names[0])) {
      return { kind: 'function', module: receiver.module, name: names[0] };
    }
    const projected = names.flatMap(name =>
      projectedPropertyExpressions(
        expression.expression,
        name,
        undefined,
        context,
        bindingStack,
      ));
    const candidates = projected
      .map(value => trustedCapability(value, context, bindingStack))
      .filter(value => value?.kind === 'function');
    if (
      candidates.length > 0
      && candidates.every(candidate => sameTrust(candidate, candidates[0]))
    ) {
      return candidates[0];
    }
  }
  return undefined;
}

function trustedCapability(expression, context, bindingStack = new Set()) {
  if (
    ts.isConditionalExpression(expression)
    || (
      ts.isBinaryExpression(expression)
      && (
        expression.operatorToken.kind === ts.SyntaxKind.BarBarToken
        || expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        || expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      )
    )
  ) {
    const branches = ts.isConditionalExpression(expression)
      ? [expression.whenTrue, expression.whenFalse]
      : [expression.left, expression.right];
    const candidates = branches
      .map(branch => trustedCapability(branch, context, bindingStack))
      .filter(value => value !== undefined);
    if (
      candidates.length > 0
      && candidates.every(candidate => sameTrust(candidate, candidates[0]))
    ) {
      return candidates[0];
    }
  }
  if (ts.isCallExpression(expression)) {
    const called = trustedFunction(expression.expression, context, bindingStack);
    if (called?.module === 'module' && called.name === 'createRequire') {
      return { kind: 'builtin-loader', module: 'module', name: 'require' };
    }
    if (called?.module === 'util' && called.name === 'promisify' && expression.arguments[0]) {
      return trustedFunction(expression.arguments[0], context, bindingStack);
    }
    if (
      (ts.isPropertyAccessExpression(expression.expression)
        || ts.isElementAccessExpression(expression.expression))
      && staticPropertyName(expression.expression) === 'bind'
    ) {
      return trustedFunction(expression.expression.expression, context, bindingStack);
    }
  }
  return trustedNamespace(expression, context, bindingStack)
    ?? trustedFunction(expression, context, bindingStack);
}

function canonicalPathText(value) {
  const normalized = value.replaceAll('\\', '/');
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')) {
    return win32Path.normalize(value).replaceAll('\\', '/');
  }
  return posixPath.normalize(normalized);
}

function pathComparisonText(value) {
  const canonical = canonicalPathText(value);
  return /^[A-Za-z]:\//.test(canonical) || canonical.startsWith('//')
    ? canonical.toLowerCase()
    : canonical;
}

function portablePathSegmentKey(value) {
  // Windows treats path segments case-insensitively and strips trailing dots
  // and spaces. A test is hermetic only if it is safe on every supported host.
  return value.replace(/[ .]+$/g, '').toLowerCase();
}

function boundaryFromText(value) {
  const normalized = canonicalPathText(value);
  const driveRelative = /^[A-Za-z]:(?!\/)/.test(normalized);
  const effectiveValue = driveRelative ? normalized.slice(2) : normalized;
  const absolute = effectiveValue.startsWith('/') || /^[A-Za-z]:\//.test(effectiveValue);
  const segments = [];
  for (const segment of effectiveValue.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length > 0 && segments.at(-1) !== '..') segments.pop();
      else segments.push(segment);
      continue;
    }
    segments.push(segment);
  }
  let effectiveSegments = segments;
  if (absolute) {
    const normalizedRepo = canonicalPathText(REPO_ROOT).replace(/\/+$/, '');
    const normalizedValue = effectiveValue.replace(/\/+$/, '');
    const comparedRepo = pathComparisonText(normalizedRepo);
    const comparedValue = pathComparisonText(normalizedValue);
    const portableRepo = comparedRepo.toLocaleLowerCase('en-US');
    const portableValue = comparedValue.toLocaleLowerCase('en-US');
    if (
      comparedValue === comparedRepo
      || comparedValue.startsWith(`${comparedRepo}/`)
      || portableValue === portableRepo
      || portableValue.startsWith(`${portableRepo}/`)
    ) {
      effectiveSegments = normalizedValue
        .slice(normalizedRepo.length)
        .split('/')
        .filter(Boolean);
    } else {
      return undefined;
    }
  } else if (segments[0] === REPO_PATH_TOKEN) {
    effectiveSegments = segments.slice(1);
  }
  const first = portablePathSegmentKey(effectiveSegments[0] ?? '');
  return PROTECTED_ROOT_POLICY.get(first)?.provenance;
}

function literalPathProvenance(value) {
  const normalized = canonicalPathText(value);
  const boundary = boundaryFromText(normalized);
  if (boundary) return boundary;
  if (
    /^\/(?:tmp|var\/tmp)(?:\/|$)/.test(normalized)
    || /^\/private\/var\/folders(?:\/|$)/.test(normalized)
    || /^[A-Za-z]:\/Users\/[^/]+\/AppData\/Local\/Temp(?:\/|$)/i.test(normalized)
  ) {
    return 'temp';
  }
  const absolute = normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized);
  if (absolute) return 'unknown';
  return 'fragment';
}

function pathBoundaryFromArguments(argumentsList, startIndex, context) {
  let lastOpaqueIndex = -1;
  for (let index = startIndex; index < argumentsList.length; index += 1) {
    if (staticTextValues(argumentsList[index], context).length === 0) {
      const visible = expressionBoundary(argumentsList[index], context);
      if (visible) return visible;
      lastOpaqueIndex = index;
    }
  }

  let combinations = [''];
  const effectiveStart = lastOpaqueIndex >= 0 ? lastOpaqueIndex + 1 : startIndex;
  for (let index = effectiveStart; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    const values = staticTextValues(argument, context);
    if (values.length === 0) continue;
    combinations = crossStaticValues(
      combinations,
      values,
      (prefix, value) => prefix.length > 0 ? `${prefix}/${value}` : value,
    );
  }
  for (const candidate of combinations) {
    const boundary = boundaryFromText(candidate);
    if (boundary) return boundary;
  }
  return undefined;
}

function isDefinitelyRelativeFragment(expression, context) {
  if (ts.isIdentifier(expression)) {
    const binding = context.resolveBinding(expression.text, expression);
    if (binding && ts.isParameter(binding.declaration.parent)) {
      return context.relativeFragmentOverrides?.has(binding.id)
        || context.provenanceOverrides?.get(binding.id) === 'fragment';
    }
  }
  const values = staticTextValues(expression, context);
  if (values.length > 0) {
    return values.every(value => {
      const normalized = value.replaceAll('\\', '/');
      return normalized !== REPO_PATH_TOKEN
        && !normalized.startsWith(`${REPO_PATH_TOKEN}/`)
        && !normalized.startsWith('/')
        && !/^[A-Za-z]:\//.test(normalized)
        && !normalized.split('/').includes('..');
    });
  }
  if (ts.isTemplateExpression(expression)) {
    const literalParts = [
      expression.head.text,
      ...expression.templateSpans.map(span => span.literal.text),
    ];
    return literalParts.every(part => !/[\\/]/.test(part) && !part.includes('..'))
      && expression.templateSpans.every(span =>
        isDefinitelyRelativeFragment(span.expression, context));
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return isDefinitelyRelativeFragment(expression.left, context)
      && isDefinitelyRelativeFragment(expression.right, context);
  }
  if (
    ts.isPropertyAccessExpression(expression)
    && ts.isIdentifier(expression.expression)
    && expression.expression.text === 'process'
    && expression.name.text === 'pid'
    && !context.resolveBinding('process', expression.expression)
  ) {
    return true;
  }
  if (
    ts.isCallExpression(expression)
    && ts.isPropertyAccessExpression(expression.expression)
    && ts.isIdentifier(expression.expression.expression)
    && (
      (expression.expression.expression.text === 'Date' && expression.expression.name.text === 'now')
      || (
        expression.expression.expression.text === 'Math'
        && expression.expression.name.text === 'random'
      )
    )
    && !context.resolveBinding(
      expression.expression.expression.text,
      expression.expression.expression,
    )
  ) {
    return true;
  }
  if (ts.isCallExpression(expression)) {
    const trust = trustedFunction(expression.expression, context);
    if (
      trust?.module === 'crypto'
      && (trust.name === 'randomBytes' || trust.name === 'randomUUID')
    ) {
      return true;
    }
  }
  if (
    ts.isCallExpression(expression)
    && ts.isPropertyAccessExpression(expression.expression)
    && ['slice', 'substring', 'toString'].includes(expression.expression.name.text)
    && isDefinitelyRelativeFragment(expression.expression.expression, context)
  ) {
    return true;
  }
  return false;
}

function expressionBoundary(expression, context) {
  if (context) {
    const staticValues = staticTextValues(expression, context);
    if (staticValues.length > 0) {
      for (const value of staticValues) {
        const boundary = boundaryFromText(value);
        if (boundary) return boundary;
      }
      return undefined;
    }
  }
  if (ts.isStringLiteralLike(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return boundaryFromText(expression.text);
  }
  if (ts.isTemplateExpression(expression)) {
    const parts = [
      expression.head.text,
      ...expression.templateSpans.map(span => span.literal.text),
    ];
    for (const part of parts) {
      const boundary = boundaryFromText(part);
      if (boundary) return boundary;
    }
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return expressionBoundary(expression.left, context)
      ?? expressionBoundary(expression.right, context);
  }
  if (ts.isConditionalExpression(expression)) {
    return expressionBoundary(expression.whenTrue, context)
      ?? expressionBoundary(expression.whenFalse, context);
  }
  if (ts.isCallExpression(expression)) {
    for (const argument of expression.arguments) {
      const boundary = expressionBoundary(argument, context);
      if (boundary) return boundary;
    }
  }
  return undefined;
}

function mergeProvenances(values) {
  for (const hazardous of [...PROTECTED_ROOT_POLICY.values()]
    .map(policy => policy.provenance)) {
    if (values.includes(hazardous)) return hazardous;
  }
  if (values.includes('repo-scratch')) return 'repo-scratch';
  if (values.includes('repo')) return 'repo';
  const substantive = values.filter(value => value !== 'fragment');
  if (substantive.length > 0 && substantive.every(value => value === 'temp')) return 'temp';
  if (values.length > 0 && substantive.length === 0) return 'fragment';
  if (values.includes('deferred')) return 'deferred';
  return 'unknown';
}

function protectedStaticProvenance(expression, context, bindingStack = new Set()) {
  const boundaries = staticTextValues(expression, context, bindingStack)
    .map(boundaryFromText)
    .filter(value => value !== undefined);
  return boundaries.length > 0 ? mergeProvenances(boundaries) : undefined;
}

function bindingExpressions(binding, useNode, context, bindingStack = new Set()) {
  const usePosition = useNode.getStart(context.sourceFile);
  const expressions = [];
  if (
    binding.initializer
    && binding.declaration.getStart(context.sourceFile) <= usePosition
  ) {
    expressions.push(binding.initializer);
  }
  for (const assignment of binding.assignments) {
    // Test fixtures commonly initialize shared roots in beforeEach declared
    // later in source order. Keep every assignment attached to this exact
    // lexical binding; hazardous alternatives still dominate in merge.
    if (
      assignment.expression.kind !== ts.SyntaxKind.NullKeyword
      && !(
        ts.isIdentifier(assignment.expression)
        && assignment.expression.text === 'undefined'
      )
    ) {
      expressions.push(...(
        assignment.projection
          ? bindingProjectionExpressions(assignment.projection, context, bindingStack)
          : [assignment.expression]
      ));
    }
  }
  return expressions;
}

function projectedPropertyExpressions(
  expression,
  propertyName,
  index,
  context,
  bindingStack = new Set(),
) {
  if (
    ts.isParenthesizedExpression(expression)
    || ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression)
    || ts.isNonNullExpression(expression)
    || ts.isAwaitExpression(expression)
    || ts.isSatisfiesExpression(expression)
  ) {
    return projectedPropertyExpressions(
      expression.expression,
      propertyName,
      index,
      context,
      bindingStack,
    );
  }
  if (ts.isIdentifier(expression)) {
    const binding = context.resolveBinding(expression.text, expression);
    if (!binding || bindingStack.has(binding.id)) return [];
    const nextStack = new Set(bindingStack);
    nextStack.add(binding.id);
    let values = bindingExpressions(binding, expression, context, nextStack).flatMap(value =>
      projectedPropertyExpressions(value, propertyName, index, context, nextStack));
    if (propertyName !== undefined && index === undefined) {
      for (const assignment of [...binding.propertyAssignments].sort((left, right) =>
        left.position - right.position)) {
        if (
          assignment.position >= expression.getStart(context.sourceFile)
          || assignment.path.length !== 1
          || assignment.path[0] !== propertyName
        ) {
          continue;
        }
        if (
          assignment.operator === ts.SyntaxKind.EqualsToken
          && !assignment.conditional
        ) {
          values = [assignment.expression];
        } else {
          values.push(assignment.expression);
        }
      }
    }
    return values;
  }
  if (ts.isConditionalExpression(expression)) {
    return [
      ...projectedPropertyExpressions(
        expression.whenTrue,
        propertyName,
        index,
        context,
        bindingStack,
      ),
      ...projectedPropertyExpressions(
        expression.whenFalse,
        propertyName,
        index,
        context,
        bindingStack,
      ),
    ];
  }
  if (propertyName !== undefined && ts.isObjectLiteralExpression(expression)) {
    const values = [];
    for (const property of expression.properties) {
      if (
        ts.isPropertyAssignment(property)
        && propertyNameText(property.name) === propertyName
      ) {
        values.push(property.initializer);
      } else if (
        ts.isShorthandPropertyAssignment(property)
        && property.name.text === propertyName
      ) {
        values.push(property.name);
      } else if (
        (ts.isMethodDeclaration(property)
          || ts.isGetAccessorDeclaration(property)
          || ts.isSetAccessorDeclaration(property))
        && propertyNameText(property.name) === propertyName
      ) {
        values.push(property);
      } else if (ts.isSpreadAssignment(property)) {
        values.push(...projectedPropertyExpressions(
          property.expression,
          propertyName,
          undefined,
          context,
          bindingStack,
        ));
      }
    }
    return values;
  }
  if (
    index !== undefined
    && ts.isArrayLiteralExpression(expression)
    && expression.elements[index]
    && !ts.isSpreadElement(expression.elements[index])
  ) {
    return [expression.elements[index]];
  }
  return [];
}

function projectionSteps(projection) {
  if (projection.path) return projection.path;
  return [{
    ...(projection.property === undefined ? {} : { property: projection.property }),
    ...(projection.index === undefined ? {} : { index: projection.index }),
  }];
}

function bindingProjectionExpressions(projection, context, bindingStack = new Set()) {
  let values = [projection.source];
  for (const step of projectionSteps(projection)) {
    values = values.flatMap(value => projectedPropertyExpressions(
      value,
      step.property,
      step.index,
      context,
      bindingStack,
    ));
  }
  return values;
}

function trustForBindingProjection(projection, context, bindingStack = new Set()) {
  let namespace = trustedNamespace(projection.source, context, bindingStack);
  const steps = projectionSteps(projection);
  if (namespace) {
    for (let index = 0; index < steps.length; index += 1) {
      const property = steps[index].property;
      if (!property) return undefined;
      if (namespace.module === 'fs' && property === 'promises') continue;
      if (index === steps.length - 1) {
        return { kind: 'function', module: namespace.module, name: property };
      }
      return undefined;
    }
    return namespace;
  }
  const candidates = bindingProjectionExpressions(projection, context, bindingStack)
    .map(value => trustedCapability(value, context, bindingStack))
    .filter(value => value !== undefined);
  if (
    candidates.length > 0
    && candidates.every(candidate => sameTrust(candidate, candidates[0]))
  ) {
    return candidates[0];
  }
  return undefined;
}

/**
 * Resolve enough path provenance to distinguish the live repository authority
 * from nonce-owned OS temp roots. Unknown never becomes trusted.
 *
 * @param {import('typescript').Expression} expression
 * @param {ReturnType<typeof createAnalysisContext>} context
 * @param {Set<number>} [bindingStack]
 * @returns {Provenance}
 */
function expressionProvenance(expression, context, bindingStack = new Set()) {
  if (ts.isParenthesizedExpression(expression)) {
    return expressionProvenance(expression.expression, context, bindingStack);
  }
  if (
    ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression)
    || ts.isNonNullExpression(expression)
    || ts.isAwaitExpression(expression)
    || ts.isSatisfiesExpression(expression)
  ) {
    return expressionProvenance(expression.expression, context, bindingStack);
  }
  if (ts.isIdentifier(expression)) {
    const binding = context.resolveBinding(expression.text, expression);
    if (!binding || bindingStack.has(binding.id)) return 'unknown';
    const override = context.provenanceOverrides?.get(binding.id);
    if (override) return override;
    const staticProtected = protectedStaticProvenance(expression, context, bindingStack);
    if (staticProtected) return staticProtected;
    const nextStack = new Set(bindingStack);
    nextStack.add(binding.id);
    if (binding.projection) {
      const projected = bindingProjectionExpressions(
        binding.projection,
        context,
        nextStack,
      );
      if (projected.length > 0) {
        return mergeProvenances(projected.map(value =>
          expressionProvenance(value, context, nextStack)));
      }
      const steps = projectionSteps(binding.projection);
      if (steps.at(-1)?.property === 'path') {
        const owner = expressionProvenance(
          binding.projection.source,
          context,
          nextStack,
        );
        if (
          owner === 'temp'
          || owner === 'repo'
          || owner === 'repo-scratch'
          || owner.startsWith('live-')
        ) {
          return owner;
        }
      }
    }
    const bindingValues = bindingExpressions(binding, expression, context);
    if (
      bindingValues.length === 0
      && (binding.deferred || ts.isParameter(binding.declaration.parent))
    ) {
      return 'deferred';
    }
    const values = bindingValues
      .map(value => expressionProvenance(value, context, nextStack));
    if (ts.isParameter(binding.declaration.parent)) values.push('deferred');
    return mergeProvenances(values);
  }

  if (ts.isStringLiteralLike(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return literalPathProvenance(expression.text);
  }

  if (ts.isCallExpression(expression)) {
    const trust = trustedFunction(expression.expression, context);
    if (
      staticPropertyName(expression.expression) === 'cwd'
      && ts.isPropertyAccessExpression(expression.expression)
      && ts.isIdentifier(expression.expression.expression)
      && expression.expression.expression.text === 'process'
      && !context.resolveBinding('process', expression.expression.expression)
    ) {
      return 'repo';
    }
    if (
      trust?.module === 'url'
      && trust.name === 'fileURLToPath'
      && expression.arguments[0]
      && ts.isPropertyAccessExpression(expression.arguments[0])
      && expression.arguments[0].name.text === 'url'
      && ts.isMetaProperty(expression.arguments[0].expression)
      && expression.arguments[0].expression.keywordToken === ts.SyntaxKind.ImportKeyword
    ) {
      return 'repo';
    }
    if (
      trust?.module === 'path'
      && trust.name === 'dirname'
      && expression.arguments[0]
    ) {
      const owner = expressionProvenance(
        expression.arguments[0],
        context,
        bindingStack,
      );
      if (
        owner === 'repo'
        || owner === 'repo-scratch'
        || owner === 'temp'
        || owner.startsWith('live-')
      ) {
        return owner;
      }
    }
    if (trust?.module === 'os' && trust.name === 'tmpdir') return 'temp';
    if (
      trust?.module === 'fs'
      && (
        trust.name === 'mkdtemp'
        || trust.name === 'mkdtempSync'
        || trust.name === 'mkdtempDisposable'
        || trust.name === 'mkdtempDisposableSync'
      )
    ) {
      const prefix = expression.arguments[0];
      return prefix ? expressionProvenance(prefix, context, bindingStack) : 'unknown';
    }
    if (
      trust?.module === 'path'
      && (trust.name === 'join' || trust.name === 'resolve')
    ) {
      const provenances = expression.arguments
        .map(argument => expressionProvenance(argument, context, bindingStack));
      const textSegments = expression.arguments
        .map(argument => literalText(argument))
        .filter(value => value !== undefined);

      if (trust.name === 'resolve') {
        let rootIndex = -1;
        for (let index = 0; index < provenances.length; index += 1) {
          const staticValues = staticTextValues(expression.arguments[index], context);
          const protectedRelativeFragment = provenances[index].startsWith('live-')
            && staticValues.length > 0
            && staticValues.every(value =>
              value !== REPO_PATH_TOKEN
              && !value.startsWith(`${REPO_PATH_TOKEN}/`)
              && !value.startsWith('/')
              && !/^[A-Za-z]:[\\/]/.test(value));
          if (
            provenances[index] === 'repo'
            || provenances[index] === 'repo-scratch'
            || provenances[index] === 'temp'
            || (provenances[index].startsWith('live-') && !protectedRelativeFragment)
          ) {
            rootIndex = index;
          }
        }
        const boundary = pathBoundaryFromArguments(
          expression.arguments,
          rootIndex >= 0 ? rootIndex + 1 : 0,
          context,
        );
        const root = rootIndex >= 0 ? provenances[rootIndex] : 'unknown';
        const uncertainAfterRoot = provenances.some((value, index) =>
          index > rootIndex && (value === 'unknown' || value === 'deferred'));
        if (root.startsWith('live-')) return root;
        if (uncertainAfterRoot) return 'unknown';
        if (root === 'repo-scratch') return 'repo-scratch';
        if (root === 'repo') return boundary ?? 'repo';
        const escapesRoot = expression.arguments
          .slice(rootIndex + 1)
          .some(argument => staticTextValues(argument, context).some(value =>
            value.replaceAll('\\', '/').split('/').includes('..')));
        if (root === 'temp' && escapesRoot) {
          const escapedBoundary = expression.arguments
            .slice(rootIndex + 1)
            .map(argument => expressionBoundary(argument, context))
            .find(value => value !== undefined);
          return escapedBoundary ?? 'unknown';
        }
        if (root === 'temp') return 'temp';
        if (boundary) return boundary;
        return 'unknown';
      }

      if (provenances.includes('temp')) {
        const tempIndex = provenances.indexOf('temp');
        const suffixIsRelative = expression.arguments
          .slice(tempIndex + 1)
          .every(argument => isDefinitelyRelativeFragment(argument, context));
        // path.join never resets on a later absolute segment, but an opaque or
        // traversal-capable suffix can still escape a nonce-owned subtree.
        return suffixIsRelative ? 'temp' : 'unknown';
      }
      if (provenances.includes('repo-scratch')) return 'repo-scratch';
      if (provenances.includes('repo')) {
        const repoIndex = provenances.indexOf('repo');
        const boundary = pathBoundaryFromArguments(
          expression.arguments,
          repoIndex + 1,
          context,
        );
        if (boundary) return boundary;
        if (
          textSegments.some(value => /^\.(?:test|tmp)(?:-|$)/.test(value))
          || /['"]\.(?:test|tmp)(?:-|['"])/.test(expression.getText())
        ) {
          return 'repo-scratch';
        }
        return 'repo';
      }
      if (provenances.includes('deferred')) return 'deferred';
      if (provenances.includes('unknown') && provenances.includes('temp')) return 'unknown';
      if (provenances.includes('unknown')) return 'unknown';
      const boundary = pathBoundaryFromArguments(expression.arguments, 0, context);
      // A boundary suffix on an unproven base is live-authority-risk, not a
      // generic unknown that can silently pass the H0 gate.
      if (boundary) return boundary;
      return 'unknown';
    }
    {
      let callable;
      let callableBinding;
      let callableExpression = expression.expression;
      while (ts.isParenthesizedExpression(callableExpression)) {
        callableExpression = callableExpression.expression;
      }
      if (ts.isArrowFunction(callableExpression) || ts.isFunctionExpression(callableExpression)) {
        callable = callableExpression;
      } else if (ts.isIdentifier(callableExpression)) {
        const binding = context.resolveBinding(callableExpression.text, callableExpression);
        callableBinding = binding;
        if (binding && !bindingStack.has(binding.id)) {
        if (ts.isFunctionDeclaration(binding.declaration.parent)) {
          callable = binding.declaration.parent;
        } else if (
          binding.initializer
          && (
            ts.isArrowFunction(binding.initializer)
            || ts.isFunctionExpression(binding.initializer)
          )
        ) {
          callable = binding.initializer;
        }
        }
      }
      if (callable?.body) {
          const overrides = new Map(context.provenanceOverrides ?? []);
          const relativeFragmentOverrides = new Set(
            context.relativeFragmentOverrides ?? [],
          );
          callable.parameters.forEach((parameter, index) => {
            if (!ts.isIdentifier(parameter.name)) return;
            const parameterBinding = context.resolveBinding(parameter.name.text, parameter.name);
            if (!parameterBinding) return;
            const argument = expression.arguments[index] ?? parameter.initializer;
            overrides.set(
              parameterBinding.id,
              argument
                ? expressionProvenance(argument, context, bindingStack)
                : 'deferred',
            );
            if (argument && isDefinitelyRelativeFragment(argument, context)) {
              relativeFragmentOverrides.add(parameterBinding.id);
            }
          });
          const nestedContext = {
            ...context,
            provenanceOverrides: overrides,
            relativeFragmentOverrides,
          };
          const nextStack = new Set(bindingStack);
          if (callableBinding) nextStack.add(callableBinding.id);
          const returns = [];
          if (!ts.isBlock(callable.body)) {
            returns.push(callable.body);
          } else {
            const collectReturns = node => {
              if (node !== callable && ts.isFunctionLike(node)) return;
              if (ts.isReturnStatement(node) && node.expression) {
                returns.push(node.expression);
                return;
              }
              node.forEachChild(collectReturns);
            };
            callable.body.forEachChild(collectReturns);
          }
          if (returns.length > 0) {
            const returned = mergeProvenances(returns.map(returnValue =>
              expressionProvenance(returnValue, nestedContext, nextStack)));
            return returned === 'unknown' ? 'deferred' : returned;
          }
      }
    }
    return expressionBoundary(expression, context) ?? 'unknown';
  }

  if (ts.isTemplateExpression(expression)) {
    const provenances = expression.templateSpans.map(span =>
      expressionProvenance(span.expression, context, bindingStack));
    const boundary = expressionBoundary(expression, context);
    const merged = mergeProvenances(provenances);
    if (merged.startsWith('live-') || merged === 'repo-scratch') return merged;
    if (merged === 'repo') return boundary ?? 'repo';
    if (merged === 'temp' && !expression.templateSpans.some(span =>
      expressionProvenance(span.expression, context, bindingStack) === 'unknown')) {
      return 'temp';
    }
    if (merged === 'deferred') return 'deferred';
    if (boundary) return boundary;
  }

  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = expressionProvenance(expression.left, context, bindingStack);
    const right = expressionProvenance(expression.right, context, bindingStack);
    const leftStaticBoundary = staticText(expression.left, context);
    const rightStaticBoundary = staticText(expression.right, context);
    const merged = mergeProvenances([
      leftStaticBoundary !== undefined && boundaryFromText(leftStaticBoundary) ? 'unknown' : left,
      rightStaticBoundary !== undefined && boundaryFromText(rightStaticBoundary) ? 'unknown' : right,
    ]);
    const boundary = expressionBoundary(expression, context);
    if (merged.startsWith('live-') || merged === 'repo-scratch') return merged;
    if (merged === 'repo') return boundary ?? 'repo';
    if (merged === 'temp' && left !== 'unknown' && right !== 'unknown') return 'temp';
    if (merged === 'deferred') return 'deferred';
    if (boundary) return boundary;
  }

  if (ts.isConditionalExpression(expression)) {
    return mergeProvenances([
      expressionProvenance(expression.whenTrue, context, bindingStack),
      expressionProvenance(expression.whenFalse, context, bindingStack),
    ]);
  }

  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    let receiver = expression.expression;
    while (
      ts.isParenthesizedExpression(receiver)
      || ts.isAsExpression(receiver)
      || ts.isNonNullExpression(receiver)
    ) {
      receiver = receiver.expression;
    }
    if (
      ts.isIdentifier(receiver)
      && context.resolveBinding(receiver.text, receiver)
    ) {
      if (staticPropertyName(expression) === 'path') {
        const receiverProvenance = expressionProvenance(receiver, context, bindingStack);
        if (
          receiverProvenance === 'temp'
          || receiverProvenance === 'repo'
          || receiverProvenance === 'repo-scratch'
          || receiverProvenance.startsWith('live-')
        ) {
          return receiverProvenance;
        }
      }
      return 'deferred';
    }
  }

  return expressionBoundary(expression, context) ?? 'unknown';
}

function projectCapabilityFromExpression(
  expression,
  useNode,
  context,
  bindingStack = new Set(),
) {
  if (
    ts.isParenthesizedExpression(expression)
    || ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression)
    || ts.isNonNullExpression(expression)
    || ts.isAwaitExpression(expression)
    || ts.isSatisfiesExpression(expression)
  ) {
    return projectCapabilityFromExpression(
      expression.expression,
      useNode,
      context,
      bindingStack,
    );
  }
  if (ts.isIdentifier(expression)) {
    const binding = context.resolveBinding(expression.text, expression);
    if (!binding || bindingStack.has(binding.id)) return 'unknown';
    const nextStack = new Set(bindingStack);
    nextStack.add(binding.id);
    const values = bindingExpressionsAtUse(binding, useNode, context)
      .map(value => projectCapabilityFromExpression(value, useNode, context, nextStack));
    return mergeProvenances(values);
  }
  if (
    ts.isPropertyAccessExpression(expression)
    || ts.isElementAccessExpression(expression)
  ) {
    const values = staticPropertyNames(expression, context)
      .flatMap(property => projectedPropertyExpressions(
        expression.expression,
        property,
        undefined,
        context,
        bindingStack,
      ))
      .map(value => projectCapabilityFromExpression(
        value,
        useNode,
        context,
        bindingStack,
      ));
    return mergeProvenances(values);
  }
  if (ts.isConditionalExpression(expression)) {
    return mergeProvenances([
      projectCapabilityFromExpression(expression.whenTrue, useNode, context, bindingStack),
      projectCapabilityFromExpression(expression.whenFalse, useNode, context, bindingStack),
    ]);
  }
  if (ts.isCallExpression(expression) || ts.isNewExpression(expression)) {
    const values = [];
    for (const argument of expression.arguments ?? []) {
      const projectDirs = projectedPropertyExpressions(
        argument,
        'projectDir',
        undefined,
        context,
        bindingStack,
      );
      values.push(...projectDirs.map(projectDir =>
        expressionProvenance(projectDir, context, bindingStack)));
    }
    if (ts.isCallExpression(expression)) {
      let callable;
      const unwrappedCallee = unwrapExpression(expression.expression);
      if (ts.isArrowFunction(unwrappedCallee) || ts.isFunctionExpression(unwrappedCallee)) {
        callable = unwrappedCallee;
      } else if (ts.isIdentifier(unwrappedCallee)) {
        const binding = context.resolveBinding(unwrappedCallee.text, unwrappedCallee);
        if (binding && !bindingStack.has(binding.id)) {
          if (ts.isFunctionDeclaration(binding.declaration.parent)) {
            callable = binding.declaration.parent;
          } else if (
            binding.initializer
            && (
              ts.isArrowFunction(binding.initializer)
              || ts.isFunctionExpression(binding.initializer)
            )
          ) {
            callable = binding.initializer;
          }
        }
      }
      if (callable?.body) {
        const returns = [];
        if (!ts.isBlock(callable.body)) {
          returns.push(callable.body);
        } else {
          const collectReturns = node => {
            if (node !== callable && ts.isFunctionLike(node)) return;
            if (ts.isReturnStatement(node) && node.expression) {
              returns.push(node.expression);
              return;
            }
            node.forEachChild(collectReturns);
          };
          callable.body.forEachChild(collectReturns);
        }
        values.push(...returns.map(returnValue =>
          projectCapabilityFromExpression(
            returnValue,
            useNode,
            context,
            bindingStack,
          )));
      }
    }
    return mergeProvenances(values);
  }
  return 'unknown';
}

function projectCapabilityForReceiver(receiver, useNode, context) {
  return projectCapabilityFromExpression(receiver, useNode, context);
}

function registryClassification(provenance) {
  if (provenance.startsWith('live-')) return 'violation';
  if (
    provenance === 'repo'
    || provenance === 'repo-scratch'
  ) {
    return 'migration';
  }
  if (provenance === 'temp') return 'sandboxed';
  return 'unresolved';
}

function errorCodeForProvenance(provenance) {
  for (const policy of PROTECTED_ROOT_POLICY.values()) {
    if (policy.provenance === provenance) return policy.code;
  }
  return undefined;
}

function dedupeWriterRegistry(registry) {
  const groups = new Map();
  for (const entry of registry) {
    const key = `${entry.file}\0${entry.effect}\0${entry.callsite}`;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => {
    const contextual = group.filter(entry => entry.contextual);
    const authorities = contextual.length > 0 ? contextual : group;
    const targetProvenance = mergeProvenances(
      authorities.map(entry => entry.targetProvenance),
    );
    const baseClassification = registryClassification(targetProvenance);
    let classification = baseClassification;
    if (authorities.some(entry => entry.classification === 'violation')) {
      classification = 'violation';
    } else if (
      baseClassification === 'violation'
      && authorities.some(entry => entry.classification === 'guarded-denial')
    ) {
      classification = 'guarded-denial';
    }
    const { contextual: _contextual, ...representative } = authorities[0];
    return {
      ...representative,
      targetProvenance,
      classification,
    };
  }).sort((left, right) =>
    left.line - right.line
    || left.effect.localeCompare(right.effect)
    || left.callsite.localeCompare(right.callsite));
}

function unwrapExpression(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isAwaitExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function directThunkMutation(thunk, mutation) {
  if (ts.isBlock(thunk.body)) {
    if (thunk.body.statements.length !== 1) return false;
    const [statement] = thunk.body.statements;
    return ts.isExpressionStatement(statement)
      && unwrapExpression(statement.expression) === mutation;
  }
  return unwrapExpression(thunk.body) === mutation;
}

function isStablePrimitiveExpression(expression, context, bindingStack = new Set()) {
  const unwrapped = unwrapExpression(expression);
  if (
    ts.isStringLiteralLike(unwrapped)
    || ts.isNumericLiteral(unwrapped)
    || ts.isRegularExpressionLiteral(unwrapped)
    || unwrapped.kind === ts.SyntaxKind.TrueKeyword
    || unwrapped.kind === ts.SyntaxKind.FalseKeyword
    || unwrapped.kind === ts.SyntaxKind.NullKeyword
  ) {
    return true;
  }
  if (ts.isIdentifier(unwrapped)) {
    if (unwrapped.text === 'undefined' && !context.resolveBinding('undefined', unwrapped)) {
      return true;
    }
    const binding = context.resolveBinding(unwrapped.text, unwrapped);
    if (!binding || bindingStack.has(binding.id)) return false;
    const nextStack = new Set(bindingStack);
    nextStack.add(binding.id);
    const values = bindingExpressionsAtUse(binding, unwrapped, context);
    return values.length > 0
      && values.every(value => isStablePrimitiveExpression(value, context, nextStack));
  }
  if (ts.isTemplateExpression(unwrapped)) {
    return unwrapped.templateSpans.every(span =>
      isStablePrimitiveExpression(span.expression, context, bindingStack));
  }
  if (
    ts.isConditionalExpression(unwrapped)
    || (
      ts.isBinaryExpression(unwrapped)
      && (
        unwrapped.operatorToken.kind === ts.SyntaxKind.PlusToken
        || unwrapped.operatorToken.kind === ts.SyntaxKind.BarBarToken
        || unwrapped.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        || unwrapped.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      )
    )
  ) {
    const branches = ts.isConditionalExpression(unwrapped)
      ? [unwrapped.condition, unwrapped.whenTrue, unwrapped.whenFalse]
      : [unwrapped.left, unwrapped.right];
    return branches.every(branch =>
      isStablePrimitiveExpression(branch, context, bindingStack));
  }
  if (ts.isCallExpression(unwrapped)) {
    if (
      staticPropertyName(unwrapped.expression) === 'cwd'
      && ts.isPropertyAccessExpression(unwrapped.expression)
      && ts.isIdentifier(unwrapped.expression.expression)
      && unwrapped.expression.expression.text === 'process'
      && !context.resolveBinding('process', unwrapped.expression.expression)
    ) {
      return true;
    }
    const trusted = trustedFunction(unwrapped.expression, context);
    return (
      (trusted?.module === 'path' && ['join', 'resolve'].includes(trusted.name))
      || (trusted?.module === 'os' && trusted.name === 'tmpdir')
    )
      && unwrapped.arguments.every(argument =>
        isStablePrimitiveExpression(argument, context, bindingStack));
  }
  if (ts.isArrayLiteralExpression(unwrapped)) {
    return unwrapped.elements.every(element =>
      !ts.isSpreadElement(element)
      && isStablePrimitiveExpression(element, context, bindingStack));
  }
  if (ts.isObjectLiteralExpression(unwrapped)) {
    return unwrapped.properties.every(property =>
      ts.isPropertyAssignment(property)
      && !ts.isComputedPropertyName(property.name)
      && isStablePrimitiveExpression(property.initializer, context, bindingStack));
  }
  return false;
}

function isExpectedGuardDenial(node, provenance, context) {
  const expectedCode = errorCodeForProvenance(provenance);
  if (!expectedCode) return false;
  if (
    !ts.isCallExpression(node)
    || !node.arguments.every(argument =>
      isStablePrimitiveExpression(argument, context))
    || context.mockedModules.has('fs')
  ) {
    return false;
  }

  let cursor = node.parent;
  while (cursor && !ts.isFunctionLike(cursor)) cursor = cursor.parent;
  if (
    !cursor
    || (!ts.isArrowFunction(cursor) && !ts.isFunctionExpression(cursor))
    || !directThunkMutation(cursor, node)
  ) {
    return false;
  }

  const expectCall = cursor.parent;
  if (
    !ts.isCallExpression(expectCall)
    || expectCall.arguments[0] !== cursor
    || !ts.isIdentifier(expectCall.expression)
  ) {
    return false;
  }
  const expectBinding = context.resolveBinding(expectCall.expression.text, expectCall.expression);
  const trustedVitestExpect = expectBinding?.trust?.module === 'vitest'
    && expectBinding.trust.name === 'expect';
  if (!trustedVitestExpect) return false;

  const matcherAccess = expectCall.parent;
  if (
    !matcherAccess
    || (!ts.isPropertyAccessExpression(matcherAccess) && !ts.isElementAccessExpression(matcherAccess))
    || matcherAccess.expression !== expectCall
    || !['toThrow', 'toThrowError'].includes(staticPropertyName(matcherAccess) ?? '')
  ) {
    return false;
  }
  const matcherCall = matcherAccess.parent;
  if (!ts.isCallExpression(matcherCall) || matcherCall.expression !== matcherAccess) return false;
  const matcher = literalText(matcherCall.arguments[0]);
  return matcher !== undefined
    && new RegExp(`(?:^|[^A-Z_])${expectedCode}(?:[^A-Z_]|$)`).test(matcher);
}

function staticExpressionArray(expression, context, bindingStack = new Set()) {
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) {
    const binding = context.resolveBinding(unwrapped.text, unwrapped);
    if (!binding || bindingStack.has(binding.id)) return undefined;
    const values = bindingValuesAtUse(binding, unwrapped, context);
    if (values.length !== 1 || !values[0].expression) return undefined;
    const nextStack = new Set(bindingStack);
    nextStack.add(binding.id);
    return staticExpressionArray(values[0].expression, context, nextStack);
  }
  if (!ts.isArrayLiteralExpression(unwrapped)) return undefined;
  const values = [];
  for (const element of unwrapped.elements) {
    if (ts.isSpreadElement(element)) {
      const spread = staticExpressionArray(element.expression, context, bindingStack);
      if (!spread) return undefined;
      values.push(...spread);
    } else {
      values.push(element);
    }
  }
  return values;
}

function normalizedFunctionInvocation(node, context) {
  if (
    ts.isPropertyAccessExpression(node.expression)
    || ts.isElementAccessExpression(node.expression)
  ) {
    const wrapper = staticPropertyNames(node.expression, context);
    if (wrapper.length === 1 && (wrapper[0] === 'call' || wrapper[0] === 'apply')) {
      const trusted = trustedFunction(node.expression.expression, context);
      if (!trusted) return undefined;
      if (wrapper[0] === 'call') {
        return { trusted, arguments: [...node.arguments.slice(1)] };
      }
      const applied = node.arguments[1];
      const array = applied
        ? staticExpressionArray(applied, context)
        : undefined;
      if (!array) {
        return { trusted, arguments: [], unresolvedArguments: true };
      }
      return {
        trusted,
        arguments: array,
      };
    }
  }
  if (ts.isCallExpression(node.expression)) {
    const binder = node.expression;
    if (
      (ts.isPropertyAccessExpression(binder.expression)
        || ts.isElementAccessExpression(binder.expression))
      && staticPropertyNames(binder.expression, context).includes('bind')
    ) {
      const trusted = trustedFunction(binder.expression.expression, context);
      if (trusted) {
        return {
          trusted,
          arguments: [
            ...binder.arguments.slice(1),
            ...node.arguments,
          ],
        };
      }
    }
  }
  const trusted = trustedFunction(node.expression, context);
  return trusted ? { trusted, arguments: [...node.arguments] } : undefined;
}

/**
 * Build a deterministic mutation registry from AST call sites.
 *
 * @returns {Array<{
 *   file: string,
 *   line: number,
 *   effect: string,
 *   targetProvenance: Provenance,
 *   classification: 'violation'|'guarded-denial'|'migration'|'sandboxed'|'unresolved',
 *   callsite: string,
 * }>}
 */
export function deriveWriterRegistry(content, filePath, scanBudget) {
  content = canonicalSourceText(content);
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    sourceKind(filePath),
  );
  const context = createAnalysisContext(sourceFile, scanBudget);
  const registry = [];

  const add = (node, effect, targetProvenance, activeContext) => {
    const baseClassification = registryClassification(targetProvenance);
    registry.push({
      file: filePath,
      line: lineFor(sourceFile, node),
      effect,
      targetProvenance,
      classification:
        baseClassification === 'violation' && isExpectedGuardDenial(
          node,
          targetProvenance,
          activeContext,
        )
          ? 'guarded-denial'
          : baseClassification,
      callsite: createCallsiteHash(
        filePath,
        node.getText(sourceFile),
        node.getStart(sourceFile),
      ),
      contextual: Boolean(activeContext.contextual),
    });
  };

  const localCallable = (expression, activeContext) => {
    const unwrapped = unwrapExpression(expression);
    if (
      ts.isArrowFunction(unwrapped)
      || ts.isFunctionExpression(unwrapped)
      || ts.isMethodDeclaration(unwrapped)
    ) {
      return { callable: unwrapped, binding: undefined };
    }
    if (
      ts.isPropertyAccessExpression(unwrapped)
      || ts.isElementAccessExpression(unwrapped)
    ) {
      const candidates = staticPropertyNames(unwrapped, activeContext)
        .flatMap(property => projectedPropertyExpressions(
          unwrapped.expression,
          property,
          undefined,
          activeContext,
        ));
      for (const candidate of candidates) {
        const resolved = localCallable(candidate, activeContext);
        if (resolved) return resolved;
      }
      return undefined;
    }
    if (!ts.isIdentifier(unwrapped)) return undefined;
    const binding = activeContext.resolveBinding(unwrapped.text, unwrapped);
    if (!binding) return undefined;
    if (ts.isFunctionDeclaration(binding.declaration.parent)) {
      return { callable: binding.declaration.parent, binding };
    }
    if (
      binding.initializer
      && (
        ts.isArrowFunction(binding.initializer)
        || ts.isFunctionExpression(binding.initializer)
      )
    ) {
      return { callable: binding.initializer, binding };
    }
    return undefined;
  };

  const visit = (node, activeContext = context, callStack = new Set()) => {
    scanBudget?.check('writer-analysis');
    if (ts.isCallExpression(node)) {
      const invocation = normalizedFunctionInvocation(node, activeContext);
      const trusted = invocation?.trusted;
      const name = (
        trusted?.module === 'fs'
        || trusted?.module === 'unknown-builtin'
      )
        ? trusted.name
        : undefined;
      const targetIndexes = name ? WRITE_SINKS.get(name) : undefined;
      if (targetIndexes) {
        const flags = (name === 'open' || name === 'openSync')
          ? literalText(invocation.arguments[1])
          : undefined;
        if ((name === 'open' || name === 'openSync') && flags && !/[wax+]/.test(flags)) {
          node.forEachChild(visit);
          return;
        }
        for (const targetIndex of targetIndexes) {
          const target = invocation.arguments[targetIndex];
          if (target && trusted.module === 'unknown-builtin') {
            add(
              node,
              `unknown-builtin.${name}`,
              'unknown',
              activeContext,
            );
          } else if (target) {
            add(
              node,
              `fs.${name}`,
              expressionProvenance(target, activeContext),
              activeContext,
            );
          } else if (invocation.unresolvedArguments) {
            add(
              node,
              `fs.${name}`,
              'unknown',
              activeContext,
            );
          }
        }
      }

      const methodNames = (
        ts.isPropertyAccessExpression(node.expression)
        || ts.isElementAccessExpression(node.expression)
      )
        ? staticPropertyNames(node.expression, activeContext)
        : [];
      if (
        methodNames.length === 1
        && SPAWN_METHODS.has(methodNames[0])
        && (
          ts.isPropertyAccessExpression(node.expression)
          || ts.isElementAccessExpression(node.expression)
        )
      ) {
        const receiver = receiverName(node.expression)
          ?? node.expression.expression.getText(sourceFile);
        const capability = projectCapabilityForReceiver(
          node.expression.expression,
          node,
          activeContext,
        );
        if (capability !== 'unknown') {
          add(
            node,
            `${receiver}.${methodNames[0]}:project-capability`,
            capability === 'repo' ? 'live-tasks' : capability,
            activeContext,
          );
        }
      }

      const resolvedCallable = localCallable(node.expression, activeContext);
      const callableKey = resolvedCallable?.binding?.id
        ?? resolvedCallable?.callable.getStart(sourceFile);
      if (
        resolvedCallable?.callable.body
        && !callStack.has(callableKey)
      ) {
        const overrides = new Map(activeContext.provenanceOverrides ?? []);
        const relativeFragmentOverrides = new Set(
          activeContext.relativeFragmentOverrides ?? [],
        );
        resolvedCallable.callable.parameters.forEach((parameter, index) => {
          const argument = node.arguments[index] ?? parameter.initializer;
          const applyPatternOverride = (pattern, values) => {
            if (ts.isIdentifier(pattern)) {
              const parameterBinding = activeContext.resolveBinding(
                pattern.text,
                pattern,
              );
              if (!parameterBinding) return;
              overrides.set(
                parameterBinding.id,
                values.length > 0
                  ? mergeProvenances(values.map(value =>
                    expressionProvenance(value, activeContext)))
                  : 'deferred',
              );
              if (
                values.length > 0
                && values.every(value =>
                  isDefinitelyRelativeFragment(value, activeContext))
              ) {
                relativeFragmentOverrides.add(parameterBinding.id);
              }
              return;
            }
            pattern.elements.forEach((element, elementIndex) => {
              if (ts.isOmittedExpression(element)) return;
              const propertyName = ts.isObjectBindingPattern(pattern)
                ? (
                  element.propertyName
                    ? propertyNameText(element.propertyName)
                    : ts.isIdentifier(element.name) ? element.name.text : undefined
                )
                : undefined;
              const projected = values.flatMap(value => projectedPropertyExpressions(
                value,
                propertyName,
                propertyName === undefined ? elementIndex : undefined,
                activeContext,
              ));
              applyPatternOverride(
                element.name,
                projected.length > 0
                  ? projected
                  : element.initializer ? [element.initializer] : [],
              );
            });
          };
          applyPatternOverride(parameter.name, argument ? [argument] : []);
        });
        const nestedContext = {
          ...activeContext,
          provenanceOverrides: overrides,
          relativeFragmentOverrides,
          contextual: true,
        };
        const nextCallStack = new Set(callStack);
        nextCallStack.add(callableKey);
        visit(resolvedCallable.callable.body, nestedContext, nextCallStack);
      }
    }

    if (ts.isNewExpression(node)) {
      const trusted = trustedFunction(node.expression, activeContext);
      if (trusted?.module === 'fs' && trusted.name === 'WriteStream') {
        const target = node.arguments?.[0];
        if (target) {
          add(
            node,
            'new fs.WriteStream',
            expressionProvenance(target, activeContext),
            activeContext,
          );
        }
      }
      const name = calleeName(node.expression);
      if (name && /(?:Database|MemoryStore|Sqlite)/i.test(name)) {
        const target = node.arguments?.[0];
        if (target) {
          add(
            node,
            `new ${name}`,
            expressionProvenance(target, activeContext),
            activeContext,
          );
        }
      }
    }
    node.forEachChild(child => visit(child, activeContext, callStack));
  };
  sourceFile.forEachChild(visit);

  return dedupeWriterRegistry(registry);
}

function deterministicDigest(input) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function policyDigest(input) {
  return createHash('sha256').update(input).digest('hex');
}

function canonicalProductionInventoryContent(filePath, content) {
  content = canonicalSourceText(content);
  if (
    !normalizeRelative(filePath)
      .endsWith('/scripts/lint-test-hermeticity.mjs')
  ) {
    return content;
  }
  let canonical = content;
  for (const name of [
    'UNRESOLVED_BASELINE',
    'PRODUCTION_INVENTORY_BASELINE',
  ]) {
    const declaration = new RegExp(
      `(export const ${name} = Object\\.freeze\\(\\{)[\\s\\S]*?(\\}\\);)`,
    );
    canonical = canonical.replace(
      declaration,
      `$1\n  count: 0,\n`
        + `  digest: '${'0'.repeat(64)}',\n$2`,
    );
  }
  return canonical;
}

function createCallsiteHash(filePath, source, position) {
  return policyDigest(
    `${filePath}\0${position}\0${source.replaceAll(/\s+/g, ' ').trim()}`,
  );
}

export function unresolvedRegistryFingerprint(registry) {
  const identities = registry
    .filter(entry => entry.classification === 'unresolved')
    .map(entry => JSON.stringify([
      entry.file,
      entry.effect,
      entry.targetProvenance,
      entry.callsite,
    ]))
    .sort();
  return {
    count: identities.length,
    digest: policyDigest(identities.join('\n')),
  };
}

export function productionInventoryFingerprint(registry) {
  const modules = new Map();
  for (const entry of registry) {
    if (
      entry.classification !== 'inventory'
      || entry.effect !== 'test-support:production-dependency'
    ) {
      continue;
    }
    const current = modules.get(entry.file) ?? {
      contentDigest: entry.contentDigest,
      outgoing: new Set(),
    };
    for (const edge of entry.outgoing ?? []) current.outgoing.add(edge);
    modules.set(entry.file, current);
  }
  const identities = [...modules.entries()]
    .map(([file, value]) => JSON.stringify([
      file,
      value.contentDigest,
      [...value.outgoing].sort(),
    ]))
    .sort();
  return {
    count: identities.length,
    digest: policyDigest(identities.join('\n')),
  };
}

export function evaluateProductionInventoryPolicy(
  registry,
  {
    baseline = PRODUCTION_INVENTORY_BASELINE,
  } = {},
) {
  const fingerprint = productionInventoryFingerprint(registry);
  if (
    fingerprint.count !== baseline.count
    || fingerprint.digest !== baseline.digest
  ) {
    return {
      blocking: true,
      reason: 'production inventory drift',
      fingerprint,
    };
  }
  return { blocking: false, reason: undefined, fingerprint };
}

export function evaluateUnresolvedPolicy(
  registry,
  {
    strictUnresolved = false,
    baseline = UNRESOLVED_BASELINE,
  } = {},
) {
  const fingerprint = unresolvedRegistryFingerprint(registry);
  if (strictUnresolved && fingerprint.count > 0) {
    return { blocking: true, reason: 'strict unresolved policy', fingerprint };
  }
  if (
    fingerprint.count !== baseline.count
    || fingerprint.digest !== baseline.digest
  ) {
    return { blocking: true, reason: 'unresolved registry drift', fingerprint };
  }
  return { blocking: false, reason: undefined, fingerprint };
}

function liveStateReadLabel(expression, context) {
  for (const value of staticTextValues(expression, context)) {
    let normalized = normalizedCommandPath(value);
    if (normalized === REPO_PATH_TOKEN) normalized = '';
    else if (normalized.startsWith(`${REPO_PATH_TOKEN}/`)) {
      normalized = normalized.slice(REPO_PATH_TOKEN.length + 1);
    } else if (normalized.startsWith('/')) {
      const normalizedRepo = normalizedCommandPath(REPO_ROOT);
      if (!normalized.startsWith(`${normalizedRepo}/`)) continue;
      normalized = normalized.slice(normalizedRepo.length + 1);
    }
    const segments = normalized.split('/').filter(Boolean);
    const root = portablePathSegmentKey(segments[0] ?? '');
    const stateFile = portablePathSegmentKey(segments[1] ?? '');
    if (root === '.deckent' && stateFile === 'config.json') {
      return '.deckent/config.json live read';
    }
    if (root === '.brain' && stateFile === 'memory.db') {
      return '.brain/memory.db live read';
    }
  }
  return undefined;
}

function legacyReadViolations(content, filePath, scanBudget) {
  content = canonicalSourceText(content);
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    sourceKind(filePath),
  );
  const context = createAnalysisContext(sourceFile, scanBudget);
  const violations = [];
  const literalRanges = [];
  const collectLiteralRanges = node => {
    scanBudget?.check('legacy-read-literals');
    if (
      ts.isStringLiteralLike(node)
      || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateExpression(node)
    ) {
      literalRanges.push([node.getStart(sourceFile), node.getEnd()]);
    }
    node.forEachChild(collectLiteralRanges);
  };
  sourceFile.forEachChild(collectLiteralRanges);
  const visit = node => {
    scanBudget?.check('legacy-read-analysis');
    if (ts.isCallExpression(node)) {
      const trusted = trustedFunction(node.expression, context);
      if (trusted?.module === 'fs' && trusted.name && LEGACY_READ_SINKS.has(trusted.name)) {
        if (
          (trusted.name === 'open' || trusted.name === 'openSync')
          && node.arguments[1]
          && /[wax+]/.test(literalText(node.arguments[1]) ?? '')
        ) {
          node.forEachChild(visit);
          return;
        }
        const target = node.arguments[0];
        const label = target ? liveStateReadLabel(target, context) : undefined;
        if (label) {
          violations.push({
            file: filePath,
            line: lineFor(sourceFile, node),
            match: node.getText(sourceFile),
            label,
            code: 'E_HERMETIC_LIVE_STATE_READ',
            callsite: createCallsiteHash(
              filePath,
              node.getText(sourceFile),
              node.getStart(sourceFile),
            ),
          });
        }
      }
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);

  const lines = content.split('\n');
  let lineOffset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const currentLineOffset = lineOffset;
    lineOffset += rawLine.length + 1;
    const trimmed = rawLine.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    for (const { re, label } of HERMETIC_PATTERNS) {
      const match = rawLine.match(re);
      if (!match || match.index === undefined) continue;
      const absoluteMatch = currentLineOffset + match.index;
      if (literalRanges.some(([start, end]) =>
        absoluteMatch >= start && absoluteMatch < end)) {
        continue;
      }
      if (label.startsWith('process.cwd()')) {
        const cwdIndex = rawLine.indexOf('process.cwd()');
        const protectedName = label.includes('.deckent') ? '.deckent' : '.brain';
        const protectedIndex = rawLine.indexOf(protectedName, cwdIndex);
        const relevantSlice = rawLine.slice(cwdIndex, protectedIndex);
        if (/tmpdir\s*\(\)|mkdtemp(?:Disposable)?Sync?\s*\(/.test(relevantSlice)) {
          continue;
        }
      }
      violations.push({
        file: filePath,
        line: index + 1,
        match: rawLine.trim(),
        label,
        code: 'E_HERMETIC_LIVE_STATE_READ',
        callsite: createCallsiteHash(
          filePath,
          rawLine.trim(),
          absoluteMatch,
        ),
      });
    }
  }
  const seen = new Set();
  return violations.filter(violation => {
    const key = [
      violation.file,
      violation.line,
      violation.code,
    ].join(':');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function writerViolations(entries) {
  const violations = [];
  for (const entry of entries) {
    if (
      entry.classification !== 'violation'
      && entry.classification !== 'guarded-denial'
    ) {
      continue;
    }
    violations.push({
      file: entry.file,
      line: entry.line,
      match: entry.effect,
      label: `${entry.effect} targets ${entry.targetProvenance}`,
      code: errorCodeForProvenance(entry.targetProvenance),
    });
  }
  return violations;
}

export function checkFile(content, filePath, options = {}) {
  // Legacy callers may still pass skipLegacyReads, but whole-file suppression
  // is not an authority boundary and can never waive a newly added live read.
  const scanBudget = options.scanBudget;
  return [
    ...legacyReadViolations(content, filePath, scanBudget),
    ...writerViolations(deriveWriterRegistry(content, filePath, scanBudget)),
  ];
}

function tokenizeShellCommands(command) {
  command = command.replaceAll(/\\\r?\n/g, '');
  const commands = [];
  let tokens = [];
  let token = '';
  let quote;
  let escaping = false;

  const finishToken = () => {
    if (token.length > 0) tokens.push(token);
    token = '';
  };
  const finishCommand = () => {
    finishToken();
    if (tokens.length > 0) commands.push(tokens);
    tokens = [];
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (escaping) {
      token += character;
      escaping = false;
      continue;
    }
    if (character === '\\' && quote !== "'") {
      const next = command[index + 1];
      if (next === '\n') {
        index += 1;
        continue;
      }
      if (next === '\r' && command[index + 2] === '\n') {
        index += 2;
        continue;
      }
      if (
        quote === '"'
        && next !== undefined
        && !['$', '`', '"', '\\'].includes(next)
      ) {
        // Preserve Windows separators inside quoted executable paths.
        token += character;
        continue;
      }
      escaping = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      else token += character;
      continue;
    }
    if (
      character === '$'
      && (command[index + 1] === "'" || command[index + 1] === '"')
    ) {
      // ANSI-C and locale quotes are still one static shell token for the
      // hermeticity tracer; expansion semantics do not hide the command.
      quote = command[index + 1];
      index += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === '#') {
      if (token.length > 0) {
        token += character;
      } else {
        finishCommand();
        while (index + 1 < command.length && command[index + 1] !== '\n') index += 1;
      }
      continue;
    }
    if (
      character === '\n'
      || character === ';'
      || character === '|'
      || character === '&'
      || character === '('
      || character === ')'
      || character === '{'
      || character === '}'
      || character === '>'
      || character === '<'
    ) {
      finishCommand();
      continue;
    }
    if (/\s/.test(character)) {
      finishToken();
      continue;
    }
    token += character;
  }
  if (escaping) token += '\\';
  finishCommand();
  return commands;
}

function extractCommandSubstitutions(command) {
  const substitutions = [];
  let quote;
  let escaping = false;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (escaping) {
      escaping = false;
      continue;
    }
    if (character === '\\' && quote !== "'") {
      escaping = true;
      continue;
    }
    if (character === "'" && quote !== '"') {
      quote = quote === "'" ? undefined : "'";
      continue;
    }
    if (character === '"' && quote !== "'") {
      quote = quote === '"' ? undefined : '"';
      continue;
    }
    if (quote === "'") continue;

    if (character === '`') {
      let cursor = index + 1;
      let nestedEscaping = false;
      for (; cursor < command.length; cursor += 1) {
        if (nestedEscaping) {
          nestedEscaping = false;
          continue;
        }
        if (command[cursor] === '\\') {
          nestedEscaping = true;
          continue;
        }
        if (command[cursor] === '`') break;
      }
      if (cursor < command.length) {
        substitutions.push(command.slice(index + 1, cursor));
        index = cursor;
      }
      continue;
    }

    if (character === '$' && command[index + 1] === '(') {
      let depth = 1;
      let nestedQuote;
      let nestedEscaping = false;
      const start = index + 2;
      let cursor = start;
      for (; cursor < command.length; cursor += 1) {
        const nested = command[cursor];
        if (nestedEscaping) {
          nestedEscaping = false;
          continue;
        }
        if (nested === '\\' && nestedQuote !== "'") {
          nestedEscaping = true;
          continue;
        }
        if (nested === "'" && nestedQuote !== '"') {
          nestedQuote = nestedQuote === "'" ? undefined : "'";
          continue;
        }
        if (nested === '"' && nestedQuote !== "'") {
          nestedQuote = nestedQuote === '"' ? undefined : '"';
          continue;
        }
        if (nestedQuote) continue;
        if (nested === '(') depth += 1;
        else if (nested === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      if (depth === 0) {
        substitutions.push(command.slice(start, cursor));
        index = cursor;
      }
    }
  }
  return substitutions;
}

function executableKind(value) {
  const normalized = value.replaceAll('\\', '/').split('/').at(-1)?.toLowerCase() ?? '';
  if (normalized === 'npm' || normalized === 'npm.cmd' || normalized === 'npm.exe') return 'npm';
  if (normalized === 'npx' || normalized === 'npx.cmd' || normalized === 'npx.exe') return 'npx';
  if (normalized === 'pnpm' || normalized === 'pnpm.cmd' || normalized === 'pnpm.exe') {
    return 'pnpm';
  }
  if (normalized === 'yarn' || normalized === 'yarn.cmd' || normalized === 'yarn.exe') {
    return 'yarn';
  }
  if (normalized === 'bun' || normalized === 'bun.exe') return 'bun';
  if (normalized === 'node' || normalized === 'node.exe') return 'node';
  if (normalized === 'rm' || normalized === 'rm.exe') return 'rm';
  if (normalized === 'rimraf' || normalized === 'rimraf.cmd') return 'rimraf';
  if (normalized === 'rmdir' || normalized === 'rmdir.exe' || normalized === 'rd') {
    return 'rmdir';
  }
  if (['sh', 'bash', 'zsh', 'dash'].includes(normalized)) return 'posix-shell';
  if (normalized === 'cmd' || normalized === 'cmd.exe') return 'cmd-shell';
  if (['powershell', 'powershell.exe', 'pwsh', 'pwsh.exe'].includes(normalized)) {
    return 'powershell';
  }
  if (['corepack', 'command', 'nohup', 'time'].includes(normalized)) return normalized;
  return normalized;
}

function normalizedCommandPath(value) {
  return canonicalPathText(value);
}

function unwrapCommandPrefix(argv) {
  let index = 0;
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[index] ?? '')) index += 1;
  const kind = executableKind(argv[index] ?? '');
  if (kind === 'env') {
    index += 1;
    while (index < argv.length) {
      const value = argv[index];
      if (value === '--') {
        index += 1;
        break;
      }
      if (value === '-u' || value === '--unset' || value === '-C' || value === '--chdir') {
        index += 2;
        continue;
      }
      if (
        value.startsWith('--unset=')
        || value.startsWith('--chdir=')
        || value === '-i'
        || value === '--ignore-environment'
        || value === '-0'
        || value === '--null'
        || value.startsWith('-S')
        || value.startsWith('--split-string=')
        || /^[A-Za-z_][A-Za-z0-9_]*=/.test(value)
      ) {
        index += 1;
        continue;
      }
      break;
    }
  } else if (kind === 'cross-env') {
    index += 1;
    while (
      index < argv.length
      && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[index])
    ) {
      index += 1;
    }
  }
  return argv.slice(index);
}

function tracePackageScript(
  scriptName,
  packageScripts,
  visited,
  manager,
  packageContext,
) {
  if (!scriptName || visited.has(scriptName)) return [];
  const lifecycleNames = [`pre${scriptName}`, scriptName, `post${scriptName}`]
    .filter(name => typeof packageScripts[name] === 'string');
  if (lifecycleNames.length === 0) {
    return [{
      effect: 'unresolved-package-script',
      chain: [`${manager}:${scriptName}`],
    }];
  }
  const effects = [];
  for (const lifecycleName of lifecycleNames) {
    if (lifecycleName !== scriptName && visited.has(lifecycleName)) continue;
    const nextVisited = new Set(visited);
    nextVisited.add(scriptName);
    nextVisited.add(lifecycleName);
    for (const nested of traceCommandEffects(
      packageScripts[lifecycleName],
      packageScripts,
      nextVisited,
      packageContext,
    )) {
      effects.push({
        effect: nested.effect,
        chain: [
          `${manager}:${scriptName}`,
          ...(lifecycleName === scriptName ? [] : [`${manager}:${lifecycleName}`]),
          ...nested.chain,
        ],
      });
    }
  }
  return effects;
}

function nodeScriptArgument(args) {
  const optionsWithValue = new Set([
    '-C',
    '--conditions',
    '--cpu-prof-dir',
    '--diagnostic-dir',
    '--env-file',
    '--env-file-if-exists',
    '--experimental-default-config-file',
    '--experimental-loader',
    '--import',
    '--input-type',
    '--loader',
    '--openssl-config',
    '-r',
    '--require',
    '--title',
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') return args[index + 1];
    if (argument === '-e' || argument === '--eval' || argument === '-p' || argument === '--print') {
      return undefined;
    }
    if (optionsWithValue.has(argument)) {
      index += 1;
      continue;
    }
    if (
      argument.startsWith('--') && argument.includes('=')
      || /^-[rC].+/.test(argument)
    ) {
      continue;
    }
    if (argument.startsWith('-')) continue;
    return argument;
  }
  return undefined;
}

function nodeEvalArgument(args) {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '-e' || argument === '--eval') return args[index + 1];
    if (argument.startsWith('--eval=')) return argument.slice('--eval='.length);
    if (/^-e.+/.test(argument)) return argument.slice(2);
  }
  return undefined;
}

const PACKAGE_OPTIONS_WITH_VALUE = new Set([
  '-C',
  '-w',
  '--cache',
  '--config',
  '--cwd',
  '--dir',
  '--filter',
  '--prefix',
  '--registry',
  '--userconfig',
  '--workspace',
]);

function packagePositionals(args) {
  const positionals = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') {
      positionals.push(...args.slice(index + 1));
      break;
    }
    if (PACKAGE_OPTIONS_WITH_VALUE.has(argument)) {
      index += 1;
      continue;
    }
    if (argument.startsWith('-')) continue;
    positionals.push(argument);
  }
  return positionals;
}

const PACKAGE_SELECTION_CACHE = new Map();

function readPackageManifest(manifestPath) {
  if (!existsSync(manifestPath)) {
    return { status: 'absent', manifest: {} };
  }
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { status: 'malformed', manifest: {} };
    }
    return { status: 'valid', manifest: parsed };
  } catch {
    // File races, access failures, and invalid JSON all have the same static
    // analysis outcome: the manifest exists but cannot safely be interpreted.
    return { status: 'malformed', manifest: {} };
  }
}

function packageOptionValues(args, names) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (names.includes(argument) && args[index + 1]) {
      values.push(args[index + 1]);
      index += 1;
      continue;
    }
    for (const name of names.filter(value => value.startsWith('--'))) {
      if (argument.startsWith(`${name}=`)) values.push(argument.slice(name.length + 1));
    }
  }
  return values;
}

function readPackageScripts(packageDir, realRoot) {
  const manifestPath = join(packageDir, 'package.json');
  if (
    !existsSync(manifestPath)
    || !statSync(manifestPath).isFile()
    || !isWithinRealRoot(manifestPath, realRoot)
  ) {
    return undefined;
  }
  const outcome = readPackageManifest(manifestPath);
  if (outcome.status === 'absent') return undefined;
  const { manifest } = outcome;
  return {
    status: outcome.status,
    dir: realpathSync(packageDir),
    name: typeof manifest.name === 'string' ? manifest.name : undefined,
    scripts: manifest.scripts && typeof manifest.scripts === 'object'
      ? manifest.scripts
      : {},
  };
}

function findWorkspacePackage(rootDir, selector) {
  const realRoot = realpathSync(rootDir);
  const cacheKey = `${realRoot}\0${selector}`;
  if (PACKAGE_SELECTION_CACHE.has(cacheKey)) {
    return PACKAGE_SELECTION_CACHE.get(cacheKey);
  }
  const direct = readPackageScripts(resolve(rootDir, selector), realRoot);
  if (direct) {
    PACKAGE_SELECTION_CACHE.set(cacheKey, direct);
    return direct;
  }
  const queue = [realRoot];
  let visitedDirs = 0;
  while (queue.length > 0 && visitedDirs < 2000) {
    const directory = queue.shift();
    visitedDirs += 1;
    for (const entry of readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      if (
        !entry.isDirectory()
        || ['.git', '.brain', '.tasks', 'dist', 'node_modules'].includes(entry.name)
      ) {
        continue;
      }
      const child = join(directory, entry.name);
      const candidate = readPackageScripts(child, realRoot);
      if (
        candidate
        && (
          candidate.name === selector
          || normalizeRelative(relative(realRoot, candidate.dir)) === selector
        )
      ) {
        PACKAGE_SELECTION_CACHE.set(cacheKey, candidate);
        return candidate;
      }
      queue.push(child);
    }
  }
  PACKAGE_SELECTION_CACHE.set(cacheKey, undefined);
  return undefined;
}

function selectedPackageScripts(args, packageScripts, packageContext) {
  if (!packageContext?.rootDir) return { scripts: packageScripts };
  const prefixes = packageOptionValues(args, ['--prefix', '-C']);
  const workspaces = packageOptionValues(args, ['--workspace', '-w']);
  if (prefixes.length + workspaces.length === 0) return { scripts: packageScripts };
  if (prefixes.length + workspaces.length !== 1) return { unresolved: true };
  const realRoot = realpathSync(packageContext.rootDir);
  if (prefixes.length === 1) {
    const selected = readPackageScripts(
      resolve(packageContext.rootDir, prefixes[0]),
      realRoot,
    );
    return selected?.status === 'valid'
      ? { scripts: selected.scripts }
      : { unresolved: true };
  }
  const selected = findWorkspacePackage(packageContext.rootDir, workspaces[0]);
  return selected?.status === 'valid'
    ? { scripts: selected.scripts }
    : { unresolved: true };
}

function traceArgvEffects(
  argv,
  packageScripts,
  visited = new Set(),
  packageContext,
) {
  let wrapperIndex = 0;
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[wrapperIndex] ?? '')) wrapperIndex += 1;
  if (executableKind(argv[wrapperIndex] ?? '') === 'cross-env-shell') {
    wrapperIndex += 1;
    while (
      wrapperIndex < argv.length
      && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[wrapperIndex])
    ) {
      wrapperIndex += 1;
    }
    return traceCommandEffects(
      argv.slice(wrapperIndex).join(' '),
      packageScripts,
      visited,
      packageContext,
    );
  }

  const command = unwrapCommandPrefix(argv);
  if (command.length === 0) return [];
  const kind = executableKind(command[0]);
  const args = command.slice(1);
  const effects = [];

  if (kind === 'corepack') {
    return traceArgvEffects(args, packageScripts, visited, packageContext);
  }
  if (kind === 'npx') {
    const nestedIndex = args.findIndex(argument => !argument.startsWith('-'));
    return nestedIndex >= 0
      ? traceArgvEffects(args.slice(nestedIndex), packageScripts, visited, packageContext)
      : [];
  }
  if (kind === 'command' || kind === 'nohup' || kind === 'time') {
    const nested = args.slice(args.findIndex(argument => !argument.startsWith('-')));
    return nested.length > 0
      ? traceArgvEffects(nested, packageScripts, visited, packageContext)
      : [];
  }
  if (kind === 'then' || kind === 'do') {
    return traceArgvEffects(args, packageScripts, visited, packageContext);
  }
  if (kind === 'eval') {
    return traceCommandEffects(args.join(' '), packageScripts, visited, packageContext);
  }

  if (kind === 'node') {
    const evaluated = nodeEvalArgument(args);
    if (evaluated !== undefined) {
      const embeddedRegistry = deriveWriterRegistry(evaluated, '<node-eval>');
      for (const entry of embeddedRegistry.filter(entry =>
        entry.targetProvenance.startsWith('live-'))) {
        effects.push(entry.targetProvenance === 'live-dist'
          ? { effect: 'dist-delete', chain: ['node:eval', 'fs:dist-mutation'] }
          : {
            effect: 'protected-mutation',
            boundary: entry.targetProvenance,
            chain: ['node:eval', `fs:${entry.targetProvenance}`],
          });
      }
      if (embeddedRegistry.length === 0) {
        effects.push({
          effect: 'unresolved-child-effect',
          chain: ['node:eval'],
        });
      }
    }
    const script = nodeScriptArgument(args);
    const normalizedScript = script ? normalizedCommandPath(script) : undefined;
    if (
      normalizedScript === 'scripts/clean.mjs'
      || normalizedScript?.endsWith('/scripts/clean.mjs')
    ) {
      effects.push({ effect: 'dist-clean', chain: ['scripts/clean.mjs'] });
    } else if (script) {
      effects.push({
        effect: 'unresolved-child-effect',
        chain: [`node:${normalizedScript ?? script}`],
      });
    }
  } else if (kind === 'npm' || kind === 'pnpm' || kind === 'yarn' || kind === 'bun') {
    const selectedPackage = selectedPackageScripts(args, packageScripts, packageContext);
    if (selectedPackage.unresolved) {
      return [{
        effect: 'unresolved-package-script',
        chain: [`${kind}:package-selection`],
      }];
    }
    const effectivePackageScripts = selectedPackage.scripts;
    const positionals = packagePositionals(args);
    const runIndex = positionals.findIndex(argument =>
      argument === 'run' || argument === 'run-script');
    let scriptName = runIndex >= 0
      ? positionals
        .slice(runIndex + 1)
        .at(0)
      : undefined;
    if (!scriptName) {
      const direct = positionals[0];
      if (
        direct === 'pack'
        && args.includes('--dry-run')
        && args.includes('--ignore-scripts')
      ) {
        return effects;
      }
      if (
        kind === 'yarn'
        || [
          'ci',
          'install',
          'pack',
          'publish',
          'restart',
          'start',
          'stop',
          'test',
          'uninstall',
          'update',
          'version',
        ].includes(direct ?? '')
      ) {
        scriptName = direct === 'ci' ? 'install' : direct;
      }
    }
    if (scriptName === 'restart' && typeof effectivePackageScripts.restart !== 'string') {
      effects.push(...tracePackageScript(
        'stop',
        effectivePackageScripts,
        visited,
        kind,
        packageContext,
      ));
      effects.push(...tracePackageScript(
        'start',
        effectivePackageScripts,
        visited,
        kind,
        packageContext,
      ));
    } else {
      effects.push(...tracePackageScript(
        scriptName,
        effectivePackageScripts,
        visited,
        kind,
        packageContext,
      ));
    }
  } else if (kind === 'rm' || kind === 'rmdir' || kind === 'rimraf') {
    for (const argument of args.filter(value => !value.startsWith('-'))) {
      const boundary = boundaryFromText(normalizedCommandPath(argument));
      if (boundary === 'live-dist') {
        effects.push({ effect: 'dist-delete', chain: ['shell:dist-delete'] });
      } else if (boundary?.startsWith('live-')) {
        effects.push({
          effect: 'protected-delete',
          boundary,
          chain: [`shell:${boundary}-delete`],
        });
      }
    }
  } else if (kind === 'posix-shell') {
    const commandIndex = args.findIndex(argument =>
      argument === '-c' || /^-[^-]*c[^-]*$/.test(argument));
    if (commandIndex >= 0 && args[commandIndex + 1]) {
      effects.push(...traceCommandEffects(
        args[commandIndex + 1],
        packageScripts,
        visited,
        packageContext,
      ));
    }
  } else if (kind === 'cmd-shell') {
    const commandIndex = args.findIndex(argument => /^\/c$/i.test(argument));
    if (commandIndex >= 0 && args[commandIndex + 1]) {
      const nested = args[commandIndex + 1].replaceAll(/\^(.)/g, '$1');
      effects.push(...traceCommandEffects(nested, packageScripts, visited, packageContext));
    }
  } else if (kind === 'powershell') {
    const commandIndex = args.findIndex(argument => /^-(?:command|c)$/i.test(argument));
    if (commandIndex >= 0 && args[commandIndex + 1]) {
      effects.push(...traceCommandEffects(
        args[commandIndex + 1],
        packageScripts,
        visited,
        packageContext,
      ));
    }
  } else if (kind === 'remove-item') {
    for (const argument of args.filter(value => !value.startsWith('-'))) {
      const boundary = boundaryFromText(normalizedCommandPath(argument));
      if (boundary === 'live-dist') {
        effects.push({ effect: 'dist-delete', chain: ['powershell:dist-delete'] });
      } else if (boundary?.startsWith('live-')) {
        effects.push({
          effect: 'protected-delete',
          boundary,
          chain: [`powershell:${boundary}-delete`],
        });
      }
    }
  }
  return effects;
}

/**
 * Trace npm aliases without executing a command. Cycles terminate deterministically.
 *
 * @param {string} command
 * @param {Record<string, string>} packageScripts
 * @param {Set<string>} [visited]
 * @returns {Array<{ effect: string, chain: string[] }>}
 */
export function traceCommandEffects(
  command,
  packageScripts,
  visited = new Set(),
  packageContext,
) {
  const effects = [];
  for (const substitution of extractCommandSubstitutions(command)) {
    effects.push(...traceCommandEffects(
      substitution,
      packageScripts,
      visited,
      packageContext,
    ));
  }
  const shellVariables = new Map();
  for (const argv of tokenizeShellCommands(command)) {
    if (
      argv.length > 0
      && argv.every(argument => /^[A-Za-z_][A-Za-z0-9_]*=[^$`]*$/.test(argument))
    ) {
      for (const assignment of argv) {
        const separator = assignment.indexOf('=');
        shellVariables.set(
          assignment.slice(0, separator),
          assignment.slice(separator + 1),
        );
      }
      continue;
    }
    const expanded = argv.map(argument => {
      const match = argument.match(/^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))$/);
      return match ? shellVariables.get(match[1] ?? match[2]) ?? argument : argument;
    });
    effects.push(...traceArgvEffects(expanded, packageScripts, visited, packageContext));
  }
  return effects;
}

const MAX_STATIC_VARIANTS = 16;
const REPO_PATH_TOKEN = '__DECKENT_REPO_ROOT__';

// T14 / SCOPE-REVISION-032: production host-proof adapters may intentionally
// keep their bounded child runner behind an injected function boundary.  Such
// a call is not statically reducible by the generic AST evaluator, so it is
// eligible only when BOTH the exact callsite and the complete audited adapter
// bytes match this code-owned seal.  Any source or callsite change returns to
// E_HERMETIC_CHILD_EFFECT_UNRESOLVED; this is not a path/name allowlist.
const SEALED_PRODUCTION_CHILD_ADAPTERS = Object.freeze({
  'scripts/production-wiring-host-proof-harness.mjs': Object.freeze({
    sourceSha256: '6e39b4acee05e0e33b7bf6d67544f600de9aa602fabbe5fd5dfdbe98e017dbc8',
    callsite: 'ca080eabb0dc14446beea458bb545f979dff09a2b6a9e14742f7c69b5821d236',
  }),
});

function isSealedProductionChildAdapter(content, filePath, callsite) {
  const seal = SEALED_PRODUCTION_CHILD_ADAPTERS[normalizeRelative(filePath)];
  return seal !== undefined
    && seal.callsite === callsite
    && createHash('sha256').update(content).digest('hex') === seal.sourceSha256;
}

function boundedUnique(values) {
  return [...new Set(values)].slice(0, MAX_STATIC_VARIANTS);
}

function crossStaticValues(left, right, combine) {
  const values = [];
  for (const leftValue of left) {
    for (const rightValue of right) {
      values.push(combine(leftValue, rightValue));
      if (values.length >= MAX_STATIC_VARIANTS) return boundedUnique(values);
    }
  }
  return boundedUnique(values);
}

function bindingStaticValues(binding, useNode, context, bindingStack) {
  if (bindingStack.has(binding.id)) return [];
  const nextStack = new Set(bindingStack);
  nextStack.add(binding.id);
  let values = binding.initializer
    ? staticTextValues(binding.initializer, context, nextStack)
    : [];
  const usePosition = useNode.getStart(context.sourceFile);
  for (const assignment of binding.assignments.sort((left, right) =>
    left.position - right.position)) {
    const assigned = staticTextValues(assignment.expression, context, nextStack);
    if (assignment.operator === ts.SyntaxKind.PlusEqualsToken) {
      if (assignment.position < usePosition && values.length > 0 && assigned.length > 0) {
        values = crossStaticValues(values, assigned, (left, right) => left + right);
      }
    } else if (assigned.length > 0) {
      values = boundedUnique([...values, ...assigned]);
    }
  }
  return values;
}

function staticPathCombination(parts, mode) {
  let selected = parts;
  if (mode === 'resolve') {
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const part = parts[index].replaceAll('\\', '/');
      if (
        part === REPO_PATH_TOKEN
        || part.startsWith('/')
        || /^[A-Za-z]:\//.test(part)
      ) {
        selected = parts.slice(index);
        break;
      }
    }
  }
  return canonicalPathText(selected.join('/'));
}

function staticTextValues(expression, context, bindingStack = new Set()) {
  const literal = literalText(expression);
  if (literal !== undefined && !ts.isRegularExpressionLiteral(expression)) return [literal];
  if (
    ts.isParenthesizedExpression(expression)
    || ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression)
    || ts.isNonNullExpression(expression)
    || ts.isAwaitExpression(expression)
    || ts.isSatisfiesExpression(expression)
  ) {
    return staticTextValues(expression.expression, context, bindingStack);
  }
  if (ts.isIdentifier(expression)) {
    const binding = context.resolveBinding(expression.text, expression);
    if (!binding) return [];
    return bindingStaticValues(binding, expression, context, bindingStack);
  }
  if (
    ts.isPropertyAccessExpression(expression)
    && ts.isIdentifier(expression.expression)
    && expression.expression.text === 'process'
    && expression.name.text === 'execPath'
    && !context.resolveBinding('process', expression.expression)
  ) {
    return [process.execPath];
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return crossStaticValues(
      staticTextValues(expression.left, context, bindingStack),
      staticTextValues(expression.right, context, bindingStack),
      (left, right) => left + right,
    );
  }
  if (ts.isTemplateExpression(expression)) {
    let values = [expression.head.text];
    for (const span of expression.templateSpans) {
      const substitutions = staticTextValues(span.expression, context, bindingStack);
      if (substitutions.length === 0) return [];
      values = crossStaticValues(
        values,
        substitutions,
        (value, substitution) => value + substitution + span.literal.text,
      );
    }
    return values;
  }
  if (ts.isConditionalExpression(expression)) {
    return boundedUnique([
      ...staticTextValues(expression.whenTrue, context, bindingStack),
      ...staticTextValues(expression.whenFalse, context, bindingStack),
    ]);
  }
  if (ts.isCallExpression(expression)) {
    const trust = trustedFunction(expression.expression, context);
    if (
      staticPropertyName(expression.expression) === 'cwd'
      && ts.isPropertyAccessExpression(expression.expression)
      && ts.isIdentifier(expression.expression.expression)
      && expression.expression.expression.text === 'process'
      && !context.resolveBinding('process', expression.expression.expression)
    ) {
      return [REPO_PATH_TOKEN];
    }
    if (
      trust?.module === 'path'
      && (trust.name === 'join' || trust.name === 'resolve')
    ) {
      let combinations = [[]];
      for (const argument of expression.arguments) {
        const values = staticTextValues(argument, context, bindingStack);
        if (values.length === 0) return [];
        const next = [];
        for (const combination of combinations) {
          for (const value of values) {
            next.push([...combination, value]);
            if (next.length >= MAX_STATIC_VARIANTS) break;
          }
          if (next.length >= MAX_STATIC_VARIANTS) break;
        }
        combinations = next;
      }
      return boundedUnique(combinations.map(parts =>
        staticPathCombination(parts, trust.name)));
    }
  }
  return [];
}

function staticText(expression, context, bindingStack = new Set()) {
  const values = staticTextValues(expression, context, bindingStack);
  return values.length === 1 ? values[0] : undefined;
}

function staticStringArray(expression, context, bindingStack = new Set()) {
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)) {
    return staticStringArray(expression.expression, context, bindingStack);
  }
  if (ts.isIdentifier(expression)) {
    const binding = context.resolveBinding(expression.text, expression);
    if (!binding) return undefined;
    if (bindingStack.has(binding.id)) return undefined;
    const expressions = bindingExpressions(binding, expression, context);
    if (expressions.length !== 1) return undefined;
    const nextStack = new Set(bindingStack);
    nextStack.add(binding.id);
    return staticStringArray(expressions[0], context, nextStack);
  }
  if (!ts.isArrayLiteralExpression(expression)) return undefined;
  const values = [];
  for (const element of expression.elements) {
    if (ts.isSpreadElement(element)) return undefined;
    const value = staticText(element, context, bindingStack);
    if (value === undefined) return undefined;
    values.push(value);
  }
  return values;
}

function objectPropertyInitializer(expression, propertyName) {
  if (!expression || !ts.isObjectLiteralExpression(expression)) return undefined;
  for (const property of expression.properties) {
    if (
      ts.isPropertyAssignment(property)
      && propertyNameText(property.name) === propertyName
    ) {
      return property.initializer;
    }
    if (
      ts.isShorthandPropertyAssignment(property)
      && property.name.text === propertyName
    ) {
      return property.name;
    }
  }
  return undefined;
}

function childOptionsExpression(node, methodName, context) {
  if (methodName === 'exec' || methodName === 'execSync') return node.arguments[1];
  if (
    methodName === 'spawn'
    || methodName === 'spawnSync'
    || methodName === 'execFile'
    || methodName === 'execFileSync'
  ) {
    return node.arguments[1] && staticStringArray(node.arguments[1], context) !== undefined
      ? node.arguments[2]
      : node.arguments[1];
  }
  return undefined;
}

function childCwdProvenance(node, methodName, context) {
  const options = childOptionsExpression(node, methodName, context);
  const cwd = objectPropertyInitializer(options, 'cwd');
  return cwd ? expressionProvenance(cwd, context) : 'repo';
}

function childInvocation(node, trusted, context) {
  if (!trusted?.name) return [];
  if (trusted.name === 'exec' || trusted.name === 'execSync') {
    const commands = node.arguments[0]
      ? staticTextValues(node.arguments[0], context)
      : [];
    return commands.map(command => ({ mode: 'shell', command }));
  }
  if (
    trusted.name === 'execFile'
    || trusted.name === 'execFileSync'
    || trusted.name === 'spawn'
    || trusted.name === 'spawnSync'
  ) {
    const executables = node.arguments[0]
      ? staticTextValues(node.arguments[0], context)
      : [];
    if (executables.length === 0) return [];
    const args = node.arguments[1]
      ? staticStringArray(node.arguments[1], context) ?? []
      : [];
    return executables.map(executable => ({
      mode: 'argv',
      argv: [executable, ...args],
    }));
  }
  if (trusted.name === 'fork') {
    const scripts = node.arguments[0]
      ? staticTextValues(node.arguments[0], context)
      : [];
    const args = node.arguments[1]
      ? staticStringArray(node.arguments[1], context) ?? []
      : [];
    return scripts.map(script => ({
      mode: 'argv',
      argv: [process.execPath, script, ...args],
    }));
  }
  return [];
}

function invokedChildEffects(sourceFile, context, scanBudget) {
  const calls = [];
  const isDeferredDefinition = node => {
    let cursor = node.parent;
    while (cursor && !ts.isSourceFile(cursor)) {
      if (ts.isFunctionLike(cursor)) return true;
      cursor = cursor.parent;
    }
    return false;
  };
  const visit = node => {
    scanBudget?.check('child-call-discovery');
    if (ts.isCallExpression(node)) {
      const trusted = trustedFunction(node.expression, context);
      if (trusted?.module === 'child_process') {
        const invocations = childInvocation(node, trusted, context);
        const cwd = childCwdProvenance(node, trusted.name, context);
        if (invocations.length === 0) {
          calls.push({
            node,
            kind: 'unresolved-command',
            cwd,
            deferredDefinition: isDeferredDefinition(node),
          });
        }
        for (const invocation of invocations) {
          calls.push({
            node,
            kind: 'command',
            invocation,
            cwd,
            deferredDefinition: isDeferredDefinition(node),
          });
          if (invocation.mode === 'argv') {
            const [executable, ...args] = invocation.argv;
            const executableType = executableKind(executable);
            const candidates = executableType === 'posix-shell'
              ? args.filter(argument => !argument.startsWith('-') && argument.endsWith('.sh'))
              : executable.endsWith('.sh') ? [executable] : [];
            for (const value of candidates) {
              calls.push({
                node,
                kind: 'shell-script',
                value,
                cwd,
                wrapper: false,
                deferredDefinition: isDeferredDefinition(node),
              });
            }
          }
        }
      }

      const name = calleeName(node.expression);
      if (name && SCRIPT_CALLERS.has(name)) {
        for (const argument of node.arguments) {
          const value = staticText(argument, context);
          if (
            value?.endsWith('.sh')
            && !value.includes('/')
            && !value.includes('\\')
          ) {
            calls.push({
              node,
              kind: 'shell-script',
              value,
              cwd: 'repo',
              wrapper: true,
              deferredDefinition: isDeferredDefinition(node),
            });
          }
        }
      }
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return calls;
}

function resolveRootShellScript(call, rootDir) {
  if (call.cwd === 'temp') return undefined;
  const normalized = call.value.replaceAll('\\', '/');
  if (call.wrapper) return join(rootDir, 'scripts', normalized);
  if (normalized === REPO_PATH_TOKEN || normalized.startsWith(`${REPO_PATH_TOKEN}/`)) {
    const relativePath = normalized.slice(REPO_PATH_TOKEN.length).replace(/^\/+/, '');
    const candidate = resolve(rootDir, relativePath);
    const scriptsRoot = resolve(rootDir, 'scripts');
    return candidate.startsWith(`${scriptsRoot}${sep}`) ? candidate : undefined;
  }
  if (call.cwd === 'repo' && !normalized.startsWith('/') && !/^[A-Za-z]:\//.test(normalized)) {
    const candidate = resolve(rootDir, normalized);
    const scriptsRoot = resolve(rootDir, 'scripts');
    return candidate.startsWith(`${scriptsRoot}${sep}`) ? candidate : undefined;
  }
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    const candidate = resolve(normalized);
    const scriptsRoot = resolve(rootDir, 'scripts');
    return candidate.startsWith(`${scriptsRoot}${sep}`) ? candidate : undefined;
  }
  return undefined;
}

function commandCanEscapeTemp(call, rootDir) {
  if (call.kind !== 'command') return false;
  const normalizedRoot = canonicalPathText(rootDir);
  const values = call.invocation.mode === 'shell'
    ? [call.invocation.command]
    : call.invocation.argv;
  if (values.some(value =>
    pathComparisonText(value).includes(pathComparisonText(normalizedRoot)))) {
    return true;
  }
  return call.invocation.mode === 'shell'
    && (
      /(?:^|[;&|()\s])cd(?:\s|$)/.test(call.invocation.command)
      || /(?:^|\s)--prefix(?:=|\s)/.test(call.invocation.command)
      || /(?:^|\s)--cwd(?:=|\s)/.test(call.invocation.command)
    );
}

function childEffectAnalysis(
  content,
  filePath,
  rootDir,
  eagerCallsites,
  scanBudget,
) {
  content = canonicalSourceText(content);
  const packagePath = join(rootDir, 'package.json');
  const packageOutcome = readPackageManifest(packagePath);
  const packageJson = packageOutcome.manifest;
  const packageScripts = packageJson?.scripts && typeof packageJson.scripts === 'object'
    ? packageJson.scripts
    : {};
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    sourceKind(filePath),
  );
  const context = createAnalysisContext(sourceFile, scanBudget);
  const violations = [];
  const registry = [];
  const addUnresolved = (call, effect, label) => {
    registry.push({
      file: filePath,
      line: lineFor(sourceFile, call.node),
      effect,
      targetProvenance: 'unknown',
      classification: 'unresolved',
      callsite: createCallsiteHash(
        filePath,
        call.node.getText(sourceFile),
        call.node.getStart(sourceFile),
      ),
      label,
    });
  };

  for (const call of invokedChildEffects(sourceFile, context, scanBudget)) {
    scanBudget?.check('child-effect-analysis');
    const callsite = createCallsiteHash(
      filePath,
      call.node.getText(sourceFile),
      call.node.getStart(sourceFile),
    );
    if (eagerCallsites && !eagerCallsites.has(callsite)) continue;
    let effects;
    if (call.kind === 'unresolved-command') {
      const label = 'test child command/effect is not statically resolvable';
      if (isSealedProductionChildAdapter(content, filePath, callsite)) {
        registry.push({
          file: filePath,
          line: lineFor(sourceFile, call.node),
          effect: 'child:sealed-production-adapter',
          targetProvenance: 'repo-production',
          classification: 'sealed-adapter',
          callsite,
          label: 'code-owned child adapter matches complete audited source seal',
        });
        continue;
      }
      if (call.deferredDefinition && !eagerCallsites) {
        addUnresolved(call, 'child:unresolved-command', label);
      } else {
        violations.push({
          file: filePath,
          line: lineFor(sourceFile, call.node),
          match: call.node.getText(sourceFile),
          label,
          code: 'E_HERMETIC_CHILD_EFFECT_UNRESOLVED',
          callsite,
        });
      }
      continue;
    }
    if (call.kind === 'command') {
      if (call.cwd === 'temp' && !commandCanEscapeTemp(call, rootDir)) continue;
      effects = call.invocation.mode === 'shell'
        ? traceCommandEffects(
          call.invocation.command,
          packageScripts,
          new Set(),
          { rootDir },
        )
        : traceArgvEffects(
          call.invocation.argv,
          packageScripts,
          new Set(),
          { rootDir },
        );
    } else {
      const scriptPath = resolveRootShellScript(call, rootDir);
      if (!scriptPath || !existsSync(scriptPath)) {
        addUnresolved(
          call,
          'child:unresolved-shell-script',
          'test shell script/effect is not statically resolvable',
        );
        continue;
      }
      effects = traceCommandEffects(
        readFileSync(scriptPath, 'utf-8'),
        packageScripts,
        new Set(),
        { rootDir },
      );
    }
    for (const effect of effects) {
      if (
        effect.effect === 'unresolved-child-effect'
        || effect.effect === 'unresolved-package-script'
      ) {
        addUnresolved(
          call,
          `child:${effect.effect}`,
          `test child effect unresolved: ${effect.chain.join(' -> ')}`,
        );
        continue;
      }
      const targetProvenance = (
        effect.effect === 'dist-clean'
        || effect.effect === 'dist-delete'
      )
        ? 'live-dist'
        : effect.boundary;
      if (!targetProvenance?.startsWith('live-')) continue;
      if (
        call.cwd === 'unknown'
        || call.cwd === 'deferred'
        || call.cwd === 'repo-scratch'
      ) {
        addUnresolved(
          call,
          `child:${effect.effect}:${targetProvenance}`,
          `test child cwd/effect unresolved: ${effect.chain.join(' -> ')}`,
        );
        continue;
      }
      violations.push({
        file: filePath,
        line: lineFor(sourceFile, call.node),
        match: call.node.getText(sourceFile),
        label: `test child reaches ${effect.effect}: ${effect.chain.join(' -> ')}`,
        code: errorCodeForProvenance(targetProvenance),
        callsite,
      });
    }
  }
  return {
    violations,
    registry: dedupeWriterRegistry(registry),
  };
}

function collectFiles(dir, results = [], scanBudget) {
  scanBudget?.check('test-file-discovery', true);
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) collectFiles(full, results, scanBudget);
    else if (entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) results.push(full);
  }
  return results;
}

const TEST_SUPPORT_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
];
const MAX_TEST_SURFACE_FILES = 5000;
const MAX_TEST_SURFACE_EDGES = 50_000;
const MAX_TEST_SURFACE_NODES = 5_000_000;
const MAX_TEST_SURFACE_DEPTH = 32;
const MODULE_SPECIFIER_CACHE = new Map();
const LOCAL_SUPPORT_IMPORT_CACHE = new Map();
const EAGER_SUMMARY_CACHE = new Map();
const MAX_EAGER_SUMMARY_CACHE_ENTRIES = 4096;
const MAX_EAGER_EXPORT_REPLANS_PER_MODULE = 128;

function cacheEagerSummary(key, summary) {
  if (EAGER_SUMMARY_CACHE.has(key)) EAGER_SUMMARY_CACHE.delete(key);
  EAGER_SUMMARY_CACHE.set(key, summary);
  if (EAGER_SUMMARY_CACHE.size > MAX_EAGER_SUMMARY_CACHE_ENTRIES) {
    EAGER_SUMMARY_CACHE.delete(EAGER_SUMMARY_CACHE.keys().next().value);
  }
}

function isWithinRealRoot(candidate, realRoot) {
  let realCandidate;
  try {
    realCandidate = realpathSync(candidate);
  } catch {
    return false;
  }
  const relativePath = relative(realRoot, realCandidate);
  return relativePath === ''
    || (
      !relativePath.startsWith(`..${sep}`)
      && relativePath !== '..'
      && !relativePath.startsWith(sep)
    );
}

function resolveLocalSupportImport(fromFile, specifier, realRoot) {
  if (!specifier.startsWith('.')) return undefined;
  const cacheKey = `${fromFile}\0${specifier}\0${realRoot}`;
  if (LOCAL_SUPPORT_IMPORT_CACHE.has(cacheKey)) {
    return LOCAL_SUPPORT_IMPORT_CACHE.get(cacheKey);
  }
  const raw = resolve(fromFile, '..', specifier);
  // 533 (CI-HERMETIC-SCAN-DIST-BLIND-001): never resolve into build output.
  // On a BUILT tree this walk otherwise ANALYZES dist files a clean checkout
  // cannot even see (+71 analyzer entries from dist/core/errors.js, measured
  // on run 31074633586), while a build-free tree records the same import as
  // an unresolved edge. Returning undefined here makes both trees classify
  // the import identically, so build-free baselines hold everywhere and the
  // "measure only on a build-free tree" operational dance is gone.
  const buildOutputRoots = [
    join(realRoot, 'dist'),
    join(realRoot, 'src', 'dashboard', 'dist'),
    join(realRoot, 'src', 'desktop', 'dist'),
  ];
  if (buildOutputRoots.some(root => raw === root || raw.startsWith(root + sep))) {
    LOCAL_SUPPORT_IMPORT_CACHE.set(cacheKey, undefined);
    return undefined;
  }
  const extension = TEST_SUPPORT_EXTENSIONS.find(candidate => raw.endsWith(candidate));
  const stem = extension ? raw.slice(0, -extension.length) : raw;
  const candidates = [
    raw,
    ...TEST_SUPPORT_EXTENSIONS.map(candidate => `${stem}${candidate}`),
    ...TEST_SUPPORT_EXTENSIONS.map(candidate => join(raw, `index${candidate}`)),
  ];
  for (const candidate of [...new Set(candidates)]) {
    if (
      existsSync(candidate)
      && statSync(candidate).isFile()
      && isWithinRealRoot(candidate, realRoot)
    ) {
      const resolvedFile = realpathSync(candidate);
      LOCAL_SUPPORT_IMPORT_CACHE.set(cacheKey, resolvedFile);
      return resolvedFile;
    }
  }
  LOCAL_SUPPORT_IMPORT_CACHE.set(cacheKey, undefined);
  return undefined;
}

function staticModuleSpecifiers(
  content,
  filePath,
  providedSourceFile,
  scanBudget,
) {
  content = canonicalSourceText(content);
  const cacheKey = `${filePath}\0${content.length}\0${deterministicDigest(content)}`;
  const cached = MODULE_SPECIFIER_CACHE.get(cacheKey);
  if (cached) return cached;
  const sourceFile = providedSourceFile ?? ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    sourceKind(filePath),
  );
  const values = [];
  let nodeCount = 0;
  let analysisContext;
  const isExpectedMissingImport = importCall => {
    const expectCall = importCall.parent;
    if (
      !ts.isCallExpression(expectCall)
      || expectCall.arguments[0] !== importCall
      || !ts.isIdentifier(expectCall.expression)
    ) {
      return false;
    }
    analysisContext ??= createAnalysisContext(sourceFile, scanBudget);
    const binding = analysisContext.resolveBinding(
      expectCall.expression.text,
      expectCall.expression,
    );
    if (
      binding?.trust?.module !== 'vitest'
      || binding.trust.name !== 'expect'
    ) {
      return false;
    }
    const rejects = expectCall.parent;
    if (
      !ts.isPropertyAccessExpression(rejects)
      || rejects.expression !== expectCall
      || rejects.name.text !== 'rejects'
    ) {
      return false;
    }
    const matcher = rejects.parent;
    if (
      !ts.isPropertyAccessExpression(matcher)
      || matcher.expression !== rejects
      || !['toThrow', 'toThrowError'].includes(matcher.name.text)
    ) {
      return false;
    }
    return ts.isCallExpression(matcher.parent)
      && matcher.parent.expression === matcher;
  };
  const visit = node => {
    scanBudget?.check('module-edge-analysis');
    nodeCount += 1;
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      const typeOnly = ts.isExportDeclaration(node)
        ? node.isTypeOnly
        : Boolean(
          node.importClause?.isTypeOnly
          || (
            node.importClause?.namedBindings
            && ts.isNamedImports(node.importClause.namedBindings)
            && node.importClause.namedBindings.elements.length > 0
            && node.importClause.namedBindings.elements.every(element => element.isTypeOnly)
          ),
        );
      if (!typeOnly) {
        values.push({
          specifier: node.moduleSpecifier.text,
          line: lineFor(sourceFile, node.moduleSpecifier),
          position: node.moduleSpecifier.getStart(sourceFile),
          kind: 'static',
        });
      }
    } else if (
      ts.isImportEqualsDeclaration(node)
      && !node.isTypeOnly
      && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression
      && ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      values.push({
        specifier: node.moduleReference.expression.text,
        line: lineFor(sourceFile, node.moduleReference.expression),
        position: node.moduleReference.expression.getStart(sourceFile),
        kind: 'static',
      });
    } else if (
      ts.isCallExpression(node)
      && node.arguments.length === 1
      && ts.isStringLiteralLike(node.arguments[0])
      && (
        node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (
          ts.isIdentifier(node.expression)
          && node.expression.text === 'require'
        )
      )
    ) {
      values.push({
        specifier: node.arguments[0].text,
        line: lineFor(sourceFile, node.arguments[0]),
        position: node.arguments[0].getStart(sourceFile),
        kind: node.expression.kind === ts.SyntaxKind.ImportKeyword
          ? 'dynamic-import'
          : 'commonjs-require',
        callsite: createCallsiteHash(
          filePath,
          node.getText(sourceFile),
          node.getStart(sourceFile),
        ),
        expectedMissing:
          node.expression.kind === ts.SyntaxKind.ImportKeyword
          && isExpectedMissingImport(node),
      });
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  const result = {
    edges: [...new Map(values.map(value => [
      `${value.position}\0${value.specifier}`,
      value,
    ])).values()],
    nodeCount,
  };
  MODULE_SPECIFIER_CACHE.set(cacheKey, result);
  return result;
}

function hasSyntaxModifier(node, kind) {
  return Boolean(node.modifiers?.some(modifier => modifier.kind === kind));
}

function createEagerModulePlan(
  content,
  filePath,
  identityPath = filePath,
  scanBudget,
) {
  content = canonicalSourceText(content);
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    sourceKind(filePath),
  );
  const context = createAnalysisContext(sourceFile, scanBudget);
  const callsites = new Set();
  const importedCalls = [];
  const eagerLoads = [];
  const unresolvedLoads = [];
  const unresolvedAuthorityCalls = [];
  const unresolvedEagerEvents = [];
  const writerCandidateCallsites = new Set();
  const childCandidateCallsites = new Set();
  const eagerEventAccounting = new Map();
  const importedBindings = new Map();
  const localExports = new Map();
  const reExports = new Map();
  const starReExports = [];
  const executedCallables = new Set();
  let importedCallCursor = 0;
  let eagerLoadCursor = 0;
  let unresolvedLoadCursor = 0;
  let unresolvedAuthorityCursor = 0;
  let unresolvedEagerEventCursor = 0;

  const registerImportBinding = (name, declaration, descriptor) => {
    importedBindings.set(name, { declaration, ...descriptor });
  };

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      const specifier = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      if (!clause || clause.isTypeOnly) continue;
      if (clause.name) {
        registerImportBinding(clause.name.text, clause.name, {
          specifier,
          exportName: 'default',
        });
      }
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        registerImportBinding(bindings.name.text, bindings.name, {
          specifier,
          namespace: true,
        });
      } else if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (element.isTypeOnly) continue;
          registerImportBinding(element.name.text, element.name, {
            specifier,
            exportName: (element.propertyName ?? element.name).text,
          });
        }
      }
      continue;
    }
    if (
      ts.isImportEqualsDeclaration(statement)
      && !statement.isTypeOnly
      && ts.isExternalModuleReference(statement.moduleReference)
      && statement.moduleReference.expression
      && ts.isStringLiteralLike(statement.moduleReference.expression)
    ) {
      registerImportBinding(statement.name.text, statement.name, {
        specifier: statement.moduleReference.expression.text,
        namespace: true,
      });
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer
          ? unwrapExpression(declaration.initializer)
          : undefined;
        let specifier;
        let exportName;
        if (
          initializer
          && ts.isCallExpression(initializer)
          && trustedBuiltinLoader(initializer.expression, context)
        ) {
          specifier = literalText(initializer.arguments[0]);
        } else if (
          initializer
          && (
            ts.isPropertyAccessExpression(initializer)
            || ts.isElementAccessExpression(initializer)
          )
          && ts.isCallExpression(unwrapExpression(initializer.expression))
          && trustedBuiltinLoader(
            unwrapExpression(initializer.expression).expression,
            context,
          )
        ) {
          const loader = unwrapExpression(initializer.expression);
          specifier = literalText(loader.arguments[0]);
          exportName = staticPropertyName(initializer);
        }
        if (specifier && ts.isIdentifier(declaration.name)) {
          registerImportBinding(declaration.name.text, declaration.name, {
            specifier,
            exportName,
            namespace: exportName === undefined,
          });
        } else if (
          specifier
          && ts.isObjectBindingPattern(declaration.name)
        ) {
          for (const element of declaration.name.elements) {
            if (!ts.isIdentifier(element.name)) continue;
            registerImportBinding(element.name.text, element.name, {
              specifier,
              exportName: propertyNameText(element.propertyName ?? element.name),
            });
          }
        }
      }
    }

    const exported = hasSyntaxModifier(statement, ts.SyntaxKind.ExportKeyword);
    const isDefault = hasSyntaxModifier(statement, ts.SyntaxKind.DefaultKeyword);
    if (
      exported
      && (
        ts.isFunctionDeclaration(statement)
        || ts.isClassDeclaration(statement)
      )
    ) {
      if (isDefault) localExports.set('default', statement);
      if (statement.name) localExports.set(statement.name.text, statement);
    } else if (exported && ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          localExports.set(
            declaration.name.text,
            declaration.initializer ?? declaration.name,
          );
        }
      }
    } else if (ts.isExportAssignment(statement)) {
      localExports.set('default', statement.expression);
    } else if (ts.isExportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier
        && ts.isStringLiteralLike(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : undefined;
      if (!statement.exportClause) {
        if (specifier && !statement.isTypeOnly) starReExports.push(specifier);
      } else if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          if (element.isTypeOnly) continue;
          const exportedName = element.name.text;
          const sourceName = (element.propertyName ?? element.name).text;
          if (specifier) {
            reExports.set(exportedName, { specifier, exportName: sourceName });
          } else {
            localExports.set(exportedName, element.propertyName ?? element.name);
          }
        }
      }
    }
  }

  const localCallableCandidates = (
    expression,
    bindingStack = new Set(),
  ) => {
    const unwrapped = unwrapExpression(expression);
    if (
      ts.isArrowFunction(unwrapped)
      || ts.isFunctionExpression(unwrapped)
      || ts.isFunctionDeclaration(unwrapped)
      || ts.isMethodDeclaration(unwrapped)
      || ts.isConstructorDeclaration(unwrapped)
    ) {
      return { callables: [unwrapped], opaque: false };
    }
    if (ts.isConditionalExpression(unwrapped)) {
      const branches = [
        localCallableCandidates(unwrapped.whenTrue, bindingStack),
        localCallableCandidates(unwrapped.whenFalse, bindingStack),
      ];
      return {
        callables: branches.flatMap(branch => branch.callables),
        opaque: branches.some(branch => branch.opaque),
      };
    }
    if (
      ts.isBinaryExpression(unwrapped)
      && (
        unwrapped.operatorToken.kind === ts.SyntaxKind.BarBarToken
        || unwrapped.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        || unwrapped.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      )
    ) {
      const branches = [
        localCallableCandidates(unwrapped.left, bindingStack),
        localCallableCandidates(unwrapped.right, bindingStack),
      ];
      return {
        callables: branches.flatMap(branch => branch.callables),
        opaque: branches.some(branch => branch.opaque),
      };
    }
    if (
      ts.isCallExpression(unwrapped)
      && (
        ts.isPropertyAccessExpression(unwrapped.expression)
        || ts.isElementAccessExpression(unwrapped.expression)
      )
      && staticPropertyName(unwrapped.expression) === 'bind'
    ) {
      const bound = localCallableCandidates(
        unwrapped.expression.expression,
        bindingStack,
      );
      return { callables: bound.callables, opaque: true };
    }
    if (
      ts.isPropertyAccessExpression(unwrapped)
      || ts.isElementAccessExpression(unwrapped)
    ) {
      const candidates = staticPropertyNames(unwrapped, context)
        .flatMap(property => projectedPropertyExpressions(
          unwrapped.expression,
          property,
          undefined,
          context,
        ));
      if (candidates.length === 0) {
        const classLike = localClass(unwrapped.expression);
        const property = staticPropertyName(unwrapped);
        if (classLike && property) {
          candidates.push(...classLike.members.filter(member =>
            propertyNameText(member.name) === property
            && (
              ts.isMethodDeclaration(member)
              || ts.isGetAccessorDeclaration(member)
              || ts.isSetAccessorDeclaration(member)
            )));
        }
      }
      if (candidates.length === 0) {
        return { callables: [], opaque: true };
      }
      const resolved = candidates.map(candidate =>
        localCallableCandidates(candidate, bindingStack));
      return {
        callables: resolved.flatMap(candidate => candidate.callables),
        opaque: resolved.some(candidate => candidate.opaque),
      };
    }
    if (!ts.isIdentifier(unwrapped)) {
      return { callables: [], opaque: true };
    }
    const binding = context.resolveBinding(unwrapped.text, unwrapped);
    if (!binding || bindingStack.has(binding.id)) {
      return { callables: [], opaque: true };
    }
    if (ts.isFunctionDeclaration(binding.declaration.parent)) {
      return {
        callables: [binding.declaration.parent],
        opaque: false,
      };
    }
    const nextStack = new Set(bindingStack);
    nextStack.add(binding.id);
    const candidates = bindingExpressionsAtUse(binding, unwrapped, context);
    if (candidates.length === 0) {
      return { callables: [], opaque: true };
    }
    const resolved = candidates.map(candidate =>
      localCallableCandidates(candidate, nextStack));
    return {
      callables: [...new Map(resolved.flatMap(candidate =>
        candidate.callables.map(callable => [
          callable.getStart(sourceFile),
          callable,
        ]))).values()],
      opaque: resolved.some(candidate => candidate.opaque),
    };
  };
  const localCallable = expression => {
    const resolved = localCallableCandidates(expression);
    return resolved.callables.length === 1 && !resolved.opaque
      ? resolved.callables[0]
      : undefined;
  };
  const localClass = (expression, bindingStack = new Set()) => {
    const unwrapped = unwrapExpression(expression);
    if (
      ts.isClassDeclaration(unwrapped)
      || ts.isClassExpression(unwrapped)
    ) {
      return unwrapped;
    }
    if (!ts.isIdentifier(unwrapped)) return undefined;
    const binding = context.resolveBinding(unwrapped.text, unwrapped);
    if (!binding || bindingStack.has(binding.id)) return undefined;
    if (
      ts.isClassDeclaration(binding.declaration.parent)
      || ts.isClassExpression(binding.declaration.parent)
    ) {
      return binding.declaration.parent;
    }
    const nextStack = new Set(bindingStack);
    nextStack.add(binding.id);
    for (const candidate of bindingExpressionsAtUse(binding, unwrapped, context)) {
      const classLike = localClass(candidate, nextStack);
      if (classLike) return classLike;
    }
    return undefined;
  };

  const expressionContains = (
    expression,
    predicate,
    bindingStack = new Set(),
  ) => {
    const unwrapped = unwrapExpression(expression);
    if (predicate(unwrapped)) return true;
    if (ts.isIdentifier(unwrapped)) {
      const binding = context.resolveBinding(unwrapped.text, unwrapped);
      if (binding && !bindingStack.has(binding.id)) {
        const nextStack = new Set(bindingStack);
        nextStack.add(binding.id);
        return bindingExpressionsAtUse(binding, unwrapped, context)
          .some(candidate => expressionContains(candidate, predicate, nextStack));
      }
    }
    let found = false;
    unwrapped.forEachChild(child => {
      if (!found && expressionContains(child, predicate, bindingStack)) found = true;
    });
    return found;
  };
  const containsImportMetaUrl = expression => expressionContains(
    expression,
    node => (
      ts.isPropertyAccessExpression(node)
      && node.name.text === 'url'
      && ts.isMetaProperty(node.expression)
      && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword
    ),
  );
  const containsProcessArgv = expression => expressionContains(
    expression,
    node => (
      (
        ts.isElementAccessExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === 'process'
        && node.expression.name.text === 'argv'
        && ts.isNumericLiteral(node.argumentExpression)
        && node.argumentExpression.text === '1'
      )
      || (
        ts.isPropertyAccessExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === 'process'
        && node.name.text === 'argv'
      )
    ),
  );
  const containsRequireMain = expression => expressionContains(
    expression,
    node => (
      ts.isPropertyAccessExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'require'
      && node.name.text === 'main'
      && !context.resolveBinding('require', node.expression)
    ),
  );
  const containsAmbientModule = expression => expressionContains(
    expression,
    node => (
      ts.isIdentifier(node)
      && node.text === 'module'
      && !context.resolveBinding('module', node)
    ),
  );
  const isStaticFalse = expression => {
    const unwrapped = unwrapExpression(expression);
    return unwrapped.kind === ts.SyntaxKind.FalseKeyword
      || (
        ts.isNumericLiteral(unwrapped)
        && Number(unwrapped.text) === 0
      );
  };
  const isExactProcessArgvEntry = expression => {
    const unwrapped = unwrapExpression(expression);
    return (
      ts.isElementAccessExpression(unwrapped)
      && ts.isPropertyAccessExpression(unwrapped.expression)
      && ts.isIdentifier(unwrapped.expression.expression)
      && unwrapped.expression.expression.text === 'process'
      && unwrapped.expression.name.text === 'argv'
      && ts.isNumericLiteral(unwrapped.argumentExpression)
      && unwrapped.argumentExpression.text === '1'
      && !context.resolveBinding('process', unwrapped.expression.expression)
    );
  };
  const isExactImportMetaUrl = expression => {
    const unwrapped = unwrapExpression(expression);
    return (
      ts.isPropertyAccessExpression(unwrapped)
      && unwrapped.name.text === 'url'
      && ts.isMetaProperty(unwrapped.expression)
      && unwrapped.expression.keywordToken === ts.SyntaxKind.ImportKeyword
    );
  };
  const isExactImportMetaMain = expression => {
    const unwrapped = unwrapExpression(expression);
    return (
      ts.isPropertyAccessExpression(unwrapped)
      && unwrapped.name.text === 'main'
      && ts.isMetaProperty(unwrapped.expression)
      && unwrapped.expression.keywordToken === ts.SyntaxKind.ImportKeyword
    );
  };
  const isExactCurrentModulePath = expression => {
    const unwrapped = unwrapExpression(expression);
    if (!ts.isCallExpression(unwrapped) || unwrapped.arguments.length !== 1) {
      return false;
    }
    const trusted = trustedFunction(unwrapped.expression, context);
    if (
      trusted?.module === 'url'
      && trusted.name === 'fileURLToPath'
    ) {
      return isExactImportMetaUrl(unwrapped.arguments[0]);
    }
    if (
      trusted?.module === 'path'
      && (
        trusted.name === 'normalize'
        || trusted.name === 'resolve'
      )
    ) {
      return isExactCurrentModulePath(unwrapped.arguments[0]);
    }
    return false;
  };
  const isExactArgvModulePath = (
    expression,
    bindingStack = new Set(),
  ) => {
    const unwrapped = unwrapExpression(expression);
    if (isExactProcessArgvEntry(unwrapped)) return true;
    const isEmptySentinel = candidate =>
      literalText(unwrapExpression(candidate)) === '';
    if (ts.isIdentifier(unwrapped)) {
      const binding = context.resolveBinding(unwrapped.text, unwrapped);
      if (!binding || bindingStack.has(binding.id)) return false;
      const nextStack = new Set(bindingStack);
      nextStack.add(binding.id);
      const values = bindingExpressionsAtUse(binding, unwrapped, context);
      return values.length > 0
        && values.every(value =>
          isExactArgvModulePath(value, nextStack)
          || isEmptySentinel(value));
    }
    if (
      ts.isBinaryExpression(unwrapped)
      && (
        unwrapped.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
        || unwrapped.operatorToken.kind === ts.SyntaxKind.BarBarToken
      )
    ) {
      return (
        isExactArgvModulePath(unwrapped.left, bindingStack)
        && isEmptySentinel(unwrapped.right)
      );
    }
    if (ts.isConditionalExpression(unwrapped)) {
      return [
        unwrapped.whenTrue,
        unwrapped.whenFalse,
      ].every(branch =>
        isExactArgvModulePath(branch, bindingStack)
        || isEmptySentinel(branch));
    }
    if (!ts.isCallExpression(unwrapped) || unwrapped.arguments.length !== 1) {
      return false;
    }
    const trusted = trustedFunction(unwrapped.expression, context);
    return (
      trusted?.module === 'path'
      && (
        trusted.name === 'normalize'
        || trusted.name === 'resolve'
      )
      && isExactArgvModulePath(unwrapped.arguments[0], bindingStack)
    );
  };
  const isExactRequireMain = expression => {
    const unwrapped = unwrapExpression(expression);
    return (
      ts.isPropertyAccessExpression(unwrapped)
      && ts.isIdentifier(unwrapped.expression)
      && unwrapped.expression.text === 'require'
      && unwrapped.name.text === 'main'
      && !context.resolveBinding('require', unwrapped.expression)
    );
  };
  const isExactAmbientModule = expression => {
    const unwrapped = unwrapExpression(expression);
    return (
      ts.isIdentifier(unwrapped)
      && unwrapped.text === 'module'
      && !context.resolveBinding('module', unwrapped)
    );
  };
  const isExactMainEquality = expression => {
    const unwrapped = unwrapExpression(expression);
    if (
      !ts.isBinaryExpression(unwrapped)
      || (
        unwrapped.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken
        && unwrapped.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsToken
      )
    ) {
      return false;
    }
    return (
      (
        isExactCurrentModulePath(unwrapped.left)
        && isExactArgvModulePath(unwrapped.right)
      )
      || (
        isExactCurrentModulePath(unwrapped.right)
        && isExactArgvModulePath(unwrapped.left)
      )
      || (
        isExactRequireMain(unwrapped.left)
        && isExactAmbientModule(unwrapped.right)
      )
      || (
        isExactRequireMain(unwrapped.right)
        && isExactAmbientModule(unwrapped.left)
      )
    );
  };
  const isModuleMainGuard = (expression, guardStack = new Set()) => {
    const unwrapped = unwrapExpression(expression);
    if (isExactImportMetaMain(unwrapped)) return true;
    if (ts.isIdentifier(unwrapped)) {
      const binding = context.resolveBinding(unwrapped.text, unwrapped);
      if (!binding || guardStack.has(binding.id)) return false;
      const nextStack = new Set(guardStack);
      nextStack.add(binding.id);
      const values = bindingExpressionsAtUse(binding, unwrapped, context);
      return values.length > 0
        && values.every(value => isModuleMainGuard(value, nextStack));
    }
    if (
      ts.isBinaryExpression(unwrapped)
      && (
        unwrapped.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
        || unwrapped.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken
      )
    ) {
      return isExactMainEquality(unwrapped);
    }
    if (
      ts.isBinaryExpression(unwrapped)
      && unwrapped.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      return isModuleMainGuard(unwrapped.left, guardStack)
        || isModuleMainGuard(unwrapped.right, guardStack);
    }
    if (ts.isCallExpression(unwrapped)) {
      const callable = localCallable(unwrapped.expression);
      if (!callable?.body) return false;
      if (
        callable.asteriskToken
        || hasSyntaxModifier(callable, ts.SyntaxKind.AsyncKeyword)
      ) {
        return false;
      }
      const key = callable.getStart(sourceFile);
      if (guardStack.has(key)) return false;
      const returns = [];
      const collectReturns = node => {
        if (node !== callable.body && ts.isFunctionLike(node)) return;
        if (ts.isReturnStatement(node) && node.expression) {
          returns.push(node.expression);
          return;
        }
        node.forEachChild(collectReturns);
      };
      collectReturns(callable.body);
      if (returns.length === 0) return false;
      const nextStack = new Set(guardStack);
      nextStack.add(key);
      return returns.every(value =>
        isStaticFalse(value) || isModuleMainGuard(value, nextStack));
    }
    return false;
  };
  const isInexactModuleMainGuard = expression => {
    const unwrapped = unwrapExpression(expression);
    if (ts.isCallExpression(unwrapped)) {
      const callable = localCallable(unwrapped.expression);
      if (
        callable?.body
        && (
          callable.asteriskToken
          || hasSyntaxModifier(callable, ts.SyntaxKind.AsyncKeyword)
        )
      ) {
        const returns = [];
        const collectReturns = node => {
          if (node !== callable.body && ts.isFunctionLike(node)) return;
          if (ts.isReturnStatement(node) && node.expression) {
            returns.push(node.expression);
            return;
          }
          node.forEachChild(collectReturns);
        };
        collectReturns(callable.body);
        if (returns.some(value => isModuleMainGuard(value))) return true;
      }
    }
    if (
      ts.isBinaryExpression(unwrapped)
      && (
        unwrapped.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
        || unwrapped.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken
      )
      && !isExactMainEquality(unwrapped)
      && (
        (
          containsImportMetaUrl(unwrapped)
          && containsProcessArgv(unwrapped)
        )
        || (
          containsRequireMain(unwrapped)
          && containsAmbientModule(unwrapped)
        )
      )
    ) {
      return true;
    }
    return (
      ts.isCallExpression(unwrapped)
      && (
        ts.isPropertyAccessExpression(unwrapped.expression)
        || ts.isElementAccessExpression(unwrapped.expression)
      )
      && staticPropertyName(unwrapped.expression) === 'endsWith'
      && (
        containsProcessArgv(unwrapped)
        || containsImportMetaUrl(unwrapped)
      )
    );
  };

  const importedCallee = (expression, bindingStack = new Set()) => {
    const isDeclaredImportBinding = (binding, descriptor) =>
      Boolean(
        !binding
        || binding.declaration.getStart(sourceFile)
          === descriptor.declaration.getStart(sourceFile),
      );
    const unwrapped = unwrapExpression(expression);
    if (ts.isIdentifier(unwrapped)) {
      const descriptor = importedBindings.get(unwrapped.text);
      const binding = context.resolveBinding(unwrapped.text, unwrapped);
      if (
        descriptor
        && isDeclaredImportBinding(binding, descriptor)
      ) {
        return descriptor.namespace
          ? undefined
          : descriptor;
      }
      if (!binding || bindingStack.has(binding.id)) return undefined;
      const nextStack = new Set(bindingStack);
      nextStack.add(binding.id);
      const candidates = bindingExpressionsAtUse(binding, unwrapped, context)
        .map(candidate => importedCallee(candidate, nextStack))
        .filter(Boolean);
      if (candidates.length === 0) return undefined;
      const canonical = new Map(candidates.map(candidate => [
        JSON.stringify([
          candidate.specifier,
          candidate.exportName,
          candidate.unsupportedMember,
          candidate.boundOpaque,
        ]),
        candidate,
      ]));
      return canonical.size === 1
        ? canonical.values().next().value
        : undefined;
    }
    if (
      ts.isCallExpression(unwrapped)
      && (
        ts.isPropertyAccessExpression(unwrapped.expression)
        || ts.isElementAccessExpression(unwrapped.expression)
      )
      && staticPropertyName(unwrapped.expression) === 'bind'
    ) {
      const bound = importedCallee(
        unwrapped.expression.expression,
        bindingStack,
      );
      return bound ? { ...bound, boundOpaque: true } : undefined;
    }
    if (
      ts.isPropertyAccessExpression(unwrapped)
      || ts.isElementAccessExpression(unwrapped)
    ) {
      const receiver = unwrapExpression(unwrapped.expression);
      if (ts.isIdentifier(receiver)) {
        const descriptor = importedBindings.get(receiver.text);
        const binding = descriptor
          ? context.resolveBinding(receiver.text, receiver)
          : undefined;
        const exportName = staticPropertyName(unwrapped);
        if (
          descriptor?.namespace
          && isDeclaredImportBinding(binding, descriptor)
          && exportName
        ) {
          return {
            specifier: descriptor.specifier,
            exportName,
          };
        }
        if (
          descriptor
          && !descriptor.namespace
          && isDeclaredImportBinding(binding, descriptor)
          && exportName
        ) {
          return {
            specifier: descriptor.specifier,
            exportName: descriptor.exportName,
            unsupportedMember: exportName,
          };
        }
      }
      if (
        ts.isCallExpression(receiver)
        && trustedBuiltinLoader(receiver.expression, context)
      ) {
        const specifier = literalText(receiver.arguments[0]);
        const exportName = staticPropertyName(unwrapped);
        if (specifier && exportName) return { specifier, exportName };
      }
      const exportName = staticPropertyName(unwrapped);
      if (exportName) {
        const projected = projectedPropertyExpressions(
          unwrapped.expression,
          exportName,
          undefined,
          context,
          bindingStack,
        );
        const candidates = projected
          .map(candidate => importedCallee(candidate, bindingStack))
          .filter(Boolean);
        const canonical = new Map(candidates.map(candidate => [
          JSON.stringify([
            candidate.specifier,
            candidate.exportName,
            candidate.unsupportedMember,
            candidate.boundOpaque,
          ]),
          candidate,
        ]));
        if (canonical.size === 1) return canonical.values().next().value;
      }
    }
    return undefined;
  };

  const addCallsite = node => {
    const callsite = createCallsiteHash(
      identityPath,
      node.getText(sourceFile),
      node.getStart(sourceFile),
    );
    callsites.add(callsite);
    return callsite;
  };

  const beginEagerEvent = (node, kind) => {
    const callsite = addCallsite(node);
    const key = `${kind}\0${callsite}`;
    if (!eagerEventAccounting.has(key)) {
      eagerEventAccounting.set(key, {
        kind,
        callsite,
        outcome: undefined,
      });
    }
    return { key, callsite };
  };
  const accountEagerEvent = (event, outcome) => {
    const record = eagerEventAccounting.get(event.key);
    if (!record) {
      throw new Error(
        `[E_HERMETIC_EAGER_ACCOUNTING] missing event ${event.key}`,
      );
    }
    if (record.outcome && record.outcome !== outcome) {
      throw new Error(
        '[E_HERMETIC_EAGER_ACCOUNTING]'
        + ` ambiguous outcome ${record.outcome}/${outcome}`
        + ` for ${event.key}`,
      );
    }
    record.outcome = outcome;
  };

  const argumentProfile = (expression, bindingStack = new Set()) => {
    const unwrapped = unwrapExpression(expression);
    if (
      (
        ts.isIdentifier(unwrapped)
        && unwrapped.text === 'undefined'
        && !context.resolveBinding('undefined', unwrapped)
      )
      || ts.isVoidExpression(unwrapped)
    ) {
      return { kind: 'undefined' };
    }
    if (ts.isConditionalExpression(unwrapped)) {
      return {
        kind: 'union',
        options: [
          argumentProfile(unwrapped.whenTrue, bindingStack),
          argumentProfile(unwrapped.whenFalse, bindingStack),
        ],
      };
    }
    if (
      ts.isBinaryExpression(unwrapped)
      && (
        unwrapped.operatorToken.kind === ts.SyntaxKind.BarBarToken
        || unwrapped.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        || unwrapped.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      )
    ) {
      return {
        kind: 'union',
        options: [
          argumentProfile(unwrapped.left, bindingStack),
          argumentProfile(unwrapped.right, bindingStack),
        ],
      };
    }
    if (ts.isIdentifier(unwrapped)) {
      const binding = context.resolveBinding(unwrapped.text, unwrapped);
      if (!binding || bindingStack.has(binding.id)) return { kind: 'opaque' };
      const nextStack = new Set(bindingStack);
      nextStack.add(binding.id);
      const values = bindingExpressionsAtUse(binding, unwrapped, context);
      if (values.length === 0) return { kind: 'opaque' };
      const options = values.map(value => argumentProfile(value, nextStack));
      return options.length === 1
        ? options[0]
        : { kind: 'union', options };
    }
    if (
      ts.isArrowFunction(unwrapped)
      || ts.isFunctionExpression(unwrapped)
      || ts.isFunctionDeclaration(unwrapped)
      || ts.isMethodDeclaration(unwrapped)
    ) {
      return { kind: 'callable' };
    }
    if (ts.isObjectLiteralExpression(unwrapped)) {
      const properties = {};
      let opaqueRest = false;
      for (const property of unwrapped.properties) {
        if (ts.isSpreadAssignment(property)) {
          opaqueRest = true;
          continue;
        }
        const name = propertyNameText(property.name);
        if (name === undefined) {
          opaqueRest = true;
          continue;
        }
        if (ts.isPropertyAssignment(property)) {
          properties[name] = argumentProfile(property.initializer, bindingStack);
        } else if (ts.isShorthandPropertyAssignment(property)) {
          properties[name] = argumentProfile(property.name, bindingStack);
        } else if (
          ts.isMethodDeclaration(property)
          || ts.isGetAccessorDeclaration(property)
          || ts.isSetAccessorDeclaration(property)
        ) {
          properties[name] = { kind: 'callable' };
        } else {
          opaqueRest = true;
        }
      }
      return { kind: 'object', properties, opaqueRest };
    }
    if (ts.isArrayLiteralExpression(unwrapped)) {
      const elements = [];
      let opaqueRest = false;
      for (const element of unwrapped.elements) {
        if (ts.isOmittedExpression(element)) {
          elements.push({ kind: 'undefined' });
        } else if (ts.isSpreadElement(element)) {
          const spread = argumentProfile(element.expression, bindingStack);
          if (spread.kind === 'array' && !spread.opaqueRest) {
            elements.push(...spread.elements);
          } else {
            elements.push({ kind: 'spread' });
            opaqueRest = true;
          }
        } else {
          elements.push(argumentProfile(element, bindingStack));
        }
      }
      return { kind: 'array', elements, opaqueRest };
    }
    if (
      ts.isStringLiteralLike(unwrapped)
      || ts.isNumericLiteral(unwrapped)
      || ts.isBigIntLiteral(unwrapped)
      || ts.isRegularExpressionLiteral(unwrapped)
      || ts.isClassExpression(unwrapped)
      || ts.isNewExpression(unwrapped)
      || unwrapped.kind === ts.SyntaxKind.TrueKeyword
      || unwrapped.kind === ts.SyntaxKind.FalseKeyword
      || unwrapped.kind === ts.SyntaxKind.NullKeyword
    ) {
      return { kind: 'defined' };
    }
    return { kind: 'opaque' };
  };

  const invocationProfiles = node => {
    const profiles = [];
    for (const argument of node.arguments ?? []) {
      if (!ts.isSpreadElement(argument)) {
        profiles.push(argumentProfile(argument));
        continue;
      }
      const spread = argumentProfile(argument.expression);
      if (spread.kind === 'array' && !spread.opaqueRest) {
        profiles.push(...spread.elements);
      } else {
        profiles.push({ kind: 'spread' });
      }
    }
    return profiles;
  };

  const profileAtParameter = (profiles, index) => {
    for (let cursor = 0; cursor <= index && cursor < profiles.length; cursor += 1) {
      if (profiles[cursor]?.kind === 'spread') return { kind: 'opaque' };
    }
    return profiles[index] ?? { kind: 'undefined' };
  };

  const profileDefaultDecision = profile => {
    if (profile.kind === 'undefined') return 'execute';
    if (profile.kind === 'opaque' || profile.kind === 'spread') return 'opaque';
    if (profile.kind !== 'union') return 'skip';
    const decisions = profile.options.map(profileDefaultDecision);
    if (decisions.includes('opaque')) return 'opaque';
    if (decisions.includes('execute')) return 'execute';
    return 'skip';
  };

  const profileAfterDefault = (profile, initializer) => {
    const decision = profileDefaultDecision(profile);
    if (decision === 'execute') {
      const initializerProfile = argumentProfile(initializer);
      if (profile.kind !== 'union') return initializerProfile;
      return {
        kind: 'union',
        options: [
          initializerProfile,
          ...profile.options.filter(option =>
            profileDefaultDecision(option) === 'skip'),
        ],
      };
    }
    return profile;
  };

  const unresolvedEager = (node, effect, callsite = addCallsite(node)) => {
    unresolvedEagerEvents.push({ node, effect, callsite });
  };

  const projectedArgumentProfile = (profile, property, index) => {
    if (profile.kind === 'union') {
      return {
        kind: 'union',
        options: profile.options.map(option =>
          projectedArgumentProfile(option, property, index)),
      };
    }
    if (property !== undefined) {
      if (profile.kind === 'object') {
        if (Object.hasOwn(profile.properties, property)) {
          return profile.properties[property];
        }
        return profile.opaqueRest
          ? { kind: 'opaque' }
          : { kind: 'undefined' };
      }
      if (profile.kind === 'opaque') return profile;
      return { kind: 'undefined' };
    }
    if (index !== undefined) {
      if (profile.kind === 'array') {
        if (profile.elements[index]) return profile.elements[index];
        return profile.opaqueRest
          ? { kind: 'opaque' }
          : { kind: 'undefined' };
      }
      return profile.kind === 'opaque'
        ? profile
        : { kind: 'opaque' };
    }
    return { kind: 'opaque' };
  };

  const visitBindingDefaults = (
    pattern,
    profile,
    callStack,
    invocationFrame,
    invocationNode,
  ) => {
    if (ts.isIdentifier(pattern)) {
      const binding = context.resolveBinding(pattern.text, pattern);
      if (binding) invocationFrame.set(binding.id, profile);
      return;
    }
    pattern.elements.forEach((element, index) => {
      if (ts.isOmittedExpression(element)) return;
      const property = ts.isObjectBindingPattern(pattern)
        ? propertyNameText(element.propertyName ?? element.name)
        : undefined;
      let valueProfile = projectedArgumentProfile(
        profile,
        property,
        ts.isArrayBindingPattern(pattern) ? index : undefined,
      );
      if (element.initializer) {
        const decision = profileDefaultDecision(valueProfile);
        if (decision === 'execute') {
          visit(element.initializer, callStack, invocationFrame);
          valueProfile = profileAfterDefault(valueProfile, element.initializer);
        } else if (decision === 'opaque') {
          unresolvedEager(
            invocationNode,
            'production:eager-destructured-default-opaque',
          );
        }
      }
      visitBindingDefaults(
        element.name,
        valueProfile,
        callStack,
        invocationFrame,
        invocationNode,
      );
    });
  };

  const executeCallable = (
    callable,
    profiles,
    callStack,
    invocationNode,
  ) => {
    const callableKey = callable.getStart(sourceFile);
    if (callStack.has(callableKey)) return;
    const nextStack = new Set(callStack);
    nextStack.add(callableKey);
    const invocationFrame = new Map();
    for (const [index, parameter] of (callable.parameters ?? []).entries()) {
      let profile = parameter.dotDotDotToken
        ? {
          kind: 'array',
          elements: profiles.slice(index),
          opaqueRest: profiles.slice(index).some(value => value.kind === 'spread'),
        }
        : profileAtParameter(profiles, index);
      if (parameter.initializer) {
        const decision = profileDefaultDecision(profile);
        if (decision === 'execute') {
          visit(parameter.initializer, nextStack, invocationFrame);
          profile = profileAfterDefault(profile, parameter.initializer);
        } else if (decision === 'opaque') {
          unresolvedEager(
            invocationNode,
            'production:eager-default-parameter-opaque',
          );
        }
      }
      visitBindingDefaults(
        parameter.name,
        profile,
        nextStack,
        invocationFrame,
        invocationNode,
      );
    }
    if (callable.body && !callable.asteriskToken) {
      visit(callable.body, nextStack, invocationFrame);
    }
  };

  const executeClassConstruction = (
    classLike,
    profiles,
    callStack,
    invocationNode,
  ) => {
    const classKey = classLike.getStart(sourceFile);
    if (callStack.has(classKey)) return;
    const nextStack = new Set(callStack);
    nextStack.add(classKey);
    const constructors = classLike.members.filter(member =>
      ts.isConstructorDeclaration(member));
    if (constructors.length > 1) {
      unresolvedEager(
        invocationNode,
        'production:eager-class-constructor-ambiguous',
      );
    }
    const constructor = constructors[0];
    const superCalls = [];
    if (constructor?.body) {
      const collectSuperCalls = node => {
        if (
          node !== constructor.body
          && (
            ts.isFunctionLike(node)
            || ts.isClassDeclaration(node)
            || ts.isClassExpression(node)
          )
        ) {
          return;
        }
        if (
          ts.isCallExpression(node)
          && node.expression.kind === ts.SyntaxKind.SuperKeyword
        ) {
          superCalls.push(node);
          return;
        }
        node.forEachChild(collectSuperCalls);
      };
      collectSuperCalls(constructor.body);
    }
    const constructorArgumentProfile = expression => {
      const unwrapped = unwrapExpression(expression);
      if (ts.isIdentifier(unwrapped) && constructor) {
        const binding = context.resolveBinding(unwrapped.text, unwrapped);
        const parameterIndex = constructor.parameters.findIndex(parameter =>
          binding
          && binding.declaration.getStart(sourceFile)
            >= parameter.getStart(sourceFile)
          && binding.declaration.getEnd()
            <= parameter.getEnd());
        if (parameterIndex >= 0) {
          let profile = profileAtParameter(profiles, parameterIndex);
          const parameter = constructor.parameters[parameterIndex];
          if (parameter.initializer) {
            profile = profileAfterDefault(profile, parameter.initializer);
          }
          return profile;
        }
      }
      return argumentProfile(expression);
    };
    const baseInvocationProfiles = superCalls.length > 0
      ? superCalls.map(superCall =>
        (superCall.arguments ?? []).map(argument =>
          ts.isSpreadElement(argument)
            ? { kind: 'spread' }
            : constructorArgumentProfile(argument)))
      : constructor
        ? []
        : [profiles];
    if (superCalls.length > 1) {
      unresolvedEager(
        invocationNode,
        'production:eager-class-super-flow-ambiguous',
      );
    }
    const extendsTypes = (classLike.heritageClauses ?? [])
      .filter(clause => clause.token === ts.SyntaxKind.ExtendsKeyword)
      .flatMap(clause => [...clause.types]);
    if (extendsTypes.length > 1) {
      unresolvedEager(
        invocationNode,
        'production:eager-class-base-ambiguous',
      );
    }
    for (const baseType of extendsTypes) {
      const baseClass = localClass(baseType.expression);
      if (baseClass) {
        for (const baseProfiles of baseInvocationProfiles) {
          executeClassConstruction(
            baseClass,
            baseProfiles,
            nextStack,
            baseType.expression,
          );
        }
        continue;
      }
      const imported = importedCallee(baseType.expression);
      const callsite = addCallsite(baseType.expression);
      if (imported?.unsupportedMember || imported?.boundOpaque) {
        unresolvedEager(
          baseType.expression,
          imported.unsupportedMember
            ? 'production:eager-class-base-member-unresolved'
            : 'production:eager-class-base-bound-unresolved',
          callsite,
        );
      } else if (imported) {
        for (const baseProfiles of baseInvocationProfiles) {
          importedCalls.push({
            node: baseType.expression,
            callsite,
            invocationKind: 'construct',
            argumentProfiles: baseProfiles,
            ...imported,
          });
        }
      } else {
        unresolvedEager(
          baseType.expression,
          'production:eager-class-base-unresolved',
          callsite,
        );
      }
    }
    for (const member of classLike.members) {
      if (
        ts.isPropertyDeclaration(member)
        && !hasSyntaxModifier(member, ts.SyntaxKind.StaticKeyword)
        && member.initializer
      ) {
        visit(member.initializer, nextStack);
      }
    }
    if (constructor) {
      executeCallable(
        constructor,
        profiles,
        nextStack,
        invocationNode,
      );
    }
  };

  const eagerCallbackPolicy = expression => {
    const unwrapped = unwrapExpression(expression);
    if (ts.isIdentifier(unwrapped)) {
      if (context.resolveBinding(unwrapped.text, unwrapped)) return undefined;
      if (
        [
          'queueMicrotask',
          'setImmediate',
          'setInterval',
          'setTimeout',
        ].includes(unwrapped.text)
      ) {
        return { callbackIndexes: [0], exact: true };
      }
      return undefined;
    }
    if (
      !ts.isPropertyAccessExpression(unwrapped)
      && !ts.isElementAccessExpression(unwrapped)
    ) {
      return undefined;
    }
    const method = staticPropertyName(unwrapped);
    if (
      method === 'nextTick'
      && ts.isIdentifier(unwrapped.expression)
      && unwrapped.expression.text === 'process'
      && !context.resolveBinding('process', unwrapped.expression)
    ) {
      return { callbackIndexes: [0], exact: true };
    }
    if (
      [
        'every',
        'filter',
        'find',
        'findIndex',
        'findLast',
        'findLastIndex',
        'flatMap',
        'forEach',
        'map',
        'reduce',
        'reduceRight',
        'some',
      ].includes(method ?? '')
    ) {
      return { callbackIndexes: [0], exact: false };
    }
    if (['catch', 'finally', 'then'].includes(method ?? '')) {
      return {
        callbackIndexes: method === 'then' ? [0, 1] : [0],
        exact: false,
      };
    }
    return undefined;
  };

  const isProvenSafeEagerCall = expression => {
    const unwrapped = unwrapExpression(expression);
    if (
      !ts.isPropertyAccessExpression(unwrapped)
      && !ts.isElementAccessExpression(unwrapped)
    ) {
      return false;
    }
    const receiver = unwrapExpression(unwrapped.expression);
    return (
      ts.isIdentifier(receiver)
      && receiver.text === 'Object'
      && !context.resolveBinding('Object', receiver)
      && [
        'freeze',
        'isExtensible',
        'isFrozen',
        'isSealed',
        'preventExtensions',
        'seal',
      ].includes(staticPropertyName(unwrapped) ?? '')
    );
  };

  const executeEagerCallbacks = (
    node,
    policy,
    callStack,
  ) => {
    let resolvedAll = true;
    for (const index of policy.callbackIndexes) {
      const argument = node.arguments[index];
      if (!argument) continue;
      if (ts.isSpreadElement(argument)) {
        resolvedAll = false;
        continue;
      }
      const resolution = localCallableCandidates(argument);
      if (resolution.callables.length === 0 || resolution.opaque) {
        resolvedAll = false;
      }
      for (const callable of resolution.callables) {
        executeCallable(
          callable,
          [{ kind: 'opaque' }, { kind: 'opaque' }, { kind: 'opaque' }],
          callStack,
          node,
        );
      }
    }
    if (!policy.exact || !resolvedAll) {
      unresolvedEager(
        node,
        'production:eager-scheduled-callback-boundary',
      );
    }
  };

  const localAccessorCandidates = (expression, setter = false) => {
    if (
      !ts.isPropertyAccessExpression(expression)
      && !ts.isElementAccessExpression(expression)
    ) {
      return { accessors: [], resolved: false };
    }
    const names = staticPropertyNames(expression, context);
    if (names.length !== 1) return { accessors: [], resolved: false };
    const name = names[0];
    const projected = projectedPropertyExpressions(
      expression.expression,
      name,
      undefined,
      context,
    );
    const accessors = projected.filter(candidate =>
      setter
        ? ts.isSetAccessorDeclaration(candidate)
        : ts.isGetAccessorDeclaration(candidate));
    if (projected.length > 0) {
      return { accessors, resolved: true };
    }
    const receiver = unwrapExpression(expression.expression);
    let classLike = localClass(receiver);
    if (!classLike && ts.isIdentifier(receiver)) {
      const binding = context.resolveBinding(receiver.text, receiver);
      const values = binding
        ? bindingExpressionsAtUse(binding, receiver, context)
        : [];
      for (const value of values) {
        const unwrapped = unwrapExpression(value);
        if (ts.isNewExpression(unwrapped)) {
          classLike = localClass(unwrapped.expression);
          if (classLike) break;
        }
      }
    }
    if (!classLike) return { accessors: [], resolved: false };
    const classAccessors = classLike.members.filter(member =>
      member.name
      && propertyNameText(member.name) === name
      && (
        setter
          ? ts.isSetAccessorDeclaration(member)
          : ts.isGetAccessorDeclaration(member)
      ));
    return {
      accessors: classAccessors,
      resolved: classAccessors.length > 0,
    };
  };

  const executeDestructuringGetters = (
    pattern,
    sourceExpression,
    callStack,
    invocationNode,
  ) => {
    pattern.elements.forEach((element, index) => {
      if (ts.isOmittedExpression(element)) return;
      const property = ts.isObjectBindingPattern(pattern)
        ? propertyNameText(element.propertyName ?? element.name)
        : undefined;
      const projected = projectedPropertyExpressions(
        sourceExpression,
        property,
        ts.isArrayBindingPattern(pattern) ? index : undefined,
        context,
      );
      const getters = projected.filter(candidate =>
        ts.isGetAccessorDeclaration(candidate));
      for (const getter of getters) {
        executeCallable(getter, [], callStack, invocationNode);
      }
      if (
        projected.length === 0
        && argumentProfile(sourceExpression).kind === 'opaque'
      ) {
        unresolvedEager(
          invocationNode,
          'production:eager-destructuring-access-unresolved',
        );
      }
      if (
        !ts.isIdentifier(element.name)
        && projected.length === 1
        && !ts.isGetAccessorDeclaration(projected[0])
      ) {
        executeDestructuringGetters(
          element.name,
          projected[0],
          callStack,
          invocationNode,
        );
      }
    });
  };

  const decoratorsOf = node =>
    ts.canHaveDecorators(node)
      ? (ts.getDecorators(node) ?? [])
      : [];

  const executeDecorators = (decoratedNode, callStack, invocationFrame) => {
    for (const decorator of decoratorsOf(decoratedNode)) {
      visit(decorator.expression, callStack, invocationFrame);
      const event = beginEagerEvent(decorator, 'decorator');
      const { callsite } = event;
      if (ts.isCallExpression(unwrapExpression(decorator.expression))) {
        unresolvedEager(
          decorator,
          'production:eager-decorator-factory-result-unresolved',
          callsite,
        );
        accountEagerEvent(event, 'decorator-accounted');
        continue;
      }
      const imported = importedCallee(decorator.expression);
      const resolution = imported
        ? { callables: [], opaque: false }
        : localCallableCandidates(decorator.expression);
      if (
        imported
        && !imported.unsupportedMember
        && !imported.boundOpaque
      ) {
        importedCalls.push({
          node: decorator,
          callsite,
          invocationKind: 'call',
          argumentProfiles: [{ kind: 'defined' }],
          ...imported,
        });
      } else if (resolution.callables.length > 0) {
        for (const callable of resolution.callables) {
          executeCallable(
            callable,
            [{ kind: 'defined' }],
            callStack,
            decorator,
          );
        }
        if (resolution.opaque) {
          unresolvedEager(
            decorator,
            'production:eager-decorator-branch-unresolved',
            callsite,
          );
        }
      } else {
        unresolvedEager(
          decorator,
          'production:eager-decorator-application-unresolved',
          callsite,
        );
      }
      accountEagerEvent(event, 'decorator-accounted');
    }
  };

  const visit = (
    node,
    callStack = new Set(),
    invocationFrame = new Map(),
  ) => {
    scanBudget?.check('eager-module-analysis');
    if (ts.isFunctionLike(node)) return;
    if (
      ts.isIfStatement(node)
      && isInexactModuleMainGuard(node.expression)
    ) {
      unresolvedEager(
        node.expression,
        'production:eager-main-guard-unresolved',
      );
    }
    if (ts.isIfStatement(node) && isModuleMainGuard(node.expression)) {
      visit(node.expression, callStack, invocationFrame);
      if (node.elseStatement) {
        visit(node.elseStatement, callStack, invocationFrame);
      }
      return;
    }
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      && isModuleMainGuard(node.left)
    ) {
      visit(node.left, callStack, invocationFrame);
      return;
    }
    if (
      ts.isConditionalExpression(node)
      && isModuleMainGuard(node.condition)
    ) {
      visit(node.condition, callStack, invocationFrame);
      visit(node.whenFalse, callStack, invocationFrame);
      return;
    }
    if (
      ts.isVariableDeclaration(node)
      && !ts.isIdentifier(node.name)
      && node.initializer
    ) {
      visit(node.initializer, callStack, invocationFrame);
      executeDestructuringGetters(
        node.name,
        node.initializer,
        callStack,
        node,
      );
      visitBindingDefaults(
        node.name,
        argumentProfile(node.initializer),
        callStack,
        invocationFrame,
        node,
      );
      return;
    }
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      executeDecorators(node, callStack, invocationFrame);
      for (const heritage of node.heritageClauses ?? []) {
        for (const type of heritage.types) {
          visit(type.expression, callStack, invocationFrame);
        }
      }
      for (const member of node.members) {
        executeDecorators(member, callStack, invocationFrame);
        for (const parameter of member.parameters ?? []) {
          executeDecorators(parameter, callStack, invocationFrame);
        }
        if (member.name && ts.isComputedPropertyName(member.name)) {
          visit(member.name.expression, callStack, invocationFrame);
        }
        if (ts.isClassStaticBlockDeclaration(member)) {
          visit(member.body, callStack, invocationFrame);
        } else if (
          ts.isPropertyDeclaration(member)
          && hasSyntaxModifier(member, ts.SyntaxKind.StaticKeyword)
          && member.initializer
        ) {
          visit(member.initializer, callStack, invocationFrame);
        }
      }
      return;
    }
    if (
      ts.isPropertyAccessExpression(node)
      || ts.isElementAccessExpression(node)
    ) {
      const event = beginEagerEvent(node, 'property');
      const assignment = ts.isBinaryExpression(node.parent)
        && node.parent.left === node
        && node.parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
        && node.parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        ? node.parent
        : undefined;
      const setter = Boolean(assignment);
      const accessorResolution = localAccessorCandidates(node, setter);
      for (const accessor of accessorResolution.accessors) {
        executeCallable(
          accessor,
          assignment ? [argumentProfile(assignment.right)] : [],
          callStack,
          node,
        );
      }
      const receiver = unwrapExpression(node.expression);
      const ambientReceiver = ts.isIdentifier(receiver)
        && [
          'Array',
          'BigInt',
          'Boolean',
          'Date',
          'Error',
          'JSON',
          'Math',
          'Number',
          'Object',
          'Promise',
          'Reflect',
          'RegExp',
          'String',
          'console',
          'module',
          'process',
        ].includes(receiver.text)
        && !context.resolveBinding(receiver.text, receiver);
      const importMeta = ts.isMetaProperty(receiver);
      const resolvedCapability = Boolean(
        trustedFunction(node, context)
        || trustedNamespace(node, context)
        || importedCallee(node)
      );
      if (
        !accessorResolution.resolved
        && !ambientReceiver
        && !importMeta
        && !resolvedCapability
        && !ts.isLiteralExpression(receiver)
        && !ts.isArrayLiteralExpression(receiver)
        && !ts.isObjectLiteralExpression(receiver)
      ) {
        unresolvedEager(
          node,
          setter
            ? 'production:eager-property-set-unresolved'
            : 'production:eager-property-read-unresolved',
        );
      }
      accountEagerEvent(event, 'property-accounted');
    }
    if (ts.isTaggedTemplateExpression(node)) {
      const event = beginEagerEvent(node, 'tag');
      const { callsite } = event;
      const profiles = [
        { kind: 'defined' },
        ...(
          ts.isTemplateExpression(node.template)
            ? node.template.templateSpans.map(span =>
              argumentProfile(span.expression))
            : []
        ),
      ];
      const imported = importedCallee(node.tag);
      const resolution = imported
        ? { callables: [], opaque: false }
        : localCallableCandidates(node.tag);
      if (imported?.unsupportedMember || imported?.boundOpaque) {
        unresolvedEager(
          node,
          'production:eager-imported-tag-unresolved',
          callsite,
        );
      } else if (imported) {
        importedCalls.push({
          node,
          callsite,
          invocationKind: 'call',
          argumentProfiles: profiles,
          ...imported,
        });
      } else if (resolution.callables.length > 0) {
        for (const callable of resolution.callables) {
          executeCallable(callable, profiles, callStack, node);
        }
        if (resolution.opaque) {
          unresolvedEager(
            node,
            'production:eager-tag-branch-unresolved',
            callsite,
          );
        }
      } else {
        unresolvedEager(
          node,
          'production:eager-tag-unresolved',
          callsite,
        );
      }
      accountEagerEvent(event, 'tag-accounted');
    }
    if (ts.isCallExpression(node)) {
      const event = beginEagerEvent(node, 'call');
      const { callsite } = event;
      const invocation = normalizedFunctionInvocation(node, context);
      if (
        (
          invocation?.trusted
          && (
            (
              invocation.trusted.module === 'fs'
              || invocation.trusted.module === 'unknown-builtin'
            )
            && WRITE_SINKS.has(invocation.trusted.name)
          )
        )
        || (
          (
            ts.isPropertyAccessExpression(node.expression)
            || ts.isElementAccessExpression(node.expression)
          )
          && SPAWN_METHODS.has(staticPropertyName(node.expression) ?? '')
        )
      ) {
        writerCandidateCallsites.add(callsite);
      }
      if (invocation?.trusted?.module === 'child_process') {
        childCandidateCallsites.add(callsite);
      }
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const specifier = literalText(node.arguments[0]);
        if (specifier) {
          eagerLoads.push({ node, callsite, specifier, kind: 'dynamic-import' });
        } else {
          unresolvedLoads.push({ node, callsite, kind: 'dynamic-import' });
        }
      } else if (trustedBuiltinLoader(node.expression, context)) {
        const specifier = literalText(node.arguments[0]);
        if (specifier) {
          eagerLoads.push({ node, callsite, specifier, kind: 'commonjs-require' });
        } else {
          unresolvedLoads.push({ node, callsite, kind: 'commonjs-require' });
        }
      }

      const profiles = invocationProfiles(node);
      const imported = importedCallee(node.expression);
      const callableResolution = imported
        ? { callables: [], opaque: false }
        : localCallableCandidates(node.expression);
      let accounted = Boolean(
        invocation?.trusted
        || node.expression.kind === ts.SyntaxKind.ImportKeyword
        || trustedBuiltinLoader(node.expression, context)
        || isProvenSafeEagerCall(node.expression)
      );
      const callbackPolicy = eagerCallbackPolicy(node.expression);
      if (callbackPolicy) {
        executeEagerCallbacks(node, callbackPolicy, callStack);
        accounted = true;
      } else if (imported?.unsupportedMember || imported?.boundOpaque) {
        unresolvedEager(
          node,
          imported.unsupportedMember
            ? 'production:eager-imported-member-call-unresolved'
            : 'production:eager-imported-bound-call-unresolved',
          callsite,
        );
        accounted = true;
      } else if (imported) {
        importedCalls.push({
          node,
          callsite,
          invocationKind: 'call',
          argumentProfiles: profiles,
          ...imported,
        });
        accounted = true;
      } else if (callableResolution.callables.length > 0) {
        for (const callable of callableResolution.callables) {
          executeCallable(
            callable,
            profiles,
            callStack,
            node,
          );
        }
        accounted = true;
        if (callableResolution.opaque) {
          unresolvedEager(
            node,
            'production:eager-call-branch-unresolved',
            callsite,
          );
        }
      }

      if (
        !invocation?.trusted
        && node.arguments.some(argument => {
          const capability = trustedCapability(argument, context);
          return capability?.module === 'fs'
            || capability?.module === 'child_process'
            || capability?.module === 'unknown-builtin';
        })
      ) {
        unresolvedAuthorityCalls.push({ node, callsite });
      }
      const parameterBinding = ts.isIdentifier(node.expression)
        ? context.resolveBinding(node.expression.text, node.expression)
        : undefined;
      if (
        !accounted
        && parameterBinding
        && invocationFrame.has(parameterBinding.id)
      ) {
        const profile = invocationFrame.get(parameterBinding.id);
        if (
          profile.kind === 'callable'
          || profile.kind === 'opaque'
          || profile.kind === 'spread'
          || profile.kind === 'union'
        ) {
          unresolvedEager(
            node,
            'production:eager-callback-invocation-unresolved',
            callsite,
          );
        }
        accounted = true;
      }
      if (
        !accounted
        && node.expression.kind === ts.SyntaxKind.SuperKeyword
      ) {
        accounted = true;
      }
      if (
        !accounted
        && profiles.some(profile =>
          profile.kind === 'callable'
          || (
            profile.kind === 'union'
            && profile.options.some(option => option.kind === 'callable')
          ))
      ) {
        unresolvedEager(
          node,
          'production:eager-hof-callback-unresolved',
          callsite,
        );
        accounted = true;
      }
      if (!accounted) {
        unresolvedEager(
          node,
          ts.isCallExpression(unwrapExpression(node.expression))
            ? 'production:eager-returned-callable-unresolved'
            : 'production:eager-call-unresolved',
          callsite,
        );
      }
      accountEagerEvent(event, 'call-accounted');
    } else if (ts.isNewExpression(node)) {
      const event = beginEagerEvent(node, 'construct');
      const { callsite } = event;
      const trusted = trustedFunction(node.expression, context);
      const name = calleeName(node.expression);
      if (
        (trusted?.module === 'fs' && trusted.name === 'WriteStream')
        || (name && /(?:Database|MemoryStore|Sqlite)/i.test(name))
      ) {
        writerCandidateCallsites.add(callsite);
      }
      const profiles = invocationProfiles(node);
      const imported = importedCallee(node.expression);
      const ambientPromise = ts.isIdentifier(node.expression)
        && node.expression.text === 'Promise'
        && !context.resolveBinding('Promise', node.expression);
      if (imported?.unsupportedMember || imported?.boundOpaque) {
        unresolvedEager(
          node,
          imported.unsupportedMember
            ? 'production:eager-imported-member-construction-unresolved'
            : 'production:eager-imported-bound-construction-unresolved',
          callsite,
        );
      } else if (imported) {
        importedCalls.push({
          node,
          callsite,
          invocationKind: 'construct',
          argumentProfiles: profiles,
          ...imported,
        });
      } else if (ambientPromise) {
        const executor = node.arguments?.[0];
        const resolution = executor && !ts.isSpreadElement(executor)
          ? localCallableCandidates(executor)
          : { callables: [], opaque: true };
        for (const callable of resolution.callables) {
          executeCallable(
            callable,
            [{ kind: 'opaque' }, { kind: 'opaque' }],
            callStack,
            node,
          );
        }
        if (resolution.callables.length === 0 || resolution.opaque) {
          unresolvedEager(
            node,
            'production:eager-promise-executor-unresolved',
            callsite,
          );
        }
      } else {
        const classLike = localClass(node.expression);
        if (classLike) {
          executeClassConstruction(
            classLike,
            profiles,
            callStack,
            node,
          );
        } else if (!trusted) {
          unresolvedEager(
            node,
            'production:eager-construction-unresolved',
            callsite,
          );
        }
      }
      if (
        node.arguments?.some(argument => {
          const capability = trustedCapability(argument, context);
          return capability?.module === 'fs'
            || capability?.module === 'child_process'
            || capability?.module === 'unknown-builtin';
        })
      ) {
        unresolvedAuthorityCalls.push({ node, callsite });
      }
      accountEagerEvent(event, 'construct-accounted');
    }
    node.forEachChild(child => visit(child, callStack, invocationFrame));
  };

  const executeModule = () => {
    for (const statement of sourceFile.statements) visit(statement);
  };
  const executeExport = (
    exportName,
    invocationKind = 'call',
    argumentProfiles = [],
  ) => {
    const exported = localExports.get(exportName);
    if (!exported) {
      return {
        executed: false,
        reExport: reExports.get(exportName),
        starReExports: [...starReExports],
      };
    }
    const classLike = localClass(exported);
    if (classLike) {
      if (invocationKind !== 'construct') return { executed: false };
      executeClassConstruction(
        classLike,
        argumentProfiles,
        new Set(),
        exported,
      );
      return { executed: true };
    }
    const callableResolution = localCallableCandidates(exported);
    if (callableResolution.callables.length === 0) return { executed: false };
    for (const callable of callableResolution.callables) {
      const key = callable.getStart(sourceFile);
      if (executedCallables.has(key)) continue;
      executedCallables.add(key);
      executeCallable(
        callable,
        argumentProfiles,
        new Set(),
        exported,
      );
    }
    if (callableResolution.opaque) {
      unresolvedEager(
        exported,
        'production:eager-export-call-branch-unresolved',
      );
    }
    return { executed: true };
  };
  const drainEvents = () => {
    for (const event of eagerEventAccounting.values()) {
      if (!event.outcome) {
        throw new Error(
          '[E_HERMETIC_EAGER_ACCOUNTING]'
          + ` unaccounted ${event.kind}:${event.callsite}`,
        );
      }
    }
    const events = {
      importedCalls: importedCalls.slice(importedCallCursor),
      eagerLoads: eagerLoads.slice(eagerLoadCursor),
      unresolvedLoads: unresolvedLoads.slice(unresolvedLoadCursor),
      unresolvedAuthorityCalls:
        unresolvedAuthorityCalls.slice(unresolvedAuthorityCursor),
      unresolvedEagerEvents:
        unresolvedEagerEvents.slice(unresolvedEagerEventCursor),
    };
    importedCallCursor = importedCalls.length;
    eagerLoadCursor = eagerLoads.length;
    unresolvedLoadCursor = unresolvedLoads.length;
    unresolvedAuthorityCursor = unresolvedAuthorityCalls.length;
    unresolvedEagerEventCursor = unresolvedEagerEvents.length;
    return events;
  };

  return {
    sourceFile,
    callsites,
    writerCandidateCallsites,
    childCandidateCallsites,
    executeModule,
    executeExport,
    drainEvents,
  };
}

function summarizeEagerPlan(plan, outcome) {
  const sourceFile = plan.sourceFile;
  const events = plan.drainEvents();
  const location = event => ({
    line: lineFor(sourceFile, event.node),
    position: event.node.getStart(sourceFile),
    callsite: event.callsite,
  });
  return {
    callsites: [...plan.callsites],
    writerCandidateCallsites: [...plan.writerCandidateCallsites],
    childCandidateCallsites: [...plan.childCandidateCallsites],
    events: {
      eagerLoads: events.eagerLoads.map(event => ({
        ...location(event),
        specifier: event.specifier,
        kind: event.kind,
      })),
      unresolvedLoads: events.unresolvedLoads.map(event => ({
        ...location(event),
        kind: event.kind,
      })),
      unresolvedAuthorityCalls: events.unresolvedAuthorityCalls.map(event =>
        location(event)),
      unresolvedEagerEvents: events.unresolvedEagerEvents.map(event => ({
        ...location(event),
        effect: event.effect,
      })),
      importedCalls: events.importedCalls.map(event => ({
        ...location(event),
        specifier: event.specifier,
        exportName: event.exportName,
        invocationKind: event.invocationKind,
        argumentProfiles: event.argumentProfiles ?? [],
      })),
    },
    outcome: outcome
      ? {
        executed: outcome.executed,
        reExport: outcome.reExport,
        starReExports: outcome.starReExports,
      }
      : undefined,
  };
}

function collectProductionGraph(
  roots,
  rootDir,
  realRoot,
  isKnownExternal,
  scanBudget,
) {
  const records = new Map();
  const queuedModules = new Set();
  const executedExports = new Set();
  const exportReplanCounts = new Map();
  const work = [];
  const unresolvedEdges = [];
  let workIndex = 0;
  let edgeCount = 0;

  const enqueueModule = (file, depth = 0) => {
    if (records.has(file) || queuedModules.has(file)) return;
    queuedModules.add(file);
    work.push({ kind: 'module', file, depth });
  };
  for (const root of roots) enqueueModule(root.target, 0);

  const addUnresolved = ({
    file,
    specifier,
    line,
    position,
    effect,
    callsite,
  }) => {
    unresolvedEdges.push({
      file,
      specifier,
      line,
      position,
      effect,
      callsite,
    });
  };
  const completeStarBranch = (group, canonicalBinding) => {
    if (canonicalBinding) group.resolvedBindings.add(canonicalBinding);
    group.pending -= 1;
    if (group.pending !== 0 || group.reported) return;
    group.reported = true;
    if (group.resolvedBindings.size === 1) return;
    addUnresolved({
      ...group.origin,
      specifier: `${group.origin.specifier}#${group.exportName}`,
      effect: group.resolvedBindings.size === 0
        ? 'production:eager-imported-call-unresolved-export'
        : 'production:eager-ambiguous-star-export',
    });
  };

  const resolveGraphEdge = (record, event, depth, effect) => {
    edgeCount += 1;
    if (edgeCount > MAX_TEST_SURFACE_EDGES) {
      throw new Error(
        '[E_HERMETIC_GRAPH_BUDGET] production edge budget exceeded'
        + ` (${MAX_TEST_SURFACE_EDGES})`,
      );
    }
    const imported = resolveLocalSupportImport(
      record.file,
      event.specifier,
      realRoot,
    );
    if (imported) {
      record.outgoing.add(normalizeRelative(relative(realRoot, imported)));
      enqueueModule(imported, depth + 1);
      return imported;
    }
    if (isKnownExternal(event.specifier, record.file)) {
      record.outgoing.add(`external:${event.specifier}`);
      return undefined;
    }
    record.outgoing.add(`unresolved:${event.specifier}`);
    addUnresolved({
      file: record.file,
      specifier: event.specifier,
      line: event.line,
      position: event.position,
      effect,
      callsite: event.callsite,
    });
    return undefined;
  };

  const absorbPlanSummary = (record, summary) => {
    for (const callsite of summary.callsites) record.callsites.add(callsite);
    for (const callsite of summary.writerCandidateCallsites) {
      record.writerCandidateCallsites.add(callsite);
    }
    for (const callsite of summary.childCandidateCallsites) {
      record.childCandidateCallsites.add(callsite);
    }
  };

  const enqueuePlanEvents = (record, summary, depth) => {
    const { events } = summary;
    for (const load of events.eagerLoads) {
      resolveGraphEdge(
        record,
        load,
        depth,
        `production:eager-${load.kind}-unresolved`,
      );
    }
    for (const load of events.unresolvedLoads) {
      addUnresolved({
        file: record.file,
        specifier: `<dynamic:${load.kind}>`,
        line: load.line,
        position: load.position,
        effect: `production:eager-${load.kind}-expression`,
        callsite: load.callsite,
      });
    }
    for (const call of events.unresolvedAuthorityCalls) {
      addUnresolved({
        file: record.file,
        specifier: '<opaque-authority-call>',
        line: call.line,
        position: call.position,
        effect: 'production:eager-opaque-authority-injection',
        callsite: call.callsite,
      });
    }
    for (const event of events.unresolvedEagerEvents) {
      addUnresolved({
        file: record.file,
        specifier: '<eager-runtime-event>',
        line: event.line,
        position: event.position,
        effect: event.effect,
        callsite: event.callsite,
      });
    }
    for (const importedCall of events.importedCalls) {
      const target = resolveGraphEdge(
        record,
        importedCall,
        depth,
        'production:eager-imported-call-unresolved-module',
      );
      if (!target) continue;
      work.push({
        kind: 'export-call',
        file: target,
        exportName: importedCall.exportName ?? 'default',
        invocationKind: importedCall.invocationKind,
        argumentProfiles: importedCall.argumentProfiles ?? [],
        origin: {
          file: record.file,
          specifier: importedCall.specifier,
          line: importedCall.line,
          position: importedCall.position,
          callsite: importedCall.callsite,
        },
        depth: depth + 1,
      });
    }
  };

  while (workIndex < work.length) {
    scanBudget.check('production-graph', true);
    const task = work[workIndex];
    workIndex += 1;
    if (task.depth > MAX_TEST_SURFACE_DEPTH) {
      throw new Error(
        '[E_HERMETIC_GRAPH_BUDGET] production graph depth budget exceeded'
        + ` (${MAX_TEST_SURFACE_DEPTH})`,
      );
    }
    if (task.kind === 'module') {
      if (records.has(task.file)) continue;
      if (records.size >= MAX_TEST_SURFACE_FILES) {
        throw new Error(
          '[E_HERMETIC_GRAPH_BUDGET] production module budget exceeded'
          + ` (${MAX_TEST_SURFACE_FILES})`,
        );
      }
      const sourceContent = canonicalSourceText(readFileSync(task.file, 'utf-8'));
      const content = canonicalProductionInventoryContent(
        task.file,
        sourceContent,
      );
      const contentDigest =
        `${content.length}:${policyDigest(content)}`;
      const summaryKey = `module\0${task.file}\0${contentDigest}`;
      let summary = EAGER_SUMMARY_CACHE.get(summaryKey);
      let parsed;
      if (!summary) {
        const plan = createEagerModulePlan(
          content,
          task.file,
          normalizeRelative(relative(rootDir, task.file)),
          scanBudget,
        );
        plan.executeModule();
        parsed = staticModuleSpecifiers(
          content,
          task.file,
          plan.sourceFile,
          scanBudget,
        );
        summary = summarizeEagerPlan(plan);
        cacheEagerSummary(summaryKey, summary);
      } else {
        parsed = staticModuleSpecifiers(
          content,
          task.file,
          undefined,
          scanBudget,
        );
      }
      const record = {
        file: task.file,
        content,
        contentDigest,
        parsed,
        outgoing: new Set(),
        callsites: new Set(),
        writerCandidateCallsites: new Set(),
        childCandidateCallsites: new Set(),
      };
      records.set(task.file, record);
      for (const edge of parsed.edges.filter(edge => edge.kind === 'static')) {
        resolveGraphEdge(
          record,
          edge,
          task.depth,
          'production:unresolved-static-import',
        );
      }
      absorbPlanSummary(record, summary);
      enqueuePlanEvents(record, summary, task.depth);
      continue;
    }

    const record = records.get(task.file);
    if (!record) {
      enqueueModule(task.file, task.depth);
      work.push(task);
      continue;
    }
    const invocationProfileKey = policyDigest(
      JSON.stringify(task.argumentProfiles ?? []),
    );
    const exportKey =
      `${task.file}\0${record.contentDigest}\0${task.exportName}`
      + `\0${task.invocationKind ?? 'call'}\0${invocationProfileKey}`;
    if (task.starGroup) {
      const starVisitKey = `${task.file}\0${task.exportName}`
        + `\0${task.invocationKind ?? 'call'}\0${invocationProfileKey}`;
      if (task.starGroup.visited.has(starVisitKey)) {
        completeStarBranch(task.starGroup);
        continue;
      }
      task.starGroup.visited.add(starVisitKey);
    } else {
      if (executedExports.has(exportKey)) continue;
      executedExports.add(exportKey);
    }
    const summaryKey = `export\0${exportKey}`;
    let summary = EAGER_SUMMARY_CACHE.get(summaryKey);
    if (!summary) {
      const replanCount = (exportReplanCounts.get(record.file) ?? 0) + 1;
      exportReplanCounts.set(record.file, replanCount);
      if (replanCount > MAX_EAGER_EXPORT_REPLANS_PER_MODULE) {
        addUnresolved({
          ...task.origin,
          specifier: `${task.origin.specifier}#${task.exportName}`,
          effect: 'production:eager-export-analysis-budget',
        });
        continue;
      }
      const plan = createEagerModulePlan(
        record.content,
        record.file,
        normalizeRelative(relative(rootDir, record.file)),
        scanBudget,
      );
      const outcome = plan.executeExport(
        task.exportName,
        task.invocationKind ?? 'call',
        task.argumentProfiles ?? [],
      );
      summary = summarizeEagerPlan(plan, outcome);
      cacheEagerSummary(summaryKey, summary);
    }
    const outcome = summary.outcome;
    absorbPlanSummary(record, summary);
    if (outcome.executed) {
      enqueuePlanEvents(record, summary, task.depth);
      if (task.starGroup) {
        completeStarBranch(
          task.starGroup,
          `${task.file}#${task.exportName}`,
        );
      }
      continue;
    }
    if (outcome.reExport) {
      const target = resolveGraphEdge(
        record,
        {
          ...outcome.reExport,
          line: task.origin.line,
          position: task.origin.position,
          callsite: task.origin.callsite,
        },
        task.depth,
        'production:eager-reexport-unresolved-module',
      );
      if (target) {
        work.push({
          ...task,
          file: target,
          exportName: outcome.reExport.exportName,
          depth: task.depth + 1,
        });
      } else if (task.starGroup) {
        completeStarBranch(task.starGroup);
      }
      continue;
    }
    if (outcome.starReExports?.length > 0) {
      const targets = [];
      for (const specifier of outcome.starReExports) {
        const target = resolveGraphEdge(
          record,
          {
            specifier,
            line: task.origin.line,
            position: task.origin.position,
            callsite: task.origin.callsite,
          },
          task.depth,
          'production:eager-star-reexport-unresolved-module',
        );
        if (target) {
          targets.push({
            ...task,
            file: target,
            depth: task.depth + 1,
          });
        }
      }
      if (task.starGroup) {
        if (targets.length === 0) {
          completeStarBranch(task.starGroup);
        } else {
          task.starGroup.pending += targets.length - 1;
        }
      } else if (targets.length > 0) {
        const starGroup = {
          pending: targets.length,
          resolvedBindings: new Set(),
          visited: new Set(),
          reported: false,
          origin: task.origin,
          exportName: task.exportName,
        };
        for (const targetTask of targets) targetTask.starGroup = starGroup;
      } else {
        addUnresolved({
          ...task.origin,
          specifier: `${task.origin.specifier}#${task.exportName}`,
          effect: 'production:eager-imported-call-unresolved-export',
        });
      }
      work.push(...targets);
      continue;
    }
    if (task.starGroup) {
      completeStarBranch(task.starGroup);
    } else {
      addUnresolved({
        ...task.origin,
        specifier: `${task.origin.specifier}#${task.exportName}`,
        effect: 'production:eager-imported-call-unresolved-export',
      });
    }
  }

  return {
    records: [...records.values()]
      .sort((left, right) => left.file.localeCompare(right.file)),
    unresolvedEdges,
  };
}

function vitestSetupEntrypoints(rootDir, realRoot, scanBudget) {
  scanBudget.check('vitest-config-discovery', true);
  const configs = readdirSync(rootDir)
    .filter(name => /^vitest(?:\.[^.]+)*\.config\.(?:[cm]?[jt]s)$/.test(name))
    .sort();
  const setupFiles = [];
  const queue = configs.map(configName => realpathSync(join(rootDir, configName)));
  const seenConfigs = new Set();
  while (queue.length > 0) {
    scanBudget.check('vitest-config-graph', true);
    const configPath = queue.shift();
    if (seenConfigs.has(configPath)) continue;
    seenConfigs.add(configPath);
    const content = canonicalSourceText(readFileSync(configPath, 'utf-8'));
    const sourceFile = ts.createSourceFile(
      configPath,
      content,
      ts.ScriptTarget.Latest,
      true,
      sourceKind(configPath),
    );
    const analysisContext = createAnalysisContext(sourceFile, scanBudget);
    const visit = node => {
      scanBudget.check('vitest-config-analysis');
      if (
        ts.isPropertyAssignment(node)
        && ['setupFiles', 'globalSetup'].includes(propertyNameText(node.name))
      ) {
        const collectStrings = (value, bindingStack = new Set()) => {
          const unwrapped = unwrapExpression(value);
          if (ts.isStringLiteralLike(unwrapped)) {
            const normalized = unwrapped.text.replace('<rootDir>', rootDir);
            const resolved = resolveLocalSupportImport(
              configPath,
              normalized.startsWith('.') ? normalized : `./${normalized}`,
              realRoot,
            );
            if (resolved) setupFiles.push(resolved);
            return;
          }
          if (ts.isIdentifier(unwrapped)) {
            const binding = analysisContext.resolveBinding(unwrapped.text, unwrapped);
            if (!binding || bindingStack.has(binding.id)) return;
            const nextStack = new Set(bindingStack);
            nextStack.add(binding.id);
            for (const candidate of bindingExpressionsAtUse(
              binding,
              unwrapped,
              analysisContext,
            )) {
              collectStrings(candidate, nextStack);
            }
            return;
          }
          unwrapped.forEachChild(child => collectStrings(child, bindingStack));
        };
        collectStrings(node.initializer);
        return;
      }
      node.forEachChild(visit);
    };
    sourceFile.forEachChild(visit);
    for (const edge of staticModuleSpecifiers(
      content,
      configPath,
      sourceFile,
      scanBudget,
    ).edges) {
      const imported = resolveLocalSupportImport(
        configPath,
        edge.specifier,
        realRoot,
      );
      if (imported && !seenConfigs.has(imported)) queue.push(imported);
    }
  }
  return [...new Set(setupFiles)];
}

function collectTestSurface(testsDir, rootDir, scanBudget) {
  const realRoot = realpathSync(rootDir);
  const realTestsDir = realpathSync(testsDir);
  const setupEntrypoints = vitestSetupEntrypoints(rootDir, realRoot, scanBudget);
  const setupSet = new Set(setupEntrypoints);
  const entrypoints = [...collectFiles(testsDir, [], scanBudget), ...setupEntrypoints]
    .map(file => realpathSync(file));
  const queue = [...new Set(entrypoints)]
    .sort()
    .map(file => ({ file, depth: 0 }));
  let queueIndex = 0;
  let edgeCount = 0;
  let nodeCount = 0;
  let nextProgressAt = 500;
  const seen = new Set();
  const files = [];
  const unresolvedEdges = [];
  const productionDependencies = new Map();
  const rootManifestPath = join(rootDir, 'package.json');
  const rootManifestOutcome = readPackageManifest(rootManifestPath);
  const rootManifest = rootManifestOutcome.manifest;
  if (rootManifestOutcome.status === 'malformed') {
    unresolvedEdges.push({
      file: rootManifestPath,
      specifier: 'package.json',
      line: 1,
      position: 0,
      effect: 'test-support:unresolved-manifest',
    });
  }
  const externalPackages = new Set(Object.keys({
    ...(rootManifest.dependencies ?? {}),
    ...(rootManifest.devDependencies ?? {}),
    ...(rootManifest.optionalDependencies ?? {}),
    ...(rootManifest.peerDependencies ?? {}),
  }));
  const manifestDependencyCache = new Map();
  const malformedManifests = new Set();
  const dependenciesForFile = fromFile => {
    let directory = dirname(fromFile);
    while (true) {
      const manifestPath = join(directory, 'package.json');
      if (manifestPath !== rootManifestPath && existsSync(manifestPath)) {
        let outcome = manifestDependencyCache.get(manifestPath);
        if (!outcome) {
          outcome = readPackageManifest(manifestPath);
          manifestDependencyCache.set(manifestPath, outcome);
        }
        if (
          outcome.status === 'malformed'
          && !malformedManifests.has(manifestPath)
        ) {
          malformedManifests.add(manifestPath);
          unresolvedEdges.push({
            file: manifestPath,
            specifier: 'package.json',
            line: 1,
            position: 0,
            effect: 'test-support:unresolved-manifest',
          });
        }
        if (outcome.status === 'valid') {
          return new Set([
            ...externalPackages,
            ...Object.keys({
              ...(outcome.manifest.dependencies ?? {}),
              ...(outcome.manifest.devDependencies ?? {}),
              ...(outcome.manifest.optionalDependencies ?? {}),
              ...(outcome.manifest.peerDependencies ?? {}),
            }),
          ]);
        }
      }
      if (directory === realRoot) break;
      const parent = dirname(directory);
      if (parent === directory || !isWithinRealRoot(parent, realRoot)) break;
      directory = parent;
    }
    return externalPackages;
  };
  const isKnownExternal = (specifier, fromFile = rootManifestPath) => {
    if (
      NODE_BUILTIN_MODULES.has(specifier)
      || specifier.startsWith('node:')
      || normalizeBuiltinModule(specifier)
    ) {
      return true;
    }
    const packageName = specifier.startsWith('@')
      ? specifier.split('/').slice(0, 2).join('/')
      : specifier.split('/')[0];
    return dependenciesForFile(fromFile).has(packageName);
  };
  const dedicatedTestTree = realTestsDir.split(sep).at(-1) === 'tests';
  const isSupportFile = file => {
    if (setupSet.has(file)) return true;
    const relativeToTests = relative(realTestsDir, file);
    const insideTests = relativeToTests === ''
      || (
        relativeToTests !== '..'
        && !relativeToTests.startsWith(`..${sep}`)
        && !relativeToTests.startsWith(sep)
      );
    if (dedicatedTestTree && insideTests) return true;
    const normalized = normalizeRelative(relative(realRoot, file));
    return /(?:^|\/)(?:__tests__|fixtures?|mocks?|test(?:s|-helpers?|-utils?))(?:\/|$)/i
      .test(normalized)
      || /(?:^|[.-])(?:fixture|helper|mock|setup|support|test-util)s?\.[cm]?[jt]sx?$/i
        .test(file.split(sep).at(-1) ?? '');
  };
  while (queueIndex < queue.length) {
    scanBudget.check('test-support-graph', true);
    const { file, depth } = queue[queueIndex];
    queueIndex += 1;
    if (seen.has(file)) continue;
    if (seen.size >= MAX_TEST_SURFACE_FILES) {
      throw new Error(
        '[E_HERMETIC_GRAPH_BUDGET] test-support file budget exceeded'
        + ` (${MAX_TEST_SURFACE_FILES})`,
      );
    }
    if (depth > MAX_TEST_SURFACE_DEPTH) {
      throw new Error(
        '[E_HERMETIC_GRAPH_BUDGET] test-support depth budget exceeded'
        + ` (${MAX_TEST_SURFACE_DEPTH})`,
      );
    }
    seen.add(file);
    files.push(file);
    const progressElapsedMs = seen.size >= nextProgressAt
      ? scanBudget.elapsedMs()
      : 0;
    if (
      seen.size >= nextProgressAt
      && progressElapsedMs >= 3000
      && process.argv[1]
      && fileURLToPath(import.meta.url) === resolve(process.argv[1])
    ) {
      process.stderr.write(
        `[hermetic-lint] PROGRESS graph files=${seen.size}`
        + ` edges=${edgeCount} depth=${depth}`
        + ` elapsedMs=${Math.round(progressElapsedMs)}\n`,
      );
      nextProgressAt += 500;
    }
    const imports = [];
    const parsed = staticModuleSpecifiers(
      readFileSync(file, 'utf-8'),
      file,
      undefined,
      scanBudget,
    );
    nodeCount += parsed.nodeCount;
    if (nodeCount > MAX_TEST_SURFACE_NODES) {
      throw new Error(
        '[E_HERMETIC_GRAPH_BUDGET] test-support AST node budget exceeded'
        + ` (${MAX_TEST_SURFACE_NODES})`,
      );
    }
    for (const edge of parsed.edges) {
      edgeCount += 1;
      if (edgeCount > MAX_TEST_SURFACE_EDGES) {
        throw new Error(
          '[E_HERMETIC_GRAPH_BUDGET] test-support edge budget exceeded'
          + ` (${MAX_TEST_SURFACE_EDGES})`,
        );
      }
      const imported = resolveLocalSupportImport(file, edge.specifier, realRoot);
      if (imported && isSupportFile(imported)) {
        if (!seen.has(imported)) imports.push({ file: imported, depth: depth + 1 });
      } else if (imported) {
        if (!productionDependencies.has(imported)) {
          productionDependencies.set(imported, {
            importer: file,
            target: imported,
            ...edge,
          });
        }
      } else if (
        edge.specifier.startsWith('.')
        || edge.specifier.startsWith('#')
        || edge.specifier.startsWith('@/')
        || edge.specifier.startsWith('~/')
        || !isKnownExternal(edge.specifier, file)
      ) {
        unresolvedEdges.push({
          file,
          ...edge,
          effect: edge.expectedMissing
            ? 'test-support:expected-missing-import'
            : undefined,
          classification: edge.expectedMissing
            ? 'expected-missing'
            : undefined,
        });
      }
    }
    imports.sort((left, right) => left.file.localeCompare(right.file));
    queue.push(...imports);
  }
  const productionGraph = collectProductionGraph(
    [...productionDependencies.values()],
    rootDir,
    realRoot,
    isKnownExternal,
    scanBudget,
  );
  for (const edge of productionGraph.unresolvedEdges) {
    unresolvedEdges.push(edge);
  }
  return {
    files,
    unresolvedEdges,
    productionRecords: productionGraph.records,
  };
}

export function scanTestDir(
  testsDir,
  allowlist = ALLOWLIST,
  rootDir = REPO_ROOT,
  scanState,
  scanBudget = createScanBudget(),
) {
  // Import existence is mutable between exported scanTestDir invocations
  // (watch mode, generated fixtures, workspace package changes). Keep the
  // resolver cache scan-local so a previously missing or present edge cannot
  // survive into a later scan.
  LOCAL_SUPPORT_IMPORT_CACHE.clear();
  const surface = collectTestSurface(testsDir, rootDir, scanBudget);
  const allFiles = scanState
    ? surface.files.filter(file => {
      if (scanState.seenFiles.has(file)) return false;
      scanState.seenFiles.add(file);
      return true;
    })
    : surface.files;
  const violations = [];
  const registry = surface.unresolvedEdges.filter(edge => {
    if (!scanState) return true;
    const key = `${edge.file}\0${edge.position}\0${edge.specifier}`;
    if (scanState.seenEdges.has(key)) return false;
    scanState.seenEdges.add(key);
    return true;
  }).map(edge => {
    const relativePath = normalizeRelative(relative(rootDir, edge.file));
    return {
      file: relativePath,
      line: edge.line,
      effect: edge.effect ?? 'test-support:unresolved-import',
      targetProvenance: edge.classification === 'expected-missing'
        ? 'expected-missing'
        : 'unknown',
      classification: edge.classification ?? 'unresolved',
      specifier: edge.specifier,
      callsite: edge.callsite ?? createCallsiteHash(
        relativePath,
        edge.specifier,
        edge.position,
      ),
    };
  });
  const seenInventory = scanState?.seenProductionInventory ?? new Set();
  const seenEffects = scanState?.seenProductionEffects ?? new Set();
  for (const record of surface.productionRecords) {
    scanBudget.check('production-effect-scan', true);
    const target = normalizeRelative(relative(rootDir, record.file));
    const outgoing = [...record.outgoing].sort();
    const contentDigest = record.contentDigest;
    const edgeDigest = policyDigest(outgoing.join('\n'));
    const inventoryKey = `${target}\0${contentDigest}\0${edgeDigest}`;
    if (!seenInventory.has(inventoryKey)) {
      seenInventory.add(inventoryKey);
      registry.push({
        file: target,
        line: 1,
        effect: 'test-support:production-dependency',
        targetProvenance: 'repo-production',
        classification: 'inventory',
        callsite: createCallsiteHash(
          target,
          `${contentDigest}\0${edgeDigest}`,
          0,
        ),
        contentDigest,
        edgeDigest,
        outgoing,
      });
    }

    const writerEntries = record.writerCandidateCallsites.size > 0
      ? deriveWriterRegistry(record.content, target, scanBudget)
        .filter(entry => record.callsites.has(entry.callsite))
      : [];
    for (const entry of writerEntries) {
      const effectKey = `${target}\0${entry.effect}\0${entry.callsite}`;
      if (seenEffects.has(effectKey)) continue;
      seenEffects.add(effectKey);
      registry.push(entry);
      if (
        entry.classification === 'violation'
        || entry.classification === 'guarded-denial'
      ) {
        violations.push({
          file: entry.file,
          line: entry.line,
          match: entry.effect,
          label: `eager production ${entry.effect} targets ${entry.targetProvenance}`,
          code: errorCodeForProvenance(entry.targetProvenance),
          callsite: entry.callsite,
        });
      }
    }

    const childAnalysis = record.childCandidateCallsites.size > 0
      ? childEffectAnalysis(
        record.content,
        target,
        rootDir,
        record.callsites,
        scanBudget,
      )
      : { violations: [], registry: [] };
    for (const entry of childAnalysis.registry) {
      const effectKey = `${target}\0${entry.effect}\0${entry.callsite}`;
      if (seenEffects.has(effectKey)) continue;
      seenEffects.add(effectKey);
      registry.push(entry);
    }
    for (const violation of childAnalysis.violations) {
      const effectKey = `${target}\0${violation.code}\0${violation.callsite}`;
      if (seenEffects.has(effectKey)) continue;
      seenEffects.add(effectKey);
      violations.push({
        ...violation,
        label: `eager production: ${violation.label}`,
      });
    }
  }
  let skipped = 0;
  let checked = 0;

  for (const absolutePath of allFiles) {
    scanBudget.check('test-effect-scan', true);
    const relativePath = normalizeRelative(relative(rootDir, absolutePath));
    const legacyAllowlisted = allowlist.includes(relativePath);
    const content = canonicalSourceText(readFileSync(absolutePath, 'utf-8'));
    const fileRegistry = deriveWriterRegistry(content, relativePath, scanBudget);
    registry.push(...fileRegistry);
    const fileViolations = [
      ...legacyReadViolations(content, relativePath, scanBudget),
      ...writerViolations(fileRegistry),
    ];
    for (const violation of fileViolations) {
      const migrationIdentity = `${relativePath}:${violation.callsite ?? ''}`;
      if (
        legacyAllowlisted
        && violation.code === 'E_HERMETIC_LIVE_STATE_READ'
        && LEGACY_READ_MIGRATION_BASELINE.includes(migrationIdentity)
      ) {
        registry.push({
          file: relativePath,
          line: violation.line,
          effect: 'legacy:live-state-read',
          targetProvenance: 'repo',
          classification: 'migration',
          callsite: violation.callsite,
        });
      } else {
        violations.push(violation);
      }
    }
    const childAnalysis = childEffectAnalysis(
      content,
      relativePath,
      rootDir,
      undefined,
      scanBudget,
    );
    registry.push(...childAnalysis.registry);
    violations.push(...childAnalysis.violations);
    if (legacyAllowlisted) skipped += 1;
    else checked += 1;
  }

  return { violations, registry, checked, skipped };
}

// 531 süpürme: the coverage job runs this scan IN-PROCESS under vitest
// instrumentation, which multiplies the analysis cost past the normal
// per-phase wall (measured: 180001ms trip at 29.8M ops on run 31056929295 vs
// ~18s uninstrumented). Callers in instrumented contexts may pass their own
// measured budget; every production/CLI caller keeps the default.
export function scanConfiguredTestRoots(rootDir = REPO_ROOT, allowlist = ALLOWLIST, scanBudget = createScanBudget()) {
  const configuredRoots = [
    join(rootDir, 'tests'),
    join(rootDir, 'src', 'dashboard', 'src'),
    join(rootDir, 'src', 'desktop', 'tests'),
  ].filter(existsSync);
  const aggregate = { violations: [], registry: [], checked: 0, skipped: 0 };
  const scanState = {
    seenFiles: new Set(),
    seenEdges: new Set(),
    seenProductionInventory: new Set(),
    seenProductionEffects: new Set(),
  };
  for (const testsDir of configuredRoots) {
    const result = scanTestDir(
      testsDir,
      allowlist,
      rootDir,
      scanState,
      scanBudget,
    );
    aggregate.violations.push(...result.violations);
    aggregate.registry.push(...result.registry);
    aggregate.checked += result.checked;
    aggregate.skipped += result.skipped;
  }
  aggregate.scanBudget = scanBudget.snapshot();
  return aggregate;
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (invokedDirectly) {
  let result;
  try {
    result = scanConfiguredTestRoots();
  } catch (error) {
    process.stderr.write(
      `[hermetic-lint] ERROR: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(2);
  }

  if (result.violations.length === 0) {
    const migrations = result.registry.filter(entry => entry.classification === 'migration').length;
    const strictUnresolved = process.argv.includes('--strict-unresolved');
    const unresolvedPolicy = evaluateUnresolvedPolicy(result.registry, { strictUnresolved });
    const unresolved = unresolvedPolicy.fingerprint;
    const productionPolicy = evaluateProductionInventoryPolicy(result.registry);
    const productionInventory = productionPolicy.fingerprint;
    if (unresolvedPolicy.blocking) {
      const code = unresolvedPolicy.reason === 'strict unresolved policy'
        ? 'E_HERMETIC_UNRESOLVED_STRICT'
        : 'E_HERMETIC_UNRESOLVED_DRIFT';
      process.stderr.write(
        `[hermetic-lint] FAIL: ${unresolvedPolicy.reason}`
        + ` [${code}] current=${unresolved.count}:${unresolved.digest}`
        + ` baseline=${UNRESOLVED_BASELINE.count}:${UNRESOLVED_BASELINE.digest}\n`,
      );
      process.exit(1);
    }
    if (productionPolicy.blocking) {
      process.stderr.write(
        `[hermetic-lint] FAIL: ${productionPolicy.reason}`
        + ' [E_HERMETIC_PRODUCTION_INVENTORY_DRIFT]'
        + ` current=${productionInventory.count}:${productionInventory.digest}`
        + ` baseline=${PRODUCTION_INVENTORY_BASELINE.count}`
        + `:${PRODUCTION_INVENTORY_BASELINE.digest}\n`,
      );
      process.exit(1);
    }
    const status = unresolved.count > 0 ? 'DEBT' : '✓';
    process.stdout.write(
      `[hermetic-lint] ${status} ${result.checked} files checked,`
      + ` ${result.skipped} legacy-read allowlisted`
      + ` — 0 confirmed violations; writer-registry=${result.registry.length}`
      + ` migration-pending=${migrations}`
      + ` unresolved-pending=${unresolved.count}:${unresolved.digest}`
      + ` production-inventory=${productionInventory.count}:${productionInventory.digest}`
      + ` scan-budget=${result.scanBudget.elapsedMs}ms`
      + ` peak-rss=${Math.ceil(result.scanBudget.peakRssBytes / (1024 * 1024))}MiB`
      + ` peak-heap=${Math.ceil(result.scanBudget.peakHeapBytes / (1024 * 1024))}MiB`
      + ` strict-unresolved=${strictUnresolved ? 'on' : 'off'}\n`,
    );
    process.exit(0);
  }

  process.stderr.write(`[hermetic-lint] FAIL: ${result.violations.length} violation(s) found:\n`);
  for (const violation of result.violations) {
    process.stderr.write(
      `  ${violation.file}:${violation.line}: [${violation.code}] ${violation.label}\n`
      + `    ${violation.match}\n`,
    );
  }
  process.exit(1);
}
