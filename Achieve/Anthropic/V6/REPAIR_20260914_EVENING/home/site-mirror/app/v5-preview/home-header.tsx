// F 轮 · 页头：项目名与编号相连置于左侧（编号左移与项目名相连——替代 R1 的右对齐编号）；
// 右侧为案例切换与六角色选择区（HomeRoleBar，由组合根拼装）。无登录身份语义：
// 角色只是演示视角。项目名来自当前案例，编号为案例编号（合成）。
import styles from './home-overview.module.css';

export function HomeHeader({ title, code }: { title: string; code: string }) {
  const full = code !== '' ? `${title} · ${code}` : title;
  return (
    <header className={styles.header}>
      <h1 className={styles.headerTitle} title={full}>{full}</h1>
    </header>
  );
}
