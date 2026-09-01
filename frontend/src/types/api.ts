export interface VerseInfo {
  id: number
  ref: string
  bnum: number
  cnum: number
  vnum: number
  Ch: string
  wordnum: number
  letternum: number
  total: number
  text1769: string
  textAV1611: string
  language: 'Hebrew' | 'Greek'
  originalText: string
  stephanusText: string | null
  stephanusTotal: number | null
  lcFiles: string[]
  hasQere: boolean
  code: string | null
  alert: string | null
}

export interface Navigation {
  previous: number
  next: number
}

export interface KJVWord {
  kjvText: string
  strongsNumber: string
  root: string
  rootTranslit: string
  rootTranslit2: string
  rootVal: number
}

export interface OriginalWord {
  strongsNumber: string
  translit: string
  translit2: string
  wordHtml: string
  value: number
  isQere: boolean
  asn: string | null
  gsn: string | null
  gsnParts: string[] | null
  addStrongs: string[] | null
}

export interface StrongsDefinition {
  strongsNumber: string
  root: string
  transliteration: string
  transliteration1: string
  transliteration2: string
  partOfSpeech: string
  meaning: string
  strongsDefinition: string
  outline: string | null
  note: string | null
  usageCount: number
  verseCount: number
  bookCount: number
  value: number
}

export interface ExplorerResponse {
  verse: VerseInfo
  navigation: Navigation
  kjvWords: KJVWord[]
  originalWords: OriginalWord[]
  strongsDefinitions: Record<string, StrongsDefinition>
}

export interface ChapterVerse {
  versenumber: number
  vnum: number
  ref: string
  translations: Record<string, string>
}

export interface ChapterResponse {
  book: string
  chapter: number
  verseCount: number
  verses: ChapterVerse[]
}

export interface ApocResponse {
  isApocrypha: true
  reference: string
  text: string
  previous: string
  next: string
}

export interface StrongsRef {
  id: number
  ref: string
  bnum: number
  cnum: number
  vnum: number
}

export interface StrongsBookGroup {
  book: string
  refs: StrongsRef[]
}

export interface StrongsResponse {
  definition: StrongsDefinition | null
  verses: StrongsBookGroup[]
  resultSummary: string
}

export interface GematriaWordResult {
  id: number
  ref: string
  bnum: number
  cnum: number
  vnum: number
  strongsNumber: string
  wordHtml: string
  language: string
  snTranslit: string
  snMeaning: string
}

export interface GematriaVerseResult {
  id: number
  ref: string
  bnum: number
  cnum: number
  vnum: number
  total: number
  text1769: string
}

export interface MatchPosition {
  start: number
  length: number
}

export interface GematriaResponse {
  wordResults: GematriaWordResult[]
  verseResults: GematriaVerseResult[]
  strongsDefinitions: Record<string, StrongsDefinition>
  resultSummaryWords: string
  resultSummaryVerses: string
}

export interface EnglishResult {
  id: number
  ref: string
  bnum: number
  cnum: number
  vnum: number
  text: string
  matchPositions: MatchPosition[]
}

export interface EnglishResponse {
  searchTerm: string
  results: EnglishResult[]
  resultSummary: string
}

export interface BooksResponse {
  books: string[]
  booksLower: string[]
  refs: Record<string, [number, Record<number, number>]>
}

export interface BookContextResponse {
  book: string
  book_name: string
  sections: Record<string, string | null>
}
