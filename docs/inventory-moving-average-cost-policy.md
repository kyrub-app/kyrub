# Kyrub inventory moving-average cost policy

This workstream defines the operational inventory cost basis used by Stock and future margin reporting.

## Canonical policy

- Physical stock remains authoritative in the existing canonical inventory document.
- Inventory cost uses a moving weighted average.
- `inventoryValueMinor` is stored as integer BRL minor units (centavos).
- `averageUnitCostMinor` may contain fractional centavos per physical unit so repeated weighted-average calculations do not lose material precision.
- `lastPurchaseUnitCostMinor` is kept separately from the moving average.
- The legacy `purchaseCost` field remains backward compatible and is updated to the latest priced purchase/intake; it is not the moving-average source of truth.
- A priced confirmed purchase receipt recalculates inventory value and moving average.
- A physical outflow snapshots the then-current cost into the movement/order ledger as operational CMV.
- A later cancellation restores inventory using the historical cost snapshot from that outflow, not the current moving average.
- Losses and negative physical corrections reduce valuation at the current moving average.
- A positive physical correction or receipt without reliable cost never enters as zero-cost stock. The physical quantity is preserved, but the economic basis becomes `incomplete` until a reliable basis can be established.
- If an incomplete-cost stock reaches zero, a later fully priced intake may establish a fresh complete basis.

## Legacy migration behavior

For pre-policy inventory with positive quantity:

- when a positive legacy `purchaseCost` exists, it is used once as the best available opening cost seed and the provenance is `legacy_purchase_cost_seed`;
- when no reliable cost exists, the item is marked `incomplete` rather than valued at zero.

No fictional historical purchase is created.

## Deliberate boundaries

This is an operational/managerial inventory cost basis. This workstream does not introduce:

- FIFO/PEPS or LIFO/UEPS;
- tax or statutory accounting valuation rules;
- freight, insurance, tax or landed-cost allocation across receipt lines;
- fiscal bookkeeping entries;
- automatic supplier payment effects on inventory valuation;
- final order-margin dashboards.

Those concerns may use the cost evidence produced here but remain separate domains.