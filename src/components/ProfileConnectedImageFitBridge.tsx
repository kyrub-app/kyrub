import { useEffect } from 'react';

const escapeCssUrl = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export function ProfileConnectedImageFitBridge() {
  useEffect(() => {
    const synchronize = () => {
      document
        .querySelectorAll<HTMLElement>(
          '#profile-social-hub-modal [data-profile-connected-media="true"]'
        )
        .forEach(media => {
          const image = media.querySelector<HTMLImageElement>('img');
          if (!image?.src) {
            media.style.removeProperty('--profile-connected-image');
            return;
          }

          media.style.setProperty(
            '--profile-connected-image',
            `url("${escapeCssUrl(image.src)}")`
          );
        });
    };

    synchronize();
    const timer = window.setInterval(synchronize, 400);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <style>{`
      #profile-social-hub-modal [data-profile-connected-media="true"] {
        background: #020617 !important;
      }

      #profile-social-hub-modal [data-profile-connected-media="true"]::before {
        content: '';
        position: absolute;
        inset: -24px;
        z-index: 0;
        background-image: var(--profile-connected-image);
        background-position: center;
        background-size: cover;
        filter: blur(20px) saturate(.86);
        opacity: .68;
        transform: scale(1.08);
        pointer-events: none;
      }

      #profile-social-hub-modal [data-profile-connected-media="true"]::after {
        z-index: 3 !important;
      }

      #profile-social-hub-modal [data-profile-connected-media="true"] > img {
        position: relative !important;
        z-index: 2 !important;
        width: 100% !important;
        height: 100% !important;
        object-fit: contain !important;
        object-position: center !important;
      }

      #profile-social-hub-modal [data-profile-connected-media="true"] > span[role="img"] {
        position: relative !important;
        z-index: 2 !important;
      }
    `}</style>
  );
}
