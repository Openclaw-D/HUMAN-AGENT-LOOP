import test from 'node:test';
import assert from 'node:assert/strict';
import {currentFacts,buildBriefing} from '../src/assistant-briefing.mjs';
test('案例说明只引用现行材料；被取代原件不再冒充当前事实',()=>{
 const snapshot={customer:{displayName:'合成演练'},artifacts:[{factKey:'revenue_annual_declared',current:false,value:{value:1600,unit:'wan'}},{factKey:'revenue_annual_declared',current:true,grade:'confirmed',value:{value:16000000,unit:'CNY'}}]};
 assert.equal(currentFacts(snapshot).length,1);
 const j=buildBriefing({snapshot,assistant:'business',question:'收入是多少'});
 assert.match(j.answer,/申报年收入：16000000 元（已核验）/);assert.equal(j.sent,false);assert.equal(j.authority,'none');
});
test('案例说明保留不同现行来源，不以最后一条覆盖冲突',()=>{
 const snapshot={artifacts:[{factKey:'equipment_deal_amount',current:true,value:{value:2980000,unit:'CNY'}},{factKey:'equipment_deal_amount',current:true,value:{value:3350000,unit:'CNY'}}]};
 const j=buildBriefing({snapshot,assistant:'asset',question:'设备价款'});
 assert.equal(currentFacts(snapshot).length,2);assert.match(j.answer,/2980000/);assert.match(j.answer,/3350000/);
});
