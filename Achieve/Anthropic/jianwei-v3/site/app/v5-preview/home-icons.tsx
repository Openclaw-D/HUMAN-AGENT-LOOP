// B 候选 · 新增图标（只增不删）。基础图标（CheckIcon/ClockIcon/四域图标等）直接复用
// site/app/v5-preview/se-icons.tsx 原形（import 见各组件）；本文件只补首页新增：
// 菜单、重开（循环箭头）、扳手（进行中）、问号（未开始）、历史展开/收起。
// 视觉语言与 se-icons 一致：24 viewBox、strokeWidth 1.8、currentColor、aria-hidden。
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

/** 项目菜单：三条横线 */
export function MenuIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props.className)}>
      <path d="M4.5 7h15M4.5 12h15M4.5 17h15" />
    </svg>
  );
}

/** 重新开始固定演示：循环箭头（非浏览器刷新语义——按钮文案与确认弹层写明作用域） */
export function RestartIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props.className)}>
      <path d="M5.5 9a7 7 0 0 1 12.6-1.8M18.5 15a7 7 0 0 1-12.6 1.8" />
      <path d="M18.5 3.5V7.5h-4M5.5 20.5v-4h4" />
    </svg>
  );
}

/** 进行中：扳手（放在浅蓝圆底上构成"蓝圆扳手"状态标识） */
export function WrenchIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props.className)}>
      <path d="M14.2 6.8a3.6 3.6 0 0 1 4.6-4.5l-2.5 2.5 1.4 2.9 2.9 1.4a3.6 3.6 0 0 1-4.5-4.6" />
      <path d="M13.2 9.4 5.6 17a1.9 1.9 0 0 0 2.7 2.7l7.6-7.6" />
    </svg>
  );
}

/** 未开始：问号（放在白底描边圆上构成"白圆问号"状态标识） */
export function QuestionIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props.className)}>
      <path d="M9.2 9.2a2.9 2.9 0 1 1 4.2 2.6c-.9.5-1.4 1-1.4 2" />
      <path d="M12 17.2v.3" />
    </svg>
  );
}

/** 历史原文展开：向下小箭头（展开时 CSS 旋转） */
export function ChevronSmallIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props.className)}>
      <path d="m7 10 5 5 5-5" />
    </svg>
  );
}

/** 关闭菜单/提示：叉 */
export function CloseIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props.className)}>
      <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
    </svg>
  );
}
