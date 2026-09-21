from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    return text.replace(old, new, 1)

# Canonical Pix must subtract operational cash/card settlements and persisted discounts.
path = Path('server/attendance/localPaymentIntentService.ts')
text = path.read_text()
text = replace_once(
    text,
    "const assertExistingPair = (input: { intent: ExistingOrderCanonicalPaymentIntent; payment: CanonicalPayment; canonicalStoreId: string; orderId: string; buyerId: string; idempotencyKey: string; context: LocalPaymentContext; couponCode?: string; }): void => {",
    "const assertExistingPair = (input: { intent: ExistingOrderCanonicalPaymentIntent; payment: CanonicalPayment; canonicalStoreId: string; orderId: string; buyerId: string; idempotencyKey: string; context: LocalPaymentContext; couponCode?: string; requestedAmount?: number; }): void => {",
    'idempotency requested amount type',
)
text = replace_once(
    text,
    " || input.payment.status !== 'pending' || input.payment.amount !== input.intent.amount || (input.couponCode ?? '') !== (input.intent.commercialSnapshot?.couponCode ?? '')) throw new Error('LOCAL_PAYMENT_INTENT_IDEMPOTENCY_CONFLICT');",
    " || input.payment.status !== 'pending' || input.payment.amount !== input.intent.amount || (input.couponCode ?? '') !== (input.intent.commercialSnapshot?.couponCode ?? '') || (input.requestedAmount !== undefined && Math.abs(input.intent.amount - input.requestedAmount) > 0.009)) throw new Error('LOCAL_PAYMENT_INTENT_IDEMPOTENCY_CONFLICT');",
    'idempotency requested amount check',
)
text = replace_once(
    text,
    "  const orderRef = adminDb.doc(`stores/${storeContext.canonicalStoreId}/orders/${request.orderId}`); const intentRef =",
    "  const orderRef = adminDb.doc(`stores/${storeContext.canonicalStoreId}/orders/${request.orderId}`); const legacyOrderRef = adminDb.doc(`artifacts/${request.storeId}/public/data/customerOrders/${request.orderId}`); const intentRef =",
    'legacy order ref',
)
text = replace_once(
    text,
    "const [userSnapshot, existingIntentSnapshot, existingPaymentSnapshot, paymentSnapshot] = await Promise.all([transaction.get(userRef), transaction.get(intentRef), transaction.get(paymentRef), transaction.get(paymentQuery)]);",
    "const [userSnapshot, existingIntentSnapshot, existingPaymentSnapshot, paymentSnapshot, legacyOrderSnapshot] = await Promise.all([transaction.get(userRef), transaction.get(intentRef), transaction.get(paymentRef), transaction.get(paymentQuery), transaction.get(legacyOrderRef)]);",
    'legacy order transaction read',
)
text = replace_once(
    text,
    "assertExistingPair({ intent: savedIntent, payment: savedPayment, canonicalStoreId: storeContext.canonicalStoreId, orderId: request.orderId, buyerId, idempotencyKey: request.idempotencyKey, context, couponCode: request.couponCode });",
    "assertExistingPair({ intent: savedIntent, payment: savedPayment, canonicalStoreId: storeContext.canonicalStoreId, orderId: request.orderId, buyerId, idempotencyKey: request.idempotencyKey, context, couponCode: request.couponCode, requestedAmount: request.amount });",
    'idempotency requested amount call',
)
text = replace_once(
    text,
    "    let payable; try { payable = summarizeLocalOrderPayable(order); } catch { throw new Error('LOCAL_PAYMENT_INTENT_ORDER_TOTAL_INVALID'); }\n    if (payable.hasOperationalPaidQuantity) throw new Error('LOCAL_PAYMENT_INTENT_RECONCILIATION_REQUIRED');\n    const expectedAmount = payable.billableAmount;\n    const authoritativelyPaidAmount = Number(canonicalPayments.filter(payment => isPaymentAuthoritativelyPaid(payment.status)).reduce((sum, payment) => sum + payment.amount, 0).toFixed(2));\n    const projectedStatus = operationalPaymentStatus(order.paymentStatus);",
    "    const operationalOrder = legacyOrderSnapshot.exists ? legacyOrderSnapshot.data() : order;\n    let payable; try { payable = summarizeLocalOrderPayable(operationalOrder); } catch { throw new Error('LOCAL_PAYMENT_INTENT_ORDER_TOTAL_INVALID'); }\n    const expectedAmount = payable.billableAmount;\n    const canonicalPaidAmount = Number(canonicalPayments.filter(payment => isPaymentAuthoritativelyPaid(payment.status)).reduce((sum, payment) => sum + payment.amount, 0).toFixed(2));\n    const authoritativelyPaidAmount = Number((canonicalPaidAmount + payable.operationalPaidAmount).toFixed(2));\n    const projectedStatus = operationalPaymentStatus(operationalOrder.paymentStatus);",
    'mixed operational/canonical payable convergence',
)
path.write_text(text)

# Update source-level regressions for the new explicit amount and coupon-as-adjustment model.
path = Path('tests/local-pix-checkout-ui.test.ts')
text = path.read_text()
text = replace_once(
    text,
    "test('browser Pix client sends only scope, idempotency and opaque payment ids', () => {",
    "test('browser Pix client may request an operator-entered amount while server keeps financial authority', () => {",
    'pix test title',
)
text = replace_once(
    text,
    "  assert.doesNotMatch(client, /amount: input\\./);",
    "  assert.match(client, /amount: input\\.amount/);",
    'pix amount expectation',
)
path.write_text(text)

path = Path('tests/table-checkout-coupon.test.ts')
text = path.read_text()
text = replace_once(
    text,
    "test('coupon quote is authenticated server authority and updates the recorded payment amount', () => {",
    "test('coupon quote is authenticated server authority and persists as a discount adjustment before payment', () => {",
    'coupon test title',
)
text = replace_once(
    text,
    "  assert.match(workspace, /coupon: confirmedCoupon/);\n  assert.match(tableOperations, /originalAmount: selectedSubtotal/);\n  assert.match(tableOperations, /discountAmount/);\n  assert.match(tableOperations, /couponCode: coupon\\?\\.code/);\n  assert.match(tableOperations, /amount: paymentAmount/);",
    "  assert.match(workspace, /applyTableCoupon/);\n  assert.match(tableOperations, /entryType: 'discount'/);\n  assert.match(tableOperations, /originalAmount: selectedSubtotal/);\n  assert.match(tableOperations, /discountAmount/);\n  assert.match(tableOperations, /couponCode: quote\\.code/);\n  assert.match(tableOperations, /method: 'coupon'/);",
    'coupon adjustment assertions',
)
text = replace_once(
    text,
    "test('Pix reuses the already-applied coupon instead of rendering a second coupon input', () => {\n  assert.match(wrapper, /couponCode=\\{appliedCouponCode\\}/);\n  assert.match(financialPanel, /couponCode: appliedCouponCode = ''/);\n  assert.match(financialPanel, /const couponCode = appliedCouponCode\\.trim\\(\\)/);",
    "test('Pix reuses the net account state and does not render a second coupon input', () => {\n  assert.match(wrapper, /requestedAmount=\\{paymentDraft\\.amount\\}/);\n  assert.match(financialPanel, /requestedAmount = 0/);\n  assert.match(financialPanel, /amount: requestedAmount/);",
    'pix coupon/net test assertions',
)
path.write_text(text)

# The prebuild contract now permits an optional numeric amount while buyer/context remain server-derived.
path = Path('tests/local-payment-intent-create.test.ts')
text = path.read_text()
text = replace_once(
    text,
    "test('local payment intent input accepts only scope and idempotency', () => {",
    "test('local payment intent input accepts scope, idempotency and an optional partial amount', () => {",
    'intent input test title',
)
text = replace_once(
    text,
    "  for (const field of ['amount', 'email', 'method', 'context', 'buyerId']) {",
    "  assert.deepEqual(\n    parseLocalPaymentIntentCreateInput({\n      storeId: 'owner-1',\n      orderId: 'staff-order-1',\n      idempotencyKey: 'checkout-attempt-1',\n      amount: 19.5,\n    }),\n    {\n      storeId: 'owner-1',\n      orderId: 'staff-order-1',\n      idempotencyKey: 'checkout-attempt-1',\n      amount: 19.5,\n    }\n  );\n  for (const field of ['email', 'method', 'context', 'buyerId']) {",
    'intent amount acceptance regression',
)
text = replace_once(
    text,
    "  assert.match(service, /summarizeLocalOrderPayable\\(order\\)/);\n  assert.match(service, /expectedAmount = payable\\.billableAmount/);\n  assert.match(service, /payable\\.hasOperationalPaidQuantity/);\n  assert.match(service, /expectedAmount - authoritativelyPaidAmount/);\n  assert.doesNotMatch(service, /candidate\\.amount|request\\.amount|value\\.amount/);",
    "  assert.match(service, /summarizeLocalOrderPayable\\(operationalOrder\\)/);\n  assert.match(service, /expectedAmount = payable\\.billableAmount/);\n  assert.match(service, /payable\\.operationalPaidAmount/);\n  assert.match(service, /canonicalPaidAmount \\+ payable\\.operationalPaidAmount/);\n  assert.match(service, /expectedAmount - authoritativelyPaidAmount/);\n  assert.match(service, /request\\.amount \\?\\? outstandingSubtotal/);",
    'server remaining amount authority regression',
)
path.write_text(text)

# Expand the new regression to explicitly cover convergence semantics.
path = Path('tests/table-split-payment-history.test.ts')
text = path.read_text()
needle = """  test('local Pix intent accepts a server-capped requested amount', () => {\n    const shared = readFileSync('shared/localPaymentIntent.ts', 'utf8');\n    const service = readFileSync('server/attendance/localPaymentIntentService.ts', 'utf8');\n    assert.match(shared, /amount\\?: number/);\n    assert.match(service, /LOCAL_PAYMENT_INTENT_AMOUNT_EXCEEDS_OUTSTANDING/);\n    assert.match(service, /request\\.amount \\?\\? outstandingSubtotal/);\n  });\n"""
replacement = """  test('local Pix intent accepts a server-capped requested amount', () => {\n    const shared = readFileSync('shared/localPaymentIntent.ts', 'utf8');\n    const service = readFileSync('server/attendance/localPaymentIntentService.ts', 'utf8');\n    assert.match(shared, /amount\\?: number/);\n    assert.match(service, /LOCAL_PAYMENT_INTENT_AMOUNT_EXCEEDS_OUTSTANDING/);\n    assert.match(service, /request\\.amount \\?\\? outstandingSubtotal/);\n  });\n\n  test('canonical Pix subtracts earlier operational payments instead of blocking mixed methods', () => {\n    const service = readFileSync('server/attendance/localPaymentIntentService.ts', 'utf8');\n    assert.match(service, /legacyOrderRef/);\n    assert.match(service, /payable\\.operationalPaidAmount/);\n    assert.match(service, /canonicalPaidAmount \\+ payable\\.operationalPaidAmount/);\n    assert.doesNotMatch(service, /if \\(payable\\.hasOperationalPaidQuantity\\) throw new Error\\('LOCAL_PAYMENT_INTENT_RECONCILIATION_REQUIRED'\\)/);\n  });\n"""
if needle not in text:
    raise SystemExit('split Pix regression block not found')
path.write_text(text.replace(needle, replacement, 1))
