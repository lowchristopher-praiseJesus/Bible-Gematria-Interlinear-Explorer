import type { BadgeTone } from '@/components/ui/Badge'

const STATUS_TONE: Record<string, BadgeTone> = {
  new: 'new',
  triaged: 'triaged',
  resolved: 'resolved',
}

/** Maps a report's status string to the Badge tone that colours it. */
export function statusTone(status: string): BadgeTone {
  return STATUS_TONE[status] ?? 'neutral'
}
