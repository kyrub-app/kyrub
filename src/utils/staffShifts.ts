import { auth } from './firebase';
import type { StaffShift, StaffShiftKind } from '../../shared/staffShifts';
import type { StaffTaskAssignee } from '../../shared/staffTasks';

const base='/api/staff/shifts';
const request=async<T>(path:string,body?:object):Promise<T>=>{
  const user=auth.currentUser;
  if(!user) throw Error('Entre novamente para acessar as escalas.');
  const response=await fetch(base+path,{
    method:body?'POST':'GET',
    headers:{
      authorization:'Bearer '+await user.getIdToken(),
      accept:'application/json',
      ...(body?{'content-type':'application/json'}:{}),
    },
    ...(body?{body:JSON.stringify(body)}:{}),
    cache:'no-store',
  });
  if(!response.ok){
    const json=await response.json().catch(()=>({})) as {error?:string};
    throw Error(json.error||'Não foi possível concluir a operação.');
  }
  return response.json() as Promise<T>;
};
const scope=(storeId:string)=>'?storeId='+encodeURIComponent(storeId);

export const listStaffShifts=async(storeId:string)=>
  (await request<{shifts:StaffShift[]}>(scope(storeId))).shifts;

export const listStaffShiftAssignees=async(storeId:string)=>
  (await request<{assignees:StaffTaskAssignee[]}>('/assignees'+scope(storeId))).assignees;

export const createStaffShift=async(input:{
  storeId:string;requestId:string;kind:StaffShiftKind;assignedTo:string;
  scheduledDate:string;startTime:string;endTime:string;endsNextDay:boolean;
  sector:string;notes:string;
})=>(await request<{shift:StaffShift}>('',input)).shift;

export const cancelStaffShift=async(input:{
  storeId:string;shiftId:string;requestId:string;expectedVersion:number;reason:string;
})=>(await request<{shift:StaffShift}>('/cancel',input)).shift;
