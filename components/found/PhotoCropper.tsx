'use client';

import { useTranslations } from 'next-intl';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Button } from '@/components/ui/Button';
import {
  anchorFor,
  contains,
  coveredBy,
  defaultBox,
  moveBox,
  nudgeBox,
  type Corner,
  type Point,
} from '@/lib/client/cropbox';
import {
  MIN_CROP_EDGE,
  normalizeDrag,
  padRect,
  type LoadedPhoto,
  type Rect,
} from '@/lib/client/image';

/** Margin added around the box when cutting (the preview shows exactly this). */
export const MANUAL_CROP_PADDING = 0.02;

const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];
const CORNER_POS: Record<Corner, string> = {
  nw: 'left-0 top-0 cursor-nwse-resize',
  ne: 'left-full top-0 cursor-nesw-resize',
  sw: 'left-0 top-full cursor-nesw-resize',
  se: 'left-full top-full cursor-nwse-resize',
};

type Drag =
  | { kind: 'draw'; from: Point; before: Rect | null }
  | { kind: 'move'; offset: Point }
  | { kind: 'resize'; anchor: Point };

const usable = (b: Rect | null): b is Rect =>
  b !== null && b.width >= MIN_CROP_EDGE && b.height >= MIN_CROP_EDGE / 2;

/**
 * Crop plates out of a photo, always under the user's control (D-070):
 *  - a box to move (drag inside), resize (drag a corner) or redraw (drag outside it), also with
 *    the keyboard (arrows move, Shift+arrows resize);
 *  - automatic finding only *suggests* boxes (dashed); the best one is placed first, tapping
 *    another selects it, and nothing is cut until "Add this plate" (or "Add all N plates found");
 *  - a live preview shows exactly what will be cut;
 *  - plates already cut stay outlined with their card number.
 * Coordinates are in photo pixels.
 */
export function PhotoCropper({
  photo,
  url,
  label,
  onCrop,
  onRemove,
  marked = [],
  suggestions = [],
  status,
  overlay,
}: {
  photo: LoadedPhoto;
  url: string;
  label: string;
  onCrop: (rect: Rect) => Promise<void>;
  onRemove: () => void;
  /** Plates already cut from this photo, labelled with their card number. */
  marked?: { rect: Rect; n: number }[];
  /** Boxes proposed by automatic finding, best first. */
  suggestions?: Rect[];
  /** Automatic-finding progress/result line, shown in the card. */
  status?: ReactNode;
  /** Shown over the photo itself, e.g. while plates are being looked for. */
  overlay?: ReactNode;
}) {
  const t = useTranslations('found');
  const surface = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const touched = useRef(false);
  // The same, for rendering: whether the user has placed a box themselves.
  const [touchedBox, setTouchedState] = useState(false);
  const setTouched = (v: boolean) => {
    touched.current = v;
    setTouchedState(v);
  };
  const [box, setBoxState] = useState<Rect | null>(() => defaultBox(photo.width, photo.height));
  // Latest box for pointer handlers (several events can arrive before a re-render).
  const boxRef = useRef<Rect | null>(box);
  const setBox = (b: Rect | null) => {
    boxRef.current = b;
    setBoxState(b);
  };
  const [busy, setBusy] = useState(false);
  // Folded once its plates are added and nothing is left to suggest; unfolds on request.
  const [expanded, setExpanded] = useState(false);

  const isCut = (r: Rect) => marked.some((m) => coveredBy(r, m.rect) > 0.6);
  const open = suggestions.filter((s) => !isCut(s));

  // Until the user touches the box, it follows the best suggestion that isn't cut yet.
  const firstOpen = open[0];
  useEffect(() => {
    if (!touched.current && firstOpen) setBox(firstOpen);
  }, [firstOpen]);

  // Live preview of exactly what will be cut.
  useEffect(() => {
    const canvas = preview.current;
    if (!canvas || !usable(box)) return;
    const r = padRect(box, photo.width, photo.height, MANUAL_CROP_PADDING);
    const scale = Math.min(1, 480 / r.width);
    canvas.width = Math.max(1, Math.round(r.width * scale));
    canvas.height = Math.max(1, Math.round(r.height * scale));
    canvas
      .getContext('2d')
      ?.drawImage(photo.canvas, r.x, r.y, r.width, r.height, 0, 0, canvas.width, canvas.height);
  }, [box, photo]);

  const toPhoto = (e: { clientX: number; clientY: number }): Point => {
    const r = surface.current!.getBoundingClientRect();
    return {
      x: Math.min(photo.width, Math.max(0, ((e.clientX - r.left) / r.width) * photo.width)),
      y: Math.min(photo.height, Math.max(0, ((e.clientY - r.top) / r.height) * photo.height)),
    };
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (busy) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setTouched(true);
    const p = toPhoto(e);
    const box = boxRef.current;
    const corner = (e.target as HTMLElement).closest<HTMLElement>('[data-corner]')?.dataset
      .corner as Corner | undefined;
    if (box && corner) drag.current = { kind: 'resize', anchor: anchorFor(box, corner) };
    else if (box && contains(box, p)) {
      drag.current = { kind: 'move', offset: { x: p.x - box.x, y: p.y - box.y } };
    } else drag.current = { kind: 'draw', from: p, before: box };
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = toPhoto(e);
    const box = boxRef.current;
    if (d.kind === 'move' && box) {
      setBox(moveBox(box, { x: p.x - d.offset.x, y: p.y - d.offset.y }, photo.width, photo.height));
    } else if (d.kind === 'resize') {
      setBox(normalizeDrag(d.anchor, p, photo.width, photo.height));
    } else if (d.kind === 'draw') {
      setBox(normalizeDrag(d.from, p, photo.width, photo.height));
    }
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    // A tap or a tiny slip keeps the box the user had.
    if (d?.kind !== 'move' && !usable(boxRef.current)) {
      setBox(d?.kind === 'draw' ? d.before : null);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!box || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    setTouched(true);
    const step = Math.max(1, Math.round(photo.width / 100));
    setBox(
      nudgeBox(
        box,
        e.key as 'ArrowLeft',
        step,
        e.shiftKey,
        photo.width,
        photo.height,
        MIN_CROP_EDGE,
      ),
    );
  };

  const cut = async (rects: Rect[]) => {
    setBusy(true);
    try {
      for (const r of rects) await onCrop(r);
      // Next: the next suggestion that isn't cut yet, if any.
      const next = suggestions.find((s) => !isCut(s) && !rects.includes(s));
      setTouched(false);
      setBox(next ?? null);
      if (!next) setExpanded(false);
    } finally {
      setBusy(false);
    }
  };

  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const place = (r: Rect) => ({
    left: pct(r.x, photo.width),
    top: pct(r.y, photo.height),
    width: pct(r.width, photo.width),
    height: pct(r.height, photo.height),
  });

  const caption = (
    <figcaption className="flex items-center justify-between gap-2">
      <span className="font-semibold">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        className="min-h-11 px-2 text-sm font-semibold text-danger underline decoration-2 underline-offset-4"
      >
        {t('removePhoto')}
      </button>
    </figcaption>
  );

  if (marked.length > 0 && open.length === 0 && !expanded && !busy) {
    return (
      <figure className="space-y-2 rounded-md border-2 border-line-soft bg-surface p-2">
        {caption}
        <div className="flex items-center gap-3">
          <div className="relative w-28 shrink-0 overflow-hidden rounded-sm">
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob: URL of the user's own photo */}
            <img src={url} alt="" className="block w-full" />
            {marked.map(({ rect, n }) => (
              <div
                key={`m${n}`}
                aria-hidden="true"
                className="absolute border-2 border-accent"
                style={place(rect)}
              />
            ))}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-semibold text-success">
              {t('addedFromPhoto', { count: marked.length })}
            </p>
            <Button
              variant="secondary"
              onClick={() => {
                setExpanded(true);
                setTouched(false);
                setBox(defaultBox(photo.width, photo.height));
              }}
            >
              {t('addMoreFromPhoto')}
            </Button>
          </div>
        </div>
      </figure>
    );
  }

  // While plates are looked for, the default box would only be a guess: the photo stays
  // clear under the overlay until a suggestion arrives or the user draws one (D-098).
  const shown = overlay && !touchedBox ? null : box;

  return (
    <figure className="space-y-3 rounded-md border-2 border-line-soft bg-surface p-2">
      {caption}
      {status}
      <p className="text-sm text-ink-muted">
        {shown ? t('cropHint') : t('drawHint')}
        {open.length > 1 && ` ${t('pickAnother')}`}
      </p>
      <div
        ref={surface}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="relative cursor-crosshair touch-none select-none overflow-hidden rounded-sm"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- local blob: URL of the user's own photo */}
        <img src={url} alt="" draggable={false} className="block w-full" />
        {marked.map(({ rect, n }) => (
          <div
            key={`m${n}`}
            aria-hidden="true"
            className="pointer-events-none absolute border-[3px] border-accent"
            style={place(rect)}
          >
            <span className="absolute left-0 top-0 bg-accent px-1.5 text-sm font-bold text-on-accent">
              {n}
            </span>
          </div>
        ))}
        {open.map((s, i) =>
          s === box ? null : (
            <button
              key={`s${i}`}
              type="button"
              aria-label={t('suggestionLabel', { n: i + 1 })}
              onPointerDown={(e) => {
                // Select instead of starting a new box underneath.
                e.stopPropagation();
                setTouched(true);
                setBox(s);
              }}
              onClick={() => setBox(s)}
              className="absolute border-[3px] border-dashed border-accent"
              style={place(s)}
            />
          ),
        )}
        {shown && (
          <div
            role="group"
            tabIndex={0}
            aria-label={t('boxLabel')}
            onKeyDown={onKey}
            className="absolute cursor-move border-[3px] border-accent shadow-[0_0_0_9999px_rgb(0_0_0/0.45)] focus-visible:outline-4"
            style={place(shown)}
          >
            {CORNERS.map((c) => (
              <span
                key={c}
                data-corner={c}
                aria-hidden="true"
                className={`absolute flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center ${CORNER_POS[c]}`}
              >
                <span className="pointer-events-none size-4 rounded-full border-2 border-ink bg-accent" />
              </span>
            ))}
          </div>
        )}
        {overlay}
      </div>

      {usable(shown) && (
        <div className="space-y-1">
          <p className="text-sm font-semibold">{t('previewLabel')}</p>
          <canvas
            ref={preview}
            role="img"
            aria-label={t('previewLabel')}
            className="max-h-32 max-w-full rounded-sm border-2 border-line-soft"
          />
        </div>
      )}

      {/* One main action: all found plates when there are several, else this box (D-084). */}
      <div className={overlay && !shown ? 'hidden' : 'grid gap-2'}>
        {open.length > 1 ? (
          <>
            <Button busy={busy} onClick={() => cut(open)}>
              {t('cropAllSuggested', { count: open.length })}
            </Button>
            <Button
              variant="secondary"
              disabled={busy || !usable(box)}
              onClick={() => usable(box) && cut([box])}
            >
              {t('cropSelected')}
            </Button>
          </>
        ) : (
          <Button disabled={!usable(box)} busy={busy} onClick={() => usable(box) && cut([box])}>
            {t('cropThis')}
          </Button>
        )}
      </div>
      <p className="flex flex-wrap items-center gap-x-1 text-sm text-ink-muted">
        {t('useWholeHint')}
        <button
          type="button"
          disabled={busy}
          onClick={() => cut([{ x: 0, y: 0, width: photo.width, height: photo.height }])}
          className="inline-flex min-h-11 items-center px-1 font-semibold text-accent-ink underline decoration-2 underline-offset-4 disabled:opacity-60"
        >
          {t('useWhole')}
        </button>
      </p>
    </figure>
  );
}
