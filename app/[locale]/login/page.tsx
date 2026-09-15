import { LoginForm } from "@/components/auth/login-form"
import { redirect } from "next/navigation"
import { requireCompletedSetup } from "@/lib/setup-navigation"

export const runtime = "nodejs"

export default async function LoginPage() {
  requireCompletedSetup()
  const { auth } = await import("@/lib/auth")
  const { getPublicCaptchaConfig } = await import("@/lib/captcha/config")
  const session = await auth()

  if (session?.user) {
    redirect("/")
  }

  const captcha = await getPublicCaptchaConfig()

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100 px-4 py-6 dark:from-gray-900 dark:to-gray-800 sm:py-10">
      <LoginForm captcha={captcha} />
    </div>
  )
}
