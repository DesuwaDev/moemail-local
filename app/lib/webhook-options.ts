import { z } from "zod"
import { emailText } from "./email-content"

export const webhookOptionsSchema = z.object({
  notificationMode: z.enum(["full", "text"]).optional(),
  maxContentBytes: z.number().int().min(256).max(65536).optional(),
})

export interface WebhookOptions {
  notificationMode?: string
  maxContentBytes?: number
}

export function truncateUtf8(value: string, maxBytes: number) {
  const buffer = Buffer.from(value)
  if (buffer.length <= maxBytes) return value
  let end = Math.max(0, maxBytes - Buffer.byteLength("…"))
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end--
  return buffer.subarray(0, end).toString("utf8") + "…"
}

export function webhookMessage<T extends { subject: string; content: string; html: string }>(message: T, options: WebhookOptions = {}) {
  if (options.notificationMode !== "text") return message
  const maxBytes = Math.max(256, Math.min(65536, options.maxContentBytes ?? 2048))
  const text = emailText(message.content, message.html)
  return {
    ...message,
    subject: truncateUtf8(message.subject, 256),
    content: truncateUtf8(text, maxBytes),
    html: "",
    truncated: Buffer.byteLength(text) > maxBytes || Buffer.byteLength(message.subject) > 256,
  }
}

/** Explicit negative acknowledgments must not be reported as delivered. */
export function webhookResponseFailed(body: string) {
  try {
    const result: unknown = JSON.parse(body)
    return result !== null && typeof result === "object" && (
      ("success" in result && result.success === false)
      || ("ok" in result && result.ok === false)
      || ("errcode" in result && typeof result.errcode === "number" && result.errcode !== 0)
    )
  } catch { return false }
}
