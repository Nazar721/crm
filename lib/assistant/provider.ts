import type {AssistantErrorCode} from './contract';
export class ProviderError extends Error {constructor(public code:AssistantErrorCode,message:string){super(message);}}
export const ZEN_MODEL='mimo-v2.6-flash-free';
export async function askZen(messages:{role:string;content:string}[],key:string,signal?:AbortSignal,fetcher:typeof fetch=fetch):Promise<unknown>{
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),45000);
 const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 try {
  const res=await fetcher('https://opencode.ai/zen/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:ZEN_MODEL,messages,max_tokens:2400,response_format:{type:'json_object'},temperature:0.2}),signal:controller.signal});
  if(!res.ok){
   const detail=(await res.text()).slice(0,10000);
   if(res.status===403&&detail.includes('FreeTierError'))throw new ProviderError('model_incompatible','Безкоштовна MiMo доступна лише всередині OpenCode. Прямий API-запит із CRM провайдер відхилив.');
   throw new ProviderError(res.status===401?'invalid_key':res.status===402?'insufficient_credits':res.status===429?'quota_exceeded':res.status===400||res.status===404?'model_incompatible':'unavailable','Провайдер відхилив запит');
  }
  const raw=await res.text();if(raw.length>1000000)throw new ProviderError('invalid_response','Завелика відповідь');
  const data=JSON.parse(raw);const content=data?.choices?.[0]?.message?.content;
  if(typeof content!=='string')throw new ProviderError('invalid_response','Порожня відповідь');
  return JSON.parse(content.replace(/^\s*```(?:json)?\s*/,'').replace(/\s*```\s*$/,''));
 }catch(e){if(e instanceof ProviderError)throw e;if(controller.signal.aborted)throw new ProviderError(signal?.aborted?'cancelled':'timeout','Запит перервано');throw new ProviderError('invalid_response','Не вдалося прочитати відповідь');}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
