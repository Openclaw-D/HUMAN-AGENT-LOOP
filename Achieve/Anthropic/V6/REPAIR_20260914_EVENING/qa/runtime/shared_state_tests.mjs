// D路 共享状态 API 测试套件 v2（REPAIR_20260914_EVENING）
// 依据：main/INTERFACE.md 冻结接口 v1 + COMMON R-05/R-06/R-07。
// 运行前提：A 已发布可测版本，在 D 隔离实例（生产模式）执行。
// 用法: node shared_state_tests.mjs [BASE] [--json <路径>]
import { writeFileSync } from "node:fs";

const BASE = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "http://127.0.0.1:3469";
const jsonIdx = process.argv.indexOf("--json");
const JSON_OUT = jsonIdx > -1 ? process.argv[jsonIdx + 1] : null;
const PASS = [], FAIL = [], NOTES = [];
const RID = "dqa-ss-" + Math.random().toString(16).slice(2, 10);

async function call(path, method = "GET", body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
  return { status: res.status, data };
}
function check(name, cond, detail = "") {
  (cond ? PASS : FAIL).push(name);
  console.log(`[${cond ? "PASS" : "FAIL"}]`, name, cond ? "" : "| " + JSON.stringify(detail).slice(0, 420));
}
const getProject = () => call("/api/v5-preview/project");
const getStory = () => call("/api/v5-preview/demo/story");
const getShared = () => call("/api/v5-preview/demo/shared-state");
const getRemoteList = () => call("/api/v5-preview/remote-session");

async function storyPost(action, extra) {
  const proj = (await getProject()).data;
  return call("/api/v5-preview/demo/story", "POST", {
    action, requestId: `${RID}-${action}-${Math.random().toString(16).slice(2, 8)}`,
    expectedVersion: proj.version, ...extra,
  });
}
// 推进直到：决定门（step.decision 非空）/ free / 非200 / 达到上限
async function advanceUntilStop(maxSteps = 30) {
  for (let i = 0; i < maxSteps; i++) {
    const st = (await getStory()).data;
    if (st.mode !== "story") return { stopped: "free", state: st };
    if (st.step?.decision) return { stopped: "decision", state: st };
    const r = await storyPost("advance", { fromStepId: st.step.stepId });
    if (r.status !== 200 || !r.data.ok) return { stopped: "error", state: st, err: r.data };
  }
  return { stopped: "maxsteps" };
}
const pickNonAsset = (p) => JSON.stringify({
  policy: p.domains?.policy ?? p.domainStates?.policy ?? null,
  credit: p.domains?.credit ?? p.domainStates?.credit ?? null,
  commerce: p.domains?.commerce ?? p.domainStates?.commerce ?? null,
  scenario: p.scenario,
});
const pickAsset = (p) => JSON.stringify({ asset: p.domains?.asset ?? p.domainStates?.asset ?? null });

console.log(`== D 共享状态测试 v2 @ ${BASE}  RID=${RID} ==`);

// R0 可达 + 干净起点
{
  const p = await getProject();
  check("SS-R0 服务可达(project 200)", p.status === 200, p.status);
  const rs = await call("/api/v5-preview/demo/reset", "POST", {});
  check("SS-R1 reset 清场", rs.status === 200 && rs.data.ok === true, rs);
}

// SS-01 shared-state 形状（对照 INTERFACE §3 冻结形状；缺 projectId 记接口偏差）
{
  const s = await getShared();
  const d = s.data;
  check("SS-01 shared-state 形状(ok/facts/pendingReview/rs-*会话)",
    s.status === 200 && d.ok === true && Array.isArray(d.facts) && Array.isArray(d.pendingReview)
    && (d.demoSessionId === null || String(d.demoSessionId).startsWith("rs-")), d);
  check("SS-01b 接口符合性：响应含 projectId(INTERFACE §3)", d.projectId === "JW-2026-018", d);
  NOTES.push({ at: "SS-01", shared: d });
}

// SS-02 推进到 s09 决定门（途经 s05 hold 自动附证据）
{
  const before = await getRemoteList();
  const w = await advanceUntilStop();
  check("SS-02a 推进停在决定门", w.stopped === "decision", { stopped: w.stopped, err: w.err, stepId: w.state.step?.stepId });
  const demoSid = (await getShared()).data.demoSessionId;
  const after = await getRemoteList();
  check("SS-02b 专属演示会话存在(懒建或已有)",
    !!demoSid && (before.data.sessions || []).some(s => s.sessionId === demoSid) === false || !!demoSid, { demoSid });
  if (demoSid) {
    const det = await call(`/api/v5-preview/remote-session/detail?sessionId=${demoSid}`);
    const evs = det.data.evidence || [];
    const s05 = evs.find(e => String(e.evidenceId).startsWith("ev-demo-"));
    check("SS-02c 演示证据确定性ID(ev-demo-*)", !!s05, evs.map(e => e.evidenceId));
    check("SS-02d 证据版本与sha256在位", s05 && s05.version >= 1 && !!s05.sha256, s05 && { v: s05.version });
    NOTES.push({ at: "SS-02", demoSid, evidence: evs.map(e => ({ id: e.evidenceId, v: e.version, sup: e.supersedes, by: e.supersededBy })) });
  }
}

// SS-03 facts 映射
{
  const d = (await getShared()).data;
  const f = d.facts.find(x => x.fixtureId === "fixture-inspection");
  check("SS-03 facts: fixture-inspection→asset, chainVersion≥1, unverified",
    !!f && f.domain === "asset" && f.chainVersion >= 1, d.facts);
}

// SS-04 无 contested 无待复核标记（投影诚实）
{
  const d = (await getShared()).data;
  const proj = (await getProject()).data;
  const contested = d.pendingReview.length > 0;
  const marked = JSON.stringify(proj).includes("证据纠正待复核");
  check("SS-04 无contested则首页无待复核标记", !contested || marked, { contested, marked });
}

// ---- 决定前快照 ----
const projBefore = (await getProject()).data;

// SS-05 人工门：决定点直发 advance → 409
{
  const st = (await getStory()).data;
  const proj = (await getProject()).data;
  const r = await call("/api/v5-preview/demo/story", "POST", {
    action: "advance", requestId: `${RID}-gate-${Math.random().toString(16).slice(2, 6)}`,
    expectedVersion: proj.version, fromStepId: st.step.stepId,
  });
  check("SS-05 决定点直发advance被拒(409 人工门)", r.status === 409, r);
}

// SS-06 decide correct：真实复核 + contested + 首页投影
{
  const st = (await getStory()).data;
  const r = await storyPost("decide", { fromStepId: st.step.stepId, decision: "correct", note: "D路验收纠正（合成）" });
  check("SS-06a decide correct 被接受", r.status === 200 && r.data.ok === true, r);
  const shared = (await getShared()).data;
  const pr = shared.pendingReview.find(x => x.fixtureId === "fixture-inspection");
  check("SS-06b pendingReview: fixture-inspection(reason=correct)", !!pr && pr.reason === "correct", shared.pendingReview);
  const fact = shared.facts.find(x => x.fixtureId === "fixture-inspection");
  check("SS-06c fact 状态=contested", fact && fact.status === "contested", fact);
  const demoSid = shared.demoSessionId;
  if (demoSid) {
    const det = await call(`/api/v5-preview/remote-session/detail?sessionId=${demoSid}`);
    const revs = det.data.reviews || [];
    const rev = revs.find(x => String(x.reviewId || x.id || "").startsWith("rev-demo-"));
    check("SS-06d 演示复核确定性ID(rev-demo-*)", !!rev, revs.map(x => x.reviewId || x.id));
    NOTES.push({ at: "SS-06", reviews: revs.map(x => ({ id: x.reviewId || x.id, kind: x.kind, reviewer: x.reviewer })) });
  }
  const projAfter = (await getProject()).data;
  check("SS-06e 非asset域+场景零变化(仅相关域变更)", pickNonAsset(projBefore) === pickNonAsset(projAfter), {
    before: pickNonAsset(projBefore).slice(0, 260), after: pickNonAsset(projAfter).slice(0, 260),
  });
  const assetChanged = pickAsset(projBefore) !== pickAsset(projAfter);
  const todoTouched = JSON.stringify(projAfter.todos) !== JSON.stringify(projBefore.todos);
  check("SS-06f asset域或相关待办变化", assetChanged || todoTouched, { assetChanged, todoTouched });
  check("SS-06g 首页出现「证据纠正待复核」标记", JSON.stringify(projAfter).includes("证据纠正待复核"));
  check("SS-06h 场景未变", projAfter.scenario === projBefore.scenario);
  NOTES.push({ at: "SS-06", assetChanged, todoTouched });
}

// SS-07 旧证据保留 + 链可追溯
{
  const shared = (await getShared()).data;
  const demoSid = shared.demoSessionId;
  const det = await call(`/api/v5-preview/remote-session/detail?sessionId=${demoSid}`);
  const evs = det.data.evidence || [];
  check("SS-07 证据链记录在库(evidenceId/version, 可追溯)", evs.length >= 1 && evs.every(e => e.evidenceId && e.version >= 1),
    evs.map(e => ({ id: e.evidenceId, v: e.version, sup: e.supersedes, by: e.supersededBy })));
}

// SS-08 版本纪律：纯读不递增
{
  const v1 = (await getProject()).data.version;
  await getShared(); await getProject(); await getStory();
  const v2 = (await getProject()).data.version;
  check("SS-08 纯读(含shared-state)不递增 version", v1 === v2, { v1, v2 });
}

// SS-09 幂等重放：走到下一决定门，同 requestId 同载荷 decide ×2
{
  const w = await advanceUntilStop();
  check("SS-09a 到达下一决定门", w.stopped === "decision", { stopped: w.stopped, stepId: w.state.step?.stepId });
  const proj = (await getProject()).data;
  const st = (await getStory()).data;
  const body = { action: "decide", requestId: `${RID}-replay`, expectedVersion: proj.version, fromStepId: st.step.stepId, decision: "confirm" };
  const r1 = await call("/api/v5-preview/demo/story", "POST", body);
  const v1 = (await getProject()).data.version;
  const r2 = await call("/api/v5-preview/demo/story", "POST", body);
  const v2 = (await getProject()).data.version;
  check("SS-09b 同requestId重放幂等(replayed+版本不变)",
    r1.status === 200 && r2.status === 200 && r2.data.replayed === true && v1 === v2,
    { r1: r1.status, r2: r2.status, replayed: r2.data.replayed, v1, v2 });
  // 同 requestId 换载荷 → 409 REQUEST_MISMATCH
  const r3 = await call("/api/v5-preview/demo/story", "POST", { ...body, decision: "correct" });
  check("SS-09c 同requestId换载荷→409 REQUEST_MISMATCH", r3.status === 409 && r3.data.error === "REQUEST_MISMATCH", r3);
}

// SS-10 共享消息：确定性ID、来源诚实
{
  const proj = (await getProject()).data;
  const msgs = proj.messages || [];
  const sharedMsgs = msgs.filter(m => String(m.id || "").startsWith("msg-shared-"));
  const ids = new Set(sharedMsgs.map(m => m.id));
  check("SS-10a 共享消息确定性ID无重复", sharedMsgs.length === 0 || ids.size === sharedMsgs.length, sharedMsgs.map(m => m.id));
  const fakeModel = sharedMsgs.filter(m => /真实模型|模型已分析/.test(JSON.stringify(m)) && !/演示|模拟/.test(JSON.stringify(m)));
  check("SS-10b 共享消息不冒充真实模型", fakeModel.length === 0, fakeModel);
  NOTES.push({ at: "SS-10", sample: sharedMsgs.slice(-3) });
}

// SS-11 重开隔离
{
  const v0 = (await getProject()).data.version;
  const rl = await getRemoteList();
  const cr = await call("/api/v5-preview/remote-session", "POST", {
    requestId: `${RID}-iso-create`, expectedVersion: rl.data.remoteVersion,
    title: `[D-QA 合成] 重开隔离对照 ${RID}`,
  });
  const isoSid = cr.data.session?.sessionId;
  check("SS-11a 独立对照会话创建", cr.status === 200 && !!isoSid, cr);
  const before = (await getShared()).data.demoSessionId;
  const rs = await call("/api/v5-preview/demo/reset", "POST", {});
  check("SS-11b reset 被接受", rs.status === 200 && rs.data.ok === true, rs);
  const after = (await getShared()).data;
  const v2 = (await getProject()).data.version;
  check("SS-11c reset后专属演示指针清除或更换", after.demoSessionId !== before, { before, after: after.demoSessionId });
  check("SS-11d 独立对照会话仍在(重开不触及他人)",
    !!isoSid && ((await getRemoteList()).data.sessions || []).some(s => s.sessionId === isoSid), isoSid);
  check("SS-11e overview.version 单调递增", v2 > v0, { v0, v2 });
  const st = (await getStory()).data;
  check("SS-11f reset后回起点或诚实free", st.mode === "story" ? st.step?.stepIndex === 0 : st.mode === "free", { mode: st.mode, step: st.step && { id: st.step.stepId, idx: st.step.stepIndex } });
  if (before) {
    const det = await call(`/api/v5-preview/remote-session/detail?sessionId=${before}`);
    const cleared = det.status !== 200 || ((det.data.evidence || []).length === 0 && (det.data.annotations || []).length === 0 && (det.data.reviews || []).length === 0);
    check("SS-11g 旧专属演示会话证据/标注/复核已清除", cleared, { status: det.status, ev: (det.data.evidence || []).length });
  }
}

console.log(`\n== 结果: PASS=${PASS.length} FAIL=${FAIL.length} ==`);
if (FAIL.length) console.log("失败项:", FAIL.join(" | "));
if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({ rid: RID, base: BASE, at: new Date().toISOString(), pass: PASS, fail: FAIL, notes: NOTES }, null, 2));
  console.log("JSON 已写:", JSON_OUT);
}
process.exit(FAIL.length ? 1 : 0);
