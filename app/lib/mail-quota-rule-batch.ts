import type { MailQuotaAssignment, MailQuotaSubject } from "./access-policies"
import { analyzeMailQuotaRuleRelations } from "./mail-quota-rule-relations"

type MailQuotaBatchSettings = Omit<MailQuotaAssignment, "id" | "subject">

function subjectIdentity(subject: MailQuotaSubject) {
  return subject.type === "all"
    ? "all"
    : subject.type === "role" ? `role:${subject.role}` : `user:${subject.userId}`
}

export function planMailQuotaRuleBatch(
  settings: MailQuotaBatchSettings,
  subjects: readonly MailQuotaSubject[],
  rules: readonly MailQuotaAssignment[],
) {
  const uniqueSubjects = new Map(subjects.map(subject => [subjectIdentity(subject), subject]))
  const entries = [...uniqueSubjects.values()].map(subject => {
    const draft = {
      ...settings,
      subject: { ...subject },
      target: { ...settings.target },
      rolling: { ...settings.rolling },
      lifetimeLimit: settings.target.type === "mailbox" ? settings.lifetimeLimit : -1,
      shareWithinRole: subject.type === "role" && settings.shareWithinRole,
      ignoreEmperor: subject.type === "all" && settings.ignoreEmperor,
    }
    return { draft, relations: analyzeMailQuotaRuleRelations(draft, rules) }
  })
  const conflicts = entries.filter(entry => entry.relations.duplicateId !== null)
  const remaining = Math.max(0, 2_000 - rules.length)
  const exceedsCapacity = entries.length > remaining
  return {
    entries,
    conflicts,
    remaining,
    exceedsCapacity,
    canAdd: entries.length > 0 && conflicts.length === 0 && !exceedsCapacity,
  }
}

export function appendMailQuotaRuleBatch(
  rules: readonly MailQuotaAssignment[],
  settings: MailQuotaBatchSettings,
  subjects: readonly MailQuotaSubject[],
): MailQuotaAssignment[] | null {
  const batch = planMailQuotaRuleBatch(settings, subjects, rules)
  if (!batch.canAdd) return null
  return [...rules, ...batch.entries.map(({ draft }) => ({ ...draft, id: crypto.randomUUID() }))]
}
