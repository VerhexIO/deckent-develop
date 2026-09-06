# Memory, recall, and learning

## Product-user perspective

Deckent's product memory is `.brain/memory.db`, not repository-host instruction memory. It stores ADRs, memories, sprint records, debt, patterns, retrospectives, chat, audit material, relations/history, document tracking, and KPI projections. [Evidence: `AGENTS.md:69-73`; `src/core/memory-store.ts:100-338`; actual PRAGMA inventory in `docs/en/db.md`]

## Bounded recall

`memory recall <query>` is query-first and reads a consistent, read-only bounded view rather than filtering generated Markdown. Its result is one of `AVAILABLE`, `ABSENT`, or typed `HOLD`. `AVAILABLE` contains complete admitted units; records outside the entry, byte, or line budget are deferred with an opaque detail reference, never silently content-sliced. `ABSENT` is an honest no-match result. `HOLD` is not success: the CLI writes its typed reason and exits `1`.

```bash
node dist/cli/entry.js memory recall "Goal Mission Flow" --json
```

`--json` returns a versioned envelope. Use its opaque `nextCursor` with `--cursor` for the next bounded page, and a deferred opaque reference with `--detail` to retrieve that one complete entry. Invalid, stale, cross-scope, or changed references fail closed as `HOLD`; callers must not reconstruct references or infer a tenant from query parameters. Type filters, `--sprint-min`, and `--mode and|or` narrow retrieval. Search ranking is evidence retrieval, not policy precedence. [Evidence: `src/cli/commands/memory.ts`; `src/core/memory-read-{contract,service}.ts`; precedence `AGENTS.md:116-127`]

Read budgets are independent from retained-memory lifecycle. `memory_read` supplies shared limits and `memory_read_profiles` can override one named consumer; global authored values are merged before project authored values, while a named profile is more specific than its shared layer. The default worker profile is 128 KiB / 512 complete-content lines; other readers default to 32 KiB / 200 lines. These are view-selection limits, not deletion, retention, or decay thresholds. [Evidence: `src/core/config.ts:resolveMemoryReadProfiles`; `src/core/memory-read-contract.ts`]

MCP's `deckent_memory_query` uses the same scoped reader. Its successful response includes versioned structured view/detail data; `HOLD` is marked as an MCP error with the typed payload, not merely rendered prose. The `deckent://memory` resource exposes a bounded human rendering plus machine metadata (scope, selection revision, selected IDs, deferred opaque references, and cursor), without duplicating complete bodies. The server constructs project and tenant scope from authority, never from a tool argument. [Evidence: `src/mcp/tools/memory-query.ts`; `src/mcp/resources/memory.ts`]

## Remember and relations

`remember <note>` writes a typed memory with optional tags/title. `memory relations list|review` exposes relation state. These are mutations/read operations over the DB authority and must respect tenant/source semantics. [Evidence: `src/cli/commands/remember.ts:11-45`; `src/cli/commands/memory.ts:202-264`; `src/core/memory-store.ts`]

No remember/rebuild/export/backup mutation was run in this audit. [Evidence: owner write boundary]

## Statistics, export, rebuild, backup

A real `memory stats` run reported 1,764 entries and schema v1, broken down across ADR, audit, chat, debt, finding, identity, memory, pattern, retro, and sprint types. This is a dated repository snapshot. [Evidence: real output, 2026-08-01]

`memory export` projects DB content into `.brain/exports/*.md`; `memory rebuild` performs the reverse import; `memory backup` uses SQLite backup/checkpoint behavior. Generated Markdown is data/projection, not policy authority and is not the bounded recall source. [Evidence: `src/cli/commands/memory.ts`; `AGENTS.md:112-114`]

## ADR memory

Current governance says accepted ADR authority lives in `memory.db`; Markdown ADR copies are historical/generated views rather than the canonical decision store. Retrieval still obeys precedence and scope; an ADR does not override owner/system or an Immutable Law. [Evidence: `AGENTS.md:69-73,116-127`; `src/core/memory-store.ts`; `docs/en/governance/adr-system.md`]

## Training trace

The live truth command reported `training-trace` as code `ok`, wired `ok`, enabled `on`, proof `ok`. It found callsites in `src/orchestra/sprint-phases.ts` and a recent journal at `.deckent/traces/sprint-worker.jsonl`. [Evidence: real `truth --json`, 2026-08-01; `src/orchestra/output-collector.ts:28-89`; `src/orchestra/sprint-phases.ts:2539-2558,2953-2977`]

The default config does not make the trace universally on; the recording call is conditional on `training_trace.enabled` and fail-soft. The dogfood project being enabled is not a global default claim. [Evidence: same source lines; manifest truth contract]

## Evolution and promotion

`evolve report` reads cross-sprint agent/skill trends. The promotion pipeline can evaluate temporary entities, promote them to permanent pools, or disable underperformers; physical promotion is consequential and separate from reporting. [Evidence: `src/cli/commands/evolve.ts:48-73`; `src/orchestra/promotion-pipeline.ts:63-267`]

The feature manifest classifies promotion as lightly used. Do not describe automatic learning as a fully closed production loop without current routing consumption and settlement proof. [Evidence: manifest `promotion-pipeline`; production-wiring rule]

## Dogfood / repository reality

| Capability | State | Evidence |
|---|---|---|
| DB-first memory | ✅ live | 1,764-row real snapshot, FTS tables/triggers, active CLI |
| Recall | ✅ live | real JSON query |
| Export/rebuild/backup | ✅ registered | help/source verified; not mutation-run |
| Training trace | ✅ live in dogfood | code+wired+enabled+recent proof |
| Promotion/demotion | ⚠️ partial | implementation exists; manifest lightly-used |
| Closed outcome→routing→promotion loop | ⚠️ partial | multiple organs exist; end-to-end production closure not certified |

Schema detail is in [Database reference](../db.md).
