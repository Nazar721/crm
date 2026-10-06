import {requestWithSession} from './session-request';
import type {AssistantTransport,AssistantReply,AssistantConfirmResult,AssistantConfirmRequest,AssistantSendRequest,AssistantClarifyRequest} from './contract';
import {supabase} from '@/lib/supabase/client';
import {executePlan} from './executor';
import type {Plan} from './plan';
const request=(body:unknown,signal?:AbortSignal)=>requestWithSession(supabase().auth,body,signal);
const failure=(e:unknown):AssistantReply=>({kind:'error',error:{code:e instanceof Error&&e.name==='AbortError'?'cancelled':'unavailable',message:e instanceof Error&&e.message==='Увійди в CRM'?e.message:'Запит не завершено. Спробуй ще раз.',hint:e instanceof Error&&e.message==='Увійди в CRM'?'Онови сторінку та увійди в CRM повторно.':undefined}});
export function createRemoteTransport():AssistantTransport {
 let confirming=false;
 const send=async(r:AssistantSendRequest|AssistantClarifyRequest,signal?:AbortSignal):Promise<AssistantReply>=>{try{return await request({...r,mode:'send'},signal) as AssistantReply;}catch(e){return failure(e);}};
 return {id:'remote',label:'Серверне підключення',send,clarify:send,cancel(){},async confirm(r:AssistantConfirmRequest,signal):Promise<AssistantConfirmResult>{
  if(confirming)return {kind:'error',error:{code:'unavailable',message:'Підтвердження вже виконується'}};
  confirming=true;
  try{
   const result=await request({...r,mode:'confirm'},signal) as {kind:string;plan:Plan};
   if(result.kind!=='validated')return result as unknown as AssistantConfirmResult;
   if(signal?.aborted)return failure(new DOMException('Cancelled','AbortError')) as AssistantConfirmResult;
   return await executePlan(result.plan);
  }catch(e){return failure(e) as AssistantConfirmResult;}finally{confirming=false;}
 }};
}
