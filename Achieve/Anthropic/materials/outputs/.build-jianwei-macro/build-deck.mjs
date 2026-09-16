import fs from "node:fs/promises";
import {
  Presentation,
  PresentationFile,
  layers,
  shape,
  text,
} from "@oai/artifact-tool";

const FINAL_PPTX = "C:\\Users\\22673\\Desktop\\Anthropic\\outputs\\见微宏观体系与分期工程-内部讨论稿.pptx";
const BUILD_DIR = "C:\\Users\\22673\\Desktop\\Anthropic\\outputs\\.build-jianwei-macro";
const W = 1280;
const H = 720;
const FONT = "Microsoft YaHei";

const C = {
  bg: "#F4F2ED",
  paper: "#FBFAF7",
  ink: "#17232C",
  muted: "#5D6870",
  faint: "#89939A",
  line: "#CDD3D5",
  blue: "#4E7185",
  blueDark: "#2F5367",
  blueLight: "#DDE7EB",
  amber: "#A98043",
  amberLight: "#EEE3D1",
  green: "#587364",
  greenLight: "#DFE8E2",
  red: "#865E5A",
  redLight: "#EADFDB",
  grayLight: "#E7E8E5",
  grayMid: "#B9C0C2",
  white: "#FFFFFF",
};

let nodeSeq = 0;
const n = (prefix) => `${prefix}-${++nodeSeq}`;

function tx(content, x, y, width, height, fontSize, color = C.ink, options = {}) {
  return text([content], {
    name: options.name || n("text"),
    position: { left: x, top: y },
    width,
    height,
    style: {
      fontSize: `${fontSize}px`,
      typeface: FONT,
      color,
      bold: Boolean(options.bold),
      alignment: options.align || "left",
      verticalAlignment: options.valign || "top",
      autoFit: options.autoFit || "none",
      wrap: "square",
      insets: options.insets || { top: 0, right: 0, bottom: 0, left: 0 },
    },
  });
}

function rect(x, y, width, height, fill, options = {}) {
  return shape({
    name: options.name || n("shape"),
    geometry: options.geometry || "rect",
    fill,
    line: options.line || { style: "solid", width: 0, fill: fill },
    position: { left: x, top: y },
    width,
    height,
  });
}

function roundRect(x, y, width, height, fill, options = {}) {
  return rect(x, y, width, height, fill, {
    ...options,
    geometry: "roundRect",
    line: options.line || { style: "solid", width: 1, fill: options.stroke || C.line },
  });
}

function ellipse(x, y, width, height, fill, options = {}) {
  return rect(x, y, width, height, fill, {
    ...options,
    geometry: "ellipse",
    line: options.line || { style: "solid", width: 1, fill: options.stroke || C.line },
  });
}

function arrow(x, y, width, height, fill = C.blue, direction = "rightArrow") {
  return rect(x, y, width, height, fill, {
    geometry: direction,
    line: { style: "solid", width: 0, fill },
  });
}

function line(x, y, width, height = 2, fill = C.line) {
  return rect(x, y, width, height, fill);
}

function label(textValue, x, y, width, tone = "blue") {
  const fill = tone === "amber" ? C.amberLight : tone === "gray" ? C.grayLight : C.blueLight;
  const color = tone === "amber" ? C.amber : tone === "gray" ? C.muted : C.blueDark;
  return [
    roundRect(x, y, width, 30, fill, { stroke: fill }),
    tx(textValue, x, y + 2, width, 26, 17, color, { bold: true, align: "center", valign: "middle" }),
  ];
}

function boxWithText(title, body, x, y, width, height, options = {}) {
  const nodes = [
    roundRect(x, y, width, height, options.fill || C.paper, {
      stroke: options.stroke || C.line,
      line: { style: "solid", width: options.lineWidth || 1, fill: options.stroke || C.line },
    }),
    tx(title, x + 22, y + 20, width - 44, options.titleHeight || 36, options.titleSize || 28, options.titleColor || C.ink, { bold: true }),
  ];
  if (body) {
    nodes.push(tx(body, x + 22, y + (options.bodyTop || 64), width - 44, height - (options.bodyTop || 64) - 18, options.bodySize || 20, options.bodyColor || C.muted, { valign: "top" }));
  }
  return nodes;
}

function slideBase(presentation, slideNum, kicker, title, notes, options = {}) {
  const slide = presentation.slides.add();
  slide.background.fill = options.dark ? C.ink : C.bg;
  const titleColor = options.dark ? C.white : C.ink;
  const kickerColor = options.dark ? C.blueLight : C.blueDark;
  const footerColor = options.dark ? C.grayMid : C.faint;
  const nodes = [
    tx(kicker, 64, 24, 760, 24, 17, kickerColor, { bold: true }),
    tx(title, 64, 52, 1152, 58, 48, titleColor, { bold: true }),
    line(64, 118, 1152, 2, options.dark ? "#40515A" : C.line),
    tx("见微宏观体系与分期工程｜内部讨论稿", 64, 674, 600, 20, 15, footerColor),
    tx(String(slideNum).padStart(2, "0"), 1160, 674, 56, 20, 15, footerColor, { align: "right" }),
  ];
  slide.speakerNotes.textFrame.setText(notes);
  slide.speakerNotes.setVisible(true);
  return { slide, nodes };
}

function notes(talk, sources = "both") {
  const entries = ["[Sources]"];
  entries.push("- Internal: Authority reset task package from V3-Refresh-Control, 2026-08-31.");
  if (sources === "both") {
    entries.push("- Internal: C:\\Users\\22673\\.codex\\visualizations\\2026\\08\\30\\01a052dc-9164-7a42-b08f-7d700dea6bf6\\jianwei-macro-atlas.html, 2026-08-31.");
  }
  entries.push("[/Sources]");
  return `${talk}\n\n${entries.join("\n")}`;
}

function compose(slide, slideNum, nodes) {
  slide.compose(layers({ name: `jianwei-macro-slide-${String(slideNum).padStart(2, "0")}`, width: "fill", height: "fill" }, nodes));
}

function buildSlide01(presentation) {
  const slide = presentation.slides.add();
  slide.background.fill = C.ink;
  const nodes = [
    tx("内部讨论稿 · 2026.08.31", 72, 62, 420, 28, 19, C.blueLight, { bold: true }),
    tx("见微宏观体系\n与分期工程", 72, 164, 760, 184, 76, C.white, { bold: true }),
    tx("先建立共同认知，再决定如何研究、分期与落地", 76, 382, 720, 44, 27, "#CFD7DA"),
    line(76, 456, 310, 4, C.amber),
    tx("当前产品战略与工程路径讨论稿", 76, 484, 520, 32, 20, C.grayMid),
    line(958, 128, 2, 418, "#40515A"),
    ellipse(905, 150, 108, 108, C.blue, { stroke: C.blue }),
    tx("CASE", 905, 184, 108, 34, 22, C.white, { bold: true, align: "center", valign: "middle" }),
    tx("人和组织", 1028, 166, 170, 28, 21, C.white, { bold: true }),
    tx("企业能力资产", 1028, 220, 180, 28, 21, C.white, { bold: true }),
    tx("连接与治理", 1028, 274, 170, 28, 21, C.white, { bold: true }),
    line(958, 314, 210, 2, "#40515A"),
    tx("作业", 905, 350, 110, 30, 24, C.blueLight, { bold: true, align: "center" }),
    tx("管理", 905, 418, 110, 30, 24, C.blueLight, { bold: true, align: "center" }),
    tx("演进", 905, 486, 110, 30, 24, C.amberLight, { bold: true, align: "center" }),
    tx("01", 1160, 674, 56, 20, 15, C.grayMid, { align: "right" }),
  ];
  slide.speakerNotes.textFrame.setText(notes("开场只说明用途：这不是最终比赛 PPT，也不是功能宣讲，而是一次跨职能共同建模。今天要先回答见微到底是什么，以及从哪里开始最有学习价值。"));
  slide.speakerNotes.setVisible(true);
  compose(slide, 1, nodes);
}

function buildSlide02(presentation) {
  const { slide, nodes } = slideBase(presentation, 2, "01｜AUTHORITY RESET", "我们缺的不是更多页面，而是同一个抽象层", notes("强调这次重置的原因：过去把产品本体、页面入口、历史版本和比赛叙事放在一起讨论，导致词语相同、含义不同。旧内容保留，但不再自动支配当前方向。"));
  nodes.push(
    tx("过去混在一起", 72, 152, 270, 34, 24, C.red, { bold: true }),
    ...boxWithText("产品本体", "企业真正要建设的能力", 72, 198, 238, 84, { fill: C.redLight, stroke: C.redLight, titleSize: 22, titleHeight: 26, bodyTop: 50, bodySize: 16 }),
    ...boxWithText("页面入口", "用户从哪里进入", 72, 302, 238, 84, { fill: C.grayLight, stroke: C.grayLight, titleSize: 22, titleHeight: 26, bodyTop: 50, bodySize: 16 }),
    ...boxWithText("历史版本", "V2 / 旧 V3 / 候选结构", 72, 406, 238, 84, { fill: C.grayLight, stroke: C.grayLight, titleSize: 22, titleHeight: 26, bodyTop: 50, bodySize: 16 }),
    ...boxWithText("比赛叙事", "如何在十分钟内表达", 72, 510, 238, 84, { fill: C.grayLight, stroke: C.grayLight, titleSize: 22, titleHeight: 26, bodyTop: 50, bodySize: 16 }),
    arrow(570, 286, 86, 54, C.blue),
    tx("重新建立当前 authority", 720, 152, 420, 34, 24, C.blueDark, { bold: true }),
    tx("01", 720, 216, 52, 52, 38, C.blue, { bold: true }),
    tx("先定义企业能力与权威边界", 792, 222, 372, 36, 25, C.ink, { bold: true }),
    tx("02", 720, 298, 52, 52, 38, C.blue, { bold: true }),
    tx("再选择最小可观察试验", 792, 304, 372, 36, 25, C.ink, { bold: true }),
    tx("03", 720, 380, 52, 52, 38, C.amber, { bold: true }),
    tx("旧方案只作为 Historical Reference", 792, 386, 390, 36, 25, C.ink, { bold: true }),
    roundRect(720, 486, 450, 88, C.paper, { stroke: C.line }),
    tx("重置不是推倒重来，而是停止让历史冻结当前思考。", 746, 510, 398, 48, 24, C.muted, { bold: true })
  );
  compose(slide, 2, nodes);
}

function buildSlide03(presentation) {
  const { slide, nodes } = slideBase(presentation, 3, "02｜PRODUCT NORTH STAR", "见微是一套企业人机协同运行体系", notes("先读候选定义，再用右侧三个“不是”限定边界。重点是见微连接人、组织与能力资产，但不替代专业权威，也不重做核心系统。"));
  nodes.push(
    line(126, 180, 6, 248, C.blueLight),
    tx("以真实业务事项为中心，把业务与专业人员、管理人员、系统部门、智能部门、既有系统和智能能力连接起来，使企业能够持续作业、管理和演进。", 160, 176, 670, 250, 36, C.ink, { bold: true }),
    line(130, 466, 650, 4, C.blue),
    tx("共同锚点：真实业务事项 / Case", 130, 492, 650, 40, 25, C.blueDark, { bold: true }),
    tx("它不是什么", 908, 160, 260, 34, 24, C.red, { bold: true }),
    ...boxWithText("不是新的核心业务系统", "保留既有系统的事实与正式记录", 884, 208, 320, 104, { fill: C.paper, stroke: C.line, titleSize: 23, bodySize: 18, bodyTop: 58 }),
    ...boxWithText("不是 AI 自动审批", "模型与 Agent 永远 authority=none", 884, 330, 320, 104, { fill: C.paper, stroke: C.line, titleSize: 23, bodySize: 18, bodyTop: 58 }),
    ...boxWithText("不是固定页面集合", "入口和 Projection 服务于 Case，不定义产品本体", 884, 452, 320, 104, { fill: C.paper, stroke: C.line, titleSize: 23, bodySize: 18, bodyTop: 58 }),
    tx("候选定义｜待跨职能共同校准", 884, 586, 320, 28, 17, C.amber, { bold: true, align: "right" })
  );
  compose(slide, 3, nodes);
}

function buildSlide04(presentation) {
  const { slide, nodes } = slideBase(presentation, 4, "03｜OVERALL SYSTEM", "所有参与者与能力，围绕同一个 Case 工作", notes("按顺序讲：左侧是人和组织，右侧是企业能力资产，中间只有一个真实 Case。见微位于下方，负责连接与治理；上方经营目标用于约束方向。系统部门和既有系统、智能部门和 Agent 必须明确区分。"));
  nodes.push(
    roundRect(280, 142, 720, 46, C.ink, { stroke: C.ink }),
    tx("经营目标：增长 · 风险 · 效率 · 合规 · 持续演进", 300, 151, 680, 28, 20, C.white, { bold: true, align: "center", valign: "middle" }),
    line(372, 294, 536, 2, C.grayMid),
    line(640, 188, 2, 354, C.grayMid),
    tx("人和组织", 72, 220, 250, 34, 25, C.blueDark, { bold: true }),
    ...boxWithText("经营与专业", "商机、业务、政策、信审、\n商务、资产、管理者、\n外部参与者", 72, 264, 276, 140, { fill: C.paper, titleSize: 25, bodySize: 17, bodyTop: 58 }),
    ...boxWithText("建设与维护", "系统部门负责 IT；\n智能部门负责模型、\nAgent 与 Harness", 72, 424, 276, 140, { fill: C.paper, titleSize: 25, bodySize: 17, bodyTop: 58 }),
    tx("真实业务事项", 442, 238, 396, 34, 25, C.blueDark, { bold: true, align: "center" }),
    ellipse(502, 286, 276, 160, C.blue, { stroke: C.blue }),
    tx("CASE", 502, 324, 276, 48, 42, C.white, { bold: true, align: "center", valign: "middle" }),
    tx("同一事实 · 同一责任 · 同一接续", 502, 382, 276, 28, 18, C.blueLight, { align: "center" }),
    tx("企业能力资产", 932, 220, 280, 34, 25, C.blueDark, { bold: true }),
    ...boxWithText("系统能力", "既有系统、数据、规则、\n权限、API、Adapter", 932, 264, 276, 140, { fill: C.paper, titleSize: 25, bodySize: 17, bodyTop: 58 }),
    ...boxWithText("智能能力", "模型、Agent、知识、\nHarness、Evaluation、\n监控与降级", 932, 424, 276, 140, { fill: C.paper, titleSize: 25, bodySize: 17, bodyTop: 58 }),
    roundRect(354, 512, 572, 100, C.blueLight, { stroke: C.blue }),
    tx("见微连接与治理层", 382, 528, 516, 32, 26, C.blueDark, { bold: true, align: "center" }),
    tx("Context · Evidence · 协同 · Gate · Receipt · Version · Audit", 382, 570, 516, 24, 18, C.blueDark, { align: "center" })
  );
  compose(slide, 4, nodes);
}

function buildSlide05(presentation) {
  const { slide, nodes } = slideBase(presentation, 5, "04｜MINIMUM COMPLETE MECHANISM", "三个循环分工不同，但共享同一业务事实", notes("三个循环不是三个系统。作业循环产生正式工作和信号；管理循环解释偏差和经营影响；演进循环改变规则、系统或智能能力。它们通过同一 Case 的 Evidence、状态、Receipt 与版本记录连接。"));
  const cols = [72, 462, 852];
  const colors = [C.blue, C.green, C.amber];
  const fills = [C.blueLight, C.greenLight, C.amberLight];
  const titles = ["作业循环", "管理循环", "演进循环"];
  const subtitles = ["把事情做完", "知道哪里失速", "让下一笔更好"];
  const bodies = [
    "员工围绕 Case 接收 Evidence、形成判断、完成 Human Gate 与正式动作。",
    "管理者观察状态、偏差、责任、等待、返工与经营影响，并发起协调。",
    "领域 + 系统 + 智能共同研究、验证、发布、观测和纠偏。",
  ];
  for (let i = 0; i < 3; i++) {
    nodes.push(
      tx(`0${i + 1}`, cols[i], 156, 70, 52, 42, colors[i], { bold: true }),
      tx(titles[i], cols[i] + 84, 160, 240, 40, 30, C.ink, { bold: true }),
      roundRect(cols[i], 224, 332, 276, fills[i], { stroke: colors[i], line: { style: "solid", width: 1, fill: colors[i] } }),
      tx(subtitles[i], cols[i] + 26, 254, 280, 38, 26, colors[i], { bold: true }),
      line(cols[i] + 26, 310, 280, 2, colors[i]),
      tx(bodies[i], cols[i] + 26, 338, 280, 128, 22, C.ink)
    );
  }
  nodes.push(
    arrow(414, 333, 38, 28, C.grayMid),
    arrow(804, 333, 38, 28, C.grayMid),
    roundRect(206, 546, 868, 62, C.paper, { stroke: C.line }),
    tx("共同底座：同一 Case Context + 可追溯 Evidence / Gate / Receipt / Version", 234, 562, 812, 34, 23, C.blueDark, { bold: true, align: "center", valign: "middle" })
  );
  compose(slide, 5, nodes);
}

function buildSlide06(presentation) {
  const { slide, nodes } = slideBase(presentation, 6, "05｜HOW WE LEARN", "稳定方向与最小实现，必须同时存在", notes("纯讨论不能暴露真实交互和数据问题；直接大开发又会把未知问题固化成昂贵实现。正确机制是固定 North Star，再用最小可观察实现循环学习。"));
  nodes.push(
    ...boxWithText("只有讨论", "结构看似完整，真实 Evidence、接口和责任问题仍然隐藏。", 72, 198, 286, 238, { fill: C.grayLight, stroke: C.grayMid, titleSize: 30, bodySize: 21, bodyTop: 74 }),
    tx("缺少现实反馈", 104, 468, 222, 30, 19, C.red, { bold: true, align: "center" }),
    ...boxWithText("直接大开发", "同时扩领域、角色、系统、权限和 AI，成本上升却无法定位问题。", 922, 198, 286, 238, { fill: C.redLight, stroke: C.red, titleSize: 30, bodySize: 21, bodyTop: 74 }),
    tx("未知被固化", 954, 468, 222, 30, 19, C.red, { bold: true, align: "center" }),
    ellipse(494, 158, 292, 292, C.blueLight, { stroke: C.blue, line: { style: "solid", width: 2, fill: C.blue } }),
    ellipse(554, 218, 172, 172, C.paper, { stroke: C.blue }),
    tx("North Star", 554, 262, 172, 34, 27, C.blueDark, { bold: true, align: "center" }),
    tx("用户 · Case · Authority\n数据 · 安全 · 交付等级", 554, 306, 172, 60, 18, C.muted, { align: "center" }),
    arrow(448, 272, 84, 42, C.blue),
    arrow(748, 272, 84, 42, C.blue, "leftArrow"),
    tx("最小可观察实现", 478, 480, 324, 36, 27, C.ink, { bold: true, align: "center" }),
    tx("实现 → 观测 → 纠偏 → 验证 → 下一小步", 402, 530, 476, 32, 22, C.blueDark, { bold: true, align: "center" }),
    roundRect(382, 584, 516, 42, C.amberLight, { stroke: C.amberLight }),
    tx("每次只增加一个主要复杂度", 404, 592, 472, 26, 20, C.amber, { bold: true, align: "center", valign: "middle" })
  );
  compose(slide, 6, nodes);
}

function buildSlide07(presentation) {
  const { slide, nodes } = slideBase(presentation, 7, "06｜THE LIVING CELL", "活细胞必须能工作、承担责任，也能学习", notes("活细胞不是页面，也不只是一个 Case。它至少具备四个能力：感知、判断、行动、学习。前三项完成一笔工作，第四项让问题进入受控版本改进，使下一笔 Case 更好。"));
  nodes.push(
    line(640, 180, 2, 390, C.grayMid),
    line(250, 378, 780, 2, C.grayMid),
    ellipse(520, 280, 240, 196, C.ink, { stroke: C.ink }),
    tx("活细胞", 520, 324, 240, 44, 36, C.white, { bold: true, align: "center" }),
    tx("围绕同一 Case", 520, 382, 240, 28, 19, C.grayMid, { align: "center" }),
    ...boxWithText("感知", "接收 Evidence，形成同一 Case Context", 92, 170, 334, 150, { fill: C.blueLight, stroke: C.blue, titleColor: C.blueDark, titleSize: 30, bodySize: 20, bodyTop: 64 }),
    ...boxWithText("判断", "系统 / AI 完成机器工作；人保留正式判断", 854, 170, 334, 150, { fill: C.paper, stroke: C.line, titleSize: 30, bodySize: 20, bodyTop: 64 }),
    ...boxWithText("学习", "领域 + 系统 + 智能通过 Evaluation、版本与回滚改进", 92, 438, 334, 150, { fill: C.amberLight, stroke: C.amber, titleColor: C.amber, titleSize: 30, bodySize: 20, bodyTop: 64 }),
    ...boxWithText("行动", "具名 Human Gate、真实 Receipt、正式状态与下一接续", 854, 438, 334, 150, { fill: C.greenLight, stroke: C.green, titleColor: C.green, titleSize: 30, bodySize: 20, bodyTop: 64 }),
    arrow(444, 227, 52, 32, C.blue),
    arrow(784, 227, 52, 32, C.blue),
    arrow(444, 510, 52, 32, C.amber),
    arrow(784, 510, 52, 32, C.green, "leftArrow"),
    tx("Agent：只能生成候选 · authority=none", 448, 560, 384, 28, 18, C.red, { bold: true, align: "center" })
  );
  compose(slide, 7, nodes);
}

function buildSlide08(presentation) {
  const { slide, nodes } = slideBase(presentation, 8, "07｜P1 CANDIDATE", "先用一个信审任务，让活细胞在纸面上跑通", notes("这页是 P1 候选纸面运行，不是已实现流程。逐步讲七个动作：材料进入、事实核验、发现矛盾、形成补件或候选判断、信审人员确认、暴露系统问题、发布改进版本并复跑。"));
  nodes.push(...label("候选｜待业务调研验证", 928, 136, 276, "amber"));
  const stepData = [
    ["01", "材料进入", "Evidence"],
    ["02", "关键事实核验", "机器工作"],
    ["03", "发现矛盾 / 缺口", "作业信号"],
    ["04", "补件 / 候选判断", "Agent 候选"],
    ["05", "信审人员确认", "Human Gate"],
    ["06", "暴露系统问题", "诊断"],
    ["07", "改进版本复跑", "Version"],
  ];
  const xsTop = [72, 356, 640, 924];
  for (let i = 0; i < 4; i++) {
    const [num, title, small] = stepData[i];
    nodes.push(
      roundRect(xsTop[i], 202, 232, 126, i === 2 ? C.amberLight : C.paper, { stroke: i === 2 ? C.amber : C.line }),
      tx(num, xsTop[i] + 18, 220, 46, 34, 26, i === 2 ? C.amber : C.blue, { bold: true }),
      tx(title, xsTop[i] + 66, 220, 146, 58, 23, C.ink, { bold: true }),
      tx(small, xsTop[i] + 66, 286, 146, 22, 17, C.muted)
    );
    if (i < 3) nodes.push(arrow(xsTop[i] + 242, 246, 34, 28, C.grayMid));
  }
  nodes.push(arrow(1024, 344, 42, 54, C.grayMid, "downArrow"));
  const xsBottom = [72, 418, 764];
  for (let j = 0; j < 3; j++) {
    const idx = 6 - j;
    const [num, title, small] = stepData[idx];
    const fill = idx === 4 ? C.greenLight : idx === 6 ? C.blueLight : C.paper;
    const stroke = idx === 4 ? C.green : idx === 6 ? C.blue : C.line;
    nodes.push(
      roundRect(xsBottom[j], 420, 292, 132, fill, { stroke }),
      tx(num, xsBottom[j] + 20, 440, 48, 34, 26, idx === 4 ? C.green : idx === 6 ? C.blue : C.amber, { bold: true }),
      tx(title, xsBottom[j] + 76, 438, 190, 58, 23, C.ink, { bold: true }),
      tx(small, xsBottom[j] + 76, 508, 190, 22, 17, C.muted)
    );
    if (j < 2) nodes.push(arrow(xsBottom[j] + 302, 468, 34, 28, C.grayMid, "leftArrow"));
  }
  nodes.push(
    roundRect(176, 590, 928, 44, C.ink, { stroke: C.ink }),
    tx("验收重点不是“页面完成”，而是 Evidence → Gate → Receipt → Version 的闭环可观察", 200, 598, 880, 28, 20, C.white, { bold: true, align: "center", valign: "middle" })
  );
  compose(slide, 8, nodes);
}

function buildSlide09(presentation) {
  const { slide, nodes } = slideBase(presentation, 9, "08｜EXPAND THE ORGANISM", "从信审扩到大风控，每个领域都要重新确认边界", notes("P2 不是简单复制信审页面，而是逐个领域确认三件事：什么 Evidence 才成立、谁拥有专业权威、系统和 AI 分别承担什么工作。跨域协同仍围绕同一 Case。"));
  nodes.push(
    line(640, 178, 2, 408, C.grayMid),
    line(256, 382, 768, 2, C.grayMid),
    ellipse(522, 280, 236, 204, C.ink, { stroke: C.ink }),
    tx("同一 CASE", 522, 336, 236, 42, 34, C.white, { bold: true, align: "center" }),
    tx("Context 不分叉", 522, 392, 236, 26, 18, C.grayMid, { align: "center" }),
    ...boxWithText("政策", "准入 · 规则 · 例外\n待确认 Evidence / Authority / AI", 80, 178, 322, 156, { fill: C.paper, stroke: C.line, titleSize: 30, bodySize: 18, bodyTop: 66 }),
    ...boxWithText("信审", "事实 · 证据 · 风险判断\nP1 首个活细胞", 878, 178, 322, 156, { fill: C.blueLight, stroke: C.blue, titleColor: C.blueDark, titleSize: 30, bodySize: 18, bodyTop: 66 }),
    ...boxWithText("商务", "条件 · 合同 · 付款 · 起租\n待确认 Evidence / Authority / AI", 80, 442, 322, 156, { fill: C.paper, stroke: C.line, titleSize: 30, bodySize: 18, bodyTop: 66 }),
    ...boxWithText("资产", "设备 · 履约 · 监测 · 处置\n待确认 Evidence / Authority / AI", 878, 442, 322, 156, { fill: C.paper, stroke: C.line, titleSize: 30, bodySize: 18, bodyTop: 66 }),
    arrow(420, 234, 66, 32, C.grayMid),
    arrow(794, 234, 66, 32, C.blue, "leftArrow"),
    arrow(420, 504, 66, 32, C.grayMid),
    arrow(794, 504, 66, 32, C.grayMid, "leftArrow"),
    tx("Gate：上一领域闭环通过后，再增加下一种专业复杂度", 250, 610, 780, 30, 20, C.amber, { bold: true, align: "center" })
  );
  compose(slide, 9, nodes);
}

function buildSlide10(presentation) {
  const { slide, nodes } = slideBase(presentation, 10, "09｜FROM CASE TO BUSINESS", "先形成稳定业务链，再进入真正的多 Case 管理", notes("P3 才加入商机和业务，形成小微融资租赁运行体系。只有当单 Case 跨专业流转稳定后，多 Case 才有资格成为管理对象；否则管理看到的只是页面状态，不是真实经营状态。"));
  nodes.push(
    tx("单笔业务链", 72, 160, 240, 34, 24, C.blueDark, { bold: true }),
    roundRect(72, 216, 1136, 114, C.paper, { stroke: C.line }),
    ...label("商机", 102, 258, 130, "blue"),
    arrow(246, 260, 46, 26, C.grayMid),
    ...label("业务", 306, 258, 130, "blue"),
    arrow(450, 260, 46, 26, C.grayMid),
    ...label("政策", 510, 258, 130, "gray"),
    arrow(654, 260, 46, 26, C.grayMid),
    ...label("信审", 714, 258, 130, "blue"),
    arrow(858, 260, 46, 26, C.grayMid),
    ...label("商务", 918, 258, 130, "gray"),
    arrow(1062, 260, 46, 26, C.grayMid),
    ...label("资产", 1122, 258, 70, "gray"),
    tx("同一 Case：需求、Evidence、专业 Gate、Receipt、履约与结果回流", 262, 348, 756, 32, 21, C.muted, { align: "center" }),
    tx("多 Case 之后，管理对象才发生变化", 72, 412, 520, 36, 27, C.ink, { bold: true }),
    ...boxWithText("CASE A", "等待补件", 72, 470, 206, 112, { fill: C.amberLight, stroke: C.amber, titleSize: 25, bodySize: 19, bodyTop: 58 }),
    ...boxWithText("CASE B", "信审 Gate", 302, 470, 206, 112, { fill: C.blueLight, stroke: C.blue, titleSize: 25, bodySize: 19, bodyTop: 58 }),
    ...boxWithText("CASE C", "资产履约", 532, 470, 206, 112, { fill: C.greenLight, stroke: C.green, titleSize: 25, bodySize: 19, bodyTop: 58 }),
    arrow(766, 510, 70, 36, C.blue),
    roundRect(858, 454, 350, 144, C.ink, { stroke: C.ink }),
    tx("管理循环", 888, 476, 290, 34, 27, C.white, { bold: true }),
    tx("偏差 · 等待 · 责任 · 返工\n经营影响 · 资源配置", 888, 526, 290, 58, 20, C.grayMid)
  );
  compose(slide, 10, nodes);
}

function buildSlide11(presentation) {
  const { slide, nodes } = slideBase(presentation, 11, "10｜CONTROLLED CONNECTION", "真实系统和真实组织，只能按风险逐级接入", notes("这是一条风险递增的接入阶梯。每一级都需要新的证据和 Gate，不能从本地 synthetic 直接跳到生产写入。P4 的目标是受控试点，不是企业全面上线。"));
  nodes.push(...label("候选接入路径｜待系统与数据调研", 852, 136, 352, "amber"));
  const stages = [
    ["01", "本地合成", "Local synthetic\n验证语义与闭环"],
    ["02", "只读接入", "Read-only\n核对字段与权限"],
    ["03", "旁路运行", "Shadow\n不影响正式结果"],
    ["04", "受控写入", "Controlled write\nHuman Gate 下执行"],
    ["05", "小范围试点", "Pilot\n价值与风险测量"],
  ];
  const xs = [72, 300, 528, 756, 984];
  const ys = [466, 398, 330, 262, 194];
  for (let i = 0; i < stages.length; i++) {
    const [num, title, body] = stages[i];
    const fill = i < 3 ? C.paper : i === 3 ? C.amberLight : C.blueLight;
    const stroke = i < 3 ? C.line : i === 3 ? C.amber : C.blue;
    nodes.push(
      roundRect(xs[i], ys[i], 202, 138, fill, { stroke }),
      tx(num, xs[i] + 18, ys[i] + 18, 42, 30, 24, i < 3 ? C.blue : i === 3 ? C.amber : C.blueDark, { bold: true }),
      tx(title, xs[i] + 18, ys[i] + 54, 166, 34, 22, C.ink, { bold: true }),
      tx(body, xs[i] + 18, ys[i] + 92, 166, 42, 17, C.muted)
    );
    if (i < stages.length - 1) nodes.push(arrow(xs[i] + 204, ys[i] + 50, 22, 24, C.grayMid));
  }
  nodes.push(
    line(72, 608, 1136, 2, C.line),
    tx("每一级重新确认：身份权限 · 数据权属 · 失败关闭 · Receipt · 回滚 · 观测", 72, 620, 1136, 28, 20, C.blueDark, { bold: true, align: "center" })
  );
  compose(slide, 11, nodes);
}

function buildSlide12(presentation) {
  const { slide, nodes } = slideBase(presentation, 12, "11｜PHASED ENGINEERING", "P0–P5：每一期只增加一个主要复杂度", notes("这页给出当前分期候选。P0 只建立认知地图、边界、未知问题和第一试验；P1 证明信审活细胞；之后依次扩领域、业务与多 Case、真实试点、企业级运营。P0 Gate 必须在 P1 开发授权前明确。"));
  const phases = [
    ["P0", "认知地图", "终局 · 边界 · 未知\n历史隔离 · 第一试验", C.grayLight, C.muted],
    ["P1", "信审活细胞", "作业 + 管理 + 改进\n最小闭环", C.blueLight, C.blueDark],
    ["P2", "大风控组织", "政策 · 商务 · 资产\n逐域确认边界", C.paper, C.blueDark],
    ["P3", "小微业务体系", "商机 + 业务 + 大风控\n多 Case 管理", C.paper, C.blueDark],
    ["P4", "企业真实试点", "真实人员与系统\n受控 Adapter", C.amberLight, C.amber],
    ["P5", "企业级运营", "安全 · SLO · 审计\n模型治理 · 价值评估", C.greenLight, C.green],
  ];
  const xs = [72, 260, 448, 636, 824, 1012];
  for (let i = 0; i < phases.length; i++) {
    const [p, title, body, fill, accent] = phases[i];
    nodes.push(
      tx(p, xs[i], 156, 164, 42, 31, accent, { bold: true }),
      line(xs[i], 206, 164, 4, accent),
      tx(title, xs[i], 228, 164, 56, 24, C.ink, { bold: true }),
      tx(body, xs[i], 304, 164, 88, 17, C.muted)
    );
    if (i < phases.length - 1) nodes.push(arrow(xs[i] + 166, 292, 18, 20, C.grayMid));
  }
  roundRect(72, 424, 1136, 172, C.ink, { stroke: C.ink });
  nodes.push(
    roundRect(72, 424, 1136, 172, C.ink, { stroke: C.ink }),
    tx("P0 结束 / P1 开始 Gate", 102, 450, 340, 36, 27, C.white, { bold: true }),
    tx("只有以下证据齐备，才授权 P1 实现：", 102, 506, 340, 30, 20, C.grayMid),
    tx("① 选定一个真实信审任务与责任人", 500, 450, 318, 30, 20, C.white, { bold: true }),
    tx("② 明确 Evidence、正式 Gate 与 Receipt", 500, 494, 318, 30, 20, C.white, { bold: true }),
    tx("③ 确认现有系统 / 数据边界与不可做事项", 848, 450, 322, 48, 20, C.white, { bold: true }),
    tx("④ 确认 P1 可观察验收问题与停止条件", 848, 514, 322, 48, 20, C.white, { bold: true }),
    tx("分期顺序与 Gate 均为当前候选，需跨职能讨论确认", 72, 618, 1136, 26, 18, C.amber, { bold: true, align: "center" })
  );
  compose(slide, 12, nodes);
}

function buildSlide13(presentation) {
  const { slide, nodes } = slideBase(presentation, 13, "12｜ASSET DISPOSITION", "已有积累不是作废，而是需要重新放回正确位置", notes("不要给复用百分比。当前只做三类判断：高概率可继承但必须重新验收；需要重构或重新定义；暂时历史隔离。代码、页面和设计只有通过新 authority 下的验收，才进入未来阶段。"));
  const cols = [72, 460, 848];
  const w = 340;
  nodes.push(
    tx("保留并重新验收", cols[0], 156, w, 36, 27, C.green, { bold: true }),
    line(cols[0], 204, w, 4, C.green),
    tx("Evidence\nContext / Event\nHuman Gate / Receipt\n幂等与失败关闭\nSQLite authority kernel\nGolden Case 与信审积累", cols[0], 232, w, 254, 23, C.ink),
    tx("前提：在新 Case 与 authority 语义下重验", cols[0], 530, w, 58, 19, C.green, { bold: true }),

    tx("重新评估 / 改造", cols[1], 156, w, 36, 27, C.amber, { bold: true }),
    line(cols[1], 204, w, 4, C.amber),
    tx("角色语义\nProjection\n消息 carrier\n入口与 Case 解耦\n组织与管理模型", cols[1], 232, w, 214, 23, C.ink),
    tx("前提：先确认新产品本体，再决定技术形态", cols[1], 530, w, 58, 19, C.amber, { bold: true }),

    tx("历史隔离", cols[2], 156, w, 36, 27, C.red, { bold: true }),
    line(cols[2], 204, w, 4, C.red),
    tx("V2 二十流程\n旧 V3 frozen\n九入口 root 候选\n4+4+2 舞台主线\n未确认的大型 God View", cols[2], 232, w, 214, 23, C.ink),
    tx("用途：理解历史，不进入当前主叙事", cols[2], 530, w, 58, 19, C.red, { bold: true }),
    roundRect(278, 610, 724, 40, C.grayLight, { stroke: C.grayLight }),
    tx("当前没有完成代码审计，因此不提供任何复用比例", 300, 618, 680, 24, 19, C.muted, { bold: true, align: "center" })
  );
  compose(slide, 13, nodes);
}

function buildSlide14(presentation) {
  const { slide, nodes } = slideBase(presentation, 14, "13｜TOMORROW'S DISCUSSION", "明天不冻结全部答案，只形成足以启动 P0 的共识", notes("结束时不要把路线图说成已经批准。先确认左侧四项共同认识，再请同事围绕右侧四个问题给出专业判断。最终目标是形成 P0 研究任务、责任人和 Gate，而不是直接进入大开发。"));
  nodes.push(
    tx("希望形成的共同认识", 72, 156, 430, 36, 27, C.blueDark, { bold: true }),
    tx("01", 72, 222, 54, 36, 28, C.blue, { bold: true }),
    tx("见微的本体是 Case 中心的人机协同运行体系", 142, 222, 390, 58, 23, C.ink, { bold: true }),
    tx("02", 72, 314, 54, 36, 28, C.blue, { bold: true }),
    tx("作业、管理、演进是三个不同但相连的循环", 142, 314, 390, 58, 23, C.ink, { bold: true }),
    tx("03", 72, 406, 54, 36, 28, C.blue, { bold: true }),
    tx("系统部门与智能部门必须共同进入建设机制", 142, 406, 390, 58, 23, C.ink, { bold: true }),
    tx("04", 72, 498, 54, 36, 28, C.amber, { bold: true }),
    tx("先用信审活细胞学习，再逐层增加复杂度", 142, 498, 390, 58, 23, C.ink, { bold: true }),
    line(590, 160, 2, 428, C.line),
    tx("需要同事共同判断", 650, 156, 520, 36, 27, C.amber, { bold: true }),
    roundRect(650, 220, 520, 74, C.paper, { stroke: C.line }),
    tx("1", 672, 239, 34, 34, 24, C.blue, { bold: true, align: "center" }),
    tx("哪个信审任务最适合作为 P1 活细胞？", 724, 236, 420, 40, 21, C.ink, { bold: true, valign: "middle" }),
    roundRect(650, 310, 520, 74, C.paper, { stroke: C.line }),
    tx("2", 672, 329, 34, 34, 24, C.blue, { bold: true, align: "center" }),
    tx("它依赖哪些 Evidence、正式 Gate、责任人与现有系统？", 724, 326, 420, 42, 21, C.ink, { bold: true, valign: "middle" }),
    roundRect(650, 400, 520, 74, C.paper, { stroke: C.line }),
    tx("3", 672, 419, 34, 34, 24, C.blue, { bold: true, align: "center" }),
    tx("领域、系统、智能三方由谁参加 P0 调研与验收？", 724, 416, 420, 42, 21, C.ink, { bold: true, valign: "middle" }),
    roundRect(650, 490, 520, 74, C.amberLight, { stroke: C.amber }),
    tx("4", 672, 509, 34, 34, 24, C.amber, { bold: true, align: "center" }),
    tx("哪些证据足以证明 P0 结束，可以授权 P1？", 724, 506, 420, 42, 21, C.ink, { bold: true, valign: "middle" }),
    roundRect(650, 590, 520, 48, C.ink, { stroke: C.ink }),
    tx("下一步：形成 P0 研究清单、责任人、时间盒与 Gate", 670, 600, 480, 28, 19, C.white, { bold: true, align: "center", valign: "middle" })
  );
  compose(slide, 14, nodes);
}

async function main() {
  await fs.mkdir(BUILD_DIR, { recursive: true });
  await fs.mkdir("C:\\Users\\22673\\Desktop\\Anthropic\\outputs", { recursive: true });

  const presentation = Presentation.create({ slideSize: { width: W, height: H } });
  buildSlide01(presentation);
  buildSlide02(presentation);
  buildSlide03(presentation);
  buildSlide04(presentation);
  buildSlide05(presentation);
  buildSlide06(presentation);
  buildSlide07(presentation);
  buildSlide08(presentation);
  buildSlide09(presentation);
  buildSlide10(presentation);
  buildSlide11(presentation);
  buildSlide12(presentation);
  buildSlide13(presentation);
  buildSlide14(presentation);

  const snapshot = await presentation.inspect({
    kind: "slide,textbox,shape,notes",
    maxChars: 12000,
  });
  await fs.writeFile(`${BUILD_DIR}\\inspection.ndjson`, snapshot.ndjson, "utf8");

  const montage = await presentation.export({ format: "webp", montage: true, scale: 1 });
  await fs.writeFile(`${BUILD_DIR}\\artifact-tool-montage.webp`, new Uint8Array(await montage.arrayBuffer()));

  const pptx = await PresentationFile.exportPptx(presentation);
  await pptx.save(FINAL_PPTX);

  console.log(`Created ${FINAL_PPTX}`);
  console.log(`Slides: ${presentation.slides.items.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
