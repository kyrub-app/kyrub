import React from 'react';
import { 
  Search, 
  MapPin, 
  Heart, 
  ThumbsUp, 
  Users 
} from 'lucide-react';
import { StoreOfferCarousel } from '../StoreOfferCarousel';
import { MediaCarousel } from '../MediaCarousel';
import { Store, Friend, SocialPost, Order } from '../../types';

interface KyrubTabProps {
  searchQuery: string;
  setSearchQuery: (val: string) => void;
  radiusKm: number;
  setRadiusKm: (val: number) => void;
  socialSubTab: 'lojas' | 'usuarios';
  setSocialSubTab: (val: 'lojas' | 'usuarios') => void;
  ofertasFilter: string;
  setOfertasFilter: React.Dispatch<
  React.SetStateAction<'todas' | 'novas' | 'favoritas' | 'cliente'>
>;
  favoriteStoreIds: string[];
  handleToggleFavoriteStore: (id: string) => void;
  storesWithCoords: any[];
  userCoords: { lat: number; lng: number } | null;
  orders: Order[];
  setSelectedStoreForMoments: (val: Store | null) => void;
  setShowMomentsModal: (val: boolean) => void;
  setVisitingStore: (val: Store | null) => void;
  pracaFilter: 'recentes' | 'favoritos' | 'conectados';
  setPracaFilter: (val: 'recentes' | 'favoritos' | 'conectados') => void;
  newPostText: string;
  setNewPostText: (val: string) => void;
  handlePublishPost: (e: React.FormEvent) => void;
  posts: SocialPost[];
  setPosts: React.Dispatch<React.SetStateAction<SocialPost[]>>;
  friends: Friend[];
  handleToggleFriend: (id: string) => void;
  handleToggleFavoriteFriend: (id: string) => void;
  setSelectedChatUser: (val: Friend | null) => void;
  setShowChatModal: (val: boolean) => void;
  conectadosSubTab: 'sugestoes' | 'solicitacoes';
  setConectadosSubTab: (val: 'sugestoes' | 'solicitacoes') => void;
  getSuggestions: () => Friend[];
  connectionRequests: any[];
  handleAcceptRequest: (req: any) => void;
  handleDeclineRequest: (id: string, name: string) => void;
  triggerToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  getDistance: (lat1: number, lon1: number, lat2: number, lon2: number) => number;
}

export function KyrubTab({
  searchQuery,
  setSearchQuery,
  radiusKm,
  setRadiusKm,
  socialSubTab,
  setSocialSubTab,
  ofertasFilter,
  setOfertasFilter,
  favoriteStoreIds,
  handleToggleFavoriteStore,
  storesWithCoords,
  userCoords,
  orders,
  setSelectedStoreForMoments,
  setShowMomentsModal,
  setVisitingStore,
  pracaFilter,
  setPracaFilter,
  newPostText,
  setNewPostText,
  handlePublishPost,
  posts,
  setPosts,
  friends,
  handleToggleFriend,
  handleToggleFavoriteFriend,
  setSelectedChatUser,
  setShowChatModal,
  conectadosSubTab,
  setConectadosSubTab,
  getSuggestions,
  connectionRequests,
  handleAcceptRequest,
  handleDeclineRequest,
  triggerToast,
  getDistance
}: KyrubTabProps) {
  return (
    <div className="space-y-6 animate-fade-in" id="kyrub-tab-container">
      
      {/* Header: Keyword Search & Radius adjustments */}
      <div className="space-y-3.5 bg-slate-900 p-4 rounded-3xl border border-slate-800">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Buscar lojas, produtos ou usuários..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2 text-xs text-white focus:outline-none"
            />
          </div>
        </div>

        {/* GPS Distance Adjustment slider */}
        <div className="flex items-center justify-between text-xs font-mono pt-1">
          <span className="text-slate-400 flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-orange-500" />
            Filtro de Distância (GPS):
          </span>
          <div className="flex items-center gap-2 font-bold text-orange-400">
            <input
              type="range"
              min="1"
              max="50"
              value={radiusKm}
              onChange={(e) => setRadiusKm(Number(e.target.value))}
              className="w-24 h-1 bg-slate-950 rounded-lg appearance-none cursor-pointer accent-orange-500"
            />
            <span>{radiusKm} KM</span>
          </div>
        </div>
      </div>

      {/* Two internal tabs: Ofertas and Praça */}
      <div className="flex border-b border-slate-800" id="social-tabs">
        <button
          onClick={() => setSocialSubTab('lojas')}
          className={`flex-1 pb-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all ${
            socialSubTab === 'lojas' 
              ? 'border-orange-500 text-white' 
              : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}
        >
          Ofertas
        </button>
        <button
          onClick={() => setSocialSubTab('usuarios')}
          className={`flex-1 pb-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all ${
            socialSubTab === 'usuarios' 
              ? 'border-orange-500 text-white' 
              : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}
        >
          Praça
        </button>
      </div>

      {/* Sub Tab: OFERTAS */}
      {socialSubTab === 'lojas' && (
        <div className="space-y-4 animate-fade-in">
          {/* Horizontal Filters Bar */}
          <div className="flex items-center justify-around bg-slate-900/60 p-3 rounded-2xl border border-slate-800/80">
            <button
              onClick={() => setOfertasFilter(ofertasFilter === 'novas' ? 'todas' : 'novas')}
              className={`px-4 py-2 rounded-full border transition-all cursor-pointer text-xs font-bold uppercase ${
                ofertasFilter === 'novas'
                  ? 'bg-orange-500/20 border-orange-500 text-orange-400'
                  : 'bg-slate-950 border-slate-850 text-slate-400 hover:text-white'
              }`}
            >
              <span>Novas</span>
            </button>
            
            <button
              onClick={() => setOfertasFilter(ofertasFilter === 'favoritas' ? 'todas' : 'favoritas')}
              className={`px-4 py-2 rounded-full border transition-all cursor-pointer text-xs font-bold uppercase ${
                ofertasFilter === 'favoritas'
                  ? 'bg-red-500/20 border-red-500 text-red-400'
                  : 'bg-slate-950 border-slate-850 text-slate-400 hover:text-white'
              }`}
            >
              <span>Favoritas</span>
            </button>

            <button
              onClick={() => setOfertasFilter(ofertasFilter === 'cliente' ? 'todas' : 'cliente')}
              className={`px-4 py-2 rounded-full border transition-all cursor-pointer text-xs font-bold uppercase ${
                ofertasFilter === 'cliente'
                  ? 'bg-teal-500/20 border-teal-500 text-teal-400'
                  : 'bg-slate-950 border-slate-850 text-slate-400 hover:text-white'
              }`}
            >
              <span>Cliente</span>
            </button>
          </div>

          {/* Stores Grid Layout (2 columns / compact card height) */}
          <div className="grid grid-cols-2 gap-1.5">
            {storesWithCoords
              .filter(store => {
                if (searchQuery) {
                  const q = searchQuery.toLowerCase();
                  const matchesName = store.name.toLowerCase().includes(q);
                  const matchesDesc = store.description.toLowerCase().includes(q);
                  const matchesKeywords = store.keywords?.some((kw: string) => kw.toLowerCase().includes(q)) || false;
                  if (!matchesName && !matchesDesc && !matchesKeywords) {
                    return false;
                  }
                }
                if (userCoords) {
                  const dist = getDistance(userCoords.lat, userCoords.lng, store.lat, store.lng);
                  if (dist > radiusKm) return false;
                }
                if (ofertasFilter === 'novas') return store.isNew;
                if (ofertasFilter === 'favoritas') return favoriteStoreIds.includes(store.id);
                if (ofertasFilter === 'cliente') return orders.some(o => o.storeId === store.id);
                return true;
              })
              .map(store => {
                const dist = userCoords ? getDistance(userCoords.lat, userCoords.lng, store.lat, store.lng) : 1.2;
                return (
                  <div key={store.id} className="relative rounded-3xl overflow-hidden border border-slate-800 bg-slate-950 flex flex-col justify-between h-[148px] group hover:border-slate-700 transition-all shadow-xl">
                    {/* Automatic Vitrine Slide background */}
                    <StoreOfferCarousel images={store.offerImages} />

                    {/* Top Indicators/Actions Overlay */}
                    <div className="absolute top-0 inset-x-0 p-2 flex justify-between items-start z-10">
                      {/* Logo da Loja */}
                      <div className="relative w-8.5 h-8.5 shrink-0">
                        <img 
                          src={store.logo} 
                          alt={store.name} 
                          className="w-8.5 h-8.5 object-cover rounded-xl border border-slate-800 bg-slate-900 shadow-md" 
                          referrerPolicy="no-referrer" 
                        />
                        <span 
                          className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-slate-950 shadow-sm ${
                            store.status === 'open' ? 'bg-emerald-500 animate-pulse' :
                            store.status === 'delayed' ? 'bg-amber-500 animate-pulse' :
                            'bg-slate-500'
                          }`} 
                          title={
                            store.status === 'open' ? 'Aberta' :
                            store.status === 'delayed' ? 'Alerta: +20 pedidos' :
                            'Pausada'
                          }
                        />
                      </div>

                      {/* Favorite Toggle (Heart) */}
                      <button
                        onClick={() => handleToggleFavoriteStore(store.id)}
                        className="p-1 bg-slate-950/85 backdrop-blur-md rounded-full border border-slate-800/80 hover:scale-110 transition-transform cursor-pointer"
                      >
                        <Heart
                          className={`w-3 h-3 transition-all ${
                            favoriteStoreIds.includes(store.id) ? 'text-red-500 fill-red-500' : 'text-slate-400'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Bottom Information */}
                    <div className="mt-auto p-2 border-t border-slate-900/40 relative z-10 flex flex-col justify-end bg-gradient-to-t from-slate-950 via-slate-950/90 to-transparent">
                      <h3 className="font-black text-[13px] text-white uppercase tracking-wider truncate" title={store.name}>
                        {store.name}
                      </h3>
                      <p className="text-[8.5px] text-slate-400 line-clamp-1 leading-none mb-1">{store.description}</p>
                      
                      <div className="flex items-center justify-between text-[8px] font-mono text-slate-500">
                        <span className="shrink-0 font-bold text-slate-400">📍 {dist.toFixed(1)} KM</span>
                        <div className="flex items-center gap-1 truncate text-[7px] text-orange-400/90 font-bold max-w-[65%]">
                          {store.keywords?.slice(0, 3).map((kw: string) => `#${kw}`).join(' ')}
                        </div>
                      </div>
                    </div>

                    {/* Bottom buttons */}
                    <div className="grid grid-cols-2 border-t border-slate-850 relative z-10 bg-slate-950/95 rounded-b-3xl">
                      <button
                        onClick={() => {
                          setSelectedStoreForMoments(store);
                          setShowMomentsModal(true);
                        }}
                        className="py-1.5 text-[8.5px] font-mono font-black uppercase tracking-widest text-slate-400 hover:text-white hover:bg-slate-900 border-r border-slate-850 transition-colors text-center cursor-pointer"
                      >
                        MOMENTOS
                      </button>
                      <button
                        onClick={() => setVisitingStore(store)}
                        className="py-1.5 text-[8.5px] font-mono font-black uppercase tracking-widest text-teal-400 hover:text-teal-300 hover:bg-slate-900 transition-colors text-center cursor-pointer"
                      >
                        ENTRAR
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>

          {storesWithCoords.filter(store => {
            if (searchQuery) {
              const q = searchQuery.toLowerCase();
              if (!store.name.toLowerCase().includes(q) && !store.description.toLowerCase().includes(q) && !(store.keywords?.some((kw: string) => kw.toLowerCase().includes(q)))) return false;
            }
            if (userCoords) {
              const dist = getDistance(userCoords.lat, userCoords.lng, store.lat, store.lng);
              if (dist > radiusKm) return false;
            }
            if (ofertasFilter === 'novas') return store.isNew;
            if (ofertasFilter === 'favoritas') return favoriteStoreIds.includes(store.id);
            if (ofertasFilter === 'cliente') return orders.some(o => o.storeId === store.id);
            return true;
          }).length === 0 && (
            <div className="text-center py-12 text-slate-500 text-xs">
              Nenhuma oferta encontrada com esses filtros. Tente redefinir acima!
            </div>
          )}
        </div>
      )}

      {/* Sub Tab: PRAÇA */}
      {socialSubTab === 'usuarios' && (
        <div className="space-y-5 animate-fade-in">
          
          {/* Horizontal 3-Filter Selection Bar */}
          <div className="flex bg-slate-900/80 p-1 rounded-2xl border border-slate-800 gap-1 shadow-lg">
            <button
              onClick={() => setPracaFilter('recentes')}
              className={`flex-1 py-2 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer ${
                pracaFilter === 'recentes'
                  ? 'bg-orange-600 text-white shadow-lg shadow-orange-600/10'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Recentes
            </button>
            <button
              onClick={() => setPracaFilter('favoritos')}
              className={`flex-1 py-2 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer ${
                pracaFilter === 'favoritos'
                  ? 'bg-orange-600 text-white shadow-lg shadow-orange-600/10'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Favoritos
            </button>
            <button
              onClick={() => setPracaFilter('conectados')}
              className={`flex-1 py-2 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer ${
                pracaFilter === 'conectados'
                  ? 'bg-orange-600 text-white shadow-lg shadow-orange-600/10'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Conectados
            </button>
          </div>

          {/* PRACA: RECENTES OR FAVORITOS VIEW */}
          {(pracaFilter === 'recentes' || pracaFilter === 'favoritos') && (
            <div className="space-y-4">
              {/* Status Publish Form */}
              {pracaFilter === 'recentes' && (
                <form onSubmit={handlePublishPost} className="bg-slate-900 p-4 rounded-3xl border border-slate-800/80 space-y-3">
                  <textarea
                    value={newPostText}
                    onChange={(e) => setNewPostText(e.target.value)}
                    placeholder="O que está acontecendo no seu negócio ou região?"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500"
                    rows={2}
                  />
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] text-slate-500 font-mono">Compartilhar com a comunidade local</span>
                    <button
                      type="submit"
                      className="px-4 py-1.5 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-xl text-xs uppercase cursor-pointer"
                    >
                      Postar Status
                    </button>
                  </div>
                </form>
              )}

              {/* Feed Posts */}
              <div className="space-y-4">
                {posts
                  .filter(post => {
                    if (pracaFilter === 'favoritos') {
                      if (post.user.includes('Você')) return true;
                      const matchFriend = friends.find(f => f.name === post.user || post.user.includes(f.name));
                      return (matchFriend as any)?.favorited || false;
                    }
                    return true;
                  })
                  .map(post => (
                    <div key={post.id} className="bg-slate-900 border border-slate-800/80 rounded-2xl p-4 space-y-3">
                      <div className="flex gap-3 items-center">
                        <img src={post.avatar} alt={post.user} className="w-9 h-9 object-cover rounded-full" referrerPolicy="no-referrer" />
                        <div>
                          <h4 className="text-xs font-bold text-slate-200">{post.user}</h4>
                          <span className="text-[9px] font-mono text-slate-500">{post.time}</span>
                        </div>
                      </div>
                      <p className="text-slate-300 text-xs leading-relaxed whitespace-pre-line">{post.content}</p>
                      
                      {post.mediaUrls && post.mediaUrls.length > 0 && (
                        <div className="py-1">
                          <MediaCarousel mediaUrls={post.mediaUrls} />
                        </div>
                      )}
                      
                      <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono pt-2.5 border-t border-slate-800/60">
                        <button 
                          onClick={() => {
                            setPosts(curr => curr.map(p => p.id === post.id ? { ...p, likes: p.likes + 1 } : p));
                            triggerToast('Status curtido!', 'success');
                          }}
                          className="hover:text-white flex items-center gap-1.5 cursor-pointer"
                        >
                          <ThumbsUp className="w-3.5 h-3.5 text-orange-500" />
                          <span>{post.likes} curtidas</span>
                        </button>
                        <span className="text-[9px] text-orange-400">Kyrub Social Network</span>
                      </div>
                    </div>
                  ))}

                {posts.filter(post => {
                  if (pracaFilter === 'favoritos') {
                    if (post.user.includes('Você')) return true;
                    const matchFriend = friends.find(f => f.name === post.user || post.user.includes(f.name));
                    return (matchFriend as any)?.favorited || false;
                  }
                  return true;
                }).length === 0 && (
                  <div className="text-center py-12 text-slate-500 text-xs">
                    Nenhuma publicação encontrada para os filtros selecionados.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* PRACA: CONECTADOS / DIRECTORY VIEW */}
          {pracaFilter === 'conectados' && (
            <div className="space-y-6">
              
              <div className="space-y-3">
                <h4 className="text-[10px] font-mono uppercase text-slate-400 tracking-wider flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-teal-500"></span>
                  <span>Meus Contatos Conectados ({friends.filter(f => f.added && (f as any).isProfileVisible !== false).length})</span>
                </h4>
                
                <div className="grid grid-cols-1 gap-3">
                  {friends
                    .filter(f => f.added && (f as any).isProfileVisible !== false)
                    .map(friend => (
                      <div key={friend.id} className="bg-slate-900 border border-slate-800 p-4 rounded-3xl flex flex-col justify-between space-y-4 hover:border-slate-700 transition-all">
                        <div className="flex gap-3 items-start">
                          <img 
                            src={friend.avatar} 
                            alt={friend.name} 
                            className="w-12 h-12 rounded-full object-cover border border-slate-800 shrink-0" 
                            referrerPolicy="no-referrer"
                          />
                          <div className="space-y-1 min-w-0 flex-1">
                            <div className="flex justify-between items-start gap-1">
                              <h4 className="text-xs font-black text-white uppercase truncate">{friend.name}</h4>
                              <span className="text-[8px] bg-slate-950 px-1.5 py-0.5 rounded text-slate-500 font-mono uppercase shrink-0">
                                {friend.role}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-400 line-clamp-2 leading-relaxed italic">
                              "{ (friend as any).bio || 'Sem biografia cadastrada no perfil.' }"
                            </p>
                          </div>
                        </div>

                        {/* 3 Action Buttons */}
                        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-950">
                          <button
                            onClick={() => handleToggleFriend(friend.id)}
                            className="py-1.5 px-2 rounded-xl text-[9px] font-black uppercase bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all cursor-pointer text-center"
                          >
                            Desconectar
                          </button>

                          <button
                            onClick={() => handleToggleFavoriteFriend(friend.id)}
                            className={`py-1.5 px-2 rounded-xl border transition-all text-center text-[9px] font-black uppercase cursor-pointer ${
                              (friend as any).favorited
                                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                                : 'bg-slate-950 border-slate-850 text-slate-400 hover:text-slate-300'
                            }`}
                          >
                            {(friend as any).favorited ? '★ Favorito' : '☆ Favoritar'}
                          </button>

                          <button
                            onClick={() => {
                              setSelectedChatUser(friend);
                              setShowChatModal(true);
                            }}
                            className="py-1.5 px-2 rounded-xl text-[9px] font-black uppercase bg-orange-600 text-white hover:bg-orange-500 transition-all text-center cursor-pointer shadow-lg shadow-orange-600/15"
                          >
                            💬 Chat
                          </button>
                        </div>
                      </div>
                    ))}

                  {friends.filter(f => f.added && (f as any).isProfileVisible !== false).length === 0 && (
                    <div className="text-center py-6 bg-slate-900/40 rounded-2xl border border-slate-900/60 text-slate-500 text-xs italic">
                      Você ainda não possui contatos ativos na rede. Conecte-se abaixo!
                    </div>
                  )}
                </div>
              </div>

              {/* Sistema de Sub-abas */}
              <div className="space-y-4 pt-2 border-t border-slate-900">
                {/* Inner Tabs Bar */}
                <div className="flex border-b border-slate-800/80 gap-4" id="conectados-internal-tabs">
                  <button
                    onClick={() => setConectadosSubTab('sugestoes')}
                    className={`pb-2 text-xs font-black uppercase tracking-wider border-b-2 transition-all ${
                      conectadosSubTab === 'sugestoes'
                        ? 'border-orange-500 text-white'
                        : 'border-transparent text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    Sugestões ({getSuggestions().length})
                  </button>
                  <button
                    onClick={() => setConectadosSubTab('solicitacoes')}
                    className={`pb-2 text-xs font-black uppercase tracking-wider border-b-2 transition-all ${
                      conectadosSubTab === 'solicitacoes'
                        ? 'border-orange-500 text-white'
                        : 'border-transparent text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    Solicitações ({connectionRequests.length})
                  </button>
                </div>

                {/* Sugestões */}
                {conectadosSubTab === 'sugestoes' && (
                  <div className="grid grid-cols-1 gap-3 animate-fade-in">
                    {getSuggestions().map(friend => (
                      <div key={friend.id} className="bg-slate-900 border border-slate-800 p-4 rounded-3xl flex flex-col justify-between space-y-4 hover:border-slate-700 transition-all">
                        <div className="flex gap-3 items-start">
                          <img 
                            src={friend.avatar} 
                            alt={friend.name} 
                            className="w-12 h-12 rounded-full object-cover border border-slate-800 shrink-0" 
                            referrerPolicy="no-referrer"
                          />
                          <div className="space-y-1 min-w-0 flex-1">
                            <div className="flex justify-between items-start gap-1">
                              <h4 className="text-xs font-black text-white uppercase truncate">{friend.name}</h4>
                              <span className="text-[8px] bg-slate-950 px-1.5 py-0.5 rounded text-slate-500 font-mono uppercase shrink-0">
                                {friend.role}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-400 line-clamp-2 leading-relaxed italic">
                              "{ (friend as any).bio || 'Sem biografia cadastrada no perfil.' }"
                            </p>
                          </div>
                        </div>

                        {/* 3 Action Buttons */}
                        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-950">
                          <button
                            onClick={() => handleToggleFriend(friend.id)}
                            className={`py-1.5 px-2 rounded-xl text-[9px] font-black uppercase transition-all text-center cursor-pointer ${friend.connectionStatus === 'pending_sent'
                                ? 'bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700'
                                : 'bg-teal-500 text-slate-950 hover:bg-teal-400'
                              }`}
                          >
                            {friend.connectionStatus === 'pending_sent'
                              ? 'Cancelar pedido'
                              : 'Conectar'}
                          </button>

                          <button
                            onClick={() => handleToggleFavoriteFriend(friend.id)}
                            className={`py-1.5 px-2 rounded-xl border transition-all text-center text-[9px] font-black uppercase cursor-pointer ${
                              (friend as any).favorited
                                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                                : 'bg-slate-950 border-slate-850 text-slate-400 hover:text-slate-300'
                            }`}
                          >
                            {(friend as any).favorited ? '★ Favorito' : '☆ Favoritar'}
                          </button>

                          <button
                            disabled
                            className="py-1.5 px-2 rounded-xl text-[9px] font-black uppercase bg-slate-950 border border-slate-850 text-slate-600 text-center cursor-not-allowed opacity-50"
                            title="Conecte-se primeiro para liberar o chat privado"
                          >
                            🚫 Chat
                          </button>
                        </div>
                      </div>
                    ))}

                    {getSuggestions().length === 0 && (                      <div className="text-center py-6 bg-slate-900/40 rounded-2xl border border-slate-900/60 text-slate-500 text-xs italic">
                        Nenhuma sugestão pública disponível no momento.
                      </div>
                    )}
                  </div>
                )}

                {/* Solicitações */}
                {conectadosSubTab === 'solicitacoes' && (
                  <div className="grid grid-cols-1 gap-3 animate-fade-in">
                    {connectionRequests.map(req => (
                      <div key={req.id} className="bg-slate-900 border border-slate-800 p-4 rounded-3xl flex flex-col justify-between space-y-4 hover:border-slate-700 transition-all">
                        <div className="flex gap-3 items-start">
                          <img 
                            src={req.avatar} 
                            alt={req.name} 
                            className="w-12 h-12 rounded-full object-cover border border-slate-800 shrink-0" 
                            referrerPolicy="no-referrer"
                          />
                          <div className="space-y-1 min-w-0 flex-1">
                            <div className="flex justify-between items-start gap-1">
                              <h4 className="text-xs font-black text-white uppercase truncate">{req.name}</h4>
                              <span className="text-[8px] bg-slate-950 px-1.5 py-0.5 rounded text-slate-500 font-mono uppercase shrink-0">
                                {req.role}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-400 line-clamp-2 leading-relaxed italic">
                              "{ req.bio || 'Sem biografia cadastrada no perfil.' }"
                            </p>
                          </div>
                        </div>

                        {/* Approve / Refuse Buttons */}
                        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-950">
                          <button
                            onClick={() => handleAcceptRequest(req)}
                            className="py-2 px-3 rounded-xl text-[10px] font-black uppercase bg-emerald-600 hover:bg-emerald-500 text-white transition-all text-center cursor-pointer shadow-lg shadow-emerald-600/10"
                          >
                            ✓ Aceitar Conexão
                          </button>
                          <button
                            onClick={() => handleDeclineRequest(req.id, req.name)}
                            className="py-2 px-3 rounded-xl text-[10px] font-black uppercase bg-slate-950 border border-slate-800 text-slate-400 hover:bg-slate-900 hover:text-white transition-all text-center cursor-pointer"
                          >
                            ✕ Recusar
                          </button>
                        </div>
                      </div>
                    ))}

                    {connectionRequests.length === 0 && (
                      <div className="text-center py-8 bg-slate-900/40 rounded-2xl border border-slate-900/60 text-slate-500 text-xs italic">
                        Nenhuma solicitação de conexão pendente.
                      </div>
                    )}
                  </div>
                )}
              </div>

            </div>
          )}

        </div>
      )}
    </div>
  );
}
