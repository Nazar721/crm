import * as actions from '@/lib/actions';
import type {AssistantConfirmResult} from './contract';
import type {Plan} from './plan';
export async function executePlan(plan:Plan):Promise<AssistantConfirmResult>{
 const id=plan.recordId;
 const result=await actions.applyAssistantPlan(plan);
 if(!result.ok)return {kind:'error',error:{code:'invalid_response',message:result.errors.map(e=>e.message).join('; ')}};
 const value=result.value as {id?:string}|undefined;
 const route=plan.domain==='history'?'/settings?tab=history':plan.domain==='payments'?'/projects':plan.domain==='finance'?'/finance':(plan.domain==='hosting'||plan.domain==='hostingPayments'?'/hosting':plan.domain==='plannedProjects'?'/planned-projects':`/${plan.domain}`);
 const summary=plan.domain==='history'?'Зміну скасовано':plan.action==='delete'?'Запис видалено':plan.domain==='payments'?'Оплату проєкту оновлено. Запис у Фінансах не створювався.':plan.action==='create'?'Запис створено':'Зміни збережено';
 return {kind:'applied',domain:plan.domain,recordId:value?.id||id||'',route,summary};
}
