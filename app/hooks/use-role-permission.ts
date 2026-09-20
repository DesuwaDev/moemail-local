"use client"

import { useSession } from "next-auth/react"
import { Permission, Role } from "@/lib/permissions"

export function useRolePermission() {
  const { data: session, status } = useSession()
  const user = session?.user
  // Missing policy data is unknown, never a request to restore role defaults.
  const ready = status === "authenticated" && Boolean(user?.id) && !user?.bannedAt
    && Array.isArray(user?.roles) && Array.isArray(user?.permissions)
  const roles = ready ? user?.roles : undefined
  const permissions = ready ? user?.permissions : undefined

  return {
    checkPermission: (permission: Permission) => permissions?.includes(permission) ?? false,
    hasRole: (role: Role) => roles?.some(item => item.name === role) ?? false,
    roles,
    permissions,
    user: ready ? user : undefined,
    ready,
    loading: status === "loading",
  }
}
