// harness 专用：next/link 桩（仅候选渲染证据用，非产品代码）。
import type { ReactNode } from 'react';

export default function Link({
  href,
  children,
  ...rest
}: {
  href: string;
  children: ReactNode;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}
