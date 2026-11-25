export const DELIVERY_SECTION_HEADER =
  '    // --- Guia Renda: Entregas Solicitadas/Disponíveis ---';

export const NEXT_DELIVERY_SECTION_HEADER =
  '    // --- Guia Renda: Vagas de Freela';

export const FREELANCE_SECTION_HEADER =
  '    // --- Guia Renda: Vagas de Freela (Otimizado com Custom Claims) ---';

export const NEXT_FREELANCE_SECTION_HEADER =
  '    match /artifacts { allow list: if isSignedIn(); }';

export const ARTIFACT_SECTION_HEADER =
  '    // --- Tenant Artifacts (Multi-tenant) ---';

export const NEXT_ARTIFACT_SECTION_HEADER =
  '    // --- Kyrub Social Connections & Feed ---';

const SECURE_DELIVERY_RULES = `    // --- Guia Renda: Entregas Solicitadas/Disponíveis ---
    // Esta coleção é uma projeção server-authoritative. O Firebase Admin SDK
    // publica e atualiza as oportunidades sem passar pelas regras de cliente.
    match /hub/renda/deliveries/{deliveryId} {
      allow read: if isSignedIn();
      allow create, update, delete: if false;
    }`;

const SECURE_FREELANCE_RULES = `${FREELANCE_SECTION_HEADER}
    // A composição preserva o marcador acima para permanecer idempotente.
    // As autorizações abaixo substituem os antigos claims amplos por perfis
    // de identidade analisados e aprovados no Control Plane.
    function rendaVacancyPath(vagaId) {
      return /databases/$(database)/documents/vagas/$(vagaId);
    }

    function ownsRendaVacancy(data) {
      return isSignedIn() && data.get('ownerId', '') == request.auth.uid;
    }

    function hasRendaRequesterAuthority() {
      return isAdmin() || (
        hasRole(['owner', 'manager', 'staff'])
        && hasApprovedIdentityProfile('requester')
      );
    }

    match /vagas/{vagaId} {
      allow read: if isSignedIn();
      allow create: if canWriteRendaWithAge()
        && ownsRendaVacancy(incoming())
        && hasRendaRequesterAuthority();
      allow update: if canWriteRendaWithAge()
        && ownsRendaVacancy(existing())
        && incoming().ownerId == existing().ownerId
        && hasRendaRequesterAuthority();
      // Owners may remove their own vacancy even after suspension.
      // An unclassified historical record is not claimable by another account.
      allow delete: if ownsRendaVacancy(existing()) || isAdmin();
    }

    // Candidatures are private to the applicant and the verified vacancy owner.
    match /candidaturas/{candiId} {
      function hasApplicationVacancy() {
        let vacancy = rendaVacancyPath(incoming().vagaId);
        return exists(vacancy)
          && get(vacancy).data.ownerId == incoming().ownerId
          && incoming().ownerId != request.auth.uid;
      }
      function isApplicationOwner(data) {
        return isSignedIn() && data.get('userId', '') == request.auth.uid;
      }
      function isApplicationRequester(data) {
        return isSignedIn() && data.get('ownerId', '') == request.auth.uid;
      }
      // The applicant may check their own deterministic receipt before creation.
      allow get: if isSignedIn() && resource == null
        && isValidId(request.auth.uid)
        && candiId.matches('^[A-Za-z0-9]{20}__' + request.auth.uid + '$');
      allow read: if isApplicationOwner(existing()) || isApplicationRequester(existing()) || isAdmin();
      allow create: if canWriteRendaWithAge()
        && incoming().userId == request.auth.uid
        && incoming().vagaId is string
        && incoming().vagaId.matches('^[A-Za-z0-9]{20}$')
        && candiId == incoming().vagaId + '__' + request.auth.uid
        && hasApplicationVacancy()
        && get(rendaVacancyPath(incoming().vagaId)).data.status == 'open'
        && incoming().status == 'pending'
        && incoming().keys().hasOnly(['vagaId', 'ownerId', 'userId', 'status', 'createdAt', 'updatedAt'])
        && incoming().createdAt == request.time
        && incoming().updatedAt == request.time
        && hasApprovedIdentityProfile('freelancer');
      allow update: if isSignedIn()
        && incoming().userId == existing().userId
        && incoming().vagaId == existing().vagaId
        && incoming().ownerId == existing().ownerId
        && incoming().updatedAt == request.time
        && incoming().diff(existing()).affectedKeys().hasOnly(['status', 'updatedAt'])
        && (
          // Withdrawal remains possible without age or professional eligibility.
          (isApplicationOwner(existing()) && existing().status == 'pending'
            && incoming().status == 'withdrawn')
          || (canWriteRendaWithAge() && (
            (isApplicationRequester(existing()) && hasRendaRequesterAuthority()
              && existing().status == 'pending'
              && incoming().status in ['accepted', 'rejected'])
            || (isApplicationOwner(existing()) && hasApprovedIdentityProfile('freelancer')
              && existing().status == 'accepted'
              && incoming().status == 'completion_requested')
            || (isApplicationRequester(existing()) && hasRendaRequesterAuthority()
              && existing().status == 'completion_requested'
              && incoming().status in ['completed', 'accepted'])
          ))
        );
      // Preserve the deterministic receipt and bilateral history.
      // Any lawful erasure is a separate authorized server process.
      allow delete: if false;

      // Reuse the private DM contract (sender, receiver, text, server time),
      // but authorize by hiring receipt rather than a personal connection.
      match /messages/{messageId} {
        function hiringReceipt() {
          return get(/databases/$(database)/documents/candidaturas/$(candiId)).data;
        }
        function canReadHiringMessages() {
          let receipt = hiringReceipt();
          return isSignedIn() && (
            receipt.userId == request.auth.uid || receipt.ownerId == request.auth.uid
          );
        }
        function directHiringMessagesAllowed() {
          let control = /databases/$(database)/documents/renda_age_release_private/current;
          return !exists(control) || get(control).data.get('messageAuthority','client') == 'client';
        }
        function canSendHiringMessage() {
          let receipt = hiringReceipt();
          return isSignedIn()
            && canWriteRendaWithAge()
            && receipt.status in ['pending', 'accepted', 'completion_requested']
            && (
              (receipt.userId == request.auth.uid
                && incoming().receiverId == receipt.ownerId
                && hasApprovedIdentityProfile('freelancer'))
              || (receipt.ownerId == request.auth.uid
                && incoming().receiverId == receipt.userId
                && hasRendaRequesterAuthority())
            );
        }
        allow get: if canReadHiringMessages() && isValidId(messageId);
        allow list: if canReadHiringMessages() && request.query.limit <= 100;
        allow create: if canSendHiringMessage()
          && directHiringMessagesAllowed()
          && isValidId(messageId)
          && incoming().keys().hasOnly(['senderId','receiverId','text','createdAt'])
          && incoming().senderId == request.auth.uid
          && isValidId(incoming().receiverId)
          && incoming().text is string
          && incoming().text.size() >= 1
          && incoming().text.size() <= 4000
          && incoming().createdAt == request.time;
        allow update, delete: if false;
      }
    }`;

const SECURE_ARTIFACT_RULES = `${ARTIFACT_SECTION_HEADER}
    // Legacy artifact data is tenant-private by default. Cross-tenant access
    // must be granted only by an explicit child rule with document ownership.
    // Server-side Admin SDK flows bypass these client rules.
    match /artifacts/{tenantId} {
      allow read: if isSignedIn()
        && request.auth.uid == tenantId;
      allow create, update, delete: if isSignedIn()
        && request.auth.uid == tenantId;

      // Direct browser creation remains only for the legacy dine-in flow.
      // Delivery/pickup orders are server-authoritative via PaymentIntent.
      // A buyer may read only their own order inside another store tenant.
      match /public/data/customerOrders/{orderId} {
        allow read: if isSignedIn()
          && (
            request.auth.uid == tenantId
            || existing().buyerId == request.auth.uid
          );
        allow create: if isSignedIn()
          && storeSecClientOrderReleaseIsValid()
          && (!incoming().keys().hasAny(['source']) || incoming().source != 'customer' || incoming().fulfillmentType == 'dine_in')
          && (
            request.auth.uid == tenantId
            || (
              incoming().buyerId == request.auth.uid
              && incoming().storeId == tenantId
              && incoming().fulfillmentType == 'dine_in'
              && incoming().source == 'customer'
              && incoming().status == 'pending'
              && incoming().paymentStatus == 'unpaid'
            )
          );
        allow update: if isSignedIn()
          && !incoming().diff(existing()).affectedKeys().hasAny(['releaseMode', 'operationalRelease', 'paymentIntentId', 'paymentId'])
          && (
            (request.auth.uid == tenantId && storeSecOrderReleaseUnchanged())
            || (
              existing().buyerId == request.auth.uid
              && incoming().buyerId == existing().buyerId
              && incoming().storeId == existing().storeId
              && incoming().source == existing().source
              && incoming().paymentStatus == existing().paymentStatus
              && existing().status == 'pending'
              && incoming().status == 'cancelled'
              && incoming().diff(existing()).affectedKeys().hasOnly([
                'status',
                'updatedAt'
              ])
            )
          );
        allow delete: if false;
      }

      match /{artifactCollection}/{artifactDocument} {
        allow read, create, update, delete: if isSignedIn() && request.auth.uid == tenantId;
        match /{nestedCollection}/{nestedDocument}/{rest=**} {
          allow read, create, update, delete: if isSignedIn()
            && request.auth.uid == tenantId
            && !(artifactCollection == 'public' && artifactDocument == 'data' && nestedCollection == 'customerOrders');
        }
      }
    }`;

const replaceSection = (
  baseRules,
  sectionHeader,
  nextSectionHeader,
  replacement,
  missingMessage
) => {
  const sectionStart = baseRules.indexOf(sectionHeader);
  if (sectionStart < 0) throw new Error(missingMessage);
  const sectionEnd = baseRules.indexOf(
    nextSectionHeader,
    sectionStart + sectionHeader.length
  );
  if (sectionEnd < 0) {
    throw new Error(`The section following ${sectionHeader.trim()} was not found.`);
  }
  const newline = baseRules.includes('\r\n') ? '\r\n' : '\n';
  const secureSection = replacement.replaceAll('\n', newline);
  return `${baseRules.slice(0, sectionStart)}${secureSection}${newline}${newline}${baseRules.slice(sectionEnd)}`;
};

export const hardenKyrubDeliveryRules = baseRules =>
  replaceSection(
    baseRules,
    DELIVERY_SECTION_HEADER,
    NEXT_DELIVERY_SECTION_HEADER,
    SECURE_DELIVERY_RULES,
    'Kyrub delivery rules section was not found.'
  );

export const hardenKyrubFreelanceRules = baseRules =>
  replaceSection(
    baseRules,
    FREELANCE_SECTION_HEADER,
    NEXT_FREELANCE_SECTION_HEADER,
    SECURE_FREELANCE_RULES,
    'Kyrub freelance rules section was not found.'
  );

export const hardenKyrubArtifactRules = baseRules =>
  replaceSection(
    baseRules,
    ARTIFACT_SECTION_HEADER,
    NEXT_ARTIFACT_SECTION_HEADER,
    SECURE_ARTIFACT_RULES,
    'Kyrub tenant artifact rules section was not found.'
  );
