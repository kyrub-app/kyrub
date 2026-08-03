import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, onSnapshot } from 'firebase/firestore';
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

const findFriendForButton = (
  button: HTMLButtonElement,
  friends: Friend[],
  usedIds: Set<string>
): Friend | undefined => {
  const visibleTexts = [...button.querySelectorAll<HTMLElement>('span')]
    .map(item => normalizeText(item.textContent))
    .filter(Boolean);
  const friendName = visibleTexts.find(text =>
    friends.some(friend => normalizeText(friend.name) === text)
  );

  if (!friendName) return undefined;

  return friends.find(
    friend =>
      !usedIds.has(friend.id) &&
      normalizeText(friend.name) === friendName
  );
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

          setGroups(current =>
            sameGroups(current, next) ? current : next
          );
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
    let frame = 0;

    const synchronize = () => {
      const profileModal = document.getElementById(
        'profile-social-hub-modal'
      );
      if (!profileModal) return;

      for (const group of groups) {
        const heading = [...profileModal.querySelectorAll<HTMLElement>('h4')]
          .find(item => normalizeText(item.textContent) === group.name);
        const section = heading?.closest<HTMLElement>('section');
        if (!heading || !section) continue;

        const header = heading.parentElement?.parentElement as HTMLElement | null;
        const memberGrid = [...section.children].find(child =>
          child instanceof HTMLElement &&
          child.className.includes('grid') &&
          child.querySelector('button')
        ) as HTMLElement | undefined;
        if (!header || !memberGrid) continue;

        let toggleButton = section.querySelector<HTMLButtonElement>(
          `[data-profile-group-add-people="${group.id}"]`
        );

        if (!toggleButton) {
          toggleButton = document.createElement('button');
          toggleButton.type = 'button';
          toggleButton.dataset.profileGroupAddPeople = group.id;
          toggleButton.className =
            'flex h-10 w-full items-center justify-center rounded-xl border border-violet-500/30 bg-violet-500/10 text-[9px] font-black uppercase text-violet-200';
          toggleButton.addEventListener('click', () => {
            setExpandedGroupIds(current => {
              const next = new Set(current);
              if (next.has(group.id)) next.delete(group.id);
              else next.add(group.id);
              return next;
            });
          });
          header.insertAdjacentElement('afterend', toggleButton);
        }

        const expanded = expandedGroupIds.has(group.id);
        const availableCount = directory.friends.filter(
          friend => !group.memberIds.includes(friend.id)
        ).length;
        const nextLabel = expanded
          ? 'Concluir inclusão'
          : `Adicionar pessoas${availableCount > 0 ? ` (${availableCount})` : ''}`;

        if (toggleButton.textContent !== nextLabel) {
          toggleButton.textContent = nextLabel;
        }
        toggleButton.disabled = !expanded && availableCount === 0;
        toggleButton.style.opacity =
          !expanded && availableCount === 0 ? '0.45' : '1';

        const usedIds = new Set<string>();
        memberGrid
          .querySelectorAll<HTMLButtonElement>('button')
          .forEach(friendButton => {
            const friend = findFriendForButton(
              friendButton,
              directory.friends,
              usedIds
            );
            if (!friend) return;
            usedIds.add(friend.id);

            const isMember = group.memberIds.includes(friend.id);
            friendButton.style.display = isMember || expanded ? '' : 'none';
            friendButton.dataset.profileGroupMemberState = isMember
              ? 'member'
              : 'available';
          });
      }
    };

    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(synchronize);
    };

    synchronize();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [directory.friends, expandedGroupIds, groups]);

  return null;
}
