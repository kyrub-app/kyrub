import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/components/ProfileSocialHubNative.tsx';
let source = readFileSync(path, 'utf8');

const replaceExact = (before, after, label) => {
  if (!source.includes(before)) {
    throw new Error(`Não foi possível localizar: ${label}`);
  }
  source = source.replace(before, after);
};

const replacePattern = (pattern, replacement, label) => {
  if (!pattern.test(source)) {
    throw new Error(`Não foi possível localizar: ${label}`);
  }
  source = source.replace(pattern, replacement);
};

replaceExact(
  `type ConnectionSection =
  | 'connected'
  | 'favorites'
  | 'suggestions'
  | 'groups'
  | 'requests';`,
  `type ConnectionSection = 'connected' | 'favorites' | 'groups';
type NewConnectionsTab = 'requests' | 'suggestions';`,
  'tipos das seções de conectados'
);

replaceExact(
  `  const [offersOpen, setOffersOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ProfileTab>('publications');`,
  `  const [offersOpen, setOffersOpen] = useState(false);
  const [newConnectionsOpen, setNewConnectionsOpen] = useState(false);
  const [newConnectionsTab, setNewConnectionsTab] =
    useState<NewConnectionsTab>('requests');
  const [activeTab, setActiveTab] = useState<ProfileTab>('publications');`,
  'estado do modal Novos'
);

replaceExact(
  `  useEffect(() => {
    if (!open) return;
    setDraftName(profile.name);`,
  `  useEffect(() => {
    if (!open) {
      setNewConnectionsOpen(false);
      return;
    }
    setDraftName(profile.name);`,
  'reset do modal Novos'
);

replaceExact(
  `      if (savedOpen) setSavedOpen(false);
      else if (offersOpen) setOffersOpen(false);
      else if (editOpen) setEditOpen(false);
      else setOpen(false);`,
  `      if (savedOpen) setSavedOpen(false);
      else if (offersOpen) setOffersOpen(false);
      else if (editOpen) setEditOpen(false);
      else if (newConnectionsOpen) setNewConnectionsOpen(false);
      else setOpen(false);`,
  'fechamento por Escape'
);

replaceExact(
  `  }, [editOpen, offersOpen, open, profile.bio, profile.name, savedOpen]);`,
  `  }, [
    editOpen,
    newConnectionsOpen,
    offersOpen,
    open,
    profile.bio,
    profile.name,
    savedOpen,
  ]);`,
  'dependências do Escape'
);

replacePattern(
  /  const connectionTabs: Array<\{[\s\S]*?\n  \}> = \[[\s\S]*?\n  \];\n\n  const renderPostList/,
  `  const suggestionCount = directory.getSuggestions().length;
  const requestCount = directory.connectionRequests.length;
  const newConnectionsCount = suggestionCount + requestCount;

  const connectionTabs: Array<{
    id: ConnectionSection;
    label: string;
    count: number;
  }> = [
    {
      id: 'connected',
      label: 'Geral',
      count: directory.friends.length,
    },
    {
      id: 'favorites',
      label: 'Frequentes',
      count: directory.friends.filter(friend => friend.favorited).length,
    },
    {
      id: 'groups',
      label: 'Grupos',
      count: groups.length,
    },
  ];

  const openNewConnections = () => {
    setNewConnectionsTab(requestCount > 0 ? 'requests' : 'suggestions');
    setNewConnectionsOpen(true);
  };

  const renderPostList`,
  'definição das novas abas de conectados'
);

replacePattern(
  /                  <nav\n                    className="flex gap-2 overflow-x-auto pb-1"\n                    aria-label="Seções de conectados"\n                  >[\s\S]*?                  <\/nav>/,
  `                  <nav
                    className="grid grid-cols-4 gap-2"
                    aria-label="Seções de conectados"
                  >
                    {connectionTabs.map(item => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setConnectionSection(item.id)}
                        className={\`min-w-0 rounded-2xl border p-3 text-center \${
                          connectionSection === item.id
                            ? 'border-teal-500/40 bg-teal-500/10'
                            : 'border-slate-800 bg-slate-900'
                        }\`}
                      >
                        <strong className="block text-sm text-white">
                          {item.count}
                        </strong>
                        <span className="mt-1 block truncate text-[8px] font-black uppercase text-slate-500">
                          {item.label}
                        </span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={openNewConnections}
                      className="relative min-w-0 rounded-2xl border border-slate-800 bg-slate-900 p-3 text-center"
                      aria-label="Abrir novas conexões"
                    >
                      <strong className="block text-sm text-white">
                        {newConnectionsCount}
                      </strong>
                      <span className="mt-1 block truncate text-[8px] font-black uppercase text-slate-500">
                        Novos
                      </span>
                      {requestCount > 0 && (
                        <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-orange-500 px-1 text-center text-[8px] font-black text-slate-950">
                          {requestCount}
                        </span>
                      )}
                    </button>
                  </nav>`,
  'navegação principal de conectados'
);

replacePattern(
  /\n                  \{connectionSection === 'suggestions' && \([\s\S]*?\n                  \)\}\n\n                  \{connectionSection === 'groups'/,
  `\n\n                  {connectionSection === 'groups'`,
  'conteúdo antigo de Sugestões'
);

replacePattern(
  /\n                  \{connectionSection === 'requests' && \([\s\S]*?\n                  \)\}\n                <\/div>\n              \)\}/,
  `\n                </div>\n              )}`,
  'conteúdo antigo de Solicitações'
);

const newConnectionsModal = `
      {newConnectionsOpen && (
        <div className="fixed inset-0 z-[136] flex items-end justify-center bg-slate-950/95 backdrop-blur-md sm:items-center sm:p-4">
          <section className="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-slate-800 bg-slate-950 sm:rounded-3xl">
            <header className="flex items-center justify-between border-b border-slate-900 px-4 py-3">
              <div>
                <span className="text-[9px] font-black uppercase tracking-wider text-teal-300">
                  Conectados
                </span>
                <h3 className="text-base font-black text-white">
                  Novos contatos
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setNewConnectionsOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-slate-500"
                aria-label="Fechar novos contatos"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <nav
              className="grid grid-cols-2 gap-2 border-b border-slate-900 p-3"
              aria-label="Tipos de novos contatos"
            >
              <button
                type="button"
                onClick={() => setNewConnectionsTab('requests')}
                className={\`relative rounded-2xl border px-3 py-3 text-[9px] font-black uppercase \${
                  newConnectionsTab === 'requests'
                    ? 'border-orange-500/40 bg-orange-500/10 text-orange-200'
                    : 'border-slate-800 bg-slate-900 text-slate-500'
                }\`}
              >
                Solicitações {requestCount}
                {requestCount > 0 && (
                  <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-orange-500" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setNewConnectionsTab('suggestions')}
                className={\`rounded-2xl border px-3 py-3 text-[9px] font-black uppercase \${
                  newConnectionsTab === 'suggestions'
                    ? 'border-teal-500/40 bg-teal-500/10 text-teal-200'
                    : 'border-slate-800 bg-slate-900 text-slate-500'
                }\`}
              >
                Sugestões {suggestionCount}
              </button>
            </nav>

            <div className="flex-1 overflow-y-auto p-4">
              {newConnectionsTab === 'requests' && (
                <div className="space-y-3">
                  {directory.connectionRequests.map(request => (
                    <article
                      key={request.id}
                      className="rounded-2xl border border-slate-800 bg-slate-900 p-3"
                    >
                      <div className="flex items-center gap-3">
                        <Avatar
                          src={request.avatar}
                          name={request.name}
                          className="h-11 w-11 rounded-full object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <h4 className="truncate text-xs font-black text-white">
                            {request.name}
                          </h4>
                          <p className="truncate text-[9px] text-slate-500">
                            {request.bio || request.role}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            void directory.handleAcceptRequest(request)
                          }
                          className="rounded-xl bg-emerald-500 py-2 text-[9px] font-black uppercase text-slate-950"
                        >
                          Aceitar
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void directory.handleDeclineRequest(
                              request.id,
                              request.name
                            )
                          }
                          className="rounded-xl border border-slate-800 bg-slate-950 py-2 text-[9px] font-black uppercase text-slate-400"
                        >
                          Recusar
                        </button>
                      </div>
                    </article>
                  ))}
                  {directory.connectionRequests.length === 0 && (
                    <EmptyState
                      title="Sem solicitações"
                      description="Nenhuma solicitação de conexão pendente."
                      icon={Check}
                    />
                  )}
                </div>
              )}

              {newConnectionsTab === 'suggestions' && (
                <div className="grid grid-cols-2 gap-3">
                  {directory.getSuggestions().map(friend => (
                    <article
                      key={friend.id}
                      className="flex min-w-0 flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-900"
                    >
                      <Avatar
                        src={friend.avatar}
                        name={friend.name}
                        className="aspect-[4/3] w-full object-cover"
                      />
                      <div className="min-h-[72px] p-3">
                        <h4 className="truncate text-xs font-black text-white">
                          {friend.name}
                        </h4>
                        <p className="mt-1 line-clamp-2 text-[9px] text-slate-500">
                          {friend.bio || friend.role}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          void directory.handleToggleFriend(friend.id)
                        }
                        className="m-2 mt-auto flex h-10 items-center justify-center gap-2 rounded-xl bg-teal-500 px-2 text-[9px] font-black uppercase text-slate-950"
                      >
                        <UserPlus className="h-4 w-4" />
                        {friend.connectionStatus === 'pending_sent'
                          ? 'Cancelar'
                          : 'Conectar'}
                      </button>
                    </article>
                  ))}
                  {directory.getSuggestions().length === 0 && (
                    <div className="col-span-2">
                      <EmptyState
                        title="Sem sugestões"
                        description="Novos perfis públicos aparecerão aqui."
                        icon={UserPlus}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
`;

replaceExact(
  `      {editOpen && (`,
  `${newConnectionsModal}\n      {editOpen && (`,
  'posição do modal Novos'
);

if (source.includes("connectionSection === 'suggestions'")) {
  throw new Error('Sugestões ainda permanecem como seção principal.');
}
if (source.includes("connectionSection === 'requests'")) {
  throw new Error('Solicitações ainda permanecem como seção principal.');
}

writeFileSync(path, source);
console.log('Navegação de conectados refinada com sucesso.');
