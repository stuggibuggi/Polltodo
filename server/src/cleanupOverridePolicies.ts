import 'dotenv/config'
import { prisma } from './db'

function parseMode() {
  const args = new Set(process.argv.slice(2))
  if (args.has('--apply')) return 'apply' as const
  return 'dry-run' as const
}

async function run() {
  const mode = parseMode()
  const overridePolicies = await prisma.objectSurveyPolicy.findMany({
    where: { createdByObjectGroupId: { startsWith: 'override:' } },
    select: { id: true, createdByObjectGroupId: true },
  })

  if (overridePolicies.length === 0) {
    console.log('No override-backed policies found.')
    return
  }

  const parsed = overridePolicies.map((policy) => {
    const marker = policy.createdByObjectGroupId ?? ''
    const overrideId = marker.startsWith('override:') ? marker.slice('override:'.length) : ''
    return { policyId: policy.id, marker, overrideId }
  })

  const overrideIds = Array.from(
    new Set(parsed.map((p) => p.overrideId).filter((id) => id.length > 0))
  )
  const existingOverrides = new Set(
    (
      await prisma.objectPolicyOverride.findMany({
        where: { id: { in: overrideIds } },
        select: { id: true },
      })
    ).map((o) => o.id)
  )

  const stalePolicyIds = parsed
    .filter((p) => !p.overrideId || !existingOverrides.has(p.overrideId))
    .map((p) => p.policyId)

  if (stalePolicyIds.length === 0) {
    console.log('No stale override-backed policies found.')
    return
  }

  const staleTaskCount = await prisma.objectSurveyTask.count({
    where: { policyId: { in: stalePolicyIds } },
  })

  console.log(`[${mode}] stale policies: ${stalePolicyIds.length}, related tasks: ${staleTaskCount}`)

  if (mode !== 'apply') {
    console.log('Dry run only. Re-run with --apply to delete.')
    return
  }

  await prisma.$transaction(async (tx) => {
    await tx.objectSurveyTask.deleteMany({ where: { policyId: { in: stalePolicyIds } } })
    await tx.objectSurveyPolicy.deleteMany({ where: { id: { in: stalePolicyIds } } })
  })

  console.log('Cleanup finished.')
}

run()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

