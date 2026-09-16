'use client';

import { useEffect } from 'react';
import styles from './work-surface.module.css';

export default function WorkError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Failed to read the V4 work projection.', error);
  }, [error]);

  return (
    <main className={`${styles.routeState} ${styles.errorState}`} role="alert">
      <span>读取失败</span>
      <h1>事项投影暂时不可用</h1>
      <p>当前页面不会保留乐观成功状态，也不会从错误中推断 Decision 或 Receipt。</p>
      <button type="button" onClick={reset}>重新读取</button>
    </main>
  );
}
