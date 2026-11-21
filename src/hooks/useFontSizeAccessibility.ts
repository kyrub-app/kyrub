import { useEffect } from 'react';

export const ACCESSIBILITY_FONT_INCREASE_PX = 4;
// Catu/Renda body text renders at 14px (10px + 4px); minor UI text may
// be 1px smaller, but operational/financial text must not render below 13px.
export const MIN_ACCESSIBLE_TEXT_PX = 13;

export const getAccessibleFontSize = (
  computedFontSize: string,
  increasePx = ACCESSIBILITY_FONT_INCREASE_PX
): string | null => {
  const currentSize = Number.parseFloat(computedFontSize);

  if (
    !Number.isFinite(currentSize) ||
    currentSize <= 0 ||
    !Number.isFinite(increasePx) || increasePx < 0
  ) {
    return null;
  }

  const adjustedSize = Number(Math.max(
    currentSize + increasePx,
    increasePx > 0 ? MIN_ACCESSIBLE_TEXT_PX : currentSize
  ).toFixed(4));
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

const PORTAL_TYPOGRAPHY_SELECTOR = '[data-kyrub-font-scope="true"]';
// The modal layout bridge already scales these panels with its CSS rules.
// Skip their descendants so the root/portal observer never applies +4px twice.
const SPECIALIZED_TYPOGRAPHY_SELECTOR =
  '[data-kyrub-font-managed="true"], [data-kyrub-top-panel="true"]';

const collectElementSubtree = (root: HTMLElement): HTMLElement[] => [
  root,
  ...Array.from(root.querySelectorAll('*')).filter(
    (element): element is HTMLElement => element instanceof HTMLElement
  ),
];

/**
 * Applies the accessibility font increase to the rendered DOM. Existing
 * elements are adjusted once and are never globally restored/reapplied after
 * clicks. Explicitly marked portal panels get the same +4px accessibility
 * baseline as the Renda workspace; unrelated third-party portals are not
 * touched. Operational ERP and Control Plane content inside #root retain the
 * same baseline. Specialized modal panels skip duplicate scaling. Newly
 * mounted controls inherit the rule without zooming again.
 */
export const useFontSizeAccessibility = (
  rootElementId = 'root',
  increasePx = ACCESSIBILITY_FONT_INCREASE_PX
): void => {
  useEffect(() => {
    const rootElement = document.getElementById(rootElementId);
    if (!rootElement) return;

    const isWithinManagedScope = (element: HTMLElement): boolean =>
      rootElement.contains(element) || Boolean(element.closest(PORTAL_TYPOGRAPHY_SELECTOR));

    const originalInlineFontSizes = new WeakMap<
      HTMLElement,
      InlineFontSizeState
    >();
    const adjustedElements = new Set<HTMLElement>();

    const captureSnapshots = (elements: HTMLElement[]): FontSizeSnapshot[] =>
      elements
        .filter(element =>
          !adjustedElements.has(element) &&
          !element.closest(SPECIALIZED_TYPOGRAPHY_SELECTOR)
        )
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

    const restoreAdjustedElement = (element: HTMLElement): void => {
      const original = originalInlineFontSizes.get(element);
      if (original) restoreInlineFontSize(element, original);
      element.removeAttribute('data-kyrub-font-adjusted');
      adjustedElements.delete(element);
    };

    const restoreAllAdjustedElements = (): void => {
      for (const element of [...adjustedElements]) {
        restoreAdjustedElement(element);
      }
    };

    const temporarilyRestoreAdjustedAncestors = (
      element: HTMLElement
    ): (() => void) => {
      const restoredAncestors: Array<{
        element: HTMLElement;
        adjusted: InlineFontSizeState;
      }> = [];

      let ancestor = element.parentElement;
      while (ancestor && isWithinManagedScope(ancestor)) {
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
      if (!isWithinManagedScope(addedRoot)) return;

      // Newly mounted elements may inherit the already enlarged size from an
      // adjusted parent. Restore only their ancestors while measuring, then put
      // those ancestors back immediately before applying the new subtree.
      const restoreAncestors = temporarilyRestoreAdjustedAncestors(addedRoot);
      const snapshots = captureSnapshots(collectElementSubtree(addedRoot));
      restoreAncestors();
      applySnapshots(snapshots);
    };

    // A portal may already be mounted by the time this effect is registered.
    // Keep its elements independent from #root so no node is enlarged twice.
    const existingPortals = Array.from(
      document.querySelectorAll<HTMLElement>(PORTAL_TYPOGRAPHY_SELECTOR)
    ).filter(portal => !rootElement.contains(portal));
    applySnapshots(captureSnapshots([
      ...collectElementSubtree(rootElement),
      ...existingPortals.flatMap(collectElementSubtree),
    ]));

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

      // Restore detached nodes before forgetting them. If React later reuses a
      // node, it returns with its original size instead of receiving another 4px.
      for (const element of [...adjustedElements]) {
        if (!element.isConnected) restoreAdjustedElement(element);
      }
    });

    // Class changes caused by presses, focus and active states are deliberately
    // ignored. Only newly mounted DOM is adjusted, so interaction cannot keep
    // increasing or reanimating existing text.
    // React portals are direct body children, outside #root. The scope marker
    // ensures the broader observer skips notifications from unrelated widgets.
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
      restoreAllAdjustedElements();
    };
  }, [increasePx, rootElementId]);
};
