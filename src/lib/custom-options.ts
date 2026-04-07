export const CUSTOM_OPTION_PREFIX = '__custom__:'

export function encodeCustomOptionValue(label: string): string {
  return `${CUSTOM_OPTION_PREFIX}${label}`
}

export function isCustomOptionValue(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(CUSTOM_OPTION_PREFIX)
}

export function decodeCustomOptionValue(value: unknown): string | null {
  if (!isCustomOptionValue(value)) return null
  return value.slice(CUSTOM_OPTION_PREFIX.length)
}
