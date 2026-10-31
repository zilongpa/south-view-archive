'use client';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

type Size = { width?: number; height?: number };
const storageKey = 'south-view-detail-size';
const limits = {
  width: (viewport: number) => ({ min: 300, max: Math.max(320, Math.min(760, viewport * 0.65)) }),
  height: (viewport: number) => ({ min: 260, max: Math.round(viewport * 0.92) }),
};
const phone = () =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches;
const clamp = (value: number, range: { min: number; max: number }) =>
  Math.round(Math.min(range.max, Math.max(range.min, value)));

/**
 * Lets the map's person panel be dragged wider on a desktop and taller on a phone. The size is
 * exposed as CSS variables on the explorer so the map controls keep clear of the panel, and it is
 * remembered per browser.
 */
export function useDetailResize() {
  const [size, setSize] = useState<Size>({});
  const [resizing, setResizing] = useState(false);
  const start = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const panel = useRef<HTMLElement | null>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Size | null;
      if (saved && typeof saved === 'object')
        setSize({
          width: typeof saved.width === 'number' ? saved.width : undefined,
          height: typeof saved.height === 'number' ? saved.height : undefined,
        });
    } catch {
      /* A default size is fine. */
    }
  }, []);
  const remember = useCallback((value: Size) => {
    const next: Size = {
      ...(value.width ? { width: value.width } : {}),
      ...(value.height ? { height: value.height } : {}),
    };
    setSize(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* The size then lasts for this page view only. */
    }
  }, []);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const element = panel.current ?? (event.currentTarget.parentElement as HTMLElement | null);
    if (!element) return;
    panel.current = element;
    const box = element.getBoundingClientRect();
    start.current = { x: event.clientX, y: event.clientY, width: box.width, height: box.height };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* Synthetic or released pointers cannot be captured; dragging still works. */
    }
    setResizing(true);
    event.preventDefault();
  }, []);
  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const origin = start.current;
    if (!origin) return;
    if (phone())
      setSize((current) => ({
        ...current,
        height: clamp(
          origin.height + (origin.y - event.clientY),
          limits.height(window.innerHeight),
        ),
      }));
    else
      setSize((current) => ({
        ...current,
        width: clamp(origin.width + (origin.x - event.clientX), limits.width(window.innerWidth)),
      }));
  }, []);
  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!start.current) return;
      start.current = null;
      setResizing(false);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        /* Capture may already be gone. */
      }
      setSize((current) => {
        remember(current);
        return current;
      });
    },
    [remember],
  );
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = 24;
      const element = event.currentTarget.parentElement;
      if (!element) return;
      const box = element.getBoundingClientRect();
      if (phone()) {
        const delta = event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0;
        if (!delta) return;
        event.preventDefault();
        remember({ ...size, height: clamp(box.height + delta, limits.height(window.innerHeight)) });
      } else {
        const delta = event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0;
        if (!delta) return;
        event.preventDefault();
        remember({ ...size, width: clamp(box.width + delta, limits.width(window.innerWidth)) });
      }
    },
    [remember, size],
  );

  const style = {
    ...(size.width ? { '--detail-width': `${size.width}px` } : {}),
    ...(size.height ? { '--detail-height': `${size.height}px` } : {}),
  } as CSSProperties;
  const handle = (
    <div
      className="detail-resize"
      role="separator"
      aria-label="Resize the person panel. Drag, or use the arrow keys."
      aria-orientation={typeof window !== 'undefined' && phone() ? 'horizontal' : 'vertical'}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    />
  );
  const panelClass = `${size.height ? 'is-resized' : ''} ${resizing ? 'is-resizing' : ''}`.trim();
  return { style, handle, panelClass };
}
