import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelTransport, buildModelRequest } from '../src/transport/glm.mjs';
import { routeAssistantQuestion } from '../../Edge/src/assistant-route.mjs';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('configured router sends Flash and Pro bodies without a fallback request', async () => {
  const previous = globalThis.fetch;
  const sent=[];
  globalThis.fetch=async(_url,options)=>{
    const body=JSON.parse(options.body); sent.push(body);
    return new Response(JSON.stringify({model:body.model,choices:[{finish_reason:'stop',message:{content:'{"observations":["ok"],"questions":[]}'}}],usage:{prompt_tokens:10,completion_tokens:5}}),{status:200,headers:{'content-type':'application/json'}});
  };
  try {
    const transport=createModelTransport({mode:'real',real:{endpoint:'https://api.deepseek.com/chat/completions',model:'deepseek-v4-pro',apiKey:'TEST_ONLY',outboundAllow:['https://api.deepseek.com'],maxOutputTokens:2000,routing:{strategy:'deepseek-flash-pro-v1',flashModel:'deepseek-flash',proModel:'deepseek-v4-pro'}}});
    const input={runId:'r',stepId:'s',attempt:1,role:'business',purpose:'auxiliary_review',projectId:'p',factVersion:'1',evidenceRefs:[]};
    const a=await transport.complete(buildModelRequest({...input,routeClass:'simple'}).request);
    const b=await transport.complete(buildModelRequest({...input,routeClass:'complex'}).request);
    assert.equal(a.status,'succeeded');assert.equal(b.status,'succeeded');
    assert.deepEqual(sent.map(s=>[s.model,s.thinking.type,s.reasoning_effort??null]),[['deepseek-flash','disabled',null],['deepseek-v4-pro','enabled','low']]);
    assert.deepEqual(sent.map(s=>s.response_format??null),[{type:'json_object'},null]);
    assert.deepEqual(sent.map(s=>s.max_tokens),[500,2000]);
    assert.equal(sent.length,2);
  } finally {globalThis.fetch=previous;}
});

test('Flash-only route sends complex class to Flash without Pro fallback', async () => {
  const previous=globalThis.fetch;const sent=[];
  globalThis.fetch=async(_url,options)=>{const body=JSON.parse(options.body);sent.push(body);return new Response(JSON.stringify({model:body.model,choices:[{finish_reason:'stop',message:{content:'{"observations":["核验材料"],"questions":[]}'}}],usage:{prompt_tokens:10,completion_tokens:5}}),{status:200});};
  try{
    const t=createModelTransport({mode:'real',real:{endpoint:'https://api.deepseek.com/chat/completions',model:'deepseek-flash',apiKey:'TEST',outboundAllow:['https://api.deepseek.com'],maxOutputTokens:900,routing:{strategy:'deepseek-flash-only-v1',flashModel:'deepseek-flash',flashMaxOutputTokens:700}}});
    const {request}=buildModelRequest({runId:'r',stepId:'complex',attempt:1,role:'credit',purpose:'auxiliary_review',projectId:'p',factVersion:'1',evidenceRefs:[],routeClass:'flash-only'});
    const r=await t.complete(request);
    assert.equal(r.status,'succeeded');
    assert.deepEqual(sent.map(s=>[s.model,s.thinking.type,s.max_tokens]),[['deepseek-flash','disabled',700]]);
    assert.deepEqual(sent[0].response_format,{type:'json_object'});
  }finally{globalThis.fetch=previous;}
});

test('question router sends only explicit trivial and short extraction tasks to Flash', () => {
  assert.equal(routeAssistantQuestion({question:'1是不是等于1？'}), 'simple');
  assert.equal(routeAssistantQuestion({question:'请提取公司名称', context:{evidencePack:{snippets:[{},{}]}}}), 'simple');
  for(const question of ['1848万元是否超过5000万元？','请预测违约概率','批准这笔融资吗？','普通提问'])
    assert.equal(routeAssistantQuestion({question}), 'complex');
  assert.equal(routeAssistantQuestion({question:'请提取名称',context:{decisionTask:{taskKind:'next_action'}}}), 'complex');
});

test('route class is part of payload hash and legacy identity is unchanged', () => {
  const base={runId:'r',stepId:'s',attempt:1,role:'business',purpose:'auxiliary_review',projectId:'p',factVersion:'1',evidenceRefs:[]};
  const legacy=buildModelRequest(base), simple=buildModelRequest({...base,routeClass:'simple'});
  assert.equal('routeClass' in legacy.request,false);
  assert.notEqual(legacy.payloadHash,simple.payloadHash);
  assert.equal(simple.request.routeClass,'simple');
});

test('non-DeepSeek endpoint and unknown route strategy fail before outbound', () => {
  const config={mode:'real',real:{endpoint:'https://example.test/chat/completions',model:'deepseek-v4-pro',routing:{strategy:'deepseek-flash-pro-v1',flashModel:'deepseek-flash',proModel:'deepseek-v4-pro'}}};
  assert.throws(()=>createModelTransport(config),/route endpoint/);
  assert.throws(()=>createModelTransport({mode:'real',real:{...config.real,routing:{strategy:'other'}}}),/strategy/);
});

test('Pro route rejects inadequate output budget before outbound', () => {
  assert.throws(()=>createModelTransport({mode:'real',real:{endpoint:'https://api.deepseek.com/chat/completions',model:'deepseek-v4-pro',maxOutputTokens:140,routing:{strategy:'deepseek-flash-pro-v1',flashModel:'deepseek-flash',proModel:'deepseek-v4-pro'}}}),/2000/);
});

test('routing config changes receipt identity without exposing credential', async () => {
  const {modelConfigHash}=await import('../../Edge/src/assistant-receipts.mjs');
  const real={endpoint:'https://api.deepseek.com/chat/completions',model:'deepseek-v4-pro',apiKey:'SECRET',routing:{strategy:'deepseek-flash-pro-v1',flashModel:'deepseek-flash',proModel:'deepseek-v4-pro'}};
  const a=modelConfigHash({mode:'real',real},2000,6000);
  const b=modelConfigHash({mode:'real',real:{...real,routing:undefined}},2000,6000);
  assert.notEqual(a,b);
  assert.equal(a.includes('SECRET'),false);
});

test('Edge resolves a named environment key without putting it in config or status', async () => {
  const dir=await mkdtemp(path.join(tmpdir(),'jw-deepseek-config-'));
  const file=path.join(dir,'config.json');
  const name='JW_DEEPSEEK_ROUTING_TEST_KEY';
  const old=process.env[name];
  try{
    await writeFile(file,JSON.stringify({transport:{mode:'real',real:{endpoint:'https://api.deepseek.com/chat/completions',model:'deepseek-v4-pro',apiKeyEnv:name,maxOutputTokens:2000,outboundAllow:['https://api.deepseek.com'],routing:{strategy:'deepseek-flash-pro-v1',flashModel:'deepseek-flash',proModel:'deepseek-v4-pro'}}}}));
    const {createAssistantModel}=await import('../../Edge/src/assistant-model.mjs');
    await assert.rejects(()=>createAssistantModel({configPath:file}),/apiKeyEnv/);
    process.env[name]='TEST_SECRET_NEVER_LOG';
    const model=await createAssistantModel({configPath:file});
    assert.equal(model.configured,true);
    assert.equal(JSON.stringify(model.status()).includes('TEST_SECRET'),false);
    assert.equal((await readFile(file,'utf8')).includes('TEST_SECRET_NEVER_LOG'),false);
  }finally{if(old===undefined)delete process.env[name];else process.env[name]=old;await rm(dir,{recursive:true,force:true});}
});
