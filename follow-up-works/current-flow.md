# GEÇİCİ AKIŞ — TEK AKTİF İMLEÇ

> Bu dosya yalnız kısa vadeli çalışma imlecidir. İş ve kapanış SSOT'u
> `docs/MASTER-PLAN.md`; kalıcı bütün-repo analiz kaydı
> `follow-up-works/deckent-full-code-truth-analysis-2026-08-30.md` dosyasındadır.
> Tamamlanan ayrıntılı recovery günlüğünün kalıcı kanıtı Git geçmişi ve
> `.analysis/audits/` altındaki makine kayıtlarıdır.

## Şu an — 2026-09-04 03:45 Europe/Istanbul

- Branch: `main`; HEAD bu commit (governance), önceki: `13d2c80ef` (3332), `2449b6e4f` (3331),
  `90041c27f` (owner cleanup). `origin/main`'e push yapılmadı (owner gate).
- Aktif Deckent run/worker/container yok; `.tasks` boş; bot listen canlı (PID 2898110, dokunulmadı).
- Bu oturumun ürünü: native terminal audit'i (32 bulgu, 13 owner kararı) → MASTER 7099 v2 paketi,
  7101–7104 owner-admitted satırlar, 3331 ve 3332 ADR-D-007 recovery paketleri LANDED (VERIFY),
  3333 OPEN (üçüncü recovery, yeni oturumda).
- Typed HOLD: üretim-kaynak yazan `/do` hedefleri `productionWiring` V2 kontratında düşüyor
  (LLM digest-pinned blok üretemiyor); 3333 kapanmadan 7099 v2 dogfood başlamaz.
- Runtime dirty truth commit dışı: `.brain/ERRORS-critical.md`, `.deckent/provider-execution-observations.db`,
  `.deckent/settings/repl-history`, `.deckent/runtime/local-llm.pid`.
- Pre-existing kırmızı gate'ler (HEAD'de de): layer-shims 9, readme-stats 3 stale, audit-operation-ingress 8;
  planner battery'de 30 pre-existing test kırmızısı (validateProductionWiringAuthority sınıfı). Owner admission bekler.

## Tamamlanan ürün zemini

### Motor A — exact task/attempt custody

- Main landing: `67a734c87`.
- Final gerçek WSL2/Docker canary:
  - task `canary-1788433556479`
  - attempt `b6d8aa45-19e0-89d3-8ede-fac68c18c8ad`
  - mode `normal-docker-exact`
  - accepted result `diskVerified:true`
  - effect landing → accepted result → evaluation → finalizer → settlement → archive
    zinciri durable reread ile doğrulandı.
  - fresh-process reopen ikinci worker/container doğurmadı.
- Machine receipt:
  `.analysis/audits/motor-a-wsl2-docker-canary-2026-09-03.json`
  sha256 `02836a467b6eae81689fa1bd3434311f0a49640f8179d27acba39e2e3bf84f82`.
- Networkless installed-package proof:
  `.analysis/audits/motor-a-linux-wsl2-networkless-install-2026-09-03.json`
  sha256 `3da177733c030dfe694499340b594ad044600b584d8dab6f5c29f1db7dae5ea4`.
- macOS 8031 ve Windows-native 8032 owner-deferred; başarıya çevrilmedi.

### Terminal ve Fable 5.1

- Final main/origin landing: `f6ce016a8`.
- Terminal operator yüzeyi Linux/WSL2 gerçek binary ile doğrulandı.
- Claude Fable 5.1 registry → activation → argv → worker image → XVerify zinciri
  exact model kimliğiyle bağlandı.
- MASTER `TERMINAL-OPERATOR-SURFACE-CLOSURE-001` satırı `VERIFY`; macOS,
  Windows-native ve SSH/tmux gerçek-host HOLD'ları nedeniyle elle `DONE` yapılmadı.

## MASTER güncellemesi

- `RECOVERY-BORN-711-NORMAL-DOCKER-EXACT-ATTEMPT-CUSTODY-001` ve Linux/WSL2
  children 3327–3329 `OPEN → VERIFY` yükseltildi.
- Gerçek receipt, commit, task/attempt ve platform kanıtları satırlara bağlandı.
- Hiçbir satır sahte `DONE` yapılmadı; authenticated Closure OS disposition bekliyor.
- `STATE-RETENTION-001`, `REPO-CLEANUP-001` ve `REPO-CLEANUP-APPLY-001`
  kalan `.tasks` gerçeğiyle güncellendi.
- `node scripts/lint-master-plan.mjs --write` sonucu:
  569 satır, 481 aktif, 214 receipt, 13 blocker; projectionlar senkron.

## Sprint dışı `.tasks` temizliği — fiziksel temizlik tamam, ürün açığı açık

- Taşınan set: 92 dosya / 271705 byte.
- Geri dönüş dizini:
  `/tmp/deckent-tasks-recovery-20260904T011107+0300`.
- Taşıma sonrası relative-path+size+sha256 JSON manifest digest:
  `6e7be541e7602b5d4f825293acad661b027fe8b8a0f32d2ec9ac8e46046713ed`.
- Yeni `.tasks` dizini: 0 entry, mode `0755`, owner `alperen:alperen`.
- Aileler:
  - 29 terminal XVerify task claim
  - 19 XVerify result
  - 11 XVerify plan
  - 12 provider-execution observation
  - 18 worker-heartbeat authority record
  - repair queue, deck shadow ve worker-core metadata
- Bu kayıtlar sprint ID taşımadığı için bugünkü canonical `deckent cleanup` bunları
  tanımadı. Owner, bu tek fiziksel temizlik için açık istisna verdi; byte'lar
  kalıcı silinmedi ve `/tmp` geri dönüş dizinine taşındı.
- Ürün açığı kapanmış sayılmaz: XVerify/observation/heartbeat kayıtlarının canonical
  retention/archive/restore consumer'ı hâlâ yoktur. `REPO-CLEANUP-001` ve
  `REPO-CLEANUP-APPLY-001` bu nedenle otomatik `DONE` yapılmadı.

## Local LLM notu

- Local server canlı ve `Qwen3.8-27B` API model adını yayımlıyor.
- Project config şu anda daha ayrıntılı `Qwen3.8-27B-Q4_K_M` adını taşıyor.
- Terminal sohbet probe'u çalıştı; fakat exact-ID worker routing için bu ad farkı
  düzeltilmeden local model bir dogfood worker authority'si sayılmayacak.

## Kabul edilmiş sıra ve bir sonraki imleç

1. Claude yan oturumunun terminal bug paketini main'e almadan önce çakışma ve kanıt
   kontrolü yap; ardından source/dist eşitliğini ölç, gerekli build'i al ve owner
   koordinasyonuyla bot restart/reconnect yap.
2. Sprint-dışı XVerify/observation/heartbeat kayıtları için canonical
   retention/archive/restore açığını ayrı bir ürün outcome'u olarak kapat.
3. Motor A 3326–3329 için authenticated Closure OS disposition turunu hazırla;
   Terminal 7099'un platform HOLD'larını ayrı tut.
4. Local LLM exact API model kimliğini effective config/registry üzerinden hizala ve
   yalnız gerçek reachability + routing kanıtından sonra worker kullanımına aç.
5. Yeni product dogfood goal'i: kabul edilmiş C sırasının sonraki child'ı
   `4034 OPERATION-EFFECT-CONTEXT-001`.
6. 4034 tamamlanınca aynı dogfood döngüsüyle 4035+ child DAG'a devam et; permission
   4040 ve approval 4050 kapsamlarına taşma.

Yeni Goal/Mission/Flow/Run henüz başlatılmadı. İlk yeni run temiz ve dürüst baseline
sağlanmadan açılmayacak.

### 2026-09-04 05:07 — 3333 local-verified, live-proof HOLD

1. `GR-2026-09-04-PLANNER-HOST-WIRING-01` active; exact-profile registry/harness, host digest
   completion ve planner→DIRECTIVES round-trip implemented. Scoped `11 files / 222 tests`, tsc,
   i18n/model-literal/hermeticity/operating-policy/script-registry PASS; `build:all` PASS.
2. Bot canonical stop/build/start zinciri tamam: eski PID 2898110 graceful kapandı, rebuilt listener
   PID 3670461 canlı. `.tasks` boş; aktif run/worker/container yok.
3. Built CLI `do` ve native TTY `/do` aynı external-boundary HOLD'unda: nested Codex app-server
   sandbox host-home'unda `Read-only file system`; ledger invocations
   `inv-5b80de7b730dd2afe6bc10d391290e00` / `inv-24877773e843c9edd22397af7fa062a8`,
   transport `nonzero_exit`. Escalation reddedildi; auth/config/provider workaround yapılmadı.
4. Bir sonraki imleç: fresh HEAD/scope audit → external execution boundary'de gerçek CLI ve native
   `/do` L1 preview → active receipt consume + 3333 VERIFY + commit (push yok) → ancak sonra 7099
   v2 L1 kart onayı/dogfood. Bu kanıt gelmeden landing veya 7099 start YASAK.

### 2026-09-04 05:15 — fresh authority/scope audit

1. `main` ve HEAD `6f286ba6b…` değişmedi; `origin/main` farkı +4; `.tasks` boş; aktif
   run/worker/container yok; rebuilt bot PID `3670461` canlı.
2. 3333'ün exact 16-target executable scope digest'i yeniden `89eaa629…` ve policy digest'i
   `c4c96a97…`; scope drift yok. Başlangıçtaki dört runtime kirinin hiçbiri stage/commit edilmedi;
   CLI/native denemelerinin runtime evidence artışları yerinde korundu.
3. `codex-cli 0.153.0` ve ChatGPT login canlı, fakat host-home bootstrap'ı aynı sandbox
   `Read-only file system` sınırında. Fingerprint değişmediği için yeni provider retry açılmadı;
   credential/config/fallback workaround yapılmadı.
4. İmleç değişmedi: external execution authority ile gerçek CLI + native `/do` preview alınmadan
   receipt consume, 3333 landing ve 7099 dogfood kapalıdır.

### 2026-09-04 10:57 — 3333 verified, landing boundary

1. Owner'ın external-execution onayı sonrası ilk gerçek CLI denemesi provider transportunda başarılı
   oldu ve mutable L1 test dosyalarının verifier asset olması nedeniyle task-builder'ın doğru overlap
   HOLD'unu açığa çıkardı. Guard/contract gevşetilmeden verifier mantığı tek digest-pinned harness'e
   alındı; production source/test dosyaları observation target olarak ayrıldı.
2. TDD + bağımsız verification: 11 scoped file / 213 test, tsc, i18n, no-model-literal,
   operating-policy, script-registry ve hermeticity PASS. Bot `3670461` stop → `build:all` PASS →
   rebuilt PID `3728211` running.
3. Gerçek CLI flow `a36f802e-…` plan digest `fbe1faad…` (4 L1 task, concurrency `8/3`) ve gerçek
   native TTY `/do` flow `87ce58a4-…` plan digest `06332b1e…` (3 L1 task, concurrency `8/2`) provider
   transport exit 0 + consumer accepted + gate/policy PASS üretti. Native card pre-landing yasağı
   gereği reddedildi; CLI exact plan unstarted olarak saklandı.
4. `GR-2026-09-04-PLANNER-HOST-WIRING-01` consumed, MASTER 3333 `VERIFY`. İmleç: allowlisted
   3333 landing commit'i (push yok) → fresh HEAD doğrulaması → CLI flow `a36f802e-…` approve+start →
   7099 v2 L1 dogfood gözlemi. Dört runtime dosyası stage/commit edilmez.
