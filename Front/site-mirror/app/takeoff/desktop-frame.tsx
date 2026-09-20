import { useEffect, useState, type ReactNode } from 'react';

/** 用户锁定的 1080P 横屏画布；较小预览窗口等比显示，不改浏览器缩放或设备状态。 */
export function DesktopFrame({ children }: { children: ReactNode }) {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const width = Math.max(1280, size.width);
  const scale = size.width / width;
  const height = size.height / scale;
  useEffect(() => { const resize = () => setSize({ width: window.innerWidth, height: window.innerHeight }); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  return <div className="tk-desktop-host"><div className="tk-desktop-frame" data-design-size="1920x1080" style={{ width, height, transform: `scale(${scale})`, left: 0, top: 0 }}>{children}</div></div>;
}
