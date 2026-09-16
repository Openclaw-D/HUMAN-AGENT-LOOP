import { defineSuite, runSuite } from 'file:///C:/Users/22673/Desktop/Anthropic/V7/backend-next/D/harness/runner.mjs';
const s = defineSuite('mini_blocked', [{id:'M-1',title:'blocked',fn:async(ctx)=>{ctx.blocked('nothing deployed yet');}}]);
runSuite(s, import.meta.url);
