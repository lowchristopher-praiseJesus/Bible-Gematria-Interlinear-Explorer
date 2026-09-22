import { parseJsonResponse } from './chatApi'

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
