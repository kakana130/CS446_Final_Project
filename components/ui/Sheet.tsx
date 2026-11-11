'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/** Space a `fill` sheet keeps for its list when the keyboard leaves little room. */
const MIN_FILL_HEIGHT = 280;

/**
 * Bottom sheet on phones, centred dialog on wider screens. Built on the native <dialog>
 * (showModal): focus is moved in and trapped, Escape closes, the page behind is inert.
 *
 * Phones: opening a sheet closes the on-screen keyboard (focus leaves the text field), and
 * when the keyboard is up (e.g. the user taps a search box inside the sheet) the sheet sits
 * above it and shrinks to the space left, so the choices are never hidden behind it.
 *
 * `fill` (sheets with a search box): the sheet has a fixed height instead of following its
 * content, and on touch screens its top edge stays where it opened. Filtering the list or
 * the keyboard coming and going only moves the bottom edge, so the title and the search box
 * never jump around while the user types.
 */
export function Sheet({
  open,
  onClose,
  title,
  closeLabel,
  fill = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  closeLabel: string;
  fill?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // Space taken by the on-screen keyboard, and the height left above it (null: no keyboard).
  const [keyboard, setKeyboard] = useState<{ height: number; space: number } | null>(null);
  // Where a `fill` sheet sits on a touch screen (null: not measured, or not a touch screen).
  const [place, setPlace] = useState<{ top: number; height: number } | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      // A focused text field keeps the keyboard up over the sheet: let it go first.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!open || !vv) return;
    const touch = window.matchMedia('(pointer: coarse)').matches;
    // The tallest visible height seen while open: the screen without the keyboard. Starts
    // over when the width changes (the phone was turned).
    let tallest = 0;
    let width = vv.width;
    const update = () => {
      const height = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKeyboard(height > 80 ? { height, space: vv.height } : null);
      if (!fill || !touch) return;
      if (vv.width !== width) {
        width = vv.width;
        tallest = 0;
      }
      tallest = Math.max(tallest, vv.height);
      // The top stays 15% down the screen; it only rises when the space above the keyboard
      // is too small for the list (a phone on its side).
      const top = Math.min(Math.round(tallest * 0.15), Math.max(8, vv.height - MIN_FILL_HEIGHT));
      // offsetTop: iOS scrolls the visible area instead of resizing the page.
      setPlace({ top: Math.round(vv.offsetTop + top), height: Math.round(vv.height - top) });
    };
    update();
    // Some browsers only fire one of these when the keyboard goes away; listen to both.
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      setKeyboard(null);
      setPlace(null);
    };
  }, [open, fill]);

  let style: CSSProperties | undefined;
  let innerStyle: CSSProperties | undefined;
  if (fill && place) {
    style = { margin: 0, top: place.top, bottom: 'auto', height: place.height, maxHeight: 'none' };
    innerStyle = { maxHeight: 'none' };
  } else if (keyboard) {
    style = { marginBottom: keyboard.height, maxHeight: Math.round(keyboard.space * 0.9) };
    innerStyle = fill ? undefined : { maxHeight: style.maxHeight };
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        // A click on the backdrop (the dialog element itself) closes it.
        if (e.target === e.currentTarget) onClose();
      }}
      style={style}
      className={`m-0 mt-auto max-h-[85dvh] w-full max-w-none rounded-t-md border-2 border-b-0 border-line bg-surface p-0 text-ink backdrop:bg-[rgb(0_0_0/0.45)] sm:m-auto sm:max-w-lg sm:rounded-md sm:border-b-2 ${fill ? 'h-[85dvh] sm:h-[min(36rem,80dvh)]' : ''}`}
    >
      <div className={`flex max-h-[85dvh] flex-col ${fill ? 'h-full' : ''}`} style={innerStyle}>
        <div className="flex items-center justify-between gap-3 border-b-2 border-line-soft px-4 py-2">
          <h2 id={titleId} className="text-lg font-bold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-sm px-3 font-semibold text-accent-ink underline decoration-2 underline-offset-4"
          >
            {closeLabel}
          </button>
        </div>
        <div className={`overflow-y-auto p-4 ${fill ? 'min-h-0 flex-1' : ''}`}>{children}</div>
      </div>
    </dialog>
  );
}
