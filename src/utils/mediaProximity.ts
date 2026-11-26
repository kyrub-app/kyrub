// Keep video URLs unattached until the slide approaches the viewport.
export const observeMediaProximity = (
  element: Element,
  ready: () => void,
  Observer: typeof IntersectionObserver | undefined = typeof IntersectionObserver === 'undefined' ? undefined : IntersectionObserver,
): (() => void) => {
  let active = true;
  let observer: IntersectionObserver | undefined;
  const finish = () => {
    if (!active) return;
    active = false;
    observer?.disconnect();
    ready();
  };
  if (!Observer) {
    finish();
    return () => {};
  }
  try {
    observer = new Observer(entries => {
      if (entries.some(entry => entry.target === element && entry.isIntersecting)) finish();
    }, { rootMargin: '200px 0px', threshold: 0 });
    observer.observe(element);
  } catch {
    finish();
  }
  return () => {
    active = false;
    observer?.disconnect();
  };
};
