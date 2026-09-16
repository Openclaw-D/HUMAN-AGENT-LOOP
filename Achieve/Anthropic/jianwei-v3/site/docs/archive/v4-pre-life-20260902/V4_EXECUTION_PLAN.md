# 见微 V4 执行计划

状态：`CONTROLLED AGILE DELIVERY`

## 1. 工作方法

V4 采用 observable agile development（可观察敏捷开发）：

- 稳定 North Star；
- 小步实现暴露未知；
- 多次观察、多次验收、多次纠偏；
- 前端使用更高频真实浏览器验收；
- 后端以 contract、state、Event、Receipt 和 tests 为主要证据；
- 智谱在受限 Windows sandbox 运行 Node acceptance 时固定使用 in-process test isolation，manifest preflight 先于 provider 拒绝 child-process command；
- 每个大版本前先形成 Git commit/tag 恢复点；
- 不用一次瀑布预设替代真实观察。

## 2. 文件所有权

### V4-Refresh Control

拥有：`docs/v4/**`、范围、契约、任务拆分、冲突处理、集成方向和最终 Gate。

禁止：直接承担大块 frontend/backend implementation。

### V4-BACK

拥有：

- `lib/v4/**`
- `app/api/v4/**`
- `test/v4-*.test.mjs`
- backend-only 必要说明

禁止：

- 修改 `app/page.tsx`、`app/jw-front.*` 或 V3 runtime；
- 修改 `docs/v4/**`；
- 猜测岗位权限；
- 接真实系统、真实数据或真实模型凭据。

### V4-FRONT

拥有：

- `app/page.tsx`
- `app/jw-front.tsx`
- `app/jw-front.css`
- `test/jw-front.test.mjs`
- 经 Control 追加授权的 V4 frontend-only 文件

禁止：

- 修改 `lib/v4/**`、`app/api/v4/**` 或 `docs/v4/**`；
- 改变大骨架或重新设计视觉语言；
- 在前端生成 Authority、Context 或 Receipt；
- 展开三条业务线全称。

### V4-QA

默认只读。负责 contract traceability、测试覆盖、运行证据、浏览器验收清单和 drift report。没有 Control 明确授权不得修改产品代码。

### V4-SHOW

负责把已通过 Gate 的真实能力转换为讲解、PPT 和演示路径。不得把 draft、mock、target 或待验证指标写成已实现结果。

## 3. P0 检查点

### P0-A Backend Contract Kernel

- 建立 V4 enums、Case classification、lifecycle state、decision semantics；
- 建立 pure transition functions；
- 用 tests 证明三条业务线 × 两条审核路径正交；
- 用 tests 证明信审通过不推进起租；
- 输出 V3 reuse/isolation audit；
- 不做 SQLite/API 大实现。

### P0-B Front Content Convergence

- 保留宏观骨架；
- 把主图内容换成 V4 最新认知；
- 右侧三个区域形成非均分、有间隔的独立区域；
- 隐藏价值第一层；
- 不先做复杂交互和 Case 编辑器；
- 提供 1920×1080 浏览器候选。

### P0-C Cross Review

- Control 核对 frontend labels 与 backend enums；
- V4-QA 做 acceptance matrix；
- 用户观察后进入第一次纠偏；
- P0 未通过前不进入 P1 重后端。

## 4. P1 检查点

### P1-A Authority Runtime

- V4 独立 SQLite schema/epoch；
- Evidence、Candidate、Decision、Receipt、Event；
- idempotency、concurrency、fail-closed；
- standard authorized rule 与 exception Human Gate；
- 退回/补证/重新提交闭环。

### P1-B 信审工作面

- 一个真实直租例外 Case；
- server DTO 驱动；
- 退回、驳回、否决清晰区分；
- Receipt 后刷新；
- 自动信审通过与起租严格分离。

### P1-C E2E Acceptance

- tests/typecheck/lint/build；
- HTTP 正常、重放、冲突、错误、并发；
- 1920×1080 browser + console；
- V4-QA independent review；
- 用户最终验收。

## 5. 当前停止点

如果 P0 观察显示宏观认知仍不稳定，只改 contract 与内容映射，不提前扩张 SQLite/API。后端只实现已冻结的 pure domain；前端只实现可被用户立即观察和纠偏的最小候选。
