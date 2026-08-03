import { useEffect, useState } from 'react';
import {
  collection,
  onSnapshot,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import type { Friend } from '../types';
import { useSocialDirectoryV2 } from '../hooks/useSocialDirectoryV2';
import { auth, db } from '../utils/firebase';

type ContactGroup = {
  id: string;
  name: string;
  memberIds: string[];
};

const normalizeText = (value: string | null | undefined): string =>
  (value ?? '').replace(/\s+/g, ' ').trim();

const readStringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];

const sameGroups = (current: ContactGroup[], next: ContactGroup[]): boolean =>
  current.length === next.length &&
  current.every((group, index) => {
    const candidate = next[index];
    return (
      group.id === candidate?.id &&
      group.name === candidate?.name &&
      group.memberIds.join('|') === candidate?.memberIds.join('|')
    );
  });

const groupLabelForFriend = (
  groups: ContactGroup[],
  friendId: string
): string => {
  const names = groups
    .filter(group => group.memberIds.includes(friendId))
    .map(group => group.name)
    .filter(Boolean);

  if (names.length === 0) return '';
  return names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`;
};

export function ProfileConnectedCardsLayoutBridge() {
  const directory = useSocialDirectoryV2({
    profileName: auth.currentUser?.displayName ?? '',
    profilePhotoUrl: auth.currentUser?.photoURL ?? '',
    profileAddress: '',
    accountTypeLojista: false,
    accountTypeEntregador: false,
    isLoggedIn: Boolean(auth.currentUser),
    triggerToast: () => undefined,
  });
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(
    () => new Set()
  );

  useEffect(() => {
    let stopGroups: (() => void) | null = null;

    const stopAuth = onAuthStateChanged(auth, user => {
      stopGroups?.();
      stopGroups = null;

      if (!user) {
        setGroups([]);
        return;
      }

      stopGroups = onSnapshot(
        collection(db, `users/${user.uid}/contact_groups`),
        snapshot => {
          const next = snapshot.docs
            .map(item => {
              const data = item.data() as Record<string, unknown>;
              return {
                id: item.id,
                name:
                  typeof data.name === 'string' ? data.name.trim() : '',
                memberIds: readStringList(data.memberIds),
              };
            })
            .filter(group => group.name)
            .sort((left, right) =>
              left.name.localeCompare(right.name, 'pt-BR')
            );

          setGroups(current => (sameGroups(current, next) ? current : next));
        },
        () => setGroups([])
      );
    });

    return () => {
      stopGroups?.();
      stopAuth();
    };
  }, []);

  useEffect(() => {
    const synchronize = () => {
      const profileModal = document.getElementById(
        'profile-social-hub-modal'
      );
      if (!profileModal) return;

      const usedFriendIds = new Set<string>();
      const removeButtons = profileModal.querySelectorAll<HTMLButtonElement>(
        'button[aria-label^="Remover "]'
      );

      removeButtons.forEach(removeButton => {
        const card = removeButton.closest<HTMLElement>('article');
        if (!card) return;

        const requestedName = normalizeText(
          removeButton.getAttribute('aria-label')?.replace(/^Remover\s+/, '')
        );
        const friend = directory.friends.find(
          item =>
            !usedFriendIds.has(item.id) &&
            normalizeText(item.name) === requestedName
        );
        if (!friend) return;
        usedFriendIds.add(friend.id);

        const imageContainer = card.firstElementChild as HTMLElement | null;
        const media = imageContainer?.querySelector<HTMLElement>(
          'img, [role="img"]'
        );
        const nativeName = card.querySelector<HTMLElement>('h4');
        const content = nativeName?.parentElement as HTMLElement | null;
        const footer = removeButton.parentElement;

        if (!imageContainer || !media || !content || !footer) return;

        card.dataset.profileConnectedFullImage = 'true';
        card.style.position = 'relative';
        card.style.isolation = 'isolate';
        card.style.minHeight = '300px';
        card.style.overflow = 'hidden';
        card.style.background = '#020617';

        imageContainer.style.position = 'absolute';
        imageContainer.style.inset = '0';
        imageContainer.style.height = '100%';
        imageContainer.style.zIndex = '0';

        media.style.width = '100%';
        media.style.height = '100%';
        media.style.objectFit = 'cover';

        let gradient = imageContainer.querySelector<HTMLElement>(
          '[data-profile-connected-full-gradient="true"]'
        );
        if (!gradient) {
          gradient = document.createElement('div');
          gradient.dataset.profileConnectedFullGradient = 'true';
          imageContainer.appendChild(gradient);
        }
        gradient.style.position = 'absolute';
        gradient.style.inset = '0';
        gradient.style.zIndex = '1';
        gradient.style.pointerEvents = 'none';
        gradient.style.background =
          'linear-gradient(to bottom, rgba(2,6,23,0.02) 30%, rgba(2,6,23,0.72) 67%, rgba(2,6,23,0.98) 100%)';

        content.style.position = 'relative';
        content.style.zIndex = '3';
        content.style.marginTop = 'auto';
        content.style.minHeight = '74px';
        content.style.background = 'transparent';

        footer.style.position = 'relative';
        footer.style.zIndex = '3';
        footer.style.background = 'rgba(2, 6, 23, 0.82)';
        footer.style.backdropFilter = 'blur(8px)';

        const nativeDescription = content.querySelector<HTMLElement>('p');
        if (nativeDescription) nativeDescription.style.display = 'none';

        let groupLabel = content.querySelector<HTMLElement>(
          '[data-profile-connected-group-label="true"]'
        );
        if (!groupLabel) {
          groupLabel = document.createElement('p');
          groupLabel.dataset.profileConnectedGroupLabel = 'true';
          groupLabel.className =
            'mt-1 truncate text-[9px] font-bold text-slate-300';
          content.appendChild(groupLabel);
        }

        const label = groupLabelForFriend(groups, friend.id);
        groupLabel.textContent = label;
        groupLabel.style.display = label ? '' : 'none';
      });

      groups.forEach(group => {
        const heading = [...profileModal.querySelectorAll<HTMLElement>('h4')]
          .find(item => normalizeText(item.textContent) === group.name);
        const section = heading?.closest<HTMLElement>('section');
        if (!heading || !section) return;

        const header = heading.parentElement?.parentElement as HTMLElement | null;
        const memberGrid = [...section.children].find(child =>
          child instanceof HTMLElement &&
          child.className.includes('grid') &&
          child.querySelector('button')
        ) as HTMLElement | undefined;
        if (!header || !memberGrid) return;

        let toggleButton = section.querySelector<HTMLButtonElement>(
          `[data-profile-group-add-people="${group.id}"]`
        );
        if (!toggleButton) {
          toggleButton = document.createElement('button');
          toggleButton.type = 'button';
          toggleButton.dataset.profileGroupAddPeople = group.id;
          toggleButton.className =
            'flex h-10 w-full items-center justify-center rounded-xl border border-violet-500/30 bg-violet-500/10 text-[9px] font-black uppercase text-violet-200';
          header.insertAdjacentElement('afterend', toggleButton);
          toggleButton.addEventListener('click', () => {
            setExpandedGroupIds(current => {
              const next = new Set(current);
              if (next.has(group.id)) next.delete(group.id);
              else next.add(group.id);
              return next;
            });
          });
        }

        const expanded = expandedGroupIds.has(group.id);
        const availableCount = directory.friends.filter(
          friend => !group.memberIds.includes(friend.id)
        ).length;
        toggleButton.textContent = expanded
          ? 'Concluir inclusão'
          : `Adicionar pessoas${availableCount > 0 ? ` (${availableCount})` : ''}`;
        toggleButton.disabled = !expanded && availableCount === 0;
        toggleButton.style.opacity =
          !expanded && availableCount === 0 ? '0.45' : '1';

        const usedIds = new Set<string>();
        memberGrid
          .querySelectorAll<HTMLButtonElement>('button')
          .forEach(friendButton => {
            const friendName = normalizeText(
              [...friendButton.querySelectorAll<HTMLElement>('span')]
                .map(item => normalizeText(item.textContent))
                .find(Boolean)
            );
            const friend = directory.friends.find(
              item =>
                !usedIds.has(item.id) &&
                normalizeText(item.name) === friendName
            );
            if (!friend) return;
            usedIds.add(friend.id);

            const isMember = group.memberIds.includes(friend.id);
            friendButton.style.display = isMember || expanded ? '' : 'none';
            friendButton.dataset.profileGroupMemberState = isMember
              ? 'member'
              : 'available';
          });
      });
    };

    synchronize();
    const timer = window.setInterval(synchronize, 300);
    return () => window.clearInterval(timer);
  }, [directory.friends, expandedGroupIds, groups]);

  return null;
}
