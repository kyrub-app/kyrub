import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  COURIER_TRACKING_UI_FRESH_MS,
  courierTrackingUiState,
} from '../shared/courierTrackingUiStatus';

test('courier GPS indicator cannot claim sharing before the server confirms a POST',()=>{
  const nowMs=1_700_000_000_000;
  const base={selected:true,lastConfirmedAtMs:null,hasIssue:false,nowMs};
  assert.equal(courierTrackingUiState({...base,selected:false}),'off');
  assert.equal(courierTrackingUiState(base),'waiting');
  assert.equal(courierTrackingUiState({...base,lastConfirmedAtMs:nowMs+1000}),'waiting');
  assert.equal(courierTrackingUiState({...base,lastConfirmedAtMs:0}),'waiting');
});

test('GPS disconnect, stale position, reconnect and explicit stop never appear as active sharing',()=>{
  const nowMs=1_700_000_000_000;
  const lastConfirmedAtMs=nowMs-1_000;
  const base={selected:true,lastConfirmedAtMs,hasIssue:false,nowMs};
  assert.equal(courierTrackingUiState(base),'recent');
  assert.equal(courierTrackingUiState({...base,hasIssue:true}),'interrupted');
  assert.equal(courierTrackingUiState({
    ...base,nowMs:lastConfirmedAtMs+COURIER_TRACKING_UI_FRESH_MS+1,
  }),'stale');
  assert.equal(courierTrackingUiState({
    ...base,nowMs:lastConfirmedAtMs+COURIER_TRACKING_UI_FRESH_MS,
  }),'recent');
  assert.equal(courierTrackingUiState({
    ...base,lastConfirmedAtMs:nowMs,nowMs:nowMs+200,
  }),'recent');
  assert.equal(courierTrackingUiState({...base,selected:false}),'off');
});
