export const STORE_OPERATION_ACTION_TYPE = 'update_store_operation' as const;

export type StoreOperationalStatus = 'open' | 'delayed' | 'closed';
export type StoreOperationWeekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export type StoreOpeningHoursPatch = {
  day: StoreOperationWeekday;
  enabled: boolean;
  opensAt: string;
  closesAt: string;
};

export type StoreOperationProposal = {
  id: string;
  type: typeof STORE_OPERATION_ACTION_TYPE;
  expectedCurrentStatus?: StoreOperationalStatus;
  status?: StoreOperationalStatus;
  openingHours?: StoreOpeningHoursPatch[];
  requiresConfirmation: true;
  origin?: 'kyrubia' | 'chatgpt' | 'manual' | 'automation';
  idempotencyKey?: string;
};

export const STORE_OPERATION_WEEKDAYS: StoreOperationWeekday[] = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
];
