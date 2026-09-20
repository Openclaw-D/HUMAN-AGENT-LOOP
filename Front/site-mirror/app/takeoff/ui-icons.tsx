import type { CSSProperties } from 'react';

export type IconName = 'business' | 'opportunity' | 'policy' | 'credit' | 'commerce' | 'asset' | 'jianwei' | 'board' | 'materials' | 'flow' | 'timeline' | 'search' | 'plus' | 'back' | 'arrow' | 'close' | 'expand' | 'file' | 'check' | 'upload' | 'lock' | 'wrench';
const paths: Record<IconName, React.ReactNode> = {
  business: <><rect x="4" y="7" width="24" height="20" rx="5"/><path d="M11 7V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2M4 15c7 4 17 4 24 0M13 17h6"/></>,
  opportunity: <><rect x="4" y="7" width="24" height="20" rx="5"/><path d="M11 7V5h10v2M4 15c7 4 17 4 24 0M13 17h6"/></>,
  policy: <><path d="M16 3 27 7v9c0 6-6 10-11 13C11 26 5 22 5 16V7Z"/><path d="m10 15 4 4 8-9"/></>,
  credit: <><path d="M6 4h14l6 6v18H6Z M20 4v7h6M10 21v-4m5 4v-8m5 8v-5"/></>,
  commerce: <><path d="M4 11h23l-6-6M28 21H5l6 6"/><path d="M7 7 4 11l4 4m17 2 3 4-4 4"/></>,
  asset: <><path d="m16 3 12 7v13l-12 7-12-7V10Z M4 10l12 7 12-7M16 17v13M10 6l12 7"/></>,
  jianwei: <><path d="M3 16s5-9 13-9 13 9 13 9-5 9-13 9S3 16 3 16Z"/><circle cx="16" cy="16" r="4"/></>,
  board: <><rect x="4" y="4" width="10" height="10" rx="3"/><rect x="18" y="4" width="10" height="10" rx="3"/><rect x="4" y="18" width="10" height="10" rx="3"/><rect x="18" y="18" width="10" height="10" rx="3"/></>,
  materials: <><path d="M3 10V8a3 3 0 0 1 3-3h7l3 4h10a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3Z"/><path d="M3 12h26"/></>,
  flow: <><rect x="2" y="12" width="8" height="8" rx="2"/><rect x="22" y="2" width="8" height="8" rx="2"/><rect x="22" y="22" width="8" height="8" rx="2"/><path d="M10 16h6V6h6M16 16v10h6"/></>,
  timeline: <><path d="M7 5v22M16 6h13M16 16h10M16 26h13"/><circle cx="7" cy="6" r="3"/><circle cx="7" cy="16" r="3"/><circle cx="7" cy="26" r="3"/></>,
  search: <><circle cx="13" cy="13" r="9"/><path d="m20 20 9 9"/></>,
  plus: <path d="M16 5v22M5 16h22"/>,
  back: <path d="m20 6-10 10 10 10"/>, arrow: <path d="M5 16h22m-9-9 9 9-9 9"/>,
  close: <path d="m8 8 16 16M24 8 8 24"/>, expand: <path d="M12 4H4v8m16-8h8v8M4 20v8h8m16-8v8h-8"/>,
  file: <><path d="M7 3h12l7 7v19H7Z M19 3v8h7M12 17h9M12 22h7"/></>,
  check: <path d="m5 16 7 7L27 8"/>, upload: <><path d="M16 22V3m-7 7 7-7 7 7M4 21v7h24v-7"/></>,
  lock: <><rect x="7" y="14" width="18" height="15" rx="4"/><path d="M11 14V9a5 5 0 0 1 10 0v5M16 20v3"/></>,
  wrench: <path d="M28 5a9 9 0 0 1-11 12L8 27a3 3 0 0 1-4-4l10-9A9 9 0 0 1 26 3l-6 6 3 3Z"/>,
};
export function UiIcon({ name, size = 24, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg className="tk-ui-icon" width={size} height={size} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>{paths[name]}</svg>;
}

export function RoleLogo({ role, size = 32 }: { role: string; size?: number }) {
  const name = (Object.hasOwn(paths, role) ? role : 'business') as IconName;
  return <span className={`tk-role-logo ${role}`}>{name === 'jianwei' ? <UiIcon name={name} size={size}/> : <ObjectIcon name={name === 'opportunity' ? 'business' : name} size={size}/>}</span>;
}

export function ObjectIcon({ name, size = 36 }: { name: string; size?: number }) {
  return <img className="tk-object-icon" src={`/objects/${name}-v1.png`} width={size} height={size} alt="" aria-hidden="true" draggable={false}/>;
}
