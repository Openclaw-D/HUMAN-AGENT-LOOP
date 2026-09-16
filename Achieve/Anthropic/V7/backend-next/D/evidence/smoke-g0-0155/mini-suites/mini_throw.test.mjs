import { defineSuite, runSuite } from 'file:///C:/Users/22673/Desktop/Anthropic/V7/backend-next/D/harness/runner.mjs';
const s = defineSuite('mini_throw', [{id:'M-1',title:'throw',fn:async(ctx)=>{throw new Error('boom-intentional');}}]);
runSuite(s, import.meta.url);
