export const DELIVERY_SECTION_HEADER =
  '    // --- Guia Renda: Entregas Solicitadas/Disponíveis ---';

export const NEXT_DELIVERY_SECTION_HEADER =
  '    // --- Guia Renda: Vagas de Freela';

const SECURE_DELIVERY_RULES = `    // --- Guia Renda: Entregas Solicitadas/Disponíveis ---
    // Esta coleção é uma projeção server-authoritative. O Firebase Admin SDK
    // publica e atualiza as oportunidades sem passar pelas regras de cliente.
    match /hub/renda/deliveries/{deliveryId} {
      allow read: if isSignedIn();
      allow create, update, delete: if false;
    }`;

export const hardenKyrubDeliveryRules = baseRules => {
  const sectionStart = baseRules.indexOf(DELIVERY_SECTION_HEADER);
  if (sectionStart < 0) {
    throw new Error('Kyrub delivery rules section was not found.');
  }

  const sectionEnd = baseRules.indexOf(
    NEXT_DELIVERY_SECTION_HEADER,
    sectionStart + DELIVERY_SECTION_HEADER.length
  );
  if (sectionEnd < 0) {
    throw new Error('The section following Kyrub delivery rules was not found.');
  }

  const newline = baseRules.includes('\r\n') ? '\r\n' : '\n';
  const secureSection = SECURE_DELIVERY_RULES.replaceAll('\n', newline);

  return `${baseRules.slice(0, sectionStart)}${secureSection}${newline}${newline}${baseRules.slice(sectionEnd)}`;
};
