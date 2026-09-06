# Brain memory — kapsamlı katman analizi, 2026-09-06

Tür: salt-okuma audit ve karar önerisi; implementation spec, MASTER admission veya DONE receipt değildir.
Temel: main `753e882b153236e9a2605eb178bd38069e4ad969` + mevcut dirty kaynak; inceleme 01:43–01:57Z.
Saklama: kalıcı audit evidence. Geçersizleşme tetiği: aynı kapsamın yeni disk/runtime kanıtlı audit'i bunu supersede ettiğinde eski ölçümler tarihsel kanıt olarak kalır; canlı durum diye kullanılmaz.

## Sonuç

429 öğrenme kapasite doluluğu değildir. Bunlar `type=memory` kayıtlarıdır; üretici çoğunlukla sprint başına bir toplu öğrenme metni yazar. 429 bağımsız, doğrulanmış bilgi parçası anlamına da gelmez.

Sorun yalnız metin kalabalığı değil: kayıt sayısı/satır bütçesi karışmış; planner bütün belleği okuyup sonra kesiyor; hatalı sprint numaraları güncellik sırasını bozuyor; bazı ilişki kimlikleri tutarsız. Yalnız export'u kısaltmak bu consumer kusurlarını çözmez.

Öneri: kalıcı bilgiye 3000 kayıt sınırı koyma. 3000, istenirse insanın açtığı compact görünümün satır hedefi olsun. LLM çalışma bağlamı, arama ve fiziksel saklama ayrı bütçelensin. Kayıpsızlık, özetin her ayrıntıyı taşıması değil, asıl kayıtların eksiksiz korunması ve özetten geri erişilebilmesidir.

Kabiliyet: mevcut bellek **kısmen çalışıyor**. Kayıpsız canonical compact, tüm yüzeylerde bounded retrieval ve milyon-ölçek gecikme **kanıtlanamadı**. Bu audit sırasında DB, config, source, exports ve run-state değiştirilmedi; test/build/sprint/decay/rebuild çalıştırılmadı.

## 1. Kanıt ve kapsam

Tracked inventory: 5951 yolun her biri tek primary domain'e ayrıldı: production-source 1587, tests 3055, docs-governance 464, host-policy-skills 305, repo-runtime-config 177, build-operations 166, other-repo 197. Bu bir dosya envanteridir; 5951 dosyanın tamamının satır satır incelendiği iddiası değildir.

Derin kapsam: MemoryStore/types/normalization/query/import/export; planner ve worker-context üreticileri; finalizer/retro/debt/pattern üreticileri; V2 outcome tracker ve V3 learning cells; archive memory references; CLI/API/MCP/Dashboard/bot tüketicileri; backup/migration/tenant/history/decay sınırları. Üç bağımsız read-only agent lane'i storage/governance, retrieval/context ve learning lifecycle için kullanıldı; ana oturum önemli iddiaları kaynakta yeniden okudu. Fable ENTRY 245–247 alışverişi bağımsız kaynak karşılaştırmasıdır; formal XVerify closure değildir.

Untracked 37 entry ve tracked 150 dirty entry başlangıç sahipliği korunarak değerlendirildi; bu yeni audit dosyasıyla untracked 38 oldu. Yeni recovery kaynakları kaynak olarak, runtime JSON/pid/build dosyaları projection olarak, communication geçici kanal olarak ayrıldı. Generated exports yalnız veri; eski audit'ler yalnız tarihsel kanıt. Ignored canlı DB, private custody, credentials ve binary arşivler bu tur açılmadı. Testler statik sözleşme kanıtı olarak okundu; çalıştırılmadı. Desktop memory yüzeyinin canlı parity testi ve tüm API deployment/tenant konfigürasyonları kapsam dışı; bunlar için yokluk/başarı iddiası yok.

Authority: owner'ın bellek analizi/compact yönü; DOGFOOD_MODE=ON / DIRECT_MAIN. Bu audit yeni implementation yetkisi veya mode değişikliği üretmez. MASTER'ın tamamı semantik olarak yeniden okunmadı; makine envanteri + ilgili satırlar kullanıldı. Dolayısıyla full authority-bootstrap tamamlandı iddiası yok. ADR-G-035/G-032/D-004 dokümanları ve ilgili generated ADR bölümü tasarım kısıtı karşılaştırması için okundu; uygulama spec'i öncesinde canonical accepted ADR recall ayrıca gerekir.

Güven: kaynak mekanizmaları yüksek; gerçek corpus ölçümleri aşağıdaki korunmuş checkpoint'e bağlı; canlı etkilenen kayıt sayısı, yeni performans ve ürün doğrulaması ölçülmedi.

### Korunmuş corpus checkpoint'i

Kaynak: `/home/alperen/deckent-recovery-20260904/brain-compact-20260906-Bvte51/manifest.json`, 2026-09-06T01:40:18Z. Önceki yetkili canonical backup + ayrı kopyanın public MemoryStore API ile okunabilirlik kontrolü; bu tur yeni DB okuması değil.

| Ölçüm | Değer / anlam |
| --- | --- |
| Aktif kayıt | 3141; tüm tiplerin toplamı |
| Öğrenme | 429 `memory` kaydı |
| Diğer tipler | ADR 52, audit 198, chat 514, debt 390, finding 1, identity 1, pattern 81, retro 338, sprint 370, sprint-archive 767 |
| İlişki | 1279 satır; tamamının geçerli endpoint'e sahip olduğu ölçülmedi |
| Epoch-numaratör öğrenmeleri | 10 ayrı eski sprint grubu, grupta bir öğrenme |
| Backup | 34,824,192 byte; SHA-256 `e328af74172fec33c1641cf5535ae5a8e8246178510f432237f9c871a00defd7` |
| Export | memory.md 4206 satır; summary.md 99 satır |
| Effective budget | `.deckent/config.json` memory_budget=5000; mevcut DB yolu kayıt sayıyor |

Backup checksum + kopyadan okunabilirlik kanıtı vardır; tam integrity-check ve restore tatbikatı kanıtı yoktur. Backup almak ile güvenli compact işlemini doğrulamak aynı şey değildir.

Önemli ölçüm düzeltmesi: checkpoint'teki `nonExemptEntries=3088` etiketi gerçek `decay_exempt` flag sayımı değildir. Eski `auditBrainBudget` formülünün `3141−52 ADR−1 identity` sonucudur. Aşağıdaki B1 bunu açıklar; eski checkpoint değiştirilmedi.

## 2. Bulgular

Sınıflandırma referansı: CURRENT_DONE = kayıpsız compact + işlevsel okuma. RELATED etiketi düşük önem veya release izni değildir. Hiçbir bulgu otomatik MASTER işi olmaz.

### B1 — Bütçe birimleri ve decay adayları tutarsız

`BLOCKS_CURRENT_DONE` · yüksek güven · kısmen çalışıyor.

[auditBrainBudget](../../../src/orchestra/debt-manager.ts) :1556–1574 kayıt sayısını `*Lines` alanlarıyla döndürüyor; yalnız ADR/identity'yi düşüyor. Aynı dosya :1605–1629 runDecay için toplam kayıt sayısını kullanıyor. [Retro writer](../../../src/orchestra/sprint-retro-writer.ts) :821–878 sprint/retro/memory'yi, [auditor](../../../src/monitor/auditor.ts) :1019–1030 pattern'ları da `decay_exempt=true` yazıyor. [Store decay](../../../src/core/memory-store.ts) :1138–1211 gerçek flag'i gözetiyor.

Sonuç: alarmın “temizlenebilir” dediği kayıtlar gerçekte korunuyor; OVER → etkisiz decay döngüsü mümkün. Exempt olmayan eski kayıtlar ise yaş eşiğine girebilir. Öğrenmelerin tümü otomatik silinecek demek yanlış; üretici onları özellikle koruyor. 5000'i 3000'e indirmek çözüm değildir.

### B2 — Önce tüm belleği yükle, sonra prompt'u kes

`BLOCKS_CURRENT_DONE` · yüksek güven · büyüme karşısında işlevsel ölçek kanıtlanamadı.

[sprint-planner](../../../src/orchestra/sprint-planner.ts) :192–234 bütün memory ve pattern içeriklerini alıyor. [planner](../../../src/orchestra/planner.ts) :493–518 sonradan priority context kuruyor; [constants](../../../src/core/constants.ts) :166 sınır 200 satır. MEMORY, debt/pattern/retro/ADR'den önce geliyor. Bu nedenle DB/RAM işi büyüyor; düşük öncelikte kalan ama önemli operasyon bilgisi prompt'tan düşebilir. LLM prompt'u tamamen sınırsız değildir; sınırlama yanlış aşamadadır ve satır, token/byte sınırı değildir.

[task-builder](../../../src/orchestra/task-builder.ts) :2322–2380 önce tüm accepted ADR'leri yükleyip seçiyor; fallback search limit=3 olsa da tam içerik boyutu sınırlı değil. [MCP memory resource](../../../src/mcp/resources/memory.ts) :25–43 bütün memory'yi birleştiriyor, bazı hataları boş bellekten ayırmıyor.

### B3 — Hatalı sprint numarası “en yeni” sanılıyor

`BLOCKS_CURRENT_DONE` · yüksek güven · yanlış recency.

[MemoryStore](../../../src/core/memory-store.ts) :956–960 ve [structured search](../../../src/core/memory-query.ts) :290 `sprint_num DESC` kullanıyor. [summary export](../../../src/core/memory-export.ts) :82–87 bu sıranın ilk 10 öğrenmesini alıyor. Eski epoch kimlikleri normal sprintlerden büyük oldukları için öne yerleşiyor. [parseSprintOrdinal](../../../src/core/utils.ts) :152–183 numaratör için epoch ayrımı yapıyor; bu koruma memory sıralamasına taşınmış değil.

Kayıtları gerçek Sprint 1'e yeniden etiketlemek tarih/provenance sahteciliği olur. Güvenli görünüm: tek “Legacy numaratör dönemi — 10 kayıt” satırı, ayrıntıya açılan asıl kimlikler. Kimlik, metin, orijinal zaman ve ilişkiler korunur. Belirsiz tarih açıkça belirsiz kalır; migration zamanı “öğrenildiği tarih” olmaz.

### B4 — Archive digest'i geri yüklenebilir öğrenme kopyası değil

`BLOCKS_CURRENT_DONE` · yüksek güven · kayıpsız destructive compact kanıtlanamadı.

[sprint-archive](../../../src/core/sprint-archive.ts) :1106–1132 memory reference'a id/type/time/digest koyuyor, kaydın tüm içeriğini kopyalamıyor. Hash, içerik değildir. [memory-export](../../../src/core/memory-export.ts) :182–213 metin görünümü üretir; bütün history/tags/metadata/relations için round-trip format değildir. Markdown'dan rebuild, DB'nin kayıpsız yedeği sayılamaz.

[MemoryStore update/upsert](../../../src/core/memory-store.ts) :487–785: update sprint/tags/tenant reclassification sağlamaz; generic upsert'te atlanan alanlar default'a dönebilir. Per-entry transaction, çok-kayıtlı CAS/rollback'li compact batch değildir. Mevcut CLI/MCP'de gereken canonical lossless group+projection işlemi bulunmadı. Elle SQL/upsert/export editiyle ikame edilmedi.

### B5 — İlişki grafiğinde producer kimlikleri uyuşmuyor

`RELATED_BUT_NONBLOCKING` · yüksek güven · graph substrate kısmen çalışıyor.

[retro-writer](../../../src/orchestra/sprint-retro-writer.ts) :819–873 `sprint-log-${sprintNum}` ve `mem-${sprint.id}` yazıyor. [finalizer](../../../src/orchestra/sprint-finalizer.ts) :5179–5202 ilişki uçlarında `sprint-log-${sprint.id}` ve `memory-${sprint.id}` kullanıyor. [Store](../../../src/core/memory-store.ts) :199–216 relations tablosunda FK yok; :1021–1066 positional overload endpoint doğrulamıyor (object overload doğruluyor).

Yanlış uçlu ilişki üretme riski kaynakta doğrulanmıştır; gerçek 1279 satırın ne kadarının etkilendiği bilinmiyor. Mevcut relations tablosu, sorguyu yöneten doğrulanmış knowledge graph değildir. Bunu graph retrieval'a açmadan önce endpoint/tenant/provenance bütünlüğü gerekir. Yalnız görünüm compact'ı için bütün graph altyapısını yeniden yazmak gerekmez.

### B6 — Öğrenme gerçeği birden çok projection'a ayrılmış

`RELATED_BUT_NONBLOCKING` · yüksek güven · evrim mekanizması kısmen çalışıyor.

Kalıcı anlatı `memory.db`; V2 performans `.deckent/routing/learnings.json`; V3 routing `.deckent/stats/routing-cells.json`. Bunlar aynı veri değildir. [routing-plan-adapter](../../../src/orchestra/routing-plan-adapter.ts) :375 V3 tüketicisi, [sprint-planner](../../../src/orchestra/sprint-planner.ts) :479 V2 prompt tüketicisidir.

Olumlu: güncel [finalizer](../../../src/orchestra/sprint-finalizer.ts) :4780–4930 exact terminal truth/receipt/causal attribution gate'leri içeriyor; [outcome-tracker](../../../src/orchestra/outcome-tracker.ts) :195 skill credit'i CREDITED authority'ye bağlıyor; [learning-cells](../../../src/core/routing/learning-cells.ts) :248 altyapı kaynaklı bazı NO_GO'ları yetenek başarısızlığı saymıyor. “Bütün öğrenme kontrolsüz” hükmü yanlış olur.

Eksik: narrative memory kaydında aynı kanıt bağını taşıyan zorunlu receipt alanı yok. [retro-writer](../../../src/orchestra/sprint-retro-writer.ts) :852–879 mevcut mem kaydını içerik karşılaştırmadan başarılı sayabiliyor. Sonradan düzeltilen sonucun eski anlatısı kalabilir. NO_GO kök-neden bilgisi değersiz değildir; failure learning ile doğrulanmamış iddia ayrılmalıdır.

### B7 — Kısmi publication ve correction tutarlılığı

`RELATED_BUT_NONBLOCKING` · kaynak riski yüksek güven; canlı etki ölçülmedi.

[outcome-tracker](../../../src/orchestra/outcome-tracker.ts) :227 ilk task'ta sprint marker'ı ekler; [finalizer](../../../src/orchestra/sprint-finalizer.ts) :5269–5330 marker varsa tüm V2 kayıt döngüsünü atlar. Task'lar arası çöküşten sonra kısmi yayın tamamlanmış sanılabilir. V3 task-level dedupe bununla aynı mekanizma değildir.

Tracker :350 reclassification V2 sonucunu düzeltir, ancak V3/memory/retro/debt/catalog için tek atomik correction zinciri kanıtlanmadı. Tracker :855 loadLearnings ve [learning-cells](../../../src/core/routing/learning-cells.ts) :118 bozuk dosyayı boş başlangıca indirgeyebilir; sonraki yazı eski bilgiyi örtme riski taşır. Mevcut corpus bozuk denmiyor. Kayıpsız compact bu sidecar'ları da silmemelidir.

### B8 — Tenant sınırı her consumer'da aynı güçte değil

`RELATED_BUT_NONBLOCKING` · güvenlik açısından release-gate adayı; görünüm compact'ından bağımsız.

[API memory search](../../../src/api/memory-search-endpoint.ts) :39–85 verified principal/tenant çözümü ve strict modda eksik scope için 403 içeriyor. Buna karşılık [memory-query](../../../src/core/memory-query.ts) :303–355 tenant kolonu bulunamazsa predicate'i atlayabiliyor; normal Store migration'ı bu kolonu ekler, yani bu koşullu legacy/foreign-schema riskidir.

Tenant verilmeden Store okuması bütün tenant/null kayıtlarını kapsayabilir; planner ve [MCP query](../../../src/mcp/tools/memory-query.ts) :10–69 seviyesinde doğrulanmış principal propagation görünmüyor. Bu, MCP transport'unun kimliksiz veya mevcut kurulumun sömürülebilir olduğunun kanıtı değildir. Çok-tenant memory retrieval'ı genişletmeden fail-closed authority zinciri kanıtlanmalı; yalnız geleceğin kurumsal işi diye ertelenmemeli.

### B9 — Yüzeyler aynı belleği aynı biçimde sunmuyor

`RELATED_BUT_NONBLOCKING` · yüksek güven · kısmen çalışıyor.

[MemoryExplorer](../../../src/dashboard/src/components/MemoryExplorer.tsx) :83–97 `/api/memory` tam metnini alıp client-side filtreliyor; bu Dashboard yolu server-side FTS değildir. CLI/API FTS kabiliyeti ayrı. [bot-agentic](../../../src/connectors/bot-agentic.ts) :311–318 summary.md'yi okuyor, prompt'a en çok 6000 karakter gönderiyor; “bot prompt'u sınırsız” denemez. Ancak dosyanın güncellik hatası ve tam okuma maliyeti devam eder.

Terminal/Desktop primary control surfaces; Dashboard observability'dir. Hedef, bunlarda aynı canonical memory read-model: seçilen kayıt, gerekçe, kaynak/kanıt, güncellik, kapsam, düzeltme durumu ve harcanan retrieval bütçesi. Bu audit yeni ekran uygulamadı, canlı UI kanıtı vermiyor.

### B10 — Read, backup ve migration güven sınırları eksik

`BLOCKS_CURRENT_DONE` · yüksek güven · güvenli mutation/restore kanıtı eksik.

[MemoryStore](../../../src/core/memory-store.ts) :135–155 constructor RW/WAL/initSchema yapar; “query” adlı komutun yan etkisizliği otomatik değildir. Schema additive migration'lara rağmen version=1; bütün logical mutation'lar için aynı CAS/audit contract yok. HMAC yalnız audit kayıtlarına uygulanır, bütün belleğin kriptografik doğruluğu değildir.

[CLI memory backup](../../../src/cli/commands/memory.ts) online backup öncesinde checkpoint yapar; error catch'in yalnız mesaj basması nedeniyle tek başına process exit=0 yeterli kanıt değildir. Mevcut korunmuş backup digest'i ve public API okunabilirliği ayrıca kontrol edildi. İşlem öncesi restore testi, scoped transaction, stale-preimage rejection, replay ve içerik/ilişki/history parity gerekir.

### B11 — Milisaniye ve milyon-ölçek iddiası henüz ölçülmemiş

`RELATED_BUT_NONBLOCKING` · mevcut ölçek iddiası kanıtlanamadı.

[memory-v2-stress](../../../tests/integration/memory-v2-stress.test.ts) 1000 kayıt / 200 relation / 50 query fixture'ı ve query<100ms assertion içeriyor. Aynı synchronous connection üzerinde Promise.all, gerçek çok-process eşzamanlı yük kanıtı değildir. Bu tur test de çalıştırılmadı. Donanım, corpus, sıcak/soğuk cache, writer concurrency ve p95/p99 verilmeden “milyonlarca kayıt milisaniyede” denemez.

FTS mevcut; memory embedding/vector nearest-neighbor production index'i bulunmadı. Routing capability-vector isimleri semantic memory vektörü değildir. `.tasks/shared` geçici worker KV iletişimi, Nervous decision-memory ise finding suppression belleğidir; bunların TTL/authority semantiği kalıcı bilgiden ayrıdır.

## 3. Şimdi: kayıpsız compact + işlevsel retrieval

Bu bölüm sonraki admitted spec için önerilen sınırdır; yeni run/iş kaydı açmaz. Amaç: “bilgi korunurken Brain yalnız gerekli bilgiyi sınırlı maliyetle okur.”

1. Mevcut DB ve learning sidecar'larını koru; restore edilebilir checkpoint'i kanıtla. History/relations/source kimliklerini yalnız export sayısıyla doğrulama.
2. Legacy epoch öğrenmelerini görünümde tek başlık altında grupla; asıl kayıtlara bağlantı, orijinal provenance ve içerik değişmesin. Gerçek Sprint 1 ile birleşmesin.
3. İnsan-summary, retrieval candidate/byte/time ve LLM token bütçelerini ayrı birimlerle tanımla. 3000 satır, DB count veya decay eşiğine çevrilmesin.
4. Canonical bounded read path'i planner/worker bağlamına bağla: zorunlu policy/ADR ve unresolved kritik bilgiyi koru; ilgili öğrenmeleri güvenilir tarih + ilgililikle seç; tam corpus'u önce RAM'e alma. Detay gerektiğinde ikinci scoped retrieval olsun.
5. Compact view'u sürümlü ve atomik yayımla; source revision, kapsam, excluded/legacy sayıları ve “ayrıntıya git” bağlantıları görünür olsun. Read-model bir source alternatifi olmasın.
6. Fan-in kanıtı: önce/sonra kayıt kimliği + içerik + ilişki/history parity; deterministic replay; interruption/restore; gerçek planner prompt'unda boyut sınırı ve kritik bilginin korunması; CLI/MCP/API consumer'larında aynı revision/scope. Dogfood yürütmesi ve gerçek-binary proof olmadan DONE yok.

Bu slice'a vector engine, bütün evrim sistemi veya yeni enterprise deployment eklenmez. Mevcut MASTER karşılıkları: 240 MEMORY-DB-001, 190 MEMORY-AUTHORITY-001, 235 MEMORY-SURFACE-PROJECTION-001. Hangisinin exact outcome sahibi olduğu admission sırasında çözülür; satırlar bu audit ile değiştirilmedi.

## 4. Sonra: Brain devrim programı için yön

Önerilen mantıksal ayrım:

```text
Kanıt / olay kaynakları
    → provenance + yetki + kalite admission
    → sürümlü bilgi ve düzeltmeler
    → yeniden kurulabilir erişim katmanları
         ├─ exact kayıt/metrik sorgusu
         ├─ FTS + isteğe bağlı yerel semantic index
         └─ doğrulanmış tipli ilişki graph'ı
    → sınırlı çalışma bağlamı + insanın inceleyebildiği görünüm
```

Bu, mevcut outcome→routing→promotion döngüsünü söküp yeniden yazma önerisi değildir. [ADR-G-032](../../adr/adr-g-032-self-learning-evolution-loop.md) bu döngüyü korumayı; [ADR-G-035](../../adr/adr-g-035-memory-architecture.md) SQLite/FTS temeli üzerinde opt-in, local ve never-calls-home vector katmanını tarif ediyor. DB vendor değiştirme veya uzaktaki embedding servisine veri yollama kararı verilmedi. Canonical accepted ADR kontrolü ve gerektiğinde owner amendment olmadan aksi uygulanmaz.

### Bilgi kalitesi ve evrim

- Observation, hypothesis, verified fact, negative learning, owner policy ve görev ledger'ı birbirine karışmasın. Modelin tekrar etmesi veya yüksek confidence yazması bilgiyi doğru yapmaz.
- Her kazanım kaynak olay/receipt, kapsam, geçerlilik zamanı, doğrulama durumu ve supersession bağı taşısın. Aynı olayın retry'ı iki kez kredi üretmesin. Çelişki sessiz overwrite yerine görünür uzlaştırma olsun.
- Semantic benzerlik otomatik birleştirme gerekçesi değildir. Özet/dedup materialization olsun; asıl kanıta geri dönüş mümkün kalsın. Başarısızlıktan öğrenilmiş doğru dersler korunsun.
- Reclassification bütün ilgili projection'lara aynı event authority üzerinden taşınsın. Mevcut V2/V3 tüketicileri aşamalı, parity kanıtlı reducer'lara bağlansın; çalışan routing devreden çıkarılmasın.
- Kullanım/başarı sinyali, verified quality ve novelty değerlendirilsin; popüler yanlış bilgi sırf sık çağrıldığı için yükselmesin. Evrim değişiklikleri eval/shadow/canary/rollback ve mevcut approval sınırlarıyla yönetilsin.

### Büyüme ile çağrı yükünü ayırma

Saklama büyüyebilir; indeksleme/özetleme artımlı yapılır. Hot çalışma seti, warm bilgi ve cold kanıt farklı erişim/retention sınıfları olabilir. Retrieval sırasındaki aday, graph depth/edge, byte/token ve deadline bütçeleri corpus büyüklüğünden ayrı tutulur. Büyük corpus'un disk, index, backup ve yeniden indeksleme maliyeti yine vardır; fiziksel sonsuzluk/sıfır maliyet vaadi verilmez.

Sayısal metrik soruları LLM'in yorumuna veya vector yakınlığına bırakılmaz: exact index/materialized aggregate, time range, source revision ve freshness ile döner. Metnin anlamsal araması başka bir sorgu türüdür. FTS5 metin araması ve snippet/rank sağlar; tek başına semantic knowledge graph değildir. [SQLite FTS5](https://www.sqlite.org/fts5.html).

Yaklaşık vector index'leri hız/recall dengesi taşır; tenant filtrelerinin ANN taramasına uygulanış şekli sonuç sayısını ve izolasyonlu performansı etkileyebilir. Bu yüzden vector eklemek otomatik doğruluk veya ölçek garantisi değildir. Bu karşılaştırma vendor seçimi değil, tasarım uyarısıdır. [pgvector resmi açıklaması](https://github.com/pgvector/pgvector).

### Kurumsal ve bütün ortamlar

Project/session/user/org scope; doğrulanmış principal; tenant isolation; amaç/retention/visibility; permission değişiminde index/cache invalidation aynı servis contract'ında ele alınmalı. Ham prompt/output metni güvenilmez veri olarak kalır; retrieval içeriği policy/araç yetkisi üretmez. Hassas bilgi sınıflandırması ve poisoning savunması admission'ın parçasıdır.

Append-only düzeltme geçmişi, kullanıcı verisinin hukuka/politikaya uygun silinmesini yasaklayan “her şeyi sonsuza sakla” anlamına gelmez. Audit metadata, legal hold, kaynak içeriğinin kontrollü silinmesi ve tüm türev index/cache'lerden kaldırılması açık sözleşmeyle ayrılır; mevcut kompaksiyonda silme yapılmaz.

Local SQLite korunur; yalnız 34.8 MB veya 429 öğrenme DB değiştirme gerekçesi değildir. Çok sunuculu ve çok eşzamanlı writer ihtiyacında ortak memory contract arkasındaki deployment/storage adapter seçimi ayrı ölçüm ve ADR konusu olur. SQLite dosya başına tek writer modelini açıkça belgeler. [SQLite kullanım sınırları](https://www.sqlite.org/whentouse.html).

macOS/Linux/Windows native/WSL, offline ve opt-in embedding capability; uyumsuz platformda açık unavailable/HOLD; sessiz remote fallback yok. Bütün ortamların contract/test matrisi baştan belirlenir. Bu audit hiçbir platformda yeni backend doğrulamadı.

### Ölçüm ve ürün kabulü

Tek “beyin hızı” sayısı yerine exact metric lookup, FTS, semantic retrieval, graph expansion ve context assembly ayrı ölçülür. Corpus 10k/100k/1m, warm/cold cache, küçük/büyük entry, farklı tenant dağılımı, concurrent readers/writers, recovery/reindex altında p50/p95/p99; RSS/IO/index büyümesi; relevance recall; stale/contradictory sonuç oranı; correction propagation ve bilgi kaybı ölçülür. Rakamlar benchmark hedef matrisi, bugün sağlanan kapasite değildir.

Terminal/Desktop kullanıcısı “neden bu bilgi seçildi, kimden geldi, hâlâ geçerli mi, düzeltmem neyi etkiler?” sorularına cevap almalı. Dashboard aynı truth'un gözlem görünümü; API/CLI/MCP aynı query authority'nin adapter'ları olmalı. Agent tarafında aynı kanıt sınırları korunur. Mevcut MASTER 9000 LEARNING-001, 9037 ROUTING-OUTCOME-LEARNING-AUTHORITY-001 ve 6071 RUN-INSPECTOR-001 ile kapsam çakışmaları önce çözülür; yeni çoğalan backlog açılmaz.

## 5. Açık HOLD ve dürüst kapanış

- Compact uygulanmadı. DB/source/config'e bu audit kapsamında dokunulmadı.
- 3000 learning kapasitesi kararı yok; öneri insan-view hedefidir. Kalıcı kayıt sayısı ve query/token/retention birimleri ayrılmalıdır.
- Canonical lossless batch/read-model implementation ve gerçek consumer proof henüz yok.
- Mevcut ilişki hatası, tenant propagation ve correction risklerinin gerçek corpus etki sayısı ölçülmedi.
- Kaynak testleri okundu; LOCAL_VERIFIED, REMOTE_GREEN, production verified veya formal XVerify closure iddiası yok.
- Audit kanıtı implementation gerekliliklerini aydınlatır; ürünü DONE yapmaz. Bir sonraki çalışma, mevcut onaylı compact isteğini exact tek outcome'a bağlamaktır; tüm Brain programını aynı recovery paketine sığdırmak değildir.

## 6. Owner düzeltmesi — bütçe işi yönetmeli, anlamı kesmemeli

2026-09-06 canlı geri bildirim: token/turn bütçelerinin yalnız eşikte devre kesmesi geçmişte işi bozdu; kelime/cümle yarım bırakmak kabul edilemez. Bu, mevcut compact outcome'unun kabul koşuludur; yeni kapsam açmaz.

Kaynak örneği gerçek: `src/connectors/bot-agentic.ts:311–318` karakter bazlı `raw.slice(0, MAX)` kullanıyor. `src/orchestra/planner.ts:337` priority context builder satır bazlı bölüm kesiyor. Yalnız satırın veya cümlenin sonuna kesmek de yeterli değildir: bir sonraki cümle istisna/olumsuzluk/önkoşul içeriyorsa anlam yine değişir. Bu yolların anlam koruduğu kanıtlanmış değildir. Bulgu `BLOCKS_CURRENT_DONE`, kaynak güveni yüksek; bütün token/turn mekanizmalarına dair repo-geneli RCA iddiası yok.

### Önerilen davranış

1. **Admission öncesi iş planlama:** zorunlu policy, görev girdileri, sonuç üretme ve doğrulama payı birlikte hesaplanır. Bütün bütçe geçmiş metni doldurmaya harcanmaz. Bütçe dolmasını bekleyip sonra düşünmeye başlanmaz.
2. **Tam anlam birimi seçimi:** bilgi iddiası, kapsamı, gerekli koşulu/istisnası, kaynağı ve doğruluk durumu birlikte taşınır. Başlık veya yarım cümle, tam bilgi gibi sunulmaz. Policy, sayısal değer, kod veya kontrat keyfî paraphrase ile değiştirilmez.
3. **Sığdırma sırası:** alakasız/tekrarlı adayları çıkar → kanıt bağlı kompakt temsili seç → gerekirse daha dar soru veya kademeli retrieval yap → işi tamamlanabilir alt adımlara böl. Sadece `slice` çağrısını sentence-slice yapmak çözüm sayılmaz.
4. **Devamlılık:** context/turn operasyonel eşiğine yaklaşırken doğrulanmış ilerleme, açık işler, dependency, effect/settlement durumu ve kaynak referansları durable checkpoint'e taşınır. Yeni pencere/turn, mevcut authority ve toplam bütçe içinde bu noktadan devam eder; önceki mutasyonu tekrarlamaz. Checkpoint'e tahmin edilen değil gerçekten gerçekleşen işlem yazılır.
5. **Görünür eksiklik:** hangi bilgilerin bu çağrıya alınmadığı ve nereden getirileceği görünür olur. Zorunlu bilgi sığmıyorsa yanıltıcı cevap yerine exact insufficient-context/continuation durumu çıkar; tamamlanmış gibi DONE olmaz.
6. **Sert sınırlar korunur:** provider context kapasitesi, toplam owner harcama sınırı ve güvenlik sınırı ihlal edilmez. Alt görevlere bölme toplam bütçeyi sıfırlamaz. Resumable tasarım, bedelsiz/sınırsız tekrar garantisi değildir. Kontrol dışı provider kesintisinde de yarım output kabul edilmiş result sayılmaz; durable durumdan typed recovery gerekir.

Ölçülecek kabul: kelime/cümle parçalanmaması yanında koşul/olumsuzluk/sayı/kaynak bütünlüğü; zorunlu policy'nin korunması; uzun kayıt ve çok-adımlı işte erken checkpoint; kaldığı yerden devam; duplicate effect olmaması; toplam harcama sınırının aşılmaması. Metin kısaldı diye semantik eşdeğerlik varsayılmaz.

3000 satır ancak insan görünümü için hedef olabilir; bilgi kapasitesi, model context'i ve execution bütçesi değildir. Sabit sayıya sığdırmak uğruna anlam kaybettiren görünüm kabul edilmez; tam kayıtlar sayfalanır/açılır, detay gerektiğinde getirilir. Bu ek yalnız analiz/öneridir; ilgili kaynaklar bu tur değiştirilmedi.

## 7. Owner-admitted iş sınırı — 2026-09-06

Owner audit yönünü kabul etti ve MASTER'a işlenmesini istedi: bugün compact+revizyon; geniş DB ve AI-enterprise/post-production mekanizması mevcut öncelikli işlerden sonra. Canonical işler [MASTER-PLAN](../../MASTER-PLAN.md) içindedir; bu bölüm kapsam açıklamasıdır, ayrı ledger değildir.

- `9001 BRAIN-MEMORY-LIFECYCLE-001`: LEARNING-001 altında kapsamlı ürün belleği programı. Post-production işletim kalitesi kapsam içidir; güvenlik/kalıcılık önkoşullarını release sonrasına erteleme izni yoktur.
- `9002 BRAIN-MEMORY-COMPACT-001`: 9001'in tek bugünkü child'ı. Kaynaklar korunur; anlam-koruyan bounded recall ve compact view işlevsel olur. Bu child'ın kapanması parent'ı DONE yapmaz.
- Mevcut `240 MEMORY-DB-001` exact DB bakım/transaction authority'si; `9037 ROUTING-OUTCOME-LEARNING-AUTHORITY-001` learning-event authority'si olarak kalır. Aynı mekanizmalar yeniden üretilmez. `190/235` host core-memory projection işleri ürün memory.db işi değildir; §3'teki önceki aday eşleştirme bu kararla netleşti.

Mevcut Work definition'ları registry ile immutable olduğundan 240/9000 yalnız Evidence+Updated ile ilişkilendirildi; state/truth/acceptance/dependency değiştirilmedi. İki yeni kimlik bir program ve bir kapanabilir child içindir; B1–B11 başına satır açılmadı. İkisi OPEN; READY/IN_PROGRESS, run veya terminal receipt yok. Compact henüz uygulanmadı.

### Bugünkü child'ın plan ve kanıt sınırı

Sıra: baseline/restore-read proof → typed read/query+recency/budget-unit contract → bağımsız consumer/render adaptasyonları → tek-writer fan-in → targeted verification + gerçek planner/worker prompt ve ürün read kanıtı → normal settlement. Dependency, file collision, host/provider kapasitesi paralelliği belirler; model/slot sayısı metinden atanmaz.

Read kapsamı: MemoryStore/query/types/normalize/export, planner/task-builder, budget/decay predicate, bot/MCP/CLI/API/Dashboard memory read yolları ve ilgili test/config/i18n contract'ları. Write kapsamı yalnız bu child'ın read/projection/selector/label/test wiring'i; exact dosya manifesti ve mevcut dirty preimage'ler execution capsule'da çözülür. Full uygulama/desktop tasarımı ve başka domain refactor'u yok. Bu bölüm execution-ready capsule yerine geçmez.

Negatif kapsam: canlı DB entry/schema mutation, renumbering, decay/rebuild/VACUUM, asıl dosya/sidecar/archive silme; vector/graph backend veya genel runtime token/turn engine yeniden tasarımı; core-memory kanunu değiştirme; unrelated recovery dosyalarının sahiplenilmesi. Sınırda çözülemeyen gereklilik typed BLOCKS_CURRENT_DONE olur; generic SQL veya fake success ile bypass edilmez.

Bugünkü bütçe revizyonu memory selection/assembly/export semantiğidir. Genel execution engine'de token/turn bütçesi boyunca checkpoint/resume dönüşümü 9001'in ileri kapsamındadır; bu child onu production-wired diye kapatamaz. Var olan continuation/insufficient-context authority'si kullanılır; yokluğu gizlenmez.

Proof manifest: kaynak id/content/metadata/history/relation korunması; group drill-down ve tarih dürüstlüğü; context'te koşul/istisna/olumsuzluk/sayı/kaynak bütünlüğü; mandatory ADR ve unresolved critical bilgi; bounded candidate/byte/token/RAM yükü ve total-corpus eager-load olmaması; tenant regression; concurrent projection/read, interrupt/replay ve stale-preimage reject; aynı revision'a bağlı CLI/MCP/API/Dashboard okumaları; gerçek dogfood planner/worker prompt'u. Testler live proof yerine geçmez. User-facing metinler mevcut i18n contract'ından gelir.

Finite retry/FIX, zaman/ücret değerleri execution anında effective config/registry/budget authority'den gelir; değişmeyen hatada otomatik yeni tur yok. Output+verification ve continuation için önceden pay ayrılır; hard cap'i aşmak veya alt göreve bölerek toplam bütçeyi sıfırlamak yasaktır. Mutasyon/paid-call/build/restart/commit/push gate'leri canonical policy'den çözülür; bu kayıt receipt değildir.

### İleri programın kapanış sınırı

9001; admission/provenance ve knowledge quality, lossless versioned DB lifecycle, correction propagation, typed graph+opt-in local semantic retrieval, exact metric query, multi-tenant/privacy/governance, shared operator surfaces ve measured scale/post-production operations zinciri birlikte kanıtlanınca kapanır. Gerçek restore tatbikatı, DR ve corruption recovery; schema/index/embedding upgrade, rollback ve cache invalidation; SLO/alert/runbook, capacity/cost ve load/chaos ölçümleri zorunludur. 429'dan daha çok kayıt tek başına başarı değildir.

Bu admission'da canonical ADR kontrolü tamamlandı: compiled public MemoryStore.getById ile yalnız adr-g-035 ve adr-g-032 accepted tam metinleri okundu; yerel SQLite/FTS+opt-in never-calls-home vector ve mevcut learning loop'unu koruma sınırı değişmedi. Ham SQL/entry mutation yok. Store constructor RW/initSchema davranışı nedeniyle byte/mtime değişmezliği varsayılmadı; Fable ENTRY 255 mevcut DB mtime'ın değişmediğini bağımsız gözledi. MCP birleşik phrase recall FTS hatası verdi; sade sorgu sonuç getirdi fakat 200-character sunum tam ADR değildi, full public read bu yüzden kullanıldı. Bu query/surface contract kanıtıdır, bağımsız yeni backlog değildir.

Admission doğrulaması 2026-09-06T02:11Z: canonical `lint-master-plan --write` ardından `--check` PASS (579 Work row, 491 active, 231 receipt; iki yeni OPEN row dışında terminal/receipt değişimi yok); `lint-operating-policy` PASS; `lint-closure-dispositions` PASS (7 event, chain/identity/lifecycle/append-only); `npm run lint:link` PASS; scoped `git diff --check` PASS. Fable ENTRY 257 önceki 240/9000 satırlarında yalnız Evidence/Updated değiştiğini ve 190/235'in korunduğunu bağımsız teyit etti. Bunlar dokümantasyon/ledger admission doğrulamasıdır; compact implementation veya ürün runtime proof'u değildir. Commit/push/build/yeni sprint yapılmadı.

## 8. Compact yürütme isteği — exact admission engeli, 2026-09-06

Owner 9002'nin hemen yürütülmesini istedi. Başlangıç: main 753e882b1, mevcut dirty state korunuyor; sprint724 COMPLETE, sprint.lock yok. Effective config: normal run_flow_v2/do; Docker; structured brain_planning; max_workers=8 ve max_fix_retries=1 (kapasite/admission kanıtı değil). Yeni sprint/paid planner çağrısı yapılmadı.

`BLOCKS_CURRENT_DONE` / `host-proof-profile-unregistered`: `src/core/production-wiring-host-proof.ts:592–615` yalnız Closure OS ve Terminal native-provider host-proof profilleri taşıyor; proposal identity yalnız Terminal profilinde var. Memory için registered identity/harness bulunmuyor. `src/core/production-wiring-contract.ts:507–512` proposal completion, `src/orchestra/planner.ts:690–717` production-source görevini bu registry'ye bağlıyor. Structured/directive yolu da `src/orchestra/task-builder.ts:486–542` üzerinden V2 contract ve registered adapter ister; eski V1, missing contract ve unknown adapter reddedilir. Docs/test-only muafiyetini production-source işi için kullanmak sahte scope olur.

02:24:05.136Z compiled public-function probe: `deriveProductionWiringApplicability` gerçek memory-export kaynak scope'u için required/production-write-scope döndürdü; kayıtlı Terminal identity control=true, öneri niteliğindeki memory producer→export→CLI tuple registration=false. Bu read-only probe provider/DB/source/state mutation yapmadı; yeni run veya end-to-end başarısız sprint kanıtı değildir. Registry tamamının kaynak okuması yokluğu teyit eder; tek varsayımsal tuple tek başına bütün olası adları çürütme kanıtı sayılmadı.

Sonuç: 9002 bugün yalnız bir metin temizliği değil, production read/export revizyonu olduğu için mevcut normal dogfood admission yolu tarafından desteklenmiyor. Başka işin proof identity'sini kopyalamak, kanıt kapısını gevşetmek, kaynakları docs işi diye göstermek veya manuel SQL/export yazımıyla DONE üretmek yok. 724 canary'nin tamamlanması bu yeni kaynak domain'inin admission desteğini kanıtlamaz.

Gereken önkoşul gerçek memory producer/consumer/proof hedeflerine bağlı code-owned verifier ve admission desteğidir; mevcut explicit 9002 read/projection write sınırının dışındaki engine/authority alanına taşar. Typed ADR-D-007 prerequisite için exact owner scope istendi; recovery yetkisi varmış gibi normal feature elle yazılmadı. Fable'dan bağımsız registry ve canonical alternatif yol kontrolü istendi (ENTRY263). İsimlendirme/compact uygulanmadı; asıl kayıtlar korunuyor. Bu bulgu yeni MASTER identity açmadı; 9002 Evidence'a taşındı.

### Owner prerequisite onayı ve implementation — 2026-09-06

Owner son canlı “onaylıyorum” mesajıyla exact memory host-proof prerequisite'i kabul etti. Bounded ADR-D-007 capsule: `docs/execution/active/BRAIN-MEMORY-COMPACT-001.md`. Registry, ayrı trusted observer/harness ve planner registry-guidance bağımsız dosya lane'lerinde uygulandı. Normal memory feature bu seam'de yazılmadı. Profil yalnız gerçek MemoryStore → exportSummaryMd/exportMemoryMd → writeGuardedExports zincirini kapsar; CLI/API/MCP/planner/bot genel hafıza kapsamının kanıtı değildir. Sonraki ilk dogfood slice compact/export; 9002 tam acceptance kapsamı ayrıca açık kalır.

Fable ENTRY272/273 bağımsız diff incelemesinde contract/task-builder/task-types/host-proof-runner değişmezlerini ve memory feature/liveDB negatif scope'unu teyit etti. Registry scoped test 24/24, planner scoped test 11/11 ve `npx tsc --noEmit` exit0; bunlar prerequisite local kanıtıdır, normal worker/landing veya compact DONE değildir. Real observer geçici SQLite fixture kullanır; mevcut lossy product davranışı için RED/HOLD beklenir. Eski davranışı “observed” diye kabul ettiren fallback yoktur. Bu aşamadaki build bekleyişi aşağıdaki yeni kanıtla güncellenmiştir.

### Normal dönüş sonucu — 2026-09-06T03:36Z

`npm run build:all`02:55Z itibarıyla exit0; bot canonical stop/start ile yenilendi.
Harness20/20, registry24/24 ve planner11/11 scoped PASS; fresh compiled registry
memory profilini tanıyor. Bu komut transactional build journal kanıtı değildir.
Observer'ın label-injected gerçek ingress'i kullanan son sürümü
sha256:b21c2f2fb3b43e0f9f6603f39b45a9a22b5ef80edf5e2f5e8cd0c1792d0caf7c;
pre-feature gerçek temp-DB probe exit59, builder henüz yok; GO değildir.

İki `do` preview dispatch öncesi canonical reddedildi: ilkinde scope/worker-local
kriter kusuru, ikincide `run-proposal-compiler.ts:379` read scope kaybı. Yeni engine
yaması yerine mevcut structured CLI input yolu kullanıldı:24 write/11 read.
Eski DIRECTIVES byte-identical dış backup'ı aktif kapsülde kayıtlıdır.

Normal flow `c6f5a508-9e72-4542-825e-ab6b5242a988`, sprint725/task725-001,
plan digest `563db4b19dbb73bf5d0f7862b5270b3a8f86ee00d331852aee2c182b50fae836`:
events seq5 START_REQUESTED03:26:48.520Z → seq6 RUN_STARTED03:31:26.712Z →
seq7 RUN_FAILED03:32:02.772Z. Kanıt dosyası
`.deckent/runtime/run-flow-store/c6f5a508-9e72-4542-825e-ab6b5242a988.events.jsonl`;
detached log exact hatası: `Task 724-001 exact terminal authority is outside the checkpoint task universe`.
Worker başlamadı; memory compact/isimlendirme veya feature landing olmadı.

`BLOCKS_CURRENT_DONE`: project-wide recovery724 terminal authority'sini tutuyor;
`sprint-controller.ts:1359` checkpoint producer'ı bütün current authority'leri
725'e geçiriyor. `sprint-checkpoint.ts:340` doğru foreign-task guard'ında reddediyor.
`sprint-lifecycle.ts:199` eşdeğer scope kusuru taşıyor. Main + Sagan + Fable kaynak
incelemeleri uyuşuyor; bunlar formal XVerify settlement değildir.
Önerilen dar amendment yalnız iki checkpoint projection'ının current sprint task
evreniyle sınırlandırılması ve cross-sprint regresyonlarıdır. Global registry,
historical custody, fail-closed guard ve liveDB değişmez. Bu yeni engine düzeltmesi
onaylı host-proof prerequisite kapsamı dışındadır; uygulanmadı, owner admission gerekir.
Lock hâlâ ölüPID2621969'u, state725 PLANNING/PLAN'ı gösteriyor; elle temizlenmedi.
273s startup gecikmesi ayrıca ölçüldü; custody scan hipotezi kesin profil kanıtı değil.
9002 OPEN/HOLD; tamamlanan prerequisite normal worker→settlement başarısı sayılmaz.

### Owner-approved checkpoint amendment — 2026-09-06T03:54Z

Owner canlı olarak ADR-D-007 elle düzeltmeyi onayladı. Mevcut capsule'a
CHECKPOINT-SPRINT-SCOPE-725 amendment eklendi; yeni MASTER identity açılmadı.
Controller ve lifecycle yalnız current authority insertion'ını sprint.tasks ID
setine göre filtreliyor. Global registry/helper, mevcut HOLD/missing dalları ve
sprint-checkpoint.ts foreign-universe guard'ı değişmedi. Fable bağımsız kaynak
incelemesi olumlu; source freeze ve değişmez SHA'lar aktif capsule'da.

RED:106 testin104'ü geçti,2 historical-current composition testi beklenen hatayı
üretti. Kaynak düzeltmesi sonrası106/106PASS. Root, ilk controller testinin recovery
EVALUATE seam'ini ölçtüğünü tespit etti; test gerçek fresh preplanned runSprint PLAN
yoluna taşındı. Final3suite106/106PASS: gerçek checkpoint writer, persisted PLAN/725,
historical ref yok, terminalizer/provider spawn yok; provider öncesi typed sentinel.
Hermetik source-path kanıtıdır, live Docker/run settlement değildir. Son test
revizyonundan sonra root `npx tsc --noEmit` exit0; MASTER write/check validator PASS,
579row/491active/231receipt değişmedi, yalnız9002 Evidence güncellendi.

Live deployment henüz yok. Salt-okuma clean admission bot-active ve725-001 missing
task receipt nedeniyle HOLD. task settle dry-run appliedfalse; immutable routing
eksikliği ile host-subprocess yokluğunu ölçtüğü ve exactDocker custody'yi bağlamadığı
için operator attestation/apply yapılmadı. Bu farklı reconciliation kusuru mevcut
engine fix kapsamına eklenmedi. Build/normal start/compact henüz kanıtlanmadı;
9002 OPEN, düzeltmenin kaynak seviyesi LOCAL_VERIFIED.

### Canonical return and live checkpoint proof — 2026-09-06T04:25Z

Önceki deployment HOLD giderildi: canonical recover725 exact task bytes'ı
preserved archive'a taşıdı; SHA d7fa9f8513fc7f7bb0cadebef415fb6156493cc4cfc09e170ba5ccd66ff56568
eşleşti. Recovery'nin iç audit'i GATE_FAILURE; beklenmeyen legacy full-suite
çağrısı ve fixture kirliliği capsule'da açıkça kaydedildi, test PASS sayılmadı.
Bot stop sonrası standard clean ALLOW, npm run build:all exit0, bot2751931 fresh.
Memory.db size/mtime değişmedi; elle DB/task/receipt yazılmadı.

Normal structured Flow7c3f6c3e-0191-4d89-8caf-df2f9c695da9 / task726-001:
gerçek PLAN checkpoint04:16:27.272Z yalnız current task içeriyor; historical724
authority dışarı taşmıyor. Checkpoint düzeltmesi artık compiled runtime'da geçti.
İlk generation preparation helper exit78 nedeniyle NOT_DISPATCHED oldu;
ADAPTER_UNAVAILABLE alt guard'ı gizliyor. 60s timeout iddiası reddedildi:
Docker events25s exit78 gösteriyor, kalan süre compensation. Exact guard UNKNOWN.
Canonical bounded FIX generation2'yi04:21:31.210Z RELEASED yaptı; container healthy,
provider çalışıyor ve ilk tsc exit0. Henüz accepted result, landing, host proof,
settlement veya canlı compact yok;9002 OPEN. Ayrıntı ve exact digest'ler mevcut
BRAIN-MEMORY-COMPACT-001 capsule'ında; yeni iş kimliği veya closure oluşturulmadı.

### Terminal update — 2026-09-06T04:32Z

726 RUN_FAILED04:29:22.123Z. Private worker result/15-file implementation retained;
provider usage2073113 input/1958912 cached/19007 output. tsc and observer exit0,
Vitest227PASS/9missing-IDENTITY failures exit1. Worker selfAssessment DONE and
testsPassed:true are not root closure evidence.
Durable diagnostic: LANDING_PREPARE/PREIMAGE_MISMATCH, receipt
sha256:758c85a3d0fdcc8d494c8c21ac5c3af96fb7fb697a7e2ad967c4d2fe38af39f4.
No main compact landed. Previously baselined22 task paths unchanged/absent;
specific preimage mismatch target still under read-only investigation.
Live DB size unchanged but mtime advanced during the normal run to04:20:32.124Z;
post-run logical parity not yet reverified. No raw DB/manual mutation or new
recovery package; stale state/lock preserved,9002 OPEN/HOLD.

### Exact native RCA — 2026-09-06T04:36Z

Real compiled read-only native inspect reproduces the blocker: existing file
PRESENT, three absent new-file/parent targets E_EXEC_AUTH_NATIVE_NOT_FOUND.
inspectNativeEntry accepts only ENOENT as ABSENT, so the canonical native code
becomes NATIVE_EFFECT_UNCERTAIN, then coordinator catch/null becomes
PREIMAGE_MISMATCH. Current unit facade emits only ENOENT and masked this mismatch.
Sagan independent source review confirms the chain. First-failed path is not in
the historical receipt, but the general ADD-path defect is now reproducible.
Separate bounded native-adapter amendment proposed in capsule, not implemented;
no gate relaxation, retry or manual feature landing. Owner admission pending.

### Owner-approved native fix and deployment — 2026-09-06T05:01Z

Owner exact “Evet onaylıyorum” kabulüyle NATIVE-ABSENT-ENTRY-726 uygulandı.
Yalnız native adapter missing-code mapping ve testi değişti; canonical not-found
ve ENOENT ABSENT, diğer hatalar fail-closed. RED regression sonrası67/67 scoped
PASS ve root tsc exit0; Fable340 bağımsız kaynak incelemesi olumlu.
Gerçek compiled adapter+installed NAPI+tmp PROJECT proof eski dist'te RED,
standard build:all sonrası GREEN1/1. SourceTree2793bd8c…, native binary4e4dd558…
değişmez; fresh bot2857099. Platform sınırı Linux/WSL, fullDocker landing henüz yok.
Canonical retention5721f27e… ve --skip-audit recovery ile3task artifact byte-eşit
preserved, checkpoint korunmuş; snapshot4ca461bf…; Fable342 bağımsız4/4 doğrulama.
No fake terminal/DB mutation/manual code landing. Normal24/11compact planına
dönülüyor; bütün9002 ürün yüzeyleri ve memory compact hâlâ OPEN.

### Normal727 terminal — 2026-09-06T05:19Z

Flow50e2c375-50de-4d03-ba33-ee256f08f464, attempt6181b884-8132-83fd-84dd-20314036bbf4
generation1: real worker/provider completed, tsc/unchanged compact observer exit0;
targeted206+3 tests passed,9missing-private-IDENTITY fixture failures remain in the
earlier aggregate. No full-suite green claim. RUN_FAILED05:17:06.433Z:
LANDING_PREPARE/STAGED_SOURCE_CAPTURE_FAILED, diagnostic receipt
sha256:d946ce4820d032f2cb42ff40c03cb0dd1ff2496d14cfd3d337a4b0b322aad5cf.
Native missing-entry fix passed farther, but main landing still absent:22/22
feature baseline hashes/absence states unchanged. Container stopped exit0 and
coordinator gone, collector0/1. Capture sub-error/path is not durable here;
bounded read-only diagnosis requested from Sagan and Fable. No new recovery,
retry, cleanup, source edit or build. Compact and9002 remain OPEN/HOLD.

Fable348 subsequently reports real-image527378-byte write returning65536 with
exit0 after native-loader import; root source inspection confirms unchecked
writeSync return in source helper, and independent Docker events confirm ninth
helper exit0 after8small-file stages. Ninth operation is messages.ts. Short-write
handling is the next bounded amendment proposal, not implemented; Fable's runtime
reproduction is attributed, not claimed as root-run. Exact swallowed historical
sub-error and nonblocking trigger remain unproven. Preserve all guards; do not
raise limits or retry unchanged code. Owner admission for new amendment pending.

### Owner-approved full-write repair — 2026-09-06T05:39Z

Explicit owner manual ADR-D-007 approval admitted NATIVE-SOURCE-FULL-WRITE-727.
Only native-adapter and existing test changed; offset/retry/backpressure/deadline
handles partial source/receipt writes without relaxed policy/ABI/schema.
Corrected original-shaped pre-fix real-image RED SOURCE_CHANGED; final root72/72
adapter+coordinator tests with actual Docker flag and tsc0.527378-byte transfer
verified byte-for-byte as both1and9chunks using default Docker/installed native.
Standard build:all0/sourceTree0d77f1dc…; root forced real test import to compiled
dist adapter (resolution1) and passed same transfer proof. Custody test authority
is in-memory: full durable settlement NOT claimed. Bot2954262 fresh; cached MCP
not refreshed/not used.727 canonical retentione5006147… and recover --skip-audit
preserved2task artifacts/checkpoint bytes, prearchive57b01943…. No new sprint or
manual feature landing, no DB mutation/commit/push.9002 OPEN, compact not applied.

## 9. Manual completion: exact728 reader and safe compact export — 2026-09-06

Owner explicitly requested the remaining current work under ADR-D-007 manually,
without dogfood execution. Exact package: MANUAL-COMPACT-CLOSURE-728 in the existing
capsule. Global mode was not changed; no fresh provider/sprint dispatch occurred.

728 was not another source-transfer failure. Six files reached main; the worker's
NO_GO artifact was published but its host-work authority reader compared effect
operation order with canonical scope order. Same paths/bytes/counts in different
orders produced EXACT_DOCKER_ACCEPTED_RESULT_READER_INVALID. Source now reconstructs
accepted work in the same normalizedScopeFiles order as its durable producer,
preserving all admission checks and the accepted effect array. Exact real artifact
reconstruction equals durable authority f5d922e88e8425962f84a3e6b5182e71f968f502f8d5ccc1788b609d4d82deaa.
Behavioral regression RED before repair; full91-case mounts suite PASS, including
two-path reversed effect order, NO_GO, hot acceptance and cold reader reopen.
These tests are hermetic/fake-Docker; not a new real-provider settlement proof.
Canonical current-source recovery dry-run subsequently resolved the actual728
planning read. Producer/consumer both use localeCompare, so cross-ICU ordering
remains a RELATED limit, as does the reader's generic multi-predicate error code.

Canonical recover --force --skip-audit completed after confirming no live worker:
2 exact task residues preserved under .deckent/archive/sprints/sprint-728/tasks/preserved/,
task SHA ff1077065bf58d856b0d68c47309937213ab02c873f81103f560bda4f9579640,
skill SHA68cb2c585048559667a994da478881901993254e1a4a9bdeba1a661af3daa7e3.
Checkpoint a463edfa4f4c2bb08453216d85481b05474dc15748f726f6759eb8e2b90a4f82
and137exactcustodyfiles digest00e4ee9021b695c3ab51f42642773d5303c64cecbf184b37cba99e1c6eaa7d1a
remain byte-identical. No replay, fake GO, or successful728 settlement was written.
Canonical bot stop2954262 succeeded; clean gate then ALLOW/reasons[].

The public MemoryStore readOnly/readSnapshot seam now avoids schema/init/WAL-mode
mutation and rejects async callbacks. Root verified current429learning tuples
(entry, tags, history, relations) against preserved backup and isolated restored
copy: all equal, no missing/changed/added entries. Aggregate logical digest
bc3f941394b218ff2e68e2d5cc2270985e51ec4df9c7c0be421b382505f36c80;
total3141, learnings429, relations1279. Live main-DB SHA
76f19889958f28da9e769f5dc0b6d0070562099bb87868922ed104f4effe7773
and34,824,192-byte size unchanged. Backup/restored-copy SHA
e328af74172fec33c1641cf5535ae5a8e8246178510f432237f9c871a00defd7.
This is actual full-learning semantic/read restore parity, not a raw SQLite
integrity-check or a guarantee against WAL reader SHM side effects on every host.

Real429restored-copy CLI exposed excessive projection size despite losslessness:
initial full summary712855B, then line-bounded summary348650B due inline metadata
repetition. Neither was published live. Same-package correction separates a short
summary, full-ID memory index, and one complete memory-details companion. The
3000-line optional human-view target is not a DB record cap or a target to fill.
Whole units exceeding view admission link to complete detail; no chopped clauses,
renumbered source IDs, or lost originals. All-record access may be transitive
summary→memory index→details; forcing all429IDs into summary was unnecessary.
Final built/live proof and remaining9002consumer closure are recorded separately.

### Final built and live proof — 2026-09-06T09:43:29Z

Manual export slice is LOCAL_VERIFIED. Root combined21files385tests PASS; exact
accepted-reader91PASS independently; final inline legacy-ID/CLI25PASS and config
zero-boundary47PASS; tsc0. Trusted observer success checks unchanged: deterministic
projection, legacy grouping, meaning-unit integrity, source preservation allPASS.
Independent review closed source full-provenance omission, single-line oversize
admission, concurrent writer interleave and config/renderer zero-boundary mismatch.
Gates config-writers, operating-policy and script-registry PASS. Not repo-wide CI.

Standard build:all exit0/sourceTree
a7d9d3368f1d7c0aaf06a325323ae302e5e01ac90e06c120ed3f6eae828dea60
(1374sourcefiles); native4e4dd558… unchanged. Dashboard chunk-size warning remains
advisory. Compiled public CLI verified on restored429copy in TR and EN/custom
config, then on real main via `node dist/cli/entry.js memory export` exit0.

| Projection | Before | Live verified |
|---|---:|---:|
| summary.md | 99 lines /6378B | 85 lines /5285B |
| memory.md | 4206 lines /399057B | 2956 lines /262027B |
| memory-details.md | absent | 6359 lines /1268766B |

Lines count includes final logical line, not just newline bytes. Cold details
intentionally increase export storage while removing hot-context duplication;
DB was not compacted physically or pruned. Detail anchors are within one file,
not429newfiles. Full429publicrows/content byte hashes and tags/history/relations
match preserved backup/restoredcopy/live. Original epoch IDs remain intact in one
legacy view group; no migration to actualSprint1 occurred. Recency uses validated
ordinal identity rather than giant epoch sprint_num. Null IDs retain their group.

Live export hashes: summary85cf52e1e3eaeed7715cae7e4a9ded894111620d873b48d8ae82b360cb4f7d56,
memoryac793d76fe2466f324fb0ad73f589e56603f1255abbbf338c06d1a40c932f40b,
detailsdaace181758ea652411c1b02e2db6ced3b4b01a4c2e167f947db610a894b1ac5.
Live DB SHA76f19889… and mtime04:20:32.124732160Z unchanged; full learning tuple
digestbc3f9413… matches backup, missing0changed0added0. Old4exports/config preserved
with full hashes/restore scope under
/home/alperen/deckent-recovery-20260904/manual-compact-exports-20260906-wR5XfS/.
Canonical config migration added only memory_export fourviewdefaults, all existing
keys unchanged. Config-resolved overrides reach CLI/identity/archive/finalizer;
summary zero-inline case succeeds. Mandatory ID index floor above a tiny requested
view budget emits a visible notice instead of silently removing records.

Fresh bot PID3173947 started on compiled build; no new sprint/dispatch. Exact728
custody137filedigest00e4ee90… still unchanged. Cached MCP was not reconnected and
is not claimed as fresh runtime proof. Canonical old728 result remains FAILED.

Remaining9002 acceptance is explicit: query-first/revisioned shared consumer
contract across planner/worker/MCP/bot/API/Dashboard, mandatory-context integrity
under their existing limits, and full prompt/terminal closure. Export materializes
the corpus intentionally for a complete cold snapshot; it is not the future
indexed query-first selector. Serialization+perfileatomic does not create an
all-fileset transaction for lock-free readers. No full9002DONE, authenticated
closure receipt, cross-provider provider-call settlement, commit or push claimed.

Fable377 (sha256 c7d596c06dae5d9b83a898d5fe53d842b6cc216e06adf6c72faf6691bf1aa912)
independently verified1261/1261compiledJS files, src-newer-than-dist0, build identity,
429unique detail links/anchors, current TR live outputs, freshbot3173947 PID/digests
and unchanged728/724custody modification times. This is attributed independent
read-only audit, not formal XVerify provider-usage/settlement closure. It observed
empty WAL and32KiB SHM auxiliaries created around export/startup; main DB content
and byte/mtime parity remain unchanged. Auxiliary filesystem side effects are
not excluded by SQLite readonly and are not manually removed. Same defaults exist
in config and low-level renderer fallback (RELATED drift risk). Source/tests/docs
diff-check passes; generated raw source content retains pre-existing trailing
whitespace instead of trimming original meaning-unit bytes. Compiled actual728
authority reconstruction also equals durable f5d922e8… after build.

## 10. Full9002 consumer closure — source inventory, 2026-09-06

Owner approved full9002 manual ADR-D-007 completion; export proof above does not
close these consumers. Manual lane inventory at main753e882b1 plus preserved dirty
source, not a new runtime attempt or settlement:

| Consumer | Source-grounded gap | Bounded correction |
|---|---|---|
| Planner | sprint-planner.readContext loads all memory/ADR; broad catch returns empty; planner priority block slices200lines | One scoped query-first projection; required context failure is typed, whole units preserved |
| Worker | task-builder separately reloads all ADR; agentic-worker-entry/http-agentic-worker use description rather than compiled host prompt | Exact compiled host context and relevant memory/ADR identity, no guest DB or silent bypass |
| CLI/Terminal/MCP | CLI recall and MCP tool open writable store; MCP resource returns full corpus; tool cuts content200chars | Shared readonly view, explicit continuation/detail and exact scope/revision |
| Bot | bot-agentic.readProjectContextSnapshot reads summary.md then slice6000 | Query-first selected complete units and visible insufficiency |
| API | search uses writable store; /api/memory serves global export outside record scoping | Shared readonly typed view under existing verified-principal tenant authority |
| Dashboard | MemoryExplorer filters Markdown lines, parses ADRs from wrong view; page duplicates read | Actual server search/filter/page/detail, same read state and source identities |
| Desktop | Current shell has no memory feature/consumer | Not an existing9002 adapter; no new UI/IPC authority added from parent9001 |

Explicit tenant plus missing tenant column currently skips the predicate in
memory-query: BLOCKS_CURRENT_DONE, same9002 correction. Legacy strict-off local
project authority is distinct from a verified tenant; no new tenant policy is
inferred from query parameters. Contract revision is selectionRevisionDigest of
an exact bounded selection, not a falsely global SQLite data_version revision.
Each read resolves query/scope/limits and preserves full selected meaning units;
oversize required context is HOLD, optional detail is digest-bound continuation.
DB/schema/retention/routing mutations and9001 graph/vector remain excluded.

CORE/C1/C2/root ownership and finite proof matrix are pinned in the existing
capsule. Config memory_read and EN/TR labels now consume the shared contract;
source implementation is in progress, not yet compiled or production verified.

### Integration corrections — source, 2026-09-06T14:04Z

The shared read contract now binds deferred detail/cursor identity to the
canonical per-entry history sequence. A real disposable public MemoryStore probe
had reproduced a same-second/same-length update returning changed content through
an older reference. Timestamp and byte length alone were insufficient. The new
regression rejects old detail/cursors; no live DB/schema rewrite was needed. This
does not claim detection of arbitrary out-of-contract raw SQL edits.

Planner previously retained a second unscoped debt read after selecting scoped
memory. It now projects memory/debt/pattern/accepted ADR plus latest identity/retro
from the same bounded read snapshot. Optional latest roles are absent when no
scoped record exists; present records remain whole or HOLD. This preserves context
without silently reading a second tenantless corpus.

Actual readonly worker preset probes on current DB produced
REQUIRED_ENTRY_OVERSIZE for core/test/cli/security/orchestra/provider with the
generic32KiB/200line view. The same service calls were AVAILABLE at128KiB/512lines.
Consumer defaults therefore distinguish worker authority context from short
interactive views. This is not an automatic floor over configured limits:
consumer default → authored shared memory_read → authored
memory_read_profiles[consumer]. Project beats global within shared and named
layers; explicitly named settings are more specific than shared settings.
maxEntries20/maxCandidates128 remain unchanged. Generic readers stay32KiB/200lines.
Optional read settings stay absent from createDefaultConfig so config migration
cannot accidentally persist implicit defaults as explicit owner caps. Normal
loadConfig/mergeConfigs and synchronous readonly projection resolve the same
profiles; no configuration healing or live mutation occurs in a memory read.

Supporting, not closure, evidence: core history/detail50/50; C3-BOT37/37;
root config/labels34/34 at this checkpoint. API loopback test timeout was separately
identified as listen EPERM in its execution environment; the same permitted
legacy regression passed57ms. Full consumer fan-in, compiled binary/UI checks,
independent verification and authenticated closure are still outstanding.

### Final consumer build and real-surface proof — 2026-09-06T14:51Z

This supersedes the preceding source-only checkpoint, not historical728 settlement.
All current9002 source lanes are frozen. Fable found one blocking final-composition
defect: a second200line planner cap silently dropped admitted sections, including
long DIRECTIVES. Production `buildPlanPrompt` now joins every admitted section
whole; the unused constant is removed and the old helper throws a typed overflow
instead of silently dropping. Existing provider capacity admission is unchanged.
Fable independently reproduced the compiled prompt byte-for-byte (ENTRY396), with
all8tail markers present: directives, memory, decisions, critical debt, retro,
patterns, identity and zero-config input. No truncated instruction is promoted.

Evidence bundle, outside the repository:
`/home/alperen/deckent-recovery-20260904/memory-read-surfaces-20260906-1xgBIN/`.

| Artifact | Exact proof / limit |
|---|---|
| `source-freeze-v3.json` | 37source paths; SHA`cc9af97f5c3658efe5590ab8c2d29540e8a7ed793a2ca50279a2d5d106eba257`; Fable37/37 match. Byte custody only, not staging ownership or settlement. |
| `planner-prompt-proof.json` | Actual compiled host producer;15959B, prompt SHA`e511fd889bd4ea494b371411f9a6d66e497454434f012f0a41fcf3e8e1fd0f1d`;8complete tails. No provider-delivery claim. |
| `worker-prompt-proof.json` | Actual compiled MemoryStore→task-builder→durable prompt bytes;18758B,23assertions, required/preset ADR tails and critical memory preserved, foreign tenant absent, missing required memory typedHOLD. Host producer only, not provider usage/settlement. |
| `memory-read-proof.json` | SHA`7a3dcab05fc245ff3ff259895c3cb0b2b38161634c0e2da20f42a5f41a50b85d`; actual compiled CLI/MCP subprocesses, actual HTTP server and built Dashboard in Chrome, PASS. |
| `dashboard-memory-proof.png` | SHA`e4c3ad9ef2a63a5240a3d1c997fa09bc588efba11c26edc565ab931113508fe7`; actual authenticated tenant-A `/memory-explorer`, inspected by root. |

Real surface assertions: bounded query, continuation and full oversized record
detail in CLI/MCP/HTTP; malformed cursor is typedHOLD (CLI exit1/MCP isError,
HTTPv1 typed envelope), legacy failed query is non2xx. HTTP used genuine ephemeral
RS256-signed bearer principals: missing401, tampered403, tenantA/B exact separation.
Browser covered `/memory` and `/memory-explorer`, actual full `COMPLETE_TAIL` in
detail and ADR tab data. This was not a mocked HTTP response or pre-rendered UI.
Disposable DB byte SHA before/after matched; temporary resources were closed and
removed. Tokens/private signing material were not stored in the proof artifact.

One browser helper failed before successful replay: `networkidle` cannot finish
with Dashboard's permanent `/api/events` SSE. HTTP-before-browser cleanup also
waited on that connection. The test was corrected to `domcontentloaded` plus actual
API-response/visible-locator readiness and bounded browser-first teardown. The
failed run remained exit1/PROOF_CLEANUP_HOLD; only its exact Chrome3392287 was
terminated to release teardown. Corrected harness SHA`fd3c62778c25f2790ba34b441780f2430abe0b4b5094b8a8ea43ef4c62cd0fb0`
passed with no product-source change or blind same-fingerprint retry.

Local supporting checks: root20suites309PASS; Dashboard3suites7PASS and Dashboard
TypeScript; C1 direct194PASS; final planner/constants3suites146PASS repeated by
root. Counts overlap and must not be summed. A separate current-vs-HEAD baseline
showed55shared brain/task-builder failures and2shared unhandled errors, no
current-only failure names; this is scoped-green, never a repo-green claim.
Two earlier fixture calls had appended injection-audit rows to the repo. The
prompt root is now threaded explicitly; rootless pure compilation does not write,
and actual temp-root audit production is tested. Later checks kept audit SHA
`16b935abc567303a89072ffac1bad7a3a667d1d515aa9d34481479f6d6dfd554`
at43484lines; historical pollution was not silently deleted.

Full `npm run build:all` PASS after canonical bot stop and fresh no-live-execution
ALLOW. Build sourceTree`b73222dbc35d2f220e35ade76a0b247d61b8b41ef1ea89dd63ed734662dcf29f`
(1378files), native binary`4e4dd558…` unchanged. Canonical bot restart/status
confirmed new PID3408718. Existing cached MCP processes are not declared fresh;
the proof spawned a new compiled MCP process. Main DB SHA`76f19889…`, config
SHA`b96707fe…` and old728FAILED truth remain unchanged.

Historical checkpoint, superseded for the proof boundary by the clarification
below: final independent UI verdict, mixed-diff safe landing and scope-exact
consumed MASTER settlement provenance remain separate from these passing proofs.
Bot bridge currently parses transient provider usage below its surface but does
not persist an invocation receipt; restarting the bot is not a provider-turn
proof. The retained worker728FAILED is never rewritten as success. No new graph/
vector engine, Desktop screen, DB mutation, feature sprint or fake receipt was
introduced. Public EN/TR docs describe only these existing read contracts.

### 2026-09-06T18:12Z — post-WSL proof and scope correction

Owner reported that WSL crashed and explicitly authorized continuation. The
previous bot3408718 liveness is historical, not current. Host process inspection,
canonical bot status and absent bot.pid confirm no live bot; canonical read-only
active-execution inspection returns ALLOW with no live sprint/worker. Retained
stale projections were not removed. The current main DB SHA76f19889… and config
SHAb96707fe… still equal the earlier protected baseline.

The owner-authorized manual9002 exception supersedes the old normal worker-to-main
settlement execution-path requirement for this outcome. MASTER's real binary and
dogfood-prompt proof means the actual compiled memory producer/consumer ingress;
it does not admit a new provider-delivery or durable-usage subsystem. Fable400 and
410 independently clarified this scope. Bot invocation usage persistence is a
RELATED_BUT_NONBLOCKING finding for the already queued7101, not a new9002 blocker.
Old728 remains RUN_FAILED. No real provider invocation or successful old-worker
settlement is claimed by the disposable proof below.

Post-WSL compiled ingress v2 uses a disposable MemoryStore through actual planner
readContext/buildPlanPrompt and bot grounding/system-prompt composition. Actual
bot query→opaque reference→whole detail returned100043bytes byte-equal; the same
reference under another tenant was denied before delegation. Required missing
context fails typed HOLD. Seven compiled module digests are pinned, and Fable408
independently matched them to current dist. Worker host prompt replay also passed;
these are actual compiled host consumers, not provider-process delivery evidence.

Dashboard HOLD now preserves canonical scope, requiredIds and localized explanation
and safe action for view and detail. Only invalid/stale cursor offers first-page
restart. Page replacement is labelled Next page. Focused3suites9tests and Dashboard
typecheck passed; fresh build:all completed17:46Z. The build identity excludes
Dashboard sources, so its unchanged sourceTree alone cannot identify the UI bundle.

Actual Chrome against compiled HTTP/JWKS/Dashboard passed page replacement,
CURSOR_STALE→explicit restart→AVAILABLE, DETAIL_CHANGED with requiredIds/scope,
and a genuine403 denial with localized safe UI. Only disposable fixture records
were intentionally updated to provoke revision changes; the main DB was not
queried or mutated. Root inspected all three adverse-state screenshots. This run
is at /tmp/deckent-memory-final-proof-5xSIo3, proof JSON
sha256:ffe60b8a0696800fedd9eac90a5a3f9051ef68205dac56d1ac3abd0eaba9e56e.
It is not yet durable archive evidence, and its JSON lacks executed bundle pins;
a distinct no-overwrite pinned proof is being prepared before landing.

Remaining: independent final UI verdict, durable proof archive/source+bundle
freeze, complete mixed-hunk landing map (including the14 consumer files omitted
by the first map), scoped landing and canonical MASTER closure provenance.
No MASTER DONE, commit, push or new feature sprint is claimed at this checkpoint.

### 2026-09-06T20:00Z — final main surfaces and durable proof

This checkpoint supersedes the earlier bot-down and unarchived-proof statuses.
Final main `npm run build:all` passed at19:30–19:31Z; canonical bot restart at19:38Z
created PID172833, independently checked against the actual bot-daemon entrypoint.
The native binary digest remains4e4dd558785cced4688979b219ac2648623f8bbf1f89a9f9fba8abab9913597f.
Main `.brain/memory.db` remains34824192bytes, SHA256
76f19889958f28da9e769f5dc0b6d0070562099bb87868922ed104f4effe7773.

Final proof archive (outside the repository):
`/home/alperen/deckent-recovery-20260904/memory-read-surfaces-20260906-1xgBIN/final-memory-v3/`.
Its `archive-manifest.json` SHA256 is
21d00ce5ecef1ff5b403f07a32147ce08cea0c6e016a8d4980e44d9ab4eb9a2f.
All16 exclusive-copy files were byte-verified against originals and independently
rechecked by Fable427. The archive is explicitly manual proof, not a settlement.

| Evidence | SHA256 | Exact boundary |
| --- | --- | --- |
| memory-bundle-proof-v3.json | 584c12e1eb9f9e7c3b5964cb92a8d1774997935842371a4adff68c3ba9982959 | Actual compiled CLI/MCP/HTTP and Chrome, pinned source and Dashboard bundle |
| browser/memory-read-proof.json | c80f2f35661b3d48317a9848f92270523954037877197d110b4e081e297ee452 | Real HTTP/JWKS fixture, no response mocks; seven screenshots |
| memory-ingress-proof-v2-post-ui.json | 16f2a4cf5033abdbe9c9f510fe525ccba207f58d142781ce4719e5cf00e1c762 | Compiled planner and bot memory consumers; disposable DB only |
| worker/worker-prompt-replay-pinned-v2.json | 5d498c4b5076cff2a9b990e35adbb01c3f6e298b5e61c1af9978382ae4638e32 | Actual host compiled prompt producer/CAS/reader/receipt byte parity, not provider delivery |

Final Chrome exercised EN/TR360×800 forms without control overlap, explicit
same-query retry after a genuine fixture database failure, keyboard focus return,
one persistent polite live-status region, scope-specific ABSENT, replacement
pagination, stale-cursor restart and detail-HOLD with canonical required IDs.
Genuine missing/tampered credentials and tenant separation remain tested. Fixture
database changes used to trigger adverse states were confined to disposable data;
the live DB was integrity-hashed, never queried by this proof. Root inspected the
screenshots and Fable425 independently returned PASS. Long project hex text clips
at narrow width: RELATED_BUT_NONBLOCKING, not a new admitted implementation item.
No native screen-reader, every-OS runtime, million-entry performance or HA claim
is made by this browser test.

Compatibility note: the legacy memory search adapter no longer turns a failed
read into successful empty data. Typed legacy HOLD uses HTTP409 with `{error,view}`;
query failures use503. The versioned endpoint returns the canonical read envelope.
This is an intentional observable error-contract correction, not silent success.
Public EN/TR memory guides and API references document the shared query/detail
contract. Memory budget labels now name retained-entry decay rather than an export
line budget; whole semantic units are selected, never cut mid-sentence.

Owner manual-completion authority is the original live instruction quoted in the
capsule. Fable relayed the owner's confirmation, “Evet done olana kadar dedim doğru
done yazınca bilgi verebilirsin”, observed2026-09-06T19:31:45Z; the original message
timestamp was not supplied. This is confirmation of scope, not a claim that DONE
has occurred. Final exact selected-tree verification and Git/provenance closure
remain outstanding at this checkpoint. Existing728RUN_FAILED is unchanged.

### Exact selected-tree proof and closure appendix

Runtime proof was repeated against HEAD753e882b153236e9a2605eb178bd38069e4ad969
plus the reviewed v7 selection, not the whole dirty main tree. Patch SHA256
e393e6d634116a544d2b2bdb2a9e62a06a17d52d844cb48f7a494c6ed882a6ca;
the exact checkout was `/tmp/deckent-9002-v7-final-rT2B3X`.
The selected-tree source and Dashboard builds passed. Fresh actual CLI/MCP/HTTP/
Chrome and compiled planner/bot/worker prompt consumers passed on that tree.
Fable430 independently matched the mixed-source differences to the selected tree:
these were not accidentally executed against the dirty main source.

Durable archive: `memory-read-surfaces-20260906-1xgBIN/selected-v7-proof/` under
the same external evidence root above. `manifest.json` SHA256
5be400594ec0e3f98c8e984d8aa75f976701244bb51e426d035edf2eb11e8280;
root independently rehashed all23 archived artifacts, zero mismatches.

| Selected-tree evidence | SHA256 |
| --- | --- |
| browser/memory-bundle-proof-v3.json | 43999e5767ad74ff3d1c96b55f1d3ab825358dfa802811de7d00ea44bb7a96ab |
| compiled/selected-v7-compiled-proof-binding.json | 561c0f79eb96310491152b3600eb696090bdb91cdadd7a8997ec68c00d4c76c8 |
| compiled/memory-ingress-proof-v2.json | a8a372f16bf75c79908fa49e27c1f8faa9753b58634f66ca6f80536740a1546b |
| compiled/worker-prompt-replay-pinned-v2.json | 971f697378eacf37b5d3f5f2114f296b3c1c16b455d4e3e3204398a9d6f8c769 |

Earlier selection-test results must not be inflated: a v6 broad batch was
565PASS/11FAIL, not26green suites. Seven identity-generator fixture-selection
failures required a test-only v8 selection repair. Root compared all85 selected
paths: the only v7→v8 byte difference is `tests/core/identity-generator.test.ts`.
The v7 runtime evidence remains explicitly labelled v7; final closure must bind
it to identical production sources, not pretend those executions used another
patch. Four planner-edge failures were compared against exact HEAD: both trees
reported47PASS/4FAIL with identical assertion names. Raw HEAD log SHA256
6a8aa7ce3c6da7e7ea48a90ac4c48218f32d4b80318a328b369129553b98d8a7;
v8 log SHA2561c28a6bdfec93cfc4302b39a17c2397a8ef06c109162f7d9e51424e0eedaa762.
These are inherited-at-HEAD planner parser fixtures, not9002 regressions or a
whole-repository green result. They remain RELATED_BUT_NONBLOCKING findings,
not silently admitted new work. Earlier
Dashboard/API runs on byte-equivalent v6 files are supporting inference only;
actual final-tree targeted reruns, their raw logs and digests govern landing.

The finalizer memory-export forwarding test isolates the unrelated canonical
skill-attribution writer. Selected HEAD emits an unprefixed logical settlement
digest into that separate writer; the test mocks that seam while asserting the
real memory label/render-option forwarding. It neither changes production
settlement semantics nor masks a missing memory assertion. The corresponding
runtime recovery writer change remains outside this9002 selection. Generic
proposal-registry accessor hunks are likewise excluded because they belong to
planner recovery rather than the memory host-proof profile registration.

Closure scope: C/W/E/H/L refer to source presence, all named memory ingress
wiring, effective configuration, hermetic semantic-integrity proof and actual
compiled user/prompt journeys. X/S are not a universal platform/HA certification
for this bounded read/export outcome: no such deployment threshold is declared
by9002. Cross-platform architecture and existing tenant isolation are retained;
the broader empirical platform/load/HA program remains explicitly in9001.
This distinction must not be turned into a claim of million-entry performance,
native Desktop UI implementation or successful728settlement.

Final selected v8 patch SHA256
5340e36a615c070716883101a36491b26bc94942c7d247140f5c87c1fbef9b74;
selection manifest968190aec38957322b1eb943c6fdaf3332714ff5b011318078f20585a04ae0bb.
`source-freeze-v5.json` SHA256
47d30798a15c50a9f4965556ce63d9852c8154bfaa45fdd149ebb52945449403
records85 selected and dirty-working file hashes separately;13 legitimately
differ due to mixed-hunk selection. All37 affected compiled non-Dashboard modules
are byte-identical between v7 runtime proof and v8 final build. Dashboard bundle
pins also match; the only source delta between these selected trees is the
identity test fixture. Fable432 independently verified all85+85 source pins,
28Dashboard pins and protected DB hash.

Final proof/test archive: `selected-v8-final/manifest.json` under the external
evidence root, SHA256
90c217069b63f51a3cdc4e026f1a570da38b43c59ba821f0358e9b4813af3c14.
It contains17 byte-verified files plus manifest, v7→v8 source/module comparisons,
and the earlier v7 runtime archive reference. Authoritative build logs show source
build and Dashboard build exit0. An earlier duplicate build was interrupted
before these successful root-owned builds; it is not a success claim.

| Final v8 targeted verification | Result |
| --- | --- |
| Identity generator, full suite | 32PASS |
| Init labels + production-wiring contract + host-proof harness | 55PASS |
| Finalizer memory-export option forwarding | 1PASS,55unselected |
| Dashboard four files, explicit Dashboard config | 28PASS |
| API memory-search + memory compact observer, outside sandbox | 11PASS |
| Brain readContext/reselection + worker whole-ADR/HOLD, filtered | 15PASS,474unselected |

These final groups are142 distinct passing tests, not the entire repository.
The last three groups were executed directly by root with `npx vitest run`, JSON
reporter and explicit output files on the exact final tree. Reporter files retain
all names/statuses:9002-v8-dashboard-root.json,9002-v8-api-observer-root.json and
9002-v8-prompt-memory-root.json. Earlier helper runs with empty stdout were rejected
and never counted as PASS; their cause was not established, so no cache/sandbox
root-cause claim is made. API unit fixtures explicitly disable authentication;
the separate real HTTP/Chrome proof uses genuine RS256 principals and validates
401/403/tenant separation. The unit fixture flag is not production configuration.

Final closure review is LOCAL_VERIFIED for9002; remote CI is ADVISORY_NOT_RUN.
The consumed GR-2026-09-06-MEMORY-MANUAL-CLOSURE-01 records actual owner manual
authority against reviewed parent753e882b1, with90 exact baseline targets. It is
post-hoc provenance, never an ACTIVE self-authorizing grant or runtime settlement.
The main MASTER was advanced OPEN→VERIFY with official generated projections;
memory-only staging preserves the separate3357 receipt/work changes. DONE is
permitted only after the scoped commit bytes match this selected freeze.
