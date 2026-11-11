'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { AccountBox } from '@/components/auth/AccountBox';
import { ContactFields, EMPTY_CONTACT, type ContactDraft } from '@/components/forms/ContactFields';
import {
  errorsUnder,
  plateErrorsFrom,
  readDraft,
  useStep,
  writeDraft,
} from '@/components/forms/flow';
import { NoteField } from '@/components/forms/NoteField';
import { OwnPostNotice } from '@/components/own/OwnPostNotice';
import { Turnstile, type TurnstileHandle } from '@/components/forms/Turnstile';
import { useErrorText } from '@/components/forms/useErrorText';
import { PlateInput, type PlateFieldErrors } from '@/components/plate/PlateInput';
import { PlateView } from '@/components/plate/PlateView';
import { ManyFindersAlert } from '@/components/reveal/ManyClaims';
import { FoundResults, type FoundResult } from '@/components/results/FoundResults';
import { Alert } from '@/components/ui/Alert';
import { Button, buttonClass } from '@/components/ui/Button';
import { ConsentField } from '@/components/forms/ConsentField';
import { Checkbox } from '@/components/ui/Field';
import { Stepper } from '@/components/ui/Stepper';
import { Link } from '@/i18n/navigation';
import { CONSENT_VERSION } from '@/lib/config/app';
import { postJson } from '@/lib/client/api';
import { rememberDevicePost } from '@/lib/client/devices';
import { ACCOUNTS_ENABLED } from '@/lib/client/session';
import {
  ownFoundIds,
  ownPostsFor,
  ownPostsReady,
  useOwnPosts,
  type OwnPost,
} from '@/lib/client/own-posts';
import { plateDisplay } from '@/lib/plate/canonical';
import { draftToInput, EMPTY_DRAFT, type PlateDraft } from '@/lib/plate/draft';
import { normalizePlate } from '@/lib/plate/normalize';
import { contactSchema, fieldErrors, noteSchema, plateInputSchema } from '@/lib/validation/schemas';

const STEPS = ['plate', 'contact', 'confirm'] as const;

/** Email alerts through Amazon SNS; on when the deployment sets NEXT_PUBLIC_FEATURE_ALERTS. */
const ALERTS_ENABLED = process.env.NEXT_PUBLIC_FEATURE_ALERTS === 'true';
type Step = (typeof STEPS)[number];
const DRAFT_KEY = 'p2h.draft.lost';

interface Created {
  deviceToken: string;
  batchId: string;
  matches: { matchId: string; kind: 'exact' | 'near' }[];
}

export function LostFlow() {
  const t = useTranslations('lost');
  const tc = useTranslations('common');
  const tContact = useTranslations('contact');
  const tMine = useTranslations('myPosts');
  const errorText = useErrorText();
  const locale = useLocale() as 'th' | 'en';
  const [step, go] = useStep(STEPS);

  const [plate, setPlate] = useState<PlateDraft>(EMPTY_DRAFT);
  const [contact, setContact] = useState<ContactDraft>(EMPTY_CONTACT);
  const [note, setNote] = useState('');
  const [notifyEmail, setNotifyEmail] = useState(false);
  const [consent, setConsent] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const turnstile = useRef<TurnstileHandle>(null);
  const answer = useRef<HTMLDivElement>(null);

  const [plateErrors, setPlateErrors] = useState<PlateFieldErrors>({});
  const [contactErrors, setContactErrors] = useState<Record<string, string | null>>({});
  const [confirmErrors, setConfirmErrors] = useState<Record<string, string | null>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState<{
    for: string;
    results: FoundResult[];
    failed: boolean;
  } | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  // The user already reported this plate lost (D-091): no second report, show theirs.
  const [already, setAlready] = useState<{ for: string; post: OwnPost } | null>(null);
  // Start loading the user's posts now, so the check on "next" rarely has to wait.
  useOwnPosts();
  const [restored, setRestored] = useState(false);

  // Restore the draft after a reload or navigation.
  useEffect(() => {
    const saved = readDraft<{ plate: PlateDraft; contact: ContactDraft; note?: string }>(DRAFT_KEY);
    // Ignore drafts saved by an older version of the form (different shape).
    if (saved && typeof saved.plate?.text === 'string') {
      // Syncing from an external store (sessionStorage) once after hydration; reading it during
      // render would make the server and client markup differ.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPlate(saved.plate);
      setContact(saved.contact);
      setNote(saved.note ?? '');
    }
    setRestored(true);
  }, []);
  useEffect(() => {
    if (restored && !created) writeDraft(DRAFT_KEY, { plate, contact, note });
  }, [plate, contact, note, created, restored]);

  const plateInput = draftToInput(plate);
  const plateKey = JSON.stringify(plateInput);

  // Deep link or reload into a later step without a usable plate: start at step 1.
  const plateUsable = plateInputSchema.safeParse(plateInput).success;
  useEffect(() => {
    if (restored && step !== 'plate' && !created && !plateUsable) go('plate');
  }, [restored, step, created, plateUsable, go]);

  async function checkPlate() {
    setFormError(null);
    const parsed = plateInputSchema.safeParse(plateInput);
    if (!parsed.success) {
      setPlateErrors(plateErrorsFrom(fieldErrors(parsed.error), errorText));
      return;
    }
    setPlateErrors({});
    // Close the phone keyboard so the answer is not hidden behind it.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setBusy(true);
    const ownNow = await ownPostsReady();
    // Already reported by this user (D-091): no second report, but the search still runs, so
    // an owner coming back sees plates found since.
    const mine = ownPostsFor(ownNow, plateInput, 'lost')[0];
    setAlready(mine ? { for: plateKey, post: mine } : null);
    const res = await postJson<{ results: FoundResult[] }>('/api/search', { plate: plateInput });
    setBusy(false);
    // A failed search must not block reporting it lost (matching runs again on submit).
    // The user's own found posts are not "someone found it".
    const mineFound = ownFoundIds(ownNow);
    const results = res.ok ? res.data.results.filter((r) => !mineFound.has(r.postId)) : [];
    // Search first (D-100): the result is shown here; reporting starts only when asked for.
    setSearch({ for: plateKey, results, failed: !res.ok });
    showAnswer();
  }

  /** Bring the answer into view once it has rendered (the plate input is tall on phones). */
  function showAnswer() {
    requestAnimationFrame(() => {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      answer.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    });
  }

  function checkContact() {
    const errs: Record<string, string | null> = {};
    const parsed = contactSchema.safeParse(contact);
    if (!parsed.success) {
      const codes = fieldErrors(parsed.error);
      if (codes.lineId === 'contact_required') errs.contact = errorText('contact_required');
      else Object.assign(errs, errorsUnder(codes, '', errorText));
    }
    const noteParsed = noteSchema.safeParse(note);
    if (!noteParsed.success) errs.note = errorText(noteParsed.error.issues[0]?.message);
    setContactErrors(errs);
    if (Object.values(errs).some(Boolean)) return;
    go('confirm');
  }

  async function submit() {
    setFormError(null);
    const errs: Record<string, string | null> = {};
    if (!consent) errs.consent = errorText('consent_required');
    if (!token) errs.turnstile = errorText('turnstile_required');
    setConfirmErrors(errs);
    if (Object.keys(errs).length) return;

    setBusy(true);
    const res = await postJson<Created>(
      '/api/lost',
      {
        plate: plateInput,
        note,
        contact,
        notifyEmail: ALERTS_ENABLED && notifyEmail && contact.email.trim() !== '',
        consent: true,
        consentVersion: CONSENT_VERSION,
        locale,
        turnstileToken: token,
      },
      0, // Turnstile tokens are single-use: never auto-retry a write.
    );
    setBusy(false);
    turnstile.current?.reset();

    if (!res.ok) {
      if (res.code === 'invalid_input') {
        setPlateErrors(plateErrorsFrom(res.fields, errorText, 'plate.'));
        setContactErrors({
          ...errorsUnder(res.fields, 'contact.', errorText),
          note: errorText(res.fields.note),
        });
        setFormError(errorText('invalid'));
      } else {
        setFormError(errorText(res.code));
      }
      return;
    }

    rememberDevicePost({
      batchId: res.data.batchId,
      kind: 'lost',
      token: res.data.deviceToken,
      labels: [plateDisplay(normalizePlate(plateInput))],
      createdAt: new Date().toISOString(),
    });
    writeDraft(DRAFT_KEY, null);
    setCreated(res.data);
  }

  if (created) {
    return (
      <div className="space-y-5">
        <Alert tone="success" title={t('doneTitle')} live />
        <PlateView plate={normalizePlate(plateInput)} size="md" />
        {created.matches.length > 0 && (
          <Alert tone="highlight" title={t('doneMatches')}>
            <ul className="mt-2 space-y-2">
              {created.matches.map((m) => (
                <li key={m.matchId}>
                  <Link href={`/match/${m.matchId}`} className={buttonClass('primary')}>
                    {t('viewMatch')}
                  </Link>
                </li>
              ))}
            </ul>
          </Alert>
        )}
        <p className="text-ink-muted">{t(ACCOUNTS_ENABLED ? 'doneManage' : 'doneManageDevice')}</p>
        <Link href="/my-posts" className={buttonClass('primary')}>
          {tMine('title')}
        </Link>
        <Link href="/" className={buttonClass('secondary')}>
          {tc('backHome')}
        </Link>
      </div>
    );
  }

  // The search is not a step: the stepper counts only the steps of reporting it lost.
  const index = STEPS.indexOf(step as Step);
  const total = STEPS.length - 1;
  const searchedThis = search?.for === plateKey;
  const reported = already?.for === plateKey;

  return (
    <div>
      {step !== 'plate' && (
        <Stepper
          current={index}
          total={total}
          label={`${tc('step', { current: index, total })} · ${t(`steps.${step}`)}`}
        />
      )}
      {formError && (
        <div className="mb-4">
          <Alert tone="error" title={formError} live />
        </div>
      )}

      {step === 'plate' && (
        <div className="space-y-5">
          <p>{t('plateIntro')}</p>
          <PlateInput
            value={plate}
            onChange={setPlate}
            errors={plateErrors}
            onEnter={() => void checkPlate()}
          />
          <div ref={answer} className="scroll-mt-4 space-y-4">
            {reported && already && <OwnPostNotice post={already.post} variant="lostAgain" />}
            {searchedThis && search.results.length > 0 ? (
              <div className="space-y-4">
                {/* Only "near" results: say so, rather than "someone found it". */}
                {search.results.some((r) => r.kind === 'exact') ? (
                  <Alert tone="highlight" title={t('foundAlready')} live>
                    <p>{t('foundAlreadyBody')}</p>
                  </Alert>
                ) : (
                  <Alert tone="highlight" title={t('foundNear')} live>
                    <p>{t('foundNearBody')}</p>
                  </Alert>
                )}
                {/* Two found posts for the same number are often the front and rear plates. */}
                <ManyFindersAlert count={search.results.filter((r) => r.kind === 'exact').length} />
                <FoundResults results={search.results} />
                {!reported && (
                  <div className="space-y-2 rounded-md border-2 border-line-soft p-3">
                    <p className="text-sm">{t('notYours')}</p>
                    <Button block variant="secondary" onClick={() => go('contact')}>
                      {t('report')}
                    </Button>
                  </div>
                )}
              </div>
            ) : searchedThis && search.failed ? (
              <div className="space-y-3">
                <Alert
                  tone="error"
                  title={t(reported ? 'searchFailedReported' : 'searchFailed')}
                  live
                />
                <Button block busy={busy} busyLabel={t('checking')} onClick={checkPlate}>
                  {t('retry')}
                </Button>
                {!reported && (
                  <Button block variant="secondary" onClick={() => go('contact')}>
                    {t('report')}
                  </Button>
                )}
              </div>
            ) : searchedThis && reported ? null : searchedThis ? (
              <div className="space-y-3">
                <Alert tone="info" title={t('notFoundTitle')} live>
                  <p>{t('notFoundBody')}</p>
                </Alert>
                <Button block onClick={() => go('contact')}>
                  {t('report')}
                </Button>
              </div>
            ) : (
              <Button block busy={busy} busyLabel={t('checking')} onClick={checkPlate}>
                {t('search')}
              </Button>
            )}
          </div>
        </div>
      )}

      {step === 'contact' && (
        <div className="space-y-5">
          {/* Which plate is being reported, now that the search is behind. */}
          {plateUsable && <PlateView plate={normalizePlate(plateInput)} size="sm" />}
          <AccountBox context="post" />
          <ContactFields
            shownTo="finder"
            value={contact}
            onChange={setContact}
            errors={contactErrors}
          />
          {ALERTS_ENABLED && contact.email.trim() && (
            <Checkbox
              label={tContact('notifyEmail')}
              checked={notifyEmail}
              onChange={setNotifyEmail}
            >
              <span className="block text-sm text-ink-muted">{tContact('notifyEmailHint')}</span>
            </Checkbox>
          )}
          <NoteField kind="lost" value={note} onChange={setNote} error={contactErrors.note} />
          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" onClick={() => go('plate')}>
              {tc('back')}
            </Button>
            <Button onClick={checkContact}>{tc('next')}</Button>
          </div>
        </div>
      )}

      {step === 'confirm' && (
        <div className="space-y-5">
          <ConsentField checked={consent} onChange={setConsent} error={confirmErrors.consent} />
          <div>
            <Turnstile ref={turnstile} action="lost_create" onToken={setToken} />
            {confirmErrors.turnstile && !token && (
              <p role="alert" className="text-sm font-semibold text-danger">
                {confirmErrors.turnstile}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" onClick={() => go('contact')}>
              {tc('back')}
            </Button>
            <Button busy={busy} busyLabel={tc('sending')} onClick={submit}>
              {t('submit')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
