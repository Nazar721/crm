import './setup';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizePlan,missingQuestions,cleanFields,fingerprint,modelContext,draftReply,type Plan} from '@/lib/assistant/plan';
import {signPlan,verifyPlan} from '@/lib/assistant/signing';
import {askZen,askProvider,parseAssistantContent,resolveProvider,ZEN_MODEL,OPENROUTER_MODEL} from '@/lib/assistant/provider';
import {SupabaseDataSource} from '@/lib/datasource/supabase';
import {executePlan} from '@/lib/assistant/executor';
import {clearAll,emptySnapshot,makeProject} from './helpers';
import * as store from '@/lib/store';
function database(){let snap=emptySnapshot(),revision=0,commits=0,fail=false;return {
 rpc:async(name:string,args?:Record<string,unknown>)=>{if(name==='crm_read')return {data:{snapshot:structuredClone(snap),revision},error:null};commits++;if(fail)return {data:null,error:{message:'network'}};if(args?.p_revision!==revision)return {data:null,error:{message:'CRM_CONFLICT'}};snap=structuredClone(args?.p_snapshot as typeof snap);return {data:++revision,error:null};},
 get snap(){return snap;},get commits(){return commits;},set fail(v:boolean){fail=v;}};}
const plan:Plan={domain:'clients',action:'create',fields:{name:'Synthetic client'},base:'test'};
test('signed draft rejects tampering, other owner and expiry',()=>{
 const key='synthetic-test-key',token=signPlan(plan,'owner',key,1000);
 assert.deepEqual(verifyPlan(token,'owner',key,1001),plan);
 assert.throws(()=>verifyPlan(token,'other',key,1001));
 assert.throws(()=>verifyPlan(token,'owner',key,1000+16*60000));
 assert.throws(()=>verifyPlan(token.replace(token[0],token[0]==='a'?'b':'a'),'owner',key,1001));
});
test('planner rejects invented IDs, prototype keys, nested values and transfers',()=>{
 const s=emptySnapshot();assert.throws(()=>normalizePlan({domain:'clients',action:'update',recordId:'invented',fields:{name:'x'}},s));
 assert.throws(()=>cleanFields('clients',JSON.parse('{"__proto__":true}')));
 assert.throws(()=>cleanFields('finance',{amount:[]}));
 assert.throws(()=>cleanFields('finance',{type:'transfer'}));
 assert.throws(()=>normalizePlan({domain:'constructor',action:'create',fields:{}},s));
});
test('fingerprint independent of key order and metadata, changes with actual records',async()=>{
 const a=emptySnapshot(),b=emptySnapshot();b.meta.lastSavedAt='new';
 b.financeSettings={...a.financeSettings};assert.equal(await fingerprint(a),await fingerprint(b));
 b.projectsActive=[makeProject()];assert.notEqual(await fingerprint(a),await fingerprint(b));
});
test('draft preparation and reports make no writes',async()=>{
 clearAll();const db=database();await store.initStore(new SupabaseDataSource(db.rpc));
 const p={...normalizePlan({domain:'clients',action:'create',fields:{name:'Synthetic'}},db.snap),base:await fingerprint(db.snap)};
 assert.equal(draftReply(p,db.snap,'signed').kind,'draft');assert.equal(modelContext(db.snap).stats.clientsCount,0);assert.equal(db.commits,0);
});
test('approval creates once; same signed state cannot execute twice',async()=>{
 clearAll();const db=database();await store.initStore(new SupabaseDataSource(db.rpc));
 const p={...plan,base:await fingerprint(store.getSnapshot())};
 assert.equal((await executePlan(p)).kind,'applied');assert.equal((await executePlan(p)).kind,'error');assert.equal(db.snap.clients.length,1);assert.equal(db.commits,1);
});
test('simultaneous confirmations of same state are serialized; only one write',async()=>{
 clearAll();const db=database();await store.initStore(new SupabaseDataSource(db.rpc));
 const p={...plan,base:await fingerprint(store.getSnapshot())};const result=await Promise.all([executePlan(p),executePlan(p)]);
 assert.deepEqual(result.map(r=>r.kind),['applied','error']);assert.equal(db.commits,1);
});
test('project payment creates linked income and increases prepayment in one commit',async()=>{
 clearAll();const db=database();await store.initStore(new SupabaseDataSource(db.rpc));
 const project=makeProject({budget:10000,prepayment:2000,currency:'UAH',clientName:'Synthetic'});await store.saveCollection('projectsActive',[project]);const before=db.commits;
 const p:Plan={domain:'payments',action:'update',recordId:project.id,fields:{amount:3000,bank:'mono',date:'2026-10-06'},base:await fingerprint(store.getSnapshot())};
 assert.equal((await executePlan(p)).kind,'applied');assert.equal(db.commits-before,1);assert.equal(db.snap.projectsActive[0].prepayment,5000);assert.equal(db.snap.transactions[0].amount,3000);assert.equal(db.snap.transactions[0].projectId,project.id);assert.equal(db.snap.clients.length,0);assert.equal(db.snap.projectsActive[0].workStartDate,project.workStartDate);
});
test('payment rejects currency mismatch and failed commit leaves both collections intact',async()=>{
 clearAll();const db=database();await store.initStore(new SupabaseDataSource(db.rpc));const project=makeProject({budget:10000,prepayment:2000,currency:'UAH',clientName:'Synthetic'});await store.saveCollection('projectsActive',[project]);
 const p:Plan={domain:'payments',action:'update',recordId:project.id,fields:{amount:3000,bank:'cash_usd',date:'2026-10-06'},base:await fingerprint(store.getSnapshot())};
 assert.equal((await executePlan(p)).kind,'error');assert.equal(db.snap.transactions.length,0);p.fields.bank='mono';db.fail=true;
 assert.equal((await executePlan(p)).kind,'error');assert.equal(db.snap.projectsActive[0].prepayment,2000);assert.equal(store.getSnapshot().projectsActive[0].prepayment,2000);assert.equal(db.snap.transactions.length,0);
});
test('provider uses only free model, parses structured reply and never falls back',async()=>{
 let calls=0;const fake=(async(_url:unknown,init:RequestInit)=>{calls++;const body=JSON.parse(String(init.body));assert.equal(body.model,ZEN_MODEL);return new Response(JSON.stringify({choices:[{message:{content:'{"kind":"text","text":"Synthetic"}'}}]}));}) as typeof fetch;
 assert.deepEqual(await askZen([{role:'user',content:'Synthetic'}],'synthetic',undefined,fake),{kind:'text',text:'Synthetic'});assert.equal(calls,1);
 const fail=(async()=>{calls++;return new Response('credits',{status:402});}) as typeof fetch;
 await assert.rejects(askZen([],'synthetic',undefined,fail),e=>(e as {code:string}).code==='insufficient_credits');assert.equal(calls,2);
});

test('free-tier denial is explained as provider restriction, not invalid key',async()=>{
  const denied=(async()=>new Response(JSON.stringify({error:{type:'FreeTierError',message:'Free tier restricted'}}),{status:403})) as typeof fetch;
  await assert.rejects(askZen([],'synthetic',undefined,denied),e=>(e as {code:string}).code==='model_incompatible');
});

test('assistant settings updates preserve other rates and display currency',async()=>{
 clearAll();const db=database();await store.initStore(new SupabaseDataSource(db.rpc));
 const before={...store.getSnapshot().financeSettings};const p:Plan={domain:'settings',action:'update',fields:{usdRate:42},base:await fingerprint(store.getSnapshot())};
 assert.equal((await executePlan(p)).kind,'applied');assert.equal(db.snap.financeSettings.usdRate,42);assert.equal(db.snap.financeSettings.usdtRate,before.usdtRate);assert.equal(db.snap.financeSettings.eurRate,before.eurRate);assert.equal(db.snap.financeSettings.displayCurrency,before.displayCurrency);
 const invalid:Plan={domain:'settings',action:'update',fields:{usdRate:0},base:await fingerprint(store.getSnapshot())};assert.equal((await executePlan(invalid)).kind,'error');assert.equal(db.snap.financeSettings.usdRate,42);
});

test('settings permissions permit only update and require no record ID',()=>{
 const s=emptySnapshot();assert.equal(normalizePlan({domain:'settings',action:'update',fields:{displayCurrency:'USD'}},s).action,'update');
 assert.throws(()=>normalizePlan({domain:'settings',action:'delete',fields:{}},s));assert.throws(()=>normalizePlan({domain:'settings',action:'create',fields:{usdRate:42}},s));
});

test('OpenRouter allows only free router, enforces zero price and parses reply',async()=>{
 let called=0;const fake=(async(url:unknown,init:RequestInit)=>{called++;assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');const body=JSON.parse(String(init.body));assert.equal(body.model,'openrouter/free');assert.deepEqual(body.provider.max_price,{prompt:0,completion:0});assert.equal(body.provider.require_parameters,true);assert.equal(body.models,undefined);return new Response(JSON.stringify({choices:[{message:{content:'{"kind":"text","text":"Synthetic"}'}}]}));}) as typeof fetch;
 const config={...resolveProvider('openrouter',OPENROUTER_MODEL),key:'synthetic'};
 assert.deepEqual(await askProvider([],config,undefined,fake),{kind:'text',text:'Synthetic'});assert.equal(called,1);
 assert.throws(()=>resolveProvider('openrouter','openrouter/auto'));assert.throws(()=>resolveProvider('custom','paid'));assert.throws(()=>resolveProvider('openrouter','openai/gpt-4o'));
});

test('missing required data triggers clarification rather than incomplete draft',()=>{
 const s=emptySnapshot();const p=normalizePlan({domain:'projects',action:'create',fields:{name:'Synthetic',type:'IT'}},s);
 assert.deepEqual(missingQuestions(p,s).map(q=>q.key),['clientName','budget']);
 const project=makeProject({bank:'mono'});s.projectsActive=[project];const payment=normalizePlan({domain:'payments',action:'update',recordId:project.id,fields:{amount:10}},s);
 assert.deepEqual(missingQuestions(payment,s).map(q=>q.key),['bank']);
});


test('natural conversation accepts plain text, JSON text and text content blocks',()=>{
 assert.deepEqual(parseAssistantContent('Привіт 🙂 Чим допомогти?'),{kind:'text',text:'Привіт 🙂 Чим допомогти?'});
 assert.deepEqual(parseAssistantContent('"Привіт"'),{kind:'text',text:'Привіт'});
 assert.deepEqual(parseAssistantContent([{type:'reasoning',text:'private'},{type:'text',text:'Мені винні 100 UAH.'}]),{kind:'text',text:'Мені винні 100 UAH.'});
 assert.deepEqual(parseAssistantContent('```json\n{"kind":"text","text":"Привіт"}\n```'),{kind:'text',text:'Привіт'});
});
test('broken, truncated or empty model responses cannot masquerade as chat or execute',()=>{
 for(const content of ['',null,'{"kind":"draft","fields":','```json\n{"kind":"draft"}'])assert.throws(()=>parseAssistantContent(content));
 assert.throws(()=>parseAssistantContent('{"kind":"draft","fields":{}}','length'));
 assert.throws(()=>parseAssistantContent('x'.repeat(16001)));
 const draft={kind:'draft',domain:'clients',action:'create',fields:{name:'Synthetic'}};assert.deepEqual(parseAssistantContent(JSON.stringify(draft)),draft);
});
test('free chat request retains JSON action format and leaves room for visible reply',async()=>{
 const fake=(async(_url:unknown,init:RequestInit)=>{const body=JSON.parse(String(init.body));assert.equal(body.max_tokens,6000);assert.deepEqual(body.reasoning,{enabled:false,exclude:true});assert.equal(body.response_format.type,'json_object');assert.equal(body.provider.max_price.completion,0);return new Response(JSON.stringify({choices:[{message:{content:'Привіт!'}}]}));}) as typeof fetch;
 assert.deepEqual(await askProvider([], {...resolveProvider('openrouter',OPENROUTER_MODEL),key:'synthetic'},undefined,fake),{kind:'text',text:'Привіт!'});
});
