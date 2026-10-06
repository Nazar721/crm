import type {DataSnapshot} from '@/types';
import {BANKS} from '@/lib/banks';
import {bankBalances,financeBalance,rateForCurrency,toDisplay} from '@/lib/calc';
import {today} from '@/lib/utils';

/** bankBalances returns UAH equivalents, including for foreign-currency accounts. */
export function accountBalances(s:DataSnapshot){
 const balances=bankBalances(s.transactions,s.financeSettings);
 const displayCurrency=s.financeSettings.displayCurrency||'UAH';
 return BANKS.map(bank=>{
  const uahAmount=balances[bank.id]||0;
  return {id:bank.id,label:bank.label,
   native:{amount:uahAmount/rateForCurrency(bank.currency,s.financeSettings),currency:bank.currency},
   uahEquivalent:{amount:uahAmount,currency:'UAH'},
   displayEquivalent:{amount:toDisplay(uahAmount,'UAH',s.financeSettings),currency:displayCurrency}};
 });
}

/** Only unambiguous current-balance requests; changes and historical queries go to the planner. */
export function currentBalanceReply(text:string,s:DataSnapshot):{kind:'text';text:string}|null {
 const query=text.toLocaleLowerCase('uk-UA').trim().replace(/[?!.,]/g,'').replace(/\s+/g,' ');
 if(!/^(?:який (?:мій |зараз мій |зараз |у мене )?баланс|скільки (?:у мене |в мене )?(?:грошей|на рахунках)|(?:покажи|показати) (?:мій |поточний |загальний )?баланс(?: по рахунках)?|баланс)$/.test(query))return null;
 const currency=s.financeSettings.displayCurrency||'UAH';
 const format=(value:number,unit:string)=>`${new Intl.NumberFormat('uk-UA',{maximumFractionDigits:2}).format(value)} ${unit}`;
 const lines=accountBalances(s).map(b=>`• ${b.label}: ${format(b.native.amount,b.native.currency)}${b.native.currency===currency?'':` (еквівалент ${format(b.displayEquivalent.amount,currency)})`}`);
 return {kind:'text',text:`Баланс на ${today()}: ${format(financeBalance(s.transactions,s.financeSettings),currency)}.\n\nПо рахунках:\n${lines.join('\n')}`};
}
