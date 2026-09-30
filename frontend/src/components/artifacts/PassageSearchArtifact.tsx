import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { VerseRangeContent } from '@/components/shell/VerseRangeContent'
import { useArtifactStore } from '@/store/useArtifactStore'
import type { PassageResult, PassageSearchArtifactParams } from '@/types/session'

/** The passage's verse box (translation switcher, fullscreen compare), mounted
 * only once the card is near the viewport — each box fetches on mount, so a
 * long result list would otherwise fire every request at once. Until then, and
 * if the fetch fails, the server-sent KJV snippet is shown. Without
 * IntersectionObserver the box mounts immediately. */
function LazyVerseBox({ passage }: { passage: PassageResult }) {
  const ref = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    const el = ref.current
    if (near || !el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [near])

  const snippet = (
    <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">{passage.text}</p>
  )
  return (
    <div ref={ref}>
      {near ? <VerseRangeContent reference={passage.ref} fallback={snippet} /> : snippet}
    </div>
  )
}

function PassageCard({ passage }: { passage: PassageResult }) {
  const openArtifact = useArtifactStore((s) => s.openArtifact)
  const href = `/explorer?reference=${encodeURIComponent(passage.first_ref)}`

  // This SPA doesn't serve `/explorer` as a real route — open the passage's
  // first verse as an interlinear artifact instead (same as ChatPane's verse
  // links; `first_ref` because fetchInterlinear takes one verse). The href
  // stays for keyboard/middle-click/a11y.
  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault()
    openArtifact({ type: 'interlinear', label: `${passage.ref} ▸`, params: { reference: passage.first_ref } })
  }

  return (
    <div className="rounded-lg border border-[var(--color-theme-border)] p-3 space-y-1.5">
      <div className="flex items-center gap-2 text-sm">
        <a href={href} onClick={handleClick} className="font-semibold text-[var(--color-theme-accent)] hover:underline">
          {passage.ref}
        </a>
        {passage.sources?.includes('cross_reference') && (
          <span className="text-xs rounded px-1.5 py-0.5 bg-[var(--color-surface-alt)] text-[var(--color-text-secondary)]">
            cross-reference
          </span>
        )}
      </div>
      {passage.reason && (
        <p data-testid="passage-reason" className="text-sm font-medium leading-relaxed">
          {passage.reason}
        </p>
      )}
      <LazyVerseBox passage={passage} />
    </div>
  )
}

export function PassageSearchArtifact(params: PassageSearchArtifactParams) {
  // `passages`, `phrasings` and `credits` can arrive via an imported/shared
  // or older card — default them so the card still renders.
  const { query, kind, label, verified, semantic, passages = [], phrasings = [], credits = [] } = params
  const title = kind === 'passage' ? `Passages related to ${label}` : `Passages for “${query}”`

  return (
    <div className="space-y-3 p-3">
      <h2 className="text-base font-semibold">{title}</h2>
      {!verified && (
        <p className="text-xs text-[var(--color-text-secondary)]">
          Relevance not verified — these are the closest matches found.
        </p>
      )}
      {!semantic && (
        <p className="text-xs text-[var(--color-text-secondary)]">
          Semantic search unavailable — matched on keywords only.
        </p>
      )}
      {phrasings.length > 0 && (
        <p className="text-xs text-[var(--color-text-secondary)]">Also searched: {phrasings.join(' · ')}</p>
      )}
      <div className="space-y-2">
        {passages.map((passage) => (
          <PassageCard key={passage.ref} passage={passage} />
        ))}
      </div>
      {passages.length > 0 && (
        <p className="text-xs text-[var(--color-text-secondary)]">
          Not an exhaustive list — try rephrasing if you don't see what you're after.
        </p>
      )}
      {credits.map((credit) => (
        <p key={credit} className="text-xs text-[var(--color-text-secondary)]">{credit}</p>
      ))}
    </div>
  )
}
