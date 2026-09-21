import { useEffect, useState, type ReactNode } from 'react';

/** 1920×1080 为设计基准；页面以 100% 铺满实际视口，不进行整页缩放。 */
export function DesktopFrame({ children }: { children: ReactNode }) {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const width = size.width;
  const height = size.height;
  const scale = 1;
  useEffect(() => { const resize = () => setSize({ width: window.innerWidth, height: window.innerHeight }); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  return <div className="tk-desktop-host"><div className="tk-desktop-frame" data-design-size="1920x1080" style={{ width, height, transform: `scale(${scale})`, left: 0, top: 0 }}>{children}</div></div>;
}
