const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatTime(date: Date): string {
  const minutes = date.getMinutes().toString().padStart(2, '0')
  let hours = date.getHours()
  const ampm = hours >= 12 ? 'PM' : 'AM'
  hours = hours % 12
  if (hours === 0) hours = 12
  return `${hours}:${minutes} ${ampm}`
}

/**
 * A short, human-readable "when" for a session's sidebar row — "Today,
 * 2:15 PM" for anything started today, otherwise a compact date (with the
 * year only when it isn't the current one) plus the time, e.g.
 * "Aug 30, 9:03 AM" or "Dec 3, 2024, 6:40 PM".
 *
 * Built from local Date getters rather than Intl/locale formatting so the
 * output — and its tests — stay identical regardless of the machine's
 * locale; `now` is injectable for deterministic testing.
 */
export function formatSessionTimestamp(timestamp: number, now: Date = new Date()): string {
  const date = new Date(timestamp)
  const time = formatTime(date)

  if (date.toDateString() === now.toDateString()) {
    return `Today, ${time}`
  }

  const datePart =
    date.getFullYear() === now.getFullYear()
      ? `${MONTHS[date.getMonth()]} ${date.getDate()}`
      : `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`

  return `${datePart}, ${time}`
}
