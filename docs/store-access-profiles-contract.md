# Store staff access profiles

The existing `stores/{storeId}/members/{userId}` membership remains authoritative for identity, status, and technical role.

Store-specific named profiles (e.g. assistant manager and shift lead) should reference that membership rather than create another staff registry. Profiles restrict permissions of the underlying technical role; they do not silently escalate them.

The managerial menu unlock is a short-lived UI gate, not a substitute for server-side authorization. Every sensitive operation must validate the active member, effective permissions, and acting user. An unlock performed by another manager must preserve both the authorizer and operator identities in audit records.

Public store links use `/@slug`; the proposed staff entry `/@slug/staff` should resolve the canonical store and reuse the existing ERP runtime, rather than creating a parallel ERP.

Implementation sequence: permission contract and tests; store-scoped profile persistence; team UI; server authorization; menu unlock; staff route. Keep existing access unchanged until the corresponding enforcement is tested.

> Documentação proveniente da homologação; não comprova implementação ou validação em produção.
