# STATUS｜A路主集成（V6-API-MAIN）

- 接手：2026-09-13 23:06（北京时间）；截止 2026-09-14 09:00。本文件 A 独占维护，滚动更新。
- **终态（08:17 终检）：接线完成、模拟链路全绿、真实调用待配置（未配置，未伪称接通）。3467 全夜健康（约 20 个检查点 HTTP 200），RESULT.md 已确认为终态交付。**

## 可测试入口（2026-09-13 23:55 更新）

- 唯一预览 URL：`http://127.0.0.1:3467/v5-preview/remote-session`（访谈页；总览 `/v5-preview`）
- 运行实例：`next dev`（Turbopack），PID **25748**，监听 127.0.0.1:3467
- 运行目录：`jianwei-v3/se-preview-20260913/`（预览副本；源→副本白名单同步，源/运行一致）
- 数据目录：`V6/handoff/SE_REBUILD_20260913/runtime/data/`（V5_PREVIEW_DATA_DIR，未重置未清空；重启前快照见本目录 `baseline-runtime/`）
- 3311 / 3321 / 3399 未触碰（只读）

## D 路测试许可（QA_PLAN 对应）

- **可以开始测试 3467**。遵守 QA_PLAN 的 `[D-QA 合成]` 会话标识与写窗口约定；A 演示会话为 `rs-mtzpo3q1-j33xtuqj`（勿在其中点击写按钮）。
- 注意：23:52 A 在该演示标注 `an-mtzqv4g1-6brc3fc7` 上做过一次 simulate 探针（生成一轮 9 条 model_simulation 回复，remoteVersion 6→7）——A 自己的写入，非污染，如实记录。
- 未配置状态下真实按钮为禁用态（文案「模型辅助分析（真实·未启用）」），R7 可直接验收。

## 源码版本（本次改动清单）

| 文件 | 变更 | 说明 |
| --- | --- | --- |
| `lib/v5-preview/remote-service.ts` | M | +`analyzeAnnotation`（真实分析主路径）、+`getModelConfigStatus`、+`RemoteModelServiceError`、+调用账本/预算20、F-001 修复（simulate await 后重读最新 store 合并写入） |
| `lib/v5-preview/remote-types.ts` | M | ReplyKind + `model_real`（兼容分支，旧记录不迁移） |
| `lib/v5-preview/remote-store.ts` | M | reply kind 校验白名单 + `model_real` |
| `lib/v5-preview/remote-model-adapter-bridge.ts` | M | candidate 元数据透出 `usage`/`usageUnknown`（类型+赋值） |
| `lib/v5-preview/model-adapter/providers/http-fetch.mjs` | NEW(B集成) | B 路 `server-http-transport.mjs` 经审查集成（仅改 import 一处；SHA256 `b4d34d8b…c11c6708` 全值见上）；原 interim 已删除 |
| `app/api/v5-preview/remote-session/annotations/analyze/route.ts` | NEW | `POST /api/v5-preview/remote-session/annotations/analyze`（CONTRACT §5） |
| `app/api/v5-preview/remote-session/model-status/route.ts` | NEW | `GET /api/v5-preview/remote-session/model-status`（无秘密布尔状态） |
| `app/v5-preview/remote-session/page.tsx` | M | 真实分析入口按钮（未配置禁用+原因）、`model_real` 回复标签「模型辅助（真实）」、演示设置区配置状态行、model 错误码 userFacing |
| `app/v5-preview/remote-session/se-interview.module.css` | M | `data-kind='model_real'` 深色标签样式（与模拟琥珀区分） |

- 基线快照（改动前 SHA256 + 副本）：`V6/handoff/MODEL_API_DEMO_20260913/baseline/`
- 改动后源/副本一致性：`diff -rq` app/ lib/ 无差异（23:58 复核）
- 合同：`V6/handoff/API_OVERNIGHT_20260913/CONTRACT.md`（23:10 冻结；B/C/D 均已按其交付）

## 配置缺项（真实接通唯一缺口）

服务端环境变量全部未配置（3467 启动命令与本机均无）：

1. `JIANWEI_MODEL_BASE_URL` —— OpenAI Chat Completions 兼容端点 base
2. `JIANWEI_MODEL_NAME` —— 模型名
3. `JIANWEI_MODEL_API_KEY` —— 产品密钥（用户确认后注入，不落码/不打印）
4. `JIANWEI_MODEL_MODE=real` —— 启用真实模式（缺省 simulation 不发起真实调用）
5. 可选 `JIANWEI_MODEL_TIMEOUT_MS`（5000–120000，缺省 20000）

配置齐全后需一次受控重启 3467（保留同数据目录），真实入口即自动启用；预算 20 次上限内 A 从页面执行真实闭环。

## 验证证据（已完成）

- **M1 全链路 socket 级验证（00:23–00:26，CHAIN COMPLETE；run2 日志为准）**：一次性隔离实例（3468、独立副本目录 `se-verify-20260913/`、独立临时数据目录）+ 本地 mock Chat Completions 端点（3501）。配置齐全后自动启用真实入口，完整走通：建会话→附证据→C 的 S2-Q 标注→真实分析①→客户补充（business）→真实分析②→人工更正（domain）→真实分析③→刷新读回。三次分析 `basedOn.remoteVersion` 递进（v5→v7→v9），模型请求内人工回复条数 0→1→2（enrich 真实带回新内容），读回 9 条 model_real + business/domain 共存，usage 如实（mock 计 270 tokens/次，真实调用账本 3 次）。**这是 socket 级真实 HTTP 路径验证，模型为本地 mock——不代替真实 provider 调用验收；真实模型调用仍为 0 次。**证据：`socket-verify-run2.log`、`evidence-ui-model-real.png`（model_real 深色标签与业务/模拟可区分）、`socket-verify-data/remote-store.json`。验证实例与 mock 端点已清理。
- 本套件 16/16 通过：`test/v5-preview-remote-real-analysis.test.mjs`（未配置/MODE未real/成功链路含 enrich 正文与人工纠正进请求/幂等/再分析不回灌/HTTP错误·非JSON·越权输出·异常四形态不落库/等待期间暂停·纠正·证据取代三种 MODEL_RESULT_STALE/预算 20/状态无泄密/F-001 并发回归；RA13/RA14 按 B 路集成版 transport 语义更新）
- 既有回归 58/58：remote 全套 + model-bridge（compat/registry/repair/timeline）
- `tsc --noEmit` 通过；改动文件 eslint 0 error（warning 均为基线已有）
- 3467 实测：`GET model-status` → 如实未配置；`POST annotations/analyze`（未配置）→ 503 `MODEL_NOT_CONFIGURED` 含缺项清单；detail/page 200；UI 未配置态截图 `evidence-ui-unconfigured.png`
- 真实模型调用次数：**0**（无凭据，未发起；预算 0/20）

## 已接收交付与集成

- **C（cases）23:35 已交付**：M1 主案例 + V1/V2 变体 + 最简访谈提纲 + 材料类目核对。enrich 字段名与 CONTRACT §2 一致；C 假设 purpose=`follow_up_generation`，实际实现为 `credit_review`（bridge 角色表授权，语义更准，已记录不影响 C 的 JSON 步骤驱动）。
  **M1 已预置进演示首会话**（页面只加载 sessions[0]，故 M1 非模型步骤入位 `rs-mtzpo3q1-j33xtuqj`）：fixture-contract + fixture-equipment 证据已附着（requestId `m1-seed-attach-*`），信审标注 `an-mu00li0r-ze3muna6` 已建（C 的 S2-Q 问题原文，绑定设备清单证据 v1）。**人工补充/纠正（C 的 S3-R1/S4-R2 文本）与三次真实分析留给配置后的现场演示**，文本在 `cases/main-case.model-input.json`。
- **B（transport）00:00 已交付并完成集成**：`server-http-transport.mjs` 经审查复制为 `site/lib/v5-preview/model-adapter/providers/http-fetch.mjs`（仅按 B 说明改一条 import；采用版 SHA256 `b4d34d8b7e63129d3211b82f7c03efaab37964cb4fd0d5b41e9ea16ca11c6708`）。B 自身 28/28 测试通过；interim transport 已删除（B 为唯一实现）。A 侧适配：`.mjs` 推断类型按窄接口收口（remote-service.ts 内，与 bridge 候选收口同模式）；密钥脱敏上移到 A 路由层（`redactConfiguredKey`，B 文件保持零改动）。A 的 16/16 套件与既有回归在切换后复跑全绿（含 RA14 按 B 语义更新：取消→`indeterminate`）。
- **D（qa）进行中**：regress-api run1 的 T1/T2 失败为其脚本发送体格式问题（T0 通过；产品端返回 INVALID_INPUT 是对坏 JSON 的正确拒绝）。**F-001 A 已修复**（remote-service.ts，await 后重读最新 store 合并写入；标注消失则不写入），RA11b 回归覆盖，待 D 复测（F-001-RETEST）。D 并发测试期间 store remoteVersion 已推进至 35+（各自会话，互不干扰）。

## 恢复清单

1. 代码回退：`V6/handoff/MODEL_API_DEMO_20260913/baseline/*.orig` 覆盖回 site 源 + 同步预览副本（5 文件 M；NEW 直接删除：http-fetch.mjs（B 集成）、analyze/route.ts、model-status/route.ts；并把 remote-service.ts 的 import 改回基线形态——若回退到 .orig 则自动不含该 import）
2. 数据回退：`V6/handoff/API_OVERNIGHT_20260913/baseline-runtime/*.pre-restart.json` 覆盖 `SE_REBUILD_20260913/runtime/data/`（remote-store 快照 @remoteVersion 6 前状态）
3. 3467 重启命令（副本目录，避开 repo dev 锁）：
   `cd jianwei-v3/se-preview-20260913 && V5_PREVIEW_DATA_DIR="C:/Users/22673/Desktop/Anthropic/V6/handoff/SE_REBUILD_20260913/runtime/data" node node_modules/next/dist/bin/next dev -p 3467 -H 127.0.0.1`
4. 当前 PID 25748；日志：`V6/handoff/API_OVERNIGHT_20260913/dev-3467.log`

## 剩余问题 / 下一步

1. 真实调用待配置（上述 5 项）；配置后走「页面合成问题 → 真实分析 → 人工纠正 → 再分析 → 刷新读回」全链路并记录 usage
2. B 路交付后的 transport 审查集成
3. D 的界面回归（R1–R8）与 F-001-RETEST
4. 长期（非本夜）：simulate 幂等 payload 含 expectedVersion 的既有语义（D 记录，不在本轮修）

## A 对 D run4 T10b 的分析（01:05，供 D 核对后复测）

- run4 的 T10b FAIL（final_sim=9）与 F-001 修复不矛盾：run4 实际走的是「A=409（版本门拒绝，设计行为）→ 顺序双发 race-b2/race-a2」路径。**第二个串行 simulate 命中产品既有语义「每条标注只生成一轮」而如实 no-op**（`simulated:false`，REVIEW_NOTES §2 亦有记录），所以最终 9 条 = 第一次写入的全部回复，无丢失。
- 真正的 F-001 并发竞态（两请求都通过「无模拟回复」门后交错写）已由 A 的回归 RA11b 覆盖（Promise.all 真并发：版本单调 +1/+1、双方回复并存）。D 当前版本的 regress_api.py 判定已改为「写入/如实no-op/409 三态」，按新脚本复测（F-001-RETEST）应可通过；若仍 FAIL 请把 `lost` 明细写入 qa，A 即修。

## M1 标注文本修复记录（01:20，A 对自有演示数据的一次直接修店）

- seed-m1.sh 以 bash argv 向原生 python 传中文导致 UTF-8 双重编码损坏（339 字符乱码，ASCII 完好）。已用 python（显式 utf-8 + temp+rename 原子写）将 `an-mu00li0r-ze3muna6.question` 修复为 C 源文件原文，**与 `main-case.model-input.json` 逐字符一致（240 字符）**，API 读回验证通过（remoteVersion 80 不变）。修店时机在 D 交付（00:55）之后、无并发写入窗口；此后种子/驱动脚本一律用 Node（socket 验证链路的中文全程无损已证明）。
