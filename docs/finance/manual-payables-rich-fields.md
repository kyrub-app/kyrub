# Manual payables rich fields

This note records the behavioral boundary introduced by the manual payables UI update.

- `recurrence` and `costNature` are independent dimensions.
- Manual payables may carry billing-document metadata already supported by the canonical payable contract.
- `billingDigitableLine` and `billingBarcode` are accepted only when the document type is `boleto`.
- Manual payables do not receive `purchaseId`, `supplierId` or `purchasePayableKey`; those fields remain reserved for payables created from canonical purchases.
- Existing manual payables without the richer optional fields remain valid and normalize to `costNature: unspecified` and `billingDocumentType: none`.
- Registering a payable does not imply payment, inventory receipt or fiscal settlement.
