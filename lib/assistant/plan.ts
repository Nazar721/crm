import {incomeHistory} from '@/lib/income-report';
import {accountBalances} from './balance-report';
import type {Client,DataSnapshot} from '@/types';
import type {AssistantActionType,AssistantDomain,AssistantField,AssistantReply} from './contract';
import {BANKS} from '@/lib/banks';
import {dashboardStats,project,toDisplay} from '@/lib/calc';
import {today} from '@/lib/utils';
import {initialProjectForCopy,pickCopyOverrides} from '@/lib/copy-project';
import {hostingCoverage,hostingTotalsByCurrency} from '@/lib/hosting';
export type Plan={domain:AssistantDomain;action:AssistantActionType;recordId?:string;fields:Record<string,string|number|boolean|null>;base:string,copyClientMissing?: boolean};
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
 projects:{name:text('Назва проєкту'),type:select('Тип',['IT','Design','Video']),status:select('Статус',['Очікування оплати','В роботі','На паузі','Завершено']),clientName:text('Клієнт'),clientTelegram:text('Telegram клієнта'),clientSource:text('Джерело клієнта'),budget:number('Бюджет'),currency,bank,prepayment:number('Загалом сплатив клієнт'),paidToSpecialist:number('Виплачено фахівцю'),myPercent:number('Мій %'),fop:number('ФОП %'),partnerCommission:number('Комісія партнеру %'),profitTaken:number('Забрав собі'),developerId:text('ID фахівця'),partnerId:text('ID партнера'),startDate:date('Дата початку'),endDate:date('Дата завершення'),deadlineDays:number('Дедлайн, днів'),description:text('Опис'),clientId:text('ID клієнта')},
 finance:{type:select('Тип',['income','expense']),amount:number('Сума у валюті рахунку'),bank,date:date('Дата'),description:text('Опис'),category:text('Категорія'),incomeStatus:select('Статус доходу',['earned','incoming']),projectId:text('ID проєкту'),hidden:{label:'Прихований у підсумках',kind:'boolean'}},
 payments:{amount:number('Додаткова оплата'),bank,date:date('Дата'),description:text('Опис')},
 specialists:{name:text('Ім’я фахівця'),specialization:text('Спеціалізація'),telegram:text('Telegram'),myShareThreshold:number('Поріг бюджету, грн'),mySharePercentUpTo:number('Відсоток до порогу, %'),mySharePercentAbove:number('Відсоток понад поріг, %')},
 partners:{name:text('Ім’я партнера'),currency,services:text('Послуги'),paidToPartner:number('Виплачено партнеру'),givenProjectsCount:number('Передано проєктів'),givenProjectsPrice:number('Ціна переданих проєктів'),ourCommission:number('Наша комісія'),paidToUs:number('Виплачено нам')},
 debts:{type:select('Тип боргу',['owed_to_me','my_debt']),person:text('Людина'),amount:number('Сума'),currency,note:text('Примітка'),date:date('Дата')},
 savings:{name:text('Назва'),bank,amount:number('Сума'),goal:number('Ціль'),currency,date:date('Дата')},
 hosting:{name:text('Назва послуги'),site:text('Сайт/домен'),provider:text('Провайдер'),plan:text('Тариф'),currency,expectedPrice:number('Очікувана ціна продовження'),note:text('Примітка'),archived:{label:'Архів',kind:'boolean'}},
 hostingPayments:{serviceId:text('ID картки хостингу'),date:date('Дата оплати'),amount:number('Сума'),currency,periodStart:date('Початок періоду'),periodEnd:date('Кінець періоду'),note:text('Примітка')},
 history:{},
};
export function records(domain:AssistantDomain,s:DataSnapshot):Record<string,unknown>[] {
 const maps:Partial<Record<AssistantDomain,unknown[]>>={projects:[...s.projectsActive,...s.projectsCompleted],payments:[...s.projectsActive,...s.projectsCompleted],clients:s.clients,finance:s.transactions,specialists:s.specialists,partners:s.partners,debts:s.personalDebts,savings:s.savings,hosting:s.hostingServices,hostingPayments:s.hostingPayments};
 return (maps[domain]||[]) as Record<string,unknown>[];
}
/** Порівняння імен клієнтів так само, як це робить підбір у збереженні. */
function sameClientName(a:unknown,b:unknown):boolean{return String(a??'').trim().toLowerCase()===String(b??'').trim().toLowerCase();}
function clientByName(s:DataSnapshot,name:unknown):Client|undefined{return String(name??'').trim()?s.clients.find(c=>sameClientName(c.name,name)):undefined;}
/** Дані клієнта в чернетці беруться з картки — жодного «ID A, ім'я B». */
function applyClientCard(fields:Plan['fields'],card:Client):void{fields.clientId=card.id;fields.clientName=card.name;fields.clientTelegram=card.telegram||'';fields.clientSource=card.source||'Інше';}
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
 // Пакет 03: журнал — лише скасування конкретної події. Подія живе в
 // окремому шарі (не в snapshot), тож її наявність перевіряє маршрут
 // при підготовці чернетки та доменна дія при виконанні.
 if(domain==='history'){
  if(action!=='update')throw new Error('З журналом можлива лише дія скасування (update)');
  if(!recordId)throw new Error('Вкажи ID події журналу');
 }
 // Пакет 04: картку хостингу не видаляють — лише архів (archived: true).
 if(domain==='hosting'&&action==='delete')throw new Error('Картку хостингу не видаляють — використай архів (archived: true)');
 if(domain!=='settings'&&domain!=='history'&&action!=='create'&&!records(domain,s).some(x=>x.id===recordId))throw new Error('Запис не знайдено. Уточни назву або ID');
 // Пакет 02: службова команда копії. copyFromId НЕ є збереженим полем проекту
 // (не просочується в запит і не потрапляє в backup), тому вилучаємо його зі
 // схеми ще до валідації. Для обраних сутностей це параметр дії.
 const rawFields: Record<string, unknown> = {};
 if (Object.prototype.hasOwnProperty.call(r, 'fields') && r.fields && typeof r.fields === 'object') {
   Object.assign(rawFields, r.fields as Record<string, unknown>);
 }
 let copyFromId: string | null = null;
 if(rawFields.copyFromId!==undefined&&rawFields.copyFromId!==null){
  if(typeof rawFields.copyFromId!=='string')throw new Error('Неправильний запит копії: ID початкового проєкту має бути рядком');
  copyFromId=rawFields.copyFromId.trim();
  if(!copyFromId)throw new Error('Неправильний запит копії: ID початкового проєкту порожній');
 }
 delete rawFields.copyFromId;
 const fields=cleanFields(domain,rawFields);
 // Прапорець «клієнта копії не вибрано» переживає підписання й повторну
 // нормалізацію/confirm (підписана чернетка вже не містить copyFromId).
 // Знімається він лише явним чинним clientId — втрата чи обхід неможливі.
 let clientMissing=r.copyClientMissing===true;
 if(action==='create'){
  if(domain==='projects'&&copyFromId){
   const source=[...s.projectsActive,...s.projectsCompleted].find(p=>p.id===copyFromId);
   if(!source)throw new Error('Початковий проєкт для копії не знайдено');
   const {prefill}=initialProjectForCopy(source,{clients:s.clients,specialists:s.specialists,partners:s.partners});
   const overrides=pickCopyOverrides(fields as Record<string,unknown>);
   for(const key of Object.keys(fields))delete (fields as Record<string,unknown>)[key];
   // Нульові оплати явно; умови копії; дозволені умови моделі поверх.
   Object.assign(fields,{prepayment:0,paidToSpecialist:0,profitTaken:0},prefill,overrides);
   // Копіювання: службовий copyFromId не є даними проєкту й не зберігається.
   for(const key of Object.keys(fields))if(!(key in schemas.projects!))delete (fields as Record<string,unknown>)[key];
   // Вибір клієнта копії: явний overrides.clientId (перевіряється за чинними
   // clients) → картка за точним ім'ям з overrides → картка джерела. Якщо
   // вибрати нічого (картку видалено або ім'я не відповідає жодній картці) —
   // прапорець copyClientMissing: чернетка зупиняється на уточненні, повторна
   // нормалізація/confirm теж не пропустить запис без явного вибору.
   const sourceCard=prefill.clientId?s.clients.find(c=>c.id===prefill.clientId):undefined;
   const nameOverride=overrides.clientName;
   const nameEcho=nameOverride!==undefined&&(sameClientName(nameOverride,source.clientName)||!!(sourceCard&&sameClientName(nameOverride,sourceCard.name)));
   let chosen='';
   if(overrides.clientId){
    if(!s.clients.some(c=>c.id===overrides.clientId))throw new Error(`Клієнта з ID ${overrides.clientId} не знайдено`);
    chosen=overrides.clientId;
   }else if(nameOverride!==undefined&&!nameEcho){
    const match=clientByName(s,nameOverride);
    if(match)chosen=match.id;else clientMissing=true;
   }else if(sourceCard){
    chosen=sourceCard.id;
   }else if(source.clientId){
    clientMissing=true;
   }
   if(chosen){fields.clientId=chosen;clientMissing=false;}else{delete (fields as Record<string,unknown>).clientId;}
  }else{
   const defaults:Partial<Record<AssistantDomain,Plan['fields']>>={projects:{status:'Очікування оплати',currency:'UAH',prepayment:0,paidToSpecialist:0,fop:0,partnerCommission:0,profitTaken:0,startDate:today()},finance:{date:today(),hidden:false},clients:{isRegular:false,source:'Інше'},debts:{currency:'UAH',date:today()},savings:{currency:'UAH',amount:0,date:today()},partners:{currency:'UAH'},hosting:{currency:'UAH',archived:false},hostingPayments:{currency:'UAH',date:today()}};
   Object.assign(fields,{...defaults[domain],...fields});
  }
  // Створення проєкту з явним clientId: перевірка за чинними clients і
  // приведення полів до картки (невідомий ID → зрозуміла відмова до запису).
  if(domain==='projects'&&typeof fields.clientId==='string'&&fields.clientId){
   const card=s.clients.find(c=>c.id===fields.clientId);
   if(!card)throw new Error(`Клієнта з ID ${fields.clientId} не знайдено`);
   applyClientCard(fields,card);
  }else if(!clientMissing&&!copyFromId&&domain==='projects'&&typeof fields.clientName==='string'&&fields.clientName){
   // Створення за ім'ям: якщо картка вже існує — збереження підбере саме її,
   // тому в чернетці показуємо її дані, а не потенційно розійдені.
   const match=clientByName(s,fields.clientName);
   if(match)applyClientCard(fields,match);
  }
  // Явний чинний clientId (відповідь на уточнення) знімає прапорець.
  if(clientMissing&&typeof fields.clientId==='string'&&fields.clientId&&s.clients.some(c=>c.id===fields.clientId))clientMissing=false;
 }
 // projects/update: зміна клієнта має бути явною. Сама лише назва не лишає
 // ID старого клієнта з іншою назвою: назва збігається з чинною карткою →
 // приведення; збігається з іншою наявною карткою → зв'язок міняється видимо
 // в чернетці (clientId); інакше — зрозуміла відмова з підказкою.
 if(action==='update'&&domain==='projects'){
  const rec=records(domain,s).find(x=>x.id===recordId);
  const recClientId=typeof rec?.clientId==='string'?rec.clientId:'';
  const recClientName=typeof rec?.clientName==='string'?rec.clientName:'';
  if(typeof fields.clientId==='string'&&fields.clientId){
   const card=s.clients.find(c=>c.id===fields.clientId);
   if(!card)throw new Error(`Клієнта з ID ${fields.clientId} не знайдено`);
   applyClientCard(fields,card);
  }else if(!('clientId' in fields)&&typeof fields.clientName==='string'){
   const linked=recClientId?s.clients.find(c=>c.id===recClientId):undefined;
   if(linked&&(sameClientName(linked.name,fields.clientName)||fields.clientName===recClientName)){
    applyClientCard(fields,linked);
   }else{
    const match=clientByName(s,fields.clientName);
    if(match)applyClientCard(fields,match);
    else if(!recClientId){/* проєкт без картки: зв'язок визначить збереження за ім'ям */}
    else throw new Error(`Клієнта «${fields.clientName}» не знайдено. Щоб змінити клієнта, вкажи явний clientId (або clientId: null — тоді картку підберуть або створять за ім'ям).`);
   }
  }else if(!('clientId' in fields)&&!('clientName' in fields)&&('clientTelegram' in fields||'clientSource' in fields)){
   // Контакти проєкту не можуть розійтися з карткою: показуємо дані картки.
   const linked=recClientId?s.clients.find(c=>c.id===recClientId):undefined;
   if(linked)applyClientCard(fields,linked);
  }
 }
 if(domain==='payments'&&!fields.date)fields.date=today();
 if(action==='delete'&&Object.keys(fields).length)throw new Error('Видалення не повинно змінювати поля');
 if(action==='update'&&!Object.keys(fields).length&&domain!=='history')throw new Error('Немає змін');
 if(domain==='projects'&&fields.status==='Завершено')throw new Error('Для завершення використай форму проєкту; це також переміщує запис до архіву');
 for(const [field,target] of [['developerId','specialists'],['partnerId','partners'],['projectId','projects'],['serviceId','hosting']] as const){
  if(fields[field]&&!records(target,s).some(x=>x.id===fields[field]))throw new Error(`Не знайдено ${field}`);
 }
 return {domain,action,recordId,fields,copyClientMissing:clientMissing};
}
export function missingQuestions(plan:Omit<Plan,'base'>,s:DataSnapshot){
 //Прапорець видаленого/невибраного клієнта копії ніколи не ховається: без
 // явного вибору уточнення повертається і при першій нормалізації, і при
 // повторній/confirm — тобто запис без вибору неможливий.
 const list:{key:string;prompt:string;options?:string[]}[]=plan.copyClientMissing?[{key:'client',prompt:'Картку клієнта для копії не вибрано (її видалено або не існує). Оберіть чинного клієнта — вкажіть точне ім’я або ID — або підтвердьте створення нової картки окремою дією.'}]:[];
 if(plan.action==='delete')return list;
 const required:Partial<Record<AssistantDomain,string[]>>={projects:['name','type','clientName','budget'],clients:['name'],finance:['type','amount','bank'],payments:['amount'],specialists:['name','specialization'],partners:['name'],debts:['type','person','amount'],savings:['bank','goal'],hosting:['name'],hostingPayments:['serviceId','amount','periodStart','periodEnd']};
 const previous=plan.action==='update'&&plan.domain!=='payments'?records(plan.domain,s).find(x=>x.id===plan.recordId):undefined;
 const input={...previous,...plan.fields};
 return [...list,...(required[plan.domain]||[]).filter(k=>input[k]===undefined||input[k]===null||input[k]==='').map(k=>({key:k,prompt:`Уточни: ${schemas[plan.domain]![k].label}`,options:schemas[plan.domain]![k].options}))];
}
export function draftReply(plan:Plan,s:DataSnapshot,id:string):AssistantReply{
 const specs=schemas[plan.domain]!,prev=plan.domain==='settings'?s.financeSettings as unknown as Record<string,unknown>:records(plan.domain,s).find(x=>x.id===plan.recordId);
 const fields=Object.entries(plan.fields).map(([key,value])=>({key,...specs[key],value}));
 const changes=fields.map(f=>({key:f.key,label:f.label,before:String(prev?.[f.key]??'—'),after:String(f.value??'—')}));
 if(plan.domain==='payments'&&prev)changes.push({key:'totalPayment',label:'Загальна оплата проєкту',before:String(prev.prepayment||0),after:String(Number(prev.prepayment||0)+Number(plan.fields.amount||0))});
 if(plan.action==='delete')changes.push({key:'record',label:'Видалити запис',before:String(prev?.name||prev?.person||prev?.description||plan.recordId),after:'Буде видалено'});
 const routes:Partial<Record<AssistantDomain,string>>={settings:'/settings',payments:'/projects',projects:'/projects',finance:'/finance',clients:'/clients',specialists:'/specialists',partners:'/partners',debts:'/debts',savings:'/savings',history:'/settings?tab=history',hosting:'/hosting',hostingPayments:'/hosting'};
 const target=plan.domain==='settings'?'Фінансові налаштування':String(prev?.name||prev?.person||prev?.description||plan.fields.name||plan.recordId||'');
 const title=plan.domain==='history'?'Скасувати зміну':`${plan.action==='delete'?'Видалити':plan.action==='create'?'Створити':'Змінити'}: ${target}`;
 return {kind:'draft',draft:{id,domain:plan.domain,action:plan.action,title,fields,changes,questions:missingQuestions(plan,s),recordId:plan.recordId,route:routes[plan.domain]}};
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
 transactions:s.transactions.map(t=>({id:t.id,type:t.type,amount:t.amount,bank:t.bank,date:t.date,category:t.category,description:t.description,projectId:t.projectId,hidden:t.hidden,incomeStatus:t.incomeStatus,source:t.source,plannedDate:t.plannedDate,toBank:t.toBank,targetAmount:t.targetAmount,rate:t.rate,status:t.status})),banks:BANKS.map(({id,label,currency})=>({id,label,currency})),
 // Пакет 04: хостинг — готові підсумки стану на «сьогодні» (спільний модуль),
 // щоб модель не перераховувала дати сама і не вигадувала покриття.
 hosting:{today:today(),
  services:s.hostingServices.map(h=>{const c=hostingCoverage(h,s.hostingPayments,today());return{id:h.id,name:h.name,site:h.site||'',provider:h.provider||'',plan:h.plan||'',currency:h.currency||'UAH',expectedPrice:h.expectedPrice??null,note:h.note||'',archived:!!h.archived,status:c.status,coverageEnd:c.coverageEnd,daysLeft:c.daysLeft,nextPeriod:c.nextPeriod,hasGap:c.hasGap,warnings:c.warnings,lastPayment:c.lastPayment?{id:c.lastPayment.id,date:c.lastPayment.date,amount:c.lastPayment.amount,currency:c.lastPayment.currency||'UAH',periodStart:c.lastPayment.periodStart,periodEnd:c.lastPayment.periodEnd}:null};}),
  payments:s.hostingPayments.map(p=>({id:p.id,serviceId:p.serviceId,date:p.date,amount:p.amount,currency:p.currency||'UAH',periodStart:p.periodStart,periodEnd:p.periodEnd,note:p.note||''})),
  totals:hostingTotalsByCurrency(s.hostingPayments)}};
}
