import React from 'react';
import {createRoot} from 'react-dom/client';
import {signInWithCustomToken} from 'firebase/auth';
import {auth} from '../src/utils/firebase';
import {PublicSocialFeedPanel} from '../src/components/PublicSocialFeedPanel';
import {ConnectedReputationCard} from '../src/components/ReputationSquarePreview';
import '../src/index.css';

if(!import.meta.env.DEV||location.hostname!=='127.0.0.1'||auth.app.options.projectId!=='kyrub-security-test')throw Error('FIXTURE_ISOLATION_REQUIRED');
const root=createRoot(document.getElementById('root'));
window.mountCocarFixture=async ({token,postId,authorId,connectionId,messageId,createdAt})=>{
 const {user}=await signInWithCustomToken(auth,token);
 const noop=async()=>{};
 const post={id:postId,authorId,user:'Autora original fictícia',avatar:'',content:'Conheça minha Experiência e Reputações no Kyrub!',publicationType:'feed',time:'Agora',createdAt,likes:0,comments:0,shares:0,mediaUrls:[],taggedUsers:[],taggedUserIds:[],visibility:'public',audienceIds:[]};
 root.render(<main className="mx-auto max-w-lg space-y-4 bg-slate-950 p-2 text-slate-100">
  <section aria-label="Praça"><PublicSocialFeedPanel posts={[post]} loading={false} currentUserId={user.uid} likedPostIds={new Set()} commentsByPost={new Map()} friends={[]} suggestedUsers={[]} onConnectUser={noop} onOpenChat={noop} searchQuery="" filter="recentes" onToggleLike={noop} onAddComment={noop} onDeleteComment={noop} triggerToast={noop}/></section>
  <section aria-label="Mensagem encaminhada"><p className="text-sm">Encaminhada por remetente fictício</p><ConnectedReputationCard connectionId={connectionId} messageId={messageId} viewerId={user.uid}/></section>
 </main>);
};
