import {createHmac,timingSafeEqual} from 'node:crypto';
import type {Plan} from './plan';
type Envelope={user:string;expires:number;plan:Plan};
export function signPlan(plan:Plan,user:string,key:string,now=Date.now()):string {
 const data=Buffer.from(JSON.stringify({user,expires:now+15*60*1000,plan})).toString('base64url');
 return `${data}.${createHmac('sha256',key).update(data).digest('base64url')}`;
}
export function verifyPlan(token:string,user:string,key:string,now=Date.now()):Plan {
 if(typeof token!=='string'||token.length>20000)throw new Error('Некоректна чернетка');
 const [data,sig,extra]=token.split('.');if(!data||!sig||extra)throw new Error('Некоректна чернетка');
 const expected=createHmac('sha256',key).update(data).digest();const actual=Buffer.from(sig,'base64url');
 if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new Error('Чернетку змінено');
 const e=JSON.parse(Buffer.from(data,'base64url').toString()) as Envelope;
 if(e.user!==user||e.expires<now)throw new Error('Чернетка прострочена або належить іншому користувачу');
 return e.plan;
}
