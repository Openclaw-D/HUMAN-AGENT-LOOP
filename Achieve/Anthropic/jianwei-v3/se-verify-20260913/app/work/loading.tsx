import styles from './work-surface.module.css';

export default function WorkLoading() {
  return (
    <main className={styles.routeState} aria-busy="true" aria-live="polite">
      <span>加载中</span>
      <h1>正在读取事项投影</h1>
      <p>等待 Case、Attempt、Context 与结果凭证的同一版本投影；不会乐观显示成功。</p>
      <div className={styles.loadingBars} aria-hidden="true"><i /><i /><i /></div>
    </main>
  );
}
