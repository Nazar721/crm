import type {AssistantErrorCode} from './contract';
export class ProviderError extends Error {constructor(public code:AssistantErrorCode,message:string){super(message);}}
export const OPENROUTER_MODEL='openrouter/free';
export type ProviderConfig={url:string;model:string;key:string;kind:'openrouter'|'opencode'};
export function resolveProvider(provider:unknown,model:unknown):ProviderConfig {
 if(provider==='openrouter'&&model===OPENROUTER_MODEL)return {url:'https://openrouter.ai/api/v1/chat/completions',model:OPENROUTER_MODEL,key:process.env.OPENROUTER_API_KEY||'',kind:'openrouter'};
 if(provider==='opencode'&&model===ZEN_MODEL)return {url:'https://opencode.ai/zen/v1/chat/completions',model:ZEN_MODEL,key:process.env.OPENCODE_API_KEY||'',kind:'opencode'};
 throw new ProviderError('model_incompatible','Модель не дозволена. Обери OpenRouter Free; платних моделей у цьому підключенні немає.');
}
export const ZEN_MODEL='mimo-v2.6-flash-free';
export function askZen(messages:{role:string;content:string}[],key:string,signal?:AbortSignal,fetcher:typeof fetch=fetch):Promise<unknown>{
 return askProvider(messages,{url:'https://opencode.ai/zen/v1/chat/completions',model:ZEN_MODEL,key,kind:'opencode'},signal,fetcher);
}
export async function askProvider(messages:{role:string;content:string}[],config:ProviderConfig,signal?:AbortSignal,fetcher:typeof fetch=fetch):Promise<unknown>{
 const {key,model,url}=config;
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),45000);
 const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 try {
  const res=await fetcher(url,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model,messages,...(config.kind==='openrouter'?{provider:{require_parameters:true,max_price:{prompt:0,completion:0}}}:{}),max_tokens:2400,response_format:{type:'json_object'},temperature:0.2}),signal:controller.signal});
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
