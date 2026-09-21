from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, found {count}')
    return text.replace(old, new, 1)


path = Path('src/components/customer/LegacyTableServiceWorkspace.tsx')
text = path.read_text()

text = replace_once(
    text,
    "type BusyAction = '' | 'order' | 'payment' | 'transfer' | 'exclude' | 'coupon';",
    "type BusyAction = '' | 'order' | 'payment' | 'transfer' | 'exclude';",
    'busy action type',
)

text = replace_once(
    text,
    "  const [couponCode, setCouponCode] = useState('');\n  const [couponQuote, setCouponQuote] = useState<StorePromotionQuote | null>(null);",
    "  const [couponCode, setCouponCode] = useState('');\n  const [couponQuote, setCouponQuote] = useState<StorePromotionQuote | null>(null);\n  const [isCouponApplying, setIsCouponApplying] = useState(false);",
    'coupon retry state',
)

text = replace_once(
    text,
    "    setCouponCode('');\n    setCouponQuote(null);\n    setPaymentAmountInput('');",
    "    setCouponCode('');\n    setCouponQuote(null);\n    setIsCouponApplying(false);\n    setPaymentAmountInput('');",
    'coupon retry reset',
)

text = replace_once(
    text,
    "    setBusyAction('coupon');\n    try {",
    "    if (isCouponApplying) return;\n    setIsCouponApplying(true);\n    try {",
    'dedicated coupon busy state',
)

text = replace_once(
    text,
    "    } catch (error) {\n      setCouponQuote(null);\n      onAppliedCouponChange?.('');\n      notify(\n        error instanceof Error ? error.message : 'Não foi possível aplicar o cupom.',\n        'error'\n      );\n    } finally {\n      setBusyAction('');\n    }\n  };",
    "    } catch (error) {\n      setCouponQuote(null);\n      onAppliedCouponChange?.('');\n      setIsCouponApplying(false);\n      notify(\n        error instanceof Error ? error.message : 'Não foi possível aplicar o cupom.',\n        'error'\n      );\n    } finally {\n      setIsCouponApplying(false);\n    }\n  };",
    'coupon failure recovery',
)

text = replace_once(
    text,
    "                        disabled={confirmedPaymentExists}\n",
    "                        disabled={confirmedPaymentExists || isCouponApplying}\n",
    'coupon input disabled while applying',
)

text = replace_once(
    text,
    "                          busyAction === 'coupon' ||\n                          busyAction === 'payment'",
    "                          isCouponApplying ||\n                          busyAction === 'payment'",
    'coupon button disable source',
)

text = replace_once(
    text,
    "                        {busyAction === 'coupon' ? 'Aplicando...' : 'Aplicar'}",
    "                        {isCouponApplying ? 'Aplicando...' : 'Aplicar'}",
    'coupon button label source',
)

text = replace_once(
    text,
    "                    disabled={paymentSelectionArray.length === 0 || paymentAmount <= 0 || paymentAmount > payablePaymentTotal + 0.009 || busyAction === 'payment'}",
    "                    disabled={paymentSelectionArray.length === 0 || paymentAmount <= 0 || paymentAmount > payablePaymentTotal + 0.009 || busyAction === 'payment' || isCouponApplying}",
    'payment blocked during coupon validation',
)

path.write_text(text)

path = Path('tests/table-checkout-coupon.test.ts')
text = path.read_text()
text += """

test('failed coupon validation returns the form to a retryable idle state', () => {
  assert.match(workspace, /const \[isCouponApplying, setIsCouponApplying\] = useState\(false\)/);
  assert.match(workspace, /setIsCouponApplying\(true\)/);
  assert.match(workspace, /catch \(error\)[\s\S]*setIsCouponApplying\(false\)/);
  assert.match(workspace, /finally \{[\s\S]*setIsCouponApplying\(false\)/);
  assert.match(workspace, /disabled=\{confirmedPaymentExists \|\| isCouponApplying\}/);
  assert.match(workspace, /isCouponApplying \|\|[\s\S]*busyAction === 'payment'/);
  assert.doesNotMatch(workspace, /busyAction === 'coupon'/);
});
"""
path.write_text(text)
