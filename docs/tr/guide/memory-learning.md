# Memory, recall ve learning

## Product-user perspektifi

Deckent product memory'si repository-host instruction memory değil, `.brain/memory.db`'dir. ADR, memory, sprint record, debt, pattern, retrospective, chat, audit material, relation/history, document tracking ve KPI projection saklar. [Kanıt: `AGENTS.md:69-73`; `src/core/memory-store.ts:100-338`; `docs/tr/db.md` içindeki gerçek PRAGMA inventory]

## Sınırlı recall

`memory recall <query>`, generated Markdown satırlarını filtrelemek yerine query-first, read-only ve consistent bir view okur. Sonuç `AVAILABLE`, `ABSENT` veya typed `HOLD` olur. `AVAILABLE` yalnız bütçeye alınmış tam unit'leri içerir; entry/byte/line bütçesi dışındaki kayıtlar content-slice edilmeden opaque detail reference ile deferred kalır. `ABSENT` dürüst no-match sonucudur. `HOLD` başarı değildir: CLI typed reason yazar ve `1` ile çıkar.

```bash
node dist/cli/entry.js memory recall "Goal Mission Flow" --json
```

`--json` versioned envelope döndürür. Sonraki bounded page için opaque `nextCursor` değerini `--cursor` ile; deferred tek complete entry için opaque reference'ı `--detail` ile kullanın. Invalid, stale, cross-scope veya changed reference `HOLD` ile fail-closed olur; caller reference üretmez ve tenant'ı query parameter'dan çıkarmaz. Type filter, `--sprint-min` ve `--mode and|or` retrieval'ı daraltır. Search ranking evidence retrieval'dır, policy precedence değildir. [Kanıt: `src/cli/commands/memory.ts`; `src/core/memory-read-{contract,service}.ts`; precedence `AGENTS.md:116-127`]

Read budget, retained-memory lifecycle'tan ayrıdır. `memory_read` shared limit sağlar; `memory_read_profiles` named consumer için override eder. Global authored değerler project authored değerlerden önce merge edilir; named profile kendi shared layer'ından daha özeldir. Default worker profile 128 KiB / 512 complete-content line'dır; diğer reader'lar 32 KiB / 200 line default'u kullanır. Bunlar view-selection limitidir; deletion, retention veya decay threshold değildir. [Kanıt: `src/core/config.ts:resolveMemoryReadProfiles`; `src/core/memory-read-contract.ts`]

MCP `deckent_memory_query`, aynı scoped reader'ı kullanır. Successful response versioned structured view/detail data içerir; `HOLD`, yalnız rendered prose değil typed payload taşıyan MCP error olarak işaretlenir. `deckent://memory` resource; bounded human rendering yanında complete body'leri tekrar etmeden scope, selection revision, selected ID, deferred opaque reference ve cursor machine metadata'sı sunar. Server project ve tenant scope'u tool argument'tan değil authority'den kurar. [Kanıt: `src/mcp/tools/memory-query.ts`; `src/mcp/resources/memory.ts`]

## Remember ve relations

`remember <note>`, optional tags/title ile typed memory yazar. `memory relations list|review`, relation state'i sunar. Bunlar DB authority üzerinde mutation/read operation'dır ve tenant/source semantics'e uymalıdır. [Kanıt: `src/cli/commands/remember.ts:11-45`; `src/cli/commands/memory.ts:202-264`; `src/core/memory-store.ts`]

Audit'te remember/rebuild/export/backup mutation çalıştırılmadı. [Kanıt: owner write boundary]

## Statistics, export, rebuild, backup

Gerçek `memory stats` run 1.764 entry ve schema v1 bildirdi; ADR, audit, chat, debt, finding, identity, memory, pattern, retro ve sprint type'larına ayrıldı. Bu dated repository snapshot'tır. [Kanıt: real output, 2026-08-01]

`memory export`, DB content'i `.brain/exports/*.md` içine project eder; `memory rebuild` reverse import yapar; `memory backup`, SQLite backup/checkpoint behavior kullanır. Generated Markdown data/projection'dır, policy authority değildir ve bounded recall source'u değildir. [Kanıt: `src/cli/commands/memory.ts`; `AGENTS.md:112-114`]

## ADR memory

Current governance accepted ADR authority'nin `memory.db` içinde yaşadığını söyler; Markdown ADR copy'leri canonical decision store değil historical/generated view'dır. Retrieval yine precedence ve scope'a uyar; ADR owner/system veya Immutable Law'u override etmez. [Kanıt: `AGENTS.md:69-73,116-127`; `src/core/memory-store.ts`; `docs/tr/governance/adr-system.md`]

## Training trace

Canlı truth command, `training-trace` için code `ok`, wired `ok`, enabled `on`, proof `ok` bildirdi. `src/orchestra/sprint-phases.ts` içinde callsite ve `.deckent/traces/sprint-worker.jsonl` içinde recent journal buldu. [Kanıt: gerçek `truth --json`, 2026-08-01; `src/orchestra/output-collector.ts:28-89`; `src/orchestra/sprint-phases.ts:2539-2558,2953-2977`]

Default config trace'i universally on yapmaz; recording call `training_trace.enabled` koşuluna bağlı ve fail-soft'tur. Dogfood project'in enabled olması global default iddiası değildir. [Kanıt: aynı source line'ları; manifest truth contract]

## Evolution ve promotion

`evolve report`, cross-sprint agent/skill trend'lerini okur. Promotion pipeline temporary entity'leri evaluate edebilir, permanent pool'a promote edebilir veya underperformer'ı disable edebilir; physical promotion consequential'dır ve reporting'den ayrıdır. [Kanıt: `src/cli/commands/evolve.ts:48-73`; `src/orchestra/promotion-pipeline.ts:63-267`]

Feature manifest promotion'ı lightly used sınıflandırır. Current routing consumption ve settlement proof olmadan automatic learning'i fully closed production loop diye anlatmayın. [Kanıt: manifest `promotion-pipeline`; production-wiring rule]

## Dogfood / repository gerçeği

| Capability | State | Evidence |
|---|---|---|
| DB-first memory | ✅ canlı | 1.764-row real snapshot, FTS table/trigger, active CLI |
| Recall | ✅ canlı | real JSON query |
| Export/rebuild/backup | ✅ registered | help/source verified; mutation-run yok |
| Training trace | ✅ dogfood'da canlı | code+wired+enabled+recent proof |
| Promotion/demotion | ⚠️ kısmi | implementation var; manifest lightly-used |
| Closed outcome→routing→promotion loop | ⚠️ kısmi | birden çok organ var; end-to-end production closure certified değil |

Schema detayı [Database reference](../db.md) içindedir.
