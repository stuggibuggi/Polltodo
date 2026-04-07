import 'dotenv/config'
import { prisma } from './db'

async function cleanup() {
  const tasks = await prisma.objectSurveyTask.findMany({
    orderBy: [{ completedAt: 'desc' }, { dueAt: 'asc' }],
  })

  const byKey = new Map<string, typeof tasks>()
  for (const task of tasks) {
    const key = `${task.policyId}:${task.objectId}`
    const list = byKey.get(key) ?? []
    list.push(task)
    byKey.set(key, list)
  }

  let deleted = 0
  for (const list of byKey.values()) {
    if (list.length <= 1) continue

    const done = list.filter((t) => t.status === 'DONE')
    const open = list.filter((t) => t.status === 'OPEN')
    const closed = list.filter((t) => t.status === 'CLOSED_BY_OTHER')

    let keep = list[0]
    if (done.length > 0) {
      keep = done.sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))[0]
    } else if (open.length > 0) {
      keep = open.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())[0]
    } else if (closed.length > 0) {
      keep = closed.sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))[0]
    }

    const removeIds = list.filter((t) => t.id !== keep.id).map((t) => t.id)
    if (removeIds.length > 0) {
      const result = await prisma.objectSurveyTask.deleteMany({ where: { id: { in: removeIds } } })
      deleted += result.count
    }
  }

  console.log(`cleanup done. removed=${deleted}`)
}

cleanup()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
