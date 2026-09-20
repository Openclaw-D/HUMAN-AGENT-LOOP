# 03路清理记录 · 2026-09-20

writer：ZCode 03路。原则：停用→调用/测试/数据依赖检查→备份校验→删除；保住可靠性测试与可复用模板；数据库/对象存储不按目录名盲清。

## 已删除（ownership 内；均未 commit，工作树变更可随时恢复）

| 路径 | 理由 | 依赖检查 | 备份/恢复 |
|---|---|---|---|
| `Back/B/def03-stderr.txt` | 0 字节空文件（sha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 即空串哈希），2026-09-16 DEF-03 轮调试残留 | 全仓 grep（*.mjs/*.md/*.json）零引用；git 已跟踪文件，删除记录在案 | 空文件无可备份内容；如需恢复 `touch` 即可；git 历史亦有 |
| `Back/B/test/.tmp/stub-*`（218 项） | B 测试 harness 的陈旧临时目录（.gitignore `**/.tmp/` 内，时间戳 2026-09-19 旧轮运行残留，含 1 个 .tmp 半写文件） | tmpDir 由 `test/helpers.mjs` 每次运行新建、dispose 清理；陈旧目录无活跃进程持有（本轮测试前后各跑一遍全绿） | 不可恢复（临时测试态，无业务数据）；测试自动重建 |

## 检查后保留（防止误删，逐项留痕）

| 路径 | 保留理由 |
|---|---|
| `Back/C/rules/four-domain-rule-pack-v1.json` | 旧四域包=Connectors 缺省回归基线+历史回放（规则文件不可变语义）；C 101 项测试依赖 |
| `Back/C/scenarios/`、`Back/C/templates/`、`src/run-evaluation.mjs`、`src/run-e2e.mjs`、`src/run-contract-integration.mjs`、`src/case-checker.mjs`、`src/contract-adapter.mjs`、`MOCK_API.md`、`src/mock-server.mjs` | 非孤立：C 评测纪律基础设施与 case-pack/contract-adapter/eval-discipline 测试的消费对象；mock 模型 API=B 确定性模型替身的对端（真实 API 未授权期间的替身链）。属"可能复用模板/评测设施"，保留 |
| `Back/B/spike/celery/` | 技术 spike，结论存档且"采用与否待裁决"（SPIKE_RESULT.md）；裁决前不删 |
| `Back/B/evidence/`、`Back/C/evidence/` | 交付证据/哈希/清单（含既有轮验收记录），历史不删 |
| `Back/Connectors/.run/`（config/objects-*） | 活跃运行时配置与对象存储（48210 等在途栈可能持有）；纪律：不停未知进程、不盲清对象存储 |
| `Back/B/config/b-config.json`、`b-config.http-sample.json`、`b-config.four-domain-sample.json` | 本地配置/样例；four-domain 样例仍为 B worker 域模式入口（rulePackPath 可按 PROTOCOL §1 指向五域包） |
| `Back/B/HANDOFF-D.md`、各 README/STATUS/RESULT | 文档记录与恢复说明，非展示样例 |

## 未清理（超出 ownership 或需外部裁决）

- A/Edge/D/Front 内任何文件（非03路 ownership）。04路 PDF 夹具生成器缺陷另报（DEFECTS_REPORT.md），未代写。
- 旧全生命周期展示分支的入口断开属02路（Front）与04路（Edge 默认路径）；B/C/Connectors 内未发现被默认路径引用的全生命周期展示代码（四路目录皆为业务处理面）。
