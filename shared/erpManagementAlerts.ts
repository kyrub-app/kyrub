/** Current management conditions, not durable messages or unread receipts. */
export interface InventoryAlertInput {
  id: string;
  name: string;
  unit: string;
  currentQuantity: number;
  minimumQuantity: number;
}
export interface InventoryManagementAlert extends InventoryAlertInput {
  severity: 'out_of_stock' | 'low_stock';
}
export function buildInventoryManagementAlerts(items: readonly InventoryAlertInput[]): InventoryManagementAlert[] {
  const alerts: InventoryManagementAlert[] = [];
  for (const item of items) {
    if (!Number.isFinite(item.currentQuantity) || !Number.isFinite(item.minimumQuantity) ||
        item.currentQuantity < 0 || item.minimumQuantity < 0) continue;
    if (item.currentQuantity === 0) {
      alerts.push({ ...item, severity: 'out_of_stock' });
    } else if (item.minimumQuantity > 0 && item.currentQuantity <= item.minimumQuantity) {
      alerts.push({ ...item, severity: 'low_stock' });
    }
  }
  return alerts.sort((a, b) =>
    Number(b.severity === 'out_of_stock') - Number(a.severity === 'out_of_stock') ||
    a.name.localeCompare(b.name, 'pt-BR') || a.id.localeCompare(b.id));
}
