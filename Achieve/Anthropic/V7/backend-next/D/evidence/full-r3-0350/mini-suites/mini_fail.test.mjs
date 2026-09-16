import { defineSuite, runSuite } from 'file:///C:/Users/22673/Desktop/Anthropic/V7/backend-next/D/harness/runner.mjs';
const s = defineSuite('mini_fail', [{id:'M-1',title:'fail',fn:async(ctx)=>{ctx.assert.eq(1,2,'intentional');}}]);
runSuite(s, import.meta.url);
