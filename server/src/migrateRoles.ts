import 'dotenv/config'
import { prisma } from './db'

async function migrate() {
  const table = await prisma.$queryRawUnsafe<{ name: string | null }[]>(
    "SELECT to_regclass('" + '"ObjectRole"' + "')::text as name"
  )
  const exists = table?.[0]?.name
  if (!exists) {
    console.log('ObjectRole table not found. No migration needed.')
    return
  }

  const oldRoles = await prisma.$queryRawUnsafe<Array<{ id: string; name: string }>>(
    'SELECT id, name FROM "ObjectRole"'
  )
  if (oldRoles.length === 0) {
    console.log('ObjectRole table empty. No migration needed.')
    return
  }

  const roleIdMap = new Map<string, string>()
  for (const role of oldRoles) {
    const created = await prisma.roleDefinition.upsert({
      where: { name: role.name },
      update: {},
      create: { name: role.name },
    })
    roleIdMap.set(role.id, created.id)
  }

  const assignments = await prisma.objectRoleAssignment.findMany({
    select: { id: true, roleId: true },
  })
  for (const assignment of assignments) {
    const mapped = roleIdMap.get(assignment.roleId)
    if (mapped && mapped !== assignment.roleId) {
      await prisma.objectRoleAssignment.update({
        where: { id: assignment.id },
        data: { roleId: mapped },
      })
    }
  }

  const policies = await prisma.objectSurveyPolicy.findMany({
    select: { id: true, roleIds: true },
  })
  for (const policy of policies) {
    const roleIds = Array.isArray(policy.roleIds) ? (policy.roleIds as string[]) : []
    if (roleIds.length === 0) continue
    const next = roleIds.map((rid) => roleIdMap.get(rid) ?? rid).filter(Boolean)
    await prisma.objectSurveyPolicy.update({
      where: { id: policy.id },
      data: { roleIds: next },
    })
  }

  const overrides = await prisma.objectPolicyOverride.findMany({
    select: { id: true, roleIds: true },
  })
  for (const override of overrides) {
    const roleIds = Array.isArray(override.roleIds) ? (override.roleIds as string[]) : []
    if (roleIds.length === 0) continue
    const next = roleIds.map((rid) => roleIdMap.get(rid) ?? rid).filter(Boolean)
    await prisma.objectPolicyOverride.update({
      where: { id: override.id },
      data: { roleIds: next },
    })
  }

  console.log(`Role migration complete. Roles mapped: ${roleIdMap.size}`)
}

migrate()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
