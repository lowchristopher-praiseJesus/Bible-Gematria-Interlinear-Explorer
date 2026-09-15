/**
 * The label shown for a note in lists: its title when set, otherwise the
 * first non-empty line of its body (HTML tags stripped), trimmed. Falls
 * back to "Untitled note" when nothing usable is found. Callers truncate
 * with CSS (`truncate`) so the full text stays available to `title` and
 * assistive tech.
 */
export function noteLabel(note: { title?: string; body: string }): string {
  const title = note.title?.trim()
  if (title) return title

  const text = note.body
    .replace(/<\/(p|div|li|h[1-6])>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed) return trimmed
  }
  return 'Untitled note'
}
