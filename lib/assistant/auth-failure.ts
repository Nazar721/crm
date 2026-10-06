type AuthFailure = {name?:string;code?:string;status?:number;message?:string};
/** An authentication service outage is not an expired user session. */
export function classifyAuthFailure(error:AuthFailure|null){
 const status=error?.status??0,code=error?.code??'';
 if(/api.?key/i.test(code)||/invalid api.?key/i.test(error?.message||''))return {status:503,reason:'server_configuration',message:'Сервер помічника не може підключитися до перевірки входу.',hint:'Потрібно перевірити серверні налаштування CRM. Повторний вхід цього не виправить.'};
 if(!error||error.name==='AuthSessionMissingError'||status===401||['bad_jwt','user_not_found','session_not_found','session_expired'].includes(code))return {status:401,reason:'session_rejected',message:'Потрібно повторно увійти в CRM',hint:'Відкриваємо форму входу. Увійди повторно й надішли запит.'};
 return {status:503,reason:'auth_service_unavailable',message:'Сервер не зміг перевірити вхід у CRM.',hint:'Перевірка входу тимчасово недоступна. Це не означає, що твоя сесія завершилася.'};
}
