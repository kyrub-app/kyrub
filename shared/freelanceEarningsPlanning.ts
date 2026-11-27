// Planning values only. Never a payable, settlement or account balance.
export function parseFreelancePlanningMoney(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
export function calculateFreelanceEarningsPlan(input: {
  jobs: number; feeMinor: number; costMinor: number;
}): { grossMinor: number; totalCostMinor: number; netMinor: number } | null {
  const { jobs, feeMinor, costMinor } = input;
  if (!Number.isSafeInteger(jobs) || jobs < 0 || jobs > 10000 ||
      !Number.isSafeInteger(feeMinor) || feeMinor < 0 || feeMinor > 999999999 ||
      !Number.isSafeInteger(costMinor) || costMinor < 0 || costMinor > 999999999) return null;
  const grossMinor = jobs * feeMinor;
  const totalCostMinor = jobs * costMinor;
  return { grossMinor, totalCostMinor, netMinor: grossMinor - totalCostMinor };
}
