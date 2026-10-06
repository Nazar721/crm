import './setup';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptySnapshot,makeProject,makeTransaction} from './helpers';
import {incomeForMonth,incomeHistory,requestedIncomeMonth,monthlyIncomeReply} from '@/lib/income-report';
import {monthIncome} from '@/lib/calc';
import {today} from '@/lib/utils';
function snapshot(){const s=emptySnapshot();s.financeSettings={usdRate:40,eurRate:50,usdtRate:45,displayCurrency:'UAH'};
 s.transactions=[makeTransaction({amount:1000,date:'2026-07-10'}),makeTransaction({amount:100,bank:'cash_usd',date:'2026-07-10'}),makeTransaction({amount:99,date:'2026-07-10',hidden:true}),makeTransaction({amount:500,date:'2026-07-10',incomeStatus:'incoming'}),makeTransaction({amount:777,date:'2026-07-10',source:'project_generated'}),makeTransaction({amount:50,date:'2026-07-10',type:'expense'}),makeTransaction({amount:1000,date:'2026-08-10'})];
 s.projectsCompleted=[makeProject({budget:10000,prepayment:6000,myPercent:30,endDate:'2026-07-20',currency:'UAH'}),makeProject({budget:1000,prepayment:1000,myPercent:20,endDate:'',finishDate:'2026-07-21',currency:'USD'}),makeProject({budget:100,endDate:'',finishDate:'',createdAt:'2026-07-01T00:00:00Z',prepayment:50,myPercent:10})];
 s.projectsActive=[makeProject({budget:99999,endDate:'2026-07-20',myPercent:100})];return s;}
test('income report separates finance chart income, completed project share and paid client amounts',()=>{
 const s=snapshot(),before=JSON.stringify(s),r=incomeForMonth(s,'2026-07');assert.equal(r.financeIncome,5000);assert.equal(r.financeIncome,monthIncome(s.transactions,'2026-07',s.financeSettings));assert.equal(r.agencyIncome,9900);assert.equal(r.closedCollected,46050);assert.equal(r.financeExpenses,50);assert.equal(r.completedCount,3);assert.equal(JSON.stringify(s),before);
 assert.deepEqual(incomeHistory(s).find(r=>r.month==='2026-07'),r);assert.throws(()=>incomeForMonth(s,'2026-13'));
 s.financeSettings.displayCurrency='USD';assert.equal(incomeForMonth(s,'2026-07').financeIncome,125);assert.equal(incomeForMonth(s,'2026-07').agencyIncome,247.5);
});
test('monthly income answer provides a table with exact values, dates, units and chart sources',()=>{
 const text=monthlyIncomeReply(snapshot(),'2026-07').text;assert.ok(text.includes('| Показник | Сума | Джерело |'));assert.ok(text.includes('2026-07'));assert.ok(text.includes('Фінанси → Дохід по місяцях'));assert.ok(text.includes('Dashboard → Мій дохід від агенції'));assert.ok(text.includes('5'+String.fromCharCode(160)+'000 UAH'));assert.ok(!text.includes('27 050'));
});
test('income query handles Ukrainian month, explicit year and corrections without intercepting edits',()=>{
 assert.equal(requestedIncomeMonth('скільки я заробив за липень'),today().slice(0,4)+'-07');assert.equal(requestedIncomeMonth('дохід за липень 2025'),'2025-07');assert.equal(requestedIncomeMonth('дохід за 2026-08'),'2026-08');
 const history=[{role:'user',text:'скільки я заробив за липень 2026'},{role:'assistant',text:'test'}];assert.equal(requestedIncomeMonth('ні саме з графіка фінанси',history),'2026-07');assert.equal(requestedIncomeMonth('та',history),'2026-07');
 for(const q of ['створи дохід за липень','зміни дохід за липень','видали дохід за липень','привіт','познач дохід за липень як оплачений','дохід за всі місяці','дохід за рік'])assert.equal(requestedIncomeMonth(q,history),null);
});
