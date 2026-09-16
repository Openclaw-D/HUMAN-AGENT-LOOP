# ZCode V4 四域后端长期 Goal

状态：`USER-AUTHORIZED / FROZEN EXECUTION BRIEF / 2026-09-03`

## 1. 唯一目标

在现有 `lib/v4life/` Candidate 基础上，完成一个可以被前端稳定调用、可重放验证、失败关闭、边界清楚的“小微大风控四域协同后端垂直切片”。它服务政策、信审、商务、资产四域，不建设通用 Agent 平台、CRM 或完整 BPM。

本 Goal 使用 ZCode 原生 Harness 持续推进。除真实阻塞外，不在计划或半成品处停止；先冻结接口，再启动恰好四个并发 lane，最后由 ZCode 主 Agent 串行整合与验收。

## 2. 不可改变的产品语义

- 产品核心仅为政策、信审、商务、资产；商机与尽调只是上游 Context，不新增对应模块。
- Human 是责任与 authority 主体；Agent/模型始终 `authority=none`，只能生成 Evidence 处理结果、Candidate、提醒、草案或 Action Intent。
- 工作由 Evidence/Dependency/Receipt 图驱动，允许无依赖事项跨域并行；正式前序、权限 Gate 与高成本动作必须等待。
- 批准、退回、否决只能由具名且有权限的 Human Role 作出。批准/否决产生不可变 Receipt；退回不产生通过 Receipt，并把相关工作退回可继续状态。
- 否决只停止真实依赖的后续工作；既有 Evidence、专业判断、事件和人员贡献不得删除或归零。
- 所有正式动作追加留痕；未知、冲突、权限不足或版本竞争均失败关闭。
- 只使用合成案例和去标识数据，不接真实客户、内网制度、凭据或生产系统。

## 3. ZCode 独占写入范围

Goal 运行期间，ZCode 独占：

- `lib/v4life/**`
- `app/api/v4life/**`
- `test/v4life-*.test.mjs`
- `scripts/v4life-*.mjs`
- `docs/v4/CONTRACT.md`
- `docs/v4/ACCEPTANCE.md`
- `docs/v4/BACKEND_PROGRESS.md`

本文件只读。Codex 在 ZCode 交付前不修改上述路径。

## 4. 禁止范围

- 不修改工作区根部 `NORTH_STAR.md`、`DECISIONS.md`、`ROADMAP.md`、`CHALLENGE_LOG.md`、`versions/V4/**` 或 `AGENTS.md`。
- 不修改 `lib/v4/**`、既有非 v4life API、前端页面、视觉稿、`package.json`、lockfile、依赖、环境变量或部署配置。
- 不安装依赖，不 commit/push/tag，不启动或结束未知 localhost，不调用真实模型 API，不读取或写入任何密钥。
- 不把进程内或测试适配器描述为生产数据库、生产 RBAC 或真实系统接入。

## 5. 串行 Phase 0：先冻结共享接口

ZCode 主 Agent 先审计当前 Candidate，并在 `docs/v4/CONTRACT.md` 中冻结以下 exact contract，再派发 lane：

- `Case / Actor / Evidence / WorkItem / Dependency / Candidate / HumanDecision / Receipt / Contribution / Event / Projection` 的字段、标识和不可变规则；
- command、query、error envelope 和 HTTP 状态映射；
- 状态迁移、角色权限、依赖三分法、事件顺序、分页、幂等与版本竞争语义；
- 存储 port 与重放接口，但不绑定具体生产数据库；
- Golden Case 合成 fixture 及四个核心证明点。

同一 idempotency key + 同一规范化 payload 返回 replay；同 key + 不同 payload 必须返回 conflict。公开 Projection、Event 和 Receipt 不得暴露可变内部引用。

## 6. Phase 1：恰好四个并发 lane

共享接口冻结后，ZCode 主 Agent 同时启动四个 subagent；派发时进一步列出逐文件 ownership，四路不得重叠写文件。

### Lane A｜领域状态机

负责领域类型、状态迁移、Human Gate、依赖启动/等待/停止、Candidate 去重、贡献保留和 Golden Case seed。重点验证 Agent 不得改变正式状态、退回/否决语义、跨域非线性并行与深拷贝边界。

### Lane B｜Store 与重放

负责无外部依赖的存储 port、内存适配器、事件追加、单调 sequence、导出/导入重放和乐观版本冲突测试。目标是证明进程重建后可由事件恢复等价 Projection；不假装已经选择生产数据库。

### Lane C｜HTTP/API

负责 v4life Route Handlers、请求验证、统一错误 envelope、权限/版本/idempotency 参数、事件分页和进程内 route integration tests。不得调用真实模型或自行生成权威状态。

### Lane D｜对抗验收

只写独立测试、HTTP quality script、`docs/v4/ACCEPTANCE.md` 和 `BACKEND_PROGRESS.md`；覆盖越权、乱序、重复、同键异载荷、并发竞争、缺失依赖、否决后贡献保留、退回重做、Candidate 不越权、事件重放等失败路径。不得修改 A/B/C 的实现文件。

## 7. 主 Agent 串行整合

四路返回后，ZCode 主 Agent 才可在独占范围内解决接口不一致与缺陷。缺陷优先返还原 lane；必要的共享修正由主 Agent串行完成。不得删除测试来换取通过。

## 8. Definition of Done

以下全部满足才可结束 Goal：

1. `docs/v4/CONTRACT.md` 不再是空壳，准确描述本切片真实能力和未实现边界；
2. 四域核心证明点均有自动化断言：跨域并行、硬等待、Human Gate/Receipt、否决停止且贡献保留；
3. 幂等冲突、乐观并发、角色权限、错误映射、事件分页与重放均有测试；
4. Route Handler 集成测试覆盖成功、重放、拒绝和失败关闭；
5. `npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run build` 全部通过；
6. `BACKEND_PROGRESS.md` 列出实际 diff、四路 ownership、运行过的命令、结果、未验证项和下一适配点；
7. 未修改禁止范围，未留下真实凭据、运行中服务或被隐藏的失败。

真实阻塞包括：必须新增依赖、必须选择生产数据库/平台、现有 authority 自相矛盾、需要真实凭据或需要改动禁止范围。遇到这些情况先保存证据并向用户提一个聚焦问题，不能自行扩张。
