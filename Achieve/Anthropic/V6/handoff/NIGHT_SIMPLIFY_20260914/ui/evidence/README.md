# evidence/ — 证据索引（任务B · 供 A/D 复核）

采集环境：候选独立 harness（esbuild + React 19.2.6 只读取自 site/node_modules），非 site 预览实例。
截图尺寸为 CSS 视口（IAB setViewportSize）。

## 截图（PNG）
| 文件 | 内容 |
|------|------|
| `m375-01-loading` … `m375-12-ready-customer` | 12 个状态 @375×667（加载/失败/空/正常/模拟/暂停+人工待办/恢复条/业务发起/四域空/四域多+长文本/错误反馈/客户视图） |
| `d1920-04-ready-live` | 正常态桌面 @1920×1080（右栏四域侧栏） |
| `d1920-05-ready-sim` | 模拟画面开启桌面 |
| `d1920-06-ready-paused` | 暂停+人工待办桌面 |
| `d1920-10-ready-domains-many` | 四域多条+长文本桌面 |
| `d1920-12-ready-customer` | 客户视图桌面（最小面） |
| `m375-interactive` | 交互页（含回调日志浮层，非产品 UI） |

## 断言（JSON，采集脚本见会话记录；均可复跑）
| 文件 | 结论要点 |
|------|---------|
| `layout-375-state04.json` | 无横向溢出；四域栏收起 47px；主按钮高 44px；textarea 有标签；全部按钮有可访问名 |
| `layout-375-state10-longtext.json` | 长文本+9条提示仍无横向溢出 |
| `layout-1920-state04.json` | 右栏 248px 在主列右侧；手机折叠开关隐藏；侧栏条目可见 |
| `layout-1920-state06-paused.json` | 暂停徽章/人工待处理徽章/恢复本轮按钮/复核留痕 均在 |
| `interactive-callbacks.json` | 提交按钮空输入禁用→填写启用；onSubmitRecord 载荷（文本+字段）；onPauseRound/onEscalateHuman/onSimulateToggle(true)；内部消息发送后输入清空 |
| `customer-view-leak-check.json` | 客户视图：内部交流/复核留痕/四域提示/证据/模型按钮/业务操作 全部不存在；隔离标注存在 |
| `keyboard-focus-programmatic-state04.json` | 26 个可聚焦元素、0 个正 tabindex、焦点序=DOM 序（前 8 个名称列出）、disabled 不可聚焦 |
| `keyboard-tab-order-state04.json` | 真实 Tab 键遍历未成功（harness 无窗口焦点）——如实保留失败记录 |

## 已知限制
- harness 页面无 OS 焦点（document.hasFocus()=false）：按键类检查不可达；`:focus-visible` 规则已编写，待 A 集成后由 D 在 3467 预览实例核验。
- 截图通道故障期（02:20–02:55）的取证以 DOM 断言替代，未补拍（该时段无视觉变更丢失：修复后的四域收起行有 03:00 后截图覆盖）。
