import { useEffect } from 'react';

const STORAGE_DEFERRED_NOTE =
  'O upload da capa será liberado quando o Firebase Storage for ativado. As regras já podem ser editadas e salvas normalmente.';

const findButton = (root: ParentNode, text: string): HTMLButtonElement | null =>
  Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(button =>
    button.textContent?.includes(text)
  ) ?? null;

const replaceButtonText = (button: HTMLButtonElement, from: string, to: string) => {
  const textNode = Array.from(button.childNodes).find(
    node => node.nodeType === Node.TEXT_NODE && node.textContent?.includes(from)
  );
  if (textNode?.textContent) {
    textNode.textContent = textNode.textContent.replace(from, to);
  }
};

export function ProfileCommunityStorageDeferredBridge() {
  useEffect(() => {
    let frame = 0;

    const synchronize = () => {
      const inputs = Array.from(
        document.querySelectorAll<HTMLInputElement>(
          'form input[type="file"][accept*="image"]'
        )
      );

      inputs.forEach(input => {
        const form = input.closest<HTMLFormElement>('form');
        if (!form || !form.textContent?.includes('Editar comunidade')) return;

        const coverSection = input.closest<HTMLElement>('section');
        const label = input.closest<HTMLLabelElement>('label');
        if (!coverSection || !label) return;

        input.disabled = true;
        input.setAttribute('aria-disabled', 'true');
        label.dataset.kyrubStorageDeferred = 'true';
        label.style.pointerEvents = 'none';
        label.classList.add('cursor-not-allowed', 'opacity-45');
        label.title = STORAGE_DEFERRED_NOTE;

        const removeButton = findButton(coverSection, 'Remover capa');
        if (removeButton) {
          removeButton.disabled = true;
          removeButton.title = STORAGE_DEFERRED_NOTE;
        }

        if (!coverSection.querySelector('[data-kyrub-storage-deferred-note]')) {
          const note = document.createElement('p');
          note.dataset.kyrubStorageDeferredNote = 'true';
          note.className =
            'mt-2 rounded-2xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[9px] leading-relaxed text-amber-200';
          note.textContent = STORAGE_DEFERRED_NOTE;
          coverSection.append(note);
        }

        const submitButton = form.querySelector<HTMLButtonElement>(
          'button[type="submit"]'
        );
        if (submitButton) {
          replaceButtonText(submitButton, 'Salvar capa e regras', 'Salvar regras');
          submitButton.title = 'Salvar as regras da comunidade';
        }
      });
    };

    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(synchronize);
    };

    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    const interval = window.setInterval(schedule, 700);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(interval);
      observer.disconnect();
    };
  }, []);

  return null;
}
