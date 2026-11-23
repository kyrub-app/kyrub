import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  canReadStaffShift, nextStaffScheduleDate,
  staffShiftDaySlices, staffShiftSlotsOverlap,
  validStaffShiftDate, validateStaffShiftCancellation, validateStaffShiftCreation,
} from '../shared/staffShifts';

const base={
  requestId:'shift_request_first_12345',
  kind:'shift' as const,assignedTo:'staff_seller_12345',
  scheduledDate:'2026-12-03',startTime:'21:30',
  endTime:'05:30',endsNextDay:true,sector:'Atendimento',notes:'Loja principal',
};
test('schedule validation uses bounded store-local civil dates, durations and safe IDs',()=>{
  const valid=validateStaffShiftCreation(base);
  assert.equal(valid.id,base.requestId);
  assert.equal(valid.kind,'shift');
  assert.equal(valid.endTime,'05:30');
  assert.equal(validStaffShiftDate('2026-02-29'),false);
  assert.equal(validStaffShiftDate('2028-02-29'),true);
  assert.equal(nextStaffScheduleDate('2026-12-31'),'2027-01-01');
  for(const wrong of [
    {...base,requestId:'../bad'},
    {...base,assignedTo:'../bad'},
    {...base,scheduledDate:'2026-02-30'},
    {...base,scheduledDate:'2026/12/03'},
    {...base,startTime:'24:00'},
    {...base,endTime:'20:30',endsNextDay:false},
    {...base,startTime:'10:00',endTime:'10:00',endsNextDay:false},
    {...base,startTime:'10:00',endTime:'09:59',endsNextDay:true},
    {...base,sector:''},
    {...base,sector:'x'.repeat(81)},
    {...base,notes:'x'.repeat(1001)},
  ]) assert.throws(()=>validateStaffShiftCreation(wrong));
  const folga=validateStaffShiftCreation({
    ...base,kind:'day_off',startTime:'',endTime:'',endsNextDay:false,sector:'',
  });
  assert.equal(folga.kind,'day_off');
  assert.throws(()=>validateStaffShiftCreation({...base,kind:'day_off'}));
});

test('shift occupancy is split at midnight and touching boundaries are allowed',()=>{
  const shift=validateStaffShiftCreation(base);
  const slices=staffShiftDaySlices(shift);
  assert.deepEqual(slices,[
    {date:'2026-12-03',slot:{shiftId:base.requestId,startMinute:1290,endMinute:1440}},
    {date:'2026-12-04',slot:{shiftId:base.requestId,startMinute:0,endMinute:330}},
  ]);
  const dayOff=validateStaffShiftCreation({
    ...base,kind:'day_off',startTime:'',endTime:'',sector:'',endsNextDay:false,
  });
  assert.deepEqual(staffShiftDaySlices(dayOff),[
    {date:'2026-12-03',slot:{shiftId:base.requestId,startMinute:0,endMinute:1440}},
  ]);
  assert.equal(staffShiftSlotsOverlap({shiftId:'a',startMinute:0,endMinute:480},
    {shiftId:'b',startMinute:480,endMinute:600}),false);
  assert.equal(staffShiftSlotsOverlap({shiftId:'a',startMinute:0,endMinute:481},
    {shiftId:'b',startMinute:480,endMinute:600}),true);
});

test('only manager and assigned collaborator can view store-specific shifts',()=>{
  const target={assignedTo:'staff_seller_12345'};
  assert.equal(canReadStaffShift({uid:target.assignedTo,role:'seller'},target),true);
  assert.equal(canReadStaffShift({uid:'someone_else',role:'seller'},target),false);
  assert.equal(canReadStaffShift({uid:'manager_id',role:'manager'},target),true);
  assert.equal(canReadStaffShift({uid:'owner_id',role:'owner'},target),true);
  assert.deepEqual(validateStaffShiftCancellation({
    shiftId:base.requestId,requestId:'shift_cancel_12345',
    expectedVersion:1,reason:'Troca de escala',
  }),{shiftId:base.requestId,requestId:'shift_cancel_12345',
    expectedVersion:1,reason:'Troca de escala'});
  assert.throws(()=>validateStaffShiftCancellation({
    shiftId:base.requestId,requestId:'x',expectedVersion:1,reason:'',
  }));
});

test('schedule paths and permissions remain server-owned, preserving Ponto',()=>{
  const service=readFileSync('server/staff/staffShiftService.ts','utf8');
  const transport=readFileSync('server/staff/staffShiftTransport.ts','utf8');
  const client=readFileSync('src/utils/staffShifts.ts','utf8');
  const card=readFileSync('src/components/store/StoreStaffCentralWorkspace.tsx','utf8');
  const manager=readFileSync('src/components/store/StoreStaffShiftManager.tsx','utf8');
  const inbox=readFileSync('src/components/store/StoreStaffShiftInbox.tsx','utf8');
  const point=readFileSync('src/components/LegacyRetailerPanel.tsx','utf8');
  const health=readFileSync('api/health.ts','utf8');
  const server=readFileSync('server.ts','utf8');
  const vercel=readFileSync('vercel.json','utf8');
  assert.match(service,/resolveStaffActor/);
  assert.match(service,/recheckActor\(actor, tx\)/);
  assert.match(service,/tx\.create\(shiftRef,/);
  assert.match(service,/staffShiftSlotsOverlap/);
  assert.match(service,/dayReference\(actor, valid\.assignedTo,/);
  assert.match(service,/collection\('history'\)/);
  assert.match(service,/buildUserNotification/);
  assert.match(service,/STAFF_SHIFT_VERSION_CONFLICT/);
  assert.match(transport,/private, no-store/);
  assert.match(transport,/cancelAuthorizedStaffShift/);
  assert.match(health,/transport === 'staff-shifts'/);
  assert.match(server,/createStaffShiftRouter\(\)/);
  assert.match(vercel,/transport=staff-shifts/);
  assert.match(card,/<StoreStaffShiftManager storeId=/);
  assert.match(manager,/createStaffShift/);
  assert.match(inbox,/listStaffShifts/);
  assert.match(point,/<StoreStaffShiftInbox storeId=/);
  assert.doesNotMatch(client,/setDoc\(|updateDoc\(|addDoc\(/);
  assert.doesNotMatch(service,/timeClockEntries|storePayroll|payments|pix/i);
});
