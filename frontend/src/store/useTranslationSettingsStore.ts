import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// The abbreviation suffix of a translation code (e.g. "eng-KJV" -> "KJV"),
// not the full code — the same suffix pattern recurs under different
// language prefixes (this app currently only has "eng-" and "zho-"), and
// matching on the suffix alone is what lets a single setting apply
// regardless of which language prefix a given verse's codes use.
export const DEFAULT_TRANSLATION_ABBR = 'KJV'

interface TranslationSettingsState {
  defaultTranslationAbbr: string
  setDefaultTranslationAbbr: (abbr: string) => void
}

export const useTranslationSettingsStore = create<TranslationSettingsState>()(
  persist(
    (set) => ({
      defaultTranslationAbbr: DEFAULT_TRANSLATION_ABBR,
      setDefaultTranslationAbbr: (abbr) => set({ defaultTranslationAbbr: abbr }),
    }),
    { name: 'bible-explorer-translation-settings', version: 1 }
  )
)
