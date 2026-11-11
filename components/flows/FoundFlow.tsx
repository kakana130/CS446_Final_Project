'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { AccountBox } from '@/components/auth/AccountBox';
import { ContactFields, EMPTY_CONTACT, type ContactDraft } from '@/components/forms/ContactFields';
import { plateErrorsFrom, useStep } from '@/components/forms/flow';
import { NoteField } from '@/components/forms/NoteField';
import { Turnstile, type TurnstileHandle } from '@/components/forms/Turnstile';
import { useErrorText } from '@/components/forms/useErrorText';
import { LostWatchHint } from '@/components/found/LostWatchHint';
import { OwnPostNotice } from '@/components/own/OwnPostNotice';
import { MANUAL_CROP_PADDING, PhotoCropper } from '@/components/found/PhotoCropper';
import { ScanOverlay } from '@/components/found/ScanOverlay';
import { ManyOwnersAlert } from '@/components/reveal/ManyClaims';
import { PlateInput, type PlateFieldErrors } from '@/components/plate/PlateInput';
import { PlateView } from '@/components/plate/PlateView';
import { Alert } from '@/components/ui/Alert';
import { Button, buttonClass, Spinner } from '@/components/ui/Button';
import { Choice } from '@/components/ui/Choice';
import { ConsentField } from '@/components/forms/ConsentField';
import { Field, TextInput } from '@/components/ui/Field';
import { Stepper } from '@/components/ui/Stepper';
import { Link } from '@/i18n/navigation';
import { CONSENT_VERSION, MAX_PLATES_PER_BATCH } from '@/lib/config/app';
import { postForm, postJson } from '@/lib/client/api';
import { ownPostsFor, ownPostsReady, useOwnPosts } from '@/lib/client/own-posts';
import { samePlate } from '@/lib/plate/same';
import { rememberDevicePost } from '@/lib/client/devices';
import { cropToBlob, loadPhoto, type LoadedPhoto, type Rect } from '@/lib/client/image';
import { findPlates, OCR_ENABLED, onOcrLoading, readPlate } from '@/lib/client/ocr';
import { plateDisplay } from '@/lib/plate/canonical';
import { draftToInput, EMPTY_DRAFT, type PlateDraft } from '@/lib/plate/draft';
import { normalizePlate } from '@/lib/plate/normalize';
import {
  contactSchema,
  fieldErrors,
  foundBatchSchema,
  plateInputSchema,
} from '@/lib/validation/schemas';

const STEPS = ['plates', 'details'] as const;

interface Photo {
  id: string;
  status: 'loading' | 'ready' | 'error';
  photo?: LoadedPhoto;
  url?: string;
  /** Automatic plate finding on this photo. */
  scan?: { state: 'scanning' } | { state: 'done'; found: number } | { state: 'failed' };
  /** Boxes proposed by automatic finding; only cut when the user confirms (D-070). */
  suggestions?: Rect[];
}

type UploadState =
  | { state: 'pending' }
  | { state: 'uploading' }
  | { state: 'done'; status: 'active' | 'needs_review'; matches: { matchId: string }[] }
  | { state: 'failed'; code: string };

interface PlateCard {
  id: string;
  blob: Blob;
  url: string;
  draft: PlateDraft;
  errors: PlateFieldErrors;
  upload: UploadState;
  /** Where on which photo it was cut from (outlined on the photo). */
  source: { photoId: string; rect: Rect };
  ocr: { state: 'off' | 'reading' | 'unread' } | { state: 'read'; confidence: number };
}

interface Batch {
  batchId: string;
  uploadToken: string;
  deviceToken: string;
}

const uid = () => crypto.randomUUID();

export function FoundFlow() {
  const t = useTranslations('found');
  const tc = useTranslations('common');
  const tMine = useTranslations('myPosts');
  const tOcr = useTranslations('ocr');
  const errorText = useErrorText();
  const locale = useLocale() as 'th' | 'en';
  const [step, go] = useStep(STEPS);

  const [photos, setPhotos] = useState<Photo[]>([]);
  const [plates, setPlates] = useState<PlateCard[]>([]);
  const [handover, setHandover] = useState<'with_finder' | 'police_station'>('with_finder');
  const [policeNote, setPoliceNote] = useState('');
  const [district, setDistrict] = useState('');
  const [note, setNote] = useState('');
  const [contact, setContact] = useState<ContactDraft>(EMPTY_CONTACT);
  const [consent, setConsent] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const turnstile = useRef<TurnstileHandle>(null);

  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [ocrLoading, setOcrLoading] = useState<number | null>(null);
  const cardCount = useRef(0);
  const own = useOwnPosts();
  const tOwn = useTranslations('own');
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);

  // Release object URLs when the flow unmounts.
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);
  const objectUrl = (blob: Blob) => {
    const u = URL.createObjectURL(blob);
    urls.current.push(u);
    return u;
  };

  // First-time download progress of the OCR engine + Thai model.
  useEffect(
    () =>
      onOcrLoading((progress) => setOcrLoading(progress >= 1 ? null : Math.round(progress * 100))),
    [],
  );

  // Warn before leaving with unsent plates.
  const unsent = plates.some((p) => p.upload.state !== 'done');
  useEffect(() => {
    if (!unsent) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsent]);

  // Photos live in memory only; on a fresh load of step 2 there is nothing to send.
  useEffect(() => {
    if (step === 'details' && plates.length === 0 && !batch) go('plates');
  }, [step, plates.length, batch, go]);

  async function addFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      const id = uid();
      setPhotos((ps) => [...ps, { id, status: 'loading' }]);
      try {
        const photo = await loadPhoto(file);
        const blob = await new Promise<Blob | null>((r) =>
          photo.canvas.toBlob(r, 'image/jpeg', 0.85),
        );
        if (!blob) throw new Error('encode');
        setPhotos((ps) =>
          ps.map((p) => (p.id === id ? { id, status: 'ready', photo, url: objectUrl(blob) } : p)),
        );
        if (OCR_ENABLED) void scanPhoto(id, photo);
      } catch {
        setPhotos((ps) => ps.map((p) => (p.id === id ? { id, status: 'error' } : p)));
      }
    }
  }

  const setScan = (id: string, scan: Photo['scan']) =>
    setPhotos((ps) => ps.map((p) => (p.id === id ? { ...p, scan } : p)));

  /** Find plates in the photo and suggest a box for each; the user adjusts and confirms. */
  async function scanPhoto(id: string, photo: LoadedPhoto) {
    setScan(id, { state: 'scanning' });
    try {
      const found = await findPlates(photo);
      const suggestions = found.map((f) => f.rect);
      setPhotos((ps) => ps.map((p) => (p.id === id ? { ...p, suggestions } : p)));
      setScan(id, { state: 'done', found: found.length });
    } catch {
      setScan(id, { state: 'failed' });
    }
  }

  async function addCrop(
    photoId: string,
    photo: LoadedPhoto,
    rect: Rect,
    opts: { padding?: number } = {},
  ) {
    // Count synchronously: several crops can be added before React re-renders.
    if (cardCount.current >= MAX_PLATES_PER_BATCH) {
      setFormError(t('tooMany', { max: MAX_PLATES_PER_BATCH }));
      return;
    }
    cardCount.current++;
    const blob = await cropToBlob(photo, rect, opts.padding);
    const id = uid();
    setPlates((ps) => [
      ...ps,
      {
        id,
        blob,
        url: objectUrl(blob),
        draft: EMPTY_DRAFT,
        errors: {},
        upload: { state: 'pending' },
        source: { photoId, rect },
        ocr: { state: OCR_ENABLED ? 'reading' : 'off' },
      },
    ]);
    if (!OCR_ENABLED) return;
    // The box the user confirmed is kept as is; OCR only reads it.
    const reading = await readPlate(blob, 'car').catch(() => null);
    setPlates((ps) =>
      ps.map((p) => {
        if (p.id !== id) return p;
        if (!reading) return { ...p, ocr: { state: 'unread' } };
        // Never overwrite what the user already typed.
        const draft = p.draft.text.trim()
          ? p.draft
          : {
              ...p.draft,
              text: reading.text,
              provinceCode: p.draft.provinceCode ?? reading.provinceCode,
            };
        return { ...p, draft, ocr: { state: 'read', confidence: reading.confidence } };
      }),
    );
  }

  const updatePlate = (id: string, patch: Partial<PlateCard>) =>
    setPlates((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  async function checkPlates() {
    setFormError(null);
    if (plates.length === 0) {
      setFormError(t('needPlates'));
      return;
    }
    const checked = plates.map((p) => {
      const parsed = plateInputSchema.safeParse(draftToInput(p.draft));
      return parsed.success
        ? { ...p, errors: {} }
        : { ...p, errors: plateErrorsFrom(fieldErrors(parsed.error), errorText) };
    });
    setPlates(checked);
    if (!checked.every((p) => !p.errors.number && !p.errors.series && !p.errors.provinceCode)) {
      return;
    }
    // A plate the user reported lost themselves is not "found" by someone else (D-091).
    const ownNow = await ownPostsReady();
    if (plates.some((p) => ownPostsFor(ownNow, draftToInput(p.draft), 'lost').length > 0)) {
      setFormError(tOwn('removeOwnLost'));
      return;
    }
    go('details');
  }

  async function uploadPlates(target: Batch, list: PlateCard[]) {
    for (const card of list) {
      if (card.upload.state === 'done') continue;
      updatePlate(card.id, { upload: { state: 'uploading' } });
      const form = new FormData();
      form.set(
        'data',
        JSON.stringify({
          plate: draftToInput(card.draft),
          vehicleWarning: false,
          ocrMinConfidence: card.ocr.state === 'read' ? card.ocr.confidence : null,
        }),
      );
      form.set('crop', card.blob, card.blob.type === 'image/webp' ? 'crop.webp' : 'crop.jpg');
      const res = await postForm<{
        status: 'active' | 'needs_review';
        matches: { matchId: string }[];
      }>(`/api/found/batch/${target.batchId}/plate`, form, {
        'x-upload-token': target.uploadToken,
      });
      if (res.ok) {
        updatePlate(card.id, {
          upload: { state: 'done', status: res.data.status, matches: res.data.matches },
        });
      } else {
        const fields =
          res.code === 'invalid_input' ? plateErrorsFrom(res.fields, errorText, 'plate.') : {};
        updatePlate(card.id, { upload: { state: 'failed', code: res.code }, errors: fields });
      }
    }
  }

  async function submit() {
    setFormError(null);
    const body = {
      contact,
      consent,
      consentVersion: CONSENT_VERSION,
      locale,
      handover,
      policeStationNote: policeNote,
      district,
      note,
      turnstileToken: token ?? '',
    };
    const errs: Record<string, string | null> = {};
    const parsed = foundBatchSchema.safeParse(body);
    if (!parsed.success) {
      for (const [k, v] of Object.entries(fieldErrors(parsed.error))) {
        if (k === 'turnstileToken') continue;
        errs[k] = errorText(v);
      }
    }
    const contactParsed = contactSchema.safeParse(contact);
    if (!contactParsed.success && fieldErrors(contactParsed.error).lineId === 'contact_required') {
      errs['contact.contact'] = errorText('contact_required');
      delete errs['contact.lineId'];
    }
    if (!token) errs.turnstile = errorText('turnstile_required');
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSubmitting(true);
    const res = await postJson<Batch>('/api/found/batch', body, 0);
    turnstile.current?.reset();
    if (!res.ok) {
      setSubmitting(false);
      if (res.code === 'invalid_input') {
        const mapped: Record<string, string | null> = {};
        for (const [k, v] of Object.entries(res.fields)) mapped[k] = errorText(v);
        setErrors(mapped);
        setFormError(errorText('invalid'));
      } else setFormError(errorText(res.code));
      return;
    }
    const created = res.data;
    rememberDevicePost({
      batchId: created.batchId,
      kind: 'found',
      token: created.deviceToken,
      labels: plates.map((p) => plateDisplay(normalizePlate(draftToInput(p.draft)))),
      createdAt: new Date().toISOString(),
    });
    setBatch(created);
    await uploadPlates(created, plates);
    setSubmitting(false);
  }

  async function retryFailed() {
    if (!batch) return;
    setSubmitting(true);
    await uploadPlates(batch, plates);
    setSubmitting(false);
  }

  // ---------------------------------------------------------------- submission / result view
  if (batch) {
    const done = plates.filter((p) => p.upload.state === 'done').length;
    const failed = plates.filter((p) => p.upload.state === 'failed');
    const finished = !submitting && failed.length === 0;
    return (
      <div className="space-y-5">
        {finished ? (
          <Alert tone="success" title={t('doneTitle')} live>
            <p>{t('doneBody')}</p>
          </Alert>
        ) : (
          <p className="font-semibold" aria-live="polite">
            {t('uploading', { done, total: plates.length })}
          </p>
        )}
        <ul className="space-y-3">
          {plates.map((p, i) => (
            <li key={p.id} className="rounded-md border-2 border-line-soft bg-surface p-3">
              <div className="flex flex-wrap items-center gap-3">
                <PlateView plate={normalizePlate(draftToInput(p.draft))} size="sm" />
                <span className="text-sm font-semibold">
                  {p.upload.state === 'uploading' && (
                    <span className="inline-flex items-center gap-2">
                      <Spinner /> {t('plateUploading')}
                    </span>
                  )}
                  {p.upload.state === 'done' && (
                    <span className="text-success">{t('plateDone')}</span>
                  )}
                  {p.upload.state === 'failed' && (
                    <span className="text-danger">
                      {t('plateFailed')}: {errorText(p.upload.code)}
                    </span>
                  )}
                </span>
              </div>
              {p.upload.state === 'done' && p.upload.status === 'needs_review' && (
                <p className="mt-2 text-sm text-ink-muted">{t('reviewNote')}</p>
              )}
              {p.upload.state === 'done' && p.upload.matches.length > 0 && (
                <div className="mt-3 space-y-3">
                  {/* Every person looking for it, not just the first (D-104). */}
                  <Alert
                    tone="highlight"
                    title={
                      p.upload.matches.length > 1
                        ? t('ownersLooking', { count: p.upload.matches.length })
                        : t('ownerLooking')
                    }
                  >
                    <p>{t('ownerLookingBody')}</p>
                    <div className="mt-2 grid gap-2">
                      {p.upload.matches.map((m, k) => {
                        const label =
                          p.upload.state === 'done' && p.upload.matches.length > 1
                            ? t('viewMatchN', { n: k + 1 })
                            : t('viewMatch');
                        return (
                          <Link
                            key={m.matchId}
                            href={`/match/${m.matchId}`}
                            className={buttonClass('primary', true)}
                            aria-label={`${label} · ${t('cardTitle', { n: i + 1 })}`}
                          >
                            {label}
                          </Link>
                        );
                      })}
                    </div>
                  </Alert>
                  <ManyOwnersAlert count={p.upload.matches.length} />
                </div>
              )}
            </li>
          ))}
        </ul>
        {failed.length > 0 && !submitting && (
          <Button block onClick={retryFailed}>
            {t('retryFailed')}
          </Button>
        )}
        {finished && (
          <>
            <p className="text-ink-muted">{t('doneManage')}</p>
            <Link href="/my-posts" className={buttonClass('primary')}>
              {tMine('title')}
            </Link>
            <Link href="/" className={buttonClass('secondary')}>
              {tc('backHome')}
            </Link>
          </>
        )}
      </div>
    );
  }

  const index = STEPS.indexOf(step) + 1;

  return (
    <div>
      <Stepper
        current={index}
        total={STEPS.length}
        label={`${tc('step', { current: index, total: STEPS.length })} · ${t(`steps.${step}`)}`}
      />
      {formError && (
        <div className="mb-4">
          <Alert tone="error" title={formError} live />
        </div>
      )}

      {step === 'plates' && (
        <div className="space-y-5">
          {photos.length === 0 && (
            <>
              <p>{t('intro')}</p>
              <div className="grid grid-cols-2 gap-3">
                <Button onClick={() => cameraInput.current?.click()}>{t('takePhoto')}</Button>
                <Button variant="secondary" onClick={() => galleryInput.current?.click()}>
                  {t('fromGallery')}
                </Button>
              </div>
              <p className="text-sm text-ink-muted">{t('privacyNote')}</p>
            </>
          )}
          <input
            ref={cameraInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={galleryInput}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          {/* While a photo is scanned, its overlay shows the download instead. */}
          {ocrLoading !== null && !photos.some((p) => p.scan?.state === 'scanning') && (
            <p className="inline-flex items-center gap-2 text-sm" aria-live="polite">
              <Spinner /> {tOcr('loading', { percent: ocrLoading })}
            </p>
          )}

          {photos.map((p, i) =>
            p.status === 'ready' && p.photo && p.url ? (
              <div key={p.id}>
                <PhotoCropper
                  status={
                    p.scan &&
                    p.scan.state !== 'scanning' && (
                      <p className="text-sm font-semibold" aria-live="polite">
                        {p.scan.state === 'done' &&
                          (p.scan.found > 0
                            ? tOcr('found', { count: p.scan.found })
                            : tOcr('none'))}
                        {p.scan.state === 'failed' && tOcr('failed')}
                      </p>
                    )
                  }
                  overlay={
                    p.scan?.state === 'scanning' && (
                      <ScanOverlay
                        text={tOcr('scanning')}
                        detail={
                          ocrLoading !== null ? tOcr('loading', { percent: ocrLoading }) : null
                        }
                      />
                    )
                  }
                  photo={p.photo}
                  url={p.url}
                  label={t('photoLabel', { n: i + 1 })}
                  onCrop={(rect) => addCrop(p.id, p.photo!, rect, { padding: MANUAL_CROP_PADDING })}
                  suggestions={p.suggestions}
                  marked={plates.flatMap((c, n) =>
                    c.source.photoId === p.id ? [{ rect: c.source.rect, n: n + 1 }] : [],
                  )}
                  onRemove={() => setPhotos((ps) => ps.filter((x) => x.id !== p.id))}
                />
              </div>
            ) : (
              <div key={p.id} className="rounded-md border-2 border-line-soft p-4">
                {p.status === 'loading' ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner /> {t('loadingPhoto')}
                  </span>
                ) : (
                  <span className="text-danger">{t('photoError')}</span>
                )}
              </div>
            ),
          )}

          {photos.length > 0 && (
            <Button variant="secondary" onClick={() => galleryInput.current?.click()}>
              {t('addPhoto')}
            </Button>
          )}

          {plates.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xl font-bold">{t('checkTitle')}</h2>
              <p className="text-sm text-ink-muted">{t('checkIntro')}</p>
              <ol className="space-y-4">
                {plates.map((p, i) => (
                  <li
                    key={p.id}
                    className="space-y-3 rounded-md border-2 border-line bg-surface p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-lg font-bold">{t('cardTitle', { n: i + 1 })}</h2>
                      <button
                        type="button"
                        onClick={() => {
                          cardCount.current--;
                          setPlates((ps) => ps.filter((x) => x.id !== p.id));
                        }}
                        className="min-h-11 px-2 text-sm font-semibold text-danger underline decoration-2 underline-offset-4"
                      >
                        {t('removePlate')}
                      </button>
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element -- local blob: URL of the crop */}
                    <img
                      src={p.url}
                      alt={t('cropAlt', { n: i + 1 })}
                      className="max-h-40 w-full rounded-sm border-2 border-line-soft object-contain"
                    />
                    {p.ocr.state === 'reading' && (
                      <p className="inline-flex items-center gap-2 text-sm" aria-live="polite">
                        <Spinner /> {tOcr('reading')}
                      </p>
                    )}
                    {p.ocr.state === 'read' && p.ocr.confidence < 0.6 && (
                      <p className="text-sm font-semibold text-danger">{tOcr('lowConfidence')}</p>
                    )}
                    {p.ocr.state === 'unread' && <p className="text-sm">{tOcr('unread')}</p>}
                    <PlateInput
                      value={p.draft}
                      onChange={(draft) => updatePlate(p.id, { draft })}
                      errors={p.errors}
                      unreadable
                    />
                    {(() => {
                      const input = draftToInput(p.draft);
                      if (!plateInputSchema.safeParse(input).success) return null;
                      const mineLost = ownPostsFor(own, input, 'lost')[0];
                      if (mineLost) return <OwnPostNotice post={mineLost} variant="ownLost" />;
                      const mineFound = ownPostsFor(own, input, 'found')[0];
                      const plate = normalizePlate(input);
                      const twin = plates
                        .slice(0, i)
                        .findIndex((o) => samePlate(normalizePlate(draftToInput(o.draft)), plate));
                      return (
                        <>
                          {mineFound && <OwnPostNotice post={mineFound} variant="foundAgain" />}
                          {twin >= 0 && (
                            <p className="text-sm text-ink-muted">
                              {tOwn('sameInBatch', { n: twin + 1 })}
                            </p>
                          )}
                          <LostWatchHint draft={p.draft} />
                        </>
                      );
                    })()}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {plates.length > 0 && (
            <Button block onClick={() => void checkPlates()}>
              {t('nextToDetails')}
            </Button>
          )}
        </div>
      )}

      {step === 'details' && (
        <div className="space-y-6">
          <div className="space-y-3">
            <Choice
              legend={t('whereTitle')}
              value={handover}
              onChange={setHandover}
              options={[
                { value: 'with_finder', label: t('withFinder') },
                { value: 'police_station', label: t('atPolice') },
              ]}
              columns={1}
            />
            {handover === 'police_station' && (
              <Field
                label={t('policeNote')}
                hint={t('policeNoteHint')}
                error={errors.policeStationNote}
              >
                {({ inputId, describedBy, invalid }) => (
                  <TextInput
                    id={inputId}
                    aria-describedby={describedBy}
                    aria-invalid={invalid || undefined}
                    value={policeNote}
                    maxLength={120}
                    onChange={(e) => setPoliceNote(e.target.value)}
                  />
                )}
              </Field>
            )}
            {/* LEGAL-TODO(found-property): wording to be confirmed. */}
            <p className="text-sm text-ink-muted">{t('legalNote')}</p>
          </div>

          <Field
            label={t('district')}
            hint={t('districtHint')}
            optional={tc('optional')}
            error={errors.district}
          >
            {({ inputId, describedBy, invalid }) => (
              <TextInput
                id={inputId}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                value={district}
                maxLength={80}
                onChange={(e) => setDistrict(e.target.value)}
              />
            )}
          </Field>

          <NoteField kind="found" value={note} onChange={setNote} error={errors.note} />

          <AccountBox context="post" />
          <ContactFields
            shownTo="owner"
            value={contact}
            onChange={setContact}
            errors={Object.fromEntries(
              Object.entries(errors)
                .filter(([k]) => k.startsWith('contact.'))
                .map(([k, v]) => [k.slice('contact.'.length), v]),
            )}
          />

          <ConsentField checked={consent} onChange={setConsent} error={errors.consent} />

          <div>
            <Turnstile ref={turnstile} action="found_batch" onToken={setToken} />
            {errors.turnstile && !token && (
              <p role="alert" className="text-sm font-semibold text-danger">
                {errors.turnstile}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" onClick={() => go('plates')}>
              {tc('back')}
            </Button>
            <Button busy={submitting} busyLabel={tc('sending')} onClick={submit}>
              {t('submit', { count: plates.length })}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
