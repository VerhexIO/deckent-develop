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

### 2026-09-04 03:45 — bir sonraki imleç

1. Fresh `deckent-authority-bootstrap` snapshot; `docs/execution/active/RECOVERY-BORN-PLANNER-HOST-COMPLETED-WIRING-001.md`
   capsule'ını oku (handoff receipt içinde), 3333 için admission receipt yaz (HEAD digest'leri), IN_PROGRESS.
2. Host-completed wiring: model kimlik önerir, host `hostProofProgram`'ı doldurur; TDD → tsc → gate'ler → dist →
   gerçek `deckent do` + native `/do` kanıtı (7099 v2 L1 hedefi: scratchpad `goal-L1b.txt` metni capsule'da yeniden yazılır).
3. 3333 landing → 7099 v2 L1 `/do` ile başlar (kart onayı), landing'lerde bot durdurma izni var (owner 2026-09-04).

