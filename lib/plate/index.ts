export * from './types';
export { PLATE_CONSONANTS, isPlateConsonant } from './chars';
export { normalizePlate, hasWildcards, cleanChars } from './normalize';
export { validatePlate } from './validate';
export { FORMAT_RULES, rulesFor, type FormatRule } from './formats.config';
export { CONFUSABLE_GROUPS, confusableCost, foldConfusables } from './confusables.config';
export { canonical, plateKey, plateDisplay, buildPlateRecord, type PlateRecord } from './canonical';
export {
  PROVINCES,
  provinceByCode,
  provinceName,
  isKnownProvince,
  searchProvinces,
  snapProvince,
  type Province,
} from './provinces';
export { parsePlateText } from './parse';
export { PLATE_LIMITS, clampToLimits } from './limits';
