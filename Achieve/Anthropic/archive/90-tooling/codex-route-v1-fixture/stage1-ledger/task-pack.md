# Z coding checkpoint

任务类型：implementation

## 固定目标

实现 `ledger.cjs` 导出的同步函数 `reconcileCheckpoints(expected, observed)`，使唯一 acceptance command 通过。

## 冻结契约

- 输入均为 arrays。expected item：`{id, requiredFiles, requiredChecks}`；observed item：`{id, files, checks, terminal}`。
- `id` 为非空 string 且每个输入内唯一；文件/检查列表为不含重复项的 string arrays；terminal 仅 `completed|failed`。无效输入抛 `TypeError`，不得修改输入。
- 使用 id 精确匹配，必须安全处理 `id='__proto__'`。
- 输出精确为 `{accepted, rejected, missing, unexpected}`。
- accepted/rejected/missing 按 expected 顺序；unexpected 按 observed 顺序。
- completed 且覆盖全部 required files/checks 才 accepted；否则 rejected，record 精确为 `{id, terminal, missingFiles, missingChecks}`，缺项按 required 顺序。无 observed 为 missing；未知 id 为 unexpected。
- 返回值不与输入 nested arrays 共享引用；API 必须同步。

## 当前失败证据

新实现检查点；`ledger.cjs` 初始不存在。

## Allowed reads

仅 `C:\Users\22673\Desktop\Anthropic\codex-route-v1-fixture\stage1-ledger\acceptance_test.cjs`，读取一次。

## Allowed writes

仅 `C:\Users\22673\Desktop\Anthropic\codex-route-v1-fixture\stage1-ledger\ledger.cjs`，唯一 writer。

## Excluded

不得读取 `controller_test.cjs`、`checkpoint.json`、`task-pack.md`，不得枚举/搜索目录，不得 Git、安装依赖、联网、读取凭据或修改其他文件。

## Command Gate

按顺序只执行：读取 acceptance test 一次 → 写 `ledger.cjs` → 运行一次 `node acceptance_test.cjs`。不得运行其它 inspection/test command。测试失败立即停止，不修改后重跑。

## Stop conditions

契约冲突、范围冲突、测试失败、permission denial、provider error、rate limit、quota、auth、network 或 timeout 时停止。

## Final evidence

报告修改文件、唯一命令及 exit code；controller 核对 terminal、usage、wall、scope、denial、副作用和 residue。
