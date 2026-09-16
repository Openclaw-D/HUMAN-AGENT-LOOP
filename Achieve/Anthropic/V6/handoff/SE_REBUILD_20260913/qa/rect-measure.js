// SE_REBUILD_20260913 · QA-C 交付物 3b：浏览器内布局/交互实测片段（在 /v5-preview 页面 console 或 evaluate 中执行）。
// 用法：整段粘贴执行（异步，总耗时约 70–80 秒，其中含 60 秒静置观测；期间不要操作页面、保持标签页可见）。
// 返回：JSON 对象（同时 console.log 一份，并挂到 window.__jwRectReport）。
// 覆盖：横向溢出；四域矩阵行逐行 getBoundingClientRect 与滚动祖先交集；顶部→待办区块高度；
//       沟通区（含输入）高度；展开控件 hit area；30 次展开/收起延迟 p50/p95；60 秒静置新请求数。
// 选择器策略：优先 aria-label 语义选择器（四域总览 section、article 域卡、当前待办/项目沟通 section、
//       button[aria-expanded]）；找不到时回退到 h2 文本（政策/信审/商务/资产）识别域卡。
(async () => {
  'use strict';
  const R = { tool: 'rect-measure.js', generatedAt: new Date().toISOString(), warnings: [] };

  // ---------- 基础助手 ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const round2 = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
  const rectOf = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { left: round2(b.left), top: round2(b.top), right: round2(b.right), bottom: round2(b.bottom), width: round2(b.width), height: round2(b.height) };
  };
  const cssOf = (el, prop) => {
    try { return getComputedStyle(el).getPropertyValue(prop).trim(); } catch { return null; }
  };
  const describe = (el) => {
    if (!el) return null;
    let d = el.tagName.toLowerCase();
    if (el.id) d += '#' + el.id;
    const aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria) d += `[aria-label="${String(aria).slice(0, 16)}…"]`;
    const cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/)[0];
    if (cls) d += '.' + cls;
    return d;
  };
  /** 向上找真实滚动祖先：overflow-y 为 auto/scroll 且确有溢出内容；找不到则回退文档滚动根。 */
  const scrollAncestor = (el) => {
    let node = el && el.parentElement;
    while (node && node !== document.documentElement) {
      const oy = cssOf(node, 'overflow-y');
      if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight + 1) return node;
      node = node.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  };
  const intersectH = (a, b) => Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const intersectW = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));

  // ---------- 元素定位（主选择器 + 回退） ----------
  const findTodo = () => document.querySelector('section[aria-label="当前待办"]');
  const findChat = () => document.querySelector('section[aria-label="项目沟通"]');
  const findDomainCards = () => {
    const sec = [...document.querySelectorAll('section[aria-label]')].find((s) => (s.getAttribute('aria-label') || '').startsWith('四域总览'));
    if (sec) {
      const cards = [...sec.querySelectorAll(':scope article')];
      if (cards.length === 4) return { cards, strategy: 'section[aria-label^="四域总览"] > article' };
    }
    const names = ['政策', '信审', '商务', '资产'];
    const cards = names
      .map((n) => [...document.querySelectorAll('article')].find((a) => {
        const h = a.querySelector('h1,h2,h3');
        return h && h.textContent.trim() === n;
      }))
      .filter(Boolean);
    return { cards, strategy: cards.length === 4 ? 'article > h1/h2/h3 文本回退' : '未找到（页面未就绪或结构变更）' };
  };

  // ---------- meta ----------
  R.meta = {
    url: location.href,
    pathname: location.pathname,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    devicePixelRatio: window.devicePixelRatio,
    userAgent: navigator.userAgent,
    readyStateAtStart: document.readyState,
    sessionStorageNotes: (() => {
      try {
        return {
          chatOpen: sessionStorage.getItem('jw:v5-preview:chat-open'),
          hasTodoDraft: sessionStorage.getItem('jw:v5-preview:draft:todo') !== null,
          hasChatDraft: sessionStorage.getItem('jw:v5-preview:draft:chat') !== null,
        };
      } catch { return 'unavailable'; }
    })(),
  };
  if (location.pathname !== '/v5-preview') R.warnings.push(`当前页面是 ${location.pathname}，清单要求在 /v5-preview 上测。`);

  // ---------- 等待页面就绪（待办卡 + 四域卡出现） ----------
  const readyDeadline = Date.now() + 15000;
  let cards = [];
  let cardStrategy = null;
  while (Date.now() < readyDeadline) {
    const found = findDomainCards();
    cards = found.cards;
    cardStrategy = found.strategy;
    if (cards.length === 4 && findTodo()) break;
    await sleep(150);
  }
  if (cards.length !== 4) R.warnings.push(`就绪超时：只找到 ${cards.length} 个域卡（选择器：${cardStrategy}）。后续结果可能不完整。`);

  // 滚动祖先先归位（静态测量统一在 scrollTop=0 下进行）。
  let mainScroll = null;
  if (cards[0]) {
    mainScroll = scrollAncestor(cards[0]);
    try { mainScroll.scrollTop = 0; } catch { /* ignore */ }
    await nextFrame(); await nextFrame();
  }
  R.meta.mainScrollAncestor = describe(mainScroll);
  R.meta.mainScrollState = mainScroll ? { scrollTop: mainScroll.scrollTop, scrollHeight: mainScroll.scrollHeight, clientHeight: mainScroll.clientHeight } : null;

  // ---------- 1) 横向溢出 ----------
  {
    const de = document.documentElement;
    const offenders = [];
    for (const el of document.querySelectorAll('*')) {
      const b = el.getBoundingClientRect();
      if (b.width <= 0 || b.height <= 0) continue;
      const overRight = b.right - window.innerWidth;
      const overLeft = -b.left;
      if (overRight > 0.5 || overLeft > 0.5) offenders.push({ el, over: Math.max(overRight, overLeft) });
    }
    offenders.sort((x, y) => y.over - x.over);
    R.overflow = {
      documentElementScrollWidth: de.scrollWidth,
      bodyScrollWidth: document.body ? document.body.scrollWidth : null,
      innerWidth: window.innerWidth,
      horizontalOverflowPx: round2(Math.max(de.scrollWidth, document.body ? document.body.scrollWidth : 0) - window.innerWidth),
      noHorizontalOverflow: de.scrollWidth <= window.innerWidth,
      worstOffenders: offenders.slice(0, 8).map(({ el, over }) => ({ desc: describe(el), overByPx: round2(over), rect: rectOf(el) })),
    };
  }

  // ---------- 2) 四域矩阵行：逐行 rect + 与滚动祖先交集 ----------
  R.domainRows = cards.map((card, i) => {
    const name = (card.querySelector('h1,h2,h3') || {}).textContent || `row${i}`;
    const c = card.getBoundingClientRect();
    const anc = scrollAncestor(card);
    const a = anc.getBoundingClientRect();
    const interHpx = intersectH({ top: c.top, bottom: c.bottom }, { top: a.top, bottom: a.bottom });
    const interWpx = intersectW({ left: c.left, right: c.right }, { left: a.left, right: a.right });
    const inViewportH = intersectH({ top: c.top, bottom: c.bottom }, { top: 0, bottom: window.innerHeight });
    return {
      index: i,
      name: name.trim(),
      selectorStrategy: cardStrategy,
      rect: { left: round2(c.left), top: round2(c.top), right: round2(c.right), bottom: round2(c.bottom), width: round2(c.width), height: round2(c.height) },
      scrollAncestor: describe(anc),
      scrollAncestorRect: { top: round2(a.top), bottom: round2(a.bottom), height: round2(a.height) },
      intersectionWithAncestorPx: { height: round2(interHpx), width: round2(interWpx) },
      intersectsScrollAncestor: interHpx > 0 && interWpx > 0,
      intersectionWithViewportPx: round2(inViewportH),
      visibleInViewport: inViewportH > 0,
      contentOffsetTopInAncestor: round2(c.top - a.top + anc.scrollTop),
    };
  });

  // ---------- 3) 顶部 → 待办区块 ----------
  {
    const todo = findTodo();
    if (todo) {
      const t = todo.getBoundingClientRect();
      const anc = scrollAncestor(todo);
      const a = anc.getBoundingClientRect();
      R.todo = {
        found: true,
        rect: rectOf(todo),
        topFromViewportTopPx: round2(t.top),
        bottomFromViewportTopPx: round2(t.bottom),
        topInScrollContentPx: round2(t.top - a.top + anc.scrollTop),
        bottomInScrollContentPx: round2(t.bottom - a.top + anc.scrollTop),
        scrollAncestor: describe(anc),
        measuredAtScrollTop: anc.scrollTop,
        fullyVisibleInViewport: t.top >= 0 && t.bottom <= window.innerHeight,
      };
    } else {
      R.todo = { found: false };
      R.warnings.push('未找到 section[aria-label="当前待办"]。');
    }
  }

  // ---------- 4) 沟通区（确保展开后测含输入的总高度） ----------
  {
    const chat = findChat();
    if (chat) {
      const toggle = chat.querySelector('button[aria-expanded]');
      let ensuredOpen = false;
      if (toggle && toggle.getAttribute('aria-expanded') === 'false') {
        toggle.click();
        await nextFrame(); await nextFrame();
        ensuredOpen = true;
      }
      const input = chat.querySelector('#v5-rows-chat-input') || chat.querySelector('input,textarea');
      const sendBtn = chat.querySelector('form button[type="submit"]');
      const list = chat.querySelector('ol[role="log"]') || chat.querySelector('ol');
      R.chat = {
        found: true,
        ensuredOpenByClick: ensuredOpen,
        openState: toggle ? toggle.getAttribute('aria-expanded') : null,
        rect: rectOf(chat),
        heightPx: rectOf(chat) ? round2(chat.getBoundingClientRect().height) : null,
        input: { found: !!input, rect: rectOf(input), hitHeightPx: input ? round2(input.getBoundingClientRect().height) : null },
        sendButton: { found: !!sendBtn, rect: rectOf(sendBtn), hitHeightPx: sendBtn ? round2(sendBtn.getBoundingClientRect().height) : null },
        messageList: { found: !!list, rect: rectOf(list), heightPx: list ? round2(list.getBoundingClientRect().height) : null },
      };
    } else {
      R.chat = { found: false };
      R.warnings.push('未找到 section[aria-label="项目沟通"]。');
    }
  }

  // ---------- 5) 展开控件 hit area ----------
  {
    const perCard = cards.map((card, i) => {
      const btn = card.querySelector('button[aria-expanded]');
      const b = btn ? btn.getBoundingClientRect() : null;
      return {
        index: i,
        name: ((card.querySelector('h1,h2,h3') || {}).textContent || '').trim(),
        toggleFound: !!btn,
        toggleVisible: !!btn && b.height > 0 && cssOf(btn, 'display') !== 'none',
        display: btn ? cssOf(btn, 'display') : null,
        ariaExpanded: btn ? btn.getAttribute('aria-expanded') : null,
        hitHeightPx: b ? round2(b.height) : null,
        hitWidthPx: b ? round2(b.width) : null,
        cardHeightPx: round2(card.getBoundingClientRect().height),
      };
    });
    const visible = perCard.filter((p) => p.toggleVisible);
    R.hitAreas = {
      perCard,
      minToggleHitHeightPx: visible.length ? Math.min(...visible.map((p) => p.hitHeightPx)) : null,
      allVisibleTogglesMeet44px: visible.length > 0 && visible.every((p) => p.hitHeightPx >= 44),
      note: '阈值 44px 仅作用于可见展开控件；旧代码 ≤480px 隐藏 .segToggle（display:none）属预期，记录不算失败。',
    };
  }

  // ---------- 6) 30 次展开/收起延迟采样（同步派发耗时 + 到下一帧绘制耗时） ----------
  {
    const target = R.hitAreas.perCard.find((p) => p.toggleVisible);
    if (!target) {
      R.toggleLatency = { skipped: true, reason: '没有可见的展开控件（旧代码 ≤480px 将 .segToggle 设为 display:none 时会出现；重构后应可测）。' };
    } else {
      const card = cards[target.index];
      const btn = card.querySelector('button[aria-expanded]');
      if (btn.getAttribute('aria-expanded') === 'true') { btn.click(); await nextFrame(); await nextFrame(); }
      const syncSamples = [];
      const paintSamples = [];
      let flipFailures = 0;
      for (let i = 0; i < 30; i += 1) {
        const before = btn.getAttribute('aria-expanded');
        const t0 = performance.now();
        btn.click();
        const tSync = performance.now();
        await nextFrame(); await nextFrame();
        const tPaint = performance.now();
        const after = btn.getAttribute('aria-expanded');
        if (after === before) flipFailures += 1;
        syncSamples.push(round2(tSync - t0));
        paintSamples.push(round2(tPaint - t0));
      }
      if (btn.getAttribute('aria-expanded') === 'true') { btn.click(); await nextFrame(); await nextFrame(); }
      const stats = (arr) => {
        const s = [...arr].sort((x, y) => x - y);
        const pick = (q) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
        return { n: s.length, minMs: s[0], p50Ms: pick(0.5), p95Ms: pick(0.95), maxMs: s[s.length - 1] };
      };
      R.toggleLatency = {
        skipped: false,
        targetRow: target.name,
        flipFailures,
        syncDispatch: stats(syncSamples),
        toNextPaint: stats(paintSamples),
        raw: { syncDispatchMs: syncSamples, toNextPaintMs: paintSamples },
        note: 'syncDispatch=click() 同步返回耗时（近似 React 事件+渲染）；toNextPaint=点击到其后第 2 帧 rAF 的耗时（近似可感知上屏）。标签页需保持可见，否则 rAF 被节流。',
      };
    }
  }

  // ---------- 7) 60 秒静置请求数（1s 轮询 performance resource entries） ----------
  {
    const seen = new Set(performance.getEntriesByType('resource').map((e) => `${e.name}|${e.startTime}`));
    const DURATION_MS = 60000;
    const POLL_MS = 1000;
    const newEntries = [];
    const visibility = new Set();
    const t0 = performance.now();
    while (performance.now() - t0 < DURATION_MS) {
      await sleep(POLL_MS);
      visibility.add(document.visibilityState);
      for (const e of performance.getEntriesByType('resource')) {
        const key = `${e.name}|${e.startTime}`;
        if (seen.has(key)) continue;
        seen.add(key);
        newEntries.push({
          name: e.name,
          initiatorType: e.initiatorType,
          startS: round2(e.startTime / 1000),
          durationMs: round2(e.duration),
          transferSize: e.transferSize,
        });
      }
    }
    R.idleRequests = {
      windowMs: DURATION_MS,
      pollMs: POLL_MS,
      totalNew: newEntries.length,
      apiNew: newEntries.filter((e) => e.name.includes('/api/')).length,
      apiUrls: [...new Set(newEntries.filter((e) => e.name.includes('/api/')).map((e) => e.name.split('?')[0]))],
      nonApiNew: newEntries.filter((e) => !e.name.includes('/api/')).length,
      entries: newEntries,
      visibilityStates: [...visibility],
      note: '旧代码页面每 4s 轮询 GET /api/v5-preview/project，静置 60s 预期约 15 次 api 请求；重构后按实测记录前后对照。',
    };
  }

  // ---------- 汇总判读（信息性；最终验收口径见 browser-checklist.md） ----------
  R.checks = {
    noHorizontalOverflow: R.overflow.noHorizontalOverflow === true,
    fourDomainRowsFound: cards.length === 4,
    everyRowIntersectsScrollAncestor: cards.length === 4 && R.domainRows.every((r) => r.intersectsScrollAncestor),
    todoBottomFromViewportTopPx: R.todo.bottomFromViewportTopPx ?? null,
    todoBottomInRange350to370: typeof R.todo.bottomFromViewportTopPx === 'number' && R.todo.bottomFromViewportTopPx >= 350 && R.todo.bottomFromViewportTopPx <= 370,
    chatHeightPx: R.chat.heightPx ?? null,
    chatHeightInRange290to310: typeof R.chat.heightPx === 'number' && R.chat.heightPx >= 290 && R.chat.heightPx <= 310,
    minToggleHitHeightPx: R.hitAreas.minToggleHitHeightPx,
    visibleTogglesMeet44px: R.hitAreas.allVisibleTogglesMeet44px === true,
    toggleLatencyP95Ms: R.toggleLatency.skipped ? null : R.toggleLatency.syncDispatch.p95Ms,
    idleApiRequests60s: R.idleRequests.apiNew,
  };

  window.__jwRectReport = R;
  try { console.log('[rect-measure]', JSON.stringify(R)); } catch { /* ignore */ }
  return R;
})()
