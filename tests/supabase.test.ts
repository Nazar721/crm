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


test('remote write error preserves safe diagnostic code and blocks a second write',async()=>{
 for(const status of [401,403,503]){
 let commits=0;
 const rpc=async(name:string)=>name==='crm_read'
 ? {data:{revision:0,snapshot:emptySnapshot()},error:null,status:200}
 : (++commits,{data:null,error:{message:'private SQL or token must not leak',code:'PGRST_TEST'},status});
 const source=new SupabaseDataSource(rpc);await source.load();
 const result=await source.saveCollection('clients',[makeClient()]);assert.equal(result.ok,false);
 assert.match(source.writeBlockedReason()!,new RegExp('HTTP '+status));assert.match(source.writeBlockedReason()!,/PGRST_TEST/);
 assert.ok(!source.writeBlockedReason()!.includes('private SQL'));assert.match(source.listIssues()[0].key!,/crm_commit/);
 await source.saveCollection('clients',[]);assert.equal(commits,1);
 }
});
test('lost response may follow successful commit: never automatically resend; reload reveals saved data',async()=>{
  let saved=emptySnapshot(),revision=0,commits=0;
  const rpc=async(name:string,args?:Record<string,unknown>)=>{
  if(name==='crm_read')return {data:{revision,snapshot:structuredClone(saved)},error:null};
  commits++;saved=structuredClone(args!.p_snapshot as typeof saved);revision++;throw new Error('connection lost after commit');
  };
  const source=new SupabaseDataSource(rpc);await source.load();const client=makeClient();
  assert.equal((await source.saveCollection('clients',[client])).ok,false);assert.ok(source.writeBlockedReason());
  await source.saveCollection('clients',[client]);assert.equal(commits,1);
  const loaded=await source.load();assert.equal(loaded.data.clients[0].id,client.id);assert.equal(source.writeBlockedReason(),null);
});

// ------------------------------------------------------------
// Рев'ю P1: старий сервер без нових колекцій — безпечне UI-подання,
// блок запису без commit, розблокування лише після reload.
// ------------------------------------------------------------

function oldDatabase(initial: unknown, revision = 7) {
  let current = { revision, snapshot: structuredClone(initial) };
  let commits = 0;
  const rpc = async (name: string, args?: Record<string, unknown>) => {
    if (name === 'crm_read') return { data: structuredClone(current), error: null };
    commits++;
    current = { revision: ++current.revision, snapshot: structuredClone(args!.p_snapshot as never) };
    return { data: current.revision, error: null };
  };
  return {
    rpc,
    get commits() { return commits; },
    get snapshot() { return current.snapshot as Record<string, unknown>; },
    set serverSnapshot(next: unknown) { current = { revision: current.revision + 1, snapshot: structuredClone(next) }; },
  };
}

test('P1: старий сервер без plannedProjects — UI-масив, блок без commit, розблокування після reload', async () => {
  clearAll();
  const old = emptySnapshot() as unknown as Record<string, unknown>;
  delete old.plannedProjects;
  const client = makeClient();
  old.clients = [client];
  const db = oldDatabase(old);
  await store.initStore(new SupabaseDataSource(db.rpc));

  assert.deepEqual(store.getSnapshot().plannedProjects, [], 'відсутня колекція → порожній масив для UI');
  assert.equal(store.getSnapshot().clients.length, 1, 'наявні дані не змінені');
  const block = store.getWriteBlock();
  assert.ok(block);
  assert.match(block!, /plannedProjects/);
  assert.match(block!, /006-planned-projects\.sql/);
  assert.ok(!block!.includes('004'), 'не стверджує відсутність 004, якщо хостинг є');
  assert.ok(!block!.includes('005'), 'не стверджує відсутність 005, якщо tasks є');
  assert.ok(!block!.includes('SETUP'), 'не радить запускати SETUP повторно');
  assert.deepEqual(store.getUnsupportedCollections(), { missing: ['plannedProjects'], wrongType: [] });

  const commitsBefore = db.commits;
  const write = await store.saveCollection('clients', [makeClient({ name: 'blocked' })]);
  assert.equal(write.ok, false, 'запис заблоковано');
  assert.equal(db.commits, commitsBefore, 'commit не викликано під блоком');
  assert.equal((db.snapshot.clients as unknown[]).length, 1, 'дані сервера не змінені');

  // Міграцію застосовано: сервер відповідає повним snapshot → reload знімає блок
  db.serverSnapshot = { ...emptySnapshot(), clients: [client], plannedProjects: [{ id: 'pp1', name: 'Після міграції', category: 'IT', clientName: 'X' }] };
  await store.reloadStore();
  assert.equal(store.getWriteBlock(), null, 'блок знімається після сумісної відповіді');
  assert.equal(store.getUnsupportedCollections(), null);
  assert.equal(store.getSnapshot().plannedProjects.length, 1);
  assert.equal((await store.saveCollection('clients', [makeClient({ name: 'after' })])).ok, true, 'запис знову дозволений');
});

test('P1: старий сервер без усіх нових колекцій — точний перелік колекцій і міграцій', async () => {
  clearAll();
  const old = emptySnapshot() as unknown as Record<string, unknown>;
  delete old.hostingServices;
  delete old.hostingPayments;
  delete old.tasks;
  delete old.plannedProjects;
  const db = oldDatabase(old);
  await store.initStore(new SupabaseDataSource(db.rpc));
  const block = store.getWriteBlock()!;
  for (const key of ['hostingServices', 'hostingPayments', 'tasks', 'plannedProjects']) {
    assert.ok(block.includes(key), `блок називає ${key}`);
  }
  for (const mig of ['004-hosting.sql', '005-tasks.sql', '006-planned-projects.sql']) {
    assert.ok(block.includes(mig), `блок називає ${mig}`);
  }
  assert.ok(!block.includes('SETUP'), 'не радить запускати SETUP повторно');
  assert.deepEqual(store.getSnapshot().hostingServices, []);
  assert.deepEqual(store.getSnapshot().hostingPayments, []);
  assert.deepEqual(store.getSnapshot().tasks, []);
  assert.deepEqual(store.getSnapshot().plannedProjects, []);
  assert.deepEqual(
    [...store.getUnsupportedCollections()!.missing].sort(),
    ['hostingPayments', 'hostingServices', 'plannedProjects', 'tasks'],
  );
});

test('P1: неправильний тип колекції — окрема помилка даних, блок, сире значення без втрати', async () => {
  clearAll();
  const bad = emptySnapshot() as unknown as Record<string, unknown>;
  bad.tasks = 'corrupt-string';
  const db = oldDatabase(bad);
  const source = new SupabaseDataSource(db.rpc);
  const payload = await source.load();
  assert.deepEqual(payload.unsupported!.wrongType, ['tasks']);
  assert.equal(payload.corruptRaw.tasks, JSON.stringify('corrupt-string'), 'сире значення збережено для перевірки');
  assert.deepEqual(payload.data.tasks, [], 'UI отримує порожній масив');
  assert.match(source.writeBlockedReason()!, /tasks/);
  assert.match(source.writeBlockedReason()!, /некоректні/);
  assert.ok(source.listIssues().length > 0, 'неправильний тип зафіксовано issue');

  await store.initStore(new SupabaseDataSource(db.rpc));
  assert.deepEqual(store.getSnapshot().tasks, []);
  const commitsBefore = db.commits;
  assert.equal((await store.saveCollection('tasks', [])).ok, false, 'запис заблоковано');
  assert.equal(db.commits, commitsBefore, 'commit не викликано');
  assert.deepEqual(store.getUnsupportedCollections()!.wrongType, ['tasks']);
});
