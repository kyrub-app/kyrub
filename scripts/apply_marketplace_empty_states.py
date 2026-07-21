from pathlib import Path

path = Path('src/components/tabs/KyrubTab.tsx')
source = path.read_text(encoding='utf-8')

old_import = """import { 
  Search, 
  MapPin, 
  Heart, 
  ThumbsUp, 
  Users 
} from 'lucide-react';"""
new_import = """import { 
  Search,
  SearchX,
  Store as StoreIcon,
  MapPin, 
  Heart, 
  ThumbsUp, 
  Users 
} from 'lucide-react';"""

if old_import not in source:
    raise SystemExit('Lucide import block not found')
source = source.replace(old_import, new_import, 1)

component_marker = "export function KyrubTab({"
component = """interface MarketplaceEmptyStateProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

function MarketplaceEmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: MarketplaceEmptyStateProps) {
  return (
    <div
      role=\"status\"
      className=\"rounded-3xl border border-dashed border-slate-800 bg-slate-900/45 px-5 py-10 text-center\"
    >
      <div className=\"mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-800 bg-slate-950 text-orange-400\">
        <Icon className=\"h-5 w-5\" />
      </div>
      <h3 className=\"text-sm font-black uppercase tracking-wide text-slate-100\">
        {title}
      </h3>
      <p className=\"mx-auto mt-2 max-w-sm text-xs leading-relaxed text-slate-500\">
        {description}
      </p>
      {actionLabel && onAction && (
        <button
          type=\"button\"
          onClick={onAction}
          className=\"mt-5 rounded-xl border border-orange-500/40 bg-orange-500/10 px-4 py-2 text-[10px] font-black uppercase tracking-wider text-orange-300 transition-colors hover:bg-orange-500/20\"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

"""

if component_marker not in source:
    raise SystemExit('KyrubTab component marker not found')
source = source.replace(component_marker, component + component_marker, 1)

function_marker = """}: KyrubTabProps) {
  return ("""
function_replacement = """}: KyrubTabProps) {
  const marketplaceEmptyState: MarketplaceEmptyStateProps = (() => {
    const normalizedSearch = searchQuery.trim();

    if (storesWithCoords.length === 0) {
      return {
        icon: StoreIcon,
        title: 'O marketplace ainda está sendo formado',
        description:
          'As lojas aparecerão aqui quando seus proprietários publicarem vitrines reais no Kyrub.',
      };
    }

    if (normalizedSearch) {
      return {
        icon: SearchX,
        title: 'Nenhuma loja encontrada',
        description: `Não encontramos resultados para “${normalizedSearch}”. Tente outro nome, produto ou categoria.`,
        actionLabel: 'Limpar busca',
        onAction: () => setSearchQuery(''),
      };
    }

    if (ofertasFilter === 'favoritas') {
      return {
        icon: Heart,
        title: 'Nenhuma loja favorita',
        description:
          'Toque no coração de uma loja para encontrá-la rapidamente nesta área.',
        actionLabel: 'Ver todas as lojas',
        onAction: () => setOfertasFilter('todas'),
      };
    }

    if (ofertasFilter === 'novas') {
      return {
        icon: StoreIcon,
        title: 'Nenhuma novidade por enquanto',
        description:
          'Novas vitrines publicadas pelos lojistas aparecerão aqui automaticamente.',
        actionLabel: 'Ver todas as lojas',
        onAction: () => setOfertasFilter('todas'),
      };
    }

    if (ofertasFilter === 'cliente') {
      return {
        icon: Users,
        title: 'Nenhuma loja no seu histórico',
        description:
          'Depois da sua primeira compra, as lojas das quais você já foi cliente aparecerão aqui.',
        actionLabel: 'Explorar lojas',
        onAction: () => setOfertasFilter('todas'),
      };
    }

    if (userCoords) {
      return {
        icon: MapPin,
        title: `Nenhuma loja em até ${radiusKm} km`,
        description:
          radiusKm < 50
            ? 'Amplie o raio de busca para descobrir vitrines publicadas em outras regiões.'
            : 'Ainda não há vitrines publicadas dentro do maior raio de busca disponível.',
        actionLabel: radiusKm < 50 ? 'Buscar em até 50 km' : undefined,
        onAction: radiusKm < 50 ? () => setRadiusKm(50) : undefined,
      };
    }

    return {
      icon: SearchX,
      title: 'Nenhuma oferta disponível',
      description:
        'Ajuste os filtros ou volte mais tarde para conferir novas vitrines publicadas.',
      actionLabel: 'Redefinir filtros',
      onAction: () => setOfertasFilter('todas'),
    };
  })();

  return ("""

if function_marker not in source:
    raise SystemExit('KyrubTab function opening not found')
source = source.replace(function_marker, function_replacement, 1)

old_empty_state = """          }).length === 0 && (
            <div className=\"text-center py-12 text-slate-500 text-xs\">
              Nenhuma oferta encontrada com esses filtros. Tente redefinir acima!
            </div>
          )}"""
new_empty_state = """          }).length === 0 && (
            <MarketplaceEmptyState {...marketplaceEmptyState} />
          )}"""

if old_empty_state not in source:
    raise SystemExit('Existing marketplace empty state not found')
source = source.replace(old_empty_state, new_empty_state, 1)

path.write_text(source, encoding='utf-8')
