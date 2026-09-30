import { useEffect, useRef, useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import type { TakeoffSource } from '../../lib/workbench/takeoff-projection';
import { composeAssistantSuggestions, composeCaseExplanation } from '../../lib/workbench/takeoff-assistant-brief';
import { AssistantObservationPanel } from './assistant-observation';
import { RoleLogo } from './ui-icons';

const ASSISTANTS = [
  { id: 'business', name: '业务' }, { id: 'policy', name: '政策' },
  { id: 'credit', name: '信审' }, { id: 'commerce', name: '商务' },
  { id: 'asset', name: '资产' }, { id: 'jianwei', name: '见微' },
] as const;
type AssistantId = (typeof ASSISTANTS)[number]['id'];

export function TakeoffAssistants({ wb, customerId, source, focusAssistant, onOpenMaterials }: {
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
  // 助手上下文与建议提问：只读；点击建议=填入输入框，由用户确认发送，不推进业务。
  const customerName = wb.snapshot?.customer?.displayName ?? '当前客户';
  const assistantName = ASSISTANTS.find(item => item.id === assistant)?.name ?? '助手';
  const suggestions = composeAssistantSuggestions(assistant, source);
  return <div className="tk-right tk-chat-panel">
    <div className="tk-asst-tabs" role="tablist" aria-label="聊天助手">
      {ASSISTANTS.map(item => <button key={item.id} role="tab" aria-label={item.name}
        aria-selected={assistant === item.id} className="tk-asst-tab" title={`${item.name}助手`}
        onPointerDown={() => { cancelHold(); hold.current = setTimeout(() => setMention({id:item.id,nonce:Date.now()}), 500); }} onPointerUp={cancelHold} onPointerCancel={cancelHold} onPointerLeave={cancelHold} onContextMenu={e => { e.preventDefault(); setMention({id:item.id,nonce:Date.now()}); }} onClick={() => setAssistant(item.id)}><RoleLogo role={item.id} size={36}/></button>)}
    </div>
    <div className="tk-asst-context" aria-label="助手上下文">
      <strong>{customerName}</strong>
      <span>{assistantName}助手 · 绑定当前客户与专业 · 回答只读，不代替人工确认</span>
    </div>
    <AssistantObservationPanel key={`${wb.session?.sessionId}:${customerId}`} wb={wb} assistant={assistant} chat defaultToAssistant mention={mention} onOpenMaterials={onOpenMaterials} suggestions={suggestions}
      explainCase={(target) => composeCaseExplanation(target, { ...source, customerName })}/>
  </div>;
}
