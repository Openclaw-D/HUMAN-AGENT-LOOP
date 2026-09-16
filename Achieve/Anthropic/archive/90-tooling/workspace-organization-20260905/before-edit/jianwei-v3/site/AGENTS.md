# 见微项目执行约束

## 产品权威

1. 当前用户明确决定优先。
2. 工作区根部 `../../NORTH_STAR.md` 是 V4 当前最高产品权威；`../../DECISIONS.md` 记录已冻结决定。
3. 工作区根部 `../../CHALLENGE_LOG.md` 与 `../../ROADMAP.md` 分别约束待解问题和收敛顺序。
4. `docs/v4/CONTRACT.md` 与 `docs/v4/ACCEPTANCE.md` 是当前项目级契约和 Gate；旧实现文档保存在 `docs/archive/v4-pre-life-20260902/`，只作 Candidate。
5. `docs/archive/root-legacy-20260903/**`、`docs/archive/v3-archive/**` 与 `v3.0.0-archive` 只作历史证据。
6. 本仓库根部只保留活动 README、STACK、CHANGELOG 与本执行约束；产品决定和路线只读工作区根部当前 authority。
7. 历史 P1、Unity 和研究材料只作证据，不恢复十场景、政策统领全域或通用平台方向。

首期实现核心固定为政策、信审、商务、资产四域；商机与尽调只作为上游项目 Context，不建设对应模块。现有派驻制、逐级报批、岗位责任和关键角色否决权不得改变；跨域工作可以按依赖受控并行，但不能绕过正式 authority。模型和 Agent 永远 `authority=none`；正式动作必须来自具名 Human Gate 或组织明确授权的确定性规则，并产生真实 Receipt；失败或 unknown 失败关闭；Evidence/Event 只追加不覆盖。

## 代码与声明边界

- 只使用合成、去标识和公开材料；
- 不读取、复制或推断集团未授权内网代码、客户数据、制度全文、凭据或商业秘密；
- Adapter 默认 fake/stub，不得写成已接真实系统；
- 当前 runtime 是进程内演示态，不得声称生产持久化；
- 产品模型凭据只使用 `JIANWEI_MODEL_API_KEY`，不得复用 coding runner `ZAI_API_KEY`；
- 不得让前端自行产生权威状态、Context Packet 或 Receipt；
- 修改 API/状态语义时同步更新测试、`docs/v4/CONTRACT.md`、`docs/v4/ACCEPTANCE.md`、STACK 与 CHANGELOG 中受影响内容；不得更新已归档 V2/V3 契约来制造一致性。

## ZCode Harness 自适应并发

本项目中，经用户明确分配给 ZCode 的中大型实现任务，使用独立运行的 **ZCode 桌面应用及其原生 Harness**，不再经 `invoke-glm53.ps1` 或旧 coding runner 转发：

1. 中大型任务在共享 schema、接口与状态语义串行冻结后，由 ZCode 主 Agent按真实独立任务数和平台实测容量启动原生 subagent；每路必须有明确目标、输入、禁止项、精确文件所有权、验收证据与停止条件。
2. Codex 与 ZCode 可以同步工作，但 writer ownership 必须互斥；双方不得同时修改同一文件、同一模块写面、共享契约、迁移或运行时状态。
3. ZCode 可在用户授权的 ownership 内负责项目级实现契约、架构细化、后端、测试、常规前端与整合；根部产品 authority、组织制度和用户冻结决定不得自行改写。
4. ZCode 的所有 lane 之间同样实行单文件单 writer。共享类型和接口由主 Agent 先冻结，lane 完成后再由主 Agent 串行整合，运行期间不得互相“顺手修改”他路文件。并发 Agent 数可以高于 writer 数。
5. 不把 Harness 或 subagent 自报完成当成通过；最终结果必须以 diff、测试、typecheck、lint、build、API Gate 与明确未验证项为证据。
6. 任何限额、异常终止、越权写入、测试未运行或依赖冲突都单独报告；不得静默换模型、删改用户文件或隐藏失败。
7. 不为凑并发伪造任务。当前用户已对 V4 四域后端 Goal 追加一次目标 20 个同时运行 subagent 的受控试验；最多 4 个 lane 可写且必须互斥，其余只读。20 不是已确认平台上限或长期默认值，以真实 started/completed/throttled Evidence 为准。
8. ZCode 不得把共享工作区或本任务授权解释成操作 Codex 的授权。通过 Computer Use、浏览器自动化、CLI、URI、MCP、插件、脚本或其他机制读取/控制 Codex、输入或发送内容、创建线程、修改设置/历史/Memory 前，必须先在当前 ZCode 对话中说明精确动作并询问用户；只有用户随后明确回复 `同意使用 Codex` 才能执行。该授权单次、限范围、不可转授，旧授权无效；没有回复时继续使用本地 Markdown 和用户手动转交。

## 交付 Gate

- Node 全量测试；
- `npm.cmd run lint`；
- `npm.cmd run build`；
- 对 API 变更运行 HTTP quality gate 和必要 soak；
- 对 UI 变更由 Codex Control 使用 Codex in-app Browser，在 1920×1080 响应式侧栏验收并检查 console；本条不授权 ZCode 操作 Codex；
- 扫描凭据、生成物和 Git 状态；
- 不隐藏失败或未验证项，不把本机结果外推 SLA。
