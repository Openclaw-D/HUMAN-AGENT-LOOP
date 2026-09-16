// 通用快照+语义diff工具（R-05/R-06 核心检测：首页投影"只有相关域变更"）
// 接口无关：抓取当前已知的全部状态入口，diff 时按顶层键/数组元素身份对齐。
// 用法：
//   import { snapshot, diff } from "./snapshot.mjs";
//   const a = await snapshot(BASE); ...操作...; const b = await snapshot(BASE);
//   console.log(JSON.stringify(diff(a, b), null, 2));
const sha = (s) => {
  import("node:crypto").then(({ createHash }) => createHash("sha256").update(s).digest("hex"));
};

async function getJson(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const t = await r.text();
    try { return { status: r.status, body: JSON.parse(t) }; }
    catch { return { status: r.status, body: t.slice(0, 2000) }; }
  } catch (e) {
    return { status: 0, body: { error: String(e.message || e) } };
  }
}

// 抓取全部已知状态入口（A 若新增入口，在此追加；diff 不受影响）
export async function snapshot(BASE, extraPaths = []) {
  const paths = [
    ["project", "/api/v5-preview/project"],
    ["remoteList", "/api/v5-preview/remote-session"],
    ["story", "/api/v5-preview/demo/story"],
    ["sharedState", "/api/v5-preview/demo/shared-state"],
    ...extraPaths.map((p) => [p.replace(/\W+/g, "_"), p]),
  ];
  const out = { at: new Date().toISOString(), sections: {} };
  for (const [name, p] of paths) {
    out.sections[name] = await getJson(BASE + p);
  }
  return out;
}

// 深比较：返回变更路径列表 [{path, before, after}]；数组按 JSON 稳定序列化对齐（保守，逐项 Diff 可能偏多，解释时以域键为准）
export function diff(a, b, path = "") {
  const changes = [];
  if (JSON.stringify(a) === JSON.stringify(b)) return changes;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") {
    changes.push({ path: path || "<root>", before: short(a), after: short(b) });
    return changes;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    changes.push({ path: path || "<root>", before: short(a), after: short(b) });
    return changes;
  }
  if (Array.isArray(a)) {
    // 元素身份：优先匹配 id/sessionId/key 字段，否则按序列化对齐
    const keyOf = (x) => (x && typeof x === "object")
      ? JSON.stringify(x.id ?? x.sessionId ?? x.todoId ?? x.domain ?? x.stepId ?? x.evidenceId ?? x) 
      : JSON.stringify(x);
    const am = new Map(a.map((x) => [keyOf(x), x]));
    const bm = new Map(b.map((x) => [keyOf(x), x]));
    for (const [k, v] of am) if (!bm.has(k)) changes.push({ path: `${path}[]`, before: short(v), after: "<removed>" });
    for (const [k, v] of bm) if (!am.has(k)) changes.push({ path: `${path}[]`, before: "<added>", after: short(v) });
    for (const [k, v] of am) if (bm.has(k)) changes.push(...diff(v, bm.get(k), `${path}[]`));
    return changes;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (!(k in a)) changes.push({ path: `${path}.${k}`, before: "<absent>", after: short(b[k]) });
    else if (!(k in b)) changes.push({ path: `${path}.${k}`, before: short(a[k]), after: "<absent>" });
    else changes.push(...diff(a[k], b[k], `${path}.${k}`));
  }
  return changes;
}

// 提取"域级"变更摘要：把 changes 归并到一阶键（判断"只有相关域变更"用）
export function domainLevel(changes, snapA, snapB) {
  const domains = new Set();
  for (const c of changes) {
    // path 形如 .sections.project.body.<...一阶键>.rest
    const m = c.path.match(/^\.sections\.(\w+)\.body(?:\.raw)?\.([^.\[]+)/);
    domains.add(m ? `${m[1]}:${m[2]}` : c.path.split(".").slice(0, 4).join("."));
  }
  return [...domains];
}

function short(v) {
  const s = JSON.stringify(v);
  return s === undefined ? String(v) : s.length > 160 ? s.slice(0, 157) + "…" : s;
}
