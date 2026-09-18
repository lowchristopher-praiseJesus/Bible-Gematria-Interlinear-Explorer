import { VerseRangeContent } from '@/components/shell/VerseRangeContent'

/** Deep Study's passage box — the exact same translation-switcher +
 * maximize + clickable-verse-number UI every other mode uses to show Bible
 * text (see ChapterReadingBubble), just always open instead of behind a
 * "Read X ▸" pill. Deep Study's eight phases are commentary *about* the
 * passage, but nowhere else in the mode was the passage itself put in
 * front of the reader. */
export function PassageVerseBox({ reference }: { reference: string }) {
  return <VerseRangeContent reference={reference} />
}
