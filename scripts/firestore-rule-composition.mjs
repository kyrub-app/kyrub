export const DELIVERY_SECTION_HEADER =
  '    // --- Guia Renda: Entregas Solicitadas/Disponíveis ---';

export const NEXT_DELIVERY_SECTION_HEADER =
  '    // --- Guia Renda: Vagas de Freela';

export const FREELANCE_SECTION_HEADER =
  '    // --- Guia Renda: Vagas de Freela (Otimizado com Custom Claims) ---';

export const NEXT_FREELANCE_SECTION_HEADER =
  '    match /artifacts { allow list: if isSignedIn(); }';

const SECURE_DELIVERY_RULES = `    // --- Guia Renda: Entregas Solicitadas/Disponíveis ---
    // Esta coleção é uma projeção server-authoritative. O Firebase Admin SDK
    // publica e atualiza as oportunidades sem passar pelas regras de cliente.
    match /hub/renda/deliveries/{deliveryId} {
      allow read: if isSignedIn();
      allow create, update, delete: if false;
    }`;

const SECURE_FREELANCE_RULES = `    // --- Guia Renda: Vagas de Freela (Identidade verificada) ---
    match /vagas/{vagaId} {
      allow read: if isSignedIn();
      allow create: if isAdmin()
        || (
          hasRole(['owner', 'manager', 'staff'])
          && hasApprovedIdentityProfile('requester')
        );
      allow update, delete: if isAdmin()
        || hasRole(['owner', 'manager', 'staff']);
    }

    // --- Candidaturas (Prestar o serviço de Freela) ---
    match /candidaturas/{candiId} {
      allow read: if isSignedIn();
      allow create: if isSignedIn()
        && incoming().userId == request.auth.uid
        && hasApprovedIdentityProfile('freelancer');
      allow update: if isAdmin()
        || hasRole(['owner', 'manager', 'staff'])
        || (isSignedIn() && existing().userId == request.auth.uid);
      allow delete: if isAdmin()
        || hasRole(['owner', 'manager', 'staff'])
        || (isSignedIn() && existing().userId == request.auth.uid);
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
