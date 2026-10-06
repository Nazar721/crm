import './setup';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptySnapshot,makeTransaction} from './helpers';
import {accountBalances,currentBalanceReply} from '@/lib/assistant/balance-report';
import {modelContext} from '@/lib/assistant/plan';
import {financeBalance} from '@/lib/calc';

function fixture(){
 const s=emptySnapshot();s.financeSettings={usdRate:40,eurRate:50,usdtRate:45,displayCurrency:'UAH'};
 s.transactions=[makeTransaction({bank:'mono',amount:54055}),makeTransaction({bank:'cash_usd',amount:1250}),makeTransaction({bank:'crypto_usdt',amount:250}),makeTransaction({bank:'cash_eur',amount:100,hidden:true})];return s;
}
test('assistant context pairs native and equivalent balances with explicit currencies',()=>{
 const s=fixture();const before=JSON.stringify(s);const b=modelContext(s).bankBalances;
 const usd=b.find(b=>b.id==='cash_usd')!;assert.deepEqual(usd.native,{amount:1250,currency:'USD'});assert.deepEqual(usd.uahEquivalent,{amount:50000,currency:'UAH'});
 const usdt=b.find(b=>b.id==='crypto_usdt')!;assert.deepEqual(usdt.native,{amount:250,currency:'USDT'});assert.deepEqual(usdt.uahEquivalent,{amount:11250,currency:'UAH'});
 assert.equal(b.find(b=>b.id==='cash_eur')!.native.amount,0);assert.equal(modelContext(s).stats.balance,115305);assert.equal(JSON.stringify(s),before);
});
test('current balance reply keeps native units and matches CRM under different display currencies',()=>{
 const s=fixture();for(const currency of ['UAH','USD','EUR'] as const){s.financeSettings.displayCurrency=currency;
 const reply=currentBalanceReply('Який мій баланс?',s)!;assert.equal(reply.kind,'text');assert.ok(reply.text.includes('1'+String.fromCharCode(160)+'250 USD'));assert.ok(reply.text.includes('250 USDT'));assert.ok(!reply.text.includes('50'+String.fromCharCode(160)+'000 USD'));
 const total=new Intl.NumberFormat('uk-UA',{maximumFractionDigits:2}).format(financeBalance(s.transactions,s.financeSettings));assert.ok(reply.text.includes(`${total} ${currency}`));
 const usd=accountBalances(s).find(b=>b.id==='cash_usd')!;assert.equal(usd.displayEquivalent.currency,currency);
 }
});
test('balance report respects transfers, negative accounts, hidden records and leaves other intents to planner',()=>{
 const s=fixture();s.transactions.push(makeTransaction({type:'transfer',bank:'cash_usd',toBank:'mono',amount:50,targetAmount:2000}),makeTransaction({type:'expense',bank:'cash_eur',amount:10}));
 const balances=accountBalances(s);assert.equal(balances.find(b=>b.id==='cash_usd')!.native.amount,1200);assert.equal(balances.find(b=>b.id==='mono')!.native.amount,56055);assert.equal(balances.find(b=>b.id==='cash_eur')!.native.amount,-10);
 for(const text of ['зміни баланс','який мій баланс за вересень','створи витрату і покажи баланс','покажи баланс клієнта'])assert.equal(currentBalanceReply(text,s),null);
 assert.ok(currentBalanceReply('покажи баланс по рахунках',s));
});
