/**
 * Human-readable label for a translation code from fetch_verse_translations
 * (e.g. "eng-KJV" -> "KJV"). Most codes are English-version abbreviations
 * that read fine uppercased; a few (like the local CUV Simplified merge)
 * need an explicit override instead.
 */
const OVERRIDES: Record<string, string> = {
  'zho-CUV': '中文和合本',
}

export function translationLabel(code: string): string {
  if (OVERRIDES[code]) return OVERRIDES[code]
  const abbr = code.split('-')[1] ?? code
  return abbr.toUpperCase()
}

/**
 * Pick which translation code a freshly-displayed verse box should default
 * to, given the codes actually available for that verse and the user's
 * preferred abbreviation (from useTranslationSettingsStore, e.g. "KJV" or
 * "CUV"). Falls back to KJV, then whatever the source happened to return
 * first, since not every verse necessarily has every version.
 */
export function pickDefaultTranslationCode(codes: string[], preferredAbbr: string): string {
  return (
    codes.find((c) => c.endsWith(`-${preferredAbbr}`)) ??
    codes.find((c) => c.endsWith('-KJV')) ??
    codes[0]
  )
}
