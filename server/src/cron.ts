import { prisma } from './db'
import type { Frequency, TaskStatus } from '@prisma/client'

function intervalDaysForPolicy(frequency: Frequency, intervalDays?: number | null) {
  switch (frequency) {
    case 'MONTHLY':
      return 30
    case 'QUARTERLY':
      return 90
    case 'YEARLY':
      return 365
    case 'CUSTOM_DAYS':
      return intervalDays ?? 0
    case 'ONCE':
    default:
      return 0
  }
}

async function ensureTasksForAllObjects() {
  const policies = await prisma.objectSurveyPolicy.findMany()
  const overrides = await prisma.objectPolicyOverride.findMany()
  const memberships = await prisma.objectGroupMembership.findMany()
  const groupPolicies = await prisma.objectGroupPolicy.findMany()

  const effectivePolicies = [
    ...policies.map((p) => ({ ...p, source: 'direct' as const, objectId: p.objectId })),
    ...groupPolicies.flatMap((p) =>
      memberships
        .filter((m) => m.groupId === p.groupId)
        .map((m) => ({ ...p, objectId: m.objectId, source: 'group' as const }))
    ),
    ...overrides.map((p) => ({ ...p, source: 'override' as const, objectId: p.objectId })),
  ]

  const assignments = await prisma.objectRoleAssignment.findMany({
    include: { group: { include: { members: true } } },
  })

  const now = new Date()

  for (const policy of effectivePolicies) {
    const rolesForObject = await prisma.objectRole.findMany({
      where:
        policy.source === 'group'
          ? { objectId: policy.objectId, name: { in: (policy.roleNames as string[]) ?? [] } }
          : { objectId: policy.objectId, id: { in: (policy.roleIds as string[]) ?? [] } },
    })
    for (const role of rolesForObject) {
      const lastDone = await prisma.objectSurveyTask.findFirst({
        where: {
          policyId: policy.id,
          roleId: role.id,
          objectId: policy.objectId,
          status: 'DONE',
        },
        orderBy: { completedAt: 'desc' },
      })

      const interval = intervalDaysForPolicy(policy.frequency as Frequency, policy.intervalDays)
      const nextDue = lastDone?.completedAt
        ? new Date(new Date(lastDone.completedAt).getTime() + interval * 24 * 60 * 60 * 1000)
        : policy.activeFrom ?? now

      if (policy.activeTo && nextDue > policy.activeTo) continue
      if (policy.frequency !== 'ONCE' && lastDone?.completedAt && nextDue > now) {
        continue
      }
      if (policy.frequency === 'ONCE' && lastDone) {
        continue
      }

      const existingOpen = await prisma.objectSurveyTask.findFirst({
        where: {
          policyId: policy.id,
          roleId: role.id,
          objectId: policy.objectId,
          status: 'OPEN',
        },
      })
      if (existingOpen) continue

      const assignees = assignments.filter(
        (a) => a.objectId === policy.objectId && a.roleId === role.id
      )
      const assigneeUserIds = new Set<string>()
      assignees.forEach((a) => {
        if (a.userId) assigneeUserIds.add(a.userId)
        if (a.group?.members?.length) {
          a.group.members.forEach((m) => assigneeUserIds.add(m.userId))
        }
      })

      const data = Array.from(assigneeUserIds).map((assigneeUserId) => ({
        policyId: policy.id,
        objectId: policy.objectId,
        questionnaireId: policy.questionnaireId,
        roleId: role.id,
        assigneeUserId,
        dueAt: nextDue,
        status: 'OPEN' as TaskStatus,
      }))

      if (data.length > 0) {
        await prisma.objectSurveyTask.createMany({ data })
      }
    }
  }
}

ensureTasksForAllObjects()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error(err)
    await prisma.$disconnect()
    process.exit(1)
  })
