/** Keep legacy URL-safe tokens valid as well as the current 16-character nanoid. */
export function isValidShareToken(token: string): boolean {
  return token.length > 0 && token.length <= 128 && /^[A-Za-z0-9_-]+$/.test(token)
}
