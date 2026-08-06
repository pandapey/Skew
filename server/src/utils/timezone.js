export const DEFAULT_TIMEZONE = 'Asia/Kolkata'

export function getTimezone(timezone) {
  if (!timezone || typeof timezone !== 'string') {
    return DEFAULT_TIMEZONE
  }

  try {
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
    }).format()

    return timezone
  } catch {
    return DEFAULT_TIMEZONE
  }
}

export function getTimeParts(date = new Date(), timezone = DEFAULT_TIMEZONE) {
  const safeTimezone = getTimezone(timezone)

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: safeTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)

  return Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  )
}

export function getLocalDate(date = new Date(), timezone = DEFAULT_TIMEZONE) {
  const parts = getTimeParts(date, timezone)

  return `${parts.year}-${parts.month}-${parts.day}`
}

export function getLocalTime(date = new Date(), timezone = DEFAULT_TIMEZONE) {
  const parts = getTimeParts(date, timezone)

  return `${parts.hour}:${parts.minute}:${parts.second}`
}
