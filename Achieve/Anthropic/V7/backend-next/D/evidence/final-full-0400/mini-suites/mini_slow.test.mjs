import { defineSuite, runSuite } from 'file:///C:/Users/22673/Desktop/Anthropic/V7/backend-next/D/harness/runner.mjs';
const s = defineSuite('mini_slow', [{id:'M-1',title:'slow',timeoutMs:300,fn:async(ctx)=>{await ctx.sleep(5000);}}]);
runSuite(s, import.meta.url);
