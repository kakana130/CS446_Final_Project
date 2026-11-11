# Thai licence plate formats

What `lib/plate/` accepts, and why. The rules themselves are data in
[`lib/plate/formats.config.ts`](../lib/plate/formats.config.ts). A plate that fits no rule is
still saved, marked **unverified** (spec §4: never block saving because of format).

Researched 2026-09-27. Sources are listed at the end. Where sources conflict, the conflict and
the resolution are stated.

## Formats

| Rule id                   | Type        | Layout                                                      | Example                               | Notes                                                                                                                                                                                                               |
| ------------------------- | ----------- | ----------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `car-series`              | Private car | optional leading digit 1–9 · 1–2 consonants · number 1–9999 | `กข 1234`, `1กข 1234`, `9กก 9999`     | Two-letter series since 1975 (B.E. 2518). The leading digit was introduced in 2012 (Bangkok first) when two-letter series ran out ("1 กก 1 – 1 กฮ 9999"). A single letter covers pre-1975 plates such as `3ฐ 5639`. |
| `motorcycle-legacy`       | Motorcycle  | 3 consonants (top) · province · number 1–999                | `กขค / เชียงใหม่ / 123`               | Three-line layout; the number is at most three digits.                                                                                                                                                              |
| `motorcycle-digit-series` | Motorcycle  | digit + 2 consonants (top) · province · number 1–9999       | `1กข / กรุงเทพมหานคร / 1234`          | DLT's 2012 format "reduced the letters on the top row and replaced them with a leading digit, with up to 4-digit numbers".                                                                                          |
| `other-series`            | Other       | optional digit · 0–3 consonants or Latin · number 1–9999    | taxi `ทก 1234`, test plates `TC 1234` | Relaxed on purpose: taxis, commercial, rental (green), temporary red plates (ป้ายแดง), auction/graphic plates.                                                                                                      |
| `other-numeric-series`    | Other       | 2–3 digit series · number 1–9999                            | `70-1234`, `701-2345`                 | Buses 10–19, non-scheduled buses 30–35, trucks 70–79 (non-scheduled) and 80–99 (private). Bangkok has used 700+ since 2024 after 70–79 ran out.                                                                     |

**The motorcycle conflict.** English-language sources describe _either_ "three consonants on top,
number 1–999" _or_ "digit + consonants on top, up to 4 digits". Thai sources explain why: both
exist. The three-letter layout is the older format. The leading-digit layout was introduced by
the Department of Land Transport (announced 2011, used from 2012) to extend capacity. Both are
accepted as `valid`. Two consonants _without_ a leading digit fit neither and are flagged
`prefix_required`.

## Characters

- **Series letters:** Thai consonants ก–ฮ except the obsolete **ฃ ฅ** (never issued) and **ฤ ฦ**
  (vowels that sit in the consonant block). Some offensive or confusing combinations (e.g.
  งง, ศพ) are never issued. That is not enforced, because it doesn't help matching.
- **Digits:** plates show Arabic digits. Thai digits typed by users (๐–๙) are converted.
  Leading zeros are dropped (plates never show them). A lone `0` is flagged.
- **Vowels, tone marks, spaces, dashes and dots** are removed during normalization; people type
  them by accident.
- **Wildcard:** `?` means exactly one unreadable character. `？ * _ •` are accepted as aliases.
  A plate with wildcards can be `valid` (the wildcard fits any class); it can never be an
  _exact_ match.

## Provinces

- 77 provinces use their **ISO 3166-2:TH** codes (`TH-10` Bangkok … `TH-96` Narathiwat), from
  `data/provinces.json`.
- **Betong (เบตง)**, a district of Yala, is the only place that registers plates with its
  district name instead of the province. It gets the non-ISO code `TH-BTG`.
- **Pattaya (`TH-S`)** is a special administrative city in ISO 3166-2 but doesn't issue plates;
  it is excluded.
- "ไม่แน่ใจ" (unknown) is stored as `NULL` and is neutral in matching.
- `snapProvince()` maps noisy OCR text to a province: it matches Thai, English and aliases
  (e.g. กทม, โคราช), and returns nothing when two provinces are too close to call.

## Canonical form, key and limits

| Field     | Example                                                               | Purpose                                                  |
| --------- | --------------------------------------------------------------------- | -------------------------------------------------------- |
| canonical | `car\|1\|กข\|1234\|TH-10`                                             | Exact identity (type, prefix, letters, number, province) |
| key       | `1กข1234`, with confusables folded (ข/ช/ซ → one character, 8/0, 1/7…) | Trigram candidate retrieval (`posts.plate_key`)          |
| display   | `1กข 1234`, `กขค 123`, `70-1234`                                      | Shown next to the localized province name                |

Storage limits (`lib/plate/limits.ts`, mirrored in the database): letters ≤ 4, number ≤ 5.
These are one wider than any valid format, so a reading with one extra character is kept as
unverified instead of rejected.

## Look-alike characters

`lib/plate/confusables.config.ts` lists pairs that OCR and people confuse on muddy plates. The
spec's pairs are strong (cost 0.3): ข/ช, ด/ต, บ/ป, ภ/ถ, ผ/พ/ฟ, ฝ/ฟ, ศ/ส, ฎ/ฏ, 8/0 and 1/7. We
added ช/ซ, ษ, and a few weaker pairs (cost 0.5: ค/ด, อ/ฮ, ม/ฆ, ร/ธ, ท/ฑ, ห/ท, 3/8, 5/6, 6/8,
9/0). The costs are starting values for Phase 6 to tune from measured OCR confusion.

## Matching summary

See `lib/matching/score.ts` and `lib/config/thresholds.ts`.

- **exact (ตรงกัน):** identical prefix, letters and number, no wildcards, same _known_ province.
- **near (อาจตรงกัน):** only the number may differ (D-077). The series (leading digit + letters)
  must be the same, except where one side typed `?`. The province must be the same or unknown
  on one side. Similarity must be ≥ 0.7, with at most about one misread in the number:
  - A look-alike digit (8/0, 1/7, 3/8, …) costs 0.3–0.5.
  - An adjacent digit swap costs 0.8; a missing or unrelated digit costs 1.
  - Each wildcard costs a small uncertainty penalty; more than 3 wildcards never match.
- **Province:** same province adds +0.05 to the score; unknown is neutral. A _different_ known
  province is a different plate (the same number exists in every province), never a match.
- Car and motorcycle plates never match each other; "other" can match either.

## Sources

- Wikipedia (EN), _Vehicle registration plates of Thailand_:
  https://en.wikipedia.org/wiki/Vehicle_registration_plates_of_Thailand
- Wikipedia (TH), _ป้ายทะเบียนรถของประเทศไทย_ (series rules, leading digit since 2012,
  numeric series for buses/trucks, Betong, 700+ truck series):
  https://th.wikipedia.org/wiki/ป้ายทะเบียนรถของประเทศไทย
- Thai PBS, _กรมการขนส่งทางบก เริ่มใช้ทะเบียนแบบใหม่ ต.ค.นี้_ (new car series `1 กก 1 – 1 กฮ 9999`;
  new motorcycle format with a leading digit and up to 4 digits):
  https://www.thaipbs.or.th/news/content/114190
- Sanook, _ป้ายทะเบียนรถแบบใหม่ เริ่มใช้ ตุลาคม 2555_ (three-line motorcycle layout; first line
  "ตัวเลขด้านหน้าตัวอักษรประจำหมวดตัวที่หนึ่ง และตัวอักษรประจำหมวดตัวที่สอง"):
  https://guru.sanook.com/8023/
- Chiang Mai Ambassador, _Thai licence plates_ (legacy motorcycle: three consonants, 1–999):
  https://www.chiangmaiambassador.com/license-plates/
- Royal Gazette (ราชกิจจานุเบกษา), vol. 128 part 45 ก, 8 June 2011: the ministerial regulation
  behind the 2012 format. Listed for completeness; its full text was not reviewed here.
  https://www.ratchakitcha.soc.go.th/DATA/PDF/2554/A/045/6.PDF
- ISO 3166-2:TH subdivision codes: https://en.wikipedia.org/wiki/ISO_3166-2:TH

**Still to verify** against DLT primary material before launch: whether any province still
issues two-letter motorcycle series without a leading digit, and whether any current car
series has three letters. Both are handled safely today (saved as unverified and still
matchable).
