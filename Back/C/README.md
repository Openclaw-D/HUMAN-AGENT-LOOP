# V7 backend-next · Lane C（商业租赁模板/规则/确定性工具 + 隔离 mock 模型 API）

任务书：`V7/NIGHT_BACKEND_20260916.md` §C · 只写 `V7/backend-next/C/**` · 零运行时依赖（Node ≥20 标准库）

## 快速开始

```bash
cd V7/backend-next/C

# 1. 起隔离 mock 模型 API（loopback 127.0.0.1:3730；接口文档 MOCK_API.md）
node scripts/start-mock.mjs              # 可选 --port/--api-key/--seed/--scenario
curl http://127.0.0.1:3730/__mock__/health

# 2. 全部测试（33 用例，真实 socket）
node test/run-all.mjs

# 3. 案例评测（确定性，零网络）
node src/run-evaluation.mjs              # 主案例包 8 案（含 2 多轮）
node src/run-evaluation.mjs --heldout    # 独立 heldout 3 案（一次性纪律）

# 4. 真实 socket E2E（8/8 案例轮次）
node src/run-e2e.mjs

# 5. 对 A 服务的契约集成（A 未起 → exit 3 BLOCKED）
node src/run-contract-integration.mjs [--credential <A发布的合成token>]
```

## 目录

```
MOCK_API.md            mock 接口文档（给 B）
INTERFACES.md          全部交付物对接说明（给 A/B/D）
STATUS.md / RESULT.md  检查点与真实结果（含失败记录）
rules/rule-pack-v2.json          用户业务约束（机器可查）+ 15 条升级理由
templates/             商业租赁主模板 + 非租赁抽象反例模板（A GoalTemplate 投影就绪）
scenarios/             8 租赁案例（L3/L4 多轮）+ 3 heldout + plans/（A 实例化计划，generate-plans.mjs 生成）
src/mock-server.mjs    loopback 假模型 API（真实 socket；11 场景；凭据脱敏；canary 串线探针）
src/calculation-tool.mjs  calc:cash-flow-coverage@1（自旧 C 原样复用）
src/ratio-tool.mjs     calc:ratio@1（行业无关比值：集中度/价格基准）
src/case-checker.mjs   案例确定性检查器（预期=用户规则+算式，非模型自评）
src/contract-adapter.mjs  C→A CONTRACT v0.1 投影（禁键预检/DAG/角色）
src/run-evaluation.mjs · run-e2e.mjs · run-contract-integration.mjs
evidence/              测试输出、评测报告、文件 hash
```

## 边界（不可移除）

- mock 服务只是 transport 模拟，**不代表真实模型能力**；所有响应带 `x-mock-simulation: true`。
- 不读取环境变量密钥；`--api-key` 只经命令行注入且全程掩码回显；只绑定 127.0.0.1。
- 固定 seed（`jw-v7c2-night-20260916`）：同请求恒同响应；案例期望只来自用户规则与确定性算式；脚本候选是 fixture 不是真值。
- 全部行业/地区/金额为合成标注；高息≠风险覆盖、未知成本不编净收益由 checker 机械强制（见 `rules/rule-pack-v2.json` userConstraints）。
