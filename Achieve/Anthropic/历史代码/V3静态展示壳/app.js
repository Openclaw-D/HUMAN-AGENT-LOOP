const state = {
  projection: null,
  activeStageId: "policy",
  activeSlotId: null,
};

const stageButtons = Array.from(document.querySelectorAll(".stage-button[data-stage]"));
const stageSlotsRoot = document.querySelector("#stage-slots");
const workspaceStatus = document.querySelector("#workspace-status");

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

function getActiveStage() {
  return state.projection?.stages.find((stage) => stage.id === state.activeStageId) ?? null;
}

function setSlotState(title, message, tone = "loading") {
  const toneClass = tone === "error" ? " is-error" : "";
  stageSlotsRoot.replaceChildren();
  stageSlotsRoot.insertAdjacentHTML("beforeend", `
    <article class="state-card${toneClass}">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
    </article>
  `);
}

function renderStageNavigation() {
  for (const button of stageButtons) {
    const stageId = button.dataset.stage;
    const stage = state.projection?.stages.find((item) => item.id === stageId);
    const isActive = stageId === state.activeStageId;
    button.replaceChildren();
    button.setAttribute("aria-current", isActive ? "true" : "false");
    if (!stage) {
      button.disabled = true;
      continue;
    }

    button.disabled = false;
    button.insertAdjacentHTML("beforeend", `
      <span class="stage-name">${escapeHtml(stage.label)}</span>
      <span class="stage-meta">5 个流程位置</span>
    `);
  }
}

function statusClass(status) {
  if (status === "已完成") return "status-completed";
  if (status === "进行中") return "status-processing";
  if (status === "需关注") return "status-attention";
  return "status-pending";
}

function renderStageSlots() {
  const stage = getActiveStage();
  if (!stage) {
    setSlotState("暂无流程位置", "请选择有效的板块。", "error");
    return;
  }

  state.activeSlotId = stage.slots[0]?.id ?? null;
  stageSlotsRoot.replaceChildren();
  for (const slot of stage.slots) {
    const exceptionText = slot.exception ?? "无";
    const card = document.createElement("article");
    card.className = `slot-card${slot.id === state.activeSlotId ? " is-current" : ""}`;
    card.insertAdjacentHTML("beforeend", `
      <h3>${escapeHtml(slot.label)}</h3>
      <p class="slot-summary">${escapeHtml(slot.summary)}</p>
      <dl class="slot-fields">
        <div><dt>状态</dt><dd class="${statusClass(slot.status)}">${escapeHtml(slot.status)}</dd></div>
        <div><dt>负责人</dt><dd>${escapeHtml(slot.owner)}</dd></div>
        <div><dt>Agent</dt><dd>${escapeHtml(slot.agent)}</dd></div>
        <div><dt>证据</dt><dd>${escapeHtml(slot.evidenceCount)} 项</dd></div>
        <div><dt>更新</dt><dd>${escapeHtml(slot.updatedAt)}</dd></div>
        <div><dt>异常</dt><dd>${escapeHtml(exceptionText)}</dd></div>
        <div><dt>回执</dt><dd>${escapeHtml(slot.receipt)}</dd></div>
      </dl>
    `);
    stageSlotsRoot.append(card);
  }
}

function renderWorkspace() {
  const stage = getActiveStage();
  if (!stage) {
    workspaceStatus.textContent = "暂无可展示的板块。";
    return;
  }

  workspaceStatus.textContent = `${stage.label}板块已展示 5 个流程位置。`;
}

function renderCurrentStage() {
  renderStageNavigation();
  renderStageSlots();
  renderWorkspace();
}

function activateStage(stageId) {
  if (!state.projection?.stages.some((stage) => stage.id === stageId)) return;
  state.activeStageId = stageId;
  renderCurrentStage();
}

function bindStageNavigation() {
  for (const button of stageButtons) {
    button.addEventListener("click", () => activateStage(button.dataset.stage));
  }
}

async function initialize() {
  bindStageNavigation();
  setSlotState("加载中", "正在准备流程位置。");

  try {
    const module = await import("./projection.mjs");
    state.projection = module.financingLeasingProjection;
    if (!state.projection?.stages?.length) {
      setSlotState("暂无数据", "当前没有可展示的流程位置。", "error");
      workspaceStatus.textContent = "暂无可展示数据。";
      return;
    }

    renderCurrentStage();
  } catch {
    setSlotState("加载失败", "流程位置暂不可用，请稍后重试。", "error");
    workspaceStatus.textContent = "数据暂不可用。";
  }
}

initialize();
