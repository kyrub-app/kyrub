from pathlib import Path

path = Path('.github/scripts/apply-split-table-payments.py')
text = path.read_text()
old = '''replace_once(
    'src/components/customer/LegacyTableServiceWorkspace.tsx',
    "    setCouponQuote(null);\\n    onAppliedCouponChange?.('');",
    "    setCouponQuote(null);\\n    setPaymentAmountInput('');\\n    setFinancialContexts({});\\n    onAppliedCouponChange?.('');\\n    onPaymentAmountChange?.(0);",
    'legacy reset financial state',
)'''
new = '''replace_once(
    'src/components/customer/LegacyTableServiceWorkspace.tsx',
    "    setCouponCode('');\\n    setCouponQuote(null);\\n    onAppliedCouponChange?.('');",
    "    setCouponCode('');\\n    setCouponQuote(null);\\n    setPaymentAmountInput('');\\n    setFinancialContexts({});\\n    onAppliedCouponChange?.('');\\n    onPaymentAmountChange?.(0);",
    'legacy reset financial state',
)'''
if text.count(old) != 1:
    raise SystemExit(f'expected reset patch block once, found {text.count(old)}')
path.write_text(text.replace(old, new, 1))
