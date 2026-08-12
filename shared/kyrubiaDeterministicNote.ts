export type KyrubiaDeterministicNoteDraft = {
  title: string;
  content: string;
  checklist: string[];
};

export type KyrubiaDeterministicNoteResult = {
  reply: string;
  noteDraft: KyrubiaDeterministicNoteDraft;
};

const cleanValue = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;

  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ['“', '”'],
    ['‘', '’'],
  ];

  for (const [open, close] of pairs) {
    if (trimmed.startsWith(open) && trimmed.endsWith(close)) {
      return trimmed.slice(open.length, -close.length).trim();
    }
  }

  return trimmed;
};

const EXPLICIT_NOTE_PATTERN =
  /^\s*(?:crie|criar|adicione|adicionar|fa[cç]a|salve|salvar)\s+(?:uma\s+)?nota\s+(?:chamada|intitulada|com\s+o\s+t[ií]tulo)\s+(.+?)\s+(?:com|e)\s+(?:o\s+)?(?:texto|conte[uú]do)\s*:?\s*(.+?)\s*[.!]?\s*$/isu;

export const resolveKyrubiaDeterministicNote = (
  message: string
): KyrubiaDeterministicNoteResult | null => {
  const match = EXPLICIT_NOTE_PATTERN.exec(message);
  if (!match) return null;

  const title = cleanValue(match[1] ?? '');
  const content = cleanValue(match[2] ?? '');
  if (!title || !content) return null;

  return {
    reply:
      `Tudo pronto para criar a nota “${title}”. ` +
      'Revise e confirme antes de eu salvá-la nas suas notas.',
    noteDraft: {
      title,
      content,
      checklist: [],
    },
  };
};
