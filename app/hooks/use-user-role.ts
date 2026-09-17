"use client"

import { useSession } from "next-auth/react"
import type { Role } from "@/lib/permissions"

export function useUserRole() {
  const { data: session, status } = useSession()
  return {
    role: (session?.user?.roles?.[0]?.name as Role | undefined) ?? null,
    loading: status === "loading",
  }
}
