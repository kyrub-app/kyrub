# Inventory cost basis PR scope

This stacked workstream adds the operational economic layer required before order-margin reporting.

Included:
- moving weighted average cost on priced inventory receipts;
- latest purchase unit cost kept separately from moving average;
- total inventory value in integer BRL minor units;
- legacy opening-cost seeding from existing positive `purchaseCost` when available;
- incomplete-cost state instead of zero-cost fiction when cost evidence is missing;
- CMV snapshot on order/KDS consumption;
- cancellation restoration at the historical cost of the original outflow;
- valuation-consistent losses, manual outflows and physical-count corrections;
- economic evidence in the generic inventory movement ledger;
- total and per-item economic position in Stock > Movements;
- preservation of cost-basis fields across legacy product/composition catalog edits.

Excluded:
- freight/tax/insurance allocation or landed-cost apportionment;
- statutory/fiscal accounting valuation;
- FIFO/LIFO;
- automatic supplier settlement effects;
- order-margin dashboard and contribution-margin calculations.
