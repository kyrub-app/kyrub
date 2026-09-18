# Service Location request workspace

This stacked cut keeps local service requests inside the selected Service Location workspace without creating a separate inbox or financial authority.

- Reuses the existing `LocalServiceRequest` API and transitions.
- Filters requests by the canonical `serviceLocationIdentityKey`.
- Supports staff acknowledge and resolve actions.
- Keeps `close_account` operational only: no payment status, paid quantity, PSP, fiscal, settlement, or points mutation.
- Leaves table finance and the legacy `TableServiceWorkspace` unchanged.
