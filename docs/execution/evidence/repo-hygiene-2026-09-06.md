# Repository hygiene — 2026-09-06

Owner request: `temizlik.md` içindeki onaylı işleri uygula, belgeleri ve tamamlanma kanıtlarını uzlaştır.
Bu belge kalıcı evidence'dır; iş/state/authority SSOT'u `docs/MASTER-PLAN.md`.
Source/runtime implementation, sprint start/retry/build ve provider mutation bu dilimin dışında.

## Applied physical changes

- Six detached analysis worktrees retired; registered worktrees 11 → 5.
- All six trees moved by same-filesystem rename, not deleted. Directory inodes remained identical.
  Ignored/untracked files, binary changes, node_modules directories/symlinks and both historical
  `.brain/memory.db` files remain intact. The two database inodes (1057353, 817103) and sizes
  (34574336 bytes each) remained identical; no database content was inspected.
- Main, native-terminal lane, release and both recovery/711 worktrees remain registered.
- Analysis archive: 52 files, 1340679 bytes, 52/52 before/after SHA-256 matches.
  48 tracked source paths (39 codex-analysis + 9 audits) removed from Git index;
  four previously ignored audit artifacts retained in the same move.
- Other ignored `.analysis/` directories remain untouched.
- No Git object/history rewrite, gc, reflog expiry, stash mutation or remote push.
  All 11 stashes retained.

## Preservation and recovery

External evidence:
`/home/alperen/deckent-recovery-20260904/hygiene-20260906-before.json`
SHA-256: `ed4654fa81ae2d6557a08bc736ae272dba479106d9b94c1b1667dd229c3c09d0`.

Snapshot root:
`/home/alperen/deckent-recovery-20260904/worktree-snapshots-20260906/`.

| Original directory | Preserved snapshot directory |
|---|---|
| /tmp/deckent-analysis-20260829-veIdEv/lab | analysis-lab |
| /tmp/deckent-analysis-20260829-veIdEv/worktree | analysis-worktree |
| /tmp/deckent-f3-recovery-8Q6zIj/worktree | f3-recovery |
| /tmp/deckent-landing-replay-NLiPNH/worktree | landing-replay |
| /tmp/deckent-p0-final-replay-20260829 | p0-final-replay |
| /tmp/deckent-separation-H6LKXM/worktree | separation |

`git-registrations/` under that snapshot root preserves each exact original Git registration
before pruning. These are recovery snapshots, not runnable registered worktrees: their `.git`
pointers intentionally refer to retired registrations. Restoration requires a fresh collision
check, exact directory move-back and original registration restoration (or a reviewed Git repair).
Do not blindly run Git commands inside these snapshots or restore over an existing worktree.

Earlier text patches alone were insufficient: they omitted binary contents and untracked evidence.
No snapshot may be discarded merely because those patches exist.

Archive map:

| Historical source prefix | Current disk prefix |
|---|---|
| codex-analysis/ | docs/archive/analysis-2026-08/codex-analysis/ |
| .analysis/audits/ | docs/archive/analysis-2026-08/audits/ |

The external manifest records all 52 original relative paths, byte sizes and hashes.
Archive is local/ignored; it is not delivered by a fresh clone.
Historical source files remain retrievable from pre-hygiene Git history at `ff2e47564`
(for the 48 tracked artifacts only). The four ignored artifacts require the retained local archive.

Pre-edit MASTER and generated projections are preserved under
`/home/alperen/deckent-recovery-20260904/hygiene-20260906-preedit/`.
Previous cleanup backup `recovery-deleted.tar.gz` (54-file manifest) SHA-256:
`a623cf0dabeb4faea35e335859b29269769317a99aaa7c60d44ca9222492bd37`.

## Ledger and DONE boundaries

- Mutable nonterminal Evidence paths/progress and Updated dates reconciled.
- No state, Truth, identity, acceptance, dependency, gate or receipt changed.
- Terminal rows 10/520/525/6121 remain byte-identical to their pre-edit records; their historical
  path claims are interpreted using the archive map above, not rewritten.
- Immutable `docs/governance/closure-batches/*/master-snapshot.json` untouched.
- MASTER 420 is GIT-MAINT-REPORT-001; APPLY is 430. The temporary checklist's wrong ID corrected.
- 150/220 remain BLOCKED: physical cleanup does not satisfy canonical restore/disposition,
  dependency and clean-clone product acceptance.
- No canonical GR-2026-09-04-REPO-CLEANUP-G3-01 receipt was located; its checklist proposal
  was not turned into a fabricated authenticated receipt.
- 120 remains OPEN; untracking a 21695651-byte resource log does not implement retention/rotation.
- 430 remains BLOCKED: dirty working trees and unresolved stash/history prerequisites.
- Sprint 724 is already COMPLETE with real worker/effect/result/settlement/archive proof.
  MASTER 3357 remains OPEN, not product-complete; its later run evidence is now recorded in MASTER.
  Full hermetic gate, multiworker/handoff and operator observability closure are still outstanding.

## Findings retained, not new admitted work

- Fable's archived-task drilldown finding: `inspect 724-001` returned
  `INSPECT_TASK_NOT_FOUND` although run 724 is COMPLETE.
- Sprint 714 terminal receipt production is not proven. Archived five-artifact manifest has no
  terminal receipt; last recorded event is TIMEOUT_ASSIGN, not terminal settlement.
  Existing 711/712/713 archive receipts are retained. Do not assert lost receipt recovery or
  mint a replacement based on absence alone.
- Existing Closure OS projection drift was detected before this edit; authenticated event chain
  validated (7 events). Projection-only recomputation is not a new authenticated decision.
- Full hermetic baseline cannot be inflated to turn 18371 versus 18157 into success.
- `temizlik.md` §6 remains excluded/deferred, including runtime untracking, cold archive,
  follow-up documents and broad test cleanup.

## Verification

### Subsequent owner-approved runtime untracking

After the physical archive slice, the owner explicitly accepted removing exactly three daily
runtime files from Git tracking while preserving them on disk. This supersedes only those
three paths in the earlier §6 exclusion; all other deferred candidates remain excluded.
The files are local/untracked evidence, not fresh-clone assets. No producer/schema change,
history rewrite, secret rotation, archive pruning or Brain database operation is included.

| Local path | Preserved bytes | SHA-256 at untracking |
|---|---:|---|
| .deckent/settings/repl-history | 28260 | accc0b19c5f5338b614ea7ba0a095c6ee6b77d68e905a68a86283da37ca07ff2 |
| .deckent/runtime/owner-notifications.jsonl | 49203 | 6f633c3bc1d9bccaab772def56c28541f31c90cbd65f1c352c6279a1f9381fd2 |
| .deckent/runtime/owner-notification-receipts.jsonl | 15343 | e93c29f7bca369d43902b94201952bcf3d67de8dc39ab3bace0ac03055267a78 |

These runtime files may legitimately change later. Git untracking does not remove their
historical committed contents. Fable reported secret-like vocabulary matches in REPL history;
actual credential exposure is not established, and values were not displayed. If genuine
credentials were stored, separate owner-reviewed rotation/history remediation is required.

### Earlier archive slice checks

- LOCAL_VERIFIED: full working-tree MASTER check/write PASS (577 rows); link gate PASS
  (435 scanned files); operating-policy PASS; closure-dispositions PASS (7 authenticated events);
  scoped working-tree and staged whitespace checks PASS.
- Staged MASTER independently validates against the exact HEAD registry: 576 rows,
  identity continuity continuous, 20 nonterminal Evidence/Updated changes, no added Work ID or
  receipt. Both staged projections are generated by the canonical producer from that staged
  MASTER, not copied from the dirty working tree.
- The inherited 3357 admission row and recovery receipts remain unstaged, together with their
  working-tree projection and the newly reconciled 724 evidence. No source/test recovery dirt
  is included in this hygiene commit.
- Independent Fable checks: six preserved snapshots, 52/52 archive byte/digest parity,
  remaining five worktrees, retained 11 stashes, immutable terminal rows, mutable Evidence-only
  changes and pinned archive digest links verified. Channel is not a signed closure receipt.
- Closure projection check remains DRIFT in level-lane/active/closure-health, already observed
  before this slice. No authenticated classification or signer invocation was performed.
- REMOTE_ADVISORY: not run; archive-dependent fresh-clone tests remain owner-deferred.
  No build, provider call or new runtime canary was required or run for these documentation
  and filesystem-preservation changes. No product-DONE or all-repo-green claim.
