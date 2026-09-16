// V6 SE REBUILD · 细线SVG图标集（合成预览专用）。视觉语言与 V5/frontend/F0-R1 图标一致：
// 24 viewBox、strokeWidth 1.8、currentColor、aria-hidden。四域图形逐字复用 V5 快照。
// 映射（已接受）：生命周期=预审清单/尽调放大镜/签约签字笔/租后循环箭头；
// 管线列=输入收件托盘/处理齿轮/协同相连节点/输出发件托盘；
// 状态标识（对号/叹号/叉）独立于功能图标，放状态文字左侧，业务含义以实际状态为准。
interface IconProps {
  size?: number;
  className?: string;
}

function base(size: number | undefined, className: string | undefined) {
  return {
    width: size ?? 16,
    height: size ?? 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    className,
  };
}

// ---------- 四专业域（复用 V5 快照原形） ----------

/** 政策：尺子 */
export function RulerIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props.className)}>
      <rect x="3.5" y="8.5" width="17" height="7" rx="1" />
      <path d="M7.5 8.5v3M11.5 8.5v3M15.5 8.5v3" />
    </svg>
  );
}

/** 信审：盾牌 */
export function ShieldIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props.className)}>
      <path d="M12 3.5 19 6v5.5c0 4.2-2.8 7.4-7 9-4.2-1.6-7-4.8-7-9V6l7-2.5Z" />
      <path d="M9.2 11.8l2 2 3.6-3.9" />
    </svg>
  );
}

/** 商务：合同 */
export function ContractIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props.className)}>
      <path d="M6 3.5h9l3.5 3.5v13.5H6Z" />
      <path d="M9 9h6M9 12.5h6M9 16h4" />
    </svg>
  );
}

/** 资产：钻石 */
export function DiamondIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props.className)}>
      <path d="M7 4.5h10l3.5 5L12 19.5 3.5 9.5Z" />
      <path d="M3.5 9.5h17M9.5 4.5 8 9.5l4 10 4-10-1.5-5" />
    </svg>
  );
}

// ---------- 生命周期四阶段 ----------

/** 商机：对话气泡（r5 补充；商机沟通阶段线性图标，与现有细线风格一致） */
export function ChatBubbleIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props.className)}>
      <path d="M5 5.5h14a1.6 1.6 0 0 1 1.6 1.6v7.8a1.6 1.6 0 0 1-1.6 1.6H10.5L6 20.2v-3.8H5a1.6 1.6 0 0 1-1.6-1.6V7.1A1.6 1.6 0 0 1 5 5.5Z" />
      <path d="M7.5 10h9M7.5 12.8h6" />
    </svg>
  );
}

/** 预审：清单 */
export function ChecklistIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props.className)}>
      <path d="M5 4.5h14v15H5Z" />
      <path d="M8 9l1.5 1.5L12 8M8 14.5l1.5 1.5L12 13.5M14 9.5h2.5M14 15h2.5" />
    </svg>
  );
}

/** 尽调：放大镜 */
export function MagnifierIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props.className)}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 20 20M8 10.5h5M10.5 8v5" />
    </svg>
  );
}

/** 签约：签字笔 */
export function PenIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props.className)}>
      <path d="M5 19.5h14" />
      <path d="m7 16.5 9.8-9.8a1.8 1.8 0 0 1 2.5 2.5L9.5 19H7v-2.5Z" />
    </svg>
  );
}

/** 租后：循环箭头 */
export function CycleIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props.className)}>
      <path d="M6 9a7 7 0 0 1 12-2.5M18 15a7 7 0 0 1-12 2.5" />
      <path d="M18 3v3.5h-3.5M6 21v-3.5h3.5" />
    </svg>
  );
}

// ---------- 管线四列（呈现标签 输入/处理/协同/输出） ----------

/** 输入：收件托盘 */
export function InboxIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props.className)}>
      <path d="M4 13.5h4l1.5 3h5l1.5-3h4" />
      <path d="M4 13.5 6.5 5h11L20 13.5V19H4v-5.5Z" />
    </svg>
  );
}

/** 处理：齿轮 */
export function GearIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props.className)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 4.5v2.2M12 17.3v2.2M4.5 12h2.2M17.3 12h2.2M6.7 6.7l1.6 1.6M15.7 15.7l1.6 1.6M17.3 6.7l-1.6 1.6M8.3 15.7l-1.6 1.6" />
    </svg>
  );
}

/** 协同：相连节点 */
export function NodesIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props.className)}>
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="6.5" r="2.5" />
      <circle cx="18" cy="17.5" r="2.5" />
      <path d="M8.3 11 15.7 7.5M8.3 13l7.4 3.5" />
    </svg>
  );
}

/** 输出：发件托盘 */
export function OutboxIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props.className)}>
      <path d="M12 15V5M8.5 8.5 12 5l3.5 3.5" />
      <path d="M4.5 13.5V19h15v-5.5" />
    </svg>
  );
}

// ---------- 独立状态标识（放状态文字左侧；红叉=实际对应状态，不伪造） ----------

/** 完成：对号 */
export function CheckIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props.className)}>
      <path d="m5.5 12.5 4 4 9-9.5" />
    </svg>
  );
}

/** 待补充/注意：叹号 */
export function WarnIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props.className)}>
      <path d="M12 4.5 21 19.5H3L12 4.5Z" />
      <path d="M12 10v4M12 16.8v.4" />
    </svg>
  );
}

/** 对应失败/未通过状态：叉 */
export function CrossIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props.className)}>
      <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
    </svg>
  );
}

/** 待办时间：时钟（无来源时配文字"未设置/暂无估计"） */
export function ClockIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props.className)}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

// ---------- V6 SE 总览紧凑面板（sub-agent A 追加；只增不删） ----------

/** 展开/收起指示：下拉箭头（收起指下方，展开时经 CSS 旋转 180°） */
export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props.className)}>
      <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
    </svg>
  );
}

/** 沟通工具行：视频/远程会话入口 */
export function VideoIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props.className)}>
      <rect x="3.5" y="7" width="12" height="10" rx="2" />
      <path d="M15.5 11l5-3v8l-5-3Z" />
    </svg>
  );
}
