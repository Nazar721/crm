import type {DataSnapshot} from '@/types';
import {monthIncome,project,toDisplay,bankAmountToDisplay} from '@/lib/calc';
import {getMonthKey,today,itemCurrency} from '@/lib/utils';

/** Exact existing chart definitions; these metrics must not be merged into one profit figure. */
export function incomeForMonth(s:DataSnapshot,month:string){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('Некоректний місяць звіту');
 let agencyIncome=0,closedCollected=0,completedCount=0,financeExpenses=0;
 for(const p of s.projectsCompleted){
  const amounts=project(p),unit=itemCurrency(p);
  if(getMonthKey(p.endDate||p.finishDate)===month)agencyIncome+=toDisplay(amounts.myIncome,unit,s.financeSettings);
  if(getMonthKey(p.endDate||p.finishDate||p.createdAt?.split('T')[0])===month){closedCollected+=toDisplay(amounts.paidAmount,unit,s.financeSettings);completedCount++;}
 }
 for(const t of s.transactions){
  if(t.hidden||t.source?.startsWith('project_')||t.type!=='expense'||getMonthKey(t.date||t.plannedDate)!==month)continue;
  financeExpenses+=bankAmountToDisplay(t.amount,t.bank,s.financeSettings);
 }
 return {month,currency:s.financeSettings.displayCurrency||'UAH',financeIncome:monthIncome(s.transactions,month,s.financeSettings),agencyIncome,closedCollected,completedCount,financeExpenses};
}
export function incomeHistory(s:DataSnapshot){
 const months=new Set<string>();months.add(today().slice(0,7));
 for(const t of s.transactions){const key=getMonthKey(t.date||t.plannedDate);if(key)months.add(key);}
 for(const p of s.projectsCompleted){const key=getMonthKey(p.endDate||p.finishDate||p.createdAt?.split('T')[0]);if(key)months.add(key);}
 return [...months].sort().map(m=>incomeForMonth(s,m));
}
export function monthlyIncomeReply(s:DataSnapshot,month:string){
 const r=incomeForMonth(s,month);const money=(n:number)=>`${new Intl.NumberFormat('uk-UA',{maximumFractionDigits:2}).format(n)} ${r.currency}`;
 return {kind:'text' as const,text:`**Дохід за ${month}**\n\n| Показник | Сума | Джерело |\n| --- | ---: | --- |\n| Дохід у фінансах | ${money(r.financeIncome)} | Фінанси → Дохід по місяцях |\n| Мій дохід від агенції | ${money(r.agencyIncome)} | Dashboard → Мій дохід від агенції |\n| Оплачено за завершені проєкти | ${money(r.closedCollected)} | Dashboard → Закрито замовлень |\n| Витрати у фінансах | ${money(r.financeExpenses)} | Фінансові витрати за місяць |\n\n- **Фінанси:** отримані доходи за датою запису; очікувані оплати не входять.\n- **Агенція:** твоя частка завершених проєктів за формулою CRM.\n- **Оплати проєктів:** отримані від клієнтів суми за завершені проєкти.\n\nЦі показники не потрібно додавати між собою. Витрати показані окремо. Курси валют — поточні в CRM.`};
}
const MONTH_WORDS=['січ','лют','берез','квіт','трав','черв','лип','серп','верес','жовт','листоп','груд'];
/** Recognize only read-only income questions; no change command can be executed here. */
export function requestedIncomeMonth(text:string,history:{role:string;text:string}[]=[]):string|null {
 const query=text.toLowerCase();if(/(?:створ|дода[йт]|запиш|видал|змін|онов|редаг|оплатити|познач|постав|внес|сплат)/.test(query))return null;
 if(/(?:за рік|за весь|всі місяц|усі місяц|порівня|деталь|перелік)/.test(query))return null;
 const wantsIncome=/(?:дох[іо]д|зароб|прибут|фінанс|граф)/.test(query);
 const matchMonth=(value:string)=>{const numeric=value.match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/);if(numeric)return numeric[0];
  const index=MONTH_WORDS.findIndex(m=>value.includes(m));if(index>=0)return `${value.match(/\b20\d{2}\b/)?.[0]||today().slice(0,4)}-${String(index+1).padStart(2,'0')}`;
  if(/(?:цей|поточн|актуальн).{0,12}місяц/.test(value))return today().slice(0,7);return null;};
 const explicit=matchMonth(query);if(explicit&&wantsIncome)return explicit;
 const previous=[...history].reverse().find(m=>m.role==='user'&&/(?:дох[іо]д|зароб|прибут|фінанс|граф)/.test(m.text.toLowerCase()));
 if(previous&&(wantsIncome||/^(?:ні|не так|саме|та|так|ага)/.test(query)))return explicit||matchMonth(previous.text.toLowerCase());
 return null;
}
