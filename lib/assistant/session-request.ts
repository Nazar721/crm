type Session = {access_token:string};
interface SessionAuth {
 getSession():Promise<{data:{session:Session|null};error:unknown}>;
 signOut?(options:{scope:'local'}):Promise<{error:unknown}>;
 refreshSession():Promise<{data:{session:Session|null};error:unknown}>;
}
/** Retry only rejected authentication, before the server can validate or run a change. */
export async function requestWithSession(auth:SessionAuth,body:unknown,signal?:AbortSignal,fetcher:typeof fetch=fetch):Promise<unknown>{
 const initial=await auth.getSession();if(initial.error)throw new Error('Не вдалося перевірити вхід');
 if(!initial.data.session){if(!signal?.aborted)await auth.signOut?.({scope:'local'});throw new Error('Увійди в CRM');}
 const serialized=JSON.stringify(body);
 const send=(session:Session)=>fetcher('/api/assistant',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:serialized,signal});
 let res=await send(initial.data.session);
 if(res.status===401&&!signal?.aborted){
  const refreshed=await auth.refreshSession();
  if(!refreshed.error&&refreshed.data.session)res=await send(refreshed.data.session);
 }
 const result=await res.json();
 if(res.status===401&&!signal?.aborted){
  // A persistently rejected session must open CloudAccess, not trap the user in chat.
  await auth.signOut?.({scope:'local'});
  if(result.kind==='error')result.error={...result.error,hint:'Відкриваємо форму входу. Увійди в CRM повторно.'};
 }
 if(!res.ok&&result.kind!=='error')throw new Error('Не вдалося зв’язатися з сервером');
 return result;
}
