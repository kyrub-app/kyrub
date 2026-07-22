import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const storeRules = readFileSync('firestore.store-security.fragment.rules', 'utf8');
const functions = readFileSync('firestore.cash-ledger.fragment.rules', 'utf8');
const sessions = readFileSync('firestore.cash-sessions.fragment.rules', 'utf8');
const movements = readFileSync('firestore.cash-movements.fragment.rules', 'utf8');

test('foundational cash match no longer grants permissive access', () => {
  assert.match(
    storeRules,
    /match \/cashSessions\/\{sessionId\}[\s\S]*allow read, create, update, delete: if false/
  );
});

test('cash sessions enforce roles, immutable identity and one-way closing', () => {
  assert.match(functions, /\['owner', 'manager', 'cashier'\]/);
  assert.match(functions, /cashLedgerSessionIdentityIsImmutable/);
  assert.match(sessions, /existing\(\)\.status == 'open'/);
  assert.match(sessions, /incoming\(\)\.status == 'closed'/);
  assert.match(sessions, /incoming\(\)\.difference == incoming\(\)\.countedAmount - incoming\(\)\.expectedAmount/);
});

test('cash movements are append-only and reasons are required for sensitive operations', () => {
  assert.match(functions, /\['expense', 'withdrawal', 'adjustment'\]/);
  assert.match(movements, /data\.status == 'open'/);
  assert.match(movements, /allow update, delete: if false/);
});
