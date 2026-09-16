// F 轮 · 顶栏右区：案例切换入口 + 六个角色小图标（右上角色选择区）。
// 交互契约（V7 §六角色）：角色选择只是"演示视角"，不是登录身份授权；切换零副作用
//（本组件只回调 onSelectRole/onSelectCase，不改任何项目状态）。
// 可发现性：六角色平铺常显，不藏入口；每个按钮带图标+角色名（可访问名称完整）；
// 375 宽自动折两行（grid 3 列），触控区域 ≥40px 高。
import { ROLE_IDS, ROLE_LABEL, type RoleId } from './role-contract';
import { CompassIcon, BriefcaseIcon } from './home-icons';
import { ContractIcon, DiamondIcon, RulerIcon, ShieldIcon } from './se-icons';
import styles from './home-overview.module.css';

function RoleIcon({ roleId }: { roleId: RoleId }) {
  const size = 15;
  if (roleId === 'jianwei') return <CompassIcon size={size} />;
  if (roleId === 'business') return <BriefcaseIcon size={size} />;
  if (roleId === 'policy') return <RulerIcon size={size} />;
  if (roleId === 'credit') return <ShieldIcon size={size} />;
  if (roleId === 'commerce') return <ContractIcon size={size} />;
  return <DiamondIcon size={size} />;
}

export function HomeRoleBar({
  cases,
  activeCaseId,
  activeRole,
  onSelectCase,
  onSelectRole,
}: {
  cases: readonly { id: string; title: string; code: string }[];
  activeCaseId: string;
  activeRole: RoleId;
  onSelectCase: (id: string) => void;
  onSelectRole: (role: RoleId) => void;
}) {
  return (
    <div className={styles.roleBar}>
      <label className={styles.casePick}>
        <span className={styles.casePickLabel}>案例</span>
        <select
          className={styles.caseSelect}
          value={activeCaseId}
          aria-label="切换演示案例（项目之间消息与待办隔离）"
          onChange={(e) => onSelectCase(e.target.value)}
        >
          {cases.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title} · {c.code}
            </option>
          ))}
        </select>
      </label>
      <div className={styles.roleGrid} role="group" aria-label="演示视角（六角色，切换不重开项目、不清消息）">
        {ROLE_IDS.map((role) => {
          const active = role === activeRole;
          return (
            <button
              key={role}
              type="button"
              className={styles.roleBtn}
              data-active={active ? 'true' : 'false'}
              aria-pressed={active}
              aria-label={`${ROLE_LABEL[role]}视角${active ? '（当前）' : ''}（演示视角·非登录身份）`}
              title={`${ROLE_LABEL[role]}视角（演示视角·非登录身份）`}
              onClick={() => onSelectRole(role)}
            >
              <RoleIcon roleId={role} />
              <span className={styles.roleBtnLabel}>{ROLE_LABEL[role]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
