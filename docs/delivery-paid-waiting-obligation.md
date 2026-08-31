# Delivery paid waiting obligation

This slice turns authoritative paid-waiting evidence into a pending courier payable without moving money.

Invariants:
- source authority is `delivery_paid_waiting`;
- beneficiary is the known courier assigned to the delivery;
- payer is explicit (`store` or `kyrub`) from the frozen policy snapshot;
- amount is integer BRL minor units and must be positive;
- the obligation is deterministic per delivery + courier;
- it is created only from calculated waiting evidence with an applied policy;
- missing canonical store mapping produces no obligation and never blocks physical pickup;
- initial lifecycle state is `pending`;
- no settlement, payout, transfer, wallet or custody is executed by secure pickup;
- buyer-confirmed delivery remains the later eligibility authority.
