# V0.4 专项测试入口

2026-09-21；只增加计划工具、自身测试和本报告，未修改 package、runner、配置或业务源码。

## 使用

从 JW 根目录运行：

```powershell
node Back/Edge/scripts/v04-test-plan.mjs
```

只输出 JSON 清单，不导入或执行清单里的测试。显式列出16项入口（Edge 8、A 2、B 2、Connectors 1、Front 3），标明单元、HTTP、隔离PG、恢复分类以及前置条件；每项附可复制的 PowerShell 绝对路径命令。路径使用单引号并转义单引号，不执行字符串。缺失、类型错误、物理路径越界时不提供命令。

退出码0仅代表全部清单路径存在；2表示缺失/检查异常；1表示参数或清单错误。所有测试结果均为 NOT_RUN，不把发现与通过混为一谈。工具不接受 --run，不自动寻找或归类在制测试。

## 静态核对边界

- A 两项均调用 `Back/A/test/utils.mjs`，包括建删数据库、内核子进程；故障用例也需要PG。必须显式配置专用隔离 JW_A_ADMIN_DB_URL，不沿用默认共享地址。
- Edge evidence-scope/message-idempotency 为模块测试；provider/activity 使用真实本地HTTP替身。activity 的 A 数据库为替身，不证明真实PG整链。
- Edge 两项 receipts 与 B budget-ledger 的恢复是同持久目录重建实例，不是进程崩溃恢复；使用独立临时回执、账本与本地替身。B transport stub 使用 loopback 随机端口。
- Connectors takeoff-chain 是既有补充入口，使用 processing-helpers/helpers 的PG与对象目录；固定端口48283需要先确认空闲。PG不可达时 process.exit(0)，必须核对实际测试数/blocked_env，不能记PASS；该例 localOnlyCompletion，不覆盖真实A桥。
- Front 三项使用 harness 的 jsdom/TSX loader 与客户端替身，不替代真实页面视觉验收。
- 核对的是本次入口与相关设施，不是安全认证；传递依赖后续变化需重审。在制新增项、真实进程崩溃恢复保留未核验。

## 整合结束后的最小串行顺序

1. 重新生成计划，确认存在性与输入未漂移；运行工具单测、readiness、evidence-scope、message-idempotency。
2. evidence-provider → B three-state → B budget-ledger → Edge 两项 receipts → activity HTTP。均用隔离临时资源与本地替身，无真实模型。
3. 专用隔离PG就绪后串行运行 A 两项；仅上传/材料链受影响时追加 Connectors takeoff-chain，先核对其固定端口和目录归属，不抢占或重启共享实例。
4. Front 三项行为回归，随后由前端负责方执行相应 typecheck/build 和真实页面验收。真实PG整链、实际进程重启恢复仍须独立安排，不能由上述替身/实例恢复推导通过。

## 本次验证与资源

`node --test Back/Edge/test/v04-test-plan.test.mjs`：退出码0，4/4 pass，0 fail，0 skip。覆盖缺失、类型错误、逻辑路径越界、junction物理越界、重复条目、命令引用、CLI不执行测试与拒绝 --run。

只读生成计划：16项均存在，exitCode=0；业务测试全部 NOT_RUN。自建系统临时目录 jw-plan / jw-plan-outside 已由 finally 清理，无服务/数据库/后台测试资源。未执行任何其他业务测试，未调用其他任务工具。

HEAD：e298a789bc9d49eac23a17f9dfe75244f73ca64f（工作树含他人修改，不视为交付版本）。

SHA-256：

```text
Back/Edge/scripts/v04-test-plan.mjs
8AF500F5FCCAEB86E2ABFE0DD303A4F224D1A9CEAE533E6D03C359C94516AC0E
Back/Edge/test/v04-test-plan.test.mjs
8F20ACCACFB6C647351E44ACE9201CA6618B40CCAD2FE9C045DC3E333987E083
```
