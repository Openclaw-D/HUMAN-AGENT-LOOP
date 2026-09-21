import { useEffect, useRef, useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import type { TakeoffSource } from '../../lib/workbench/takeoff-projection';
import { AssistantObservationPanel } from './assistant-observation';
import { RoleLogo } from './ui-icons';

const ASSISTANTS = [
  { id: 'business', name: '业务' }, { id: 'policy', name: '政策' },
  { id: 'credit', name: '信审' }, { id: 'commerce', name: '商务' },
  { id: 'asset', name: '资产' }, { id: 'jianwei', name: '见微' },
] as const;
type AssistantId = (typeof ASSISTANTS)[number]['id'];

export function TakeoffAssistants({ wb, customerId, focusAssistant, onOpenMaterials }: {
  wb: WbApi; customerId: string; source: TakeoffSource;
  onOpenMaterials: () => void; cellContext: string | null; focusAssistant?: string;
}) {
  const [assistant, setAssistant] = useState<AssistantId>(() => ASSISTANTS.find(item => wb.session?.roles.includes(item.id))?.id ?? 'business');
  useEffect(() => {
    const selected = ASSISTANTS.find(item => item.id === focusAssistant);
    if (selected) setAssistant(selected.id);
  }, [focusAssistant]);
  const [mention, setMention] = useState<{id: AssistantId; nonce: number} | null>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHold = () => { if (hold.current) clearTimeout(hold.current); hold.current = null; };
  useEffect(() => cancelHold, []);
  return <div className="tk-right tk-chat-panel">
    <div className="tk-asst-tabs" role="tablist" aria-label="聊天助手">
      {ASSISTANTS.map(item => <button key={item.id} role="tab" aria-label={item.name}
        aria-selected={assistant === item.id} className="tk-asst-tab" title={`${item.name}助手`}
        onPointerDown={() => { cancelHold(); hold.current = setTimeout(() => setMention({id:item.id,nonce:Date.now()}), 500); }} onPointerUp={cancelHold} onPointerCancel={cancelHold} onPointerLeave={cancelHold} onContextMenu={e => { e.preventDefault(); setMention({id:item.id,nonce:Date.now()}); }} onClick={() => setAssistant(item.id)}><RoleLogo role={item.id} size={36}/></button>)}
    </div>
    <AssistantObservationPanel key={`${wb.session?.sessionId}:${customerId}`} wb={wb} assistant={assistant} chat mention={mention} onOpenMaterials={onOpenMaterials}/>
  </div>;
}
