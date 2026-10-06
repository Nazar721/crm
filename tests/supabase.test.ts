import './setup';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SupabaseDataSource} from '@/lib/datasource/supabase';
import {validateCloudBackup} from '@/lib/cloud-import';
import {applyImport} from '@/lib/importer';
import {buildExportPayload} from '@/lib/export';
import {clearAll,emptySnapshot,makeClient,makeProject,makeTransaction} from './helpers';
import * as store from '@/lib/store';
import {saveProject,completeProject} from '@/lib/actions';
function database() {
  let snap=emptySnapshot(), revision=0, commits=0, fail=false;
  const rpc=async(name:string,args?:Record<string,unknown>)=> {
    if(name==='crm_read') return {data:{revision,snapshot:structuredClone(snap)},error:null};
    commits++;
    if(fail) return {data:null,error:{message:'network'}};
    if(args?.p_revision!==revision) return {data:null,error:{message:'CRM_CONFLICT'}};
    snap=structuredClone(args.p_snapshot as typeof snap);return {data:++revision,error:null};
  };
  return {rpc,get snapshot(){return snap;},get commits(){return commits;},set fail(v:boolean){fail=v;}};
}
test('two devices: stale revision is rejected without overwriting another device',async()=>{
  const db=database(),a=new SupabaseDataSource(db.rpc),b=new SupabaseDataSource(db.rpc);
  await a.load();await b.load();assert.equal((await a.saveCollection('clients',[makeClient({name:'first'})])).ok,true);
  assert.equal((await b.saveCollection('clients',[makeClient({name:'stale'})])).ok,false);
  assert.equal(db.snapshot.clients[0].name,'first');assert.ok(b.writeBlockedReason());
  await b.load();assert.equal(b.writeBlockedReason(),null);
});
test('client and project are persisted in one atomic remote commit',async()=>{
  clearAll();const db=database();await store.initStore(new SupabaseDataSource(db.rpc));
  const result=await saveProject(makeProject({clientName:'new client'}));
  assert.equal(result.ok,true);assert.equal(db.commits,1);assert.equal(db.snapshot.clients.length,1);assert.equal(db.snapshot.projectsActive.length,1);
});
test('failure leaves client and project unchanged, UI snapshot rolled back',async()=>{
  clearAll();const db=database();await store.initStore(new SupabaseDataSource(db.rpc));db.fail=true;
  const result=await saveProject(makeProject({clientName:'new client'}));assert.equal(result.ok,false);
  assert.equal(db.snapshot.clients.length,0);assert.equal(store.getSnapshot().clients.length,0);assert.equal(store.getSnapshot().projectsActive.length,0);
});
test('completing project atomically moves it between both collections',async()=>{
  clearAll();const db=database();await store.initStore(new SupabaseDataSource(db.rpc));const p=makeProject();await store.saveCollection('projectsActive',[p]);
  const before=db.commits;assert.equal((await completeProject(p.id)).ok,true);assert.equal(db.commits-before,1);assert.equal(db.snapshot.projectsActive.length,0);assert.equal(db.snapshot.projectsCompleted[0].id,p.id);
});
test('legacy bank missing: retained without fabricated account or dropped row',()=>{
  const snap=emptySnapshot();snap.transactions=[makeTransaction({bank:''})];const raw=buildExportPayload(snap);const before=JSON.stringify(raw);
  const validation=validateCloudBackup(raw);assert.equal(validation.ok,true);assert.deepEqual(validation.content?.transactions,raw.data.transactions);assert.equal(JSON.stringify(raw),before);assert.ok(validation.warnings.some(w=>w.message.includes('без рахунку')));
});
test('cloud import rejects duplicate IDs and invalid values instead of skipping',()=>{
  const snap=emptySnapshot(),c=makeClient();snap.clients=[c,c];assert.equal(validateCloudBackup(buildExportPayload(snap)).ok,false);
  snap.clients=[];snap.transactions=[makeTransaction({amount:-2})];assert.equal(validateCloudBackup(buildExportPayload(snap)).ok,false);
});

test('cloud full import preserves legacy fields and writes all collections once',async()=>{
  clearAll();const db=database();await store.initStore(new SupabaseDataSource(db.rpc));
  const incoming=emptySnapshot();incoming.clients=[makeClient()];incoming.transactions=[makeTransaction({bank:''})];
  const raw=buildExportPayload(incoming);const report=await applyImport(raw);
  assert.equal(report.ok,true);assert.equal(db.commits,1);assert.deepEqual(db.snapshot.clients,raw.data.clients);assert.deepEqual(db.snapshot.transactions,raw.data.transactions);
  const previous=JSON.parse(localStorage.getItem('crm_import_previous')!);assert.equal(previous.payload.data.clients.length,0);
});
test('cloud rejects legacy-flat input instead of returning missing content',()=>{
  assert.equal(validateCloudBackup(emptySnapshot()).ok,false);
});
