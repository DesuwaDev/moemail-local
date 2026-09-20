import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SessionContext, type SessionContextValue } from 'next-auth/react'
import { useRolePermission } from '../../app/hooks/use-role-permission'
import { PERMISSIONS, ROLES } from '../../app/lib/permissions'
import type { Session } from 'next-auth'

function read(status: 'loading' | 'authenticated' | 'unauthenticated', user?: Record<string, unknown>) {
  let actual: ReturnType<typeof useRolePermission> | undefined
  function Probe() { actual = useRolePermission(); return null }
  renderToStaticMarkup(createElement(SessionContext.Provider, {
    value: { status, data: user ? { user, expires: '2099-01-01' } as unknown as Session : null, update: async () => null } as SessionContextValue,
  }, createElement(Probe)))
  return actual!
}
const emperor = { id: 'owner', roles: [{ name: ROLES.EMPEROR }], permissions: Object.values(PERMISSIONS) }
for (const result of [read('loading', emperor), read('unauthenticated'), read('authenticated', { ...emperor, permissions: undefined }), read('authenticated', { ...emperor, bannedAt: new Date() })]) {
  assert.equal(result.ready, false)
  assert.equal(result.hasRole(ROLES.EMPEROR), false)
  assert.equal(result.checkPermission(PERMISSIONS.MANAGE_CONFIG), false)
}
assert.equal(read('authenticated', emperor).hasRole(ROLES.EMPEROR), true)
assert.equal(read('authenticated', emperor).checkPermission(PERMISSIONS.MANAGE_CONFIG), true)
const restricted = read('authenticated', { ...emperor, roles: [{ name: ROLES.DUKE }], permissions: [] })
assert.equal(restricted.ready, true)
assert.equal(restricted.checkPermission(PERMISSIONS.CREATE_EMAIL), false)
assert.equal(restricted.hasRole(ROLES.EMPEROR), false)
console.log('Profile session gate: loading, failure, missing policy, ban, emperor and explicit restrictions passed')
