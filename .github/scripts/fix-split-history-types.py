from pathlib import Path

path = Path('src/utils/legacyTableOperations.ts')
text = path.read_text()
old = """        const method = value.method;\n        const isDiscount = value.entryType === 'discount' || method === 'coupon';\n        if (!isDiscount && method !== 'cash' && method !== 'pix' && method !== 'card' && method !== 'other') return [];\n        const amount = typeof value.amount === 'number' && Number.isFinite(value.amount) ? value.amount : 0;\n        const createdAt = typeof value.createdAt === 'string' ? value.createdAt : '';\n        return [{\n          id: documentSnapshot.id,\n          kind: isDiscount ? 'discount' as const : 'payment' as const,\n          tableCode: normalizeTableCode(tableCode),\n          method: isDiscount ? 'coupon' as const : method,"""
new = """        const rawMethod = value.method;\n        const paymentMethod: TablePaymentMethod | null =\n          rawMethod === 'cash' || rawMethod === 'pix' || rawMethod === 'card' || rawMethod === 'other'\n            ? rawMethod\n            : null;\n        const isDiscount = value.entryType === 'discount' || rawMethod === 'coupon';\n        if (!isDiscount && !paymentMethod) return [];\n        const amount = typeof value.amount === 'number' && Number.isFinite(value.amount) ? value.amount : 0;\n        const createdAt = typeof value.createdAt === 'string' ? value.createdAt : '';\n        return [{\n          id: documentSnapshot.id,\n          kind: isDiscount ? 'discount' as const : 'payment' as const,\n          tableCode: normalizeTableCode(tableCode),\n          method: isDiscount ? 'coupon' as const : paymentMethod!,"""
if old not in text:
    raise SystemExit('history method block not found')
path.write_text(text.replace(old, new, 1))
