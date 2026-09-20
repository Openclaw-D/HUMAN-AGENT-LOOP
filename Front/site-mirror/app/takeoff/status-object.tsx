import { useEffect, useState } from 'react';

export type StatusObjectKind = 'lock' | 'wrench' | 'check' | 'cross';
type Transition = 'unlock' | 'finish' | 'fail' | null;
let unlockImagesPreloaded = false;

/** Presentation only: the caller's real state is authoritative throughout every animation. */
export function StatusObject({ kind, size = 82, animate = true }: { kind: StatusObjectKind; size?: number; animate?: boolean }) {
  const [visual, setVisual] = useState<{ kind: StatusObjectKind; transition: Transition; from?: StatusObjectKind }>({ kind, transition: null });
  useEffect(() => {
    if (unlockImagesPreloaded || typeof Image === 'undefined') return;
    unlockImagesPreloaded = true;
    for (const name of ['key', 'open-lock', 'wrench']) {
      const image = new Image();
      image.src = `/status/${name}-v1.png`;
    }
  }, []);
  if (visual.kind !== kind) {
    setVisual({ kind, from: visual.kind, transition: !animate ? null : kind === 'check' ? 'finish' : kind === 'cross' ? 'fail' : visual.kind === 'lock' && kind === 'wrench' ? 'unlock' : null });
  }
  useEffect(() => {
    if (!visual.transition) return;
    const timer = setTimeout(() => setVisual((value) => value === visual ? { ...value, transition: null } : value), visual.transition === 'unlock' ? 1800 : 800);
    return () => clearTimeout(timer);
  }, [visual]);
  const transition = animate ? visual.transition : null;
  return <span className={`tk-status-scene ${kind}${animate ? '' : ' still'}${transition ? ` is-${transition}` : ''}`} style={{ width: size, height: size }} aria-hidden="true" data-state={kind} data-transition={transition ?? undefined}>
    {kind === 'wrench' && <span className="tk-status-bolt" />}
    <img className={`tk-status-object ${kind}`} src={`/status/${kind}-v1.png`} width={size} height={size} alt="" draggable={false} />
    {(transition === 'finish' || transition === 'fail') && visual.from && <img className="tk-status-depart" src={`/status/${visual.from}-v1.png`} alt="" draggable={false}/>}
    {transition === 'unlock' && <>
      <img className="tk-unlock-closed" src="/status/lock-v1.png" alt="" draggable={false}/>
      <img className="tk-unlock-open" src="/status/open-lock-v1.png" alt="" draggable={false}/>
      <img className="tk-unlock-key" src="/status/key-v1.png" alt="" draggable={false}/>
    </>}
    {transition === 'finish' && <span className="tk-check-shine" />}
  </span>;
}
