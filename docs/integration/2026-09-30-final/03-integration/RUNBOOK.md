# RUNBOOK · V0.5 收尾（Windows 一键启动/停止/重演）

面向 Windows 演示者与验收者。全部命令可在 PowerShell 或双击 `.cmd` 完成，无 Bash 依赖。

## 一键启动（推荐）

```
双击 Start-JW.cmd
```
或 PowerShell：
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File Start-JW.ps1
```

启动器做满前置检查（Node→Docker→运行配置→端口所有权），复用已运行的健康栈、自动恢复部分存活的
服务（容器退出→拉起；服务在→跳过），并以**真实就绪证据**收口：`/healthz/ready` 聚合探测 +
版本封存 buildId + 受控目录登录冒烟——不是静态预览。默认打开浏览器 `http://127.0.0.1:48431/`。

| 操作 | 命令 |
|---|---|
| 状态 | `Start-JW.cmd -Status` |
| 停止（保留数据） | `Start-JW.cmd -Stop` |
| 停止并停自有 PG 容器 | `Start-JW.cmd -Stop -WithDb` |
| 操作 48430 检查栈（复用级） | `Start-JW.cmd -Stack demo03` |
| 不自动开浏览器 | `Start-JW.cmd -NoBrowser` |
| 强制重跑十案例初始化 | `Start-JW.cmd -Init`（另见 `-Stack`） |

## 栈登记（03 路资源台账 RUNTIME_LEDGER.json）

| 栈 | Edge | 内核 | Connectors | PG | 容器 | 归属 |
|---|---|---|---|---|---|---|
| **v05（默认）** | 48431 | 48491 | 48411 | 25497 | jw-integ-v05-pg | 03 本轮独占 |
| demo03 | 48430 | 48490 | 48410 | 25496 | jw-integ-demo03-pg | 用户检查栈（勿重启） |

新端口启用前均经 `netstat` 核查空闲并登记；启动器/底层脚本绝不抢占未知进程（占用即报告归属线索）。

## 数据初始化与重演（不清库、不直写结果表）

```powershell
cd Back\Edge
$env:JW_INTEG_RUN_SUBDIR='v05'
C:\Users\22673\Desktop\JW\.local\runtime\node-v22.23.0-win-x64\node.exe scripts/ten-case-init.mjs --batch checkpoint --run v05b3   # 新批次
```

- 两种批次（均真实执行、留审计与事件历史）：
  - `checkpoint`（检查点展示，默认）：登记材料并实际执行到各例检查点停（进度各异）。
  - `fresh`（从头体验）：只建客户+登记材料，从"材料就绪"开始。
- **幂等语义**：同一 `--run` 重复执行自动跳过（种子配方非重放收敛；`--force` 强制重放）；
  **换新 `--run` = 新批次**，旧批次客户与历史原样保留。
- **顺序纪律**：A 案例注册表指向**最后一次**种子批次——演示目录要显示检查点进度时，
  `checkpoint` 批次必须最后种（Start-JW 默认只种 checkpoint，已满足）。
- 禁止直写业务结果表；`arrow_case_registry` 重置仅为目录配置，不动业务历史。

## 数据库停机与恢复（演练路径，已在 v05 实证）

1. 故障注入（仅限本栈容器）：`docker stop jw-integ-v05-pg`
2. 页面表现：已登录会话刷新后点角色 → 诚实分类提示"后台身份核验服务暂不可用（通常是数据库或
   上游服务未启动）……"（不混称"连接不上"）；`-Status` 显示 db NOT-OK。
3. 恢复：`docker start jw-integ-v05-pg` → A 连接池自愈（数秒内 `/healthz/ready` 回绿）→
   浏览器重新选择角色即可，无需改配置。
4. 若服务进程也被停：`Start-JW.cmd`（自动走恢复路径）或先 `-Stop` 再启动。

## 已知边界

- 启动器经 Git Bash 管道运行时，分离子进程句柄可能挂住管道——请用 cmd/PowerShell 控制台或双击。
- 集成缺陷清单（DEF-03-06/07/08/09，均交 01）见 `DEFECTS.md`；不影响登录、目录、核验登记、
  回执登记与负例演示，影响面在个别按钮/分支（各条目有复现与建议修法）。
- 本轮零付费模型出站（无模型配置）；助手无模型时返回"案例说明"确定性层，自由问答如实标注不可用。
