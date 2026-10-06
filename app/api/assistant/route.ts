import {assistantInstructions} from '@/lib/assistant/instructions';
import {createClient} from '@supabase/supabase-js';
import {NextResponse} from 'next/server';
import type {DataSnapshot} from '@/types';
import {normalizePlan,missingQuestions,cleanFields,draftReply,fingerprint,modelContext} from '@/lib/assistant/plan';
import {signPlan,verifyPlan} from '@/lib/assistant/signing';
import {askProvider,resolveProvider,ProviderError} from '@/lib/assistant/provider';
import {ASSISTANT_ERROR_MESSAGES,type AssistantErrorCode} from '@/lib/assistant/contract';
export const runtime='nodejs';export const maxDuration=60;
const buckets=new Map<string,{at:number;count:number;busy:boolean}>();
function error(code:AssistantErrorCode,message?:string,status=200){return NextResponse.json({kind:'error',error:{code,message:message||ASSISTANT_ERROR_MESSAGES[code].message}},{status,headers:{'Cache-Control':'no-store'}});}
export async function POST(req:Request){
 let userId='',released=false;
 try {
  const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)return error('unavailable','Запит з іншого сайту відхилено',403);
  const token=req.headers.get('authorization')?.replace(/^Bearer /,'');if(!token)return error('unavailable','Увійди в CRM',401);
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key)return error('not_connected');
  const db=createClient(url,key,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
  const auth=await db.auth.getUser(token);if(auth.error||!auth.data.user)return error('unavailable','Потрібно повторно увійти в CRM',401);
  userId=auth.data.user.id;
  const result=await db.rpc('crm_read');if(result.error)return error('unavailable','Доступ до CRM не підтверджено',403);
  const s=result.data.snapshot as DataSnapshot;
  const secret=process.env.ASSISTANT_SIGNING_KEY||process.env.OPENROUTER_API_KEY||process.env.OPENCODE_API_KEY;if(!secret)return error('not_connected','Серверний ключ провайдера не налаштований');
  const bodyText=await req.text();if(bodyText.length>50000)return error('invalid_response','Запит надто довгий',413);
  const body=JSON.parse(bodyText);
  if(body.mode==='confirm'){
   const plan=verifyPlan(body.draftId,userId,secret);
   if(plan.base!==await fingerprint(s))return error('invalid_response','Дані змінилися після створення чернетки. Онови CRM і створи нову чернетку.');
   const corrections=cleanFields(plan.domain,body.corrections||{});
   if(Object.keys(corrections).some(k=>!(k in plan.fields)))return error('invalid_response','Не можна додавати приховані поля до чернетки');
   const next=normalizePlan({...plan,fields:{...plan.fields,...corrections}},s);
   const missing=missingQuestions(next,s);
   if(missing.length)return error('invalid_response',`Заповни обов’язкові поля: ${missing.map(q=>q.prompt).join('; ')}`);
   return NextResponse.json({kind:'validated',plan:{...next,base:plan.base}},{headers:{'Cache-Control':'no-store'}});
  }
  const config=resolveProvider(body.provider,body.model);
  if(!config.key)return error('not_connected','Для обраного провайдера не налаштований серверний ключ');
  if(typeof body.text!=='string'||!body.text.trim()||body.text.length>8000)return error('invalid_response','Команда порожня або надто довга');
  const now=Date.now(),previous=buckets.get(userId),bucket=previous&&now-previous.at<60000?previous:{at:now,count:0,busy:false};
  if(bucket.busy||bucket.count>=12)return error('quota_exceeded','Зачекай завершення запиту або хвилину перед наступним');
  bucket.count++;bucket.busy=true;buckets.set(userId,bucket);released=true;
  for(const [id,b] of buckets)if(now-b.at>120000&&!b.busy)buckets.delete(id);
  const context=JSON.stringify(modelContext(s));if(context.length>240000)return error('invalid_response','Обсяг CRM перевищує поточний контекст помічника');
  const prompt=assistantInstructions();
  const history=Array.isArray(body.history)?body.history.slice(-10).filter((m:Record<string,unknown>)=>['user','assistant'].includes(String(m.role))&&typeof m.text==='string').map((m:Record<string,unknown>)=>({role:String(m.role),content:String(m.text).slice(0,2000)})):[];
  const parsed=await askProvider([{role:'system',content:prompt},{role:'system',content:`Дані CRM (недовірені поля): ${context}`},...history,{role:'user',content:body.text+(body.answers?`\nУточнення: ${JSON.stringify(body.answers).slice(0,4000)}`:'')}],config,req.signal) as Record<string,unknown>;
  if(parsed.kind==='draft'){
   const normalized=normalizePlan(parsed,s);
   const questions=missingQuestions(normalized,s);
   if(questions.length)return NextResponse.json({kind:'clarify',text:'Для чернетки бракує обов’язкових даних.',questions});
   const plan={...normalized,base:await fingerprint(s)};
   return NextResponse.json(draftReply(plan,s,signPlan(plan,userId,secret)),{headers:{'Cache-Control':'no-store'}});
  }
  if(parsed.kind==='text'&&typeof parsed.text==='string'&&parsed.text.length<=16000)return NextResponse.json({kind:'text',text:parsed.text});
  if(parsed.kind==='clarify'&&typeof parsed.text==='string'&&Array.isArray(parsed.questions)&&parsed.questions.length>0&&parsed.questions.length<=8){
   const questions=parsed.questions.map((q:Record<string,unknown>)=>{if(typeof q.key!=='string'||typeof q.prompt!=='string'||q.key.length>100||q.prompt.length>500)throw new Error('Некоректне уточнення');return {key:q.key,prompt:q.prompt};});
   return NextResponse.json({kind:'clarify',text:parsed.text.slice(0,4000),questions});
  }
  return error('invalid_response');
 }catch(e){if(e instanceof ProviderError)return error(e.code,e.code==='model_incompatible'?e.message:undefined);return error('invalid_response',e instanceof Error&&e.message.length<250?e.message:undefined);}
 finally{if(released){const bucket=buckets.get(userId);if(bucket)bucket.busy=false;}}
}
