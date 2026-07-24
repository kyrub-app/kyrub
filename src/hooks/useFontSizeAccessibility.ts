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

type InlineFontSizeState = {
  value: string;
  priority: string;
};

type FontSizeSnapshot = {
  element: HTMLElement;
  computedFontSize: string;
};

const readInlineFontSize = (element: HTMLElement): InlineFontSizeState => ({
  value: element.style.getPropertyValue('font-size'),
  priority: element.style.getPropertyPriority('font-size'),
});

const restoreInlineFontSize = (
  element: HTMLElement,
  state: InlineFontSizeState
): void => {
  if (state.value) {
    element.style.setProperty('font-size', state.value, state.priority);
  } else {
    element.style.removeProperty('font-size');
  }
};

const collectElementSubtree = (root: HTMLElement): HTMLElement[] => [
  root,
  ...Array.from(root.querySelectorAll('*')).filter(
    (element): element is HTMLElement => element instanceof HTMLElement
  ),
];

/**
 * Applies the accessibility font increase to the rendered DOM. Existing
 * elements are adjusted once and are never globally restored/reapplied after
 * clicks. Newly mounted tabs and modals are measured and adjusted separately,
 * preventing the repeated zoom-like animation caused by interaction updates.
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
      InlineFontSizeState
    >();
    const adjustedElements = new Set<HTMLElement>();

    const captureSnapshots = (elements: HTMLElement[]): FontSizeSnapshot[] =>
      elements
        .filter(element => !adjustedElements.has(element))
        .map(element => ({
          element,
          computedFontSize: window.getComputedStyle(element).fontSize,
        }));

    const applySnapshots = (snapshots: FontSizeSnapshot[]): void => {
      for (const { element, computedFontSize } of snapshots) {
        const accessibleFontSize = getAccessibleFontSize(
          computedFontSize,
          increasePx
        );
        if (!accessibleFontSize) continue;

        originalInlineFontSizes.set(element, readInlineFontSize(element));
        element.style.setProperty('font-size', accessibleFontSize, 'important');
        element.setAttribute('data-kyrub-font-adjusted', 'true');
        adjustedElements.add(element);
      }
    };

    const restoreAllAdjustedElements = (): void => {
      for (const element of adjustedElements) {
        const original = originalInlineFontSizes.get(element);
        if (original) restoreInlineFontSize(element, original);
        element.removeAttribute('data-kyrub-font-adjusted');
      }
      adjustedElements.clear();
    };

    const temporarilyRestoreAdjustedAncestors = (
      element: HTMLElement
    ): (() => void) => {
      const restoredAncestors: Array<{
        element: HTMLElement;
        adjusted: InlineFontSizeState;
      }> = [];

      let ancestor = element.parentElement;
      while (ancestor && rootElement.contains(ancestor)) {
        if (adjustedElements.has(ancestor)) {
          const original = originalInlineFontSizes.get(ancestor);
          if (original) {
            restoredAncestors.push({
              element: ancestor,
              adjusted: readInlineFontSize(ancestor),
            });
            restoreInlineFontSize(ancestor, original);
          }
        }
        ancestor = ancestor.parentElement;
      }

      return () => {
        for (let index = restoredAncestors.length - 1; index >= 0; index -= 1) {
          const restored = restoredAncestors[index];
          restoreInlineFontSize(restored.element, restored.adjusted);
        }
      };
    };

    const applyToAddedSubtree = (addedRoot: HTMLElement): void => {
      if (!rootElement.contains(addedRoot)) return;

      // Newly mounted elements may inherit the already enlarged size from an
      // adjusted parent. Restore only their ancestors while measuring, then put
      // those ancestors back immediately before applying the new subtree.
      const restoreAncestors = temporarilyRestoreAdjustedAncestors(addedRoot);
      const snapshots = captureSnapshots(collectElementSubtree(addedRoot));
      restoreAncestors();
      applySnapshots(snapshots);
    };

    applySnapshots(captureSnapshots(collectElementSubtree(rootElement)));

    const observer = new MutationObserver(mutations => {
      const addedRoots: HTMLElement[] = [];

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) addedRoots.push(node);
        }
      }

      const topLevelAddedRoots = addedRoots.filter(
        root => !addedRoots.some(other => other !== root && other.contains(root))
      );

      for (const addedRoot of topLevelAddedRoots) {
        applyToAddedSubtree(addedRoot);
      }

      for (const element of adjustedElements) {
        if (!element.isConnected) adjustedElements.delete(element);
      }
    });

    // Class changes caused by presses, focus and active states are deliberately
    // ignored. Only newly mounted DOM is adjusted, so interaction cannot keep
    // increasing or reanimating existing text.
    observer.observe(rootElement, {
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
      restoreAllAdjustedElements();
    };
  }, [increasePx, rootElementId]);
};
