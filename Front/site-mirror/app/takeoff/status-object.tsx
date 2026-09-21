import { useEffect, useState } from 'react';

export type StatusObjectKind = 'lock' | 'wrench' | 'check' | 'cross';
type Transition = 'unlock' | 'finish' | null;

/** Presentation only: real state updates immediately; the outgoing face is decorative. */
export function StatusObject({ kind, size = 82, animate = true }: { kind: StatusObjectKind; size?: number; animate?: boolean }) {
  const [visual, setVisual] = useState<{ kind: StatusObjectKind; transition: Transition; from?: StatusObjectKind }>({ kind, transition: null });
  if (visual.kind !== kind) {
    setVisual({ kind, from: visual.kind, transition: !animate ? null : visual.kind === 'lock' && kind === 'wrench' ? 'unlock' : visual.kind === 'wrench' && kind === 'check' ? 'finish' : null });
  }
  useEffect(() => {
    if (!visual.transition) return;
    const timer = setTimeout(() => setVisual(value => value === visual ? { ...value, transition: null } : value), 720);
    return () => clearTimeout(timer);
  }, [visual]);
  const transition = animate ? visual.transition : null;
  const face = (state: StatusObjectKind) => <>
    {state === 'wrench' && <span className="tk-status-bolt" />}
    <img className={`tk-status-object ${state}`} src={`/status/${state}-v1.png`} width={size} height={size} alt="" draggable={false} />
  </>;
  return <span className={`tk-status-scene ${kind}${animate ? '' : ' still'}${transition ? ' is-flip' : ''}`} style={{ width: size, height: size }} aria-hidden="true" data-state={kind} data-transition={transition ?? undefined}>
    {transition && visual.from ? <span className="tk-status-flipper" key={`${visual.from}-${kind}`}>
      <span className="tk-status-face tk-status-front">{face(visual.from)}</span>
      <span className="tk-status-face tk-status-back">{face(kind)}</span>
    </span> : face(kind)}
  </span>;
}
