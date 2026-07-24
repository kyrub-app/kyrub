import { useEffect } from 'react';

export const ACCESSIBILITY_FONT_INCREASE_PX = 4;

export const getAccessibleFontSize = (
  computedFontSize: string,
  increasePx = ACCESSIBILITY_FONT_INCREASE_PX
): string | null => {
  const currentSize = Number.parseFloat(computedFontSize);

  if (
    !Number.isFinite(currentSize) ||
    currentSize <= 0 ||
    !Number.isFinite(increasePx)
  ) {
    return null;
  }

  const adjustedSize = Number((currentSize + increasePx).toFixed(4));
  return `${adjustedSize}px`;
};

type OriginalInlineFontSize = {
  value: string;
  priority: string;
};

/**
 * Applies the accessibility font increase to the rendered DOM instead of only
 * transforming build-time CSS. This also covers authenticated screens,
 * dynamically mounted tabs, modals and arbitrary Tailwind font-size classes.
 */
export const useFontSizeAccessibility = (
  rootElementId = 'root',
  increasePx = ACCESSIBILITY_FONT_INCREASE_PX
): void => {
  useEffect(() => {
    const rootElement = document.getElementById(rootElementId);
    if (!rootElement) return;

    const originalInlineFontSizes = new WeakMap<
      HTMLElement,
      OriginalInlineFontSize
    >();
    const adjustedElements = new Set<HTMLElement>();
    let animationFrameId: number | null = null;
    let observer: MutationObserver;

    const restoreAdjustedElements = () => {
      for (const element of adjustedElements) {
        const original = originalInlineFontSizes.get(element);
        if (!original) continue;

        if (original.value) {
          element.style.setProperty(
            'font-size',
            original.value,
            original.priority
          );
        } else {
          element.style.removeProperty('font-size');
        }

        element.removeAttribute('data-kyrub-font-adjusted');
      }

      adjustedElements.clear();
    };

    const applyFontIncrease = () => {
      animationFrameId = null;
      observer.disconnect();
      restoreAdjustedElements();

      const elements = [
        rootElement,
        ...Array.from(rootElement.querySelectorAll('*')),
      ].filter((element): element is HTMLElement => element instanceof HTMLElement);

      // Capture every original computed value before changing any parent. This
      // prevents nested elements from receiving the increase more than once.
      const snapshots = elements.map(element => ({
        element,
        computedFontSize: window.getComputedStyle(element).fontSize,
      }));

      for (const { element, computedFontSize } of snapshots) {
        const accessibleFontSize = getAccessibleFontSize(
          computedFontSize,
          increasePx
        );
        if (!accessibleFontSize) continue;

        originalInlineFontSizes.set(element, {
          value: element.style.getPropertyValue('font-size'),
          priority: element.style.getPropertyPriority('font-size'),
        });

        element.style.setProperty('font-size', accessibleFontSize, 'important');
        element.setAttribute('data-kyrub-font-adjusted', 'true');
        adjustedElements.add(element);
      }

      observer.observe(rootElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
      });
    };

    const scheduleFontIncrease = () => {
      if (animationFrameId !== null) return;
      animationFrameId = window.requestAnimationFrame(applyFontIncrease);
    };

    observer = new MutationObserver(scheduleFontIncrease);
    applyFontIncrease();

    return () => {
      observer.disconnect();
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
      restoreAdjustedElements();
    };
  }, [increasePx, rootElementId]);
};
