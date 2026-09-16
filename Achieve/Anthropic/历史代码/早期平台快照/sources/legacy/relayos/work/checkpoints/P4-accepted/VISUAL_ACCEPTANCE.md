# RelayOS P4 真实浏览器验收

日期：2026-08-26（Asia/Shanghai）

验收工具：Codex in-app Browser，严格按 `browser:control-in-app-browser` skill 执行。未使用 CDP、独立 Playwright、Chrome、快捷键或替代浏览器。截图不包含 secret。

## 结论

- 1920×1080 首屏实测主图占 workspace `76.0%`；最终 4177 实测 `75.96%`，位于 70%–80% Gate 内。
- 首屏可直接找到五问：当前目标、当前 owner、待接受交接、开放 Gate、下一步；三句 onboarding 与图例同时可见。
- offered handoff 使用虚线并明确“待接受，负责人未改变”；经真实 UI command 接受后，owner 从“当前事项负责人”变为“具名复核人”，待接受项归零。
- open Human Gate 显示具名 assignee `human-reviewer`、受保护动作 `action.authorize` 与禁用原因。
- Replay 用六问呈现业务因果；receipt `unknown` 显示为“未知（unknown）”，没有画成成功。
- AI 建议真实调用 `/api/advisories`，显示 `authority=none` / 需人工确认；调用前后 graph subtitle 均为 `API projection v15`，权威图未改变。
- loading、empty、error、provider degraded、version conflict、stale 均可确定触发，所有演练状态都没有成功宣称。
- Browser console 在开发验收和 4177 最终验收中均为 `0 error`。

## 截图索引

| 文件 | Viewport | 状态 | 可审查结论 |
|---|---:|---|---|
| `visual/01-1920x1080-first-open.png` | 1920×1080 | 首次打开 / offered handoff | 三句 onboarding、图例、五问、76.0% 主图、owner 粗实线和待接受虚线同屏；document scrollHeight=1080。 |
| `visual/02-open-gate-disabled-action.png` | 1920×1080 | open Human Gate | 具名 assignee、受保护动作和禁用原因可见。 |
| `visual/03-accepted-owner-changed.png` | 1920×1080 | accepted handoff | 真实 command 后 owner 已变为具名复核人，待接受交接为“无”。 |
| `visual/04-replay-receipt-unknown.png` | 1920×1080 | Replay / receipt unknown | 六问与事件序列可读，未知回执没有伪装成功。 |
| `visual/05-advisory-authority-none.png` | 1920×1080 | AI 建议 | 建议层、不自动执行、authority=none 与 graph snapshot 未改变可见。 |
| `visual/06-provider-degraded.png` | 1920×1080 | provider degraded | 清楚标记界面状态演练；Mock/未连接真实 GLM 仍诚实可见。 |
| `visual/07-version-conflict.png` | 1920×1080 | version conflict | 明确版本冲突，不显示成功。真实 conflict 的零写入由 frontend test 覆盖。 |
| `visual/08-loading.png` | 1920×1080 | loading | 显示“正在加载权威投影”，没有静态 owner 替代。 |
| `visual/09-empty.png` | 1920×1080 | empty | 显示当前没有 WorkCase 与 deterministic seed 指引。 |
| `visual/10-error.png` | 1920×1080 | error | 显示加载失败与重新连接入口。 |
| `visual/11-stale.png` | 1920×1080 | stale view | 明确视图已过期，不宣称权威状态仍新鲜。 |
| `visual/12-1440x900.png` | 1440×900 | 正常 | 页面无横向/纵向溢出，主图占 75.625%，主要控制均可见。 |
| `visual/13-390x844.png` | 390×844 | 移动端图区域 | 无横向功能丢失；最小 button touch target 实测 44px。 |
| `visual/13b-390x844-five-questions.png` | 390×844 | 移动端五问 | 滚动后五问完整可达、可读；document scrollWidth=375 ≤ viewport 390。 |
| `visual/14-4177-final.png` | 1920×1080 | 最终 4177 / offered handoff | 新服务最终首屏：主图 75.96%，三句 onboarding、五问、Mock provider、待接受交接均来自新 seed/API。 |

## 交互证据

- Zoom：按钮与真实 SVG transform 分别达到 25%、200%，reset 回到 100%；clamp 的 25%–200% 边界另由 reducer test 覆盖。
- Node drag：WorkCase 从 `translate(600 355)` 变为约 `translate(678.17 395.17)`；reset 后回到原布局。
- Pan：viewport 从 `translate(0 0) scale(1)` 变为约 `translate(90.51 44.63) scale(1)`。
- Fit：浏览器实际计算为约 103%，随后 reset 恢复 `translate(0 0) scale(1)`。
- Keyboard：WorkCase focus 后按 ArrowLeft 将 focus 移到 Agent；具名 owner 按 Enter 打开 inspector。
- Reduced motion：浏览器读取到 `prefers-reduced-motion` media rule；当前系统没有开启 reduce，因此不冒充实际 OS 设置。CSS 行为由 frontend contract test 覆盖。
- 390×844：顶部图控制可操作；点击移动到“五问”使 inspector 滚入可视区，五项答案均来自 API。

## 首次使用启发式

最终 4177 首屏仅凭可见内容即可定位：

1. 当前目标：在不越过合同与付款权限的前提下恢复供应连续性。
2. 当前 owner：当前事项负责人。
3. 待接受交接：当前事项负责人 → 具名复核人；虚线明确 owner 未变。
4. 开放 Gate：1 个。
5. 下一步：等待具名复核人接受交接，并处理合同变更 Gate。

这只是信息检索启发式验收。目标用户 `80% / 5 分钟` 的量化 UAT 需要真实首次使用者，P4 未把今晚不存在的受试者结果写成通过或失败。

## 4177 切换

- 旧 listener：PID `22912`；command line `node src/index.js`；工作目录经 `psutil.Process.cwd()` 精确确认是 `C:\Users\22673\Documents\Codex\2026-08-26\relayos-p0`。
- 新 listener：PID `22464`；工作目录 `C:\Users\22673\Desktop\Anthropic\RelayOS`；只绑定 `127.0.0.1:4177`。
- 新服务 `/`、`/app.js`、`/styles.css`、`/health/live`、`/health/ready` 均返回 200。
- 数据库：`work/runtime/relayos-p4-4177-20260826.db`，通过 deterministic command service seed。
- 日志：`work/runtime/relayos-p4-4177.stdout.log`、`work/runtime/relayos-p4-4177.stderr.log`。
- 可恢复性：旧 PID 已停止；旧 cwd 与命令已记录，如新服务失败可按该精确目录重新启动旧 P0。本次切换健康检查通过，没有执行恢复。

## 自动化与未验证项

- `npm.cmd test`：74 total / 73 pass / 1 live skip / 0 fail。
- `npm.cmd run test:frontend`：13/13 pass。
- `npm.cmd run test:provider`：19 total / 18 pass / 1 live skip / 0 fail。
- `npm.cmd run test:replay`：25/25 pass。
- `npm.cmd run test:contract`：17/17 pass。
- `npm.cmd run build`：34 JavaScript、3 config、5 static assets、零第三方 import。
- `npm.cmd run smoke`、`smoke:provider`、`smoke:frontend`：全部通过。
- live skip 是 Z.AI General 明确 opt-in 的 live test；没有独立 `RELAYOS_ZAI_GENERAL_API_KEY`，因此真实 GLM 未验证，界面保持 Mock 标记。
