// Dev-only visual inspection: deliberately excluded from the production entry and build.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StatusObject, type StatusObjectKind } from '../site-mirror/app/takeoff/status-object';
import { ObjectIcon } from '../site-mirror/app/takeoff/ui-icons';
import '../site-mirror/app/takeoff/glass.css';
function MotionPreview() {
  const [kind, setKind] = useState<StatusObjectKind>('lock');
  const [paused, setPaused] = useState(false);
  return <main style={{ fontFamily:'system-ui', textAlign:'center', padding:36, color:'#253341', background:'#f5f7f8', minHeight:'85vh' }}>
    <h1>状态动效验收</h1><p>仅检查动画，不连接业务、不生成分析结果。</p>
    <section className={paused ? 'motion-paused' : ''} style={{ margin:'70px auto 35px', width:180 }}><StatusObject kind={kind} size={160}/></section>
    <p>{({lock:'未开始',wrench:'处理中',check:'已完成',cross:'未通过'})[kind]}</p>
    <nav style={{display:'flex',justifyContent:'center',gap:14,margin:30}}>{(['lock','wrench','check','cross'] as const).map((state)=><button key={state} onClick={()=>setKind(state)}>{({lock:'复位',wrench:'开始处理',check:'处理完成',cross:'处理失败'})[state]}</button>)}<button onClick={()=>setPaused(!paused)}>{paused?'继续动画':'暂停动画'}</button></nav>
    <section style={{display:'flex',justifyContent:'center',gap:20,flexWrap:'wrap'}}>{['materials','analysis','verify','closure','business','policy','credit','commerce','asset'].map((name)=><ObjectIcon key={name} name={name} size={68}/>)}</section>
    <style>{`.motion-paused * { animation-play-state:paused!important } button { border:1px solid #d8e0e7;background:white;border-radius:12px;padding:12px 18px;cursor:pointer }`}</style>
  </main>;
}
createRoot(document.getElementById('root')!).render(<MotionPreview/>);
