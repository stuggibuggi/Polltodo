import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { prisma } from './db'
import crypto from 'crypto'

const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com'
const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'

async function main() {
  let admin = await prisma.user.findUnique({ where: { email: adminEmail } })
  if (!admin) {
    const passwordHash = await bcrypt.hash(adminPassword, 10)
    admin = await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        role: 'ADMIN',
      },
    })
  }

  let questionnaire = await prisma.questionnaire.findFirst({
    where: { title: 'Regulatorische Jahresbewertung' },
  })
  if (!questionnaire) {
    questionnaire = await prisma.questionnaire.create({
      data: {
        title: 'Regulatorische Jahresbewertung',
        subtitle: 'Pflichtbewertung fuer Anwendungen',
        status: 'PUBLISHED',
        sections: [
          {
            id: crypto.randomUUID(),
            title: 'Allgemein',
            questions: [
              {
                id: crypto.randomUUID(),
                type: 'boolean',
                title: 'Ist die Anwendung DSGVO-konform?',
                required: true,
              },
              {
                id: crypto.randomUUID(),
                type: 'text',
                title: 'Welche Risiken bestehen aktuell?',
                required: false,
              },
            ],
          },
        ],
      },
    })
  }

  let app1 = await prisma.objectEntity.findFirst({ where: { name: 'Zahlungssystem A' } })
  if (!app1) {
    app1 = await prisma.objectEntity.create({
      data: { name: 'Zahlungssystem A', type: 'Anwendung' },
    })
  }
  let app2 = await prisma.objectEntity.findFirst({ where: { name: 'Kundenportal B' } })
  if (!app2) {
    app2 = await prisma.objectEntity.create({
      data: { name: 'Kundenportal B', type: 'Anwendung' },
    })
  }

  const role1 = await prisma.roleDefinition.upsert({
    where: { name: 'Fachlich verantwortlich' },
    update: {},
    create: { name: 'Fachlich verantwortlich' },
  })
  const role2 = await prisma.roleDefinition.upsert({
    where: { name: 'Technischer Ansprechpartner' },
    update: {},
    create: { name: 'Technischer Ansprechpartner' },
  })

  await prisma.objectRoleAssignment.createMany({
    data: [
      { objectId: app1.id, roleId: role1.id, userId: admin.id },
      { objectId: app1.id, roleId: role2.id, userId: admin.id },
      { objectId: app2.id, roleId: role1.id, userId: admin.id },
    ],
    skipDuplicates: true,
  })

  const policy1 = await prisma.objectSurveyPolicy.findFirst({
    where: { objectId: app1.id, questionnaireId: questionnaire.id },
  })
  if (!policy1) {
    await prisma.objectSurveyPolicy.create({
      data: {
        objectId: app1.id,
        questionnaireId: questionnaire.id,
        frequency: 'YEARLY',
        roleIds: [role1.id, role2.id],
      },
    })
  }
  const policy2 = await prisma.objectSurveyPolicy.findFirst({
    where: { objectId: app2.id, questionnaireId: questionnaire.id },
  })
  if (!policy2) {
    await prisma.objectSurveyPolicy.create({
      data: {
        objectId: app2.id,
        questionnaireId: questionnaire.id,
        frequency: 'YEARLY',
        roleIds: [role1.id],
      },
    })
  }

  const group = await prisma.objectGroup.upsert({
    where: { name: 'Anwendungen' },
    update: {},
    create: { name: 'Anwendungen' },
  })
  await prisma.objectGroupMembership.createMany({
    data: [
      { groupId: group.id, objectId: app1.id },
      { groupId: group.id, objectId: app2.id },
    ],
    skipDuplicates: true,
  })
  const groupPolicy = await prisma.objectGroupPolicy.findFirst({
    where: { groupId: group.id, questionnaireId: questionnaire.id },
  })
  if (!groupPolicy) {
    await prisma.objectGroupPolicy.create({
      data: {
        groupId: group.id,
        questionnaireId: questionnaire.id,
        frequency: 'YEARLY',
        roleNames: ['Fachlich verantwortlich'],
      },
    })
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error(err)
    await prisma.$disconnect()
    process.exit(1)
  })
