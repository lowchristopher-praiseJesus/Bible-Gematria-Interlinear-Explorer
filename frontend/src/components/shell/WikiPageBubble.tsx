import type { MouseEvent } from 'react'
import { useArtifactStore } from '@/store/useArtifactStore'
import type { WikiPageResponse } from '@/types/api'

interface Props {
  data: WikiPageResponse
  /** Clicking a [[wikilink]] cross-reference inside the page opens that
   * concept as a NEW chat message (the study trail), not in the panel. */
  onOpenConcept: (seriesId: string, slug: string, label: string) => void
}

// The page body comes from chatbot/wiki_loader.py (chatbot/wiki_refs.py
// resolves it) already carrying two kinds of plain <a href="..."> link:
// `/topic-wiki?series=<id>&page=<slug>` for a [[wikilink]] cross-reference,
// and `/explorer?reference=<ref>` for a scripture citation. Neither route
// exists in this SPA — intercept both instead of letting the browser
// navigate to a dead page. Only the scripture link opens the artifact
// panel, matching how every other mode treats original-language lookups.
const WIKILINK_HREF_RE = /^\/topic-wiki\?series=([^&]+)&page=([^&]+)/
const SCRIPTURE_HREF_RE = /^\/explorer\?reference=([^&]+)/

export function WikiPageBubble({ data, onOpenConcept }: Props) {
  const openArtifact = useArtifactStore((s) => s.openArtifact)

  function handleClick(e: MouseEvent<HTMLDivElement>) {
    const anchor = (e.target as HTMLElement).closest('a')
    const href = anchor?.getAttribute('href')
    if (!href) return

    const wikilinkMatch = href.match(WIKILINK_HREF_RE)
    if (wikilinkMatch) {
      e.preventDefault()
      onOpenConcept(
        decodeURIComponent(wikilinkMatch[1]),
        decodeURIComponent(wikilinkMatch[2]),
        anchor?.textContent ?? '',
      )
      return
    }

    const scriptureMatch = href.match(SCRIPTURE_HREF_RE)
    if (scriptureMatch) {
      e.preventDefault()
      const reference = decodeURIComponent(scriptureMatch[1])
      openArtifact({
        type: 'interlinear',
        label: `${anchor?.textContent ?? reference} ▸`,
        params: { reference },
      })
    }
  }

  return (
    <div className="mt-2 w-full rounded-xl border border-[var(--color-theme-border)] bg-[var(--color-surface)] px-4 py-3">
      <div className="text-base font-semibold">{data.title}</div>
      <div
        className="text-sm leading-relaxed [&_h2]:font-semibold [&_h2]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_a]:underline"
        onClick={handleClick}
        dangerouslySetInnerHTML={{ __html: data.body_html }}
      />
      <div className="text-xs text-[var(--color-text-secondary)] mt-2">{data.citation}</div>
    </div>
  )
}