# SE_REBUILD_20260913 · PERF_PLAN（before/after 性能对照方案）

- 产出者：QA sub-agent C；执行者：MAIN（before 数据由 MAIN 在旧代码被最后同步替换前采集，存 `runtime/before-capture/`；after 数据在新代码同步并通过 `source-runtime-check.mjs` 后采集，建议存 `qa/after-capture/` 或对称的 `runtime/after-capture/`）。
- 原则：**同机、同实例（3467 同端口）、同模式（next dev）、同数据（approval 种子）、同视口、同浏览器**，只换白名单代码（site → se-preview-20260913 同步前后）。任何条件变化（重启实例、换浏览器、改 DPR/节流）必须在 JSON `notes` 里如实记录。
- 声明：全部数字为开发模式（next dev，含按需编译与未压缩产物）实测，**只用于前后对照，不冒充生产性能**；不得写入对外材料。

## 1. 采集时点与顺序

| 阶段 | 时点 | 动作 |
|------|------|------|
| before | MAIN 执行"旧代码最后一次白名单同步"之前（3467 仍是旧代码） | M1–M5 各采一轮 → `runtime/before-capture/perf-before.json`（+ rect 结果并入或并列存放） |
| 切换 | A/B 完成、MAIN 同步白名单 | `node qa/source-runtime-check.mjs` 必须 PASS（证明 3467 已跑新代码） |
| after | 同步后 | 同口径 M1–M5 → `perf-after.json`；再跑 `node qa/behavior-regression.mjs` 确认行为不回归 |

每轮开始前先 `POST /api/v5-preview/demo/seed {"scenario":"approval"}` 复位；采集中不做任何页面交互；标签页保持可见。主视口统一 **390×844**（其余尺寸可选补充，须标注）。

## 2. 指标定义

- **M1 冷首载可用时间**：seed 复位后，**该阶段第一次**导航 `/v5-preview`（含 dev 首次编译成本）。测两个锚点：
  - `htmlStartToLoadEventMs`：PerformanceNavigationTiming `loadEventEnd - fetchStart`；
  - `htmlStartToTodoVisibleMs`：`fetchStart` 到 `section[aria-label="当前待办"]` 出现（轮询检测）。
  - 同时记录 `domContentLoadedMs`。1 个样本（冷载只测 1 次；重启实例会改变条件，不重启）。
- **M2 热加载 5 次均值**：M1 之后连续 `location.reload()` 5 次，每次记录 `htmlStartToLoadEventMs` 与 `htmlStartToTodoVisibleMs`；输出 mean/p95。两次 reload 之间等待上一次 loadEventEnd + 待办卡出现 + 1s 静置。
- **M3 传输 JS/CSS 字节数**：加载完成（load 事件后 2s）汇总 `performance.getEntriesByType('resource')`：`name` 以 `.js`/`.css` 结尾（含 query）的条目，`transferSize` 与 `decodedBodySize` 分别求和，并记 chunk 数。
- **M4 30 次展开/收起 p95**：取 `qa/rect-measure.js` 的 `toggleLatency.syncDispatch.p95Ms`（390×844，主视口）。before 若 `skipped:true`（旧代码隐藏 segToggle）则记 null 并注明。
- **M5 60s 静置请求数**：取 `qa/rect-measure.js` 的 `idleRequests.apiNew` 与 `totalNew`（390×844）。

## 3. M1–M3 采集片段（console 粘贴；M4/M5 用 rect-measure.js）

```js
// 单次加载计时：reload 前先贴上，load 后读 window.__jwLoad；或加载完成后直接执行本段读本次数据
(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  const todo = document.querySelector('section[aria-label="当前待办"]');
  const jsCss = performance.getEntriesByType('resource').filter(e => /\.js(\?|$)|\.css(\?|$)/.test(e.name));
  window.__jwLoad = {
    capturedAt: new Date().toISOString(),
    url: location.href,
    fetchStartToDomContentLoadedMs: Math.round(nav.domContentLoadedEventEnd - nav.fetchStart),
    htmlStartToLoadEventMs: Math.round(nav.loadEventEnd - nav.fetchStart),
    todoVisibleNow: !!todo,
    jsChunkCount: jsCss.filter(e => e.name.includes('.js')).length,
    cssChunkCount: jsCss.filter(e => e.name.includes('.css')).length,
    jsTransferBytes: jsCss.filter(e => e.name.includes('.js')).reduce((a, e) => a + (e.transferSize || 0), 0),
    cssTransferBytes: jsCss.filter(e => e.name.includes('.css')).reduce((a, e) => a + (e.transferSize || 0), 0),
    jsDecodedBytes: jsCss.filter(e => e.name.includes('.js')).reduce((a, e) => a + (e.decodedBodySize || 0), 0),
    cssDecodedBytes: jsCss.filter(e => e.name.includes('.css')).reduce((a, e) => a + (e.decodedBodySize || 0), 0),
  };
  return window.__jwLoad;
})()
```

`htmlStartToTodoVisibleMs` 由 MAIN 用简单轮询补测（reload 后立即每 50ms 查一次待办卡，首次出现时记 `performance.now() - navStart`），或在 load 片段返回后手工补字段。**不强制自动精度，样本如实记录即可。**

## 4. 统一 JSON 格式（before/after 各一份，字段缺失记 null 不删字段）

```json
{
  "codeState": "before | after",
  "capturedAt": "ISO8601（整轮开始时间）",
  "target": "http://127.0.0.1:3467/v5-preview",
  "buildMode": "next dev (development)",
  "viewport": { "width": 390, "height": 844 },
  "browser": "名称+版本（记录用）",
  "instanceRestartedDuringCapture": false,
  "metrics": {
    "firstLoadUsability": {
      "samples": [
        { "loadIndex": 1, "startedAt": "ISO8601", "fetchStartToDomContentLoadedMs": 0, "htmlStartToLoadEventMs": 0, "htmlStartToTodoVisibleMs": 0 }
      ],
      "summary": { "n": 1, "meanMs": null, "p95Ms": null, "note": "冷首载单样本" }
    },
    "hotReloadLoads": {
      "samples": [ { "loadIndex": 1, "startedAt": "ISO8601", "htmlStartToLoadEventMs": 0, "htmlStartToTodoVisibleMs": 0 } ],
      "summary": { "n": 5, "meanLoadMs": 0, "p95LoadMs": 0, "meanTodoVisibleMs": 0 }
    },
    "transferredBytes": {
      "samples": [ { "loadIndex": 1, "jsChunkCount": 0, "cssChunkCount": 0, "jsTransferBytes": 0, "cssTransferBytes": 0, "jsDecodedBytes": 0, "cssDecodedBytes": 0 } ],
      "summary": { "jsTransferBytes": 0, "cssTransferBytes": 0, "chunkCountTotal": 0 }
    },
    "toggleLatency": { "source": "rect-measure.js@390x844", "skipped": false, "syncP50Ms": 0, "syncP95Ms": 0, "paintP95Ms": 0, "flipFailures": 0 },
    "idleRequests60s": { "source": "rect-measure.js@390x844", "apiNew": 0, "totalNew": 0, "apiUrls": [] }
  },
  "notes": "偏离标准条件的任何情况（重启、隐藏标签页、缓存状态等）如实写这里；全部为 dev 模式数字，仅作前后对照。"
}
```

## 5. 判读规则（不发明硬阈值，方向性对照）

1. after 对 before：M1/M2 不应显著变慢（>20% 且 >200ms 视为需解释的差异）；M3 不应显著增大（>20% 需解释新增产物）；M4 p95 不应恶化；M5 api 请求数不应增加。
2. 任一方向性劣化：不直接判失败，把对照表+原始 JSON 交回（A/B/MAIN/用户）裁决；裁决前不宣称"重构性能达标"。
3. M4 before 为 null（旧代码隐藏 segToggle）时，只报告 after 绝对值并注明无基线。
4. 汇总时输出对照表（metric / before / after / Δ / 结论），附采样时间戳与 `source-runtime-check` 结果（after 必须 PASS，保证测的确实是新代码）。

## 6. 边界

- 本方案不采集生产构建（`next build && start`）数据；如后续需要，另行立项并单独声明。
- 不用 Lighthouse/第三方跑分替代上述直接测量；不把单机 dev 数字外推为并发容量或用户体验承诺。
