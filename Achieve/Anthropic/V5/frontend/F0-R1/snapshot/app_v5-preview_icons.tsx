// V5 PREVIEW · 四域极简线性图标（合成预览专用，不追求视觉包装）。
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

/** 业务协调：拼图定位（非第五风控域，仅协调视角） */
export function CoordinateIcon(props: IconProps) {
  return (
    <svg {...base(props.size, props.className)}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4" />
    </svg>
  );
}
