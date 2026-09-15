import { z } from "zod"

export const authSchema = z.object({
  username: z.string()
    .min(1, "USERNAME_REQUIRED")
    .max(20, "USERNAME_TOO_LONG")
    .regex(/^[a-zA-Z0-9_-]+$/, "USERNAME_INVALID_CHARACTERS")
    .refine(val => !val.includes('@'), "USERNAME_EMAIL_FORMAT_FORBIDDEN"),
  password: z.string()
    .min(8, "PASSWORD_TOO_SHORT")
    .max(256, "PASSWORD_TOO_LONG"),
  captchaToken: z.string().max(8_192).optional(),
  // Which channel minted the token. Only a hint for ordering the verification
  // attempts, so it is accepted as free text and checked against the configured
  // channels rather than against the provider list.
  captchaProvider: z.string().max(32).optional(),
})

export type AuthSchema = z.infer<typeof authSchema>

export const credentialsAuthSchema = authSchema.extend({
  registrationTicket: z.string().min(1).max(2_048).optional(),
})

export type CredentialsAuthSchema = z.infer<typeof credentialsAuthSchema>
