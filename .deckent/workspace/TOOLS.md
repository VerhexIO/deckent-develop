<!-- DECKENT:WORKSPACE id="tools" schema="1" authority="managed" provenance="workspace-artifact-registry" -->
<!-- Bu dosya elle güncellenmiştir (2026-08-01); kalıcı çözüm AUTOGEN üretimidir — bkz. IDENTITY.md AUTOGEN blokları -->

# Environment Tools

Build: tsc
Test: npx vitest run
Lint: tsc --noEmit
Dev: tsc --watch
Coverage: npx vitest run --coverage
Dashboard: deckent web

## MCP Tools
<!-- DECKENT:CONTRACT id="tools" schema="1" sha256="a2b7041affc08bfc3479820e5e55b6dcb4347c1d2359f3a3c9ecc9d39e76abb1" -->
Bu tablo canonical MCP TOOL_CATALOG üzerinden üretilir; dosya adları asla tool olarak yorumlanmaz.

| MCP Adı | Etki | Onay | Idempotent |
|---|---|---|---|
| `deckent_init` | değiştirici | runtime policy gereği zorunlu | evet |
| `deckent_set_directives` | değiştirici | runtime policy gereği zorunlu | hayır |
| `deckent_plan` | değiştirici | runtime policy gereği zorunlu | hayır |
| `deckent_start` | değiştirici | runtime policy gereği zorunlu | hayır |
| `deckent_status` | salt-okunur | effect class gereği zorunlu değil | evet |
| `deckent_inspect` | salt-okunur | effect class gereği zorunlu değil | evet |
| `deckent_doctor` | salt-okunur | effect class gereği zorunlu değil | evet |
| `deckent_retro` | salt-okunur | effect class gereği zorunlu değil | evet |
| `deckent_history` | salt-okunur | effect class gereği zorunlu değil | evet |
| `deckent_analyze_project` | salt-okunur | effect class gereği zorunlu değil | evet |
| `deckent_sync` | değiştirici | runtime policy gereği zorunlu | evet |
| `deckent_config` | değiştirici | runtime policy gereği zorunlu | hayır |
| `deckent_review` | salt-okunur | effect class gereği zorunlu değil | evet |
| `deckent_run` | değiştirici | runtime policy gereği zorunlu | hayır |
| `deckent_kill` | yıkıcı | runtime policy gereği zorunlu | hayır |
| `deckent_cleanup` | yıkıcı | runtime policy gereği zorunlu | hayır |
| `deckent_help` | salt-okunur | effect class gereği zorunlu değil | evet |
| `deckent_agent_list` | salt-okunur | effect class gereği zorunlu değil | evet |
| `deckent_skill_list` | salt-okunur | effect class gereği zorunlu değil | evet |
| `deckent_checkpoint` | değiştirici | runtime policy gereği zorunlu | hayır |
| `deckent_docs` | değiştirici | runtime policy gereği zorunlu | evet |
| `deckent_explain` | salt-okunur | effect class gereği zorunlu değil | evet |
| `deckent_memory_query` | salt-okunur | effect class gereği zorunlu değil | evet |
| `deckent_watch` | salt-okunur | effect class gereği zorunlu değil | evet |
| `deckent_nervous_subscribe` | salt-okunur | effect class gereği zorunlu değil | evet |
| `deckent_nervous_accept` | değiştirici | runtime policy gereği zorunlu | hayır |
| `deckent_nervous_reject` | değiştirici | runtime policy gereği zorunlu | hayır |
| `deckent_nervous_status` | salt-okunur | effect class gereği zorunlu değil | evet |
| `deckent_nervous_config` | değiştirici | runtime policy gereği zorunlu | hayır |
| `deckent_feature_query` | salt-okunur | effect class gereği zorunlu değil | evet |
| `deckent_truth` | salt-okunur | effect class gereği zorunlu değil | evet |
| `deckent_audit` | yıkıcı | runtime policy gereği zorunlu | hayır |
| `deckent_recover` | yıkıcı | runtime policy gereği zorunlu | hayır |
| `deckent_models` | değiştirici | runtime policy gereği zorunlu | hayır |
| `deckent_autonomous` | değiştirici | runtime policy gereği zorunlu | hayır |
| `deckent_process` | değiştirici | runtime policy gereği zorunlu | hayır |
| `deckent_usage` | salt-okunur | effect class gereği zorunlu değil | evet |
| `deckent_xverify` | değiştirici | runtime policy gereği zorunlu | hayır |
| `deckent_kpi` | salt-okunur | effect class gereği zorunlu değil | evet |
| `deckent_cost` | salt-okunur | effect class gereği zorunlu değil | evet |
| `deckent_agent_manage` | yıkıcı | runtime policy gereği zorunlu | hayır |
| `deckent_skill_manage` | yıkıcı | runtime policy gereği zorunlu | hayır |
| `deckent_memory_manage` | yıkıcı | runtime policy gereği zorunlu | hayır |
| `deckent_autonomous_backlog` | yıkıcı | runtime policy gereği zorunlu | hayır |
| `deckent_autonomous_status` | salt-okunur | effect class gereği zorunlu değil | evet |
| `deckent_nervous_edit` | salt-okunur | effect class gereği zorunlu değil | evet |
| `deckent_nervous_undo` | salt-okunur | effect class gereği zorunlu değil | evet |
| `deckent_autonomous_approve` | değiştirici | runtime policy gereği zorunlu | hayır |
| `deckent_autonomous_reject` | değiştirici | runtime policy gereği zorunlu | hayır |
| `deckent_execution_authority` | değiştirici | runtime policy gereği zorunlu | evet |
| `deckent_approvals` | salt-okunur | effect class gereği zorunlu değil | evet |

Toplam: 51
<!-- DECKENT:CONTRACT:END id="tools" -->

## CLI Commands
<!-- DECKENT:CONTRACT id="tools" schema="1" sha256="1e9c110405892fb925896a00a52fd8cd68988ab84f5ec53459ddc0f1e1d3be20" -->
Bu tablo kayıtlı cross-surface command tree üzerinden üretilir; helper module dosya adları dışlanır.

| Komut | Kategori | Risk | Yüzeyler |
|---|---|---|---|
| `deckent agent` | Core | Değiştir | cli, mcp, repl |
| `deckent analyze` | Core | Değiştir | cli, mcp, repl |
| `deckent approvals` | Enterprise | Değiştir | cli, mcp |
| `deckent archive` | Core | Değiştir | cli |
| `deckent archive-debt` | Core | Oku | cli |
| `deckent attach` | Run | Çalıştır | cli |
| `deckent audit` | Core | Çalıştır | cli, mcp, repl |
| `deckent audit-verify` | Core | Oku | cli |
| `deckent autonomous` | Enterprise | Otonom | cli, mcp, repl |
| `deckent autonomous-mission` | Enterprise | Otonom | cli |
| `deckent bot` | Enterprise | Çalıştır | cli |
| `deckent chat` | Run | Çalıştır | cli |
| `deckent checkpoint` | Run | Değiştir | cli, mcp, repl |
| `deckent cleanup` | Danger | Değiştir | cli, mcp, repl |
| `deckent config` | Core | Değiştir | cli, mcp, repl |
| `deckent confirmations` | Enterprise | Değiştir | cli |
| `deckent connect` | Core | Oku | cli |
| `deckent cost` | Enterprise | Değiştir | cli, mcp |
| `deckent cu-status` | Core | Oku | cli |
| `deckent dashboard` | Core | Oku | cli |
| `deckent do` | Run | Çalıştır | cli, repl |
| `deckent docs` | Core | Değiştir | cli, mcp |
| `deckent doctor` | Core | Değiştir | cli, mcp, repl |
| `deckent evolve` | Enterprise | Oku | cli |
| `deckent execution-authority` | Enterprise | Değiştir | cli, mcp |
| `deckent explain` | Memory | Oku | cli, mcp, repl |
| `deckent features` | Core | Oku | cli, mcp, repl |
| `deckent finalize` | Run | Değiştir | cli |
| `deckent flow` | Enterprise | Çalıştır | cli |
| `deckent gateway` | Enterprise | Çalıştır | cli |
| `deckent gateway-runtime` | Enterprise | Otonom | cli |
| `deckent heartbeat` | Run | Çalıştır | cli |
| `deckent help-info` | Core | Oku | cli, mcp, repl |
| `deckent history` | Memory | Oku | cli, mcp, repl |
| `deckent image` | Core | Değiştir | cli |
| `deckent init` | Core | Değiştir | cli, mcp |
| `deckent inspect` | Core | Oku | cli, mcp |
| `deckent intelligence` | Core | Değiştir | cli |
| `deckent kill` | Danger | Çalıştır | cli, mcp, repl |
| `deckent kpi` | Core | Oku | cli, mcp, repl |
| `deckent limits` | Core | Oku | cli |
| `deckent local-llm` | Core | Çalıştır | cli |
| `deckent mcp` | MCP | Değiştir | cli |
| `deckent memory` | Memory | Değiştir | cli, mcp |
| `deckent mode` | Core | Değiştir | cli |
| `deckent models` | Core | Değiştir | cli, mcp, repl |
| `deckent nervous` | Enterprise | Değiştir | cli, mcp, repl |
| `deckent onboard` | Core | Değiştir | cli |
| `deckent openrouter-probe` | Core | Oku | cli |
| `deckent output` | Core | Oku | cli |
| `deckent plan` | Run | Değiştir | cli, mcp, repl |
| `deckent plan-nl` | Run | Değiştir | cli |
| `deckent plugin` | Core | Değiştir | cli |
| `deckent process` | Enterprise | Çalıştır | cli, mcp |
| `deckent provider-authority` | Enterprise | Değiştir | cli |
| `deckent provider-observations` | Enterprise | Değiştir | cli |
| `deckent rbac` | Enterprise | Değiştir | cli |
| `deckent recall` | Memory | Oku | cli, mcp, repl |
| `deckent recover` | Danger | Değiştir | cli, mcp, repl |
| `deckent remember` | Memory | Değiştir | cli |
| `deckent resources` | Core | Oku | cli, repl |
| `deckent resume` | Run | Çalıştır | cli, repl |
| `deckent retro` | Memory | Oku | cli, mcp, repl |
| `deckent review` | Run | Değiştir | cli, mcp, repl |
| `deckent run` | Run | Çalıştır | cli, mcp |
| `deckent runs` | Run | Değiştir | cli, repl |
| `deckent serve` | Run | Çalıştır | cli |
| `deckent set-directives` | Run | Değiştir | cli, mcp, repl |
| `deckent skill` | Core | Değiştir | cli, mcp, repl |
| `deckent spawn` | Run | Çalıştır | cli |
| `deckent start` | Run | Çalıştır | cli, mcp |
| `deckent status` | Core | Oku | cli, mcp, repl |
| `deckent sync` | Core | Değiştir | cli, mcp, repl |
| `deckent task` | Run | Değiştir | cli |
| `deckent test` | Run | Çalıştır | cli |
| `deckent trace` | Core | Değiştir | cli |
| `deckent truth` | Core | Değiştir | cli, mcp |
| `deckent upgrade` | Core | Çalıştır | cli |
| `deckent usage` | Core | Değiştir | cli, mcp, repl |
| `deckent watch` | Run | Oku | cli, mcp |
| `deckent xverify` | Core | Oku | cli, mcp |

Toplam: 81
<!-- DECKENT:CONTRACT:END id="tools" -->
