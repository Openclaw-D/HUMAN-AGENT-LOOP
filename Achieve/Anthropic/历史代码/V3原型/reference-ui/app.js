'use strict';

const $ = (selector) => document.querySelector(selector);
const state = { projection: null, scene: null, view: null, selection: null, messages: [], model: { status: '尚未请求', artifact: null, elapsed: '—' }, graph: { zoom: 1, panX: 0, panY: 0, positions: {} } };
const exactScenes = ['风控业务协同','需求开发协同','人机交互协同','内容生产协同','经营增长协同','物理智能协同','知识办公协同','客户服务协同','供应链履约协同','医疗服务协同'];
const escapeHtml = (value) => String(value ?? '—').replace(/[&<>'"]/g, (character) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[character]));
const byId = (id) => state.scene.nodes.find((node) => node.id === id);
const selection = (kind, title, data) => { state.selection = { kind, title, data }; render(); };
const layoutKey = () => `见微显示布局-${state.scene.id}-${state.scene.projectionVersion}`;
const saveLayout = () => localStorage.setItem(layoutKey(), JSON.stringify(state.graph.positions));
const loadLayout = () => { try { state.graph.positions = JSON.parse(localStorage.getItem(layoutKey()) || '{}'); } catch { state.graph.positions = {}; } };

function validateProjection(value) {
  if (!value || value.schema !== '协同状态投影第二版' || !Array.isArray(value.scenarios) || value.scenarios.length !== 10) throw new Error('状态投影结构不完整，请刷新状态。');
  if (value.scenarios.map((scene) => scene.name).join('、') !== exactScenes.join('、')) throw new Error('场景范围或顺序不一致，请刷新状态。');
  for (const scene of value.scenarios) {
    if (scene.projectionVersion !== scene.eventCursor - 200 || !scene.owner || !scene.version || scene.nodes.length < 8 || scene.stages.length < 7 || scene.matrix.length < 5) throw new Error('版本、负责人或场景结构待核验，请刷新状态。');
  }
  return value;
}
function fail(message) { $('#workspace').hidden = true; $('#failure').hidden = false; $('#failureText').textContent = `${message} 前端不会自动切换到示例状态。`; }
function statusText() {
  const scene = state.scene;
  $('#authorityStatus').innerHTML = `<strong>演示状态</strong><span>投影版本：第${scene.projectionVersion}版</span><span>事件游标：第${scene.eventCursor}项</span>`;
  $('#statusStrip').innerHTML = `<span><b>目标：</b>${escapeHtml(scene.goal)}</span><span><b>负责人：</b>${escapeHtml(scene.owner)}</span><span><b>当前阶段：</b>${escapeHtml(scene.phase)}</span><span><b>当前质疑：</b>${escapeHtml(scene.challenge)}</span><span><b>人工关口：</b>${escapeHtml(scene.gate)}</span><span><b>最新回执：</b>${escapeHtml(scene.receipt)}</span>`;
  $('#canvasKicker').textContent = `${scene.name} · ${scene.work}`;
  $('#canvasTitle').textContent = scene.goal;
  $('#canvasMeta').textContent = `目标版本：${scene.version}　投影版本：第${scene.projectionVersion}版　生成于：${state.projection.generatedAt}`;
}
function renderTop() {
  const scenario = $('#scenarioSelect'); scenario.replaceChildren(...state.projection.scenarios.map((scene) => new Option(scene.name, scene.id))); scenario.value = state.scene.id;
  const work = $('#workSelect'); work.replaceChildren(new Option(state.scene.work, state.scene.id));
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === state.view));
}
function graphNodePosition(node) { return state.graph.positions[node.id] || { x: node.x, y: node.y }; }
function graph() {
  const scene = state.scene; const node = (id) => graphNodePosition(byId(id));
  const edgeLines = scene.edges.map((edge) => { const from = node(edge.from), to = node(edge.to); return `<line x1="${from.x * 10}" y1="${from.y * 8}" x2="${to.x * 10}" y2="${to.y * 8}" class="${edge.state === '未知' ? 'unknown-line' : edge.state === '待关口' ? 'gate-line' : ''}"></line>`; }).join('');
  const edgeLabels = scene.edges.map((edge) => { const from = node(edge.from), to = node(edge.to); return `<button class="edge-label ${edge.state === '未知' ? 'unknown' : ''}" data-edge="${edge.id}" style="left:${(from.x + to.x) / 2}%;top:${(from.y + to.y) / 2}%" aria-label="选择${escapeHtml(edge.label)}关系">${escapeHtml(edge.label)} · ${escapeHtml(edge.state)}</button>`; }).join('');
  const nodes = scene.nodes.map((item) => { const position = graphNodePosition(item); const selected = state.selection?.data?.id === item.id; return `<button class="graph-node ${item.risk ? 'risk' : ''} ${selected ? 'selected' : ''}" data-node="${item.id}" style="left:${position.x}%;top:${position.y}%" aria-label="选择${escapeHtml(item.label)}，${escapeHtml(item.type)}"><small>${escapeHtml(item.type)}</small><strong>${escapeHtml(item.label)}</strong><span>${item.risk ? '需关注' : '状态可用'}</span></button>`; }).join('');
  return `<section class="graph-view"><div class="graph-tools"><button type="button" data-graph="in">放大</button><button type="button" data-graph="out">缩小</button><button type="button" data-graph="fit">适应范围</button><button type="button" data-graph="focus">聚焦当前</button><output id="zoomText" aria-label="当前缩放比例">${Math.round(state.graph.zoom * 100)}％</output><span>拖动节点仅调整本地显示；空白处平移，按住控制键滚轮缩放</span></div><div id="graphViewport" class="graph-viewport" aria-label="可平移缩放的关系画布"><div id="graphWorld" class="graph-world" style="transform:translate(${state.graph.panX}px,${state.graph.panY}px) scale(${state.graph.zoom})"><svg class="graph-lines" viewBox="0 0 1000 800" preserveAspectRatio="none">${edgeLines}</svg>${nodes}${edgeLabels}</div></div><p class="graph-legend">实线：有效关系　双线：待人工关口　虚线：未知回执。当前责任、卡点、人工关口与未知回执在任何比例下均保留。</p></section>`;
}
function progress() {
  const scene = state.scene;
  const cards = scene.stages.map((stage, index) => `<button class="stage-card ${stage.status === '等待人工决定' || stage.status === '未知' || stage.status === '需返工' ? 'attention' : ''}" data-stage="${stage.id}" aria-label="查看${escapeHtml(stage.name)}阶段"><span class="stage-order">第${index + 1}步 · ${escapeHtml(stage.status)}</span><strong>${escapeHtml(stage.name)}</strong><dl><div><dt>负责人</dt><dd>${escapeHtml(stage.owner)}</dd></div><div><dt>输入</dt><dd>${escapeHtml(stage.input)}</dd></div><div><dt>输出</dt><dd>${escapeHtml(stage.output)}</dd></div><div><dt>缺失</dt><dd>${escapeHtml(stage.missing)}</dd></div><div><dt>卡点</dt><dd>${escapeHtml(stage.blocker)}</dd></div><div><dt>下一步</dt><dd>${escapeHtml(stage.next)}</dd></div></dl><p>${escapeHtml(stage.time)} · ${escapeHtml(stage.receipt)}</p></button>`).join('');
  return `<section class="progress-view"><header><div><span class="eyebrow">非线性协同进度</span><h2>${escapeHtml(scene.work)}</h2></div><button type="button" class="cycle-card" data-cycle="true"><strong>场景循环与恢复路径</strong><span>${escapeHtml(scene.cycle)}</span></button></header><div class="progress-track">${cards}</div><section class="branch-row"><article><b>目标版本影响</b><span>${escapeHtml(scene.version)}；若发生目标漂移，受影响阶段需重新确认。</span></article><article><b>暂停与恢复</b><span>暂停、重试、回退和未知均保留历史，不覆盖此前状态。</span></article><article><b>当前允许下一步</b><span>${escapeHtml(scene.next)}</span></article></section></section>`;
}
function matrix() {
  const scene = state.scene; const head = scene.tasks.map((task) => `<th scope="col">${escapeHtml(task)}<small>异常与等待聚合</small></th>`).join('');
  const rows = scene.matrix.map((row) => `<tr><th scope="row"><strong>${escapeHtml(row.role)}</strong><small>${escapeHtml(row.summary)}</small></th>${row.cells.map((cell) => `<td><button class="matrix-cell ${cell.status === '异常' || cell.status === '未知' ? 'attention' : ''}" data-cell="${cell.id}" aria-label="查看${escapeHtml(row.role)}在${escapeHtml(cell.task)}的协同状态"><b>${escapeHtml(cell.responsibility)} · ${escapeHtml(cell.permission)}</b><span>${escapeHtml(cell.status)}</span><small>有效交互：${cell.interactions}次<br>最后交互：${escapeHtml(cell.last)}<br>待回应：${escapeHtml(cell.waiting)}<br>异常：${escapeHtml(cell.exception)}</small></button></td>`).join('')}</tr>`).join('');
  return `<section class="matrix-view"><header><div><span class="eyebrow">责任主体 × 场景任务</span><h2>${escapeHtml(scene.work)}</h2></div><p>行汇总显示责任空缺、过载、超时、异常与未知；单击单元格进入局部接续。</p></header><div class="matrix-scroll"><table><thead><tr><th scope="col">参与者与负载</th>${head}</tr></thead><tbody>${rows}</tbody></table></div><footer><span>责任空缺：一项</span><span>过载：一人</span><span>超时：一项</span><span>异常：两项</span><span>未知：一项</span></footer></section>`;
}
function selectedSummary() {
  if (!state.selection) return { title: '全部协同上下文', meta: `${state.scene.work} · ${state.scene.version}`, detail: state.scene.special, owner: state.scene.owner, blocker: state.scene.challenge, next: state.scene.next };
  const { kind, title, data } = state.selection;
  if (kind === '节点') return { title, meta: `${data.type} · ${state.scene.version}`, detail: data.detail, owner: state.scene.owner, blocker: data.risk ? state.scene.challenge : '当前无新增阻塞', next: data.risk ? state.scene.next : '查看相关证据与历史' };
  if (kind === '关系') return { title: `${title}关系`, meta: `${data.state} · ${state.scene.work}`, detail: `关系双方：${byId(data.from).label} 与 ${byId(data.to).label}。`, owner: state.scene.owner, blocker: data.state === '未知' ? state.scene.receipt : '无', next: data.state === '未知' ? '核验最近一次外部回执' : '查看关系依据' };
  if (kind === '阶段') return { title, meta: `${data.status} · ${state.scene.version}`, detail: `输入：${data.input}；输出：${data.output}；关联回执：${data.receipt}。`, owner: data.owner, blocker: data.blocker, next: data.next };
  if (kind === '单元格') return { title: `${data.row.role} × ${data.cell.task}`, meta: `${data.cell.status} · ${data.cell.responsibility}`, detail: `权限：${data.cell.permission}；有效交互：${data.cell.interactions}次；最后交互：${data.cell.last}。`, owner: data.row.role, blocker: data.cell.exception, next: data.cell.waiting === '无' ? '查看关联任务' : `等待${data.cell.waiting}回应` };
  return { title: '循环与恢复依据', meta: state.scene.version, detail: state.scene.cycle, owner: state.scene.owner, blocker: state.scene.challenge, next: state.scene.next };
}
function continuation() {
  const focus = selectedSummary(); const messages = [...state.scene.messages, ...state.messages].map((message) => `<article class="message ${message.sender === '分析助手' ? 'model-message' : ''}"><b>${escapeHtml(message.sender)}</b><span>${escapeHtml(message.time)}</span><p>${escapeHtml(message.text)}</p></article>`).join('');
  const modelText = state.model.status === '运行中' ? '正在基于当前选择生成候选；不会改变人工决定或外部动作。' : state.model.status === '已完成，候选产物待审' ? '候选产物已生成，仍需具名人员审阅。' : state.model.status === '运行失败' ? '运行失败，可在核对输入版本后重试。' : state.model.status === '状态待核验' ? '最后已知结果未确认，请核验运行状态。' : '普通消息不会触发模型；只有明确动作才可请求运行。';
  $('#focusTitle').textContent = focus.title; $('#focusMeta').textContent = focus.meta; $('#returnAll').hidden = !state.selection;
  $('#continuationBody').innerHTML = `<section class="side-section summary"><h3>当前接续</h3><p>${escapeHtml(focus.detail)}</p><dl><div><dt>负责人</dt><dd>${escapeHtml(focus.owner)}</dd></div><div><dt>当前阻塞</dt><dd>${escapeHtml(focus.blocker)}</dd></div><div><dt>等待对象</dt><dd>${escapeHtml(focus.blocker === '无' ? '无' : '具名责任人')}</dd></div><div><dt>到期</dt><dd>八月二十七日 十七时</dd></div></dl><div class="actions"><button type="button" class="primary" id="modelAction">${state.model.status === '运行中' ? '取消本次运行' : '生成候选'}</button><button type="button" id="evidenceAction">复核证据</button></div><p class="next-step"><b>下一步：</b>${escapeHtml(focus.next)}</p></section><section class="side-section"><h3>责任与权限</h3><p>当前责任：${escapeHtml(focus.owner)}。人类负责目标、关口与外部动作；智能体仅建议，不能改变责任、通过关口或把未知回执写成成功。</p></section><section class="side-section messages"><h3>最近对话</h3>${messages}</section><section class="side-section model-state ${state.model.status === '运行失败' || state.model.status === '状态待核验' ? 'open-risk' : ''}"><h3>模型运行</h3><p><b>${escapeHtml(state.model.status)}</b>　用时：${escapeHtml(state.model.elapsed)}</p><p>${modelText}</p>${state.model.artifact ? `<article class="artifact"><b>候选产物待审</b><p>${escapeHtml(state.model.artifact)}</p><button type="button" data-model="retry">重试</button></article>` : ''}</section><details class="side-section" open><summary>证据、回执与人工关口</summary><p>人工关口：${escapeHtml(state.scene.gate)}</p><p>执行回执：${escapeHtml(state.scene.receipt)}</p><p>异常：${escapeHtml(state.scene.challenge)}</p></details><details class="side-section"><summary>历史上下文</summary><p>${escapeHtml(state.scene.cycle)}</p></details>`;
  $('#modelAction').onclick = runModel; $('#evidenceAction').onclick = () => { state.model.status = '状态待核验'; state.model.elapsed = '待核验'; renderContinuationOnly(); }; document.querySelectorAll('[data-model="retry"]').forEach((button) => button.onclick = () => { state.model.status = '运行失败'; state.model.artifact = null; renderContinuationOnly(); });
}
function renderContinuationOnly() { continuation(); }
function runModel() {
  if (state.model.status === '运行中') { state.model.status = '已取消'; state.model.elapsed = '零点一秒'; renderContinuationOnly(); return; }
  state.model = { status: '运行中', artifact: null, elapsed: '计时中' }; renderContinuationOnly();
  window.setTimeout(() => { if (state.model.status !== '运行中') return; state.model = { status: '已完成，候选产物待审', artifact: `围绕“${state.selection?.title || state.scene.work}”的候选说明已生成；需由${state.scene.owner}审阅。`, elapsed: '零点七秒' }; state.messages.push({ sender:'分析助手', time:'刚刚', text:'已提交候选产物，未改变任何人工决定或外部动作。' }); renderContinuationOnly(); }, 700);
}
function bindGraph() {
  const viewport = $('#graphViewport'); const world = $('#graphWorld'); let dragging = null; let panStart = null;
  const apply = () => { world.style.transform = `translate(${state.graph.panX}px,${state.graph.panY}px) scale(${state.graph.zoom})`; $('#zoomText').textContent = `${Math.round(state.graph.zoom * 100)}％`; };
  document.querySelectorAll('[data-graph]').forEach((button) => button.onclick = () => { const action = button.dataset.graph; if (action === 'in') state.graph.zoom = Math.min(1.6, state.graph.zoom + 0.1); if (action === 'out') state.graph.zoom = Math.max(0.55, state.graph.zoom - 0.1); if (action === 'fit') { state.graph.zoom = 1; state.graph.panX = 0; state.graph.panY = 0; } if (action === 'focus') { state.graph.zoom = 1.18; state.graph.panX = -90; state.graph.panY = -40; } apply(); });
  viewport.onwheel = (event) => { event.preventDefault(); if (event.ctrlKey) state.graph.zoom = Math.max(0.55, Math.min(1.6, state.graph.zoom + (event.deltaY < 0 ? 0.08 : -0.08))); else state.graph.panY -= event.deltaY * 0.35; apply(); };
  viewport.onpointerdown = (event) => { const button = event.target.closest('[data-node]'); if (button) { dragging = { id: button.dataset.node, startX: event.clientX, startY: event.clientY, initial: graphNodePosition(byId(button.dataset.node)) }; button.setPointerCapture(event.pointerId); } else { panStart = { x:event.clientX, y:event.clientY, panX:state.graph.panX, panY:state.graph.panY }; viewport.setPointerCapture(event.pointerId); } };
  viewport.onpointermove = (event) => { if (dragging) { const rect = viewport.getBoundingClientRect(); const x = Math.max(4, Math.min(95, dragging.initial.x + ((event.clientX - dragging.startX) / rect.width) * 100 / state.graph.zoom)); const y = Math.max(8, Math.min(90, dragging.initial.y + ((event.clientY - dragging.startY) / rect.height) * 100 / state.graph.zoom)); state.graph.positions[dragging.id] = { x, y }; const item = document.querySelector(`[data-node="${dragging.id}"]`); item.style.left = `${x}%`; item.style.top = `${y}%`; renderGraphLines(); } else if (panStart) { state.graph.panX = panStart.panX + event.clientX - panStart.x; state.graph.panY = panStart.panY + event.clientY - panStart.y; apply(); } };
  viewport.onpointerup = () => { if (dragging) saveLayout(); dragging = null; panStart = null; };
  document.querySelectorAll('[data-node]').forEach((button) => button.onclick = (event) => { if (event.detail === 0 || !dragging) selection('节点', byId(button.dataset.node).label, byId(button.dataset.node)); });
  document.querySelectorAll('[data-edge]').forEach((button) => button.onclick = () => { const edge = state.scene.edges.find((item) => item.id === button.dataset.edge); selection('关系', edge.label, edge); });
}
function renderGraphLines() { const old = state.selection; const root = $('#viewRoot'); root.innerHTML = graph(); if (old) state.selection = old; bindGraph(); }
function render() {
  renderTop(); statusText(); $('#viewRoot').innerHTML = state.view === '关系' ? graph() : state.view === '进度' ? progress() : matrix();
  if (state.view === '关系') bindGraph();
  if (state.view === '进度') { document.querySelectorAll('[data-stage]').forEach((button) => button.onclick = () => { const stage = state.scene.stages.find((item) => item.id === button.dataset.stage); selection('阶段', stage.name, stage); }); document.querySelector('[data-cycle]')?.addEventListener('click', () => selection('循环', '循环与恢复依据', { cycle: state.scene.cycle })); }
  if (state.view === '矩阵') document.querySelectorAll('[data-cell]').forEach((button) => button.onclick = () => { for (const row of state.scene.matrix) { const cell = row.cells.find((item) => item.id === button.dataset.cell); if (cell) return selection('单元格', cell.task, { row, cell }); } });
  continuation();
}
async function init() {
  try {
    const config = await fetch('/api/v2/frontend-config', { cache:'no-store' }).then((response) => response.json());
    if (config.mode !== 'demo') throw new Error('当前为产品模式，但兼容的真实后端状态投影尚不可用。');
    state.projection = validateProjection(await fetch('/api/v2/projection', { cache:'no-store' }).then(async (response) => { if (!response.ok) throw new Error('演示状态服务不可用。'); return response.json(); }));
    state.scene = state.projection.scenarios[0]; state.view = state.scene.view; loadLayout(); $('#workspace').hidden = false; $('#failure').hidden = true; render();
  } catch (error) { fail(error.message || '无法读取状态投影。'); }
}
$('#scenarioSelect').onchange = (event) => { state.scene = state.projection.scenarios.find((scene) => scene.id === event.target.value); state.view = state.scene.view; state.selection = null; state.messages = []; state.model = { status:'尚未请求', artifact:null, elapsed:'—' }; state.graph = { zoom:1, panX:0, panY:0, positions:{} }; loadLayout(); render(); };
document.querySelectorAll('[data-view]').forEach((button) => button.onclick = () => { state.view = button.dataset.view; render(); });
$('#returnAll').onclick = () => { state.selection = null; render(); };
$('#composer').onsubmit = (event) => { event.preventDefault(); const input = $('#messageInput'); const text = input.value.trim(); if (!text) return; state.messages.push({ sender:'当前用户', time:'刚刚', text }); input.value = ''; renderContinuationOnly(); };
$('#refreshButton').onclick = init;
void init();
