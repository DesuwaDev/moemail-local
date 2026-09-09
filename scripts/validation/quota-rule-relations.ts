import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import {
  analyzeMailQuotaRuleRelations,
  type MailQuotaRuleRelations,
} from "../../app/lib/mail-quota-rule-relations"
import { appendMailQuotaRuleBatch, planMailQuotaRuleBatch } from "../../app/lib/mail-quota-rule-batch"
import { mailQuotaAssignmentSchema } from "../../app/lib/access-policies"
import type {
  MailDirection,
  MailQuotaAssignment,
  MailQuotaSubject,
  MailQuotaTarget,
} from "../../app/lib/access-policies"

function rule(direction: MailDirection, subject: MailQuotaSubject, target: MailQuotaTarget): MailQuotaAssignment {
  return {
    id: randomUUID(),
    direction,
    subject,
    target,
    rolling: { limit: 10, windowValue: 1, windowUnit: "day" },
    lifetimeLimit: target.type === "mailbox" ? 100 : -1,
    shareWithinRole: false,
    ignoreEmperor: false,
  }
}

const roleAll = rule("send", { type: "role", role: "knight" }, { type: "all" })
const roleDomain = rule("send", { type: "role", role: "knight" }, { type: "domain", domain: "example.test" })
const roleMailbox = rule("send", { type: "role", role: "knight" }, { type: "mailbox", address: "box@example.test" })
const globalDomain = rule("send", { type: "all" }, { type: "domain", domain: "example.test" })
const userMailbox = rule("send", { type: "user", userId: "user-a" }, { type: "mailbox", address: "box@example.test" })
const otherDirection = rule("receive", { type: "role", role: "knight" }, { type: "all" })

const exact = analyzeMailQuotaRuleRelations(roleDomain, [roleDomain])
assert.equal(exact.duplicateId, roleDomain.id)

const specific = analyzeMailQuotaRuleRelations(roleMailbox, [roleAll, roleDomain])
assert.deepEqual(specific, {
  duplicateId: null,
  overrides: 2,
  fallbacks: 0,
  stacks: 0,
  conditionalSubjectPriority: 0,
  unrelated: 0,
} satisfies MailQuotaRuleRelations)

const fallback = analyzeMailQuotaRuleRelations(roleAll, [roleDomain, roleMailbox])
assert.equal(fallback.fallbacks, 2)
assert.equal(fallback.overrides, 0)

const stacked = analyzeMailQuotaRuleRelations(globalDomain, [roleAll, roleDomain, roleMailbox])
assert.equal(stacked.stacks, 3)

const conditional = analyzeMailQuotaRuleRelations(userMailbox, [roleAll, roleDomain, roleMailbox])
assert.equal(conditional.conditionalSubjectPriority, 3)

const disjoint = analyzeMailQuotaRuleRelations(
  rule("send", { type: "role", role: "duke" }, { type: "domain", domain: "other.test" }),
  [roleAll, roleDomain, roleMailbox, globalDomain, userMailbox, otherDirection],
)
assert.equal(disjoint.unrelated, 5)
assert.equal(disjoint.stacks, 0)

const excluded = analyzeMailQuotaRuleRelations(roleDomain, [roleDomain], roleDomain.id)
assert.equal(excluded.duplicateId, null)

const batchSettings = {
  direction: "send" as const,
  target: { type: "domain" as const, domain: "batch.test" },
  rolling: { limit: 25, windowValue: 1, windowUnit: "day" as const },
  lifetimeLimit: 100,
  shareWithinRole: true,
  ignoreEmperor: true,
}
const selectedSubjects: MailQuotaSubject[] = [
  { type: "role", role: "duke" },
  { type: "role", role: "knight" },
  { type: "role", role: "civilian" },
]
const originalRules = [roleAll, globalDomain]
const originalSnapshot = structuredClone(originalRules)
const added = appendMailQuotaRuleBatch(originalRules, batchSettings, selectedSubjects)
assert.ok(added)
assert.equal(added.length, originalRules.length + 3)
assert.deepEqual(originalRules, originalSnapshot)
assert.equal(added[0], originalRules[0])
assert.equal(added[1], originalRules[1])
const additions = added.slice(originalRules.length)
assert.equal(new Set(added.map(assignment => assignment.id)).size, added.length)
assert.deepEqual(additions.map(assignment => assignment.subject), selectedSubjects)
for (const assignment of additions) {
  assert.equal(assignment.shareWithinRole, true)
  assert.equal(assignment.ignoreEmperor, false)
  assert.equal(assignment.lifetimeLimit, -1)
  assert.equal(mailQuotaAssignmentSchema.safeParse(assignment).success, true)
}
additions[0].rolling.limit = 99
assert.equal(additions[1].rolling.limit, 25)
assert.equal(batchSettings.rolling.limit, 25)
assert.notEqual(additions[0].target, additions[1].target)
assert.notEqual(additions[0].subject, selectedSubjects[0])

assert.equal(planMailQuotaRuleBatch(batchSettings, [], []).canAdd, false)
assert.equal(appendMailQuotaRuleBatch([], batchSettings, []), null)
const repeatedSelection = appendMailQuotaRuleBatch([], batchSettings, [...selectedSubjects, selectedSubjects[0]])
assert.equal(repeatedSelection?.length, 3)

const existingKnight = rule("send", { type: "role", role: "knight" }, batchSettings.target)
const conflictingBatch = planMailQuotaRuleBatch(batchSettings, selectedSubjects, [existingKnight])
assert.equal(conflictingBatch.canAdd, false)
assert.deepEqual(conflictingBatch.conflicts.map(entry => entry.draft.subject), [{ type: "role", role: "knight" }])
assert.equal(appendMailQuotaRuleBatch([existingKnight], batchSettings, selectedSubjects), null)
assert.equal(existingKnight.rolling.limit, 10)
const changedBeforeAdding = appendMailQuotaRuleBatch(additions, batchSettings, selectedSubjects)
assert.equal(changedBeforeAdding, null)
assert.equal(appendMailQuotaRuleBatch([existingKnight], { ...batchSettings, direction: "receive" }, selectedSubjects)?.length, 4)
assert.equal(appendMailQuotaRuleBatch([existingKnight], { ...batchSettings, target: { type: "domain", domain: "other.test" } }, selectedSubjects)?.length, 4)

const existingNearLimit = Array.from({ length: 1_998 }, (_, index) => rule("send", { type: "user", userId: `batch-user-${index}` }, { type: "all" }))
assert.equal(appendMailQuotaRuleBatch(existingNearLimit, batchSettings, selectedSubjects.slice(0, 2))?.length, 2_000)
const overLimit = planMailQuotaRuleBatch(batchSettings, selectedSubjects, existingNearLimit)
assert.equal(overLimit.remaining, 2)
assert.equal(overLimit.exceedsCapacity, true)
assert.equal(appendMailQuotaRuleBatch(existingNearLimit, batchSettings, selectedSubjects), null)
assert.equal(existingNearLimit.length, 1_998)

const globalBatchRule = rule("send", { type: "all" }, batchSettings.target)
const relationsByRole = planMailQuotaRuleBatch(batchSettings, selectedSubjects, [globalBatchRule])
assert.deepEqual(relationsByRole.entries.map(entry => entry.relations.stacks), [1, 1, 1])
const perUser = appendMailQuotaRuleBatch([], { ...batchSettings, shareWithinRole: false }, selectedSubjects)
assert.ok(perUser?.every(assignment => assignment.shareWithinRole === false))
const mailboxBatch = appendMailQuotaRuleBatch([], { ...batchSettings, target: { type: "mailbox", address: "box@batch.test" } }, selectedSubjects)
assert.ok(mailboxBatch?.every(assignment => assignment.lifetimeLimit === 100))
const globalBatch = appendMailQuotaRuleBatch([], batchSettings, [{ type: "all" }])
assert.equal(globalBatch?.[0].ignoreEmperor, true)
assert.equal(globalBatch?.[0].shareWithinRole, false)

console.log(JSON.stringify({
  duplicateDetected: true,
  specificOverrideExplained: true,
  broadFallbackExplained: true,
  globalScopedStackExplained: true,
  userRoleConditionReported: true,
  directionAndTargetIsolation: true,
  editSelfExcluded: true,
  multiRoleBatchCreatesIndependentRules: true,
  existingRulesAndHistoryIdsPreserved: true,
  emptySelectionRejected: true,
  duplicateSelectionDeduplicated: true,
  anyConflictingRoleRejectsWholeBatch: true,
  batchCapacityCheckedBeforeAdding: true,
  compatibilityExplainedPerRole: true,
  sharedAndPersonalPoolSemanticsPreserved: true,
}))
