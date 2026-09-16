(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  const settings = {
    profile: 'balanced',
    parallel: true,
    retry: true,
    human: true,
    issue: false
  };

  const agents = {
    dispatcher: {
      icon: '⌘', name: '调度 Agent',
      role: '理解人的目标，把任务拆成有依赖关系的执行顺序，并管理异常路由。',
      input: '任务目标、项目上下文、当前策略',
      output: '执行图与交接顺序',
      owner: '产品 / IT',
      boundary: '可以调度 Agent，不能替人作业务决定'
    },
    material: {
      icon: '▤', name: '材料 Agent',
      role: '解析、分类和去重材料，并为每个结果保留原始位置。',
      input: '18 份项目材料',
      output: '带来源的材料事实',
      owner: '运营',
      boundary: '只读取本项目授权材料'
    },
    customer: {
      icon: '◎', name: '客户 Agent',
      role: '核对客户授权、主体信息和可复用的历史项目上下文。',
      input: '客户授权与主体标识',
      output: '客户上下文',
      owner: '业务',
      boundary: '只能读取授权范围内的客户字段'
    },
    evidence: {
      icon: '◇', name: '证据 Agent',
      role: '把各方结果汇合成统一事实，识别不同材料之间的矛盾。',
      input: '材料事实与客户上下文',
      output: '事实、证据与冲突清单',
      owner: '信审',
      boundary: '不能静默覆盖冲突值'
    },
    policy: {
      icon: '§', name: '政策 Agent',
      role: '定位当前有效规则，说明适用范围、版本和例外条件。',
      input: '统一事实与证据',
      output: '规则命中与例外说明',
      owner: '政策',
      boundary: '只解释规则，不替代有权人审批'
    },
    risk: {
      icon: '△', name: '风控 Agent',
      role: '组合风险信号并给出有依据的条件建议。',
      input: '统一事实与证据',
      output: '风险信号与条件建议',
      owner: '风控',
      boundary: '不能自动作出正式审批决定'
    },
    human: {
      icon: '人', name: '有权人闸门',
      role: '处理证据冲突、政策例外和低置信度事项，并承担正式责任。',
      input: '事实、原始证据、规则与风险建议',
      output: '人工决定与判断依据',
      owner: '有权审批人',
      boundary: '正式决定必须实名留痕'
    },
    contract: {
      icon: '▣', name: '合同 Agent',
      role: '把已确认的审批条件映射到合同草稿与待办。',
      input: '人工决定与条件清单',
      output: '合同草稿',
      owner: '商务',
      boundary: '可以生成草稿，不能正式签署'
    },
    operations: {
      icon: '↻', name: '运营 Agent',
      role: '创建查勘、验收和资产交接任务，并把真实结果回流。',
      input: '人工决定与设备证据',
      output: '执行任务与结果记录',
      owner: '运营 / 资产',
      boundary: '可以编排任务，不能替代人工验收'
    }
  };

  const agentOutputs = {
    dispatcher: '生成 6 个阶段、2 组并行和 1 个人工闸门',
    material: '解析 18 份材料，形成 23 项带来源事实',
    customer: '授权有效，补充 2 个历史项目上下文',
    evidence: '统一 26 项事实，发现 1 项跨材料矛盾',
    policy: '命中 8 条规则，1 条需要例外说明',
    risk: '形成 4 项风险信号与 3 条条件建议',
    human: '确认冲突事实并留下人工判断依据',
    contract: '生成合同草稿和 4 项条件待办',
    operations: '创建查勘、验收与资产交接任务'
  };

  const foundationByAgent = {
    dispatcher: 'memory',
    material: 'business',
    customer: 'business',
    evidence: 'evidence',
    policy: 'rules',
    risk: 'evidence',
    human: 'memory',
    contract: 'skills',
    operations: 'memory'
  };

  const run = {
    generation: 0,
    running: false,
    waitingForHuman: false,
    humanResolve: null,
    completed: 0
  };

  function showScreen(name) {
    const settingsOpen = name === 'settings';
    $('#homeScreen').classList.toggle('is-active', !settingsOpen);
    $('#settingsScreen').classList.toggle('is-active', settingsOpen);
    history.replaceState(null, '', settingsOpen ? '#settings' : '#home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  $('.brand').addEventListener('click', (event) => {
    event.preventDefault();
    showScreen('home');
  });
  $('#openSettings').addEventListener('click', () => {
    if (run.running) {
      showToast('协作正在运行，完成后再调整设置。');
      return;
    }
    showScreen('settings');
  });
  $('#closeSettings').addEventListener('click', () => showScreen('home'));

  function bindSettings() {
    $('#routingProfile').value = settings.profile;
    $('#parallelToggle').checked = settings.parallel;
    $('#retryToggle').checked = settings.retry;
    $('#humanToggle').checked = settings.human;
    $('#issueToggle').checked = settings.issue;

    $('#routingProfile').addEventListener('change', (event) => {
      settings.profile = event.target.value;
      if (settings.profile === 'strict') settings.parallel = false;
      if (settings.profile === 'fast' || settings.profile === 'balanced') settings.parallel = true;
      $('#parallelToggle').checked = settings.parallel;
    });
    $('#parallelToggle').addEventListener('change', (event) => { settings.parallel = event.target.checked; });
    $('#retryToggle').addEventListener('change', (event) => { settings.retry = event.target.checked; });
    $('#humanToggle').addEventListener('change', (event) => { settings.human = event.target.checked; });
    $('#issueToggle').addEventListener('change', (event) => { settings.issue = event.target.checked; });
  }

  function openAgentDialog(id) {
    const agent = agents[id];
    if (!agent) return;
    $('#dialogIcon').textContent = agent.icon;
    $('#dialogTitle').textContent = agent.name;
    $('#dialogRole').textContent = agent.role;
    $('#dialogInput').textContent = agent.input;
    $('#dialogOutput').textContent = agent.output;
    $('#dialogOwner').textContent = agent.owner;
    $('#dialogBoundary').textContent = agent.boundary;
    $('#agentDialog').hidden = false;
    $('.dialog-close').focus();
  }

  function closeAgentDialog() {
    $('#agentDialog').hidden = true;
  }

  $$('[data-agent]').forEach((button) => button.addEventListener('click', () => openAgentDialog(button.dataset.agent)));
  $$('[data-dialog-close]').forEach((button) => button.addEventListener('click', closeAgentDialog));
  $('#agentDialog').addEventListener('click', (event) => {
    if (event.target === $('#agentDialog')) closeAgentDialog();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAgentDialog();
  });

  function showToast(text) {
    const toast = $('#toast');
    toast.textContent = text;
    toast.hidden = false;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => { toast.hidden = true; }, 3200);
  }

  function addLog(agentId, text, tone = '') {
    const list = $('#logList');
    const empty = $('.log-empty', list);
    if (empty) empty.remove();
    const item = document.createElement('li');
    item.className = tone;
    item.innerHTML = '<strong>' + (agents[agentId]?.name || '系统') + '</strong>：' + text;
    list.append(item);
    $('#logCount').textContent = String($$('li', list).length);
  }

  function clearLogs() {
    $('#logList').innerHTML = '<li class="log-empty">开始演示后，这里会记录关键交接。</li>';
    $('#logCount').textContent = '0';
    $('#runLog').open = false;
  }

  function setRunState(state, text) {
    const container = $('.run-state');
    container.className = 'run-state' + (state ? ' is-' + state : '');
    $('#runStateText').textContent = text;
  }

  function setAgentState(id, state) {
    const element = $('.agent[data-agent="' + id + '"]');
    if (!element) return;
    element.classList.remove('is-running', 'is-done', 'is-error', 'is-bypassed');
    if (state !== 'waiting') element.classList.add('is-' + state);
    const stateText = $('[data-agent-state]', element);
    stateText.textContent = state === 'running' ? '运行中' : state === 'done' ? '完成' : state === 'error' ? '异常' : state === 'bypassed' ? '跳过' : '等待';
    const stage = element.closest('.flow-stage');
    if (stage) {
      const agentsInStage = $$('.agent', stage);
      stage.classList.toggle('is-active', agentsInStage.some((agent) => agent.classList.contains('is-running')));
      stage.classList.toggle('is-done', agentsInStage.every((agent) => agent.classList.contains('is-done') || agent.classList.contains('is-bypassed')));
    }
  }

  function highlightFoundation(id) {
    $$('.foundation-grid button').forEach((button) => button.classList.toggle('is-active', button.dataset.foundation === foundationByAgent[id]));
  }

  function resetRun() {
    run.generation += 1;
    run.running = false;
    run.waitingForHuman = false;
    if (run.humanResolve) run.humanResolve();
    run.humanResolve = null;
    run.completed = 0;
    $$('.agent').forEach((element) => setAgentState(element.dataset.agent, 'waiting'));
    $$('.flow-stage').forEach((stage) => stage.classList.remove('is-active', 'is-done'));
    $$('.foundation-grid button').forEach((button) => button.classList.remove('is-active'));
    $('#completedCount').textContent = '0';
    $('#resultCard').classList.remove('is-ready');
    $('#resultStatus').textContent = '等待协作完成';
    $('#startRun').disabled = false;
    $('#startRun').innerHTML = '<span>▶</span> 开始演示';
    setRunState('', '系统已就绪');
    clearLogs();
  }

  async function executeAgent(id, generation, duration = 650) {
    if (generation !== run.generation) throw new Error('cancelled');
    setAgentState(id, 'running');
    highlightFoundation(id);
    addLog(id, '接收：' + agents[id].input);
    await wait(duration);
    if (generation !== run.generation) throw new Error('cancelled');

    if (id === 'evidence' && settings.issue) {
      setAgentState(id, 'error');
      addLog(id, '报价单与发票出现两个不同金额，不能静默覆盖。', 'warn');
      if (!settings.retry) throw new Error('证据冲突需要人工检查，自动重试已关闭');
      addLog('dispatcher', '保留两个值并重试一次，随后转人工确认。', 'warn');
      await wait(650);
      setAgentState(id, 'running');
    }

    setAgentState(id, 'done');
    addLog(id, agentOutputs[id], 'success');
    if (id !== 'human') {
      run.completed += 1;
      $('#completedCount').textContent = String(run.completed);
    }
  }

  async function executeGroup(ids, generation) {
    if (settings.parallel) {
      await Promise.all(ids.map((id, index) => executeAgent(id, generation, 650 + index * 100)));
    } else {
      for (const id of ids) await executeAgent(id, generation, 560);
    }
  }

  async function humanGate(generation) {
    if (!settings.human) {
      setAgentState('human', 'bypassed');
      addLog('human', '演示设置已跳过人工确认；生产环境不允许关闭最终责任。', 'warn');
      return;
    }

    setAgentState('human', 'running');
    highlightFoundation('human');
    addLog('human', '发现例外事项，流程已暂停，等待有权人确认。', 'warn');
    setRunState('paused', '等待人工确认');
    run.waitingForHuman = true;
    $('#startRun').disabled = false;
    $('#startRun').innerHTML = '<span>✓</span> 人工确认并继续';

    await new Promise((resolve) => { run.humanResolve = resolve; });
    if (generation !== run.generation) throw new Error('cancelled');
    run.waitingForHuman = false;
    run.humanResolve = null;
    setAgentState('human', 'done');
    addLog('human', agentOutputs.human, 'success');
    setRunState('running', '继续执行');
    $('#startRun').disabled = true;
    $('#startRun').innerHTML = '<span>●</span> 协作进行中';
  }

  async function startWorkflow() {
    if (run.running) return;
    resetRun();
    run.running = true;
    const generation = run.generation;
    setRunState('running', '协作进行中');
    $('#startRun').disabled = true;
    $('#startRun').innerHTML = '<span>●</span> 协作进行中';

    try {
      addLog('dispatcher', '按“' + $('#routingProfile').selectedOptions[0].textContent + '”启动协作。');
      await executeAgent('dispatcher', generation, 620);
      await executeGroup(['material', 'customer'], generation);
      await executeAgent('evidence', generation, 730);
      await executeGroup(['policy', 'risk'], generation);
      await humanGate(generation);
      await executeGroup(['contract', 'operations'], generation);

      run.running = false;
      setRunState('done', '协作已完成');
      $('#resultCard').classList.add('is-ready');
      $('#resultStatus').textContent = '已形成';
      $('#startRun').disabled = false;
      $('#startRun').innerHTML = '<span>↻</span> 再次演示';
      addLog('dispatcher', '所有 Agent 已完成交接，人工决定与最终产物已留痕。', 'success');
      showToast('协作完成：8 个 Agent 已交付，可决策项目包已形成。');
    } catch (error) {
      if (error.message === 'cancelled') return;
      run.running = false;
      setRunState('paused', '协作已暂停');
      $('#startRun').disabled = false;
      $('#startRun').innerHTML = '<span>↻</span> 重新演示';
      addLog('dispatcher', error.message, 'warn');
      $('#runLog').open = true;
      showToast(error.message);
    }
  }

  $('#startRun').addEventListener('click', () => {
    if (run.waitingForHuman && run.humanResolve) {
      const resolve = run.humanResolve;
      run.humanResolve = null;
      resolve();
      return;
    }
    startWorkflow();
  });

  $$('.foundation-grid button').forEach((button) => button.addEventListener('click', () => {
    const text = $('span', button).textContent;
    showToast(text + '：这是多个 Agent 共同读写、持续积累的底层能力。');
  }));

  function showStatePreview(mode) {
    $('#stateOverlay').hidden = false;
    $$('.state-card', $('#stateOverlay')).forEach((card) => { card.hidden = card.dataset.state !== mode; });
    if (mode === 'loading') {
      window.setTimeout(() => showStatePreview('success'), 1100);
    }
  }

  $('#showState').addEventListener('click', () => showStatePreview($('#previewState').value));
  $$('[data-state-close]').forEach((button) => button.addEventListener('click', () => { $('#stateOverlay').hidden = true; }));

  bindSettings();
  resetRun();
  if (location.hash === '#settings') showScreen('settings');
  else showScreen('home');
})();
