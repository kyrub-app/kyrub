import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
} from 'react';
import { createPortal } from 'react-dom';
import {
  BarChart3,
  Camera,
  Compass,
  FileBadge,
  Fingerprint,
  Megaphone,
  Rocket,
  X,
} from 'lucide-react';
import { ProfileCampaignManager } from './ProfileCampaignManager';

type SecureShortcut = {
  label: string;
  fullLabel: string;
  icon: ComponentType<{ className?: string }>;
};

const secureShortcuts: SecureShortcut[] = [
  { label: 'Docs', fullLabel: 'Documentos', icon: FileBadge },
  { label: 'Bio', fullLabel: 'Biometria', icon: Fingerprint },
  { label: 'Face', fullLabel: 'ValidaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o facial', icon: Camera },
];

const sameTarget = <T extends HTMLElement>(current: T | null, next: T | null) =>
  current === next ? current : next;

const buttonWithText = (
  root: ParentNode,
  label: string
): HTMLButtonElement | null =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    button => button.textContent?.trim() === label
  ) ?? null;

export function ProfileNextPolishBridge() {
  const [squareTarget, setSquareTarget] = useState<HTMLElement | null>(null);
  const [secureTarget, setSecureTarget] = useState<HTMLElement | null>(null);
  const [metricsSponsorTarget, setMetricsSponsorTarget] =
    useState<HTMLElement | null>(null);
  const [squareActive, setSquareActive] = useState(false);
  const [activeSecureLabel, setActiveSecureLabel] = useState('Perfil');

  const squareButtonRef = useRef<HTMLButtonElement | null>(null);
  const sponsorButtonRef = useRef<HTMLButtonElement | null>(null);
  const secureButtonsRef = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    const synchronize = () => {
      const profileModal = document.getElementById('profile-social-hub-modal');
      let nextSquareTarget: HTMLElement | null = null;

      if (profileModal) {
        const savedButton = profileModal.querySelector<HTMLButtonElement>(
          'button[aria-label="Abrir publicaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âµes salvas"]'
        );
        const actionGroup = savedButton?.parentElement ?? null;
        const profileNavigation = profileModal.querySelector<HTMLElement>(
          'nav[aria-label="SeÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âµes do perfil"]'
        );
        const squareButton = profileNavigation
          ? buttonWithText(profileNavigation, 'PraÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§a')
          : null;

        squareButtonRef.current = squareButton;
        setSquareActive(current => {
          const next = Boolean(squareButton?.className.includes('bg-orange-500'));
          return current === next ? current : next;
        });

        if (actionGroup && savedButton && squareButton) {
          let target = actionGroup.querySelector<HTMLElement>(
            '[data-profile-square-shortcut-slot="true"]'
          );
          if (!target) {
            target = document.createElement('div');
            target.dataset.profileSquareShortcutSlot = 'true';
            savedButton.insertAdjacentElement('beforebegin', target);
          }
          nextSquareTarget = target;
          squareButton.style.display = 'none';

          if (profileNavigation) {
            profileNavigation.style.display = 'grid';
            profileNavigation.style.gridTemplateColumns =
              'repeat(3, minmax(0, 1fr))';
            profileNavigation.style.overflowX = 'visible';
            profileNavigation
              .querySelectorAll<HTMLButtonElement>('button')
              .forEach(button => {
                if (button !== squareButton) {
                  button.style.width = '100%';
                  button.style.minWidth = '0';
                }
              });
          }
        }
      } else {
        squareButtonRef.current = null;
      }

      setSquareTarget(current => sameTarget(current, nextSquareTarget));

      const editCloseButton = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Fechar ediÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o"]'
      );
      const editForm = editCloseButton?.closest('form') ?? null;
      let nextSecureTarget: HTMLElement | null = null;

      if (editForm) {
        const originalNav = editForm.querySelector<HTMLElement>(
          'nav[aria-label="SeÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âµes de ediÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o e seguranÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§a"]'
        );
        const profileButton = originalNav?.querySelector<HTMLButtonElement>(
          'button[aria-label="Perfil"]'
        );
        const galleryButton = buttonWithText(editForm, 'Galeria');
        const controls = galleryButton?.parentElement ?? null;
        const photoRow = controls?.parentElement ?? null;
        const contentTarget = editForm.querySelector<HTMLElement>(
          '[data-profile-edit-security-content="true"]'
        );

        if (originalNav && profileButton && controls && photoRow) {
          secureShortcuts.forEach(shortcut => {
            const originalButton = originalNav.querySelector<HTMLButtonElement>(
              `button[aria-label="${shortcut.fullLabel}"]`
            );
            secureButtonsRef.current[shortcut.fullLabel] = originalButton;
            if (originalButton) originalButton.style.display = 'none';
          });

          const activeButton = originalNav.querySelector<HTMLButtonElement>(
            'button[aria-current="page"]'
          );
          const nextActive = activeButton?.getAttribute('aria-label') || 'Perfil';
          setActiveSecureLabel(current =>
            current === nextActive ? current : nextActive
          );

          originalNav.style.width = 'fit-content';
          originalNav.style.maxWidth = '150px';
          originalNav.style.overflowX = 'visible';
          const originalGrid = originalNav.firstElementChild as HTMLElement | null;
          if (originalGrid) {
            originalGrid.style.minWidth = '0';
            originalGrid.style.gridTemplateColumns = 'minmax(104px, 140px)';
          }

          controls.style.flex = '1';
          controls.style.minWidth = '0';
          photoRow.style.alignItems = 'flex-start';
          photoRow.style.display = 'flex';
          delete photoRow.dataset.profileEditNativeContent;

          let target = controls.querySelector<HTMLElement>(
            '[data-profile-secure-shortcuts-slot="true"]'
          );
          if (!target) {
            target = document.createElement('div');
            target.dataset.profileSecureShortcutsSlot = 'true';
            controls.appendChild(target);
          }
          nextSecureTarget = target;

          if (contentTarget && contentTarget.previousElementSibling !== photoRow) {
            photoRow.insertAdjacentElement('afterend', contentTarget);
          }
        }
      } else {
        secureButtonsRef.current = {};
      }

      setSecureTarget(current => sameTarget(current, nextSecureTarget));

      const metricsHeading = [...document.querySelectorAll<HTMLElement>('h3')]
        .find(item => item.textContent?.trim() === 'MÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©tricas da publicaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o');
      const metricsSection = metricsHeading?.closest('section') ?? null;
      let nextMetricsSponsorTarget: HTMLElement | null = null;

      if (metricsSection) {
        const metricsGrid = metricsSection.querySelector<HTMLElement>(
          'div.grid.grid-cols-2'
        );
        const sponsorButton = buttonWithText(
          metricsSection,
          'Patrocinar publicaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o'
        );
        sponsorButtonRef.current = sponsorButton;

        if (metricsGrid && sponsorButton) {
          let target = metricsGrid.querySelector<HTMLElement>(
            '[data-profile-metrics-sponsor-slot="true"]'
          );
          if (!target) {
            target = document.createElement('div');
            target.dataset.profileMetricsSponsorSlot = 'true';
            metricsGrid.appendChild(target);
          }
          nextMetricsSponsorTarget = target;
          sponsorButton.style.display = 'none';

        }
      } else {
        sponsorButtonRef.current = null;
      }

      setMetricsSponsorTarget(current =>
        sameTarget(current, nextMetricsSponsorTarget)
      );
    };

    synchronize();
    const timer = window.setInterval(synchronize, 250);
    return () => {
      window.clearInterval(timer);
      document
        .querySelectorAll<HTMLElement>(
          '[data-profile-square-shortcut-slot="true"], [data-profile-secure-shortcuts-slot="true"], [data-profile-metrics-sponsor-slot="true"]'
        )
        .forEach(target => target.remove());
    };
  }, []);

  return (
    <>
      {squareTarget &&
        createPortal(
          <button
            type="button"
            onClick={() => squareButtonRef.current?.click()}
            className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${
              squareActive
                ? 'border-orange-500 bg-orange-500 text-slate-950'
                : 'border-sky-500/30 bg-sky-500/10 text-sky-300'
            }`}
            aria-label="Abrir PraÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§a"
            title="PraÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§a"
          >
            <Compass className="h-5 w-5" />
          </button>,
          squareTarget
        )}

      {secureTarget &&
        createPortal(
          <nav
            className="grid grid-cols-3 gap-1.5 pt-2"
            aria-label="Atalhos seguros do perfil"
          >
            {secureShortcuts.map(shortcut => {
              const Icon = shortcut.icon;
              const active = activeSecureLabel === shortcut.fullLabel;
              return (
                <button
                  key={shortcut.fullLabel}
                  type="button"
                  onClick={() =>
                    secureButtonsRef.current[shortcut.fullLabel]?.click()
                  }
                  className={`flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-xl border px-1 text-[8px] font-black uppercase ${
                    active
                      ? 'border-orange-500 bg-orange-500 text-slate-950'
                      : 'border-slate-800 bg-slate-900 text-slate-400'
                  }`}
                  aria-current={active ? 'page' : undefined}
                  aria-label={shortcut.fullLabel}
                >
                  <Icon className="h-4 w-4" />
                  <span className="truncate">{shortcut.label}</span>
                </button>
              );
            })}
          </nav>,
          secureTarget
        )}

      {metricsSponsorTarget &&
        createPortal(
          <button
            type="button"
            onClick={() => sponsorButtonRef.current?.click()}
            className="flex min-h-[104px] w-full flex-col items-start justify-between rounded-2xl border border-orange-500/30 bg-orange-500/10 p-3 text-left text-orange-200"
            aria-label="Patrocinar publicaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o"
          >
            <Rocket className="h-5 w-5" />
            <span className="text-[9px] font-black uppercase leading-tight">
              Patrocinar publicaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£o
            </span>
          </button>,
          metricsSponsorTarget
        )}

      <ProfileCampaignManager />

    </>
  );
}
