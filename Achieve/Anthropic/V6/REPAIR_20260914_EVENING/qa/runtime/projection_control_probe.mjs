// SS-06f 对照实验：隔离投影效应 — correct路径 vs confirm路径，同在 s12 决定门快照
// 预期：两路径在 s12 门的 project 差异 仅限 asset域标记 / messages / todo文案 / version/updatedAt
const B = "http://127.0.0.1:3469";
const call = async (p, m = "GET", b) => {
  const r = await fetch(B + p, { method: m, headers: b ? { "Content-Type": "application/json" } : {}, body: b ? JSON.stringify(b) : undefined });
  return { s: r.status, d: await r.json().catch(() => ({})) };
};
const rid = () => "dqa-ctl-" + Math.random().toString(16).slice(2, 10);
async function walkToS09() {
  for (let i = 0; i < 30; i++) {
    const st = (await call("/api/v5-preview/demo/story")).d;
    if (st.mode !== "story") return null;
    if (st.step.decision) return st;
    const pj = (await call("/api/v5-preview/project")).d;
    const r = await call("/api/v5-preview/demo/story", "POST", { action: "advance", requestId: rid(), expectedVersion: pj.version, fromStepId: st.step.stepId });
    if (r.s !== 200) return null;
  }
  return null;
}
async function runPath(decision) {
  await call("/api/v5-preview/demo/reset", "POST", {});
  const st09 = await walkToS09();
  if (!st09 || st09.step.stepId !== "s09-dd-07") return { error: "not at s09: " + (st09 && st09.step.stepId) };
  const pj = (await call("/api/v5-preview/project")).d;
  const dec = await call("/api/v5-preview/demo/story", "POST", { action: "decide", requestId: rid(), expectedVersion: pj.version, fromStepId: st09.step.stepId, decision, note: "D对照实验" });
  if (dec.s !== 200) return { error: "decide failed", dec };
  // 推进到下一个决定门（s12）后快照
  let st = (await call("/api/v5-preview/demo/story")).d;
  for (let i = 0; i < 10; i++) {
    if (st.mode !== "story") break;
    if (st.step.decision) break;
    const pj2 = (await call("/api/v5-preview/project")).d;
    const r = await call("/api/v5-preview/demo/story", "POST", { action: "advance", requestId: rid(), expectedVersion: pj2.version, fromStepId: st.step.stepId });
    if (r.s !== 200) break;
    st = (await call("/api/v5-preview/demo/story")).d;
  }
  const snap = (await call("/api/v5-preview/project")).d;
  return { atStep: st.step && st.step.stepId, snap };
}
(async () => {
  const A = await runPath("correct"); // 纠正路径
  const Bp = await runPath("confirm"); // 确认路径
  console.log("A at:", A.atStep, " B at:", Bp.atStep);
  if (A.error || Bp.error) { console.log("ERROR", A.error || Bp.error); process.exit(1); }
  const strip = (s) => { const c = { ...s.snap }; delete c.version; delete c.updatedAt; delete c.messages; return c; };
  const da = strip(A), db = strip(Bp);
  console.log("== 除 messages/version/updatedAt 外，两路径 payload 是否完全一致:", JSON.stringify(da) === JSON.stringify(db));
  // 域级差异定位
  for (let i = 0; i < 4; i++) {
    const x = da.domains[i], y = db.domains[i];
    if (JSON.stringify(x) !== JSON.stringify(y)) {
      console.log(`域[${i}]${x.name} 差异:`);
      console.log("  correct:", JSON.stringify({ judgmentStatus: x.judgmentStatus, judgmentText: x.judgmentText }));
      console.log("  confirm:", JSON.stringify({ judgmentStatus: y.judgmentStatus, judgmentText: y.judgmentText }));
    }
  }
  if (JSON.stringify(da.todo) !== JSON.stringify(db.todo)) {
    console.log("todo 差异:");
    console.log("  correct:", JSON.stringify(da.todo).slice(0, 300));
    console.log("  confirm:", JSON.stringify(db.todo).slice(0, 300));
  }
  // 消息差异中的共享事件
  const am = (A.snap.messages || []).map(m => m.id || m.title);
  const bm = (Bp.snap.messages || []).map(m => m.id || m.title);
  const onlyA = am.filter(x => !bm.includes(x));
  const onlyB = bm.filter(x => !am.includes(x));
  console.log("仅correct路径消息:", onlyA);
  console.log("仅confirm路径消息:", onlyB);
  // shared-state 对照
  await call("/api/v5-preview/demo/reset", "POST", {});
  const sA = A.snap; // 快照已含
  console.log("correct路径 snapshot 含「证据纠正待复核」:", JSON.stringify(sA).includes("证据纠正待复核"));
  console.log("confirm路径 snapshot 含「证据纠正待复核」:", JSON.stringify(Bp.snap).includes("证据纠正待复核"));
})();
