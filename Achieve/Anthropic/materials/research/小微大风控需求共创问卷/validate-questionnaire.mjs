import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const htmlPath = new URL("./小微业务与大风控需求共创问卷.html", import.meta.url);
const copyPath = new URL("./邮件与群发布文案.md", import.meta.url);
const html = readFileSync(htmlPath, "utf8");
const copy = readFileSync(copyPath, "utf8");

const scriptBlocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
const executableScripts = scriptBlocks
  .filter((match) => !match[1].includes("application/json"))
  .map((match) => match[2]);

assert.equal(executableScripts.length, 1, "应只有一个可执行的内联脚本");
for (const source of executableScripts) new Function(source);

const requiredHtml = [
  "1 个问题 · 1 次量化",
  "只问一件事",
  "最近一笔业务，系统最该先解决什么？",
  "请写下这个关键问题",
  "发生了什么＋造成什么结果",
  "这件事有多需要优先解决？",
  "请选择一项",
  "必须尽快解决",
  "生成的新 HTML 包含您的姓名和全部答案",
  "data:image/jpeg;base64,",
  "function exportCompletedHtml()",
  "new Blob([html]",
  "小微业务作战系统需求问卷_",
  'schema_version: "1.1"',
  'survey_version: "business-v2-compact"',
  "jianwei-survey-business-v2-compact",
  "@media (max-width: 520px)",
  "@media (prefers-reduced-motion: reduce)"
];

for (const expected of requiredHtml) {
  assert.ok(html.includes(expected), `HTML 缺少必要内容：${expected}`);
}

for (const id of ["employeeName", "painDetail", "impact", "saveDraftButton", "exportButton"]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `HTML 缺少必要控件：${id}`);
}

assert.match(html, /\.section-card\[data-step="03"\],[\s\S]*?\.optional-card\s*\{\s*display:\s*none;/, "旧扩展问题必须从可见页面隐藏");
assert.match(html, /#frequency, #timeCost, #metricDetail/, "旧量化控件必须退出活动表单");
assert.match(html, /form\.impact_score\.value/, "进度必须包含唯一量化选择");
assert.doesNotMatch(html, /\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket)\s*\(/, "HTML 不得包含联网提交逻辑");
assert.doesNotMatch(html, /(?:src|href)=["']https?:\/\//, "HTML 不得依赖外部资源");
assert.doesNotMatch(html, /黑马决赛|大风控参赛代表/, "不得恢复旧比赛语境");

const requiredCopy = [
  "## 邮件正文",
  "## 群内文案",
  "## 文件发放与回收",
  "只回答一个问题",
  "最近一笔业务，系统最该先解决什么",
  "再选择一次优先程度",
  "风控与合规是不可突破的底线",
  "包含姓名和答案"
];

for (const expected of requiredCopy) {
  assert.ok(copy.includes(expected), `发布文案缺少必要内容：${expected}`);
}

assert.ok(Buffer.byteLength(copy) < 2600, "发布文案仍然过长");

console.log(JSON.stringify({
  status: "QUESTIONNAIRE_COMPACT_STATIC_ACCEPTED",
  htmlBytes: Buffer.byteLength(html),
  copyBytes: Buffer.byteLength(copy),
  executableScripts: executableScripts.length,
  visibleQuestionCount: 1,
  quantifiedChoiceCount: 1,
  schemaVersion: "1.1",
  surveyVersion: "business-v2-compact",
  offline: true
}));
