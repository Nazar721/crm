import {incomeHistory} from '@/lib/income-report';
import {accountBalances} from './balance-report';
import type {DataSnapshot} from '@/types';
import type {AssistantActionType,AssistantDomain,AssistantField,AssistantReply} from './contract';
import {BANKS} from '@/lib/banks';
import {dashboardStats,project,toDisplay} from '@/lib/calc';
import {today} from '@/lib/utils';
export type Plan={domain:AssistantDomain;action:AssistantActionType;recordId?:string;fields:Record<string,string|number|boolean|null>;base:string};
type Spec={label:string;kind:AssistantField['kind'];options?:string[]};
const text=(label:string):Spec=>({label,kind:'text'});
const number=(label:string):Spec=>({label,kind:'number'});
const select=(label:string,options:string[]):Spec=>({label,kind:'select',options});
const date=(label:string):Spec=>({label,kind:'date'});
const currency=select('Валюта',['UAH','USD','EUR','USDT']);
const bank=select('Рахунок',BANKS.map(b=>b.id));
export const schemas:Partial<Record<AssistantDomain,Record<string,Spec>>>={
 settings:{usdRate:number('Курс USD'),eurRate:number('Курс EUR'),usdtRate:number('Курс USDT'),displayCurrency:select('Валюта відображення',['UAH','USD','EUR'])},
 clients:{name:text('Ім’я клієнта'),telegram:text('Telegram'),source:text('Джерело'),isRegular:{label:'Постійний клієнт',kind:'boolean'}},
 projects:{name:text('Назва проєкту'),type:select('Тип',['IT','Design','Video']),status:select('Статус',['Очікування оплати','В роботі','На паузі','Завершено']),clientName:text('Клієнт'),clientTelegram:text('Telegram клієнта'),clientSource:text('Джерело клієнта'),budget:number('Бюджет'),currency,bank,prepayment:number('Загалом сплатив клієнт'),paidToSpecialist:number('Виплачено фахівцю'),myPercent:number('Мій %'),fop:number('ФОП %'),partnerCommission:number('Комісія партнеру %'),profitTaken:number('Забрав собі'),developerId:text('ID фахівця'),partnerId:text('ID партнера'),startDate:date('Дата початку'),endDate:date('Дата завершення'),deadlineDays:number('Дедлайн, днів'),description:text('Опис')},
 finance:{type:select('Тип',['income','expense']),amount:number('Сума у валюті рахунку'),bank,date:date('Дата'),description:text('Опис'),category:text('Категорія'),incomeStatus:select('Статус доходу',['earned','incoming']),projectId:text('ID проєкту'),hidden:{label:'Прихований у підсумках',kind:'boolean'}},
 payments:{amount:number('Додаткова оплата'),bank,date:date('Дата'),description:text('Опис')},
 specialists:{name:text('Ім’я фахівця'),specialization:text('Спеціалізація'),telegram:text('Telegram'),myShareThreshold:number('Поріг бюджету, грн'),mySharePercentUpTo:number('Відсоток до порогу, %'),mySharePercentAbove:number('Відсоток понад поріг, %')},
 partners:{name:text('Ім’я партнера'),currency,services:text('Послуги'),paidToPartner:number('Виплачено партнеру'),givenProjectsCount:number('Передано проєктів'),givenProjectsPrice:number('Ціна переданих проєктів'),ourCommission:number('Наша комісія'),paidToUs:number('Виплачено нам')},
 debts:{type:select('Тип боргу',['owed_to_me','my_debt']),person:text('Людина'),amount:number('Сума'),currency,note:text('Примітка'),date:date('Дата')},
 savings:{name:text('Назва'),bank,amount:number('Сума'),goal:number('Ціль'),currency,date:date('Дата')},
};
export function records(domain:AssistantDomain,s:DataSnapshot):Record<string,unknown>[] {
 const maps:Partial<Record<AssistantDomain,unknown[]>>={projects:[...s.projectsActive,...s.projectsCompleted],payments:[...s.projectsActive,...s.projectsCompleted],clients:s.clients,finance:s.transactions,specialists:s.specialists,partners:s.partners,debts:s.personalDebts,savings:s.savings};
 return (maps[domain]||[]) as Record<string,unknown>[];
}
function canonical(v:unknown):unknown {
 if(Array.isArray(v))return v.map(canonical);
 if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([,x])=>x!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)]));
 return v;
}
export async function fingerprint(s:DataSnapshot):Promise<string>{
 const {meta:ignored,...data}=s;void ignored;
 const bytes=new TextEncoder().encode(JSON.stringify(canonical(data)));
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function cleanFields(domain:AssistantDomain,input:unknown):Plan['fields']{
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Поля чернетки мають бути об’єктом');
 const specs=Object.prototype.hasOwnProperty.call(schemas,domain)?schemas[domain]:undefined;if(!specs)throw new Error('Ця дія поки не підтримується');
 const out:Plan['fields']={};
 for(const [key,value] of Object.entries(input)){
  const spec=Object.prototype.hasOwnProperty.call(specs,key)?specs[key]:undefined;if(!spec)throw new Error(`Непідтримуване поле: ${key}`);
  if(value===null){out[key]=null;continue;}
  if(spec.kind==='number') {if(value===''||!['string','number'].includes(typeof value)||!Number.isFinite(Number(value))||Number(value)<0)throw new Error(`Некоректне число: ${spec.label}`);out[key]=Number(value);}
  else if(spec.kind==='boolean'){if(typeof value!=='boolean')throw new Error(`Некоректний прапорець: ${spec.label}`);out[key]=value;}
  else {if(typeof value!=='string'||value.length>2000)throw new Error(`Некоректне поле: ${spec.label}`);if(spec.options&&value!==''&&!spec.options.includes(value))throw new Error(`Недопустиме значення: ${spec.label}`);out[key]=value;}
 }
 return out;
}
export function normalizePlan(raw:unknown,s:DataSnapshot):Omit<Plan,'base'>{
 if(!raw||typeof raw!=='object')throw new Error('Непридатна чернетка');
 const r=raw as Record<string,unknown>,domain=r.domain as AssistantDomain,action=r.action as AssistantActionType;
 if(!Object.prototype.hasOwnProperty.call(schemas,domain)||!['create','update','delete'].includes(action))throw new Error('Непідтримувана дія');
 if(domain==='settings'&&action!=='update')throw new Error('Налаштування можна лише змінювати');
 if(domain==='payments'&&action!=='update')throw new Error('Оплата потребує конкретного проєкту');
 const recordId=typeof r.recordId==='string'?r.recordId:undefined;
 if(domain!=='settings'&&action!=='create'&&!records(domain,s).some(x=>x.id===recordId))throw new Error('Запис не знайдено. Уточни назву або ID');
 const fields=cleanFields(domain,r.fields||{});
 if(action==='create'){
  const defaults:Partial<Record<AssistantDomain,Plan['fields']>>={projects:{status:'Очікування оплати',currency:'UAH',prepayment:0,paidToSpecialist:0,fop:0,partnerCommission:0,profitTaken:0,startDate:today()},finance:{date:today(),hidden:false},clients:{isRegular:false,source:'Інше'},debts:{currency:'UAH',date:today()},savings:{currency:'UAH',amount:0,date:today()},partners:{currency:'UAH'}};
  Object.assign(fields,{...defaults[domain],...fields});
 }
 if(domain==='payments'&&!fields.date)fields.date=today();
 if(action==='delete'&&Object.keys(fields).length)throw new Error('Видалення не повинно змінювати поля');
 if(action==='update'&&!Object.keys(fields).length)throw new Error('Немає змін');
 if(domain==='projects'&&fields.status==='Завершено')throw new Error('Для завершення використай форму проєкту; це також переміщує запис до архіву');
 for(const [field,target] of [['developerId','specialists'],['partnerId','partners'],['projectId','projects']] as const){
  if(fields[field]&&!records(target,s).some(x=>x.id===fields[field]))throw new Error(`Не знайдено ${field}`);
 }
 return {domain,action,recordId,fields};
}
export function missingQuestions(plan:Omit<Plan,'base'>,s:DataSnapshot){
 if(plan.action==='delete')return [];
 const required:Partial<Record<AssistantDomain,string[]>>={projects:['name','type','clientName','budget'],clients:['name'],finance:['type','amount','bank'],payments:['amount'],specialists:['name','specialization'],partners:['name'],debts:['type','person','amount'],savings:['bank','goal']};
 const previous=plan.action==='update'&&plan.domain!=='payments'?records(plan.domain,s).find(x=>x.id===plan.recordId):undefined;
 const input={...previous,...plan.fields};
 return (required[plan.domain]||[]).filter(k=>input[k]===undefined||input[k]===null||input[k]==='').map(k=>({key:k,prompt:`Уточни: ${schemas[plan.domain]![k].label}`,options:schemas[plan.domain]![k].options}));
}
export function draftReply(plan:Plan,s:DataSnapshot,id:string):AssistantReply{
 const specs=schemas[plan.domain]!,prev=plan.domain==='settings'?s.financeSettings as unknown as Record<string,unknown>:records(plan.domain,s).find(x=>x.id===plan.recordId);
 const fields=Object.entries(plan.fields).map(([key,value])=>({key,...specs[key],value}));
 const changes=fields.map(f=>({key:f.key,label:f.label,before:String(prev?.[f.key]??'—'),after:String(f.value??'—')}));
 if(plan.domain==='payments'&&prev)changes.push({key:'totalPayment',label:'Загальна оплата проєкту',before:String(prev.prepayment||0),after:String(Number(prev.prepayment||0)+Number(plan.fields.amount||0))});
 if(plan.action==='delete')changes.push({key:'record',label:'Видалити запис',before:String(prev?.name||prev?.person||prev?.description||plan.recordId),after:'Буде видалено'});
 const routes:Partial<Record<AssistantDomain,string>>={settings:'/settings',payments:'/projects',projects:'/projects',finance:'/finance',clients:'/clients',specialists:'/specialists',partners:'/partners',debts:'/debts',savings:'/savings'};
 const target=plan.domain==='settings'?'Фінансові налаштування':String(prev?.name||prev?.person||prev?.description||plan.fields.name||plan.recordId||'');
 return {kind:'draft',draft:{id,domain:plan.domain,action:plan.action,title:`${plan.action==='delete'?'Видалити':plan.action==='create'?'Створити':'Змінити'}: ${target}`,fields,changes,questions:[],recordId:plan.recordId,route:routes[plan.domain]}};
}
export function projectSummary(s:DataSnapshot){
 const currency=s.financeSettings.displayCurrency||'UAH';
 const group=(items:DataSnapshot['projectsActive'])=>{
  const nativeBudget:Record<string,number>={};let amount=0;
  for(const p of items){const unit=p.currency||'UAH',budget=Number(p.budget)||0;
   nativeBudget[unit]=(nativeBudget[unit]||0)+budget;amount+=toDisplay(budget,unit,s.financeSettings);
  }
  return {count:items.length,budget:{amount,currency},nativeBudgets:Object.entries(nativeBudget).map(([currency,amount])=>({amount,currency}))};
 };
 return {active:group(s.projectsActive),completed:group(s.projectsCompleted)};
}
export function modelContext(s:DataSnapshot){
 return {date:today(),settings:s.financeSettings,stats:dashboardStats(s),monthlyIncome:incomeHistory(s),projectSummary:projectSummary(s),bankBalances:accountBalances(s),
 clients:s.clients,specialists:s.specialists,partners:s.partners,debts:s.personalDebts,savings:s.savings,
 projects:[...s.projectsActive.map(p=>({...p,collection:'active'})),...s.projectsCompleted.map(p=>({...p,collection:'completed'}))].map(p=>({id:p.id,collection:p.collection,name:p.name,clientName:p.clientName,status:p.status,currency:p.currency||'UAH',displayBudget:{amount:toDisplay(Number(p.budget)||0,p.currency||'UAH',s.financeSettings),currency:s.financeSettings.displayCurrency||'UAH'},developerId:p.developerId,partnerId:p.partnerId,startDate:p.startDate,endDate:p.endDate,...project(p)})),
 transactions:s.transactions.map(t=>({id:t.id,type:t.type,amount:t.amount,bank:t.bank,date:t.date,category:t.category,description:t.description,projectId:t.projectId,hidden:t.hidden,incomeStatus:t.incomeStatus,source:t.source,plannedDate:t.plannedDate,toBank:t.toBank,targetAmount:t.targetAmount,rate:t.rate,status:t.status})),banks:BANKS.map(({id,label,currency})=>({id,label,currency}))};
}
