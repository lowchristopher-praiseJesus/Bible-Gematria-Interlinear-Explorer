import type { StoryArtifactParams, StoryCover, StoryPage } from '@/types/session'

export interface NormalizedStory {
  characters: string
  cover: StoryCover
  pages: StoryPage[]
}

/**
 * Story artifacts created before illustrated pages existed had the shape
 * `{ title, themes, age_range, text, word_count }` — no `pages`, `cover`
 * or `characters`. Those still live in users' persisted session history
 * and in old share snapshots, so every reader of a story artifact goes
 * through this rather than trusting the current type: a legacy `text`
 * becomes a single scene-less page, and a missing cover/characters
 * degrade to blanks. Called at each point of use (not once centrally)
 * so the artifact object's own reference is never replaced.
 */
export function normalizeStory(params: StoryArtifactParams): NormalizedStory {
  const raw = params as Partial<StoryArtifactParams> & { text?: unknown }
  let pages: StoryPage[]
  if (Array.isArray(raw.pages)) {
    pages = raw.pages
  } else if (typeof raw.text === 'string' && raw.text.trim()) {
    pages = [{ text: raw.text, scene: '', image_url: null }]
  } else {
    pages = []
  }
  const cover = raw.cover && typeof raw.cover === 'object' ? raw.cover : { scene: '', image_url: null }
  const characters = typeof raw.characters === 'string' ? raw.characters : ''
  return { characters, cover, pages }
}

/**
 * A string identifying a story by its content rather than its object
 * reference — ArtifactPane re-spreads a fresh props object on every one
 * of its own re-renders, so reference equality can't tell "same story,
 * parent re-rendered" from "a different story now". NUL separators can't
 * occur in real story text.
 */
export function storySignature(title: string, story: NormalizedStory): string {
  return [
    title,
    story.characters,
    story.cover.scene,
    ...story.pages.map((p) => `${p.scene ?? ''}\u0001${p.text ?? ''}`),
  ].join('\u0000')
}

/**
 * Whether there is anything to build an illustration prompt from. A
 * legacy (pre-illustration) story has no scenes or characters at all, so
 * requesting images for it would only produce generic style-prefix art —
 * its pages are shown text-only instead.
 */
export function canIllustrate(story: NormalizedStory): boolean {
  return (
    story.pages.length > 0 &&
    Boolean(
      story.characters.trim() ||
        story.cover.scene?.trim() ||
        story.pages.some((p) => p.scene?.trim()),
    )
  )
}
