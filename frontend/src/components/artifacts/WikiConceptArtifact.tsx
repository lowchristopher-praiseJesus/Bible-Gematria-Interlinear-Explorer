import type { MouseEvent } from 'react'
import { useArtifactStore } from '@/store/useArtifactStore'
import type { WikiPageResponse } from '@/types/api'

interface Props {
  data: WikiPageResponse
}

// The page body comes from chatbot/wiki_loader.py (chatbot/wiki_refs.py
// resolves it) already carrying two kinds of plain <a href="..."> link:
// `/topic-wiki?series=<id>&page=<slug>` for a [[wikilink]] cross-reference,
// and `/explorer?reference=<ref>` for a scripture citation. Neither route
// exists in this SPA — intercept both and open the right Artifact instead
// of letting the browser navigate to a dead page.
const WIKILINK_HREF_RE = /^\/topic-wiki\?series=([^&]+)&page=([^&]+)/
const SCRIPTURE_HREF_RE = /^\/explorer\?reference=([^&]+)/

export function WikiConceptArtifact({ data }: Props) {
  const openArtifact = useArtifactStore((s) => s.openArtifact)

  function handleClick(e: MouseEvent<HTMLDivElement>) {
    const anchor = (e.target as HTMLElement).closest('a')
    const href = anchor?.getAttribute('href')
    if (!href) return

    const wikilinkMatch = href.match(WIKILINK_HREF_RE)
    if (wikilinkMatch) {
      e.preventDefault()
      const seriesId = decodeURIComponent(wikilinkMatch[1])
      const slug = decodeURIComponent(wikilinkMatch[2])
      openArtifact({
        type: 'wiki_concept',
        label: `${anchor?.textContent ?? slug} ▸`,
        params: { seriesId, slug },
      })
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
    <div className="flex flex-col gap-2">
      <div className="text-lg font-semibold">{data.title}</div>
      <div className="text-sm leading-relaxed [&_h2]:font-semibold [&_h2]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_a]:underline" onClick={handleClick} dangerouslySetInnerHTML={{ __html: data.body_html }} />
      <div className="text-xs text-[var(--color-text-secondary)] mt-2">{data.citation}</div>
    </div>
  )
}
