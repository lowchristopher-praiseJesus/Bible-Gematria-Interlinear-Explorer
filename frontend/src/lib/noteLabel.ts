/**
 * The label shown for a note in lists — its first non-empty line, trimmed.
 * Falls back to "Untitled note" for an empty or whitespace-only body.
 * Callers truncate with CSS (`truncate`) so the full text stays available
 * to `title` and assistive tech.
 */
export function noteLabel(note: { body: string }): string {
  for (const line of note.body.split('\n')) {
    const trimmed = line.trim()
    if (trimmed) return trimmed
  }
  return 'Untitled note'
}
