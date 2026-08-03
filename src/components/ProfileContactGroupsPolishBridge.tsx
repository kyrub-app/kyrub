import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Plus } from 'lucide-react';

type GroupHeaderTarget = {
  groupName: string;
  target: HTMLElement;
};

const sameTargets = (
  current: GroupHeaderTarget[],
  next: GroupHeaderTarget[]
): boolean =>
  current.length === next.length &&
  current.every((item, index) => {
    const candidate = next[index];
    return (
      item.groupName === candidate?.groupName &&
      item.target === candidate?.target
    );
  });

const selectedMemberButton = (button: HTMLButtonElement): boolean =>
  button.className.includes('border-violet-500/40');

export function ProfileContactGroupsPolishBridge() {
  const [openGroupName, setOpenGroupName] = useState<string | null>(null);
  const [headerTargets, setHeaderTargets] = useState<GroupHeaderTarget[]>([]);

  useEffect(() => {
    const synchronize = () => {
      const modal = document.getElementById('profile-social-hub-modal');
      if (!modal) {
        setHeaderTargets(current => (current.length ? [] : current));
        return;
      }

      const nextTargets: GroupHeaderTarget[] = [];
      const deleteButtons = modal.querySelectorAll<HTMLButtonElement>(
        'button[aria-label^="Excluir grupo "]'
      );

      deleteButtons.forEach(deleteButton => {
        const section = deleteButton.closest<HTMLElement>('section');
        const header = deleteButton.parentElement;
        const memberGrid = section?.children.item(1) as HTMLElement | null;
        const groupName = deleteButton
          .getAttribute('aria-label')
          ?.replace(/^Excluir grupo\s+/, '')
          .trim();

        if (!section || !header || !memberGrid || !groupName) return;

        section.dataset.profileContactGroup = groupName;
        memberGrid.dataset.profileContactGroupMembers = groupName;

        let slot = header.querySelector<HTMLElement>(
          '[data-profile-contact-group-add-slot="true"]'
        );
        if (!slot) {
          slot = document.createElement('div');
          slot.dataset.profileContactGroupAddSlot = 'true';
          deleteButton.insertAdjacentElement('beforebegin', slot);
        }

        nextTargets.push({ groupName, target: slot });

        const pickerOpen = openGroupName === groupName;
        const memberButtons = [...memberGrid.children].filter(
          (item): item is HTMLButtonElement =>
            item instanceof HTMLButtonElement
        );

        let selectedCount = 0;
        memberButtons.forEach(button => {
          const selected = selectedMemberButton(button);
          if (selected) selectedCount += 1;
          button.dataset.profileContactGroupMember = selected
            ? 'selected'
            : 'available';
          button.style.display = pickerOpen || selected ? '' : 'none';
        });

        let emptyState = memberGrid.querySelector<HTMLElement>(
          '[data-profile-contact-group-empty="true"]'
        );
        if (!emptyState) {
          emptyState = document.createElement('div');
          emptyState.dataset.profileContactGroupEmpty = 'true';
          emptyState.className =
            'rounded-2xl border border-dashed border-slate-700 bg-slate-950 px-4 py-5 text-center text-[9px] text-slate-500 sm:col-span-2';
          memberGrid.appendChild(emptyState);
        }

        if (!pickerOpen && selectedCount === 0) {
          emptyState.textContent =
            'Nenhuma pessoa adicionada. Toque em + para incluir contatos.';
          emptyState.style.display = '';
        } else if (pickerOpen && memberButtons.length === selectedCount) {
          emptyState.textContent =
            'Todos os seus conectados já fazem parte deste grupo.';
          emptyState.style.display = '';
        } else {
          emptyState.style.display = 'none';
        }
      });

      if (
        openGroupName &&
        !nextTargets.some(item => item.groupName === openGroupName)
      ) {
        setOpenGroupName(null);
      }

      setHeaderTargets(current =>
        sameTargets(current, nextTargets) ? current : nextTargets
      );
    };

    synchronize();
    const timer = window.setInterval(synchronize, 250);

    return () => {
      window.clearInterval(timer);
      document
        .querySelectorAll<HTMLElement>(
          '[data-profile-contact-group-add-slot="true"], [data-profile-contact-group-empty="true"]'
        )
        .forEach(element => element.remove());
      document
        .querySelectorAll<HTMLButtonElement>(
          '[data-profile-contact-group-member]'
        )
        .forEach(button => {
          button.style.display = '';
          delete button.dataset.profileContactGroupMember;
        });
    };
  }, [openGroupName]);

  return (
    <>
      {headerTargets.map(({ groupName, target }) => {
        const pickerOpen = openGroupName === groupName;
        return createPortal(
          <button
            type="button"
            onClick={() =>
              setOpenGroupName(current =>
                current === groupName ? null : groupName
              )
            }
            className={`flex h-9 w-9 items-center justify-center rounded-xl border ${
              pickerOpen
                ? 'border-violet-400/50 bg-violet-500 text-white'
                : 'border-violet-500/25 bg-violet-500/10 text-violet-300'
            }`}
            aria-label={
              pickerOpen
                ? `Concluir inclusão no grupo ${groupName}`
                : `Adicionar pessoas ao grupo ${groupName}`
            }
            title={pickerOpen ? 'Concluir inclusão' : 'Adicionar pessoas'}
          >
            {pickerOpen ? (
              <Check className="h-4 w-4" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
          </button>,
          target,
          groupName
        );
      })}
    </>
  );
}
