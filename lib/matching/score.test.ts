import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PLATE_CONSONANTS } from '@/lib/plate/chars';
import { normalizePlate } from '@/lib/plate/normalize';
import { parsePlateText } from '@/lib/plate/parse';
import type { Plate, PlateType } from '@/lib/plate/types';
import { scorePlates, type MatchKind } from './score';

const BKK = 'TH-10';
const CNX = 'TH-50';

/** `p('1กข 1234', BKK)` */
function p(text: string, province: string | null = null, type?: PlateType): Plate {
  const parsed = parsePlateText(text, type);
  if (!parsed) throw new Error(`test plate did not parse: ${text}`);
  return normalizePlate({ ...parsed, provinceCode: province });
}

type Case = [description: string, a: Plate, b: Plate, kind: MatchKind | null];

const cases: Case[] = [
  // Exact
  ['identical, same province', p('กข 1234', BKK), p('กข 1234', BKK), 'exact'],
  ['identical with leading digit', p('1กข 1234', BKK), p('1กข 1234', BKK), 'exact'],
  ['identical motorcycle', p('กขค 123', CNX), p('กขค 123', CNX), 'exact'],

  // Same plate, missing information → near, never exact
  ['identical, one province unknown', p('กข 1234', BKK), p('กข 1234'), 'near'],
  ['identical, both provinces unknown', p('กข 1234'), p('กข 1234'), 'near'],
  ['identical, different province (a different plate)', p('กข 1234', BKK), p('กข 1234', CNX), null],

  // One misread
  // Only the number may be near (D-077): any difference in the series is not a match.
  ['ข/ช confusion', p('กข 1234', BKK), p('กช 1234', BKK), null],
  ['ด/ต confusion', p('ดก 1234'), p('ตก 1234'), null],
  ['ภ/ถ confusion', p('ภก 5555', BKK), p('ถก 5555', BKK), null],
  ['8/0 in the number', p('กข 1880', BKK), p('กข 1800', BKK), 'near'],
  ['1/7 in the number', p('กข 1234'), p('กข 7234'), 'near'],
  ['weak confusion อ/ฮ', p('อก 1234', BKK), p('ฮก 1234', BKK), null],
  ['unrelated letter misread', p('กข 1234', BKK), p('ฮข 1234', BKK), null],
  ['unrelated digit misread', p('กข 1234', BKK), p('กข 1235', BKK), 'near'],
  ['adjacent digits swapped', p('กข 1234', BKK), p('กข 1243', BKK), 'near'],
  ['one digit missing', p('กข 1234', BKK), p('กข 123', BKK), 'near'],
  ['one letter missing', p('กข 1234', BKK), p('ก 1234', BKK), null],
  ['leading digit forgotten', p('1กข 1234', BKK), p('กข 1234', BKK), null],
  ['leading digit 1/7 confusion', p('1กข 1234'), p('7กข 1234'), null],
  ['leading digit misread', p('1กข 1234', BKK), p('2กข 1234', BKK), null],
  ['number misread, province unknown', p('กข 1234'), p('กข 1284', BKK), 'near'],
  ['number misread, different province', p('กข 1234', BKK), p('กข 1284', CNX), null],

  // Wildcards
  ['wildcard digit', p('กข 12?4', BKK), p('กข 1234', BKK), 'near'],
  ['wildcard letter', p('ก? 1234', BKK), p('กข 1234', BKK), 'near'],
  ['wildcards on both sides', p('กข 12?4'), p('กข 1?34'), 'near'],
  ['wildcard never gives exact', p('กข 12?4', BKK), p('กข 12?4', BKK), 'near'],
  ['too many wildcards', p('กข ????', BKK), p('กข 1234', BKK), null],

  // Not a match
  ['two unrelated letters differ (same number)', p('กข 1234', BKK), p('มท 1234', BKK), null],
  ['two digits differ', p('กข 1234', BKK), p('กข 1256', BKK), null],
  ['completely different number', p('กข 1234', BKK), p('กข 5678', BKK), null],
  ['confusion plus different province', p('กข 1234', BKK), p('กช 1234', CNX), null],
  ['leading digit misread plus letter confusion', p('1กข 1234'), p('2กช 1234'), null],
  [
    'car vs motorcycle with the same characters',
    p('1กข 123', BKK, 'car'),
    p('1กข 123', BKK, 'motorcycle'),
    null,
  ],
];

describe('scorePlates: realistic examples', () => {
  it.each(cases)('%s', (_, a, b, kind) => {
    expect(scorePlates(a, b).kind).toBe(kind);
    // Symmetric in both kind and score.
    expect(scorePlates(b, a)).toEqual(scorePlates(a, b));
  });
});

describe('scorePlates: scores and details', () => {
  it('scores an exact match 1', () => {
    expect(scorePlates(p('กข 1234', BKK), p('กข 1234', BKK)).score).toBe(1);
  });

  it('ranks a confusable misread above an unrelated one', () => {
    const confusable = scorePlates(p('กข 1234'), p('กช 1234')).score;
    const unrelated = scorePlates(p('กข 1234'), p('กฮ 1234')).score;
    expect(confusable).toBeGreaterThan(unrelated);
  });

  it('ranks a matching province above an unknown one', () => {
    const known = scorePlates(p('กข 1234', BKK), p('กข 1235', BKK)).score;
    const unknown = scorePlates(p('กข 1234', BKK), p('กข 1235')).score;
    expect(known).toBeGreaterThan(unknown);
  });

  it('charges each wildcard a little uncertainty', () => {
    const one = scorePlates(p('กข 12?4'), p('กข 1234')).score;
    const two = scorePlates(p('กข 1??4'), p('กข 1234')).score;
    expect(one).toBeGreaterThan(two);
  });

  it('reports the cost breakdown', () => {
    expect(scorePlates(p('1กข 1234', BKK), p('กช 1235', CNX)).details).toEqual({
      seriesCost: 0.8, // prefix missing 0.5 + ข/ช 0.3
      numberCost: 1,
      wildcards: 0,
      province: 'mismatch',
    });
  });

  it('lets "other" plates match cars (type is often uncertain)', () => {
    const other = normalizePlate({
      type: 'other',
      letters: 'กข',
      number: '1234',
      provinceCode: BKK,
    });
    expect(scorePlates(other, p('กข 1234', BKK)).kind).toBe('exact');
  });

  it('matches single-digit plates with one different digit only when the province agrees', () => {
    expect(scorePlates(p('กข 1', BKK), p('กข 2', BKK)).kind).toBe('near');
    expect(scorePlates(p('กข 1', BKK), p('กข 2')).kind).toBeNull();
  });

  it('never matches a plate without a number', () => {
    const noNumber = normalizePlate({ type: 'car', letters: 'กข', number: '' });
    expect(scorePlates(noNumber, noNumber).kind).toBeNull();
  });
});

describe('scorePlates: properties', () => {
  const letters = fc
    .array(fc.constantFrom(...PLATE_CONSONANTS, '?'), { minLength: 1, maxLength: 2 })
    .map((c) => c.join(''));
  const number = fc
    .array(fc.constantFrom(...'0123456789?'), { minLength: 1, maxLength: 4 })
    .map((c) => c.join(''));
  const prefix = fc.option(fc.constantFrom(...'123456789'), { nil: null });
  const province = fc.option(fc.constantFrom('TH-10', 'TH-50', 'TH-BTG'), { nil: null });
  const plate = fc
    .record({ prefixDigit: prefix, letters, number, provinceCode: province })
    .map((parts) => normalizePlate({ type: 'car', ...parts }));

  it('is symmetric', () => {
    fc.assert(
      fc.property(plate, plate, (a, b) => {
        expect(scorePlates(a, b)).toEqual(scorePlates(b, a));
      }),
    );
  });

  it('stays within 0..1', () => {
    fc.assert(
      fc.property(plate, plate, (a, b) => {
        const { score } = scorePlates(a, b);
        return score >= 0 && score <= 1;
      }),
    );
  });

  it('gives "exact" only for identical, wildcard-free plates in the same known province', () => {
    fc.assert(
      fc.property(plate, plate, (a, b) => {
        if (scorePlates(a, b).kind !== 'exact') return true;
        return (
          a.prefixDigit === b.prefixDigit &&
          a.letters === b.letters &&
          a.number === b.number &&
          a.provinceCode !== null &&
          a.provinceCode === b.provinceCode &&
          !`${a.letters}${a.number}`.includes('?')
        );
      }),
    );
  });

  it('always matches a wildcard-free plate with itself', () => {
    fc.assert(
      fc.property(plate, (a) => {
        if (`${a.letters}${a.number}`.includes('?') || a.number === '0') return true;
        const kind = scorePlates(a, a).kind;
        return a.provinceCode ? kind === 'exact' : kind === 'near';
      }),
    );
  });
});
