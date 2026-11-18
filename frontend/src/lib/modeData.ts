import { parseJsonResponse } from './chatApi'
import type { ApologeticsTrack } from '@/types/session'

export interface ParableEntry {
  id: string
  name: string
  reference: string
}

export interface StudyWikiEntry {
  id: string
  title: string
  speaker: string
  description: string
}

export interface CharacterEntry {
  id: string
  name: string
  testament: 'OT' | 'NT'
  summary: string
}

export async function listCharacters(): Promise<CharacterEntry[]> {
  const res = await fetch('/api/bible-chat/characters')
  const body = await parseJsonResponse<{ characters: CharacterEntry[] }>(res)
  return body.characters
}

export async function listParables(): Promise<ParableEntry[]> {
  const res = await fetch('/api/bible-chat/parables')
  const body = await parseJsonResponse<{ parables: ParableEntry[] }>(res)
  return body.parables
}

export async function listStudyWikis(): Promise<StudyWikiEntry[]> {
  const res = await fetch('/api/bible-chat/study-wikis')
  const body = await parseJsonResponse<{ study_wikis: StudyWikiEntry[] }>(res)
  return body.study_wikis
}

let apologeticsTracks: Promise<ApologeticsTrack[]> | null = null

/** Defend the Faith tracks, fetched once per page load. A failed fetch is
 * not cached, so the next call retries. */
export function listApologeticsTracks(): Promise<ApologeticsTrack[]> {
  if (!apologeticsTracks) {
    const p = fetch('/api/bible-chat/apologetics/tracks')
      .then((res) => parseJsonResponse<{ tracks: ApologeticsTrack[] }>(res))
      .then((body) => body.tracks)
    apologeticsTracks = p
    p.catch(() => {
      if (apologeticsTracks === p) apologeticsTracks = null
    })
  }
  return apologeticsTracks
}

/** Test helper: forget the cached track list. */
export function resetApologeticsTracksCache(): void {
  apologeticsTracks = null
}
