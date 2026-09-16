import { defineSuite, runSuite } from 'file:///C:/Users/22673/Desktop/Anthropic/V7/backend-next/D/harness/runner.mjs';
const s = defineSuite('mini_zero', [{id:'M-1',title:'zero',fn:async(ctx)=>{await ctx.sleep(10);}}]);
runSuite(s, import.meta.url);
