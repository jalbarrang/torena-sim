import { useLayoutEffect, useState } from 'react';

/** Exposes a native title only when a single-line label is visually clipped. */
export function useTruncatedTitle<T extends HTMLElement>(value: string) {
  const [element, setElement] = useState<T | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useLayoutEffect(() => {
    if (!element) return;

    const update = () => {
      setIsTruncated(element.scrollWidth > element.clientWidth);
    };

    update();

    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, value]);

  return [setElement, isTruncated ? value : undefined] as const;
}
