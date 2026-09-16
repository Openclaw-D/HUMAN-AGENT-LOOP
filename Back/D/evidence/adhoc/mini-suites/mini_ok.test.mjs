import { defineSuite, runSuite } from 'file:///C:/Users/22673/Desktop/JW/Back/D/harness/runner.mjs';
const s = defineSuite('mini_ok', [{id:'M-1',title:'ok',fn:async(ctx)=>{ctx.assert.eq(1,1);ctx.assert.ok(true);}}]);
runSuite(s, import.meta.url);
