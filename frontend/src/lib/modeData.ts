export interface ParableEntry {
  id: string
  name: string
  reference: string
}

export interface TopicEntry {
  id: string
  name: string
  seed_references: string[]
}

export async function listParables(): Promise<ParableEntry[]> {
  const res = await fetch('/api/bible-chat/parables')
  const body = await res.json()
  return body.parables
}

export async function listTopics(): Promise<TopicEntry[]> {
  const res = await fetch('/api/bible-chat/topics')
  const body = await res.json()
  return body.topics
}
