/**
 * Compact "how long ago" label for admin tables — "just now", "5m ago",
 * "3h ago", "2d ago", then falls back to a short date. `now` is injectable
 * so tests stay deterministic regardless of the machine clock.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  const ms = now.getTime() - then.getTime()
  if (Number.isNaN(ms)) return iso

  const sec = Math.round(ms / 1000)
  if (sec < 45) return 'just now'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 7) return `${day}d ago`

  const sameYear = then.getFullYear() === now.getFullYear()
  return then.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}
