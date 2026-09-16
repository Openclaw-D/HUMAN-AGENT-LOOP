# MOBILE_MEASUREMENT_SCHEMA｜手机量测输入 mobile-measurement@1（冻结）

R3 手机验收的唯一可接受证据形态：**可执行的 DOM 量测文件**。截图（PNG）只能作为佐证附件，不能替代量测；只交截图 → 检查器直接 BLOCKED。

```jsonc
{
  "schema": "mobile-measurement@1",
  "meta": {
    "measuredBy": "非空（工具/执行者）",
    "capturedAt": "ISO",
    "url": "被测页面 URL",
    "browser": "UA 或浏览器名+版本",
    "zoomHint": "缩放说明（无法精确时如实写，例如 'DPR0.91 缩放仿真'）"
  },
  "viewport": {
    "cssWidth": 402,            // 目标 402±2
    "cssHeight": 874,
    "dpr": 3,                   // 记录实际值；真机目标 DPR3，仿真环境如实记录（仿真≠真机，报告标注）
    "visualViewport": { "width": 402, "height": 830 }
  },
  "pages": [                    // 每个被测页面一条（命名页：overview/fullscreen-chat 等）
    {
      "name": "overview",
      "scroll": { "clientHeight": 874, "scrollHeight": 874 },   // scrollHeight<=clientHeight+1 ⇒ 无整页滚动
      "screenshotPath": "可选佐证附件（不参与判定）"
    }
  ],
  "elements": [                 // 关键控件量测（getBoundingClientRect 结果）
    {
      "id": "chat-input",
      "text": "输入框",
      "rect": { "x": 8, "y": 790, "width": 386, "height": 44 },
      "inInitialViewport": true   // rect 完全落在 visualViewport 内
    }
  ],
  "firstScreen": {
    "chatInputVisible": true,   // 首屏必须可见聊天输入（Codex P1 返工项）
    "fiveRowsVisible": true,    // 五行总览可见
    "hangupReachable": true     // 全屏访谈挂断键不需整页滚动即可达
  }
}
```

## 检查器判定（tools/mobile-measure-check.mjs）

| 检查 | 判据 | 结果 |
| --- | --- | --- |
| viewport | \|cssWidth−402\|≤2 且 cssHeight≥800；dpr 如实记录（真机 DPR3 另测，仿真标注 SIMULATED） | PASS/FAIL |
| 整页滚动 | 每页 scrollHeight ≤ clientHeight+1 | PASS/FAIL |
| 关键控件 | elements 中 chat-input/hangup/five-rows 等 rect 完全在 initial viewport 内 | PASS/FAIL |
| 首屏 | firstScreen 三项全 true | PASS/FAIL |
| 证据形态 | schema=mobile-measurement@1 且含 viewport+pages+elements 量测 | 否则 BLOCKED |

输出：`mobile-verdict@1` JSON + 人类可读表；任何 FAIL 明确到字段。**没有原始量测文件 → BLOCKED，不允许 PASS。**
