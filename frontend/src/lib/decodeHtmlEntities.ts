/**
 * Decode HTML entities (e.g. "&#8220;" -> "“") in plain text pulled from
 * external sources (fetch_verse_translations' BibleHub/eBible scrape).
 * Assigning to a <textarea>'s innerHTML only ever decodes entities — the
 * textarea content model (RCDATA) never parses child tags, so this can't
 * execute markup the way dangerouslySetInnerHTML on a normal element could.
 */
export function decodeHtmlEntities(text: string): string {
  if (!text) return text
  const textarea = document.createElement('textarea')
  textarea.innerHTML = text
  return textarea.value
}
