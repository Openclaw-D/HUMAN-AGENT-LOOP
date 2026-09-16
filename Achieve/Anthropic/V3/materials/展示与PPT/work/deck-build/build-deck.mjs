import fs from "node:fs/promises";
import path from "node:path";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const BUILD_DIR = "C:/Users/22673/Desktop/Anthropic/jianwei-v3-showcase/work/deck-build";
const ASSET_DIR = "C:/Users/22673/Desktop/Anthropic/jianwei-v3-showcase/assets/scenes";
const OUTPUT_DIR = "C:/Users/22673/Desktop/Anthropic/jianwei-v3-showcase/output";
const FINAL_PPTX = path.join(OUTPUT_DIR, "见微-V3-展示-逆转黄金五分钟-八场景-v1.pptx");
const RENDER_DIR = path.join(BUILD_DIR, "rendered-scenes");
const SLIDE_W = 1280;
const SLIDE_H = 720;
const FONT = "Microsoft YaHei";
const WHITE = "#F7F7F4";
const MUTED = "#C9CBCB";
const ORANGE = "#FF8A3D";

const scenes = [
  {
    image: "scene-01-opening.png",
    time: "00:00—01:00",
    index: "01 / 08",
    title: "见微登场——逆转黄金五分钟",
    quotes: [
      ["业务 / 旁白", "真正的主角，是一家正在和产能窗口赛跑的企业。"],
    ],
    action: "晚会式串场在20秒内完成；随即由轻松转为严肃，客户成为视觉焦点。",
  },
  {
    image: "scene-02-customer.png",
    time: "01:00—02:00",
    index: "02 / 08",
    title: "客户只说一次，系统开始理解",
    quotes: [
      ["客户", "订单已经来了，我不想再拿着同一套材料跑四个部门。"],
      ["业务", "你只说一次，剩下的让系统去找人。"],
    ],
    action: "客户用手机提交最小事实；业务确认同一 Case，强调少材料、一个入口。",
  },
  {
    image: "scene-03-parallel.png",
    time: "02:00—03:00",
    index: "03 / 08",
    title: "同一版事实，六个人同时行动",
    quotes: [
      ["政策", "我判断它能不能进入规则边界。"],
      ["信审", "我判断经营事实能不能支持持续偿付。"],
    ],
    action: "业务具名确认；政策、信审、商务、资产各看同一事实的不同专业投影。",
  },
  {
    image: "scene-04-human-review.png",
    time: "03:00—04:00",
    index: "04 / 08",
    title: "标准通道暂停，复杂项目升级人工",
    quotes: [
      ["信审", "这不是否决客户，这是人工复核。"],
      ["业务", "快，不是掩盖风险。"],
    ],
    action: "客户补充订单集中度与回款周期变化；自动通道暂停，具名信审接手。",
  },
  {
    image: "scene-05-gates.png",
    time: "04:00—05:00",
    index: "05 / 08",
    title: "协调，让分散能力形成共同判断",
    quotes: [
      ["政策", "例外边界，我负责。"],
      ["商务", "交易条件，我负责。"],
      ["资产", "设备和履约，我负责。"],
    ],
    action: "业务组织节奏但不代签；四个专业 Gate 依次形成具名 Receipt。",
  },
  {
    image: "scene-06-commencement.png",
    time: "05:00—06:00",
    index: "06 / 08",
    title: "资金进入真实产能",
    quotes: [
      ["商务", "上游判断完整，正式起租。"],
      ["业务", "不是模型拍板，是证据、专业和责任共同完成。"],
    ],
    action: "商务提交正式起租；大屏只展示上游 Gate、正式 Receipt 与产线启动。",
  },
  {
    image: "scene-07-lifecycle.png",
    time: "06:00—07:00",
    index: "07 / 08",
    title: "起租不是结束，客户仍然随时有入口",
    quotes: [
      ["客户", "我们计划再扩一条线，追加一亿元，能不能评估？"],
      ["资产", "复杂需求已转人工，带着完整上下文继续。"],
    ],
    action: "普通咨询由 Agent 响应；重大追加投资只生成跨专业评估提案，不自动批准。",
  },
  {
    image: "scene-08-closing.png",
    time: "07:00—08:00",
    index: "08 / 08",
    title: "一笔融资终会结清，责任不应在放款后消失",
    quotes: [
      ["业务 / 旁白", "让每一份真实需求被准确理解，让每一笔资金在可负责的判断中抵达。"],
    ],
    action: "六人形成平等接续线；大屏定格实体产线与持续服务路径，7分50秒前结束。",
  },
];

async function readBytes(filePath) {
  const bytes = await fs.readFile(filePath);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function writeBlob(filePath, blob) {
  await fs.writeFile(filePath, new Uint8Array(await blob.arrayBuffer()));
}

function addText(slide, name, text, position, fontSize, color, options = {}) {
  const box = slide.shapes.add({
    geometry: "textbox",
    name,
    position,
    fill: "none",
    line: { style: "solid", fill: "none", width: 0 },
  });
  box.text = text;
  box.text.style = {
    fontSize,
    typeface: FONT,
    color,
    bold: options.bold ?? false,
    alignment: options.alignment ?? "left",
    verticalAlignment: options.verticalAlignment ?? "middle",
    autoFit: "shrinkText",
    wrap: "square",
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  return box;
}

function addOverlaySlide(presentation, scene, imageBytes, sceneNumber) {
  const slide = presentation.slides.add();
  slide.background.fill = "#050608";
  slide.images.add({
    blob: imageBytes,
    contentType: "image/png",
    alt: `见微 V3 六人舞台场景 ${sceneNumber}`,
    fit: "cover",
    position: { left: 0, top: 0, width: SLIDE_W, height: SLIDE_H },
  });

  slide.shapes.add({
    geometry: "rect",
    name: `upper-gradient-${sceneNumber}`,
    position: { left: 0, top: 0, width: SLIDE_W, height: 235 },
    fill: {
      type: "gradient",
      gradientKind: "linear",
      angleDeg: 90,
      stops: [
        { offset: 0, color: { type: "rgb", value: "#050608", transform: { opacity: 0.92 } } },
        { offset: 100000, color: { type: "rgb", value: "#050608", transform: { opacity: 0.02 } } },
      ],
    },
    line: { style: "solid", fill: "none", width: 0 },
  });
  slide.shapes.add({
    geometry: "rect",
    name: `lower-gradient-${sceneNumber}`,
    position: { left: 0, top: 488, width: SLIDE_W, height: 232 },
    fill: {
      type: "gradient",
      gradientKind: "linear",
      angleDeg: 270,
      stops: [
        { offset: 0, color: { type: "rgb", value: "#050608", transform: { opacity: 0.96 } } },
        { offset: 100000, color: { type: "rgb", value: "#050608", transform: { opacity: 0.08 } } },
      ],
    },
    line: { style: "solid", fill: "none", width: 0 },
  });

  addText(slide, `scene-index-${sceneNumber}`, scene.index, { left: 64, top: 38, width: 130, height: 28 }, 20, ORANGE, { bold: true });
  addText(slide, `scene-time-${sceneNumber}`, scene.time, { left: 200, top: 38, width: 210, height: 28 }, 20, MUTED);
  addText(slide, `scene-title-${sceneNumber}`, scene.title, { left: 64, top: 78, width: 1148, height: sceneNumber === 8 ? 116 : 78 }, sceneNumber === 8 ? 48 : 54, WHITE, { bold: true });

  const quoteTop = scene.quotes.length === 3 ? 535 : 555;
  const quoteGap = scene.quotes.length === 3 ? 52 : 58;
  scene.quotes.forEach(([role, quote], quoteIndex) => {
    const y = quoteTop + quoteIndex * quoteGap;
    addText(slide, `quote-role-${sceneNumber}-${quoteIndex}`, role, { left: 64, top: y, width: 150, height: 34 }, 23, ORANGE, { bold: true });
    addText(slide, `quote-text-${sceneNumber}-${quoteIndex}`, quote, { left: 220, top: y - 1, width: 985, height: 38 }, scene.quotes.length === 3 ? 25 : 29, WHITE, { bold: false });
  });

  slide.speakerNotes.textFrame.setText([
    `时间：${scene.time}`,
    `舞台动作：${scene.action}`,
    `可见台词：${scene.quotes.map(([role, quote]) => `${role}：“${quote}”`).join(" ")}`,
    "能力边界：见微 V3 固定合成、去标识演示；模型 authority=none；正式动作必须由具名人员确认并留下 Receipt；现场八分钟不代表真实业务十分钟完成审批或放款。",
    "[Sources]",
    `- OpenAI ImageGen，当前任务生成的原创场景图：${scene.image}`,
    "- 用户确认的见微 V3 展示叙事与舞台约束，2026-08-30",
    "[/Sources]",
  ]);
  slide.speakerNotes.setVisible(true);
  return slide;
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.mkdir(RENDER_DIR, { recursive: true });

  const draft = Presentation.create({ slideSize: { width: SLIDE_W, height: SLIDE_H } });
  for (let i = 0; i < scenes.length; i += 1) {
    const scene = scenes[i];
    const imageBytes = await readBytes(path.join(ASSET_DIR, scene.image));
    addOverlaySlide(draft, scene, imageBytes, i + 1);
  }

  const renderedPaths = [];
  for (let i = 0; i < draft.slides.items.length; i += 1) {
    const slide = draft.slides.items[i];
    const filePath = path.join(RENDER_DIR, `scene-${String(i + 1).padStart(2, "0")}.png`);
    await writeBlob(filePath, await draft.export({ slide, format: "png", scale: 2 }));
    renderedPaths.push(filePath);
    const layoutBlob = await slide.export({ format: "layout" });
    await fs.writeFile(path.join(RENDER_DIR, `scene-${String(i + 1).padStart(2, "0")}.layout.json`), await layoutBlob.text());
  }
  await writeBlob(path.join(BUILD_DIR, "draft-montage.webp"), await draft.export({ format: "webp", montage: true, scale: 1 }));

  const finalDeck = Presentation.create({ slideSize: { width: SLIDE_W, height: SLIDE_H } });
  for (let i = 0; i < renderedPaths.length; i += 1) {
    const slide = finalDeck.slides.add();
    slide.background.fill = "#050608";
    slide.images.add({
      blob: await readBytes(renderedPaths[i]),
      contentType: "image/png",
      alt: `见微 V3 八分钟六人舞台分镜 ${i + 1}`,
      fit: "cover",
      position: { left: 0, top: 0, width: SLIDE_W, height: SLIDE_H },
    });
    const sourceScene = scenes[i];
    slide.speakerNotes.textFrame.setText([
      `时间：${sourceScene.time}`,
      `舞台动作：${sourceScene.action}`,
      `台词：${sourceScene.quotes.map(([role, quote]) => `${role}：“${quote}”`).join(" ")}`,
      "能力边界：见微 V3 固定合成、去标识演示；模型 authority=none；正式动作必须由具名人员确认并留下 Receipt；现场八分钟不代表真实业务十分钟完成审批或放款。",
      "[Sources]",
      `- OpenAI ImageGen，当前任务生成的原创场景图：${sourceScene.image}`,
      "- 用户确认的见微 V3 展示叙事与舞台约束，2026-08-30",
      "[/Sources]",
    ]);
    slide.speakerNotes.setVisible(true);
  }

  await writeBlob(path.join(BUILD_DIR, "final-montage.webp"), await finalDeck.export({ format: "webp", montage: true, scale: 1 }));
  const snapshot = await finalDeck.inspect({ kind: "slide,image,notes", maxChars: 12000 });
  await fs.writeFile(path.join(BUILD_DIR, "final-inspect.ndjson"), snapshot.ndjson);
  const pptx = await PresentationFile.exportPptx(finalDeck);
  await pptx.save(FINAL_PPTX);
  console.log(JSON.stringify({ finalPptx: FINAL_PPTX, slideCount: finalDeck.slides.items.length, renderedPaths }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
