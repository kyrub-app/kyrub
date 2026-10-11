/**
 * Shared finance competence is a UTC calendar-month key, not an assertion
 * that all financial surfaces have identical denominators.
 */
export const financeMonthFromDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

export const validFinanceMonth = (value: string): boolean =>
  /^(20\\d{2}|21\\d{2})-(0[1-9]|1[0-2])$/.test(value);

export const previousFinanceMonth = (period: string): string => {
  if (!validFinanceMonth(period)) throw new Error('FINANCE_PERIOD_INVALID');
  const [year, month] = period.split('-').map(Number);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
};

export const financeMonthLabel = (period: string): string => {
  if (!validFinanceMonth(period)) return 'Competência inválida';
  const [year, month] = period.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 1)));
};
