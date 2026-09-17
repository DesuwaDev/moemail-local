export interface MessageAttachment {
  id: string
  filename: string
  contentType: string
  contentId: string | null
  size: number
  download_url: string
}

export interface InlineMessageImage {
  contentId: string
  contentType: string
  data: string
}

export function normalizeContentId(value: string) {
  try { return decodeURIComponent(value.replace(/&amp;/giu, "&")).replace(/^<|>$/gu, "") }
  catch { return value.replace(/^<|>$/gu, "") }
}
