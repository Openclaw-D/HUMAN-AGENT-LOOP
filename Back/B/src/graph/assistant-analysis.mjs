import { StateGraph, Annotation, START, END } from '@langchain/langgraph';

/** No checkpointer replay or retry policy: the caller owns the durable send receipt. */
export async function runAssistantAnalysis(steps) {
  const State = Annotation.Root({
    outcome: Annotation({ reducer: (_, value) => value, default: () => null }),
    // prepare_evidence 节点导出的可引用宇宙（{snippets:[...]}）：后续 validate_citations 只认此集合。
    evidence: Annotation({ reducer: (_, value) => value, default: () => null }),
    trace: Annotation({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  });
  const graph = new StateGraph(State);
  const names = ['prepare_evidence', 'validate_input', 'controlled_model_call', 'validate_citations', 'check_current', 'output_receipt'];
  for (const name of names) graph.addNode(name, async state => {
    const started = performance.now();
    const update = await steps[name](state);
    return { ...update, trace: [{ node: name, elapsedMs: Math.round((performance.now() - started) * 100) / 100 }] };
  });
  graph.addEdge(START, names[0]);
  for (let i = 1; i < names.length; i++) graph.addEdge(names[i - 1], names[i]);
  graph.addEdge(names.at(-1), END);
  return graph.compile().invoke({}, { recursionLimit: 10 });
}
