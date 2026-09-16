import {
  fitTransform,
  graphInteractionReducer,
  initialGraphInteraction,
  nextNodeByDirection,
} from './graph-state.js';
import { advisoryOperation, createViewModel, visibleUiState } from './view-model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const $ = (selector) => document.querySelector(selector);
const requestedUiState = new URLSearchParams(location.search).get('uiState') ?? 'normal';

const state = {
  health: null,
  scenarios: [],
  workCases: [],
  graph: null,
  viewModel: null,
  interaction: null,
  selectedScenario: null,
  selectedCase: null,
  selectedActor: null,
  selectedNodeId: null,
  online: navigator.onLine,
  drawerType: null,
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
}

function setBusy(value) {
  $('#app').setAttribute('aria-busy', String(value));
  $('#loading-state').hidden = !value;
}

function showOverlay(kind, message = '') {
  $('#loading-state').hidden = kind !== 'loading';
  $('#empty-state').hidden = kind !== 'empty';
  $('#error-state').hidden = kind !== 'error';
  if (message) $('#error-message').textContent = message;
}

function showBanner(kind, text, { persist = false } = {}) {
  const banner = $('#status-banner');
  banner.dataset.kind = kind;
  banner.textContent = text;
  banner.hidden = false;
  clearTimeout(showBanner.timer);
  if (!persist) showBanner.timer = setTimeout(() => { banner.hidden = true; }, 6000);
}

async function fetchJson(path, options) {
  const response = await fetch(path, options);
  let body;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) {
    const error = new Error(body?.error?.message ?? `请求失败：HTTP ${response.status}`);
    error.code = body?.error?.code ?? 'HTTP_ERROR';
    error.status = response.status;
    error.details = body?.error?.details;
    throw error;
  }
  return body;
}

function scenarioLabel(key) {
  return state.scenarios.find((item) => item.scenarioKey === key)?.displayNameZh ?? key;
}

function populateScenarioSelect() {
  const select = $('#scenario-select');
  select.replaceChildren(...state.scenarios.map((scenario) => {
    const option = document.createElement('option');
    option.value = scenario.scenarioKey;
    option.textContent = scenario.displayNameZh;
    return option;
  }));
  state.selectedScenario = state.selectedScenario && state.scenarios.some((item) => item.scenarioKey === state.selectedScenario)
    ? state.selectedScenario : state.scenarios[0]?.scenarioKey ?? null;
  select.value = state.selectedScenario ?? '';
}

function populateCaseSelect() {
  const filtered = state.workCases.filter((item) => item.state.scenarioKey === state.selectedScenario);
  const select = $('#case-select');
  select.replaceChildren(...filtered.map((item) => {
    const option = document.createElement('option');
    option.value = item.workCaseId;
    option.textContent = item.state.title;
    return option;
  }));
  if (!filtered.some((item) => item.workCaseId === state.selectedCase)) state.selectedCase = filtered[0]?.workCaseId ?? null;
  select.value = state.selectedCase ?? '';
  return filtered;
}

function populateRoleSelect() {
  const actors = state.graph?.nodes.filter((node) => ['HumanPrincipal', 'RoutableAgent'].includes(node.type)) ?? [];
  const select = $('#role-select');
  select.replaceChildren(...actors.map((node) => {
    const [kind, ...parts] = node.id.split(':');
    const option = document.createElement('option');
    option.value = `${kind}:${parts.join(':')}`;
    option.textContent = `${node.label} · ${kind === 'human' ? '人员' : 'Agent'}`;
    return option;
  }));
  const currentValue = state.selectedActor ? `${state.selectedActor.kind}:${state.selectedActor.id}` : '';
  if (actors.some((node) => node.id === currentValue)) select.value = currentValue;
  else if (actors[0]) {
    const [kind, ...parts] = actors[0].id.split(':');
    state.selectedActor = { kind, id: parts.join(':') };
    select.value = actors[0].id;
  }
}

function renderHeader() {
  const provider = state.viewModel?.provider;
  $('#connection-status').textContent = state.viewModel?.connection ?? '连接未知';
  $('#provider-status').textContent = provider ? `${provider.label} · ${provider.statusLabel}` : 'Provider 未知';
  $('#case-subtitle').textContent = state.graph
    ? `${scenarioLabel(state.graph.scenarioKey)} · ${state.graph.workCase.id} · API projection v${state.graph.source.projectionVersion}`
    : '尚未选择 WorkCase';
}

function renderFiveQuestions() {
  const container = $('#five-questions');
  container.replaceChildren(...(state.viewModel?.questions ?? []).map((question) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'question-card';
    const dt = document.createElement('dt');
    dt.textContent = question.label;
    const dd = document.createElement('dd');
    dd.textContent = question.value;
    const source = document.createElement('small');
    source.textContent = `来源：${typeof question.sourceRef === 'string' ? question.sourceRef : 'API 投影字段'}`;
    wrapper.append(dt, dd, source);
    return wrapper;
  }));
}

function nodeClass(node) {
  return { WorkCase: 'workcase', HumanPrincipal: 'human', RoutableAgent: 'agent', ExternalSystem: 'system' }[node.type] ?? '';
}

function truncate(value, length) {
  const text = String(value ?? '');
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

function renderShape(group, node) {
  if (node.type === 'HumanPrincipal') group.append(svgElement('circle', { class: 'node-shape', cx: 0, cy: 0, r: 68 }));
  else if (node.type === 'RoutableAgent') group.append(svgElement('polygon', { class: 'node-shape', points: '-88,-55 62,-55 88,0 62,55 -88,55 -62,0' }));
  else if (node.type === 'ExternalSystem') {
    group.append(svgElement('rect', { class: 'node-shape', x: -100, y: -58, width: 200, height: 116, rx: 3 }));
    group.append(svgElement('rect', { x: -92, y: -50, width: 184, height: 100, fill: 'none', stroke: '#111', 'stroke-width': 1 }));
  } else group.append(svgElement('rect', { class: 'node-shape', x: -122, y: -62, width: 244, height: 124, rx: 38 }));
}

function renderNodeText(group, node) {
  const eyebrow = svgElement('text', { class: 'eyebrow', x: 0, y: -21, 'text-anchor': 'middle' });
  eyebrow.textContent = node.eyebrow;
  const label = svgElement('text', { class: 'label', x: 0, y: 3, 'text-anchor': 'middle' });
  label.textContent = truncate(node.label, node.type === 'WorkCase' ? 26 : 18);
  const detail = svgElement('text', { class: 'detail', x: 0, y: 26, 'text-anchor': 'middle' });
  detail.textContent = truncate(node.detail, 24);
  group.append(eyebrow, label, detail);
}

function renderGraph() {
  if (!state.graph || !state.interaction) return;
  const viewport = $('#viewport-layer');
  viewport.setAttribute('transform', `translate(${state.interaction.pan.x} ${state.interaction.pan.y}) scale(${state.interaction.zoom})`);
  $('#zoom-value').textContent = `${Math.round(state.interaction.zoom * 100)}%`;

  const edges = $('#edge-layer');
  edges.replaceChildren();
  for (const edge of state.graph.edges) {
    const from = state.interaction.positions[edge.from];
    const to = state.interaction.positions[edge.to];
    if (!from || !to) continue;
    const group = svgElement('g', { 'data-edge-id': edge.id });
    const classes = ['edge'];
    if (edge.line === 'dash' || edge.type === 'handoff_offered') classes.push('pending');
    if (edge.line === 'dot') classes.push('dot');
    if (edge.line === 'double') classes.push('double');
    if (edge.receiptStatus && edge.receiptStatus !== 'succeeded') classes.push('non-success');
    group.append(svgElement('line', { class: classes.join(' '), x1: from.x, y1: from.y, x2: to.x, y2: to.y, 'stroke-width': edge.weight }));
    const middleX = (from.x + to.x) / 2;
    const middleY = (from.y + to.y) / 2;
    const labelText = truncate(edge.label, 30);
    group.append(svgElement('rect', { class: 'edge-label-bg', x: middleX - Math.max(36, labelText.length * 5), y: middleY - 10, width: Math.max(72, labelText.length * 10), height: 20, rx: 10 }));
    const label = svgElement('text', { class: 'edge-label', x: middleX, y: middleY + 4 });
    label.textContent = labelText;
    group.append(label);
    edges.append(group);
  }

  const nodes = $('#node-layer');
  nodes.replaceChildren();
  for (const node of state.graph.nodes) {
    const position = state.interaction.positions[node.id];
    if (!position) continue;
    const group = svgElement('g', {
      class: `node ${nodeClass(node)}${state.selectedNodeId === node.id ? ' is-selected' : ''}`,
      transform: `translate(${position.x} ${position.y})`,
      tabindex: 0,
      role: 'button',
      'aria-label': `${node.eyebrow}：${node.label}。按 Enter 查看详情。`,
      'data-node-id': node.id,
    });
    const title = svgElement('title');
    title.textContent = `${node.label} · ${node.detail}`;
    group.append(title);
    renderShape(group, node);
    renderNodeText(group, node);
    nodes.append(group);
  }
}

function renderNodeDetail(nodeId = state.selectedNodeId) {
  const node = state.graph?.nodes.find((item) => item.id === nodeId);
  if (!node) {
    $('#node-detail').innerHTML = '<p>选择图中的节点查看它在当前 WorkCase 中的关系。</p>';
    return;
  }
  state.selectedNodeId = node.id;
  const relationships = state.graph.edges.filter((edge) => edge.from === node.id || edge.to === node.id).map((edge) => edge.label);
  $('#node-source').textContent = 'API 投影 / 只读';
  $('#node-detail').innerHTML = `<dl class="detail-list">
    <div><dt>类型</dt><dd>${escapeHtml(node.type)}</dd></div>
    <div><dt>名称</dt><dd>${escapeHtml(node.label)}</dd></div>
    <div><dt>说明</dt><dd>${escapeHtml(node.detail)}</dd></div>
    <div><dt>关系</dt><dd>${escapeHtml(relationships.join('；') || '无显式关系')}</dd></div>
    <div><dt>节点 ID</dt><dd>${escapeHtml(node.id)}</dd></div>
  </dl>`;
  renderGraph();
}

function renderCounts() {
  const pending = state.graph?.fiveQuestions.pendingHandoff.offerId ? 1 : 0;
  const gates = state.graph?.fiveQuestions.openGate.gates.length ?? 0;
  $('#handoff-count').textContent = String(pending);
  $('#gate-count').textContent = String(gates);
}

function renderAll() {
  renderHeader();
  renderFiveQuestions();
  renderCounts();
  renderGraph();
  renderNodeDetail();
}

function applyVisibleState() {
  const ui = visibleUiState(requestedUiState, {
    online: state.online,
    hasCases: state.workCases.length > 0,
    providerDegraded: state.viewModel?.provider.degraded,
    stale: state.viewModel?.stale,
  });
  document.body.dataset.uiState = ui.kind;
  if (ui.kind === 'empty') showOverlay('empty');
  else if (ui.kind === 'error') showOverlay('error', '这是可确定触发的错误状态演练；未把失败冒充成功。');
  else showOverlay(null);
  if (!['ready', 'empty', 'error'].includes(ui.kind)) showBanner(ui.kind, ui.label, { persist: true });
}

async function loadGraph({ preserveInteraction = false } = {}) {
  if (!state.selectedCase) {
    state.graph = null;
    state.viewModel = null;
    showOverlay('empty');
    renderHeader();
    return;
  }
  setBusy(true);
  try {
    const graph = await fetchJson(`/api/work-cases/${encodeURIComponent(state.selectedCase)}/graph`);
    const previousIds = new Set(state.graph?.nodes.map((node) => node.id) ?? []);
    const sameTopology = graph.nodes.every((node) => previousIds.has(node.id)) && previousIds.size === graph.nodes.length;
    state.graph = graph;
    state.viewModel = createViewModel(graph, state.health);
    if (!preserveInteraction || !sameTopology || !state.interaction) state.interaction = initialGraphInteraction(graph.nodes);
    state.selectedNodeId = graph.nodes.find((node) => node.id === state.selectedNodeId)?.id ?? graph.nodes.find((node) => node.type === 'WorkCase')?.id ?? graph.nodes[0]?.id;
    populateRoleSelect();
    renderAll();
    applyVisibleState();
  } catch (error) {
    showOverlay('error', error.message);
    showBanner(error.code === 'VERSION_CONFLICT' ? 'versionConflict' : 'error', `${error.code ?? 'ERROR'}：${error.message}`, { persist: true });
  } finally {
    setBusy(false);
  }
}

async function loadApp() {
  setBusy(true);
  if (requestedUiState === 'loading') {
    showOverlay('loading');
    showBanner('loading', '加载中（界面状态演练）：权威数据尚未被替代。', { persist: true });
    return;
  }
  if (requestedUiState === 'error') {
    setBusy(false);
    showOverlay('error', '这是可确定触发的错误状态演练；点击重新连接返回真实 API。');
    showBanner('error', '加载错误（界面状态演练）', { persist: true });
    return;
  }
  try {
    const [health, scenarios, cases] = await Promise.all([
      fetchJson('/health/ready'),
      fetchJson('/api/scenarios'),
      fetchJson('/api/work-cases'),
    ]);
    state.health = health;
    state.scenarios = scenarios.scenarios;
    state.workCases = cases.workCases;
    const requestedCase = new URLSearchParams(location.search).get('case');
    const preferred = state.workCases.find((item) => item.workCaseId === requestedCase)
      ?? state.workCases.find((item) => item.state.handoffOffers?.some((offer) => offer.status === 'offered'))
      ?? state.workCases[0];
    state.selectedCase = preferred?.workCaseId ?? null;
    state.selectedScenario = preferred?.state.scenarioKey ?? null;
    populateScenarioSelect();
    const filtered = populateCaseSelect();
    if (requestedUiState === 'empty' || filtered.length === 0) {
      state.graph = null;
      renderHeader();
      setBusy(false);
      applyVisibleState();
      return;
    }
    await loadGraph();
  } catch (error) {
    state.online = navigator.onLine;
    setBusy(false);
    showOverlay('error', error.message);
    showBanner(state.online ? 'error' : 'offline', `${error.code ?? 'NETWORK'}：${error.message}`, { persist: true });
  }
}

function updateInteraction(action) {
  state.interaction = graphInteractionReducer(state.interaction, action);
  renderGraph();
}

function graphPoint(event) {
  const svg = $('#continuity-canvas');
  const rect = svg.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * 1200 / rect.width, y: (event.clientY - rect.top) * 720 / rect.height };
}

let pointer = null;
function bindGraphInteraction() {
  const svg = $('#continuity-canvas');
  svg.addEventListener('wheel', (event) => {
    event.preventDefault();
    if (!state.interaction) return;
    updateInteraction({ type: 'zoomBy', factor: event.deltaY < 0 ? 1.1 : .9 });
  }, { passive: false });
  svg.addEventListener('pointerdown', (event) => {
    if (!state.interaction) return;
    const node = event.target.closest?.('[data-node-id]');
    const point = graphPoint(event);
    pointer = {
      id: event.pointerId,
      mode: node ? 'node' : 'pan',
      nodeId: node?.dataset.nodeId ?? null,
      start: point,
      originPan: { ...state.interaction.pan },
      originNode: node ? { ...state.interaction.positions[node.dataset.nodeId] } : null,
    };
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener('pointermove', (event) => {
    if (!pointer || pointer.id !== event.pointerId || !state.interaction) return;
    const point = graphPoint(event);
    const dx = point.x - pointer.start.x;
    const dy = point.y - pointer.start.y;
    if (pointer.mode === 'pan') updateInteraction({ type: 'fit', zoom: state.interaction.zoom, x: pointer.originPan.x + dx, y: pointer.originPan.y + dy });
    else updateInteraction({ type: 'moveNode', nodeId: pointer.nodeId, x: pointer.originNode.x + dx / state.interaction.zoom, y: pointer.originNode.y + dy / state.interaction.zoom });
  });
  svg.addEventListener('pointerup', (event) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const nodeId = pointer.nodeId;
    pointer = null;
    svg.releasePointerCapture(event.pointerId);
    if (nodeId) renderNodeDetail(nodeId);
  });
  svg.addEventListener('keydown', (event) => {
    const node = event.target.closest?.('[data-node-id]');
    if (!node || !state.interaction) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      renderNodeDetail(node.dataset.nodeId);
      $('#node-heading').scrollIntoView({ block: 'nearest' });
      return;
    }
    if (!event.key.startsWith('Arrow')) return;
    event.preventDefault();
    const nextId = nextNodeByDirection(node.dataset.nodeId, event.key, state.interaction.positions);
    state.interaction = graphInteractionReducer(state.interaction, { type: 'focus', nodeId: nextId });
    renderNodeDetail(nextId);
    requestAnimationFrame(() => document.querySelector(`[data-node-id="${CSS.escape(nextId)}"]`)?.focus());
  });
  svg.addEventListener('click', (event) => {
    const node = event.target.closest?.('[data-node-id]');
    if (node) renderNodeDetail(node.dataset.nodeId);
  });
}

async function sendCommand(commandType, payload) {
  if (!state.graph) return;
  const expectedStreamVersion = state.graph.source.projectionVersion;
  const body = {
    commandId: `p4-ui-${commandType.replace('.', '-')}-${Date.now()}`,
    idempotencyKey: `p4-ui-idempotency-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    expectedStreamVersion,
    configurationVersion: 1,
    commandType,
    demoActorRef: state.selectedActor,
    identityAssurance: 'demo_unverified',
    traceId: `trace-p4-ui-${Date.now()}`,
    payload,
  };
  showBanner('pending', '命令已发送，等待后端确定性校验；关系图不会乐观更新。', { persist: true });
  try {
    await fetchJson(`/api/work-cases/${encodeURIComponent(state.graph.workCase.id)}/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-trace-id': body.traceId },
      body: JSON.stringify(body),
    });
    await loadGraph({ preserveInteraction: true });
    showBanner('success', '后端已确认成功，关系图已从新投影刷新。');
    if (state.drawerType) openDrawer(state.drawerType);
  } catch (error) {
    if (error.code === 'VERSION_CONFLICT') {
      showBanner('versionConflict', '版本冲突：未修改 owner，正在刷新最新投影。', { persist: true });
      await loadGraph({ preserveInteraction: true });
    } else showBanner('error', `${error.code ?? 'COMMAND_FAILED'}：${error.message}`, { persist: true });
  }
}

function closeDrawer() {
  $('#drawer').hidden = true;
  $('#drawer-backdrop').hidden = true;
  state.drawerType = null;
}

function handoffContent(container) {
  const target = container.querySelector('#handoff-detail');
  const pending = state.graph?.fiveQuestions.pendingHandoff;
  const handoffs = state.graph?.edges.filter((edge) => edge.type.startsWith('handoff_')) ?? [];
  target.innerHTML = handoffs.length ? handoffs.map((edge) => `<article class="drawer-card"><h3>${escapeHtml(edge.label)}</h3><p><code>${escapeHtml(edge.id.replace('handoff:', ''))}</code></p><p>来源：${escapeHtml(edge.sourceRef.projectionField)}</p></article>`).join('') : '<p>当前没有交接记录。</p>';
  if (!pending?.offerId) return;
  const actions = document.createElement('div');
  actions.className = 'command-row';
  actions.innerHTML = '<button type="button" data-handoff-action="handoff.accept">明确接受</button><button type="button" data-handoff-action="handoff.clarify">请求澄清</button><button type="button" data-handoff-action="handoff.reject">拒绝交接</button>';
  const warning = document.createElement('p');
  warning.className = 'demo-command-warning';
  warning.textContent = '演示角色（未认证）：后端会校验指定接收者、版本、目标、上下文与 temporal authority。';
  target.append(actions, warning);
  actions.addEventListener('click', (event) => {
    const type = event.target.dataset.handoffAction;
    if (!type) return;
    const payload = type === 'handoff.accept'
      ? { offerId: pending.offerId, reason: '演示角色明确接受完整交接包。', nextAction: '按交接承诺继续推进并核验外部回执' }
      : { offerId: pending.offerId, reason: type === 'handoff.clarify' ? '需要补充证据或风险边界。' : '当前不具备接续条件。' };
    sendCommand(type, payload);
  });
}

function gateContent(container) {
  const target = container.querySelector('#gate-detail');
  const gates = state.graph?.fiveQuestions.openGate.gates ?? [];
  const controls = state.graph?.controls.protectedActions ?? [];
  target.innerHTML = gates.length ? gates.map((gate) => `<article class="drawer-card"><h3>${escapeHtml(gate.question)}</h3><p>具名 assignee：<strong>${escapeHtml(gate.assignedHumanId)}</strong></p><p>受保护动作：${escapeHtml(gate.protectedActions.join('、'))}</p><p>状态：open</p></article>`).join('') : '<p>当前没有开放 Human Gate。已处理 Gate 可在业务回放中审查。</p>';
  if (controls.length) target.insertAdjacentHTML('beforeend', controls.map((control) => `<article class="drawer-card"><h3>受保护动作 ${escapeHtml(control.actionIntentId)}</h3><p>${escapeHtml(control.disabledReason)}</p><button type="button" disabled>执行受保护动作</button></article>`).join(''));
}

function replayContent(container) {
  const target = container.querySelector('#replay-detail');
  const replay = state.graph?.replay;
  if (!replay) { target.textContent = '没有回放数据。'; return; }
  target.innerHTML = `<div class="six-question-grid">${replay.sixQuestions.map((item) => `<article class="drawer-card"><h3>${escapeHtml(item.question)}</h3><p>${escapeHtml(item.answer)}</p><p class="source-label">来源：${escapeHtml(item.source)}</p></article>`).join('')}</div>
    <ol class="timeline">${replay.timeline.map((item) => `<li><strong>#${item.streamVersion} ${escapeHtml(item.label)}</strong><span>${escapeHtml(item.summary)}</span><span>${escapeHtml(item.identityAssurance ?? '未记录身份保证')}</span></li>`).join('')}</ol>`;
}

function advisoryContent(container) {
  const button = container.querySelector('#request-advisory');
  button.addEventListener('click', async () => {
    const resultBox = container.querySelector('#advisory-result');
    const question = container.querySelector('#advisory-question').value.trim();
    let operation;
    try { operation = advisoryOperation(container.querySelector('#advisory-operation').value); } catch (error) { resultBox.textContent = error.message; return; }
    if (!state.graph?.rawRefs.evidenceIds.length || !state.graph.rawRefs.acceptedGoalVersion || !state.graph.rawRefs.contextVersion) {
      resultBox.textContent = '当前 WorkCase 缺少可用目标、上下文或 Evidence 引用。';
      return;
    }
    const beforeHash = state.graph.source.projectionHash;
    button.disabled = true;
    resultBox.textContent = '正在请求建议层；权威图保持不变。';
    const request = {
      providerRequestId: `p4-ui-advisory-${Date.now()}`.slice(0, 64),
      operation,
      workCaseId: state.graph.workCase.id,
      goalVersion: state.graph.rawRefs.acceptedGoalVersion,
      contextVersion: state.graph.rawRefs.contextVersion,
      inputRefs: state.graph.rawRefs.evidenceIds,
      outputSchemaVersion: 1,
      promptVersion: 'p4-ui-v1',
      evaluationVersion: 'p4-eval-v1',
      traceId: `trace-p4-advisory-${Date.now()}`,
      deadlineMs: 15000,
      dataClassification: 'internal',
    };
    try {
      const result = await fetchJson('/api/advisories', { method: 'POST', headers: { 'content-type': 'application/json', 'x-trace-id': request.traceId }, body: JSON.stringify(request) });
      const recommendation = result.recommendations[0];
      resultBox.innerHTML = `<article class="advisory-answer"><h3>建议结果 · ${escapeHtml(result.authority)}</h3><p>${escapeHtml(recommendation.summary)}</p><p>需人工确认：${recommendation.requiresHumanReview ? '是' : '否'} · 置信度 ${Math.round(recommendation.confidence * 100)}%</p><p>你的问题：${escapeHtml(question || '未填写；按所选建议类型请求')}</p><p><strong>权威快照未自动改变：</strong><code>${escapeHtml(beforeHash.slice(0, 16))}…</code></p></article>`;
    } catch (error) {
      resultBox.innerHTML = `<p class="boundary-note">${escapeHtml(error.code ?? 'ADVISORY_FAILED')}：${escapeHtml(error.message)}。权威图未改变。</p>`;
    } finally { button.disabled = false; }
  });
}

function openDrawer(type) {
  const templates = {
    handoff: ['待接受交接', '责任转移', '#drawer-handoff-template', handoffContent],
    gate: ['Human Gate', '具名控制项', '#drawer-gate-template', gateContent],
    replay: ['业务回放', '为什么走到这里', '#drawer-replay-template', replayContent],
    advisory: ['AI 建议（不自动执行）', '建议层', '#drawer-advisory-template', advisoryContent],
    status: ['状态演练', '韧性与错误', '#drawer-status-template', () => {}],
  };
  const config = templates[type];
  if (!config) return;
  state.drawerType = type;
  $('#drawer-title').textContent = config[0];
  $('#drawer-kicker').textContent = config[1];
  const content = $('#drawer-content');
  content.replaceChildren($(config[2]).content.cloneNode(true));
  config[3](content);
  $('#drawer').hidden = false;
  $('#drawer-backdrop').hidden = false;
  $('#close-drawer').focus();
}

function bindControls() {
  $('#zoom-in').addEventListener('click', () => state.interaction && updateInteraction({ type: 'zoomBy', factor: 1.25 }));
  $('#zoom-out').addEventListener('click', () => state.interaction && updateInteraction({ type: 'zoomBy', factor: .8 }));
  $('#fit-graph').addEventListener('click', () => state.interaction && updateInteraction({ type: 'fit', ...fitTransform(state.interaction.positions) }));
  $('#reset-graph').addEventListener('click', () => state.graph && updateInteraction({ type: 'reset', nodes: state.graph.nodes }));
  $('#status-lab-button').addEventListener('click', () => openDrawer('status'));
  $('#scenario-select').addEventListener('change', async (event) => {
    state.selectedScenario = event.target.value;
    populateCaseSelect();
    await loadGraph();
  });
  $('#case-select').addEventListener('change', async (event) => { state.selectedCase = event.target.value; await loadGraph(); });
  $('#role-select').addEventListener('change', (event) => {
    const [kind, ...parts] = event.target.value.split(':');
    state.selectedActor = { kind, id: parts.join(':') };
    showBanner('warning', '演示角色已切换；这不是登录或身份认证。');
  });
  document.querySelectorAll('[data-open-drawer]').forEach((button) => button.addEventListener('click', () => openDrawer(button.dataset.openDrawer)));
  $('#close-drawer').addEventListener('click', closeDrawer);
  $('#drawer-backdrop').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && state.drawerType) closeDrawer(); });
  $('#retry-load').addEventListener('click', () => { location.href = '?uiState=normal'; });
  $('#dismiss-onboarding').addEventListener('click', () => {
    $('#onboarding').hidden = true;
    try { sessionStorage.setItem('relayos-onboarding-seen', '1'); } catch { /* storage is optional */ }
  });
  window.addEventListener('offline', () => { state.online = false; showBanner('offline', '离线：关系图保留最后一次只读快照，不宣称已同步。', { persist: true }); });
  window.addEventListener('online', async () => { state.online = true; showBanner('reconnect', '网络已恢复，正在重新读取权威投影。', { persist: true }); await loadApp(); });
}

function initializeOnboarding() {
  const forced = new URLSearchParams(location.search).get('onboarding') === '1';
  let seen = false;
  try { seen = sessionStorage.getItem('relayos-onboarding-seen') === '1'; } catch { /* storage is optional */ }
  $('#onboarding').hidden = !forced && seen;
}

bindControls();
bindGraphInteraction();
initializeOnboarding();
loadApp();
