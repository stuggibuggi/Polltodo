import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import bcrypt from 'bcryptjs'
import { prisma } from './db'
import { signToken, setAuthCookie, clearAuthCookie, requireAuth, requireRole, getAuthUser } from './auth'
import type { Role, Frequency, TaskStatus } from '@prisma/client'
import { ldapAuthenticate } from './ldap'
import crypto from 'crypto'
import { OAuth2Client } from 'google-auth-library'
import sql from 'mssql'
import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'

const app = express()

const PORT = Number(process.env.PORT || 4000)
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret'
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173'
const AUTH_MODE = (process.env.AUTH_MODE || '').toLowerCase() || (process.env.NODE_ENV === 'production' ? 'both' : 'local')
const JIRA_ISSUE_CREATE_URL = process.env.JIRA_ISSUE_CREATE_URL || ''
const JIRA_ISSUE_BROWSE_URL = process.env.JIRA_ISSUE_BROWSE_URL || ''
const JIRA_USER_SEARCH_URL = process.env.JIRA_USER_SEARCH_URL || ''
const JIRA_BASIC_AUTH = process.env.JIRA_BASIC_AUTH || ''
const JIRA_DEFAULT_PROJECT_KEY = process.env.JIRA_DEFAULT_PROJECT_KEY || ''
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const ALLOW_REGISTRATION = (process.env.ALLOW_REGISTRATION || 'true').toLowerCase() === 'true'
const googleOAuthClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null
const JIRA_DEFAULT_ISSUE_TYPE = process.env.JIRA_DEFAULT_ISSUE_TYPE || 'Task'
const JIRA_CONTACT_CUSTOM_FIELD_ID = process.env.JIRA_CONTACT_CUSTOM_FIELD_ID || 'customfield_11341'
const JIRA_EPIC_NAME_CUSTOM_FIELD_ID = process.env.JIRA_EPIC_NAME_CUSTOM_FIELD_ID || 'customfield_10941'
const JIRA_DEFAULT_COMPONENTS = (process.env.JIRA_DEFAULT_COMPONENTS || '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean)
const CLIENT_PUBLIC_BASE_URL = (process.env.CLIENT_PUBLIC_BASE_URL || CORS_ORIGIN || '').trim()
const EXTERNAL_IMPORT_PRISMA_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.EXTERNAL_IMPORT_PRISMA_TIMEOUT_MS || 120_000)
)
const QUESTIONNAIRE_EDITOR_LOCK_TTL_SECONDS = Math.max(
  30,
  Number(process.env.QUESTIONNAIRE_EDITOR_LOCK_TTL_SECONDS || 180)
)

app.use(cors({ origin: CORS_ORIGIN, credentials: true }))
app.use(express.json({ limit: '2mb' }))
app.use(cookieParser())

const authMiddleware = requireAuth(JWT_SECRET)

const isCurrent = (status: string, activeFrom?: Date | null, activeTo?: Date | null) => {
  if (status !== 'PUBLISHED') return false
  const now = new Date()
  if (activeFrom && activeFrom > now) return false
  if (activeTo && activeTo < now) return false
  return true
}

const GROUP_ROLE_NAME = 'Gruppenmitglied'

const normalizeGeneratedExternalIdBase = (value: string) => {
  const normalized = value
    .toLowerCase()
    .replace(/@/g, '.')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
  return normalized || 'user'
}

async function generateUniqueExternalId(email: string, preferred?: string, excludeUserId?: string) {
  const source = (preferred ?? '').trim() || email.trim()
  const base = normalizeGeneratedExternalIdBase(source)
  let candidate = base.slice(0, 64)
  let suffix = 1

  while (true) {
    const existing = await prisma.user.findUnique({
      where: { externalId: candidate },
      select: { id: true },
    })
    if (!existing || existing.id === excludeUserId) return candidate
    suffix += 1
    const tail = `-${suffix}`
    const head = base.slice(0, Math.max(1, 64 - tail.length))
    candidate = `${head}${tail}`
  }
}

async function generateUniqueEmail(preferred: string, excludeUserId?: string) {
  const normalized = preferred.trim().toLowerCase()
  const [localRaw, domainRaw] = normalized.includes('@')
    ? normalized.split('@')
    : [normalized, 'pending.local']
  const localBase = (localRaw || 'user')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '') || 'user'
  const domain = (domainRaw || 'pending.local').replace(/[^a-z0-9.-]+/g, '') || 'pending.local'
  let candidate = `${localBase}@${domain}`
  let suffix = 1

  while (true) {
    const existing = await prisma.user.findUnique({
      where: { email: candidate },
      select: { id: true },
    })
    if (!existing || existing.id === excludeUserId) return candidate
    suffix += 1
    candidate = `${localBase}-${suffix}@${domain}`
  }
}

async function resolveOrCreateUsersByIdentifiers(
  actor: { id: string; role: Role },
  identifiers: string[]
) {
  const normalized = Array.from(
    new Set(
      identifiers
        .map((entry) => String(entry ?? '').trim())
        .filter((entry) => entry.length > 0)
    )
  )
  const userIds: string[] = []

  for (const identifier of normalized) {
    const isEmail = identifier.includes('@')
    if (isEmail) {
      const email = identifier.toLowerCase()
      const existing = await prisma.user.findUnique({ where: { email } })
      if (existing) {
        userIds.push(existing.id)
        continue
      }
      const generatedExternalId = await generateUniqueExternalId(email)
      const created = await prisma.user.create({
        data: {
          email,
          passwordHash: await bcrypt.hash(crypto.randomUUID(), 10),
          role: 'VIEWER',
          externalId: generatedExternalId,
          imported: false,
          createdByUserId: actor.id,
        },
      })
      userIds.push(created.id)
      continue
    }

    const externalId = identifier
    const existing = await prisma.user.findUnique({ where: { externalId } })
    if (existing) {
      userIds.push(existing.id)
      continue
    }
    const uniqueExternalId = await generateUniqueExternalId(
      `pending+${externalId}@pending.local`,
      externalId
    )
    const placeholderEmail = await generateUniqueEmail(`${uniqueExternalId}@pending.local`)
    const created = await prisma.user.create({
      data: {
        email: placeholderEmail,
        passwordHash: await bcrypt.hash(crypto.randomUUID(), 10),
        role: 'VIEWER',
        externalId: uniqueExternalId,
        imported: false,
        createdByUserId: actor.id,
      },
    })
    userIds.push(created.id)
  }

  return Array.from(new Set(userIds))
}

async function backfillMissingUserExternalIds() {
  const missing = await prisma.user.findMany({
    where: { externalId: null },
    select: { id: true, email: true },
  })
  if (missing.length === 0) return

  for (const user of missing) {
    const generated = await generateUniqueExternalId(user.email)
    await prisma.user.update({
      where: { id: user.id },
      data: { externalId: generated },
    })
  }
}

async function ensureUserDisplayNameColumn() {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "displayName" TEXT`
  )
}

function buildQuestionnaireSnapshot(q: {
  id: string
  title: string
  subtitle: string | null
  sections: unknown
  version: number
}) {
  return {
    id: q.id,
    title: q.title,
    subtitle: q.subtitle,
    sections: q.sections,
    version: q.version,
  }
}

function findMissingQuestionTitle(sections: unknown): { sectionRef: string; questionRef: string } | null {
  if (!Array.isArray(sections)) return { sectionRef: 'unknown', questionRef: 'unknown' }
  for (let sIndex = 0; sIndex < sections.length; sIndex += 1) {
    const section: any = sections[sIndex]
    const sectionRef =
      typeof section?.id === 'string' && section.id.trim()
        ? section.id.trim()
        : String(sIndex + 1)
    if (!Array.isArray(section?.questions)) {
      return { sectionRef, questionRef: 'unknown' }
    }
    for (let qIndex = 0; qIndex < section.questions.length; qIndex += 1) {
      const question: any = section.questions[qIndex]
      const questionTitle = typeof question?.title === 'string' ? question.title.trim() : ''
      if (!questionTitle) {
        const questionRef =
          typeof question?.id === 'string' && question.id.trim()
            ? question.id.trim()
            : `${sectionRef}.${qIndex + 1}`
        return { sectionRef, questionRef }
      }
    }
  }
  return null
}

function extractQuestionTypes(sections: unknown): string[] {
  if (!Array.isArray(sections)) return []
  const found = new Set<string>()
  for (const section of sections as any[]) {
    if (!Array.isArray(section?.questions)) continue
    for (const question of section.questions) {
      if (typeof question?.type === 'string' && question.type.trim()) {
        found.add(question.type.trim())
      }
    }
  }
  return Array.from(found)
}

type AdminAccessMode = 'OWNER_ONLY' | 'OWNER_AND_GROUP'

const normalizeAdminAccessMode = (value: unknown): AdminAccessMode =>
  value === 'OWNER_ONLY' ? 'OWNER_ONLY' : 'OWNER_AND_GROUP'

const parseStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

const HOME_TILE_COLOR_PRESETS: Record<string, string> = {
  default: 'default',
  blue: '#3b82f6',
  green: '#10b981',
  amber: '#f59e0b',
  rose: '#f43f5e',
  slate: '#64748b',
}
const HOME_TILE_ATTRIBUTE_KEYS = new Set([
  'object',
  'objectGroup',
  'dueDate',
  'status',
  'version',
  'completedAt',
  'completedBy',
  'globalTag',
])

const normalizeHomeTileColor = (value: unknown): string => {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!raw) return 'default'
  if (HOME_TILE_COLOR_PRESETS[raw]) return HOME_TILE_COLOR_PRESETS[raw]
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)) return raw
  return 'default'
}

const normalizeHomeTileAttributes = (value: unknown): string[] =>
  parseStringArray(value).filter((entry) => HOME_TILE_ATTRIBUTE_KEYS.has(entry))

type QuestionTypeCatalogEntry = {
  key: string
  label: string
  answerTypeLabel: string
}

const QUESTION_TYPE_CATALOG: QuestionTypeCatalogEntry[] = [
  { key: 'info', label: 'Hinweistext (ohne Antwort)', answerTypeLabel: 'Keine Antwort' },
  { key: 'text', label: 'Kurzer Text', answerTypeLabel: 'Freitext (einzeilig)' },
  { key: 'multiline', label: 'Mehrzeiliger Text', answerTypeLabel: 'Freitext (mehrzeilig)' },
  { key: 'single', label: 'Einzelauswahl', answerTypeLabel: 'Eine Option' },
  { key: 'multi', label: 'Mehrfachauswahl', answerTypeLabel: 'Mehrere Optionen' },
  { key: 'boolean', label: 'Ja/Nein', answerTypeLabel: 'Boolean' },
  { key: 'date_time', label: 'Datum / Datum+Uhrzeit', answerTypeLabel: 'Datum oder Timestamp' },
  { key: 'percentage', label: 'Prozent', answerTypeLabel: '0 bis 100' },
  { key: 'likert', label: 'Skala / Likert', answerTypeLabel: 'Skalenwert' },
  { key: 'ranking', label: 'Ranking', answerTypeLabel: 'Sortierte Liste' },
  { key: 'object_picker', label: 'Objekt-Picker', answerTypeLabel: 'Objekt-Referenz' },
  { key: 'assignment_picker', label: 'Zuordnungs-Picker', answerTypeLabel: 'Option zu Objekt/Benutzer' },
]

async function ensureQuestionTypeSettingsTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "QuestionTypeSetting" (
      "key" TEXT PRIMARY KEY,
      "enabled" BOOLEAN NOT NULL DEFAULT true,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
}

async function getQuestionTypeSettingsMap() {
  await ensureQuestionTypeSettingsTable()
  const rows = (await prisma.$queryRawUnsafe(`
    SELECT "key", "enabled"
    FROM "QuestionTypeSetting"
  `)) as Array<{ key: string; enabled: boolean }>
  const map = new Map<string, boolean>()
  rows.forEach((row) => {
    map.set(String(row.key), !!row.enabled)
  })
  return map
}

async function ensureQuestionnaireCompletionTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "QuestionnaireCompletionConfig" (
      "questionnaireId" TEXT PRIMARY KEY,
      "title" TEXT,
      "content" TEXT,
      "showJiraTicketLink" BOOLEAN NOT NULL DEFAULT false,
      "showReadonlyResultLink" BOOLEAN NOT NULL DEFAULT false,
      "allowReadonlyResultLinkForAllUsers" BOOLEAN NOT NULL DEFAULT false,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "QuestionnaireCompletionConfig" ADD COLUMN IF NOT EXISTS "showJiraTicketLink" BOOLEAN NOT NULL DEFAULT false`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "QuestionnaireCompletionConfig" ADD COLUMN IF NOT EXISTS "showReadonlyResultLink" BOOLEAN NOT NULL DEFAULT false`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "QuestionnaireCompletionConfig" ADD COLUMN IF NOT EXISTS "allowReadonlyResultLinkForAllUsers" BOOLEAN NOT NULL DEFAULT false`
  )
}

async function getQuestionnaireCompletionConfigMap(questionnaireIds: string[]) {
  await ensureQuestionnaireCompletionTable()
  if (questionnaireIds.length === 0)
    return new Map<
      string,
      {
        title: string | null
        content: string | null
        showJiraTicketLink: boolean
        showReadonlyResultLink: boolean
        allowReadonlyResultLinkForAllUsers: boolean
      }
    >()
  const rows = (await prisma.$queryRawUnsafe(
    `
      SELECT "questionnaireId", "title", "content", "showJiraTicketLink", "showReadonlyResultLink", "allowReadonlyResultLinkForAllUsers"
      FROM "QuestionnaireCompletionConfig"
      WHERE "questionnaireId" = ANY($1)
    `,
    questionnaireIds
  )) as Array<{
    questionnaireId: string
    title: string | null
    content: string | null
    showJiraTicketLink: boolean
    showReadonlyResultLink: boolean
    allowReadonlyResultLinkForAllUsers: boolean
  }>
  const map = new Map<
    string,
    {
      title: string | null
      content: string | null
      showJiraTicketLink: boolean
      showReadonlyResultLink: boolean
      allowReadonlyResultLinkForAllUsers: boolean
    }
  >()
  rows.forEach((row) => {
    map.set(row.questionnaireId, {
      title: row.title,
      content: row.content,
      showJiraTicketLink: Boolean(row.showJiraTicketLink),
      showReadonlyResultLink: Boolean(row.showReadonlyResultLink),
      allowReadonlyResultLinkForAllUsers: Boolean(row.allowReadonlyResultLinkForAllUsers),
    })
  })
  return map
}

async function setQuestionnaireCompletionConfig(
  questionnaireId: string,
  title?: string | null,
  content?: string | null,
  showJiraTicketLink?: boolean,
  showReadonlyResultLink?: boolean,
  allowReadonlyResultLinkForAllUsers?: boolean
) {
  await ensureQuestionnaireCompletionTable()
  const normalizedTitle = typeof title === 'string' && title.trim() ? title.trim() : null
  const normalizedContent = typeof content === 'string' && content.trim() ? content : null
  const hasJiraFlag = typeof showJiraTicketLink === 'boolean'
  const hasReadonlyFlag = typeof showReadonlyResultLink === 'boolean'
  const hasReadonlyPublicFlag = typeof allowReadonlyResultLinkForAllUsers === 'boolean'
  if (!normalizedTitle && !normalizedContent && !hasJiraFlag && !hasReadonlyFlag && !hasReadonlyPublicFlag) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "QuestionnaireCompletionConfig" WHERE "questionnaireId" = $1`,
      questionnaireId
    )
    return
  }
  const currentMap = await getQuestionnaireCompletionConfigMap([questionnaireId])
  const current = currentMap.get(questionnaireId)
  const resolvedShowJiraTicketLink =
    typeof showJiraTicketLink === 'boolean'
      ? showJiraTicketLink
      : (current?.showJiraTicketLink ?? false)
  const resolvedShowReadonlyResultLink =
    typeof showReadonlyResultLink === 'boolean'
      ? showReadonlyResultLink
      : (current?.showReadonlyResultLink ?? false)
  const resolvedAllowReadonlyResultLinkForAllUsers =
    typeof allowReadonlyResultLinkForAllUsers === 'boolean'
      ? allowReadonlyResultLinkForAllUsers
      : (current?.allowReadonlyResultLinkForAllUsers ?? false)
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO "QuestionnaireCompletionConfig" ("questionnaireId", "title", "content", "showJiraTicketLink", "showReadonlyResultLink", "allowReadonlyResultLinkForAllUsers", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, $6, now())
      ON CONFLICT ("questionnaireId")
      DO UPDATE SET
        "title" = EXCLUDED."title",
        "content" = EXCLUDED."content",
        "showJiraTicketLink" = EXCLUDED."showJiraTicketLink",
        "showReadonlyResultLink" = EXCLUDED."showReadonlyResultLink",
        "allowReadonlyResultLinkForAllUsers" = EXCLUDED."allowReadonlyResultLinkForAllUsers",
        "updatedAt" = now()
    `,
    questionnaireId,
    normalizedTitle,
    normalizedContent,
    resolvedShowJiraTicketLink,
    resolvedShowReadonlyResultLink,
    resolvedAllowReadonlyResultLinkForAllUsers
  )
}

type QuestionnaireJiraConfig = {
  questionnaireId: string
  autoCreateOnSubmission: boolean
  attachExcelToIssue: boolean
  attachPdfToIssue: boolean
  includeSurveyTextInDescription: boolean
  includeReadonlyLinkInDescription: boolean
  descriptionIntroHtml: string | null
  projectKey: string | null
  issueType: string | null
  summaryTemplate: string | null
  summaryQuestionId: string | null
  summaryPrefix: string | null
  summarySuffix: string | null
  includeObjectInSummary: boolean
  includeObjectAsComponent: boolean
  assignee: string | null
  contactPerson: string | null
  contactPersonMode: 'STATIC' | 'SUBMITTER_USER_ID'
  epicName: string | null
  components: string[]
  dueDate: string | null
}

type QuestionnaireJiraConfigListItem = QuestionnaireJiraConfig & {
  questionnaireTitle: string
  questionnaireDeletedAt: string | null
  updatedAt: string
}

type SubmissionJiraIssueLink = {
  submissionId: string
  issueKey: string
  issueId: string | null
  browseUrl: string | null
  createdAt: string
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => String(entry ?? '').trim())
    .filter(Boolean)
}

function normalizeQuestionnaireJiraConfigRow(row: any): QuestionnaireJiraConfig {
  const componentsRaw =
    row?.components && typeof row.components === 'object' ? row.components : []
  return {
    questionnaireId: String(row.questionnaireId),
    autoCreateOnSubmission: Boolean(row.autoCreateOnSubmission),
    attachExcelToIssue: Boolean(row.attachExcelToIssue),
    attachPdfToIssue: Boolean(row.attachPdfToIssue),
    includeSurveyTextInDescription:
      row.includeSurveyTextInDescription === undefined
        ? row.descriptionMode !== 'NONE' && row.descriptionMode !== 'READONLY_LINK'
        : Boolean(row.includeSurveyTextInDescription),
    includeReadonlyLinkInDescription:
      row.includeReadonlyLinkInDescription === undefined
        ? row.descriptionMode === 'READONLY_LINK'
        : Boolean(row.includeReadonlyLinkInDescription),
    descriptionIntroHtml: normalizeOptionalString(row.descriptionIntroHtml),
    projectKey: normalizeOptionalString(row.projectKey),
    issueType: normalizeOptionalString(row.issueType),
    summaryTemplate: normalizeOptionalString(row.summaryTemplate),
    summaryQuestionId: normalizeOptionalString(row.summaryQuestionId),
    summaryPrefix: normalizeOptionalString(row.summaryPrefix),
    summarySuffix: normalizeOptionalString(row.summarySuffix),
    includeObjectInSummary: Boolean(row.includeObjectInSummary),
    includeObjectAsComponent: Boolean(row.includeObjectAsComponent),
    assignee: normalizeOptionalString(row.assignee),
    contactPerson: normalizeOptionalString(row.contactPerson),
    contactPersonMode:
      row.contactPersonMode === 'SUBMITTER_USER_ID' ? 'SUBMITTER_USER_ID' : 'STATIC',
    epicName: normalizeOptionalString(row.epicName),
    components: normalizeStringArray(componentsRaw),
    dueDate: normalizeOptionalString(row.dueDate),
  }
}

const DEFAULT_QUESTIONNAIRE_JIRA_CONFIG = (questionnaireId: string): QuestionnaireJiraConfig => ({
  questionnaireId,
  autoCreateOnSubmission: false,
  attachExcelToIssue: false,
  attachPdfToIssue: false,
  includeSurveyTextInDescription: true,
  includeReadonlyLinkInDescription: false,
  descriptionIntroHtml: null,
  projectKey: null,
  issueType: null,
  summaryTemplate: null,
  summaryQuestionId: null,
  summaryPrefix: null,
  summarySuffix: null,
  includeObjectInSummary: false,
  includeObjectAsComponent: false,
  assignee: null,
  contactPerson: null,
  contactPersonMode: 'STATIC',
  epicName: null,
  components: [],
  dueDate: null,
})

async function ensureQuestionnaireJiraConfigTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "QuestionnaireJiraConfig" (
      "questionnaireId" TEXT PRIMARY KEY,
      "autoCreateOnSubmission" BOOLEAN NOT NULL DEFAULT false,
      "attachExcelToIssue" BOOLEAN NOT NULL DEFAULT false,
      "attachPdfToIssue" BOOLEAN NOT NULL DEFAULT false,
      "descriptionMode" TEXT NOT NULL DEFAULT 'INLINE_RESULTS',
      "includeSurveyTextInDescription" BOOLEAN NOT NULL DEFAULT true,
      "includeReadonlyLinkInDescription" BOOLEAN NOT NULL DEFAULT false,
      "descriptionIntroHtml" TEXT,
      "projectKey" TEXT,
      "issueType" TEXT,
      "summaryTemplate" TEXT,
      "summaryQuestionId" TEXT,
      "summaryPrefix" TEXT,
      "summarySuffix" TEXT,
      "includeObjectInSummary" BOOLEAN NOT NULL DEFAULT false,
      "includeObjectAsComponent" BOOLEAN NOT NULL DEFAULT false,
      "assignee" TEXT,
      "contactPerson" TEXT,
      "contactPersonMode" TEXT NOT NULL DEFAULT 'STATIC',
      "epicName" TEXT,
      "components" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "dueDate" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "QuestionnaireJiraConfig" ADD COLUMN IF NOT EXISTS "attachExcelToIssue" BOOLEAN NOT NULL DEFAULT false`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "QuestionnaireJiraConfig" ADD COLUMN IF NOT EXISTS "attachPdfToIssue" BOOLEAN NOT NULL DEFAULT false`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "QuestionnaireJiraConfig" ADD COLUMN IF NOT EXISTS "descriptionMode" TEXT NOT NULL DEFAULT 'INLINE_RESULTS'`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "QuestionnaireJiraConfig" ADD COLUMN IF NOT EXISTS "includeSurveyTextInDescription" BOOLEAN NOT NULL DEFAULT true`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "QuestionnaireJiraConfig" ADD COLUMN IF NOT EXISTS "includeReadonlyLinkInDescription" BOOLEAN NOT NULL DEFAULT false`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "QuestionnaireJiraConfig" ADD COLUMN IF NOT EXISTS "descriptionIntroHtml" TEXT`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "QuestionnaireJiraConfig" ADD COLUMN IF NOT EXISTS "summaryQuestionId" TEXT`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "QuestionnaireJiraConfig" ADD COLUMN IF NOT EXISTS "summaryPrefix" TEXT`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "QuestionnaireJiraConfig" ADD COLUMN IF NOT EXISTS "summarySuffix" TEXT`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "QuestionnaireJiraConfig" ADD COLUMN IF NOT EXISTS "includeObjectInSummary" BOOLEAN NOT NULL DEFAULT false`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "QuestionnaireJiraConfig" ADD COLUMN IF NOT EXISTS "includeObjectAsComponent" BOOLEAN NOT NULL DEFAULT false`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "QuestionnaireJiraConfig" ADD COLUMN IF NOT EXISTS "contactPersonMode" TEXT NOT NULL DEFAULT 'STATIC'`
  )
}

async function getQuestionnaireJiraConfig(questionnaireId: string): Promise<QuestionnaireJiraConfig> {
  await ensureQuestionnaireJiraConfigTable()
  const rows = (await prisma.$queryRawUnsafe(
    `
      SELECT
        "questionnaireId",
        "autoCreateOnSubmission",
        "attachExcelToIssue",
        "attachPdfToIssue",
        "descriptionMode",
        "includeSurveyTextInDescription",
        "includeReadonlyLinkInDescription",
        "descriptionIntroHtml",
        "projectKey",
        "issueType",
        "summaryTemplate",
        "summaryQuestionId",
        "summaryPrefix",
        "summarySuffix",
        "includeObjectInSummary",
        "includeObjectAsComponent",
        "assignee",
        "contactPerson",
        "contactPersonMode",
        "epicName",
        "components",
        "dueDate"
      FROM "QuestionnaireJiraConfig"
      WHERE "questionnaireId" = $1
      LIMIT 1
    `,
    questionnaireId
  )) as any[]
  if (!rows[0]) return DEFAULT_QUESTIONNAIRE_JIRA_CONFIG(questionnaireId)
  return normalizeQuestionnaireJiraConfigRow(rows[0])
}

async function upsertQuestionnaireJiraConfig(
  questionnaireId: string,
  input: Partial<QuestionnaireJiraConfig>
): Promise<QuestionnaireJiraConfig> {
  await ensureQuestionnaireJiraConfigTable()
  const current = await getQuestionnaireJiraConfig(questionnaireId)
  const next: QuestionnaireJiraConfig = {
    questionnaireId,
    autoCreateOnSubmission:
      typeof input.autoCreateOnSubmission === 'boolean'
        ? input.autoCreateOnSubmission
        : current.autoCreateOnSubmission,
    attachExcelToIssue:
      typeof input.attachExcelToIssue === 'boolean'
        ? input.attachExcelToIssue
        : current.attachExcelToIssue,
    attachPdfToIssue:
      typeof input.attachPdfToIssue === 'boolean'
        ? input.attachPdfToIssue
        : current.attachPdfToIssue,
    includeSurveyTextInDescription:
      typeof input.includeSurveyTextInDescription === 'boolean'
        ? input.includeSurveyTextInDescription
        : current.includeSurveyTextInDescription,
    includeReadonlyLinkInDescription:
      typeof input.includeReadonlyLinkInDescription === 'boolean'
        ? input.includeReadonlyLinkInDescription
        : current.includeReadonlyLinkInDescription,
    descriptionIntroHtml:
      input.descriptionIntroHtml === undefined
        ? current.descriptionIntroHtml
        : normalizeOptionalString(input.descriptionIntroHtml),
    projectKey: input.projectKey === undefined ? current.projectKey : normalizeOptionalString(input.projectKey),
    issueType: input.issueType === undefined ? current.issueType : normalizeOptionalString(input.issueType),
    summaryTemplate:
      input.summaryTemplate === undefined
        ? current.summaryTemplate
        : normalizeOptionalString(input.summaryTemplate),
    summaryQuestionId:
      input.summaryQuestionId === undefined
        ? current.summaryQuestionId
        : normalizeOptionalString(input.summaryQuestionId),
    summaryPrefix:
      input.summaryPrefix === undefined
        ? current.summaryPrefix
        : normalizeOptionalString(input.summaryPrefix),
    summarySuffix:
      input.summarySuffix === undefined
        ? current.summarySuffix
        : normalizeOptionalString(input.summarySuffix),
    includeObjectInSummary:
      typeof input.includeObjectInSummary === 'boolean'
        ? input.includeObjectInSummary
        : current.includeObjectInSummary,
    includeObjectAsComponent:
      typeof input.includeObjectAsComponent === 'boolean'
        ? input.includeObjectAsComponent
        : current.includeObjectAsComponent,
    assignee: input.assignee === undefined ? current.assignee : normalizeOptionalString(input.assignee),
    contactPerson:
      input.contactPerson === undefined ? current.contactPerson : normalizeOptionalString(input.contactPerson),
    contactPersonMode:
      input.contactPersonMode === 'SUBMITTER_USER_ID'
        ? 'SUBMITTER_USER_ID'
        : input.contactPersonMode === 'STATIC'
          ? 'STATIC'
          : current.contactPersonMode,
    epicName: input.epicName === undefined ? current.epicName : normalizeOptionalString(input.epicName),
    components: input.components === undefined ? current.components : normalizeStringArray(input.components),
    dueDate: input.dueDate === undefined ? current.dueDate : normalizeOptionalString(input.dueDate),
  }

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO "QuestionnaireJiraConfig" (
        "questionnaireId",
        "autoCreateOnSubmission",
        "attachExcelToIssue",
        "attachPdfToIssue",
        "descriptionMode",
        "includeSurveyTextInDescription",
        "includeReadonlyLinkInDescription",
        "descriptionIntroHtml",
        "projectKey",
        "issueType",
        "summaryTemplate",
        "summaryQuestionId",
        "summaryPrefix",
        "summarySuffix",
        "includeObjectInSummary",
        "includeObjectAsComponent",
        "assignee",
        "contactPerson",
        "contactPersonMode",
        "epicName",
        "components",
        "dueDate",
        "createdAt",
        "updatedAt"
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22,now(),now())
      ON CONFLICT ("questionnaireId")
      DO UPDATE SET
        "autoCreateOnSubmission" = EXCLUDED."autoCreateOnSubmission",
        "attachExcelToIssue" = EXCLUDED."attachExcelToIssue",
        "attachPdfToIssue" = EXCLUDED."attachPdfToIssue",
        "descriptionMode" = EXCLUDED."descriptionMode",
        "includeSurveyTextInDescription" = EXCLUDED."includeSurveyTextInDescription",
        "includeReadonlyLinkInDescription" = EXCLUDED."includeReadonlyLinkInDescription",
        "descriptionIntroHtml" = EXCLUDED."descriptionIntroHtml",
        "projectKey" = EXCLUDED."projectKey",
        "issueType" = EXCLUDED."issueType",
        "summaryTemplate" = EXCLUDED."summaryTemplate",
        "summaryQuestionId" = EXCLUDED."summaryQuestionId",
        "summaryPrefix" = EXCLUDED."summaryPrefix",
        "summarySuffix" = EXCLUDED."summarySuffix",
        "includeObjectInSummary" = EXCLUDED."includeObjectInSummary",
        "includeObjectAsComponent" = EXCLUDED."includeObjectAsComponent",
        "assignee" = EXCLUDED."assignee",
        "contactPerson" = EXCLUDED."contactPerson",
        "contactPersonMode" = EXCLUDED."contactPersonMode",
        "epicName" = EXCLUDED."epicName",
        "components" = EXCLUDED."components",
        "dueDate" = EXCLUDED."dueDate",
        "updatedAt" = now()
    `,
    next.questionnaireId,
    next.autoCreateOnSubmission,
    next.attachExcelToIssue,
    next.attachPdfToIssue,
    next.includeSurveyTextInDescription
      ? next.includeReadonlyLinkInDescription
        ? 'READONLY_LINK'
        : 'INLINE_RESULTS'
      : 'NONE',
    next.includeSurveyTextInDescription,
    next.includeReadonlyLinkInDescription,
    next.descriptionIntroHtml,
    next.projectKey,
    next.issueType,
    next.summaryTemplate,
    next.summaryQuestionId,
    next.summaryPrefix,
    next.summarySuffix,
    next.includeObjectInSummary,
    next.includeObjectAsComponent,
    next.assignee,
    next.contactPerson,
    next.contactPersonMode,
    next.epicName,
    JSON.stringify(next.components),
    next.dueDate
  )

  return next
}

async function listQuestionnaireJiraConfigsForUser(user: { id: string; role: Role }) {
  await ensureQuestionnaireJiraConfigTable()
  const rows = (await prisma.$queryRawUnsafe(`
    SELECT
      c."questionnaireId",
      c."autoCreateOnSubmission",
      c."attachExcelToIssue",
      c."attachPdfToIssue",
      c."descriptionMode",
      c."includeSurveyTextInDescription",
      c."includeReadonlyLinkInDescription",
      c."descriptionIntroHtml",
      c."projectKey",
      c."issueType",
      c."summaryTemplate",
      c."summaryQuestionId",
      c."summaryPrefix",
      c."summarySuffix",
      c."includeObjectInSummary",
      c."includeObjectAsComponent",
      c."assignee",
      c."contactPerson",
      c."contactPersonMode",
      c."epicName",
      c."components",
      c."dueDate",
      c."updatedAt",
      q."title" AS "questionnaireTitle",
      q."deletedAt" AS "questionnaireDeletedAt",
      q."createdByUserId",
      q."adminAccessMode",
      q."adminGroupIds"
    FROM "QuestionnaireJiraConfig" c
    JOIN "Questionnaire" q ON q."id" = c."questionnaireId"
    ORDER BY c."updatedAt" DESC
  `)) as Array<
    {
      questionnaireId: string
      autoCreateOnSubmission: boolean
      attachExcelToIssue: boolean
      attachPdfToIssue: boolean
      descriptionMode: string | null
      includeSurveyTextInDescription: boolean | null
      includeReadonlyLinkInDescription: boolean | null
      descriptionIntroHtml: string | null
      projectKey: string | null
      issueType: string | null
      summaryTemplate: string | null
      summaryQuestionId: string | null
      summaryPrefix: string | null
      summarySuffix: string | null
      includeObjectInSummary: boolean
      includeObjectAsComponent: boolean
      assignee: string | null
      contactPerson: string | null
      contactPersonMode: string | null
      epicName: string | null
      components: unknown
      dueDate: string | null
      updatedAt: Date | string
      questionnaireTitle: string
      questionnaireDeletedAt: Date | string | null
      createdByUserId: string | null
      adminAccessMode: unknown
      adminGroupIds: unknown
    }
  >

  if (user.role === 'ADMIN') {
    return rows.map((row) => {
      const normalized = normalizeQuestionnaireJiraConfigRow(row)
      const updatedAt = new Date(row.updatedAt).toISOString()
      return {
        ...normalized,
        questionnaireTitle: row.questionnaireTitle || row.questionnaireId,
        questionnaireDeletedAt: row.questionnaireDeletedAt
          ? new Date(row.questionnaireDeletedAt).toISOString()
          : null,
        updatedAt,
      } satisfies QuestionnaireJiraConfigListItem
    })
  }

  const userGroupIds = await getUserGroupIds(user.id)
  const creatorIds = Array.from(
    new Set(rows.map((row) => row.createdByUserId).filter((id): id is string => Boolean(id)))
  )
  const creatorMembers = creatorIds.length
    ? await prisma.groupMember.findMany({
        where: { userId: { in: creatorIds } },
        select: { userId: true, groupId: true },
      })
    : []
  const creatorGroupMap = new Map<string, string[]>()
  creatorMembers.forEach((entry) => {
    const current = creatorGroupMap.get(entry.userId) ?? []
    current.push(entry.groupId)
    creatorGroupMap.set(entry.userId, current)
  })
  const questionnaireGroupRows = rows.length
    ? await prisma.groupQuestionnaire.findMany({
        where: { questionnaireId: { in: rows.map((row) => row.questionnaireId) } },
        select: { questionnaireId: true, groupId: true },
      })
    : []
  const assignedGroupMap = new Map<string, string[]>()
  questionnaireGroupRows.forEach((entry) => {
    const current = assignedGroupMap.get(entry.questionnaireId) ?? []
    current.push(entry.groupId)
    assignedGroupMap.set(entry.questionnaireId, current)
  })

  return rows
    .filter((row) =>
      canManageQuestionnaireByScope({
        userId: user.id,
        userRole: user.role,
        userGroupIds,
        questionnaire: {
          id: row.questionnaireId,
          createdByUserId: row.createdByUserId,
          adminAccessMode: normalizeAdminAccessMode(row.adminAccessMode),
          adminGroupIds: parseStringArray(row.adminGroupIds),
          assignedGroupIds: assignedGroupMap.get(row.questionnaireId) ?? [],
          creatorGroupIds: row.createdByUserId ? creatorGroupMap.get(row.createdByUserId) ?? [] : [],
        },
      })
    )
    .map((row) => {
      const normalized = normalizeQuestionnaireJiraConfigRow(row)
      const updatedAt = new Date(row.updatedAt).toISOString()
      return {
        ...normalized,
        questionnaireTitle: row.questionnaireTitle || row.questionnaireId,
        questionnaireDeletedAt: row.questionnaireDeletedAt
          ? new Date(row.questionnaireDeletedAt).toISOString()
          : null,
        updatedAt,
      } satisfies QuestionnaireJiraConfigListItem
    })
}

async function ensureSubmissionJiraIssueTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "SubmissionJiraIssue" (
      "submissionId" TEXT NOT NULL,
      "issueKey" TEXT NOT NULL,
      "issueId" TEXT,
      "browseUrl" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE ("submissionId", "issueKey")
    )
  `)
}

async function storeSubmissionJiraIssue(
  submissionId: string,
  issue: { key: string; id: string | null; browseUrl: string | null }
) {
  await ensureSubmissionJiraIssueTable()
  if (!issue.key) return
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO "SubmissionJiraIssue" ("submissionId", "issueKey", "issueId", "browseUrl", "createdAt")
      VALUES ($1,$2,$3,$4,now())
      ON CONFLICT ("submissionId", "issueKey")
      DO NOTHING
    `,
    submissionId,
    issue.key,
    issue.id,
    issue.browseUrl
  )
}

async function getLatestSubmissionJiraIssueMap(submissionIds: string[]) {
  await ensureSubmissionJiraIssueTable()
  if (submissionIds.length === 0) return new Map<string, SubmissionJiraIssueLink>()
  const rows = (await prisma.$queryRawUnsafe(
    `
      SELECT DISTINCT ON ("submissionId")
        "submissionId",
        "issueKey",
        "issueId",
        "browseUrl",
        "createdAt"
      FROM "SubmissionJiraIssue"
      WHERE "submissionId" = ANY($1)
      ORDER BY "submissionId", "createdAt" DESC
    `,
    submissionIds
  )) as Array<{
    submissionId: string
    issueKey: string
    issueId: string | null
    browseUrl: string | null
    createdAt: Date | string
  }>
  const map = new Map<string, SubmissionJiraIssueLink>()
  rows.forEach((row) => {
    map.set(row.submissionId, {
      submissionId: row.submissionId,
      issueKey: row.issueKey,
      issueId: row.issueId,
      browseUrl: row.browseUrl,
      createdAt: new Date(row.createdAt).toISOString(),
    })
  })
  return map
}

type HomePageConfig = {
  title: string
  subtitle: string
  descriptionHtml: string
  faviconDataUrl: string
  welcomeContentHtml: string
  headingOpenTasks: string
  headingGlobalCatalogs: string
  headingClosedTasks: string
  tileOpenTitle: string
  tileOpenDescription: string
  tileOpenBackgroundColor: string
  tileOpenBackgroundColorDark: string
  tileGlobalTitle: string
  tileGlobalDescription: string
  tileGlobalBackgroundColor: string
  tileGlobalBackgroundColorDark: string
  tileHistoryTitle: string
  tileHistoryDescription: string
  tileHistoryBackgroundColor: string
  tileHistoryBackgroundColorDark: string
  showOpenTasks: boolean
  showGlobalCatalogs: boolean
  showClosedTasks: boolean
  openTasksGrouping: 'object' | 'object_group'
  defaultRouteAfterLogin: string
}

type LoginPageConfig = {
  title: string
  subtitle: string
  hintText: string
  usernameLabel: string
  usernamePlaceholder: string
  passwordLabel: string
  passwordPlaceholder: string
  submitButtonLabel: string
  logoDataUrl: string
  logoWidthPx: number
  logoPlacement: 'top' | 'left' | 'right' | 'center' | 'header'
}

type QuestionnaireEditorLockInfo = {
  questionnaireId: string
  userId: string
  userEmail: string | null
  lockedAt: Date
  expiresAt: Date
}

const DEFAULT_HOME_PAGE_CONFIG: HomePageConfig = {
  title: 'Polltodo',
  subtitle: 'Ihre Umfrage- und Aufgabenplattform.',
  descriptionHtml: '',
  faviconDataUrl: '',
  welcomeContentHtml:
    '<h2>Willkommen bei Polltodo</h2><p>Offene Umfragen, globale Kataloge und Historie auf einen Blick.</p>',
  headingOpenTasks: 'Offene Umfragen',
  headingGlobalCatalogs: 'Globale Fragenkataloge',
  headingClosedTasks: 'Abgeschlossene Umfragen',
  tileOpenTitle: 'Offene Umfragen',
  tileOpenDescription: 'Zeigt alle Ihnen zugewiesenen offenen Umfragen.',
  tileOpenBackgroundColor: '#fffbeb',
  tileOpenBackgroundColorDark: '#3a2f15',
  tileGlobalTitle: 'Allgemeine Fragenkataloge',
  tileGlobalDescription: 'Zeigt globale Fragenkataloge fuer alle Benutzer.',
  tileGlobalBackgroundColor: '#eff6ff',
  tileGlobalBackgroundColorDark: '#172d45',
  tileHistoryTitle: 'Bereits durchgefuehrte Umfragen',
  tileHistoryDescription: 'Zeigt abgeschlossene Umfragen und Historie.',
  tileHistoryBackgroundColor: '#ecfdf5',
  tileHistoryBackgroundColorDark: '#143427',
  showOpenTasks: true,
  showGlobalCatalogs: true,
  showClosedTasks: true,
  openTasksGrouping: 'object_group',
  defaultRouteAfterLogin: '/',
}

async function ensureQuestionnaireEditorLockTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "QuestionnaireEditorLock" (
      "questionnaireId" TEXT PRIMARY KEY REFERENCES "Questionnaire"("id") ON DELETE CASCADE,
      "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
      "lockedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "expiresAt" TIMESTAMPTZ NOT NULL,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
}

async function getActiveQuestionnaireEditorLockMap(questionnaireIds: string[]) {
  await ensureQuestionnaireEditorLockTable()
  const ids = Array.from(new Set(questionnaireIds.filter(Boolean)))
  const map = new Map<string, QuestionnaireEditorLockInfo>()
  if (ids.length === 0) return map
  const rows = (await prisma.$queryRawUnsafe(
    `
      SELECT
        l."questionnaireId",
        l."userId",
        u."email" as "userEmail",
        l."lockedAt",
        l."expiresAt"
      FROM "QuestionnaireEditorLock" l
      LEFT JOIN "User" u ON u."id" = l."userId"
      WHERE l."questionnaireId" = ANY($1::text[])
        AND l."expiresAt" > now()
    `,
    ids
  )) as QuestionnaireEditorLockInfo[]
  rows.forEach((row) => map.set(row.questionnaireId, row))
  return map
}

async function getActiveQuestionnaireEditorLock(questionnaireId: string) {
  const map = await getActiveQuestionnaireEditorLockMap([questionnaireId])
  return map.get(questionnaireId) ?? null
}

async function acquireQuestionnaireEditorLock(questionnaireId: string, userId: string) {
  await ensureQuestionnaireEditorLockTable()
  const expiresAt = new Date(Date.now() + QUESTIONNAIRE_EDITOR_LOCK_TTL_SECONDS * 1000)
  const changed = await prisma.$executeRawUnsafe(
    `
      INSERT INTO "QuestionnaireEditorLock" (
        "questionnaireId",
        "userId",
        "lockedAt",
        "expiresAt",
        "updatedAt"
      ) VALUES (
        $1, $2, now(), $3, now()
      )
      ON CONFLICT ("questionnaireId")
      DO UPDATE SET
        "userId" = EXCLUDED."userId",
        "lockedAt" = now(),
        "expiresAt" = EXCLUDED."expiresAt",
        "updatedAt" = now()
      WHERE
        "QuestionnaireEditorLock"."userId" = EXCLUDED."userId"
        OR "QuestionnaireEditorLock"."expiresAt" <= now()
    `,
    questionnaireId,
    userId,
    expiresAt
  )
  const lock = await getActiveQuestionnaireEditorLock(questionnaireId)
  return {
    acquired: changed > 0 && !!lock && lock.userId === userId,
    lock,
  }
}

async function releaseQuestionnaireEditorLock(questionnaireId: string, userId: string) {
  await ensureQuestionnaireEditorLockTable()
  const deleted = await prisma.$executeRawUnsafe(
    `
      DELETE FROM "QuestionnaireEditorLock"
      WHERE "questionnaireId" = $1
        AND "userId" = $2
    `,
    questionnaireId,
    userId
  )
  return deleted > 0
}

const DEFAULT_LOGIN_PAGE_CONFIG: LoginPageConfig = {
  title: 'Anmelden',
  subtitle: 'Bitte melden Sie sich an, um fortzufahren.',
  hintText: '',
  usernameLabel: 'E-Mail oder Benutzername',
  usernamePlaceholder: 'E-Mail oder Benutzername',
  passwordLabel: 'Passwort',
  passwordPlaceholder: 'Passwort',
  submitButtonLabel: 'Anmelden',
  logoDataUrl: '',
  logoWidthPx: 180,
  logoPlacement: 'top',
}

async function ensureHomePageConfigTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "HomePageConfig" (
      "id" TEXT PRIMARY KEY,
      "title" TEXT NOT NULL,
      "subtitle" TEXT NOT NULL,
      "descriptionHtml" TEXT NOT NULL,
      "faviconDataUrl" TEXT NOT NULL DEFAULT '',
      "welcomeContentHtml" TEXT NOT NULL DEFAULT '',
      "headingOpenTasks" TEXT NOT NULL,
      "headingGlobalCatalogs" TEXT NOT NULL,
      "headingClosedTasks" TEXT NOT NULL,
      "tileOpenTitle" TEXT NOT NULL DEFAULT 'Offene Umfragen',
      "tileOpenDescription" TEXT NOT NULL DEFAULT 'Zeigt alle Ihnen zugewiesenen offenen Umfragen.',
      "tileOpenBackgroundColor" TEXT NOT NULL DEFAULT '#fffbeb',
      "tileOpenBackgroundColorDark" TEXT NOT NULL DEFAULT '#3a2f15',
      "tileGlobalTitle" TEXT NOT NULL DEFAULT 'Allgemeine Fragenkataloge',
      "tileGlobalDescription" TEXT NOT NULL DEFAULT 'Zeigt globale Fragenkataloge fuer alle Benutzer.',
      "tileGlobalBackgroundColor" TEXT NOT NULL DEFAULT '#eff6ff',
      "tileGlobalBackgroundColorDark" TEXT NOT NULL DEFAULT '#172d45',
      "tileHistoryTitle" TEXT NOT NULL DEFAULT 'Bereits durchgefuehrte Umfragen',
      "tileHistoryDescription" TEXT NOT NULL DEFAULT 'Zeigt abgeschlossene Umfragen und Historie.',
      "tileHistoryBackgroundColor" TEXT NOT NULL DEFAULT '#ecfdf5',
      "tileHistoryBackgroundColorDark" TEXT NOT NULL DEFAULT '#143427',
      "showOpenTasks" BOOLEAN NOT NULL DEFAULT true,
      "showGlobalCatalogs" BOOLEAN NOT NULL DEFAULT true,
      "showClosedTasks" BOOLEAN NOT NULL DEFAULT true,
      "openTasksGrouping" TEXT NOT NULL DEFAULT 'object_group',
      "defaultRouteAfterLogin" TEXT NOT NULL DEFAULT '/',
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "HomePageConfig" ADD COLUMN IF NOT EXISTS "faviconDataUrl" TEXT NOT NULL DEFAULT ''`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "HomePageConfig" ADD COLUMN IF NOT EXISTS "welcomeContentHtml" TEXT NOT NULL DEFAULT ''`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "HomePageConfig" ADD COLUMN IF NOT EXISTS "tileOpenTitle" TEXT NOT NULL DEFAULT 'Offene Umfragen'`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "HomePageConfig" ADD COLUMN IF NOT EXISTS "tileOpenDescription" TEXT NOT NULL DEFAULT 'Zeigt alle Ihnen zugewiesenen offenen Umfragen.'`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "HomePageConfig" ADD COLUMN IF NOT EXISTS "tileOpenBackgroundColor" TEXT NOT NULL DEFAULT '#fffbeb'`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "HomePageConfig" ADD COLUMN IF NOT EXISTS "tileOpenBackgroundColorDark" TEXT NOT NULL DEFAULT '#3a2f15'`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "HomePageConfig" ADD COLUMN IF NOT EXISTS "tileGlobalTitle" TEXT NOT NULL DEFAULT 'Allgemeine Fragenkataloge'`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "HomePageConfig" ADD COLUMN IF NOT EXISTS "tileGlobalDescription" TEXT NOT NULL DEFAULT 'Zeigt globale Fragenkataloge fuer alle Benutzer.'`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "HomePageConfig" ADD COLUMN IF NOT EXISTS "tileGlobalBackgroundColor" TEXT NOT NULL DEFAULT '#eff6ff'`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "HomePageConfig" ADD COLUMN IF NOT EXISTS "tileGlobalBackgroundColorDark" TEXT NOT NULL DEFAULT '#172d45'`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "HomePageConfig" ADD COLUMN IF NOT EXISTS "tileHistoryTitle" TEXT NOT NULL DEFAULT 'Bereits durchgefuehrte Umfragen'`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "HomePageConfig" ADD COLUMN IF NOT EXISTS "tileHistoryDescription" TEXT NOT NULL DEFAULT 'Zeigt abgeschlossene Umfragen und Historie.'`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "HomePageConfig" ADD COLUMN IF NOT EXISTS "tileHistoryBackgroundColor" TEXT NOT NULL DEFAULT '#ecfdf5'`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "HomePageConfig" ADD COLUMN IF NOT EXISTS "tileHistoryBackgroundColorDark" TEXT NOT NULL DEFAULT '#143427'`
  )
}

async function ensureLoginPageConfigTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "LoginPageConfig" (
      "id" TEXT PRIMARY KEY,
      "title" TEXT NOT NULL,
      "subtitle" TEXT NOT NULL,
      "hintText" TEXT NOT NULL DEFAULT '',
      "usernameLabel" TEXT NOT NULL,
      "usernamePlaceholder" TEXT NOT NULL,
      "passwordLabel" TEXT NOT NULL,
      "passwordPlaceholder" TEXT NOT NULL,
      "submitButtonLabel" TEXT NOT NULL,
      "logoDataUrl" TEXT NOT NULL DEFAULT '',
      "logoWidthPx" INTEGER NOT NULL DEFAULT 180,
      "logoPlacement" TEXT NOT NULL DEFAULT 'top',
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
}

async function ensureObjectQuestionnairePrefillTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ObjectQuestionnairePrefill" (
      "id" TEXT PRIMARY KEY,
      "objectId" TEXT NOT NULL,
      "questionnaireId" TEXT NOT NULL,
      "questionnaireVersion" INTEGER,
      "answersJson" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "createdByUserId" TEXT,
      "updatedByUserId" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE ("objectId", "questionnaireId")
    )
  `)
}

async function ensureObjectPolicyPrefillConfigTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ObjectSurveyPolicyPrefillConfig" (
      "policyId" TEXT PRIMARY KEY,
      "allowLastSubmissionPrefill" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ObjectGroupPolicyPrefillConfig" (
      "groupPolicyId" TEXT PRIMARY KEY,
      "allowLastSubmissionPrefill" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
}

async function setObjectPolicyPrefillConfig(policyId: string, allow: boolean) {
  await ensureObjectPolicyPrefillConfigTables()
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO "ObjectSurveyPolicyPrefillConfig" ("policyId","allowLastSubmissionPrefill","createdAt","updatedAt")
      VALUES ($1,$2,now(),now())
      ON CONFLICT ("policyId") DO UPDATE
      SET "allowLastSubmissionPrefill" = EXCLUDED."allowLastSubmissionPrefill",
          "updatedAt" = now()
    `,
    policyId,
    allow
  )
}

async function setObjectGroupPolicyPrefillConfig(groupPolicyId: string, allow: boolean) {
  await ensureObjectPolicyPrefillConfigTables()
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO "ObjectGroupPolicyPrefillConfig" ("groupPolicyId","allowLastSubmissionPrefill","createdAt","updatedAt")
      VALUES ($1,$2,now(),now())
      ON CONFLICT ("groupPolicyId") DO UPDATE
      SET "allowLastSubmissionPrefill" = EXCLUDED."allowLastSubmissionPrefill",
          "updatedAt" = now()
    `,
    groupPolicyId,
    allow
  )
}

async function getObjectPolicyPrefillConfigMap(policyIds: string[]) {
  await ensureObjectPolicyPrefillConfigTables()
  const uniqueIds = Array.from(new Set(policyIds.filter(Boolean)))
  if (uniqueIds.length === 0) return new Map<string, boolean>()
  const rows = (await prisma.$queryRawUnsafe(
    `
      SELECT "policyId", "allowLastSubmissionPrefill"
      FROM "ObjectSurveyPolicyPrefillConfig"
      WHERE "policyId" = ANY($1::text[])
    `,
    uniqueIds
  )) as Array<{ policyId: string; allowLastSubmissionPrefill: boolean }>
  return new Map(rows.map((r) => [r.policyId, Boolean(r.allowLastSubmissionPrefill)]))
}

async function getObjectGroupPolicyPrefillConfigMap(groupPolicyIds: string[]) {
  await ensureObjectPolicyPrefillConfigTables()
  const uniqueIds = Array.from(new Set(groupPolicyIds.filter(Boolean)))
  if (uniqueIds.length === 0) return new Map<string, boolean>()
  const rows = (await prisma.$queryRawUnsafe(
    `
      SELECT "groupPolicyId", "allowLastSubmissionPrefill"
      FROM "ObjectGroupPolicyPrefillConfig"
      WHERE "groupPolicyId" = ANY($1::text[])
    `,
    uniqueIds
  )) as Array<{ groupPolicyId: string; allowLastSubmissionPrefill: boolean }>
  return new Map(rows.map((r) => [r.groupPolicyId, Boolean(r.allowLastSubmissionPrefill)]))
}

function sanitizePrefillAnswers(
  sections: unknown,
  rawAnswers: unknown
): Record<string, string | string[] | boolean> {
  if (!rawAnswers || typeof rawAnswers !== 'object' || Array.isArray(rawAnswers)) return {}
  const questionsById = new Map<string, any>()
  if (Array.isArray(sections)) {
    for (const section of sections as any[]) {
      if (!Array.isArray(section?.questions)) continue
      for (const question of section.questions as any[]) {
        if (typeof question?.id === 'string' && question.id.trim()) {
          questionsById.set(question.id.trim(), question)
        }
      }
    }
  }
  const allowedQuestionIds = new Set(questionsById.keys())
  const out: Record<string, string | string[] | boolean> = {}
  const isCustomOption = (v: string) => v.startsWith('__custom__:')
  const parseJsonObject = (value: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(value)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch {
      return null
    }
    return null
  }

  const isValidForQuestion = (question: any, value: unknown, key: string) => {
    if (key.endsWith('__reason')) return typeof value === 'string'
    if (key.endsWith('__customOptions')) return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    if (key.endsWith('__objectMeta')) {
      if (typeof value === 'string') {
        const parsed = parseJsonObject(value)
        return parsed !== null
      }
      return value !== null && typeof value === 'object' && !Array.isArray(value)
    }

    switch (question?.type) {
      case 'info':
        return false
      case 'text':
      case 'multiline':
      case 'date_time':
        return typeof value === 'string'
      case 'boolean':
        return typeof value === 'boolean'
      case 'single': {
        if (typeof value !== 'string') return false
        const optionValues = Array.isArray(question?.options)
          ? new Set((question.options as any[]).map((o) => String(o?.value ?? '')))
          : new Set<string>()
        return optionValues.has(value) || isCustomOption(value)
      }
      case 'multi': {
        if (!Array.isArray(value)) return false
        const optionValues = Array.isArray(question?.options)
          ? new Set((question.options as any[]).map((o) => String(o?.value ?? '')))
          : new Set<string>()
        return value.every((entry) => {
          if (typeof entry !== 'string') return false
          return optionValues.has(entry) || isCustomOption(entry)
        })
      }
      case 'percentage': {
        if (typeof value === 'number') return value >= 0 && value <= 100
        if (typeof value !== 'string') return false
        if (!value.trim()) return false
        const n = Number(value)
        return Number.isFinite(n) && n >= 0 && n <= 100
      }
      case 'likert': {
        const steps = Number(question?.likertSteps) > 0 ? Number(question.likertSteps) : 5
        if (typeof value === 'number') return value >= 1 && value <= steps
        if (typeof value !== 'string') return false
        const n = Number(value)
        return Number.isFinite(n) && n >= 1 && n <= steps
      }
      case 'ranking':
        return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
      case 'object_picker':
        return (
          typeof value === 'string' ||
          (Array.isArray(value) && value.every((entry) => typeof entry === 'string'))
        )
      case 'assignment_picker': {
        if (typeof value !== 'string') return false
        const parsed = parseJsonObject(value)
        if (!parsed) return false
        const optionMap = new Map<string, any>()
        if (Array.isArray(question?.assignmentOptions)) {
          for (const opt of question.assignmentOptions as any[]) {
            const optId = typeof opt?.id === 'string' ? opt.id.trim() : ''
            if (optId) optionMap.set(optId, opt)
          }
        }
        for (const [optionId, entry] of Object.entries(parsed)) {
          const opt = optionMap.get(optionId)
          if (!opt) return false
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
          const valuesRaw = (entry as { values?: unknown }).values
          if (!Array.isArray(valuesRaw)) return false
          if (!valuesRaw.every((v) => typeof v === 'string' && v.trim().length > 0)) return false
        }
        return true
      }
      default:
        return typeof value === 'string' || typeof value === 'boolean' || Array.isArray(value)
    }
  }

  for (const [key, value] of Object.entries(rawAnswers as Record<string, unknown>)) {
    const baseQuestionId = key.replace(/__(reason|objectMeta|customOptions)$/, '')
    if (!allowedQuestionIds.has(baseQuestionId)) continue
    const question = questionsById.get(baseQuestionId)
    if (!isValidForQuestion(question, value, key)) continue

    if (typeof value === 'boolean') {
      out[key] = value
      continue
    }
    if (typeof value === 'string') {
      out[key] = value
      continue
    }
    if (Array.isArray(value)) {
      const normalized = value
        .map((entry) => (entry === null || entry === undefined ? '' : String(entry)))
        .filter((entry) => entry.trim().length > 0)
      out[key] = normalized
      continue
    }
  }
  return out
}

function parsePrefillArrayCell(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => String(entry ?? '').trim()).filter(Boolean)
      }
    } catch {
      // fallback below
    }
  }
  return trimmed
    .split('|')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function parsePrefillAnswerForQuestion(question: any, raw: string): string | string[] | boolean | undefined {
  const value = String(raw ?? '').trim()
  if (!value) return undefined
  if (question?.type === 'info') return undefined
  if (question?.type === 'boolean') {
    const normalized = value.toLowerCase()
    if (['true', '1', 'ja', 'yes'].includes(normalized)) return true
    if (['false', '0', 'nein', 'no'].includes(normalized)) return false
    return undefined
  }
  if (
    question?.type === 'multi' ||
    question?.type === 'ranking' ||
    (question?.type === 'object_picker' && question?.objectPickerAllowMultiple)
  ) {
    return parsePrefillArrayCell(value)
  }
  return value
}

function validateAssignmentPickerRequiredOptions(
  sections: unknown,
  rawAnswers: unknown
): { ok: true } | { ok: false; error: string } {
  if (!rawAnswers || typeof rawAnswers !== 'object' || Array.isArray(rawAnswers)) return { ok: true }
  const answers = rawAnswers as Record<string, unknown>
  if (!Array.isArray(sections)) return { ok: true }
  for (const section of sections as any[]) {
    if (!Array.isArray(section?.questions)) continue
    for (const question of section.questions as any[]) {
      if (question?.type !== 'assignment_picker') continue
      const questionId = typeof question?.id === 'string' ? question.id.trim() : ''
      if (!questionId) continue
      const raw = answers[questionId]
      let parsed: Record<string, unknown> = {}
      if (typeof raw === 'string' && raw.trim()) {
        try {
          const obj = JSON.parse(raw)
          if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
            parsed = obj as Record<string, unknown>
          }
        } catch {
          return { ok: false, error: `ASSIGNMENT_PICKER_INVALID:${questionId}` }
        }
      }
      const options = Array.isArray(question?.assignmentOptions) ? question.assignmentOptions : []
      for (const option of options as any[]) {
        const optionId = typeof option?.id === 'string' ? option.id.trim() : ''
        if (!optionId) continue
        const optionRequired = Boolean(option?.required)
        const allowMultiple = Boolean(option?.allowMultiple)
        const entry = parsed[optionId]
        const values = Array.isArray((entry as { values?: unknown } | undefined)?.values)
          ? (((entry as { values?: unknown }).values as unknown[]).map((v) => String(v ?? '').trim()).filter(Boolean))
          : []
        if (optionRequired && values.length === 0) {
          return { ok: false, error: `ASSIGNMENT_PICKER_REQUIRED:${questionId}:${optionId}` }
        }
        if (!allowMultiple && values.length > 1) {
          return { ok: false, error: `ASSIGNMENT_PICKER_SINGLE_ONLY:${questionId}:${optionId}` }
        }
      }
    }
  }
  return { ok: true }
}

function normalizeHomePageConfig(row: Partial<HomePageConfig> | null | undefined): HomePageConfig {
  if (!row) return { ...DEFAULT_HOME_PAGE_CONFIG }
  const normalizeBackgroundColor = (value: unknown, fallback: string) => {
    const raw = typeof value === 'string' ? value.trim() : ''
    return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw) ? raw.toLowerCase() : fallback
  }
  const openTasksGrouping =
    row.openTasksGrouping === 'object' || row.openTasksGrouping === 'object_group'
      ? row.openTasksGrouping
      : DEFAULT_HOME_PAGE_CONFIG.openTasksGrouping
  const defaultRouteAfterLogin =
    typeof row.defaultRouteAfterLogin === 'string' && row.defaultRouteAfterLogin.trim()
      ? row.defaultRouteAfterLogin.trim()
      : DEFAULT_HOME_PAGE_CONFIG.defaultRouteAfterLogin
  return {
    title: typeof row.title === 'string' && row.title.trim() ? row.title : DEFAULT_HOME_PAGE_CONFIG.title,
    subtitle:
      typeof row.subtitle === 'string' && row.subtitle.trim() ? row.subtitle : DEFAULT_HOME_PAGE_CONFIG.subtitle,
    descriptionHtml: typeof row.descriptionHtml === 'string' ? row.descriptionHtml : '',
    faviconDataUrl:
      typeof row.faviconDataUrl === 'string' && row.faviconDataUrl.trim()
        ? row.faviconDataUrl.trim()
        : DEFAULT_HOME_PAGE_CONFIG.faviconDataUrl,
    welcomeContentHtml:
      typeof row.welcomeContentHtml === 'string'
        ? row.welcomeContentHtml
        : DEFAULT_HOME_PAGE_CONFIG.welcomeContentHtml,
    headingOpenTasks:
      typeof row.headingOpenTasks === 'string' && row.headingOpenTasks.trim()
        ? row.headingOpenTasks
        : DEFAULT_HOME_PAGE_CONFIG.headingOpenTasks,
    headingGlobalCatalogs:
      typeof row.headingGlobalCatalogs === 'string' && row.headingGlobalCatalogs.trim()
        ? row.headingGlobalCatalogs
        : DEFAULT_HOME_PAGE_CONFIG.headingGlobalCatalogs,
    headingClosedTasks:
      typeof row.headingClosedTasks === 'string' && row.headingClosedTasks.trim()
        ? row.headingClosedTasks
        : DEFAULT_HOME_PAGE_CONFIG.headingClosedTasks,
    tileOpenTitle:
      typeof row.tileOpenTitle === 'string' && row.tileOpenTitle.trim()
        ? row.tileOpenTitle
        : DEFAULT_HOME_PAGE_CONFIG.tileOpenTitle,
    tileOpenDescription:
      typeof row.tileOpenDescription === 'string' && row.tileOpenDescription.trim()
        ? row.tileOpenDescription
        : DEFAULT_HOME_PAGE_CONFIG.tileOpenDescription,
    tileOpenBackgroundColor:
      normalizeBackgroundColor(row.tileOpenBackgroundColor, DEFAULT_HOME_PAGE_CONFIG.tileOpenBackgroundColor),
    tileOpenBackgroundColorDark:
      normalizeBackgroundColor(row.tileOpenBackgroundColorDark, DEFAULT_HOME_PAGE_CONFIG.tileOpenBackgroundColorDark),
    tileGlobalTitle:
      typeof row.tileGlobalTitle === 'string' && row.tileGlobalTitle.trim()
        ? row.tileGlobalTitle
        : DEFAULT_HOME_PAGE_CONFIG.tileGlobalTitle,
    tileGlobalDescription:
      typeof row.tileGlobalDescription === 'string' && row.tileGlobalDescription.trim()
        ? row.tileGlobalDescription
        : DEFAULT_HOME_PAGE_CONFIG.tileGlobalDescription,
    tileGlobalBackgroundColor:
      normalizeBackgroundColor(row.tileGlobalBackgroundColor, DEFAULT_HOME_PAGE_CONFIG.tileGlobalBackgroundColor),
    tileGlobalBackgroundColorDark:
      normalizeBackgroundColor(row.tileGlobalBackgroundColorDark, DEFAULT_HOME_PAGE_CONFIG.tileGlobalBackgroundColorDark),
    tileHistoryTitle:
      typeof row.tileHistoryTitle === 'string' && row.tileHistoryTitle.trim()
        ? row.tileHistoryTitle
        : DEFAULT_HOME_PAGE_CONFIG.tileHistoryTitle,
    tileHistoryDescription:
      typeof row.tileHistoryDescription === 'string' && row.tileHistoryDescription.trim()
        ? row.tileHistoryDescription
        : DEFAULT_HOME_PAGE_CONFIG.tileHistoryDescription,
    tileHistoryBackgroundColor:
      normalizeBackgroundColor(row.tileHistoryBackgroundColor, DEFAULT_HOME_PAGE_CONFIG.tileHistoryBackgroundColor),
    tileHistoryBackgroundColorDark:
      normalizeBackgroundColor(
        row.tileHistoryBackgroundColorDark,
        DEFAULT_HOME_PAGE_CONFIG.tileHistoryBackgroundColorDark
      ),
    showOpenTasks: row.showOpenTasks ?? DEFAULT_HOME_PAGE_CONFIG.showOpenTasks,
    showGlobalCatalogs: row.showGlobalCatalogs ?? DEFAULT_HOME_PAGE_CONFIG.showGlobalCatalogs,
    showClosedTasks: row.showClosedTasks ?? DEFAULT_HOME_PAGE_CONFIG.showClosedTasks,
    openTasksGrouping,
    defaultRouteAfterLogin,
  }
}

function normalizeLoginPageConfig(row: Partial<LoginPageConfig> | null | undefined): LoginPageConfig {
  if (!row) return { ...DEFAULT_LOGIN_PAGE_CONFIG }
  const logoWidthRaw = Number(row.logoWidthPx)
  const logoWidthPx = Number.isFinite(logoWidthRaw)
    ? Math.max(40, Math.min(800, Math.round(logoWidthRaw)))
    : DEFAULT_LOGIN_PAGE_CONFIG.logoWidthPx
  const logoPlacement =
    row.logoPlacement === 'left' ||
    row.logoPlacement === 'right' ||
    row.logoPlacement === 'center' ||
    row.logoPlacement === 'header' ||
    row.logoPlacement === 'top'
      ? row.logoPlacement
      : DEFAULT_LOGIN_PAGE_CONFIG.logoPlacement
  return {
    title: typeof row.title === 'string' && row.title.trim() ? row.title : DEFAULT_LOGIN_PAGE_CONFIG.title,
    subtitle:
      typeof row.subtitle === 'string' && row.subtitle.trim()
        ? row.subtitle
        : DEFAULT_LOGIN_PAGE_CONFIG.subtitle,
    hintText: typeof row.hintText === 'string' ? row.hintText : '',
    usernameLabel:
      typeof row.usernameLabel === 'string' && row.usernameLabel.trim()
        ? row.usernameLabel
        : DEFAULT_LOGIN_PAGE_CONFIG.usernameLabel,
    usernamePlaceholder:
      typeof row.usernamePlaceholder === 'string' && row.usernamePlaceholder.trim()
        ? row.usernamePlaceholder
        : DEFAULT_LOGIN_PAGE_CONFIG.usernamePlaceholder,
    passwordLabel:
      typeof row.passwordLabel === 'string' && row.passwordLabel.trim()
        ? row.passwordLabel
        : DEFAULT_LOGIN_PAGE_CONFIG.passwordLabel,
    passwordPlaceholder:
      typeof row.passwordPlaceholder === 'string' && row.passwordPlaceholder.trim()
        ? row.passwordPlaceholder
        : DEFAULT_LOGIN_PAGE_CONFIG.passwordPlaceholder,
    submitButtonLabel:
      typeof row.submitButtonLabel === 'string' && row.submitButtonLabel.trim()
        ? row.submitButtonLabel
        : DEFAULT_LOGIN_PAGE_CONFIG.submitButtonLabel,
    logoDataUrl: typeof row.logoDataUrl === 'string' ? row.logoDataUrl : '',
    logoWidthPx,
    logoPlacement,
  }
}

async function getHomePageConfig(): Promise<HomePageConfig> {
  await ensureHomePageConfigTable()
  const rows = (await prisma.$queryRawUnsafe(
    `
      SELECT
        "title",
        "subtitle",
        "descriptionHtml",
        "faviconDataUrl",
        "welcomeContentHtml",
        "headingOpenTasks",
        "headingGlobalCatalogs",
        "headingClosedTasks",
        "tileOpenTitle",
        "tileOpenDescription",
        "tileOpenBackgroundColor",
        "tileOpenBackgroundColorDark",
        "tileGlobalTitle",
        "tileGlobalDescription",
        "tileGlobalBackgroundColor",
        "tileGlobalBackgroundColorDark",
        "tileHistoryTitle",
        "tileHistoryDescription",
        "tileHistoryBackgroundColor",
        "tileHistoryBackgroundColorDark",
        "showOpenTasks",
        "showGlobalCatalogs",
        "showClosedTasks",
        "openTasksGrouping",
        "defaultRouteAfterLogin"
      FROM "HomePageConfig"
      WHERE "id" = 'global'
      LIMIT 1
    `
  )) as Array<Partial<HomePageConfig>>
  if (rows.length === 0) return { ...DEFAULT_HOME_PAGE_CONFIG }
  return normalizeHomePageConfig(rows[0])
}

async function getLoginPageConfig(): Promise<LoginPageConfig> {
  await ensureLoginPageConfigTable()
  const rows = (await prisma.$queryRawUnsafe(
    `
      SELECT
        "title",
        "subtitle",
        "hintText",
        "usernameLabel",
        "usernamePlaceholder",
        "passwordLabel",
        "passwordPlaceholder",
        "submitButtonLabel",
        "logoDataUrl",
        "logoWidthPx",
        "logoPlacement"
      FROM "LoginPageConfig"
      WHERE "id" = 'global'
      LIMIT 1
    `
  )) as Array<Partial<LoginPageConfig>>
  if (rows.length === 0) return { ...DEFAULT_LOGIN_PAGE_CONFIG }
  return normalizeLoginPageConfig(rows[0])
}

async function saveHomePageConfig(input: Partial<HomePageConfig>): Promise<HomePageConfig> {
  await ensureHomePageConfigTable()
  const normalized = normalizeHomePageConfig({
    ...DEFAULT_HOME_PAGE_CONFIG,
    ...input,
  })
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO "HomePageConfig" (
        "id",
        "title",
        "subtitle",
        "descriptionHtml",
        "faviconDataUrl",
        "welcomeContentHtml",
        "headingOpenTasks",
        "headingGlobalCatalogs",
        "headingClosedTasks",
        "tileOpenTitle",
        "tileOpenDescription",
        "tileOpenBackgroundColor",
        "tileOpenBackgroundColorDark",
        "tileGlobalTitle",
        "tileGlobalDescription",
        "tileGlobalBackgroundColor",
        "tileGlobalBackgroundColorDark",
        "tileHistoryTitle",
        "tileHistoryDescription",
        "tileHistoryBackgroundColor",
        "tileHistoryBackgroundColorDark",
        "showOpenTasks",
        "showGlobalCatalogs",
        "showClosedTasks",
        "openTasksGrouping",
        "defaultRouteAfterLogin",
        "updatedAt"
      ) VALUES (
        'global', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, now()
      )
      ON CONFLICT ("id")
      DO UPDATE SET
        "title" = EXCLUDED."title",
        "subtitle" = EXCLUDED."subtitle",
        "descriptionHtml" = EXCLUDED."descriptionHtml",
        "faviconDataUrl" = EXCLUDED."faviconDataUrl",
        "welcomeContentHtml" = EXCLUDED."welcomeContentHtml",
        "headingOpenTasks" = EXCLUDED."headingOpenTasks",
        "headingGlobalCatalogs" = EXCLUDED."headingGlobalCatalogs",
        "headingClosedTasks" = EXCLUDED."headingClosedTasks",
        "tileOpenTitle" = EXCLUDED."tileOpenTitle",
        "tileOpenDescription" = EXCLUDED."tileOpenDescription",
        "tileOpenBackgroundColor" = EXCLUDED."tileOpenBackgroundColor",
        "tileOpenBackgroundColorDark" = EXCLUDED."tileOpenBackgroundColorDark",
        "tileGlobalTitle" = EXCLUDED."tileGlobalTitle",
        "tileGlobalDescription" = EXCLUDED."tileGlobalDescription",
        "tileGlobalBackgroundColor" = EXCLUDED."tileGlobalBackgroundColor",
        "tileGlobalBackgroundColorDark" = EXCLUDED."tileGlobalBackgroundColorDark",
        "tileHistoryTitle" = EXCLUDED."tileHistoryTitle",
        "tileHistoryDescription" = EXCLUDED."tileHistoryDescription",
        "tileHistoryBackgroundColor" = EXCLUDED."tileHistoryBackgroundColor",
        "tileHistoryBackgroundColorDark" = EXCLUDED."tileHistoryBackgroundColorDark",
        "showOpenTasks" = EXCLUDED."showOpenTasks",
        "showGlobalCatalogs" = EXCLUDED."showGlobalCatalogs",
        "showClosedTasks" = EXCLUDED."showClosedTasks",
        "openTasksGrouping" = EXCLUDED."openTasksGrouping",
        "defaultRouteAfterLogin" = EXCLUDED."defaultRouteAfterLogin",
        "updatedAt" = now()
    `,
    normalized.title,
    normalized.subtitle,
    normalized.descriptionHtml,
    normalized.faviconDataUrl,
    normalized.welcomeContentHtml,
    normalized.headingOpenTasks,
    normalized.headingGlobalCatalogs,
    normalized.headingClosedTasks,
    normalized.tileOpenTitle,
    normalized.tileOpenDescription,
    normalized.tileOpenBackgroundColor,
    normalized.tileOpenBackgroundColorDark,
    normalized.tileGlobalTitle,
    normalized.tileGlobalDescription,
    normalized.tileGlobalBackgroundColor,
    normalized.tileGlobalBackgroundColorDark,
    normalized.tileHistoryTitle,
    normalized.tileHistoryDescription,
    normalized.tileHistoryBackgroundColor,
    normalized.tileHistoryBackgroundColorDark,
    normalized.showOpenTasks,
    normalized.showGlobalCatalogs,
    normalized.showClosedTasks,
    normalized.openTasksGrouping,
    normalized.defaultRouteAfterLogin
  )
  return normalized
}

async function saveLoginPageConfig(input: Partial<LoginPageConfig>): Promise<LoginPageConfig> {
  await ensureLoginPageConfigTable()
  const normalized = normalizeLoginPageConfig({
    ...DEFAULT_LOGIN_PAGE_CONFIG,
    ...input,
  })
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO "LoginPageConfig" (
        "id",
        "title",
        "subtitle",
        "hintText",
        "usernameLabel",
        "usernamePlaceholder",
        "passwordLabel",
        "passwordPlaceholder",
        "submitButtonLabel",
        "logoDataUrl",
        "logoWidthPx",
        "logoPlacement",
        "updatedAt"
      ) VALUES (
        'global', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now()
      )
      ON CONFLICT ("id")
      DO UPDATE SET
        "title" = EXCLUDED."title",
        "subtitle" = EXCLUDED."subtitle",
        "hintText" = EXCLUDED."hintText",
        "usernameLabel" = EXCLUDED."usernameLabel",
        "usernamePlaceholder" = EXCLUDED."usernamePlaceholder",
        "passwordLabel" = EXCLUDED."passwordLabel",
        "passwordPlaceholder" = EXCLUDED."passwordPlaceholder",
        "submitButtonLabel" = EXCLUDED."submitButtonLabel",
        "logoDataUrl" = EXCLUDED."logoDataUrl",
        "logoWidthPx" = EXCLUDED."logoWidthPx",
        "logoPlacement" = EXCLUDED."logoPlacement",
        "updatedAt" = now()
    `,
    normalized.title,
    normalized.subtitle,
    normalized.hintText,
    normalized.usernameLabel,
    normalized.usernamePlaceholder,
    normalized.passwordLabel,
    normalized.passwordPlaceholder,
    normalized.submitButtonLabel,
    normalized.logoDataUrl,
    normalized.logoWidthPx,
    normalized.logoPlacement
  )
  return normalized
}

type ExternalObjectImportDefinitionRow = {
  id: string
  name: string
  description: string | null
  importMode: string
  sqlQuery: string
  sqlHost: string
  sqlPort: number
  sqlDatabase: string
  sqlUsername: string
  sqlPassword: string
  sqlEncrypt: boolean
  sqlTrustServerCertificate: boolean
  mapObjectIdColumn: string
  mapTypeColumn: string
  mapNameColumn: string
  mapDescriptionColumn: string
  mapMetadataColumn: string
  mapUserIdColumn: string
  mapUserEmailColumn: string
  mapUserDisplayNameColumn: string
  mapRoleNameColumn: string
  scheduleEveryMinutes: number | null
  enabled: boolean
  deleteMissing: boolean
  createdByUserId: string | null
  importedByUserId: string | null
  adminGroupIds: unknown
  lastRunAt: Date | null
  lastRunStatus: string | null
  lastRunMessage: string | null
  lastRunSummary: unknown
  createdAt: Date
  updatedAt: Date
}

type ExternalObjectImportRunRow = {
  id: string
  definitionId: string
  startedAt: Date
  finishedAt: Date | null
  status: string
  dryRun: boolean
  sourceRows: number | null
  importedRows: number | null
  createdCount: number | null
  updatedCount: number | null
  deletedCount: number | null
  skippedCount: number | null
  warningCount: number | null
  message: string | null
  warnings: unknown
  summary: unknown
}

function normalizeSqlRows(raw: unknown) {
  return Array.isArray(raw) ? raw : []
}

function pickStringColumn(row: Record<string, unknown>, aliases: string[]): string {
  for (const alias of aliases) {
    const key = Object.keys(row).find((k) => k.toLowerCase() === alias.toLowerCase())
    if (!key) continue
    const value = row[key]
    if (value === undefined || value === null) continue
    const text = String(value).trim()
    if (text) return text
  }
  return ''
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && code === 'P2002'
}

type ExternalImportMode = 'OBJECTS' | 'PEOPLE_ROLES_OBJECT' | 'USERS_LDAP'

function normalizeExternalImportMode(value: unknown): ExternalImportMode {
  const mode = String(value || 'OBJECTS').toUpperCase()
  if (mode === 'PEOPLE_ROLES_OBJECT' || mode === 'USERS_LDAP') return mode
  return 'OBJECTS'
}

function normalizeImportedObjectRows(
  recordset: unknown[],
  mapping: {
    objectIdColumn?: string | null
    typeColumn?: string | null
    nameColumn?: string | null
    descriptionColumn?: string | null
    metadataColumn?: string | null
  }
) {
  const rows: Array<{
    externalId: string
    type: string | null
    name: string
    description: string | null
    metadata: Record<string, unknown> | null
  }> = []
  const warnings: string[] = []
  const seen = new Set<string>()
  const firstSeenRowByExternalId = new Map<string, number>()

  const objectIdAliases = [
    mapping.objectIdColumn || '',
    'object_id',
    'objectid',
    'id',
    'external_id',
    'externalid',
  ].filter(Boolean)
  const typeAliases = [mapping.typeColumn || '', 'type', 'object_type', 'objecttype'].filter(Boolean)
  const nameAliases = [mapping.nameColumn || '', 'name', 'object_name', 'objectname'].filter(Boolean)
  const descriptionAliases = [
    mapping.descriptionColumn || '',
    'description',
    'object_description',
    'objectdescription',
  ].filter(Boolean)
  const metadataAliases = [mapping.metadataColumn || '', 'metadata', 'meta_json', 'meta', 'json_metadata'].filter(Boolean)

  for (let index = 0; index < recordset.length; index += 1) {
    const raw = recordset[index]
    if (!raw || typeof raw !== 'object') {
      warnings.push(`Zeile ${index + 1}: ungueltiges Ergebnisformat.`)
      continue
    }
    const row = raw as Record<string, unknown>
    const externalId = pickStringColumn(row, objectIdAliases)
    const name = pickStringColumn(row, nameAliases)
    const typeRaw = pickStringColumn(row, typeAliases)
    const descriptionRaw = pickStringColumn(row, descriptionAliases)
    const metadataKey = Object.keys(row).find((k) =>
      metadataAliases.some((alias) => alias.toLowerCase() === k.toLowerCase())
    )
    const metadataRaw = metadataKey ? row[metadataKey] : undefined
    let metadata: Record<string, unknown> | null = null
    if (metadataRaw !== undefined && metadataRaw !== null && String(metadataRaw).trim() !== '') {
      if (typeof metadataRaw === 'object' && !Array.isArray(metadataRaw)) {
        metadata = metadataRaw as Record<string, unknown>
      } else if (typeof metadataRaw === 'string') {
        try {
          const parsed = JSON.parse(metadataRaw)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            metadata = parsed as Record<string, unknown>
          } else {
            warnings.push(`Zeile ${index + 1}: Metadata ist kein JSON-Objekt und wurde ignoriert.`)
          }
        } catch {
          warnings.push(`Zeile ${index + 1}: Metadata konnte nicht als JSON gelesen werden und wurde ignoriert.`)
        }
      } else {
        warnings.push(`Zeile ${index + 1}: Metadata muss JSON/Text sein und wurde ignoriert.`)
      }
    }
    const type = typeRaw || null
    const description = descriptionRaw || null

    if (!externalId) {
      warnings.push(`Zeile ${index + 1}: object_id/id ist erforderlich.`)
      continue
    }

    const key = externalId
    if (seen.has(key)) {
      const firstRow = firstSeenRowByExternalId.get(key)
      warnings.push(
        `Zeile ${index + 1}: Doppelte object_id/external_id "${externalId}" (bereits in Zeile ${firstRow ?? '?'} vorhanden).`
      )
      continue
    }
    seen.add(key)
    firstSeenRowByExternalId.set(key, index + 1)

    rows.push({ externalId, type, name: name || externalId, description, metadata })
  }

  return { rows, warnings }
}

function normalizeImportedPersonRoleRows(
  recordset: unknown[],
  mapping: {
    objectIdColumn?: string | null
    userIdColumn?: string | null
    userEmailColumn?: string | null
    userDisplayNameColumn?: string | null
    roleNameColumn?: string | null
  }
) {
  const rows: Array<{
    objectExternalId: string
    userExternalId: string
    userEmail: string | null
    userDisplayName: string | null
    roleName: string
  }> = []
  const warnings: string[] = []
  const seen = new Set<string>()

  const objectIdAliases = [mapping.objectIdColumn || '', 'object_id', 'objectid', 'external_id', 'id'].filter(Boolean)
  const userIdAliases = [mapping.userIdColumn || '', 'user_id', 'userid', 'uid', 'username', 'external_id'].filter(Boolean)
  const userEmailAliases = [mapping.userEmailColumn || '', 'email', 'user_email', 'mail'].filter(Boolean)
  const userDisplayNameAliases = [mapping.userDisplayNameColumn || '', 'display_name', 'name', 'full_name'].filter(Boolean)
  const roleAliases = [mapping.roleNameColumn || '', 'role_name', 'role', 'rollenname'].filter(Boolean)

  for (let index = 0; index < recordset.length; index += 1) {
    const raw = recordset[index]
    if (!raw || typeof raw !== 'object') {
      warnings.push(`Zeile ${index + 1}: ungueltiges Ergebnisformat.`)
      continue
    }
    const row = raw as Record<string, unknown>
    const objectExternalId = pickStringColumn(row, objectIdAliases)
    const userExternalId = pickStringColumn(row, userIdAliases)
    const userEmailRaw = pickStringColumn(row, userEmailAliases)
    const userDisplayNameRaw = pickStringColumn(row, userDisplayNameAliases)
    const roleName = pickStringColumn(row, roleAliases)

    if (!objectExternalId) {
      warnings.push(`Zeile ${index + 1}: Objekt-ID fehlt.`)
      continue
    }
    if (!userExternalId) {
      warnings.push(`Zeile ${index + 1}: User-ID fehlt.`)
      continue
    }
    if (!roleName) {
      warnings.push(`Zeile ${index + 1}: Rollenname fehlt.`)
      continue
    }

    const key = `${objectExternalId}::${userExternalId}::${roleName.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)

    rows.push({
      objectExternalId,
      userExternalId,
      userEmail: userEmailRaw || null,
      userDisplayName: userDisplayNameRaw || null,
      roleName,
    })
  }

  return { rows, warnings }
}

function normalizeImportedLdapUserRows(
  recordset: unknown[],
  mapping: {
    userIdColumn?: string | null
    userEmailColumn?: string | null
    userDisplayNameColumn?: string | null
  }
) {
  const rows: Array<{
    userExternalId: string
    userEmail: string | null
    userDisplayName: string | null
  }> = []
  const warnings: string[] = []
  const seen = new Set<string>()

  const userIdAliases = [mapping.userIdColumn || '', 'user_id', 'userid', 'uid', 'username', 'external_id'].filter(Boolean)
  const userEmailAliases = [mapping.userEmailColumn || '', 'email', 'user_email', 'mail'].filter(Boolean)
  const userDisplayNameAliases = [mapping.userDisplayNameColumn || '', 'display_name', 'name', 'full_name'].filter(Boolean)

  for (let index = 0; index < recordset.length; index += 1) {
    const raw = recordset[index]
    if (!raw || typeof raw !== 'object') {
      warnings.push(`Zeile ${index + 1}: ungueltiges Ergebnisformat.`)
      continue
    }
    const row = raw as Record<string, unknown>
    const userExternalId = pickStringColumn(row, userIdAliases).toUpperCase()
    const userEmailRaw = pickStringColumn(row, userEmailAliases).toLowerCase()
    const userDisplayNameRaw = pickStringColumn(row, userDisplayNameAliases)

    if (!userExternalId) {
      warnings.push(`Zeile ${index + 1}: User-ID fehlt (LDAP Login-ID).`)
      continue
    }
    if (seen.has(userExternalId)) continue
    seen.add(userExternalId)

    rows.push({
      userExternalId,
      userEmail: userEmailRaw || null,
      userDisplayName: userDisplayNameRaw || null,
    })
  }

  return { rows, warnings }
}

async function ensureExternalObjectImportTables() {
  // Backward compatibility:
  // Early migration created a UNIQUE INDEX on ObjectEntity.name.
  // Newer model allows duplicate names, therefore we must drop the legacy index.
  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "ObjectEntity_name_key"`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "ObjectEntity" DROP CONSTRAINT IF EXISTS "ObjectEntity_name_key"`)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ExternalObjectImportDefinition" (
      "id" TEXT PRIMARY KEY,
      "name" TEXT NOT NULL,
      "description" TEXT,
      "importMode" TEXT NOT NULL DEFAULT 'OBJECTS',
      "sqlQuery" TEXT NOT NULL,
      "sqlHost" TEXT NOT NULL,
      "sqlPort" INTEGER NOT NULL DEFAULT 1433,
      "sqlDatabase" TEXT NOT NULL,
      "sqlUsername" TEXT NOT NULL,
      "sqlPassword" TEXT NOT NULL,
      "sqlEncrypt" BOOLEAN NOT NULL DEFAULT true,
      "sqlTrustServerCertificate" BOOLEAN NOT NULL DEFAULT false,
      "mapObjectIdColumn" TEXT NOT NULL DEFAULT 'object_id',
      "mapTypeColumn" TEXT NOT NULL DEFAULT 'type',
      "mapNameColumn" TEXT NOT NULL DEFAULT 'name',
      "mapDescriptionColumn" TEXT NOT NULL DEFAULT 'description',
      "mapMetadataColumn" TEXT NOT NULL DEFAULT 'meta_json',
      "mapUserIdColumn" TEXT NOT NULL DEFAULT 'user_id',
      "mapUserEmailColumn" TEXT NOT NULL DEFAULT 'email',
      "mapUserDisplayNameColumn" TEXT NOT NULL DEFAULT 'display_name',
      "mapRoleNameColumn" TEXT NOT NULL DEFAULT 'role_name',
      "scheduleEveryMinutes" INTEGER,
      "enabled" BOOLEAN NOT NULL DEFAULT true,
      "deleteMissing" BOOLEAN NOT NULL DEFAULT false,
      "createdByUserId" TEXT,
      "importedByUserId" TEXT,
      "adminGroupIds" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "lastRunAt" TIMESTAMPTZ,
      "lastRunStatus" TEXT,
      "lastRunMessage" TEXT,
      "lastRunSummary" JSONB,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ExternalObjectImportItem" (
      "id" TEXT PRIMARY KEY,
      "definitionId" TEXT NOT NULL,
      "objectId" TEXT,
      "assignmentId" TEXT,
      "externalId" TEXT NOT NULL,
      "objectType" TEXT NOT NULL DEFAULT '',
      "userExternalId" TEXT,
      "roleName" TEXT,
      "lastSeenAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE ("definitionId", "externalId", "objectType")
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ExternalObjectImportRun" (
      "id" TEXT PRIMARY KEY,
      "definitionId" TEXT NOT NULL,
      "startedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "finishedAt" TIMESTAMPTZ,
      "status" TEXT NOT NULL,
      "dryRun" BOOLEAN NOT NULL DEFAULT false,
      "sourceRows" INTEGER,
      "importedRows" INTEGER,
      "createdCount" INTEGER,
      "updatedCount" INTEGER,
      "deletedCount" INTEGER,
      "skippedCount" INTEGER,
      "warningCount" INTEGER,
      "message" TEXT,
      "warnings" JSONB,
      "summary" JSONB
    )
  `)
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "ExternalObjectImportDefinition" ADD COLUMN IF NOT EXISTS "importMode" TEXT NOT NULL DEFAULT 'OBJECTS'`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "ExternalObjectImportDefinition" ADD COLUMN IF NOT EXISTS "mapObjectIdColumn" TEXT NOT NULL DEFAULT 'object_id'`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "ExternalObjectImportDefinition" ADD COLUMN IF NOT EXISTS "mapTypeColumn" TEXT NOT NULL DEFAULT 'type'`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "ExternalObjectImportDefinition" ADD COLUMN IF NOT EXISTS "mapNameColumn" TEXT NOT NULL DEFAULT 'name'`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "ExternalObjectImportDefinition" ADD COLUMN IF NOT EXISTS "mapDescriptionColumn" TEXT NOT NULL DEFAULT 'description'`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "ExternalObjectImportDefinition" ADD COLUMN IF NOT EXISTS "mapMetadataColumn" TEXT NOT NULL DEFAULT 'meta_json'`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "ExternalObjectImportDefinition" ADD COLUMN IF NOT EXISTS "mapUserIdColumn" TEXT NOT NULL DEFAULT 'user_id'`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "ExternalObjectImportDefinition" ADD COLUMN IF NOT EXISTS "mapUserEmailColumn" TEXT NOT NULL DEFAULT 'email'`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "ExternalObjectImportDefinition" ADD COLUMN IF NOT EXISTS "mapUserDisplayNameColumn" TEXT NOT NULL DEFAULT 'display_name'`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "ExternalObjectImportDefinition" ADD COLUMN IF NOT EXISTS "mapRoleNameColumn" TEXT NOT NULL DEFAULT 'role_name'`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "ExternalObjectImportDefinition" ADD COLUMN IF NOT EXISTS "scheduleEveryMinutes" INTEGER`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "ExternalObjectImportItem" ADD COLUMN IF NOT EXISTS "assignmentId" TEXT`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "ExternalObjectImportItem" ADD COLUMN IF NOT EXISTS "userExternalId" TEXT`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "ExternalObjectImportItem" ADD COLUMN IF NOT EXISTS "roleName" TEXT`
  )
}

function toImportDefinitionView(row: ExternalObjectImportDefinitionRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    importMode: row.importMode || 'OBJECTS',
    sqlQuery: row.sqlQuery,
    sqlHost: row.sqlHost,
    sqlPort: row.sqlPort,
    sqlDatabase: row.sqlDatabase,
    sqlUsername: row.sqlUsername,
    sqlPasswordMasked: row.sqlPassword ? '********' : '',
    sqlEncrypt: row.sqlEncrypt,
    sqlTrustServerCertificate: row.sqlTrustServerCertificate,
    mapObjectIdColumn: row.mapObjectIdColumn || 'object_id',
    mapTypeColumn: row.mapTypeColumn || 'type',
    mapNameColumn: row.mapNameColumn || 'name',
    mapDescriptionColumn: row.mapDescriptionColumn || 'description',
    mapMetadataColumn: row.mapMetadataColumn || 'meta_json',
    mapUserIdColumn: row.mapUserIdColumn || 'user_id',
    mapUserEmailColumn: row.mapUserEmailColumn || 'email',
    mapUserDisplayNameColumn: row.mapUserDisplayNameColumn || 'display_name',
    mapRoleNameColumn: row.mapRoleNameColumn || 'role_name',
    scheduleEveryMinutes: row.scheduleEveryMinutes,
    enabled: row.enabled,
    deleteMissing: row.deleteMissing,
    createdByUserId: row.createdByUserId,
    importedByUserId: row.importedByUserId,
    adminGroupIds: parseStringArray(row.adminGroupIds),
    lastRunAt: row.lastRunAt,
    lastRunStatus: row.lastRunStatus,
    lastRunMessage: row.lastRunMessage,
    lastRunSummary: row.lastRunSummary,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function getUserGroupIds(userId: string): Promise<string[]> {
  const memberships = await prisma.groupMember.findMany({
    where: { userId },
    select: { groupId: true },
  })
  return memberships.map((m) => m.groupId)
}

function canManageQuestionnaireByScope(params: {
  userId: string
  userRole: Role
  userGroupIds: string[]
  questionnaire: {
    createdByUserId?: string | null
    adminAccessMode?: string | null
    adminGroupIds?: unknown
    assignedGroupIds?: string[]
    creatorGroupIds?: string[]
  }
}) {
  const { userId, userRole, userGroupIds, questionnaire } = params
  if (userRole === 'ADMIN') return true
  if (questionnaire.createdByUserId === userId) return true
  if (normalizeAdminAccessMode(questionnaire.adminAccessMode) === 'OWNER_ONLY') return false
  const configuredGroupIds = parseStringArray(questionnaire.adminGroupIds)
  const fallbackAssignedGroupIds = questionnaire.assignedGroupIds ?? []
  const fallbackCreatorGroupIds = questionnaire.creatorGroupIds ?? []
  const allowedGroupIds = new Set(
    configuredGroupIds.length > 0
      ? configuredGroupIds
      : fallbackAssignedGroupIds.length > 0
        ? fallbackAssignedGroupIds
        : fallbackCreatorGroupIds
  )
  if (allowedGroupIds.size === 0) return false
  return userGroupIds.some((groupId) => allowedGroupIds.has(groupId))
}

function canManageObjectByScope(params: {
  userId: string
  userRole: Role
  userGroupIds: string[]
  object: {
    createdByUserId?: string | null
    importedByUserId?: string | null
    adminGroupIds?: unknown
    creatorGroupIds?: string[]
  }
}) {
  const { userId, userRole, userGroupIds, object } = params
  if (userRole === 'ADMIN') return true
  if (object.createdByUserId === userId || object.importedByUserId === userId) return true
  const configured = parseStringArray(object.adminGroupIds)
  const fallbackCreatorGroups = object.creatorGroupIds ?? []
  const allowedGroupIds = new Set(configured.length > 0 ? configured : fallbackCreatorGroups)
  if (allowedGroupIds.size === 0) return false
  return userGroupIds.some((groupId) => allowedGroupIds.has(groupId))
}

async function canAccessObjectById(user: { id: string; role: Role }, objectId: string) {
  const object = await prisma.objectEntity.findUnique({
    where: { id: objectId },
    select: { id: true, createdByUserId: true, importedByUserId: true, adminGroupIds: true },
  })
  if (!object) return { ok: false as const, notFound: true as const }
  if (user.role === 'ADMIN') return { ok: true as const, object }
  const userGroupIds = await getUserGroupIds(user.id)
  const creatorGroupIds =
    object.createdByUserId
      ? (await prisma.groupMember.findMany({
          where: { userId: object.createdByUserId },
          select: { groupId: true },
        })).map((m) => m.groupId)
      : []
  const allowed = canManageObjectByScope({
    userId: user.id,
    userRole: user.role,
    userGroupIds,
    object: { ...object, creatorGroupIds },
  })
  return allowed ? { ok: true as const, object } : { ok: false as const, forbidden: true as const }
}

async function canAccessUserGroupById(user: { id: string; role: Role }, groupId: string) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { id: true, createdByUserId: true, importedByUserId: true },
  })
  if (!group) return { ok: false as const, notFound: true as const }
  if (user.role === 'ADMIN') return { ok: true as const, group }
  const userGroupIds = await getUserGroupIds(user.id)
  const allowed =
    userGroupIds.includes(group.id) ||
    group.createdByUserId === user.id ||
    group.importedByUserId === user.id
  return allowed ? { ok: true as const, group } : { ok: false as const, forbidden: true as const }
}

async function canAccessObjectGroupById(user: { id: string; role: Role }, objectGroupId: string) {
  const group = await prisma.objectGroup.findUnique({
    where: { id: objectGroupId },
    select: { id: true, createdByUserId: true, importedByUserId: true, adminGroupIds: true },
  })
  if (!group) return { ok: false as const, notFound: true as const }
  if (user.role === 'ADMIN') return { ok: true as const, group }
  const userGroupIds = await getUserGroupIds(user.id)
  const creatorGroupIds =
    group.createdByUserId
      ? (await prisma.groupMember.findMany({
          where: { userId: group.createdByUserId },
          select: { groupId: true },
        })).map((m) => m.groupId)
      : []
  const effectiveGroupIds = parseStringArray(group.adminGroupIds)
  const allowedGroupIds = new Set(effectiveGroupIds.length > 0 ? effectiveGroupIds : creatorGroupIds)
  const allowed =
    group.createdByUserId === user.id ||
    group.importedByUserId === user.id ||
    userGroupIds.some((gid) => allowedGroupIds.has(gid))
  return allowed ? { ok: true as const, group } : { ok: false as const, forbidden: true as const }
}

async function canAccessRoleById(user: { id: string; role: Role }, roleId: string) {
  const role = await prisma.roleDefinition.findUnique({
    where: { id: roleId },
    select: { id: true, createdByUserId: true, importedByUserId: true, adminGroupIds: true },
  })
  if (!role) return { ok: false as const, notFound: true as const }
  if (user.role === 'ADMIN') return { ok: true as const, role }
  const userGroupIds = await getUserGroupIds(user.id)
  const creatorGroupIds =
    role.createdByUserId
      ? (await prisma.groupMember.findMany({
          where: { userId: role.createdByUserId },
          select: { groupId: true },
        })).map((m) => m.groupId)
      : []
  const effective = parseStringArray(role.adminGroupIds)
  const allowedGroupIds = new Set(effective.length > 0 ? effective : creatorGroupIds)
  const allowed =
    role.createdByUserId === user.id ||
    role.importedByUserId === user.id ||
    userGroupIds.some((gid) => allowedGroupIds.has(gid))
  return allowed ? { ok: true as const, role } : { ok: false as const, forbidden: true as const }
}

function canSeeEntityByOwnerImportOrGroups(params: {
  userId: string
  userRole: Role
  userGroupIds: string[]
  entity: {
    createdByUserId?: string | null
    importedByUserId?: string | null
    adminGroupIds?: unknown
    creatorGroupIds?: string[]
  }
}) {
  const { userId, userRole, userGroupIds, entity } = params
  if (userRole === 'ADMIN') return true
  if (entity.createdByUserId === userId || entity.importedByUserId === userId) return true
  const configured = parseStringArray(entity.adminGroupIds)
  const fallbackCreatorGroups = entity.creatorGroupIds ?? []
  const groupIds = configured.length > 0 ? configured : fallbackCreatorGroups
  if (groupIds.length === 0) return false
  const allowed = new Set(groupIds)
  return userGroupIds.some((gid) => allowed.has(gid))
}

async function deleteObjectCascadeById(tx: any, objectId: string) {
  await tx.objectSurveyTask.deleteMany({ where: { objectId } })
  await tx.objectPolicyOverride.deleteMany({ where: { objectId } })
  await tx.objectSurveyPolicy.deleteMany({ where: { objectId } })
  await tx.objectRoleAssignment.deleteMany({ where: { objectId } })
  await tx.objectGroupMembership.deleteMany({ where: { objectId } })
  await tx.objectEntity.delete({ where: { id: objectId } })
}

type ObjectGroupRuleConfig = {
  matchMode: 'AND' | 'OR'
  autoSyncEnabled: boolean
  autoSyncIntervalMinutes: number
  lastAutoSyncAt: string | null
  lastAutoSyncStatus: string | null
  lastAutoSyncMessage: string | null
}

async function ensureObjectGroupRuleConfigTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ObjectGroupRuleConfig" (
      "groupId" TEXT PRIMARY KEY,
      "matchMode" TEXT NOT NULL DEFAULT 'AND',
      "autoSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
      "autoSyncIntervalMinutes" INTEGER NOT NULL DEFAULT 0,
      "lastAutoSyncAt" TIMESTAMPTZ NULL,
      "lastAutoSyncStatus" TEXT NULL,
      "lastAutoSyncMessage" TEXT NULL,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "ObjectGroupRuleConfig"
    ADD COLUMN IF NOT EXISTS "autoSyncEnabled" BOOLEAN NOT NULL DEFAULT false
  `)
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "ObjectGroupRuleConfig"
    ADD COLUMN IF NOT EXISTS "autoSyncIntervalMinutes" INTEGER NOT NULL DEFAULT 0
  `)
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "ObjectGroupRuleConfig"
    ADD COLUMN IF NOT EXISTS "lastAutoSyncAt" TIMESTAMPTZ NULL
  `)
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "ObjectGroupRuleConfig"
    ADD COLUMN IF NOT EXISTS "lastAutoSyncStatus" TEXT NULL
  `)
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "ObjectGroupRuleConfig"
    ADD COLUMN IF NOT EXISTS "lastAutoSyncMessage" TEXT NULL
  `)
}

async function getObjectGroupRuleConfig(groupId: string): Promise<ObjectGroupRuleConfig> {
  await ensureObjectGroupRuleConfigTable()
  const rows = (await prisma.$queryRawUnsafe(
    `
      SELECT
        "matchMode",
        "autoSyncEnabled",
        "autoSyncIntervalMinutes",
        "lastAutoSyncAt",
        "lastAutoSyncStatus",
        "lastAutoSyncMessage"
      FROM "ObjectGroupRuleConfig"
      WHERE "groupId" = $1
      LIMIT 1
    `,
    groupId
  )) as Array<{
    matchMode: string
    autoSyncEnabled: boolean
    autoSyncIntervalMinutes: number
    lastAutoSyncAt: Date | string | null
    lastAutoSyncStatus: string | null
    lastAutoSyncMessage: string | null
  }>

  const row = rows[0]
  const matchMode = String(row?.matchMode ?? 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND'
  const interval = Number(row?.autoSyncIntervalMinutes ?? 0)
  return {
    matchMode,
    autoSyncEnabled: !!row?.autoSyncEnabled,
    autoSyncIntervalMinutes: Number.isFinite(interval) && interval > 0 ? Math.floor(interval) : 0,
    lastAutoSyncAt: row?.lastAutoSyncAt ? new Date(row.lastAutoSyncAt).toISOString() : null,
    lastAutoSyncStatus: row?.lastAutoSyncStatus ?? null,
    lastAutoSyncMessage: row?.lastAutoSyncMessage ?? null,
  }
}

async function applyObjectGroupRulesForGroup(groupId: string): Promise<{ count: number; matchMode: 'AND' | 'OR' }> {
  const config = await getObjectGroupRuleConfig(groupId)
  const rules = await prisma.objectGroupRule.findMany({ where: { groupId } })
  const objects = await prisma.objectEntity.findMany()

  const evaluate = (obj: (typeof objects)[number], r: (typeof rules)[number]) => {
    let fieldValue = ''
    if (r.field === 'name') {
      fieldValue = obj.name
    } else if (r.field === 'type') {
      fieldValue = obj.type ?? ''
    } else if (r.field === 'metadata') {
      fieldValue = JSON.stringify(obj.metadata ?? {})
    } else if (r.field.startsWith('metadata:')) {
      const key = r.field.slice('metadata:'.length).trim()
      const meta = obj.metadata as Record<string, unknown> | null
      const valueByKey = key && meta && typeof meta === 'object' && !Array.isArray(meta) ? meta[key] : undefined
      fieldValue = valueByKey === undefined || valueByKey === null ? '' : String(valueByKey)
    }
    const value = r.value
    switch (r.operator) {
      case 'equals':
        return fieldValue === value
      case 'contains':
        return fieldValue.toLowerCase().includes(value.toLowerCase())
      case 'starts_with':
        return fieldValue.toLowerCase().startsWith(value.toLowerCase())
      default:
        return false
    }
  }

  const matches = objects.filter((obj) =>
    rules.length === 0
      ? true
      : config.matchMode === 'OR'
        ? rules.some((r) => evaluate(obj, r))
        : rules.every((r) => evaluate(obj, r))
  )

  await prisma.objectGroupMembership.deleteMany({ where: { groupId } })
  if (matches.length > 0) {
    await prisma.objectGroupMembership.createMany({
      data: matches.map((o) => ({ groupId, objectId: o.id })),
    })
  }
  return { count: matches.length, matchMode: config.matchMode }
}

async function ensureTasksForObjectIds(objectIds: string[]) {
  const unique = Array.from(new Set(objectIds.filter(Boolean)))
  for (const objectId of unique) {
    await ensureTasksForObject(objectId)
  }
}

function canManageExternalImportDefinitionByScope(params: {
  userId: string
  userRole: Role
  userGroupIds: string[]
  definition: {
    createdByUserId?: string | null
    importedByUserId?: string | null
    adminGroupIds?: unknown
  }
}) {
  const { userId, userRole, userGroupIds, definition } = params
  return canSeeEntityByOwnerImportOrGroups({
    userId,
    userRole,
    userGroupIds,
    entity: {
      createdByUserId: definition.createdByUserId,
      importedByUserId: definition.importedByUserId,
      adminGroupIds: definition.adminGroupIds,
    },
  })
}

type ExternalImportRunOptions = {
  dryRun: boolean
  actor: { id: string; role: Role } | null
  actorGroupIds: string[]
  enforceObjectScope: boolean
}

async function executeExternalObjectImport(
  definition: ExternalObjectImportDefinitionRow,
  options: ExternalImportRunOptions
) {
  const { dryRun, actor, actorGroupIds, enforceObjectScope } = options
  let pool: sql.ConnectionPool | null = null
  const startedAt = new Date()
  const runId = crypto.randomUUID()
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO "ExternalObjectImportRun" (
        "id","definitionId","startedAt","status","dryRun"
      ) VALUES ($1,$2,now(),'RUNNING',$3)
    `,
    runId,
    definition.id,
    !!dryRun
  )

  try {
    pool = await sql.connect({
      server: definition.sqlHost,
      port: definition.sqlPort || 1433,
      database: definition.sqlDatabase,
      user: definition.sqlUsername,
      password: definition.sqlPassword,
      options: {
        encrypt: definition.sqlEncrypt,
        trustServerCertificate: definition.sqlTrustServerCertificate,
      },
    })

    const result = await pool.request().query(definition.sqlQuery)
    const rawRows = normalizeSqlRows(result.recordset)
    let created = 0
    let updated = 0
    let deleted = 0
    let skipped = 0
    let importedRows = 0
    const importMode = normalizeExternalImportMode(definition.importMode)
    const isLdapUserImport = importMode === 'USERS_LDAP'
    const isPeopleImport = importMode === 'PEOPLE_ROLES_OBJECT'
    let extraSummary: Record<string, unknown> = {}
    let warnings: string[] = []

    if (isLdapUserImport) {
      const normalized = normalizeImportedLdapUserRows(rawRows, {
        userIdColumn: definition.mapUserIdColumn,
        userEmailColumn: definition.mapUserEmailColumn,
        userDisplayNameColumn: definition.mapUserDisplayNameColumn,
      })
      warnings = [...normalized.warnings]
      importedRows = normalized.rows.length
      const importedExternalIds = new Set(normalized.rows.map((row) => row.userExternalId))
      let usersCreated = 0
      let usersUpdated = 0

      if (!dryRun) {
        await prisma.$transaction(async (tx) => {
          const defaultHash = await bcrypt.hash(crypto.randomUUID(), 10)

          for (const row of normalized.rows) {
            const findClauses: Array<Record<string, unknown>> = [
              { externalId: { equals: row.userExternalId, mode: 'insensitive' as const } },
            ]
            if (row.userEmail) findClauses.push({ email: row.userEmail })

            let user = await tx.user.findFirst({
              where: { OR: findClauses as any },
              select: { id: true, externalId: true, email: true, displayName: true },
            })

            if (!user) {
              let email = row.userEmail
              if (!email) {
                const baseLocal = normalizeGeneratedExternalIdBase(row.userExternalId)
                const baseEmail = `${baseLocal}@ldap.local`
                let candidate = baseEmail
                let suffix = 1
                while (true) {
                  const owner = await tx.user.findUnique({ where: { email: candidate }, select: { id: true } })
                  if (!owner) {
                    email = candidate
                    break
                  }
                  suffix += 1
                  candidate = `${baseLocal}-${suffix}@ldap.local`
                }
              }
              user = await tx.user.create({
                data: {
                  email: email!,
                  externalId: row.userExternalId,
                  displayName: row.userDisplayName || null,
                  passwordHash: defaultHash,
                  role: 'VIEWER',
                  imported: true,
                  createdByUserId: actor?.id ?? definition.createdByUserId ?? null,
                  importedByUserId: actor?.id ?? definition.importedByUserId ?? null,
                },
                select: { id: true, externalId: true, email: true, displayName: true },
              })
              usersCreated += 1
            } else {
              const data: { externalId?: string; email?: string; displayName?: string | null } = {}
              const currentExternalId = (user.externalId || '').trim()
              if (!currentExternalId || currentExternalId.toUpperCase() !== row.userExternalId) {
                const owner = await tx.user.findFirst({
                  where: { externalId: { equals: row.userExternalId, mode: 'insensitive' as const } },
                  select: { id: true },
                })
                if (!owner || owner.id === user.id) {
                  data.externalId = row.userExternalId
                } else {
                  warnings.push(
                    `User-ID Konflikt fuer ${row.userEmail || row.userExternalId}: bestehende User-ID ${row.userExternalId}`
                  )
                }
              }
              if (row.userEmail && row.userEmail !== user.email) {
                const emailOwner = await tx.user.findUnique({ where: { email: row.userEmail }, select: { id: true } })
                if (!emailOwner || emailOwner.id === user.id) {
                  data.email = row.userEmail
                } else {
                  warnings.push(
                    `E-Mail Konflikt fuer User-ID ${row.userExternalId}: bestehende E-Mail ${row.userEmail}`
                  )
                }
              }
              if (row.userDisplayName !== null && row.userDisplayName !== user.displayName) {
                data.displayName = row.userDisplayName
              }
              if (Object.keys(data).length > 0) {
                user = await tx.user.update({
                  where: { id: user.id },
                  data,
                  select: { id: true, externalId: true, email: true, displayName: true },
                })
                usersUpdated += 1
              }
            }

            await tx.$executeRawUnsafe(
              `
                INSERT INTO "ExternalObjectImportItem" ("id","definitionId","objectId","externalId","objectType","lastSeenAt")
                VALUES ($1,$2,$3,$4,$5, now())
                ON CONFLICT ("definitionId","externalId","objectType")
                DO UPDATE SET "objectId" = EXCLUDED."objectId", "lastSeenAt" = now()
              `,
              crypto.randomUUID(),
              definition.id,
              user.id,
              row.userExternalId,
              'LDAP_USER'
            )
          }

          if (definition.deleteMissing) {
            const existingItems = (await tx.$queryRawUnsafe(
              `
                SELECT "id","externalId"
                FROM "ExternalObjectImportItem"
                WHERE "definitionId" = $1 AND "objectType" = 'LDAP_USER'
              `,
              definition.id
            )) as Array<{ id: string; externalId: string }>
            let removedMarkers = 0
            for (const item of existingItems) {
              if (importedExternalIds.has(item.externalId)) continue
              await tx.$executeRawUnsafe(`DELETE FROM "ExternalObjectImportItem" WHERE "id" = $1`, item.id)
              removedMarkers += 1
            }
            if (removedMarkers > 0) {
              warnings.push(
                'Hinweis: deleteMissing entfernt bei LDAP-Benutzerimport nur Import-Marker, keine Benutzerkonten.'
              )
            }
          }
        }, { timeout: EXTERNAL_IMPORT_PRISMA_TIMEOUT_MS })
      } else {
        const candidateExternalIds = Array.from(
          new Set(
            normalized.rows.flatMap((row) =>
              row.userExternalId ? [row.userExternalId, row.userExternalId.toLowerCase()] : []
            )
          )
        )
        const candidateEmails = Array.from(new Set(normalized.rows.map((row) => row.userEmail).filter(Boolean) as string[]))
        const existingUsers =
          candidateExternalIds.length === 0 && candidateEmails.length === 0
            ? []
            : await prisma.user.findMany({
                where: {
                  OR: [
                    candidateExternalIds.length > 0 ? { externalId: { in: candidateExternalIds } } : undefined,
                    candidateEmails.length > 0 ? { email: { in: candidateEmails } } : undefined,
                  ].filter(Boolean) as any,
                },
                select: { externalId: true, email: true },
              })
        const existingByExternalId = new Set(
          existingUsers
            .map((user) => String(user.externalId || '').trim().toUpperCase())
            .filter(Boolean)
        )
        const existingByEmail = new Set(existingUsers.map((user) => user.email).filter(Boolean))

        normalized.rows.forEach((row) => {
          if (existingByExternalId.has(row.userExternalId) || (row.userEmail && existingByEmail.has(row.userEmail))) {
            updated += 1
          } else {
            created += 1
          }
        })
      }

      created += usersCreated
      updated += usersUpdated
      extraSummary = { usersCreated, usersUpdated }
    } else if (isPeopleImport) {
      const normalized = normalizeImportedPersonRoleRows(rawRows, {
        objectIdColumn: definition.mapObjectIdColumn,
        userIdColumn: definition.mapUserIdColumn,
        userEmailColumn: definition.mapUserEmailColumn,
        userDisplayNameColumn: definition.mapUserDisplayNameColumn,
        roleNameColumn: definition.mapRoleNameColumn,
      })
      warnings = [...normalized.warnings]
      importedRows = normalized.rows.length
      const importedKeys = new Set(
        normalized.rows.map((row) => `${row.objectExternalId}::${row.userExternalId}::${row.roleName.toLowerCase()}`)
      )
      let usersCreated = 0
      let usersUpdated = 0
      let rolesCreated = 0
      let assignmentsCreated = 0

      if (!dryRun) {
        await prisma.$transaction(async (tx) => {
          const importScopeGroups = actor ? actorGroupIds : parseStringArray(definition.adminGroupIds)
          const defaultHash = await bcrypt.hash(crypto.randomUUID(), 10)
          for (const row of normalized.rows) {
            const object = await tx.objectEntity.findUnique({
              where: { externalId: row.objectExternalId },
              select: { id: true, createdByUserId: true, importedByUserId: true, adminGroupIds: true },
            })
            if (!object) {
              skipped += 1
              warnings.push(`Objekt nicht gefunden fuer Objekt-ID: ${row.objectExternalId}`)
              continue
            }
            const allowed =
              !enforceObjectScope ||
              (actor
                ? canManageObjectByScope({
                    userId: actor.id,
                    userRole: actor.role,
                    userGroupIds: actorGroupIds,
                    object,
                  })
                : true)
            if (!allowed) {
              skipped += 1
              warnings.push(`Keine Berechtigung fuer Objekt: ${row.objectExternalId}`)
              continue
            }

            let user = await tx.user.findUnique({
              where: { externalId: row.userExternalId },
              select: { id: true, externalId: true, email: true, role: true },
            })
            if (!user && row.userEmail) {
              const byEmail = await tx.user.findUnique({
                where: { email: row.userEmail },
                select: { id: true, externalId: true, email: true, role: true },
              })
              if (byEmail && byEmail.externalId && byEmail.externalId !== row.userExternalId) {
                skipped += 1
                warnings.push(`User-ID Konflikt fuer E-Mail ${row.userEmail}: bestehende User-ID ${byEmail.externalId}`)
                continue
              }
              user = byEmail
            }

            if (!user) {
              const email =
                row.userEmail?.trim() ||
                `${row.userExternalId.replace(/[^a-zA-Z0-9._-]/g, '_')}@import.local`
              const createdUser = await tx.user.create({
                data: {
                  email,
                  externalId: row.userExternalId,
                  displayName: row.userDisplayName || null,
                  passwordHash: defaultHash,
                  role: 'VIEWER',
                  imported: true,
                  createdByUserId: actor?.id ?? definition.createdByUserId ?? null,
                  importedByUserId: actor?.id ?? definition.importedByUserId ?? null,
                },
                select: { id: true, externalId: true, email: true, role: true },
              })
              user = createdUser
              usersCreated += 1
            } else {
              const data: any = {}
              if (!user.externalId) data.externalId = row.userExternalId
              if (row.userEmail && row.userEmail !== user.email) data.email = row.userEmail
              if (row.userDisplayName) data.displayName = row.userDisplayName
              if (Object.keys(data).length > 0) {
                user = await tx.user.update({
                  where: { id: user.id },
                  data,
                  select: { id: true, externalId: true, email: true, role: true },
                })
                usersUpdated += 1
              }
            }

            const existingRole = await tx.roleDefinition.findUnique({ where: { name: row.roleName } })
            if (!existingRole) rolesCreated += 1
            const role = await tx.roleDefinition.upsert({
              where: { name: row.roleName },
              update: {
                importedByUserId: actor?.id ?? definition.importedByUserId ?? undefined,
                adminGroupIds: importScopeGroups,
              },
              create: {
                name: row.roleName,
                createdByUserId: actor?.id ?? definition.createdByUserId ?? null,
                importedByUserId: actor?.id ?? definition.importedByUserId ?? null,
                adminGroupIds: importScopeGroups,
              },
            })

            const existingAssignment = await tx.objectRoleAssignment.findFirst({
              where: { objectId: object.id, roleId: role.id, userId: user.id, groupId: null },
              select: { id: true },
            })
            const assignmentId = existingAssignment?.id ?? crypto.randomUUID()
            if (!existingAssignment) {
              await tx.objectRoleAssignment.create({
                data: { id: assignmentId, objectId: object.id, roleId: role.id, userId: user.id },
              })
              assignmentsCreated += 1
            }

            const key = `${row.objectExternalId}::${row.userExternalId}::${row.roleName.toLowerCase()}`
            await tx.$executeRawUnsafe(
              `
                INSERT INTO "ExternalObjectImportItem" ("id","definitionId","objectId","assignmentId","externalId","objectType","userExternalId","roleName","lastSeenAt")
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
                ON CONFLICT ("definitionId","externalId","objectType")
                DO UPDATE SET "objectId" = EXCLUDED."objectId", "assignmentId" = EXCLUDED."assignmentId", "userExternalId" = EXCLUDED."userExternalId", "roleName" = EXCLUDED."roleName", "lastSeenAt" = now()
              `,
              crypto.randomUUID(),
              definition.id,
              object.id,
              assignmentId,
              key,
              'PERSON_ROLE_OBJECT',
              row.userExternalId,
              row.roleName
            )
          }

          if (definition.deleteMissing) {
            const existingItems = (await tx.$queryRawUnsafe(
              `
                SELECT "id","assignmentId","externalId","objectType"
                FROM "ExternalObjectImportItem"
                WHERE "definitionId" = $1 AND "objectType" = 'PERSON_ROLE_OBJECT'
              `,
              definition.id
            )) as Array<{ id: string; assignmentId: string | null; externalId: string; objectType: string }>

            for (const item of existingItems) {
              if (importedKeys.has(item.externalId)) continue
              if (item.assignmentId) {
                await tx.objectRoleAssignment.deleteMany({ where: { id: item.assignmentId } })
                deleted += 1
              }
              await tx.$executeRawUnsafe(`DELETE FROM "ExternalObjectImportItem" WHERE "id" = $1`, item.id)
            }
          }
        }, { timeout: EXTERNAL_IMPORT_PRISMA_TIMEOUT_MS })
      } else {
        const objectIds = Array.from(new Set(normalized.rows.map((row) => row.objectExternalId)))
        const knownObjects = await prisma.objectEntity.findMany({
          where: { externalId: { in: objectIds } },
          select: { externalId: true },
        })
        const objectSet = new Set(knownObjects.map((o) => o.externalId || ''))
        normalized.rows.forEach((row) => {
          if (!objectSet.has(row.objectExternalId)) skipped += 1
          else created += 1
        })
      }

      created += assignmentsCreated
      updated += usersUpdated
      extraSummary = { usersCreated, usersUpdated, rolesCreated, assignmentsCreated }
    } else {
      const normalized = normalizeImportedObjectRows(rawRows, {
        objectIdColumn: definition.mapObjectIdColumn,
        typeColumn: definition.mapTypeColumn,
        nameColumn: definition.mapNameColumn,
        descriptionColumn: definition.mapDescriptionColumn,
        metadataColumn: definition.mapMetadataColumn,
      })
      warnings = [...normalized.warnings]
      importedRows = normalized.rows.length
      const importedKeys = new Set(normalized.rows.map((row) => row.externalId))

      if (!dryRun) {
        await prisma.$transaction(async (tx) => {
          for (const row of normalized.rows) {
            const existing = await tx.objectEntity.findUnique({
              where: { externalId: row.externalId },
              select: {
                id: true,
                metadata: true,
                createdByUserId: true,
                importedByUserId: true,
                adminGroupIds: true,
              },
            })
            const nextMetadata = {
              ...(existing?.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
                ? (existing.metadata as Record<string, unknown>)
                : {}),
              ...(row.metadata ?? {}),
              externalImportDefinitionId: definition.id,
              externalImportDefinitionName: definition.name,
              externalImportSyncedAt: new Date().toISOString(),
            }
            let objectId = ''

            if (existing) {
              const allowed =
                !enforceObjectScope ||
                (actor
                  ? canManageObjectByScope({
                      userId: actor.id,
                      userRole: actor.role,
                      userGroupIds: actorGroupIds,
                      object: existing,
                    })
                  : true)
              if (!allowed) {
                skipped += 1
                warnings.push(`Objekt nicht aktualisiert (keine Berechtigung): ${row.externalId}`)
                continue
              }
              const updatedObj = await tx.objectEntity.update({
                where: { id: existing.id },
                data: {
                  name: row.name,
                  type: row.type,
                  description: row.description,
                  metadata: nextMetadata,
                  importedByUserId: actor?.id ?? existing.importedByUserId ?? undefined,
                },
              })
              objectId = updatedObj.id
              updated += 1
            } else {
              let createdObj
              try {
                createdObj = await tx.objectEntity.create({
                  data: {
                    externalId: row.externalId,
                    name: row.name,
                    type: row.type,
                    description: row.description,
                    metadata: nextMetadata,
                    createdByUserId: actor?.id ?? definition.createdByUserId ?? null,
                    importedByUserId: actor?.id ?? definition.importedByUserId ?? null,
                    adminGroupIds: actor ? actorGroupIds : parseStringArray(definition.adminGroupIds),
                  },
                })
              } catch (createError) {
                if (isPrismaUniqueConstraintError(createError)) {
                  const baseMessage =
                    createError instanceof Error ? createError.message : 'Unique constraint failed'
                  throw new Error(
                    `Objekt konnte nicht angelegt werden (Unique-Constraint). object_id="${row.externalId}", name="${row.name}". ` +
                      `Bitte Legacy-Unique-Index "ObjectEntity_name_key" pruefen. Details: ${baseMessage}`
                  )
                }
                throw createError
              }
              objectId = createdObj.id
              created += 1
            }

            await tx.$executeRawUnsafe(
              `
                INSERT INTO "ExternalObjectImportItem" ("id","definitionId","objectId","externalId","objectType","lastSeenAt")
                VALUES ($1,$2,$3,$4,$5, now())
                ON CONFLICT ("definitionId","externalId","objectType")
                DO UPDATE SET "objectId" = EXCLUDED."objectId", "lastSeenAt" = now()
              `,
              crypto.randomUUID(),
              definition.id,
              objectId,
              row.externalId,
              ''
            )
          }

          if (definition.deleteMissing) {
            const existingItems = (await tx.$queryRawUnsafe(
              `
                SELECT "id","objectId","externalId","objectType"
                FROM "ExternalObjectImportItem"
                WHERE "definitionId" = $1
                ORDER BY "lastSeenAt" DESC
              `,
              definition.id
            )) as Array<{ id: string; objectId: string | null; externalId: string; objectType: string }>
            const staleItems = existingItems.filter((item) => !importedKeys.has(item.externalId))
            const staleByExternalId = new Map<string, Array<{ id: string; objectId: string | null }>>()
            for (const item of staleItems) {
              const current = staleByExternalId.get(item.externalId) ?? []
              current.push({ id: item.id, objectId: item.objectId })
              staleByExternalId.set(item.externalId, current)
            }

            for (const [externalId, itemsForExternalId] of staleByExternalId.entries()) {
              const uniqueObjectIds = Array.from(
                new Set(itemsForExternalId.map((entry) => entry.objectId).filter((id): id is string => !!id))
              )
              let objectDeletedForExternalId = false
              for (const objectId of uniqueObjectIds) {
                const currentObject = await tx.objectEntity.findUnique({
                  where: { id: objectId },
                  select: {
                    id: true,
                    metadata: true,
                    createdByUserId: true,
                    importedByUserId: true,
                    adminGroupIds: true,
                  },
                })
                if (!currentObject) continue
                const metadata = currentObject.metadata as Record<string, unknown> | null
                const sourceDefId = metadata?.externalImportDefinitionId
                const isSourceMatch = sourceDefId === definition.id
                const allowed =
                  !enforceObjectScope ||
                  (actor
                    ? canManageObjectByScope({
                        userId: actor.id,
                        userRole: actor.role,
                        userGroupIds: actorGroupIds,
                        object: currentObject,
                      })
                    : true)
                if (allowed && isSourceMatch) {
                  await deleteObjectCascadeById(tx, currentObject.id)
                  deleted += 1
                  objectDeletedForExternalId = true
                }
              }

              if (!objectDeletedForExternalId && uniqueObjectIds.length > 0) {
                skipped += 1
                warnings.push(`Objekt nicht geloescht (keine Berechtigung oder andere Quelle): ${externalId}`)
              }

              const staleItemIds = itemsForExternalId.map((entry) => entry.id)
              if (staleItemIds.length > 0) {
                for (const staleItemId of staleItemIds) {
                  await tx.$executeRawUnsafe(`DELETE FROM "ExternalObjectImportItem" WHERE "id" = $1`, staleItemId)
                }
              }
            }
          }
        }, { timeout: EXTERNAL_IMPORT_PRISMA_TIMEOUT_MS })
      } else {
        const existing = await prisma.objectEntity.findMany({
          where: { externalId: { in: normalized.rows.map((row) => row.externalId) } },
          select: { externalId: true },
        })
        const existingIds = new Set(existing.map((item) => item.externalId || ''))
        normalized.rows.forEach((row) => {
          if (existingIds.has(row.externalId)) updated += 1
          else created += 1
        })
      }
    }

    const summary = {
      sourceRows: rawRows.length,
      importedRows,
      created,
      updated,
      deleted,
      skipped,
      warningsCount: warnings.length,
      dryRun: !!dryRun,
      durationMs: Date.now() - startedAt.getTime(),
      ...extraSummary,
    }

    await prisma.$executeRawUnsafe(
      `
        UPDATE "ExternalObjectImportDefinition"
        SET
          "lastRunAt" = now(),
          "lastRunStatus" = $2,
          "lastRunMessage" = $3,
          "lastRunSummary" = $4::jsonb,
          "importedByUserId" = COALESCE($5, "importedByUserId"),
          "updatedAt" = now()
        WHERE "id" = $1
      `,
      definition.id,
      warnings.length > 0 ? 'SUCCESS_WITH_WARNINGS' : 'SUCCESS',
      warnings.length > 0 ? `Import mit ${warnings.length} Warnungen abgeschlossen.` : 'Import erfolgreich.',
      JSON.stringify(summary),
      actor?.id ?? null
    )
    await prisma.$executeRawUnsafe(
      `
        UPDATE "ExternalObjectImportRun"
        SET
          "finishedAt" = now(),
          "status" = $2,
          "sourceRows" = $3,
          "importedRows" = $4,
          "createdCount" = $5,
          "updatedCount" = $6,
          "deletedCount" = $7,
          "skippedCount" = $8,
          "warningCount" = $9,
          "message" = $10,
          "warnings" = $11::jsonb,
          "summary" = $12::jsonb
        WHERE "id" = $1
      `,
      runId,
      warnings.length > 0 ? 'SUCCESS_WITH_WARNINGS' : 'SUCCESS',
      summary.sourceRows,
      summary.importedRows,
      summary.created,
      summary.updated,
      summary.deleted,
      summary.skipped,
      summary.warningsCount,
      warnings.length > 0 ? `Import mit ${warnings.length} Warnungen abgeschlossen.` : 'Import erfolgreich.',
      JSON.stringify(warnings),
      JSON.stringify(summary)
    )

    return { summary, warnings }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    await prisma.$executeRawUnsafe(
      `
        UPDATE "ExternalObjectImportDefinition"
        SET
          "lastRunAt" = now(),
          "lastRunStatus" = 'FAILED',
          "lastRunMessage" = $2,
          "updatedAt" = now()
        WHERE "id" = $1
      `,
      definition.id,
      message.slice(0, 1000)
    )
    await prisma.$executeRawUnsafe(
      `
        UPDATE "ExternalObjectImportRun"
        SET
          "finishedAt" = now(),
          "status" = 'FAILED',
          "message" = $2
        WHERE "id" = $1
      `,
      runId,
      message.slice(0, 4000)
    )
    throw error
  } finally {
    if (pool) await pool.close()
  }
}

const runningExternalImportDefinitionIds = new Set<string>()
let externalImportSchedulerHandle: NodeJS.Timeout | null = null

function startExternalImportScheduler() {
  if (externalImportSchedulerHandle) return
  const enabled = (process.env.EXTERNAL_IMPORT_SCHEDULER_ENABLED ?? 'true').toLowerCase() !== 'false'
  if (!enabled) return
  const tickMs = Math.max(15_000, Number(process.env.EXTERNAL_IMPORT_SCHEDULER_TICK_MS || 60_000))
  externalImportSchedulerHandle = setInterval(async () => {
    try {
      await ensureExternalObjectImportTables()
      const defs = (await prisma.$queryRawUnsafe(`
        SELECT *
        FROM "ExternalObjectImportDefinition"
        WHERE "enabled" = true AND "scheduleEveryMinutes" IS NOT NULL AND "scheduleEveryMinutes" > 0
      `)) as ExternalObjectImportDefinitionRow[]
      const now = Date.now()
      for (const def of defs) {
        if (runningExternalImportDefinitionIds.has(def.id)) continue
        const minutes = def.scheduleEveryMinutes ?? 0
        if (minutes <= 0) continue
        const last = def.lastRunAt ? new Date(def.lastRunAt).getTime() : 0
        const due = !last || now - last >= minutes * 60_000
        if (!due) continue
        runningExternalImportDefinitionIds.add(def.id)
        executeExternalObjectImport(def, {
          dryRun: false,
          actor: null,
          actorGroupIds: [],
          enforceObjectScope: false,
        })
          .catch((error) => {
            console.error(`External import scheduler failed for ${def.name} (${def.id}):`, error)
          })
          .finally(() => runningExternalImportDefinitionIds.delete(def.id))
      }
    } catch (error) {
      console.error('External import scheduler tick failed:', error)
    }
  }, tickMs)
}

const runningObjectGroupRuleSyncGroupIds = new Set<string>()
let objectGroupRuleSyncSchedulerHandle: NodeJS.Timeout | null = null

function startObjectGroupRuleSyncScheduler() {
  if (objectGroupRuleSyncSchedulerHandle) return
  const enabled = (process.env.OBJECT_GROUP_RULE_SCHEDULER_ENABLED ?? 'true').toLowerCase() !== 'false'
  if (!enabled) return
  const tickMs = Math.max(15_000, Number(process.env.OBJECT_GROUP_RULE_SCHEDULER_TICK_MS || 60_000))
  objectGroupRuleSyncSchedulerHandle = setInterval(async () => {
    try {
      await ensureObjectGroupRuleConfigTable()
      const rows = (await prisma.$queryRawUnsafe(`
        SELECT
          "groupId",
          "autoSyncIntervalMinutes",
          "lastAutoSyncAt"
        FROM "ObjectGroupRuleConfig"
        WHERE "autoSyncEnabled" = true
          AND "autoSyncIntervalMinutes" IS NOT NULL
          AND "autoSyncIntervalMinutes" > 0
      `)) as Array<{
        groupId: string
        autoSyncIntervalMinutes: number
        lastAutoSyncAt: Date | string | null
      }>
      const now = Date.now()
      for (const row of rows) {
        if (runningObjectGroupRuleSyncGroupIds.has(row.groupId)) continue
        const minutes = Number(row.autoSyncIntervalMinutes ?? 0)
        if (!Number.isFinite(minutes) || minutes <= 0) continue
        const last = row.lastAutoSyncAt ? new Date(row.lastAutoSyncAt).getTime() : 0
        const due = !last || now - last >= minutes * 60_000
        if (!due) continue
        runningObjectGroupRuleSyncGroupIds.add(row.groupId)
        applyObjectGroupRulesForGroup(row.groupId)
          .then((result) =>
            prisma.$executeRawUnsafe(
              `
                UPDATE "ObjectGroupRuleConfig"
                SET
                  "lastAutoSyncAt" = now(),
                  "lastAutoSyncStatus" = 'SUCCESS',
                  "lastAutoSyncMessage" = $2,
                  "updatedAt" = now()
                WHERE "groupId" = $1
              `,
              row.groupId,
              `${result.count} Objekt(e) zugeordnet`
            )
          )
          .catch(async (error) => {
            const message = error instanceof Error ? error.message : String(error ?? 'UNKNOWN_ERROR')
            try {
              await prisma.$executeRawUnsafe(
                `
                  UPDATE "ObjectGroupRuleConfig"
                  SET
                    "lastAutoSyncAt" = now(),
                    "lastAutoSyncStatus" = 'FAILED',
                    "lastAutoSyncMessage" = $2,
                    "updatedAt" = now()
                  WHERE "groupId" = $1
                `,
                row.groupId,
                message.slice(0, 1000)
              )
            } catch (updateError) {
              console.error(`Failed to persist rule sync error for group ${row.groupId}:`, updateError)
            }
            console.error(`Object group rule sync failed for group ${row.groupId}:`, error)
          })
          .finally(() => runningObjectGroupRuleSyncGroupIds.delete(row.groupId))
      }
    } catch (error) {
      console.error('Object group rule sync scheduler tick failed:', error)
    }
  }, tickMs)
}

function jiraEscape(value: string) {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim()
}

function buildJiraIssuePayload(input: {
  projectKey: string
  summary: string
  description: string
  issueType?: string
  assignee?: string
  contactPerson?: string
  epicName?: string
  components?: string[]
  dueDate?: string
}) {
  const payload: any = {
    fields: {
      project: { key: input.projectKey },
      summary: input.summary,
      description: input.description,
      issuetype: { name: input.issueType || JIRA_DEFAULT_ISSUE_TYPE || 'Task' },
    },
  }

  if (input.assignee) payload.fields.assignee = { name: input.assignee }

  const contactName = input.contactPerson || input.assignee
  if (contactName && JIRA_CONTACT_CUSTOM_FIELD_ID) {
    payload.fields[JIRA_CONTACT_CUSTOM_FIELD_ID] = { name: contactName }
  }

  if (input.epicName && JIRA_EPIC_NAME_CUSTOM_FIELD_ID) {
    payload.fields[JIRA_EPIC_NAME_CUSTOM_FIELD_ID] = input.epicName
  }

  const components = (input.components && input.components.length > 0
    ? input.components
    : JIRA_DEFAULT_COMPONENTS
  ).filter(Boolean)
  if (components.length > 0) {
    payload.fields.components = components.map((name) => ({ name }))
  }

  if (input.dueDate && input.dueDate.trim()) {
    payload.fields.duedate = input.dueDate.trim()
  }

  return payload
}

function getJiraIssueApiBaseUrl() {
  const base = JIRA_ISSUE_CREATE_URL.trim().replace(/\/+$/, '')
  if (!base) return ''
  if (/\/issue$/i.test(base)) return base
  return base
}

function getJiraAuthDebugUser() {
  const raw = String(JIRA_BASIC_AUTH || '').trim()
  if (!raw.toLowerCase().startsWith('basic ')) return null
  try {
    const decoded = Buffer.from(raw.slice(6).trim(), 'base64').toString('utf8')
    const idx = decoded.indexOf(':')
    if (idx <= 0) return null
    return decoded.slice(0, idx)
  } catch {
    return null
  }
}

function pickResponseHeaders(response: Response) {
  return {
    contentType: response.headers.get('content-type'),
    xAusername: response.headers.get('x-ausername'),
    xAsessionid: response.headers.get('x-asessionid'),
    xSeraphLoginReason: response.headers.get('x-seraph-loginreason'),
    wwwAuthenticate: response.headers.get('www-authenticate'),
  }
}

function toErrorDebug(err: unknown) {
  const e = err as Error & { cause?: any }
  const cause = e?.cause as
    | undefined
    | {
        code?: string
        errno?: string | number
        syscall?: string
        hostname?: string
        address?: string
        port?: number
        message?: string
      }
  return {
    name: e?.name ?? null,
    message: e?.message ?? String(err),
    stack: e?.stack ?? null,
    cause: cause
      ? {
          code: cause.code ?? null,
          errno: cause.errno ?? null,
          syscall: cause.syscall ?? null,
          hostname: cause.hostname ?? null,
          address: cause.address ?? null,
          port: cause.port ?? null,
          message: cause.message ?? null,
        }
      : null,
  }
}

async function jiraProbe(label: string, url: string, init?: RequestInit) {
  const startedAt = Date.now()
  try {
    const response = await fetch(url, init)
    const text = await response.text()
    return {
      label,
      url,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      timingMs: Date.now() - startedAt,
      responseHeaders: pickResponseHeaders(response),
      bodySnippet: text.slice(0, 2000),
    }
  } catch (err) {
    return {
      label,
      url,
      ok: false,
      status: null,
      statusText: null,
      timingMs: Date.now() - startedAt,
      error: toErrorDebug(err),
    }
  }
}

async function resolveObjectPickerLabelMapForJira(
  sections: any[],
  answers: Record<string, unknown>
): Promise<Map<string, string>> {
  const objectPickerQuestionIds = new Set<string>()
  sections.forEach((section: any) => {
    const questions = Array.isArray(section?.questions) ? section.questions : []
    questions.forEach((question: any) => {
      if (question?.type === 'object_picker' && typeof question?.id === 'string' && question.id.trim()) {
        objectPickerQuestionIds.add(question.id.trim())
      }
    })
  })
  if (objectPickerQuestionIds.size === 0) return new Map()

  const rawValues = new Set<string>()
  objectPickerQuestionIds.forEach((questionId) => {
    const raw = answers?.[questionId]
    if (typeof raw === 'string' && raw.trim()) rawValues.add(raw.trim())
    if (Array.isArray(raw)) {
      raw.forEach((entry) => {
        if (typeof entry === 'string' && entry.trim()) rawValues.add(entry.trim())
      })
    }
  })
  if (rawValues.size === 0) return new Map()

  const candidates = Array.from(rawValues)
  const objects = await prisma.objectEntity.findMany({
    where: {
      OR: [{ id: { in: candidates } }, { externalId: { in: candidates } }],
    },
    select: { id: true, externalId: true, name: true },
  })
  const byValue = new Map<string, string>()
  objects.forEach((obj) => {
    const objectIdLabel = (obj.externalId?.trim() || obj.id).trim()
    const objectName = obj.name?.trim() || '-'
    const label = `${objectIdLabel} - ${objectName}`
    byValue.set(obj.id, label)
    if (obj.externalId?.trim()) byValue.set(obj.externalId.trim(), label)
  })
  return byValue
}

function answerLabelForJira(
  question: any,
  value: unknown,
  objectPickerLabels?: Map<string, string>,
  assignmentObjectLabels?: Map<string, string>,
  assignmentUserLabels?: Map<string, string>
) {
  const decodeCustom = (v: unknown) =>
    typeof v === 'string' && v.startsWith('__custom__:') ? v.slice('__custom__:'.length) : null
  if (value === undefined || value === null || value === '') return '-'
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nein'
  if (question?.type === 'object_picker') {
    const resolveObjectValue = (entry: unknown) => {
      const raw = String(entry ?? '').trim()
      if (!raw) return '-'
      return objectPickerLabels?.get(raw) ?? raw
    }
    if (Array.isArray(value)) {
      if (value.length === 0) return '-'
      return value.map((entry) => resolveObjectValue(entry)).join(', ')
    }
    return resolveObjectValue(value)
  }
  if (question?.type === 'assignment_picker') {
    if (typeof value !== 'string' || !value.trim()) return '-'
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '-'
      const options = Array.isArray(question?.assignmentOptions) ? question.assignmentOptions : []
      const optionMap = new Map<string, any>(
        options
          .map((opt: any) => [typeof opt?.id === 'string' ? opt.id.trim() : '', opt] as const)
          .filter(([id]) => !!id)
      )
      const lines: string[] = []
      for (const [optionId, rawEntry] of Object.entries(parsed)) {
        const option = optionMap.get(optionId)
        const optionLabel = option?.label ? String(option.label) : optionId
        if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) continue
        const valuesRaw = (rawEntry as { values?: unknown }).values
        const values = Array.isArray(valuesRaw)
          ? valuesRaw.map((entry) => String(entry ?? '').trim()).filter(Boolean)
          : []
        const resolved = values.map((entry) => {
          if (option?.targetType === 'user') {
            return assignmentUserLabels?.get(entry) ?? entry
          }
          return assignmentObjectLabels?.get(entry) ?? entry
        })
        lines.push(`${optionLabel}: ${resolved.length > 0 ? resolved.join(', ') : '-'}`)
      }
      return lines.length > 0 ? lines.join(' | ') : '-'
    } catch {
      return '-'
    }
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '-'
    return value
      .map((entry) => {
        const opt = Array.isArray(question.options)
          ? question.options.find((o: any) => o?.value === entry)
          : null
        const custom = decodeCustom(entry)
        return opt?.label ? String(opt.label) : custom ? `${custom} (added)` : String(entry)
      })
      .join(', ')
  }
  if (question?.type === 'single' && Array.isArray(question.options)) {
    const opt = question.options.find((o: any) => o?.value === value)
    if (opt?.label) return String(opt.label)
  }
  const custom = decodeCustom(value)
  if (custom) return `${custom} (added)`
  return String(value)
}

type JiraAnswerRow = {
  sectionTitle: string
  questionTitle: string
  answerLabel: string
  reason: string
}

async function buildJiraAnswerRows(
  sections: any[],
  answers: Record<string, unknown>
): Promise<JiraAnswerRow[]> {
  const rows: JiraAnswerRow[] = []
  const objectPickerLabels = await resolveObjectPickerLabelMapForJira(sections, answers)
  const assignmentObjectCandidates = new Set<string>()
  const assignmentUserCandidates = new Set<string>()
  sections.forEach((section: any) => {
    const questions = Array.isArray(section?.questions) ? section.questions : []
    questions.forEach((question: any) => {
      if (question?.type !== 'assignment_picker' || !question?.id) return
      const raw = answers?.[String(question.id)]
      if (typeof raw !== 'string' || !raw.trim()) return
      let parsed: Record<string, unknown>
      try {
        const obj = JSON.parse(raw)
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return
        parsed = obj as Record<string, unknown>
      } catch {
        return
      }
      const options = Array.isArray(question?.assignmentOptions) ? question.assignmentOptions : []
      const optionMap = new Map<string, any>(
        options
          .map((opt: any) => [typeof opt?.id === 'string' ? opt.id.trim() : '', opt] as const)
          .filter(([id]) => !!id)
      )
      Object.entries(parsed).forEach(([optionId, rawEntry]) => {
        if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) return
        const opt = optionMap.get(optionId)
        const valuesRaw = (rawEntry as { values?: unknown }).values
        const values = Array.isArray(valuesRaw)
          ? valuesRaw.map((entry) => String(entry ?? '').trim()).filter(Boolean)
          : []
        values.forEach((valueId) => {
          if (opt?.targetType === 'user') assignmentUserCandidates.add(valueId)
          else assignmentObjectCandidates.add(valueId)
        })
      })
    })
  })
  const assignmentObjectLabels = new Map<string, string>()
  if (assignmentObjectCandidates.size > 0) {
    const candidates = Array.from(assignmentObjectCandidates)
    const objects = await prisma.objectEntity.findMany({
      where: { OR: [{ id: { in: candidates } }, { externalId: { in: candidates } }] },
      select: { id: true, externalId: true, name: true },
    })
    objects.forEach((obj) => {
      const label = `${obj.externalId?.trim() || obj.id} - ${obj.name}`
      assignmentObjectLabels.set(obj.id, label)
      if (obj.externalId?.trim()) assignmentObjectLabels.set(obj.externalId.trim(), label)
    })
  }
  const assignmentUserLabels = new Map<string, string>()
  if (assignmentUserCandidates.size > 0) {
    const candidates = Array.from(assignmentUserCandidates)
    const users = await prisma.user.findMany({
      where: { OR: [{ id: { in: candidates } }, { externalId: { in: candidates } }] },
      select: { id: true, email: true, displayName: true, externalId: true },
    })
    users.forEach((user) => {
      const label = user.displayName?.trim() ? `${user.displayName.trim()} - ${user.email}` : user.email
      assignmentUserLabels.set(user.id, label)
      if (user.externalId?.trim()) assignmentUserLabels.set(user.externalId.trim(), label)
    })
  }
  sections.forEach((section: any) => {
    const sectionTitle = section?.title ? String(section.title) : '-'
    const questions = Array.isArray(section?.questions) ? section.questions : []
    questions.forEach((question: any) => {
      const questionTitleRaw =
        question?.title ? String(question.title) : question?.id ? String(question.id) : '-'
      // Defensive: only the actual question title, never additional multiline description text.
      const questionTitle = questionTitleRaw.split(/\r?\n/)[0]?.trim() || '-'
      const reasonKey = `${question?.id}__reason`
      const reasonRaw = answers?.[reasonKey]
      const reason = typeof reasonRaw === 'string' && reasonRaw.trim() ? reasonRaw : '-'
      const answerLabel = answerLabelForJira(
        question,
        answers?.[question?.id],
        objectPickerLabels,
        assignmentObjectLabels,
        assignmentUserLabels
      )
      rows.push({
        sectionTitle,
        questionTitle,
        answerLabel,
        reason,
      })
    })
  })
  return rows
}

async function buildJiraDescriptionFromSubmission(params: {
  questionnaireTitle: string
  questionnaireVersion: number
  submittedAt: Date
  userEmail?: string | null
  userExternalId?: string | null
  answers: Record<string, unknown>
  sections: any[]
}) {
  const {
    questionnaireTitle,
    questionnaireVersion,
    submittedAt,
    userEmail,
    userExternalId,
    answers,
    sections,
  } = params

  const lines: string[] = []
  lines.push('h2. Umfrageergebnis')
  lines.push('')
  lines.push(`*Fragebogen:* ${jiraEscape(questionnaireTitle)} (Version ${questionnaireVersion})`)
  lines.push(`*Eingereicht am:* ${submittedAt.toLocaleString('de-DE')}`)
  lines.push(`*Benutzer:* ${jiraEscape(userEmail || '-')}`)
  lines.push(`*UserID:* ${jiraEscape(userExternalId || '-')}`)
  lines.push('')

  const rows = await buildJiraAnswerRows(sections, answers)
  let currentSection = ''
  rows.forEach((row) => {
    if (row.sectionTitle !== currentSection) {
      currentSection = row.sectionTitle
      lines.push(`*Segment:* ${jiraEscape(currentSection)}`)
      lines.push('')
    }
    lines.push(`*Frage:* ${jiraEscape(row.questionTitle)}`)
    lines.push(`*Antwort:* ${jiraEscape(row.answerLabel)}`)
    if (row.reason !== '-') {
      lines.push(`*Begruendung:* ${jiraEscape(row.reason)}`)
    }
    lines.push('')
  })

  return lines.join('\n')
}

function buildReadonlyResultLink(submissionId: string) {
  const base = CLIENT_PUBLIC_BASE_URL.replace(/\/+$/, '')
  if (!base) return null
  return `${base}/result/${encodeURIComponent(submissionId)}/readonly`
}

function buildJiraDescriptionMeta(params: {
  questionnaireTitle: string
  questionnaireVersion: number
  submittedAt: Date
  userEmail?: string | null
  userExternalId?: string | null
  submissionId: string
}) {
  const lines: string[] = []
  lines.push('h2. Umfrageergebnis')
  lines.push('')
  lines.push(
    `*Fragebogen:* ${jiraEscape(params.questionnaireTitle)} (Version ${params.questionnaireVersion})`
  )
  lines.push(`*Eingereicht am:* ${params.submittedAt.toLocaleString('de-DE')}`)
  lines.push(`*Benutzer:* ${jiraEscape(params.userEmail || '-')}`)
  lines.push(`*UserID:* ${jiraEscape(params.userExternalId || '-')}`)
  lines.push(`*SubmissionId:* ${jiraEscape(params.submissionId)}`)
  return lines.join('\n')
}

function htmlToJiraText(value: string) {
  const withNewlines = value
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/p\s*>/gi, '\n\n')
    .replace(/<\s*\/div\s*>/gi, '\n')
    .replace(/<\s*li\s*>/gi, '\n- ')
  const stripped = withNewlines.replace(/<[^>]*>/g, '')
  const decoded = stripped
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
  return decoded
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim()
}

async function resolveJiraDescriptionFromConfig(
  config: QuestionnaireJiraConfig,
  submission: JiraSubmissionSnapshot
) {
  const parts: string[] = []
  if (config.descriptionIntroHtml?.trim()) {
    const intro = htmlToJiraText(config.descriptionIntroHtml)
    if (intro) {
      parts.push(jiraEscape(intro))
      parts.push('')
    }
  }

  if (config.includeSurveyTextInDescription) {
    parts.push(
      await buildJiraDescriptionFromSubmission({
        questionnaireTitle: submission.questionnaire.title,
        questionnaireVersion: submission.questionnaire.version,
        submittedAt: submission.submittedAt,
        userEmail: submission.user?.email,
        userExternalId: submission.user?.externalId,
        answers: submission.answers,
        sections: submission.questionnaire.sections,
      })
    )
  } else {
    parts.push(
      buildJiraDescriptionMeta({
        questionnaireTitle: submission.questionnaire.title,
        questionnaireVersion: submission.questionnaire.version,
        submittedAt: submission.submittedAt,
        userEmail: submission.user?.email,
        userExternalId: submission.user?.externalId,
        submissionId: submission.id,
      })
    )
  }

  if (config.includeReadonlyLinkInDescription) {
    parts.push('')
    parts.push(`*Readonly-Ergebnis:* ${jiraEscape(buildReadonlyResultLink(submission.id) ?? '-')}`)
  }

  return parts.join('\n').trim()
}

type JiraSubmissionSnapshot = {
  id: string
  questionnaireId: string
  questionnaireVersion: number | null
  submittedAt: Date
  answers: Record<string, unknown>
  user: { id: string; email: string | null; externalId: string | null } | null
  object: { id: string; externalId: string | null; name: string | null } | null
  questionnaire: { id: string; title: string; version: number; sections: any[] }
}

type JiraIssueOverrides = {
  projectKey?: string
  summary?: string
  issueType?: string
  assignee?: string
  contactPerson?: string
  epicName?: string
  components?: string[]
  dueDate?: string
  attachExcelToIssue?: boolean
  attachPdfToIssue?: boolean
}

type JiraIssueAttachmentFile = {
  filename: string
  mimeType: string
  content: Buffer
}

function sanitizeFilenamePart(value: string) {
  const normalized = String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized || 'umfrage'
}

function formatJiraAttachmentTimestamp(date: Date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${y}${m}${d}_${hh}${mm}`
}

function buildJiraAttachmentBaseName(submission: JiraSubmissionSnapshot) {
  const objectPart = submission.object
    ? sanitizeFilenamePart(submission.object.externalId || submission.object.id)
    : null
  const titlePart = sanitizeFilenamePart(submission.questionnaire.title)
  const ts = formatJiraAttachmentTimestamp(submission.submittedAt)
  return [titlePart, objectPart, ts].filter(Boolean).join('_').slice(0, 120)
}

async function buildJiraExcelAttachment(submission: JiraSubmissionSnapshot): Promise<JiraIssueAttachmentFile> {
  const rows = await buildJiraAnswerRows(submission.questionnaire.sections, submission.answers)
  const sheetRows: Array<Record<string, string>> = rows.map((row) => ({
    Segment: row.sectionTitle,
    Frage: row.questionTitle,
    Antwort: row.answerLabel,
    Begruendung: row.reason === '-' ? '' : row.reason,
  }))
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(sheetRows.length > 0 ? sheetRows : [{ Segment: '', Frage: '', Antwort: '', Begruendung: '' }])
  XLSX.utils.book_append_sheet(wb, ws, 'Ergebnisse')
  const content = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  return {
    filename: `${buildJiraAttachmentBaseName(submission)}.xlsx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    content,
  }
}

async function buildJiraPdfAttachment(submission: JiraSubmissionSnapshot): Promise<JiraIssueAttachmentFile> {
  const rows = await buildJiraAnswerRows(submission.questionnaire.sections, submission.answers)
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 40
  const maxWidth = pageWidth - margin * 2
  let y = margin

  const writeLine = (text: string, isHeader = false) => {
    doc.setFont('helvetica', isHeader ? 'bold' : 'normal')
    doc.setFontSize(isHeader ? 12 : 10)
    const parts = doc.splitTextToSize(text, maxWidth) as string[]
    parts.forEach((part) => {
      if (y > pageHeight - margin) {
        doc.addPage()
        y = margin
      }
      doc.text(part, margin, y)
      y += isHeader ? 16 : 13
    })
  }

  writeLine('Umfrageergebnis', true)
  writeLine(`Fragebogen: ${submission.questionnaire.title}`)
  writeLine(`Version: ${submission.questionnaire.version}`)
  writeLine(`Eingereicht am: ${submission.submittedAt.toLocaleString('de-DE')}`)
  writeLine(`Benutzer: ${submission.user?.email || '-'}`)
  writeLine(`UserID: ${submission.user?.externalId || submission.user?.id || '-'}`)
  if (submission.object) {
    writeLine(
      `Objekt: ${submission.object.externalId || submission.object.id}${submission.object.name ? ` - ${submission.object.name}` : ''}`
    )
  }
  y += 8

  let currentSection = ''
  rows.forEach((row) => {
    if (row.sectionTitle !== currentSection) {
      currentSection = row.sectionTitle
      y += 6
      writeLine(`Segment: ${currentSection}`, true)
    }
    writeLine(`Frage: ${row.questionTitle}`)
    writeLine(`Antwort: ${row.answerLabel}`)
    if (row.reason !== '-') {
      writeLine(`Begruendung: ${row.reason}`)
    }
    y += 4
  })

  const buffer = Buffer.from(doc.output('arraybuffer'))
  return {
    filename: `${buildJiraAttachmentBaseName(submission)}.pdf`,
    mimeType: 'application/pdf',
    content: buffer,
  }
}

async function uploadJiraIssueAttachment(issueKey: string, file: JiraIssueAttachmentFile) {
  const issueBase = getJiraIssueApiBaseUrl()
  if (!issueBase) return
  const endpoint = `${issueBase}/${encodeURIComponent(issueKey)}/attachments`
  const form = new FormData()
  const blob = new Blob([file.content], { type: file.mimeType })
  form.append('file', blob, file.filename)
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: JIRA_BASIC_AUTH,
      Accept: 'application/json',
      'X-Atlassian-Token': 'no-check',
    },
    body: form,
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`JIRA_ATTACHMENT_FAILED:${response.status}:${text.slice(0, 800)}`)
  }
}

function buildDefaultJiraSummary(input: {
  questionnaireTitle: string
  submittedAt: Date
  userEmail?: string | null
}) {
  return `${input.questionnaireTitle} - ${input.submittedAt.toLocaleString('de-DE')} - ${input.userEmail ?? 'ohne Benutzer'}`
}

function applySummaryTemplate(template: string, context: Record<string, string>) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    return context[key] ?? ''
  })
}

function findQuestionByIdInSections(sections: any[], questionId: string) {
  for (const section of sections) {
    const questions = Array.isArray(section?.questions) ? section.questions : []
    for (const question of questions) {
      if (String(question?.id ?? '') === questionId) return question
    }
  }
  return null
}

async function loadSubmissionForJira(submissionId: string): Promise<JiraSubmissionSnapshot | null> {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: {
      user: { select: { id: true, email: true, externalId: true } },
      questionnaire: { select: { id: true, title: true, sections: true, version: true } },
      objectTask: {
        include: {
          object: { select: { id: true, externalId: true, name: true } },
        },
      },
    },
  })
  if (!submission) return null
  const snapshot = submission.questionnaireSnapshot as
    | { title?: string; sections?: any[]; version?: number }
    | null
  const sections = Array.isArray(snapshot?.sections)
    ? snapshot.sections
    : ((submission.questionnaire.sections as any[]) ?? [])
  const questionnaireTitle = snapshot?.title || submission.questionnaire.title
  const questionnaireVersion =
    snapshot?.version || submission.questionnaireVersion || submission.questionnaire.version || 1
  return {
    id: submission.id,
    questionnaireId: submission.questionnaireId,
    questionnaireVersion: submission.questionnaireVersion ?? null,
    submittedAt: submission.submittedAt,
    answers: submission.answers as Record<string, unknown>,
    user: submission.user
      ? {
          id: submission.user.id,
          email: submission.user.email ?? null,
          externalId: submission.user.externalId ?? null,
        }
      : null,
    object: submission.objectTask?.object
      ? {
          id: submission.objectTask.object.id,
          externalId: submission.objectTask.object.externalId ?? null,
          name: submission.objectTask.object.name ?? null,
        }
      : null,
    questionnaire: {
      id: submission.questionnaire.id,
      title: questionnaireTitle,
      version: questionnaireVersion,
      sections,
    },
  }
}

async function resolveJiraSummaryFromConfig(
  config: QuestionnaireJiraConfig,
  submission: JiraSubmissionSnapshot
) {
  const fallbackBase = buildDefaultJiraSummary({
    questionnaireTitle: submission.questionnaire.title,
    submittedAt: submission.submittedAt,
    userEmail: submission.user?.email,
  })
  const objectLabel = submission.object
    ? `${submission.object.externalId || submission.object.id}${submission.object.name ? ` - ${submission.object.name}` : ''}`
    : ''
  const withObject = (base: string) =>
    config.includeObjectInSummary && objectLabel ? `${base} | Objekt: ${objectLabel}` : base

  if (config.summaryQuestionId) {
    const question = findQuestionByIdInSections(
      submission.questionnaire.sections,
      config.summaryQuestionId
    )
    if (question) {
      const objectPickerLabels = await resolveObjectPickerLabelMapForJira(
        submission.questionnaire.sections,
        submission.answers
      )
      const answer = answerLabelForJira(
        question,
        submission.answers?.[config.summaryQuestionId],
        objectPickerLabels
      ).trim()
      if (answer && answer !== '-') {
        const prefix = (config.summaryPrefix ?? '').trim()
        const suffix = (config.summarySuffix ?? '').trim()
        const custom = [prefix || null, answer, suffix || null].filter(Boolean).join(' ')
        if (custom) return withObject(custom)
      }
    }
  }

  if (!config.summaryTemplate) return withObject(fallbackBase)
  const rendered = applySummaryTemplate(config.summaryTemplate, {
    questionnaireTitle: submission.questionnaire.title,
    questionnaireId: submission.questionnaire.id,
    questionnaireVersion: String(submission.questionnaire.version),
    submittedAt: submission.submittedAt.toLocaleString('de-DE'),
    submissionId: submission.id,
    userEmail: submission.user?.email ?? '',
    userExternalId: submission.user?.externalId ?? '',
    objectId: submission.object?.externalId || submission.object?.id || '',
    objectName: submission.object?.name || '',
  }).trim()
  if (rendered) return withObject(rendered)
  return withObject(fallbackBase)
}

async function mergeJiraIssueInput(
  submission: JiraSubmissionSnapshot,
  config: QuestionnaireJiraConfig,
  overrides: JiraIssueOverrides
) {
  const projectKey =
    normalizeOptionalString(overrides.projectKey) ??
    config.projectKey ??
    normalizeOptionalString(JIRA_DEFAULT_PROJECT_KEY)
  const summary =
    normalizeOptionalString(overrides.summary) ??
    await resolveJiraSummaryFromConfig(config, submission)
  const issueType =
    normalizeOptionalString(overrides.issueType) ??
    config.issueType ??
    normalizeOptionalString(JIRA_DEFAULT_ISSUE_TYPE) ??
    'Task'
  const assignee = normalizeOptionalString(overrides.assignee) ?? config.assignee
  const contactPerson = normalizeOptionalString(overrides.contactPerson) ?? config.contactPerson
  const epicName = normalizeOptionalString(overrides.epicName) ?? config.epicName
  const baseComponents =
    (overrides.components && overrides.components.length > 0
      ? normalizeStringArray(overrides.components)
      : config.components) || []
  const objectComponent =
    config.includeObjectAsComponent && submission.object
      ? normalizeOptionalString(
          `${submission.object.externalId || submission.object.id}${
            submission.object.name ? ` - ${submission.object.name}` : ''
          }`
        )
      : null
  const components = Array.from(new Set([...baseComponents, ...(objectComponent ? [objectComponent] : [])]))
  const dueDate = normalizeOptionalString(overrides.dueDate) ?? config.dueDate
  const resolvedContactPerson =
    config.contactPersonMode === 'SUBMITTER_USER_ID'
      ? normalizeOptionalString(
          submission.user?.externalId || submission.user?.id || submission.user?.email
        )
      : contactPerson
  const resolvedAttachExcelToIssue =
    typeof overrides.attachExcelToIssue === 'boolean'
      ? overrides.attachExcelToIssue
      : config.attachExcelToIssue
  const resolvedAttachPdfToIssue =
    typeof overrides.attachPdfToIssue === 'boolean'
      ? overrides.attachPdfToIssue
      : config.attachPdfToIssue

  return {
    projectKey,
    summary,
    issueType,
    assignee,
    contactPerson: resolvedContactPerson,
    epicName,
    components,
    dueDate,
    attachExcelToIssue: resolvedAttachExcelToIssue,
    attachPdfToIssue: resolvedAttachPdfToIssue,
  }
}

async function createJiraIssueFromSubmission(
  submissionId: string,
  overrides: JiraIssueOverrides = {}
): Promise<{
  key: string
  id: string | null
  browseUrl: string | null
  requestPayload: unknown
  attachments: Array<{ filename: string; ok: boolean; error?: string }>
}> {
  if (!JIRA_ISSUE_CREATE_URL || !JIRA_BASIC_AUTH) {
    throw new Error('JIRA_NOT_CONFIGURED')
  }
  const submission = await loadSubmissionForJira(submissionId)
  if (!submission) {
    throw new Error('SUBMISSION_NOT_FOUND')
  }

  const config = await getQuestionnaireJiraConfig(submission.questionnaireId)
  const merged = await mergeJiraIssueInput(submission, config, overrides)
  if (!merged.projectKey) {
    throw new Error('MISSING_PROJECT_KEY')
  }
  if (!merged.summary) {
    throw new Error('MISSING_SUMMARY')
  }

  const description = await resolveJiraDescriptionFromConfig(config, submission)

  const payload = buildJiraIssuePayload({
    projectKey: merged.projectKey,
    summary: merged.summary,
    description,
    issueType: merged.issueType ?? undefined,
    assignee: merged.assignee ?? undefined,
    contactPerson: merged.contactPerson ?? undefined,
    epicName: merged.epicName ?? undefined,
    components: merged.components,
    dueDate: merged.dueDate ?? undefined,
  })

  const response = await fetch(JIRA_ISSUE_CREATE_URL, {
    method: 'POST',
    headers: {
      Authorization: JIRA_BASIC_AUTH,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`JIRA_CREATE_FAILED:${response.status}:${text.slice(0, 1000)}`)
  }
  const data = JSON.parse(text)
  const key = data?.key ? String(data.key) : ''
  const attachments: Array<{ filename: string; ok: boolean; error?: string }> = []
  if (key) {
    const files: JiraIssueAttachmentFile[] = []
    if (merged.attachExcelToIssue) files.push(await buildJiraExcelAttachment(submission))
    if (merged.attachPdfToIssue) files.push(await buildJiraPdfAttachment(submission))
    for (const file of files) {
      try {
        await uploadJiraIssueAttachment(key, file)
        attachments.push({ filename: file.filename, ok: true })
      } catch (err) {
        attachments.push({ filename: file.filename, ok: false, error: String(err) })
      }
    }
    await storeSubmissionJiraIssue(submissionId, {
      key,
      id: data?.id ? String(data.id) : null,
      browseUrl: key && JIRA_ISSUE_BROWSE_URL ? `${JIRA_ISSUE_BROWSE_URL}${key}` : null,
    })
  }
  return {
    key,
    id: data?.id ?? null,
    browseUrl: key && JIRA_ISSUE_BROWSE_URL ? `${JIRA_ISSUE_BROWSE_URL}${key}` : null,
    requestPayload: payload,
    attachments,
  }
}

async function tryAutoCreateJiraIssueForSubmission(submissionId: string): Promise<SubmissionJiraIssueLink | null> {
  try {
    const submission = await loadSubmissionForJira(submissionId)
    if (!submission) return null
    const config = await getQuestionnaireJiraConfig(submission.questionnaireId)
    if (!config.autoCreateOnSubmission) return null
    if (!JIRA_ISSUE_CREATE_URL || !JIRA_BASIC_AUTH) return null
    const created = await createJiraIssueFromSubmission(submissionId)
    if (!created.key) return null
    return {
      submissionId,
      issueKey: created.key,
      issueId: created.id,
      browseUrl: created.browseUrl,
      createdAt: new Date().toISOString(),
    }
  } catch (err) {
    console.error(`Automatic Jira ticket creation failed for submission ${submissionId}:`, err)
    return null
  }
}

async function ensureGroupObjectSetup(
  groupId: string,
  objectGroupIds: string[],
  questionnaireFilter?: string[]
) {
  if (objectGroupIds.length === 0) return
  const questionnaires = await prisma.groupQuestionnaire.findMany({
    where: {
      groupId,
      ...(questionnaireFilter?.length ? { questionnaireId: { in: questionnaireFilter } } : {}),
    },
  })
  if (questionnaires.length === 0) return

  const memberships = await prisma.objectGroupMembership.findMany({
    where: { groupId: { in: objectGroupIds } },
  })
  const objectIds = Array.from(new Set(memberships.map((m) => m.objectId)))
  if (objectIds.length === 0) return

  for (const objectId of objectIds) {
    const role = await prisma.roleDefinition.upsert({
      where: { name: GROUP_ROLE_NAME },
      update: {},
      create: { name: GROUP_ROLE_NAME },
    })
    const existingAssignment = await prisma.objectRoleAssignment.findFirst({
      where: { objectId, roleId: role.id, groupId },
    })
    if (!existingAssignment) {
      await prisma.objectRoleAssignment.create({
        data: { objectId, roleId: role.id, groupId },
      })
    }

    for (const assignment of questionnaires) {
      const existing = await prisma.objectSurveyPolicy.findFirst({
        where: {
          objectId,
          questionnaireId: assignment.questionnaireId,
          createdByGroupId: groupId,
        },
      })
      if (existing) {
        await prisma.objectSurveyPolicy.update({
          where: { id: existing.id },
          data: {
            frequency: assignment.frequency,
            intervalDays: assignment.intervalDays ?? null,
            roleIds: [role.id],
            activeFrom: assignment.activeFrom ?? null,
            activeTo: assignment.activeTo ?? null,
          },
        })
      } else {
        await prisma.objectSurveyPolicy.create({
          data: {
            objectId,
            questionnaireId: assignment.questionnaireId,
            frequency: assignment.frequency,
            intervalDays: assignment.intervalDays ?? null,
            roleIds: [role.id],
            activeFrom: assignment.activeFrom ?? null,
            activeTo: assignment.activeTo ?? null,
            createdByGroupId: groupId,
          },
        })
      }
    }
  }
}

async function cleanupGroupAssignments(
  groupId: string,
  objectGroupIds: string[],
  questionnaireFilter?: string[]
) {
  if (objectGroupIds.length === 0) return
  const memberships = await prisma.objectGroupMembership.findMany({
    where: { groupId: { in: objectGroupIds } },
  })
  const objectIds = Array.from(new Set(memberships.map((m) => m.objectId)))
  if (objectIds.length === 0) return
  const role = await prisma.roleDefinition.findUnique({ where: { name: GROUP_ROLE_NAME } })
  if (!role) return
  await prisma.objectRoleAssignment.deleteMany({
    where: { groupId, roleId: role.id, objectId: { in: objectIds } },
  })
  const policyWhere =
    questionnaireFilter && questionnaireFilter.length > 0
      ? { objectId: { in: objectIds }, createdByGroupId: groupId, questionnaireId: { in: questionnaireFilter } }
      : { objectId: { in: objectIds }, createdByGroupId: groupId }

  const policies = await prisma.objectSurveyPolicy.findMany({
    where: policyWhere,
    select: { id: true },
  })
  const policyIds = policies.map((p) => p.id)
  if (policyIds.length > 0) {
    await prisma.objectSurveyTask.deleteMany({ where: { policyId: { in: policyIds } } })
    await prisma.objectSurveyPolicy.deleteMany({ where: { id: { in: policyIds } } })
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string }
  if (!email || !password) {
    res.status(400).json({ error: 'MISSING_CREDENTIALS' })
    return
  }

  const identifier = email.trim()
  const normalizedIdentifier = identifier.toLowerCase()
  const allowLocalAuth = AUTH_MODE === 'local' || AUTH_MODE === 'both'
  const allowLdapAuth = AUTH_MODE === 'ldap' || AUTH_MODE === 'both'

  if (allowLocalAuth) {
    const localUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email: identifier },
          { email: normalizedIdentifier },
          { externalId: identifier },
          { externalId: normalizedIdentifier },
        ],
      },
    })

    if (localUser) {
      const ok = await bcrypt.compare(password, localUser.passwordHash)
      if (ok) {
        const authenticatedUser = await prisma.user.update({
          where: { id: localUser.id },
          data: { lastLoginAt: new Date() },
        })
        const token = signToken(
          { id: authenticatedUser.id, email: authenticatedUser.email, role: authenticatedUser.role },
          JWT_SECRET
        )
        setAuthCookie(res, token)
        res.json({
          id: authenticatedUser.id,
          email: authenticatedUser.email,
          displayName: authenticatedUser.displayName,
          role: authenticatedUser.role,
        })
        return
      }
      res.status(401).json({ error: 'INVALID_CREDENTIALS' })
      return
    }

    if (!allowLdapAuth) {
      res.status(401).json({ error: 'INVALID_CREDENTIALS' })
      return
    }
  }

  if (!allowLdapAuth) {
    res.status(401).json({ error: 'INVALID_CREDENTIALS' })
    return
  }

  const ldapIdentifier =
    identifier.includes('@') && process.env.LDAP_ALLOW_UPN === 'true'
      ? identifier
      : identifier.split('@')[0]
  const normalizedLdapExternalId = ldapIdentifier.trim().toUpperCase()

  const ldapUser = await ldapAuthenticate(normalizedLdapExternalId, password)
  if (!ldapUser) {
    res.status(401).json({ error: 'INVALID_CREDENTIALS' })
    return
  }

  const mappedEmail =
    ldapUser.email ??
    (identifier.includes('@') ? identifier : `${normalizedLdapExternalId}@ldap.local`)

  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [
        { email: mappedEmail },
        { externalId: { equals: normalizedLdapExternalId, mode: 'insensitive' } },
      ],
    },
  })

  let authenticatedUser = existingUser
  if (existingUser) {
    // Preserve manually assigned role for existing users.
    const updateData: { email?: string; externalId?: string; displayName?: string; lastLoginAt?: Date } = {
      lastLoginAt: new Date(),
    }
    if (!existingUser.externalId) {
      updateData.externalId = normalizedLdapExternalId
    } else if (existingUser.externalId !== normalizedLdapExternalId) {
      const externalIdOwner = await prisma.user.findUnique({
        where: { externalId: normalizedLdapExternalId },
        select: { id: true },
      })
      if (!externalIdOwner || externalIdOwner.id === existingUser.id) {
        updateData.externalId = normalizedLdapExternalId
      }
    }
    if (existingUser.email !== mappedEmail) {
      const emailOwner = await prisma.user.findUnique({ where: { email: mappedEmail } })
      if (!emailOwner || emailOwner.id === existingUser.id) {
        updateData.email = mappedEmail
      }
    }
    if (ldapUser.displayName && ldapUser.displayName !== existingUser.displayName) {
      updateData.displayName = ldapUser.displayName
    }
    if (Object.keys(updateData).length > 0) {
      authenticatedUser = await prisma.user.update({
        where: { id: existingUser.id },
        data: updateData,
      })
    }
  } else {
    const role = resolveRoleFromGroups(ldapUser.groups)
    authenticatedUser = await prisma.user.create({
      data: {
        email: mappedEmail,
        passwordHash: await bcrypt.hash(crypto.randomUUID(), 10),
        role,
        externalId: normalizedLdapExternalId,
        displayName: ldapUser.displayName ?? null,
        imported: false,
        lastLoginAt: new Date(),
      },
    })
  }

  const token = signToken(
    { id: authenticatedUser.id, email: authenticatedUser.email, role: authenticatedUser.role },
    JWT_SECRET
  )
  setAuthCookie(res, token)
  res.json({
    id: authenticatedUser.id,
    email: authenticatedUser.email,
    displayName: authenticatedUser.displayName,
    role: authenticatedUser.role,
  })
})

function resolveRoleFromGroups(groups: string[]) {
  const mappingRaw = process.env.LDAP_ROLE_MAP
  if (!mappingRaw) return 'VIEWER' as const
  const map: Record<string, 'ADMIN' | 'EDITOR' | 'VIEWER'> = {}
  mappingRaw.split(',').forEach((entry) => {
    const [group, role] = entry.split(':').map((v) => v.trim())
    if (!group || !role) return
    const normalizedRole = role.toUpperCase()
    if (normalizedRole === 'ADMIN' || normalizedRole === 'EDITOR' || normalizedRole === 'VIEWER') {
      map[group] = normalizedRole
    }
  })
  if (groups.some((g) => map[g] === 'ADMIN')) return 'ADMIN' as const
  if (groups.some((g) => map[g] === 'EDITOR')) return 'EDITOR' as const
  return 'VIEWER' as const
}

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

function resolveMatchingPolicyRoles(
  policyRoleIdsRaw: unknown,
  assignedRoleIds: Set<string>
): string[] {
  const explicitRoleIds = Array.isArray(policyRoleIdsRaw)
    ? (policyRoleIdsRaw as string[]).filter(Boolean)
    : []
  if (explicitRoleIds.length === 0) {
    return Array.from(assignedRoleIds)
  }
  return explicitRoleIds.filter((rid) => assignedRoleIds.has(rid))
}

function hasPolicyRoleAccess(policyRoleIdsRaw: unknown, assignedRoleIds: Set<string>): boolean {
  return resolveMatchingPolicyRoles(policyRoleIdsRaw, assignedRoleIds).length > 0
}

function calcRecurringNextDue(
  activeFrom: Date | null | undefined,
  intervalDays: number,
  now: Date,
  lastCompletedAt?: Date | null
) {
  const anchor = activeFrom ?? now
  if (!lastCompletedAt) return anchor
  if (intervalDays <= 0) return anchor
  const intervalMs = intervalDays * 24 * 60 * 60 * 1000
  const elapsedMs = lastCompletedAt.getTime() - anchor.getTime()
  if (elapsedMs < 0) return anchor
  const cycles = Math.floor(elapsedMs / intervalMs) + 1
  return new Date(anchor.getTime() + cycles * intervalMs)
}

async function cleanupStaleOverridePolicies(apply: boolean) {
  const overridePolicies = await prisma.objectSurveyPolicy.findMany({
    where: { createdByObjectGroupId: { startsWith: 'override:' } },
    select: { id: true, createdByObjectGroupId: true },
  })

  const parsed = overridePolicies.map((policy) => {
    const marker = policy.createdByObjectGroupId ?? ''
    const overrideId = marker.startsWith('override:') ? marker.slice('override:'.length) : ''
    return { policyId: policy.id, overrideId }
  })

  const overrideIds = Array.from(new Set(parsed.map((p) => p.overrideId).filter(Boolean)))
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
  const staleTaskCount = stalePolicyIds.length
    ? await prisma.objectSurveyTask.count({ where: { policyId: { in: stalePolicyIds } } })
    : 0

  if (apply && stalePolicyIds.length > 0) {
    await prisma.$transaction(async (tx) => {
      await tx.objectSurveyTask.deleteMany({ where: { policyId: { in: stalePolicyIds } } })
      await tx.objectSurveyPolicy.deleteMany({ where: { id: { in: stalePolicyIds } } })
    })
  }

  return {
    stalePolicyCount: stalePolicyIds.length,
    staleTaskCount,
    policyIds: stalePolicyIds,
    mode: apply ? 'apply' : 'dry-run',
  }
}

async function getUserRoleAssignments(userId: string) {
  const memberships = await prisma.groupMember.findMany({ where: { userId } })
  const userGroupIds = memberships.map((m) => m.groupId)

  const assignments = await prisma.objectRoleAssignment.findMany({
    where: {
      OR: [{ userId }, { groupId: { in: userGroupIds } }],
    },
  })

  const rolesByObject = new Map<string, Set<string>>()
  assignments.forEach((a) => {
    const set = rolesByObject.get(a.objectId) ?? new Set<string>()
    set.add(a.roleId)
    rolesByObject.set(a.objectId, set)
  })

  const objectIds = Array.from(new Set(assignments.map((a) => a.objectId)))

  return { userGroupIds, rolesByObject, objectIds }
}

async function getVisibleObjectIdsForUser(user: { id: string; role: Role }) {
  if (user.role === 'ADMIN') return null as string[] | null

  const userGroupIds = await getUserGroupIds(user.id)
  const { objectIds: assignedObjectIds } = await getUserRoleAssignments(user.id)

  // Gleiche Sichtbarkeitslogik wie in der Objekt-Adminliste:
  // Owner/Importer/adminGroupIds ODER gleiche Creator-Gruppe (Fallback).
  const list = await prisma.objectEntity.findMany({
    select: {
      id: true,
      createdByUserId: true,
      importedByUserId: true,
      adminGroupIds: true,
    },
  })
  const creatorIds = Array.from(
    new Set(list.map((o) => o.createdByUserId).filter((id): id is string => Boolean(id)))
  )
  const creatorMemberships =
    creatorIds.length > 0
      ? await prisma.groupMember.findMany({
          where: { userId: { in: creatorIds } },
          select: { userId: true, groupId: true },
        })
      : []
  const creatorGroupMap = new Map<string, string[]>()
  for (const m of creatorMemberships) {
    const current = creatorGroupMap.get(m.userId) ?? []
    current.push(m.groupId)
    creatorGroupMap.set(m.userId, current)
  }
  const manageable = list
    .filter((obj) =>
      canManageObjectByScope({
        userId: user.id,
        userRole: user.role,
        userGroupIds,
        object: {
          ...obj,
          creatorGroupIds: obj.createdByUserId ? (creatorGroupMap.get(obj.createdByUserId) ?? []) : [],
        },
      })
    )
    .map((obj) => obj.id)

  const visible = new Set<string>([...assignedObjectIds, ...manageable])
  return Array.from(visible)
}

async function ensureTasksForObject(objectId: string) {
  const [directPolicies, membershipsAll, overrides, assignments] = await Promise.all([
    prisma.objectSurveyPolicy.findMany({
      where: { objectId, createdByObjectGroupId: null },
    }),
    prisma.objectGroupMembership.findMany({
      where: { objectId },
      select: { groupId: true },
    }),
    prisma.objectPolicyOverride.findMany({
      where: { objectId },
    }),
    prisma.objectRoleAssignment.findMany({
      where: { objectId },
      select: { roleId: true },
    }),
  ])

  const assignedRoleIds = new Set(assignments.map((a) => a.roleId))
  const objectGroupIds = Array.from(new Set(membershipsAll.map((m) => m.groupId)))
  const groupPolicies =
    objectGroupIds.length > 0
      ? await prisma.objectGroupPolicy.findMany({
          where: { groupId: { in: objectGroupIds } },
        })
      : []

  const now = new Date()
  const groupPrefillMap = await getObjectGroupPolicyPrefillConfigMap(groupPolicies.map((p) => p.id))

  const roleNames = Array.from(
    new Set(
      groupPolicies.flatMap((p) =>
        Array.isArray(p.roleNames)
          ? (p.roleNames as string[]).map((x) => String(x).trim()).filter(Boolean)
          : []
      )
    )
  )
  const roleDefs =
    roleNames.length > 0
      ? await prisma.roleDefinition.findMany({
          where: { name: { in: roleNames } },
          select: { id: true, name: true },
        })
      : []
  const roleIdByName = new Map(roleDefs.map((r) => [r.name.toLowerCase(), r.id]))

  const effectivePolicies: Array<{
    policyId: string
    questionnaireId: string
    frequency: Frequency
    intervalDays: number | null
    activeFrom: Date | null
    activeTo: Date | null
    roleIdsRaw: unknown
  }> = []

  for (const p of directPolicies) {
    effectivePolicies.push({
      policyId: p.id,
      questionnaireId: p.questionnaireId,
      frequency: p.frequency,
      intervalDays: p.intervalDays,
      activeFrom: p.activeFrom,
      activeTo: p.activeTo,
      roleIdsRaw: p.roleIds,
    })
  }

  for (const p of groupPolicies) {
    const roleNamesForPolicy = Array.isArray(p.roleNames)
      ? (p.roleNames as string[]).map((x) => String(x).trim().toLowerCase()).filter(Boolean)
      : []
    const roleIdsForPolicy =
      roleNamesForPolicy.length > 0
        ? roleNamesForPolicy.map((name) => roleIdByName.get(name)).filter((x): x is string => Boolean(x))
        : Array.from(assignedRoleIds)
    if (roleIdsForPolicy.length === 0) continue

    const existing = await prisma.objectSurveyPolicy.findFirst({
      where: {
        objectId,
        questionnaireId: p.questionnaireId,
        createdByObjectGroupId: p.groupId,
      },
    })
    let policyIdForTasks = existing?.id ?? ''
    if (existing) {
      await prisma.objectSurveyPolicy.update({
        where: { id: existing.id },
        data: {
          frequency: p.frequency,
          intervalDays: p.intervalDays ?? null,
          roleIds: roleIdsForPolicy,
          activeFrom: p.activeFrom ?? null,
          activeTo: p.activeTo ?? null,
        },
      })
      policyIdForTasks = existing.id
    } else {
      const created = await prisma.objectSurveyPolicy.create({
        data: {
          objectId,
          questionnaireId: p.questionnaireId,
          frequency: p.frequency,
          intervalDays: p.intervalDays ?? null,
          roleIds: roleIdsForPolicy,
          activeFrom: p.activeFrom ?? null,
          activeTo: p.activeTo ?? null,
          createdByObjectGroupId: p.groupId,
        },
      })
      policyIdForTasks = created.id
    }
    await setObjectPolicyPrefillConfig(policyIdForTasks, groupPrefillMap.get(p.id) ?? false)
    effectivePolicies.push({
      policyId: policyIdForTasks,
      questionnaireId: p.questionnaireId,
      frequency: p.frequency,
      intervalDays: p.intervalDays ?? null,
      activeFrom: p.activeFrom ?? null,
      activeTo: p.activeTo ?? null,
      roleIdsRaw: roleIdsForPolicy,
    })
  }

  for (const p of overrides) {
    const overrideKey = `override:${p.id}`
    const overrideRoleIds = Array.isArray(p.roleIds)
      ? (p.roleIds as string[]).filter(Boolean)
      : []
    const existing = await prisma.objectSurveyPolicy.findFirst({
      where: {
        objectId,
        questionnaireId: p.questionnaireId,
        createdByObjectGroupId: overrideKey,
      },
    })
    let policyIdForTasks = existing?.id ?? ''
    if (existing) {
      await prisma.objectSurveyPolicy.update({
        where: { id: existing.id },
        data: {
          frequency: p.frequency,
          intervalDays: p.intervalDays ?? null,
          roleIds: overrideRoleIds,
          activeFrom: p.activeFrom ?? null,
          activeTo: p.activeTo ?? null,
        },
      })
      policyIdForTasks = existing.id
    } else {
      const created = await prisma.objectSurveyPolicy.create({
        data: {
          objectId,
          questionnaireId: p.questionnaireId,
          frequency: p.frequency,
          intervalDays: p.intervalDays ?? null,
          roleIds: overrideRoleIds,
          activeFrom: p.activeFrom ?? null,
          activeTo: p.activeTo ?? null,
          createdByObjectGroupId: overrideKey,
        },
      })
      policyIdForTasks = created.id
    }
    effectivePolicies.push({
      policyId: policyIdForTasks,
      questionnaireId: p.questionnaireId,
      frequency: p.frequency,
      intervalDays: p.intervalDays ?? null,
      activeFrom: p.activeFrom ?? null,
      activeTo: p.activeTo ?? null,
      roleIdsRaw: overrideRoleIds,
    })
  }

  // Remove derived object policies/tasks that are no longer effective for this object.
  // This prevents stale dashboard counts after group policy/override changes.
  const effectivePolicyIds = new Set(effectivePolicies.map((p) => p.policyId))
  const derivedPolicies = await prisma.objectSurveyPolicy.findMany({
    where: {
      objectId,
      createdByObjectGroupId: { not: null },
    },
    select: { id: true },
  })
  const staleDerivedPolicyIds = derivedPolicies
    .map((p) => p.id)
    .filter((id) => !effectivePolicyIds.has(id))
  if (staleDerivedPolicyIds.length > 0) {
    await prisma.objectSurveyTask.deleteMany({
      where: {
        objectId,
        policyId: { in: staleDerivedPolicyIds },
      },
    })
    await prisma.objectSurveyPolicy.deleteMany({
      where: {
        id: { in: staleDerivedPolicyIds },
      },
    })
  }

  for (const policy of effectivePolicies) {
    const matchingRoles = resolveMatchingPolicyRoles(policy.roleIdsRaw, assignedRoleIds)
    if (matchingRoles.length === 0) continue

    const lastDone = await prisma.objectSurveyTask.findFirst({
      where: {
        policyId: policy.policyId,
        objectId,
        status: 'DONE',
      },
      orderBy: { completedAt: 'desc' },
    })

    const interval = intervalDaysForPolicy(policy.frequency, policy.intervalDays)
    const nextDue =
      policy.frequency === 'ONCE'
        ? (policy.activeFrom ?? now)
        : calcRecurringNextDue(policy.activeFrom ?? null, interval, now, lastDone?.completedAt ?? null)

    if (policy.activeTo && nextDue > policy.activeTo) continue
    if (policy.frequency !== 'ONCE' && lastDone?.completedAt && nextDue > now) continue
    if (policy.frequency === 'ONCE' && lastDone) continue

    const existingOpen = await prisma.objectSurveyTask.findFirst({
      where: {
        policyId: policy.policyId,
        objectId,
        status: 'OPEN',
      },
    })
    if (existingOpen) continue

    try {
      await prisma.objectSurveyTask.create({
        data: {
          policyId: policy.policyId,
          objectId,
          questionnaireId: policy.questionnaireId,
          dueAt: nextDue,
          status: 'OPEN' as TaskStatus,
        },
      })
    } catch (err: any) {
      if (err?.code === 'P2003') continue
      throw err
    }
  }
}

async function canUserAccessQuestionnaireForPicker(
  user: { id: string; role: Role },
  questionnaireId: string
) {
  if (!questionnaireId) return false
  if (user.role === 'ADMIN') return true
  const [questionnaire, userGroupIds] = await Promise.all([
    prisma.questionnaire.findUnique({
      where: { id: questionnaireId },
      select: { id: true, deletedAt: true, globalForAllUsers: true },
    }),
    getUserGroupIds(user.id),
  ])
  if (!questionnaire || questionnaire.deletedAt) return false
  if (questionnaire.globalForAllUsers) return true
  if (userGroupIds.length === 0) return false
  const assignment = await prisma.groupQuestionnaire.findFirst({
    where: { questionnaireId, groupId: { in: userGroupIds } },
    select: { id: true },
  })
  return Boolean(assignment)
}

async function canUserAccessTaskForPicker(user: { id: string; role: Role }, taskId: string) {
  if (!taskId) return false
  if (user.role === 'ADMIN') return true
  const task = await prisma.objectSurveyTask.findUnique({
    where: { id: taskId },
    include: { policy: true },
  })
  if (!task || !task.policy) return false
  const { rolesByObject } = await getUserRoleAssignments(user.id)
  const assignedRoles = rolesByObject.get(task.objectId) ?? new Set<string>()
  return hasPolicyRoleAccess(task.policy.roleIds, assignedRoles)
}

async function ensureTasksForUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) return

  const { userGroupIds, rolesByObject, objectIds } = await getUserRoleAssignments(userId)
  if (objectIds.length === 0) return

  const directPolicies = await prisma.objectSurveyPolicy.findMany({
    where: { objectId: { in: objectIds }, createdByObjectGroupId: null },
  })

  const membershipsAll = await prisma.objectGroupMembership.findMany({
    where: { objectId: { in: objectIds } },
  })
  const objectGroupIds = Array.from(new Set(membershipsAll.map((m) => m.groupId)))
  const groupPolicies = await prisma.objectGroupPolicy.findMany({
    where: { groupId: { in: objectGroupIds } },
  })
  const overrides = await prisma.objectPolicyOverride.findMany({
    where: { objectId: { in: objectIds } },
  })

  const now = new Date()
  const directPrefillMap = await getObjectPolicyPrefillConfigMap(directPolicies.map((p) => p.id))
  const groupPrefillMap = await getObjectGroupPolicyPrefillConfigMap(groupPolicies.map((p) => p.id))

  const effectivePolicies = [
    ...directPolicies.map((p) => ({ ...p, source: 'direct' as const, objectId: p.objectId })),
    ...groupPolicies.flatMap((p) =>
      membershipsAll
        .filter((m) => m.groupId === p.groupId)
        .map((m) => ({ ...p, objectId: m.objectId, source: 'group' as const }))
    ),
    ...overrides.map((p) => ({ ...p, source: 'override' as const, objectId: p.objectId })),
  ].filter((p) => {
    if (p.createdByGroupId && !userGroupIds.includes(p.createdByGroupId)) return false
    return true
  })

  for (const policy of effectivePolicies) {
    const assignedRoleIds = rolesByObject.get(policy.objectId) ?? new Set<string>()
    let policyIdForTasks = policy.id
    let matchingRoles: string[] = []
    let allowLastSubmissionPrefill = false
    if (policy.source === 'group') {
      allowLastSubmissionPrefill = groupPrefillMap.get(policy.id) ?? false
      matchingRoles = await (async () => {
        const roleNames = (policy.roleNames as string[]) ?? []
        let roleIdsForPolicy: string[] = []
        if (roleNames.length > 0) {
          const defs = await prisma.roleDefinition.findMany({
            where: { name: { in: roleNames } },
          })
          roleIdsForPolicy = defs.map((r) => r.id)
        } else {
          const assigned = await prisma.objectRoleAssignment.findMany({
            where: { objectId: policy.objectId },
            select: { roleId: true },
          })
          roleIdsForPolicy = Array.from(new Set(assigned.map((r) => r.roleId)))
        }
        if (roleIdsForPolicy.length === 0) return []

        const existing = await prisma.objectSurveyPolicy.findFirst({
          where: {
            objectId: policy.objectId,
            questionnaireId: policy.questionnaireId,
            createdByObjectGroupId: policy.groupId,
          },
        })
        if (existing) {
          await prisma.objectSurveyPolicy.update({
            where: { id: existing.id },
            data: {
              frequency: policy.frequency,
              intervalDays: policy.intervalDays ?? null,
              roleIds: roleIdsForPolicy,
              activeFrom: policy.activeFrom ?? null,
              activeTo: policy.activeTo ?? null,
            },
          })
          policyIdForTasks = existing.id
        } else {
          const created = await prisma.objectSurveyPolicy.create({
            data: {
              objectId: policy.objectId,
              questionnaireId: policy.questionnaireId,
              frequency: policy.frequency,
              intervalDays: policy.intervalDays ?? null,
              roleIds: roleIdsForPolicy,
              activeFrom: policy.activeFrom ?? null,
              activeTo: policy.activeTo ?? null,
              createdByObjectGroupId: policy.groupId,
            },
          })
          policyIdForTasks = created.id
        }
        await setObjectPolicyPrefillConfig(policyIdForTasks, allowLastSubmissionPrefill)

        return roleIdsForPolicy.filter((id) => assignedRoleIds.has(id))
      })()
    } else if (policy.source === 'override') {
      const roleIdsForPolicy = Array.isArray(policy.roleIds)
        ? (policy.roleIds as string[]).filter(Boolean)
        : []
      const overrideKey = `override:${policy.id}`
      const existing = await prisma.objectSurveyPolicy.findFirst({
        where: {
          objectId: policy.objectId,
          questionnaireId: policy.questionnaireId,
          createdByObjectGroupId: overrideKey,
        },
      })
      if (existing) {
        await prisma.objectSurveyPolicy.update({
          where: { id: existing.id },
          data: {
            frequency: policy.frequency,
            intervalDays: policy.intervalDays ?? null,
            roleIds: roleIdsForPolicy,
            activeFrom: policy.activeFrom ?? null,
            activeTo: policy.activeTo ?? null,
          },
        })
        policyIdForTasks = existing.id
      } else {
        const created = await prisma.objectSurveyPolicy.create({
          data: {
            objectId: policy.objectId,
            questionnaireId: policy.questionnaireId,
            frequency: policy.frequency,
            intervalDays: policy.intervalDays ?? null,
            roleIds: roleIdsForPolicy,
            activeFrom: policy.activeFrom ?? null,
            activeTo: policy.activeTo ?? null,
            createdByObjectGroupId: overrideKey,
          },
        })
        policyIdForTasks = created.id
      }
      matchingRoles = resolveMatchingPolicyRoles(roleIdsForPolicy, assignedRoleIds)
    } else {
      allowLastSubmissionPrefill = directPrefillMap.get(policy.id) ?? false
      matchingRoles = resolveMatchingPolicyRoles(policy.roleIds, assignedRoleIds)
    }
    if (matchingRoles.length === 0) continue

    const lastDone = await prisma.objectSurveyTask.findFirst({
      where: {
        policyId: policyIdForTasks,
        objectId: policy.objectId,
        status: 'DONE',
      },
      orderBy: { completedAt: 'desc' },
    })

    const interval = intervalDaysForPolicy(policy.frequency, policy.intervalDays)
    const nextDue =
      policy.frequency === 'ONCE'
        ? (policy.activeFrom ?? now)
        : calcRecurringNextDue(policy.activeFrom ?? null, interval, now, lastDone?.completedAt ?? null)

    if (policy.activeTo && nextDue > policy.activeTo) continue
    if (policy.frequency !== 'ONCE' && lastDone?.completedAt && nextDue > now) {
      continue
    }
    if (policy.frequency === 'ONCE' && lastDone) {
      continue
    }

    const existingOpen = await prisma.objectSurveyTask.findFirst({
      where: {
        policyId: policyIdForTasks,
        objectId: policy.objectId,
        status: 'OPEN',
      },
    })
    if (existingOpen) continue

    try {
      await prisma.objectSurveyTask.create({
        data: {
          policyId: policyIdForTasks,
          objectId: policy.objectId,
          questionnaireId: policy.questionnaireId,
          dueAt: nextDue,
          status: 'OPEN' as TaskStatus,
        },
      })
    } catch (err: any) {
      if (err?.code === 'P2003') {
        continue
      }
      throw err
    }
  }
}

app.get('/api/auth/google-client-id', (_req, res) => {
  res.json({ clientId: GOOGLE_CLIENT_ID || null, registrationEnabled: ALLOW_REGISTRATION })
})

app.post('/api/auth/register', async (req, res) => {
  if (!ALLOW_REGISTRATION) {
    res.status(403).json({ error: 'REGISTRATION_DISABLED' })
    return
  }
  const { email, password, displayName } = req.body as {
    email?: string
    password?: string
    displayName?: string
  }
  if (!email || !password) {
    res.status(400).json({ error: 'MISSING_FIELDS' })
    return
  }
  const trimmedEmail = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    res.status(400).json({ error: 'INVALID_EMAIL' })
    return
  }
  if (password.length < 6) {
    res.status(400).json({ error: 'PASSWORD_TOO_SHORT' })
    return
  }
  const existing = await prisma.user.findUnique({ where: { email: trimmedEmail } })
  if (existing) {
    res.status(409).json({ error: 'EMAIL_ALREADY_EXISTS' })
    return
  }
  try {
    const passwordHash = await bcrypt.hash(password, 10)
    const user = await prisma.user.create({
      data: {
        email: trimmedEmail,
        passwordHash,
        provider: 'local',
        displayName: displayName?.trim() || null,
        role: 'VIEWER',
      },
    })
    const token = signToken({ id: user.id, email: user.email, role: user.role }, JWT_SECRET)
    setAuthCookie(res, token)
    res.json({ id: user.id, email: user.email, displayName: user.displayName, role: user.role })
  } catch {
    res.status(500).json({ error: 'REGISTRATION_FAILED' })
  }
})

app.post('/api/auth/google', async (req, res) => {
  if (!googleOAuthClient || !GOOGLE_CLIENT_ID) {
    res.status(400).json({ error: 'GOOGLE_AUTH_NOT_CONFIGURED' })
    return
  }
  const { credential } = req.body as { credential?: string }
  if (!credential) {
    res.status(400).json({ error: 'MISSING_CREDENTIAL' })
    return
  }
  try {
    const ticket = await googleOAuthClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    })
    const payload = ticket.getPayload()
    if (!payload || !payload.email) {
      res.status(400).json({ error: 'INVALID_GOOGLE_TOKEN' })
      return
    }
    const googleId = payload.sub
    const googleEmail = payload.email.toLowerCase()
    const googleName = payload.name || null

    let user = await prisma.user.findFirst({
      where: { OR: [{ googleId }, { email: googleEmail }] },
    })

    if (user) {
      if (!user.googleId) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { googleId, provider: user.provider === 'local' ? 'both' : user.provider, lastLoginAt: new Date() },
        })
      } else {
        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
      }
    } else {
      if (!ALLOW_REGISTRATION) {
        res.status(403).json({ error: 'REGISTRATION_DISABLED' })
        return
      }
      const randomHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10)
      user = await prisma.user.create({
        data: {
          email: googleEmail,
          passwordHash: randomHash,
          provider: 'google',
          googleId,
          displayName: googleName,
          role: 'VIEWER',
        },
      })
    }

    const token = signToken({ id: user.id, email: user.email, role: user.role }, JWT_SECRET)
    setAuthCookie(res, token)
    res.json({ id: user.id, email: user.email, displayName: user.displayName, role: user.role })
  } catch {
    res.status(401).json({ error: 'GOOGLE_AUTH_FAILED' })
  }
})

app.post('/api/auth/logout', (_req, res) => {
  clearAuthCookie(res)
  res.json({ ok: true })
})

app.get('/api/auth/me', async (req, res) => {
  const user = getAuthUser(req, JWT_SECRET)
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const fullUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      externalId: true,
      imported: true,
      lastLoginAt: true,
    },
  })
  if (!fullUser) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  res.json(fullUser)
})

app.get('/api/me/home-config', authMiddleware, async (req, res) => {
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const config = await getHomePageConfig()
  res.json(config)
})

app.get('/api/public/login-config', async (_req, res) => {
  const config = await getLoginPageConfig()
  res.json(config)
})

app.get('/api/public/home-config', async (_req, res) => {
  const config = await getHomePageConfig()
  res.json(config)
})

app.get('/api/admin/home-config', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (_req, res) => {
  const config = await getHomePageConfig()
  res.json(config)
})

app.put('/api/admin/home-config', authMiddleware, requireRole(['ADMIN']), async (req, res) => {
  const body = req.body as Partial<HomePageConfig>
  const saved = await saveHomePageConfig(body)
  res.json(saved)
})

app.get('/api/admin/login-config', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (_req, res) => {
  const config = await getLoginPageConfig()
  res.json(config)
})

app.put('/api/admin/login-config', authMiddleware, requireRole(['ADMIN']), async (req, res) => {
  const body = req.body as Partial<LoginPageConfig>
  const saved = await saveLoginPageConfig(body)
  res.json(saved)
})

app.get('/api/users', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'desc' } })
  let visible = users
  if (user.role !== 'ADMIN') {
    const userGroupIds = await getUserGroupIds(user.id)
    const groupMembers = await prisma.groupMember.findMany({
      where: { groupId: { in: userGroupIds } },
      select: { userId: true },
    })
    const sharedUserIds = new Set(groupMembers.map((m) => m.userId))
    visible = users.filter((u) => {
      if (u.role === 'ADMIN') return false
      return (
        u.id === user.id ||
        u.createdByUserId === user.id ||
        u.importedByUserId === user.id ||
        sharedUserIds.has(u.id)
      )
    })
  }
  res.json(
    visible.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      role: u.role,
      externalId: u.externalId,
      createdAt: u.createdAt,
      imported: u.imported,
      lastLoginAt: u.lastLoginAt,
    }))
  )
})

app.get('/api/users/:id/submissions', authMiddleware, requireRole(['ADMIN']), async (req, res) => {
  const { id } = req.params
  const submissions = await prisma.submission.findMany({
    where: { userId: id },
    include: { user: { select: { id: true, email: true, externalId: true } } },
    orderBy: { submittedAt: 'desc' },
  })
  const completionMap = await getQuestionnaireCompletionConfigMap(
    Array.from(new Set(submissions.map((entry) => entry.questionnaireId)))
  )
  const jiraMap = await getLatestSubmissionJiraIssueMap(submissions.map((entry) => entry.id))
  res.json(
    submissions.map((entry) => ({
      ...entry,
      questionnaire: entry.questionnaire
        ? {
            ...entry.questionnaire,
            showJiraTicketLinkInHistory:
              completionMap.get(entry.questionnaireId)?.showJiraTicketLink ?? false,
            showReadonlyResultLinkInHistory:
              completionMap.get(entry.questionnaireId)?.showReadonlyResultLink ?? false,
            allowReadonlyResultLinkForAllUsers:
              completionMap.get(entry.questionnaireId)?.allowReadonlyResultLinkForAllUsers ?? false,
          }
        : null,
      jiraIssue: jiraMap.get(entry.id) ?? null,
    }))
  )
})

app.get('/api/users/:id/assignment-overview', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const actor = req.user
  if (!actor) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const { id } = req.params
  const target = await prisma.user.findUnique({ where: { id } })
  if (!target) {
    res.status(404).json({ error: 'NOT_FOUND' })
    return
  }

  if (actor.role !== 'ADMIN') {
    if (target.role === 'ADMIN') {
      res.status(403).json({ error: 'FORBIDDEN' })
      return
    }
    const actorGroupIds = await getUserGroupIds(actor.id)
    const groupMembers = await prisma.groupMember.findMany({
      where: { groupId: { in: actorGroupIds } },
      select: { userId: true },
    })
    const sharedUserIds = new Set(groupMembers.map((m) => m.userId))
    const canViewTarget =
      target.id === actor.id ||
      target.createdByUserId === actor.id ||
      target.importedByUserId === actor.id ||
      sharedUserIds.has(target.id)
    if (!canViewTarget) {
      res.status(403).json({ error: 'FORBIDDEN' })
      return
    }
  }

  await ensureTasksForUser(id)
  const { userGroupIds, rolesByObject, objectIds } = await getUserRoleAssignments(id)

  const [directAssignments, groupAssignments, objects, policies, groupQuestionnaires, submissions] = await Promise.all([
    prisma.objectRoleAssignment.findMany({
      where: { userId: id },
      include: { object: { select: { id: true, name: true } }, role: { select: { id: true, name: true } } },
    }),
    userGroupIds.length > 0
      ? prisma.objectRoleAssignment.findMany({
          where: { groupId: { in: userGroupIds } },
          include: {
            object: { select: { id: true, name: true } },
            role: { select: { id: true, name: true } },
            group: { select: { id: true, name: true } },
          },
        })
      : Promise.resolve([]),
    objectIds.length > 0
      ? prisma.objectEntity.findMany({ where: { id: { in: objectIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    objectIds.length > 0
      ? prisma.objectSurveyPolicy.findMany({
          where: { objectId: { in: objectIds } },
          include: { questionnaire: { select: { id: true, title: true, status: true, activeFrom: true, activeTo: true, allowMultipleSubmissions: true } } },
        })
      : Promise.resolve([]),
    userGroupIds.length > 0
      ? prisma.groupQuestionnaire.findMany({
          where: { groupId: { in: userGroupIds } },
          include: {
            group: { select: { id: true, name: true } },
            questionnaire: { select: { id: true, title: true, status: true, activeFrom: true, activeTo: true, allowMultipleSubmissions: true } },
          },
        })
      : Promise.resolve([]),
    prisma.submission.findMany({
      where: { userId: id },
      select: { questionnaireId: true },
    }),
  ])

  const roleRows = [
    ...directAssignments.map((a) => ({
      id: `direct:${a.id}`,
      objectId: a.object.id,
      objectName: a.object.name,
      roleName: a.role.name,
      via: 'DIRECT' as const,
      groupName: null as string | null,
    })),
    ...groupAssignments.map((a) => ({
      id: `group:${a.id}`,
      objectId: a.object.id,
      objectName: a.object.name,
      roleName: a.role.name,
      via: 'GROUP' as const,
      groupName: a.group?.name ?? null,
    })),
  ]

  const submissionCountByQuestionnaire = new Map<string, number>()
  for (const s of submissions) {
    submissionCountByQuestionnaire.set(
      s.questionnaireId,
      (submissionCountByQuestionnaire.get(s.questionnaireId) ?? 0) + 1
    )
  }

  const roleIdsForPolicies = Array.from(new Set(policies.flatMap((p) => ((p.roleIds as string[]) ?? []).filter(Boolean))))
  const roleDefs = roleIdsForPolicies.length > 0
    ? await prisma.roleDefinition.findMany({ where: { id: { in: roleIdsForPolicies } }, select: { id: true, name: true } })
    : []
  const roleNameById = new Map(roleDefs.map((r) => [r.id, r.name]))

  const policyIds = policies.map((p) => p.id)
  const tasks = policyIds.length > 0
    ? await prisma.objectSurveyTask.findMany({
        where: { policyId: { in: policyIds } },
        select: { policyId: true, status: true },
      })
    : []
  const taskStats = new Map<string, { open: number; done: number }>()
  for (const t of tasks) {
    const current = taskStats.get(t.policyId) ?? { open: 0, done: 0 }
    if (t.status === 'OPEN') current.open += 1
    else current.done += 1
    taskStats.set(t.policyId, current)
  }

  const objectNameById = new Map(objects.map((o) => [o.id, o.name]))
  const objectGroupIds = Array.from(new Set(policies.map((p) => p.createdByObjectGroupId).filter((x): x is string => !!x && !x.startsWith('override:'))))
  const objectGroups = objectGroupIds.length > 0
    ? await prisma.objectGroup.findMany({ where: { id: { in: objectGroupIds } }, select: { id: true, name: true } })
    : []
  const objectGroupNameById = new Map(objectGroups.map((g) => [g.id, g.name]))

  const objectSurveyRows = policies
    .map((p) => {
      const assignedRoleIds = rolesByObject.get(p.objectId) ?? new Set<string>()
      const policyRoleIds = resolveMatchingPolicyRoles(p.roleIds, assignedRoleIds)
      if (policyRoleIds.length === 0) return null
      const roleNames = policyRoleIds.map((rid) => roleNameById.get(rid) ?? rid)
      const stats = taskStats.get(p.id) ?? { open: 0, done: 0 }
      const source =
        !p.createdByObjectGroupId
          ? 'OBJECT'
          : p.createdByObjectGroupId.startsWith('override:')
            ? 'OBJECT_OVERRIDE'
            : 'OBJECT_GROUP'
      const surveyName =
        source === 'OBJECT'
          ? 'Objekt'
          : source === 'OBJECT_GROUP'
            ? `Objektgruppe: ${objectGroupNameById.get(p.createdByObjectGroupId || '') ?? p.createdByObjectGroupId}`
            : 'Objekt-Override'
      return {
        id: `object:${p.id}`,
        source,
        objectId: p.objectId,
        objectName: objectNameById.get(p.objectId) ?? p.objectId,
        surveyName,
        questionnaireId: p.questionnaire.id,
        questionnaireTitle: p.questionnaire.title,
        questionnaireStatus: p.questionnaire.status,
        performedCount: stats.done,
        openCount: stats.open,
        activeFrom: p.activeFrom,
        activeTo: p.activeTo,
        roleNames,
      }
    })
    .filter((row): row is NonNullable<typeof row> => !!row)

  const groupSurveyRows = groupQuestionnaires.map((gq) => {
    const performedCount = submissionCountByQuestionnaire.get(gq.questionnaireId) ?? 0
    const activeFrom = gq.activeFrom ?? gq.questionnaire.activeFrom
    const activeTo = gq.activeTo ?? gq.questionnaire.activeTo
    const currentlyActive = isCurrent(gq.questionnaire.status, activeFrom, activeTo)
    const openCount = currentlyActive && (gq.questionnaire.allowMultipleSubmissions || performedCount === 0) ? 1 : 0
    return {
      id: `group:${gq.id}`,
      source: 'USER_GROUP',
      objectId: null as string | null,
      objectName: null as string | null,
      surveyName: `Benutzergruppe: ${gq.group.name}`,
      questionnaireId: gq.questionnaire.id,
      questionnaireTitle: gq.questionnaire.title,
      questionnaireStatus: gq.questionnaire.status,
      performedCount,
      openCount,
      activeFrom,
      activeTo,
      roleNames: ['Gruppenmitglied'],
    }
  })

  res.json({
    roleAssignments: roleRows,
    surveyAssignments: [...objectSurveyRows, ...groupSurveyRows],
  })
})

app.post('/api/users/:id/reset', authMiddleware, requireRole(['ADMIN']), async (req, res) => {
  const { id } = req.params
  const { questionnaireId } = req.body as { questionnaireId?: string }
  if (!questionnaireId) {
    res.status(400).json({ error: 'MISSING_QUESTIONNAIRE_ID' })
    return
  }
  await prisma.submission.deleteMany({ where: { userId: id, questionnaireId } })
  res.json({ ok: true })
})

app.post('/api/users', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const actor = req.user
  const { email, password, role, externalId, displayName } = req.body as {
    email?: string
    password?: string
    role?: Role
    externalId?: string
    displayName?: string
  }
  if (!email || !password) {
    res.status(400).json({ error: 'MISSING_FIELDS' })
    return
  }
  if (actor?.role === 'EDITOR' && role === 'ADMIN') {
    res.status(403).json({ error: 'FORBIDDEN_ROLE_ASSIGNMENT' })
    return
  }
  const targetRole: Role = actor?.role === 'EDITOR' ? (role === 'EDITOR' ? 'EDITOR' : 'VIEWER') : (role ?? 'VIEWER')
  const passwordHash = await bcrypt.hash(password, 10)
  const generatedExternalId = await generateUniqueExternalId(email, externalId)
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: targetRole,
      externalId: generatedExternalId,
      displayName: displayName?.trim() || null,
      imported: false,
      createdByUserId: actor?.id ?? null,
    },
  })
  res.json({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    externalId: user.externalId,
    createdAt: user.createdAt,
    imported: user.imported,
    lastLoginAt: user.lastLoginAt,
  })
})

app.put('/api/users/:id', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const actor = req.user
  if (!actor) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const { id } = req.params
  const { email, password, role, externalId, displayName } = req.body as {
    email?: string
    password?: string
    role?: Role
    externalId?: string
    displayName?: string
  }
  const target = await prisma.user.findUnique({ where: { id } })
  if (!target) {
    res.status(404).json({ error: 'NOT_FOUND' })
    return
  }
  if (actor.role !== 'ADMIN') {
    if (target.role === 'ADMIN') {
      res.status(403).json({ error: 'FORBIDDEN' })
      return
    }
    const actorGroupIds = await getUserGroupIds(actor.id)
    const groupMembers = await prisma.groupMember.findMany({
      where: { groupId: { in: actorGroupIds } },
      select: { userId: true },
    })
    const sharedUserIds = new Set(groupMembers.map((m) => m.userId))
    const canEditTarget =
      target.id === actor.id ||
      target.createdByUserId === actor.id ||
      target.importedByUserId === actor.id ||
      sharedUserIds.has(target.id)
    if (!canEditTarget) {
      res.status(403).json({ error: 'FORBIDDEN' })
      return
    }
    if (role === 'ADMIN') {
      res.status(403).json({ error: 'FORBIDDEN_ROLE_ASSIGNMENT' })
      return
    }
  }
  const data: { email?: string; role?: Role; passwordHash?: string; externalId?: string | null; displayName?: string | null } = {}
  if (email) data.email = email
  if (displayName !== undefined) data.displayName = displayName.trim() || null
  if (role) data.role = role
  if (externalId !== undefined) {
    if (externalId.trim()) {
      data.externalId = await generateUniqueExternalId(email ?? '', externalId, id)
    } else {
      const existing = await prisma.user.findUnique({
        where: { id },
        select: { email: true },
      })
      const sourceEmail = email ?? existing?.email
      if (sourceEmail) {
        data.externalId = await generateUniqueExternalId(sourceEmail, undefined, id)
      }
    }
  }
  if (password) data.passwordHash = await bcrypt.hash(password, 10)
  const user = await prisma.user.update({ where: { id }, data })
  res.json({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    externalId: user.externalId,
    createdAt: user.createdAt,
    imported: user.imported,
    lastLoginAt: user.lastLoginAt,
  })
})

app.delete('/api/users/:id', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const actor = req.user
  if (!actor) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const { id } = req.params
  const target = await prisma.user.findUnique({ where: { id } })
  if (!target) {
    res.status(404).json({ error: 'NOT_FOUND' })
    return
  }
  if (actor.role !== 'ADMIN') {
    if (target.role === 'ADMIN') {
      res.status(403).json({ error: 'FORBIDDEN' })
      return
    }
    const actorGroupIds = await getUserGroupIds(actor.id)
    const groupMembers = await prisma.groupMember.findMany({
      where: { groupId: { in: actorGroupIds } },
      select: { userId: true },
    })
    const sharedUserIds = new Set(groupMembers.map((m) => m.userId))
    const canDeleteTarget =
      target.createdByUserId === actor.id ||
      target.importedByUserId === actor.id ||
      sharedUserIds.has(target.id)
    if (!canDeleteTarget) {
      res.status(403).json({ error: 'FORBIDDEN' })
      return
    }
  }
  await prisma.user.delete({ where: { id } })
  res.json({ ok: true })
})

app.post('/api/users/bulk-delete', authMiddleware, requireRole(['ADMIN']), async (req, res) => {
  const { emailContains, excludeAdmins } = req.body as { emailContains?: string; excludeAdmins?: boolean }
  const value = (emailContains ?? '').trim()
  if (!value) {
    res.status(400).json({ error: 'MISSING_EMAIL_FILTER' })
    return
  }
  const where: any = { email: { contains: value, mode: 'insensitive' } }
  if (excludeAdmins !== false) {
    where.role = { not: 'ADMIN' }
  }
  const result = await prisma.user.deleteMany({ where })
  res.json({ ok: true, count: result.count })
})

app.post('/api/users/bulk-delete/preview', authMiddleware, requireRole(['ADMIN']), async (req, res) => {
  const { emailContains, excludeAdmins } = req.body as { emailContains?: string; excludeAdmins?: boolean }
  const value = (emailContains ?? '').trim()
  if (!value) {
    res.status(400).json({ error: 'MISSING_EMAIL_FILTER' })
    return
  }
  const where: any = { email: { contains: value, mode: 'insensitive' } }
  if (excludeAdmins !== false) {
    where.role = { not: 'ADMIN' }
  }
  const count = await prisma.user.count({ where })
  res.json({ ok: true, count })
})

app.get('/api/groups', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const groups = await prisma.group.findMany({
    orderBy: { createdAt: 'desc' },
    include: { members: true, questionnaires: true },
  })
  let visible = groups
  if (user.role !== 'ADMIN') {
    const userGroupIds = new Set((await getUserGroupIds(user.id)))
    visible = groups.filter(
      (g) =>
        userGroupIds.has(g.id) || g.createdByUserId === user.id || g.importedByUserId === user.id
    )
  }
  res.json(
    visible.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      memberCount: g.members.length,
      questionnaireCount: g.questionnaires.length,
    }))
  )
})

app.get('/api/groups/:id', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const group = await prisma.group.findUnique({ where: { id } })
  if (!group) {
    res.status(404).json({ error: 'NOT_FOUND' })
    return
  }
  if (user.role !== 'ADMIN') {
    const userGroupIds = new Set((await getUserGroupIds(user.id)))
    const allowed =
      userGroupIds.has(group.id) || group.createdByUserId === user.id || group.importedByUserId === user.id
    if (!allowed) {
      res.status(403).json({ error: 'FORBIDDEN' })
      return
    }
  }
  res.json(group)
})

app.post('/api/groups', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const actor = req.user
  const { name, description } = req.body as { name?: string; description?: string }
  if (!name) {
    res.status(400).json({ error: 'MISSING_NAME' })
    return
  }
  const group = await prisma.group.create({
    data: {
      name,
      description,
      createdByUserId: actor?.id ?? null,
    },
  })
  res.json(group)
})

app.put('/api/groups/:id', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const access = await canAccessUserGroupById(user, id)
  if (!access.ok) return res.status(access.notFound ? 404 : 403).json({ error: access.notFound ? 'NOT_FOUND' : 'FORBIDDEN' })
  const { name, description } = req.body as { name?: string; description?: string }
  const group = await prisma.group.update({ where: { id }, data: { name, description } })
  res.json(group)
})

app.delete('/api/groups/:id', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const access = await canAccessUserGroupById(user, id)
  if (!access.ok) return res.status(access.notFound ? 404 : 403).json({ error: access.notFound ? 'NOT_FOUND' : 'FORBIDDEN' })
  await prisma.$transaction(async (tx) => {
    await tx.groupObjectGroup.deleteMany({ where: { groupId: id } })
    await tx.groupMember.deleteMany({ where: { groupId: id } })
    await tx.groupQuestionnaire.deleteMany({ where: { groupId: id } })
    await tx.objectRoleAssignment.deleteMany({ where: { groupId: id } })
    await tx.group.delete({ where: { id } })
  })
  res.json({ ok: true })
})

app.get('/api/groups/:id/members', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const access = await canAccessUserGroupById(user, id)
  if (!access.ok) return res.status(access.notFound ? 404 : 403).json({ error: access.notFound ? 'NOT_FOUND' : 'FORBIDDEN' })
  const members = await prisma.groupMember.findMany({
    where: { groupId: id },
    include: { user: true },
  })
  res.json(
    members.map((m) => ({
      id: m.user.id,
      email: m.user.email,
      role: m.user.role,
      externalId: m.user.externalId,
      lastLoginAt: m.user.lastLoginAt,
      hasLoggedIn: !!m.user.lastLoginAt,
    }))
  )
})

app.put('/api/groups/:id/members', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const access = await canAccessUserGroupById(user, id)
  if (!access.ok) return res.status(access.notFound ? 404 : 403).json({ error: access.notFound ? 'NOT_FOUND' : 'FORBIDDEN' })
  const { userIds, memberIdentifiers } = req.body as {
    userIds?: string[]
    memberIdentifiers?: string[]
  }
  if (!Array.isArray(userIds) && !Array.isArray(memberIdentifiers)) {
    res.status(400).json({ error: 'MISSING_USER_IDS' })
    return
  }
  const createdOrResolvedIds = Array.isArray(memberIdentifiers)
    ? await resolveOrCreateUsersByIdentifiers(user, memberIdentifiers)
    : []
  const mergedIds = Array.from(
    new Set([...(Array.isArray(userIds) ? userIds : []), ...createdOrResolvedIds].filter(Boolean))
  )
  if (user.role !== 'ADMIN' && mergedIds.length > 0) {
    const adminCount = await prisma.user.count({
      where: { id: { in: mergedIds }, role: 'ADMIN' },
    })
    if (adminCount > 0) {
      res.status(403).json({ error: 'FORBIDDEN_ADMIN_MEMBER' })
      return
    }
  }
  await prisma.groupMember.deleteMany({ where: { groupId: id } })
  if (mergedIds.length > 0) {
    await prisma.groupMember.createMany({
      data: mergedIds.map((userId) => ({ userId, groupId: id })),
      skipDuplicates: true,
    })
  }
  res.json({ ok: true })
})

app.get('/api/groups/:id/questionnaires', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const access = await canAccessUserGroupById(user, id)
  if (!access.ok) return res.status(access.notFound ? 404 : 403).json({ error: access.notFound ? 'NOT_FOUND' : 'FORBIDDEN' })
  const assignments = await prisma.groupQuestionnaire.findMany({
    where: { groupId: id },
    include: { questionnaire: true },
  })
  res.json(
    assignments.map((a) => ({
      id: a.questionnaire.id,
      title: a.questionnaire.title,
      status: a.questionnaire.status,
      activeFrom: a.questionnaire.activeFrom,
      activeTo: a.questionnaire.activeTo,
      assignment: {
        frequency: a.frequency,
        intervalDays: a.intervalDays,
        activeFrom: a.activeFrom,
        activeTo: a.activeTo,
      },
    }))
  )
})

app.get('/api/groups/:id/object-groups', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const access = await canAccessUserGroupById(user, id)
  if (!access.ok) return res.status(access.notFound ? 404 : 403).json({ error: access.notFound ? 'NOT_FOUND' : 'FORBIDDEN' })
  const links = await prisma.groupObjectGroup.findMany({
    where: { groupId: id },
    include: { objectGroup: true },
  })
  res.json(links.map((l) => ({ id: l.objectGroup.id, name: l.objectGroup.name })))
})

app.put('/api/groups/:id/questionnaires', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const access = await canAccessUserGroupById(user, id)
  if (!access.ok) return res.status(access.notFound ? 404 : 403).json({ error: access.notFound ? 'NOT_FOUND' : 'FORBIDDEN' })
  const { questionnaireIds, assignments } = req.body as {
    questionnaireIds?: string[]
    assignments?: Array<{
      questionnaireId: string
      frequency?: Frequency
      intervalDays?: number
      activeFrom?: string | null
      activeTo?: string | null
    }>
  }
  const normalizedAssignments =
    assignments ??
    (Array.isArray(questionnaireIds)
      ? questionnaireIds.map((questionnaireId) => ({ questionnaireId }))
      : undefined)

  if (!Array.isArray(normalizedAssignments)) {
    res.status(400).json({ error: 'MISSING_QUESTIONNAIRE_IDS' })
    return
  }

  const existing = await prisma.groupQuestionnaire.findMany({ where: { groupId: id } })
  const existingIds = new Set(existing.map((e) => e.questionnaireId))
  const nextIds = new Set(normalizedAssignments.map((a) => a.questionnaireId))
  const removed = Array.from(existingIds).filter((x) => !nextIds.has(x))

  await prisma.groupQuestionnaire.deleteMany({ where: { groupId: id } })
  if (normalizedAssignments.length > 0) {
    await prisma.groupQuestionnaire.createMany({
      data: normalizedAssignments.map((a) => ({
        questionnaireId: a.questionnaireId,
        groupId: id,
        frequency: a.frequency ?? 'ONCE',
        intervalDays: a.intervalDays ?? null,
        activeFrom: a.activeFrom ? new Date(a.activeFrom) : null,
        activeTo: a.activeTo ? new Date(a.activeTo) : null,
      })),
    })
  }

  const objectGroupLinks = await prisma.groupObjectGroup.findMany({ where: { groupId: id } })
  const objectGroupIds = objectGroupLinks.map((l) => l.objectGroupId)

  if (removed.length > 0) {
    await cleanupGroupAssignments(id, objectGroupIds, removed)
  }
  const added = normalizedAssignments
    .map((a) => a.questionnaireId)
    .filter((qid) => !existingIds.has(qid))
  if (added.length > 0) {
    await ensureGroupObjectSetup(id, objectGroupIds, added)
  } else if (normalizedAssignments.length > 0) {
    await ensureGroupObjectSetup(id, objectGroupIds, normalizedAssignments.map((a) => a.questionnaireId))
  }

  res.json({ ok: true })
})

app.put('/api/groups/:id/object-groups', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const access = await canAccessUserGroupById(user, id)
  if (!access.ok) return res.status(access.notFound ? 404 : 403).json({ error: access.notFound ? 'NOT_FOUND' : 'FORBIDDEN' })
  const { objectGroupIds } = req.body as { objectGroupIds?: string[] }
  if (!Array.isArray(objectGroupIds)) {
    res.status(400).json({ error: 'MISSING_OBJECT_GROUP_IDS' })
    return
  }
  const existing = await prisma.groupObjectGroup.findMany({ where: { groupId: id } })
  const existingIds = new Set(existing.map((e) => e.objectGroupId))
  const nextIds = new Set(objectGroupIds)
  const removed = Array.from(existingIds).filter((x) => !nextIds.has(x))
  const added = Array.from(nextIds).filter((x) => !existingIds.has(x))

  await prisma.groupObjectGroup.deleteMany({ where: { groupId: id } })
  if (objectGroupIds.length > 0) {
    await prisma.groupObjectGroup.createMany({
      data: objectGroupIds.map((objectGroupId) => ({ groupId: id, objectGroupId })),
    })
  }

  if (removed.length > 0) {
    await cleanupGroupAssignments(id, removed, undefined)
  }
  if (added.length > 0) {
    await ensureGroupObjectSetup(id, added)
  }

  res.json({ ok: true })
})
app.get('/api/objects', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const list = await prisma.objectEntity.findMany({ orderBy: { createdAt: 'desc' } })
  if (user.role === 'ADMIN') {
    res.json(list)
    return
  }
  const userGroupIds = await getUserGroupIds(user.id)
  const creatorIds = Array.from(
    new Set(list.map((o) => o.createdByUserId).filter((id): id is string => Boolean(id)))
  )
  const creatorMemberships =
    creatorIds.length > 0
      ? await prisma.groupMember.findMany({
          where: { userId: { in: creatorIds } },
          select: { userId: true, groupId: true },
        })
      : []
  const creatorGroupMap = new Map<string, string[]>()
  for (const m of creatorMemberships) {
    const current = creatorGroupMap.get(m.userId) ?? []
    current.push(m.groupId)
    creatorGroupMap.set(m.userId, current)
  }
  const visible = list.filter((obj) =>
    canManageObjectByScope({
      userId: user.id,
      userRole: user.role,
      userGroupIds,
      object: {
        ...obj,
        creatorGroupIds: obj.createdByUserId ? (creatorGroupMap.get(obj.createdByUserId) ?? []) : [],
      },
    })
  )
  res.json(visible)
})

app.get('/api/objects/with-groups', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const type = (req.query.type as string | undefined)?.trim()
  const metaQuery = (req.query.meta as string | undefined)?.trim()
  const metaKey = (req.query.metaKey as string | undefined)?.trim()
  const metaValue = (req.query.metaValue as string | undefined)?.trim()
  const textQuery = (req.query.q as string | undefined)?.trim()
  const list = await prisma.objectEntity.findMany({
    orderBy: { createdAt: 'desc' },
    include: { groupMemberships: { include: { group: true } } },
  })
  const userGroupIds = user.role === 'ADMIN' ? [] : await getUserGroupIds(user.id)
  const creatorIds =
    user.role === 'ADMIN'
      ? []
      : Array.from(
          new Set(list.map((o) => o.createdByUserId).filter((id): id is string => Boolean(id)))
        )
  const creatorMemberships =
    creatorIds.length > 0
      ? await prisma.groupMember.findMany({
          where: { userId: { in: creatorIds } },
          select: { userId: true, groupId: true },
        })
      : []
  const creatorGroupMap = new Map<string, string[]>()
  for (const m of creatorMemberships) {
    const current = creatorGroupMap.get(m.userId) ?? []
    current.push(m.groupId)
    creatorGroupMap.set(m.userId, current)
  }
  const filtered = list.filter((obj) => {
    if (
      user.role !== 'ADMIN' &&
      !canManageObjectByScope({
        userId: user.id,
        userRole: user.role,
        userGroupIds,
        object: {
          ...obj,
          creatorGroupIds: obj.createdByUserId ? (creatorGroupMap.get(obj.createdByUserId) ?? []) : [],
        },
      })
    ) {
      return false
    }
    if (type && obj.type !== type) return false
    if (metaKey) {
      const meta = (obj.metadata ?? {}) as Record<string, unknown>
      const metaVal = meta[metaKey]
      if (metaVal === undefined || metaVal === null) return false
      if (metaValue && !String(metaVal).toLowerCase().includes(metaValue.toLowerCase())) return false
    }
    if (metaQuery) {
      const [rawKey, ...rest] = metaQuery.split(':')
      const key = rawKey?.trim()
      const value = rest.join(':').trim()
      if (key && value) {
        const meta = (obj.metadata ?? {}) as Record<string, unknown>
        const metaVal = meta[key]
        if (metaVal === undefined || metaVal === null) return false
        return String(metaVal).toLowerCase().includes(value.toLowerCase())
      }
      const hay = JSON.stringify(obj.metadata ?? {}).toLowerCase()
      if (!hay.includes(metaQuery.toLowerCase())) return false
    }
    if (textQuery) {
      const haystack = [
        obj.name ?? '',
        obj.type ?? '',
        obj.externalId ?? '',
        obj.description ?? '',
        JSON.stringify(obj.metadata ?? {}),
      ]
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(textQuery.toLowerCase())) return false
    }
    return true
  })

  const filteredObjectIds = filtered.map((obj) => obj.id)
  const filteredGroupIds = Array.from(
    new Set(filtered.flatMap((obj) => obj.groupMemberships.map((m) => m.group.id)))
  )

  const [directPolicies, groupPolicies, tasks, assignments] = await Promise.all([
    filteredObjectIds.length > 0
      ? prisma.objectSurveyPolicy.findMany({
          where: { objectId: { in: filteredObjectIds }, createdByObjectGroupId: null },
          include: {
            questionnaire: { select: { id: true, title: true, status: true } },
          },
        })
      : Promise.resolve([]),
    filteredGroupIds.length > 0
      ? prisma.objectGroupPolicy.findMany({
          where: { groupId: { in: filteredGroupIds } },
          include: {
            questionnaire: { select: { id: true, title: true, status: true } },
            group: { select: { id: true, name: true } },
          },
        })
      : Promise.resolve([]),
    filteredObjectIds.length > 0
      ? prisma.objectSurveyTask.findMany({
          where: { objectId: { in: filteredObjectIds } },
          select: {
            objectId: true,
            questionnaireId: true,
            status: true,
            policyId: true,
            policy: { select: { createdByObjectGroupId: true } },
          },
        })
      : Promise.resolve([]),
    filteredObjectIds.length > 0
      ? prisma.objectRoleAssignment.findMany({
          where: { objectId: { in: filteredObjectIds } },
          include: {
            role: { select: { id: true, name: true } },
            user: { select: { id: true, email: true, displayName: true, externalId: true } },
            group: {
              select: {
                id: true,
                name: true,
                members: {
                  include: {
                    user: {
                      select: { id: true, email: true, displayName: true, externalId: true },
                    },
                  },
                },
              },
            },
          },
        })
      : Promise.resolve([]),
  ])

  const directTaskStats = new Map<string, { open: number; done: number }>()
  const groupTaskStats = new Map<string, { open: number; done: number }>()
  for (const task of tasks) {
    const target = task.status === 'OPEN' ? 'open' : 'done'
    const directCurrent = directTaskStats.get(task.policyId) ?? { open: 0, done: 0 }
    directCurrent[target] += 1
    directTaskStats.set(task.policyId, directCurrent)
    if (task.policy.createdByObjectGroupId) {
      const key = `${task.objectId}:${task.policy.createdByObjectGroupId}:${task.questionnaireId}`
      const groupCurrent = groupTaskStats.get(key) ?? { open: 0, done: 0 }
      groupCurrent[target] += 1
      groupTaskStats.set(key, groupCurrent)
    }
  }

  const assignmentsByObjectId = new Map<
    string,
    Array<{
      role: { id: string; name: string }
      user: { id: string; email: string; displayName: string | null; externalId: string | null } | null
      group: {
        id: string
        name: string
        members: Array<{
          user: { id: string; email: string; displayName: string | null; externalId: string | null }
        }>
      } | null
    }>
  >()
  for (const assignment of assignments) {
    const listForObject = assignmentsByObjectId.get(assignment.objectId) ?? []
    listForObject.push(assignment)
    assignmentsByObjectId.set(assignment.objectId, listForObject)
  }

  const parseStringList = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.map((v) => String(v ?? '').trim()).filter(Boolean)
    return []
  }

  const labelForUser = (u: { email: string; displayName: string | null; externalId: string | null }) =>
    u.displayName?.trim() || u.email || u.externalId || 'Unbekannt'

  const getAssignedPeople = (
    objectId: string,
    roleFilter:
      | { mode: 'all' }
      | { mode: 'roleIds'; values: string[] }
      | { mode: 'roleNames'; values: string[] }
  ) => {
    const listForObject = assignmentsByObjectId.get(objectId) ?? []
    const selected = new Set<string>()
    const labels: string[] = []
    const roleNames = roleFilter.mode === 'roleNames' ? new Set(roleFilter.values.map((v) => v.toLowerCase())) : null
    const roleIds = roleFilter.mode === 'roleIds' ? new Set(roleFilter.values) : null
    for (const assignment of listForObject) {
      const roleAllowed =
        roleFilter.mode === 'all' ||
        (roleNames ? roleNames.has(assignment.role.name.toLowerCase()) : false) ||
        (roleIds ? roleIds.has(assignment.role.id) : false)
      if (!roleAllowed) continue
      if (assignment.user) {
        if (!selected.has(`u:${assignment.user.id}`)) {
          selected.add(`u:${assignment.user.id}`)
          labels.push(labelForUser(assignment.user))
        }
      }
      if (assignment.group) {
        for (const member of assignment.group.members) {
          const memberUser = member.user
          const key = `u:${memberUser.id}`
          if (selected.has(key)) continue
          selected.add(key)
          labels.push(labelForUser(memberUser))
        }
      }
    }
    return labels
  }

  const getRoleSummary = (objectId: string) => {
    const listForObject = assignmentsByObjectId.get(objectId) ?? []
    const roleMap = new Map<string, Set<string>>()
    for (const assignment of listForObject) {
      const roleName = assignment.role.name
      const set = roleMap.get(roleName) ?? new Set<string>()
      if (assignment.user) {
        set.add(assignment.user.id)
      }
      if (assignment.group) {
        for (const member of assignment.group.members) {
          set.add(member.user.id)
        }
      }
      roleMap.set(roleName, set)
    }
    return Array.from(roleMap.entries())
      .map(([roleName, users]) => ({ roleName, personCount: users.size }))
      .sort((a, b) => a.roleName.localeCompare(b.roleName, 'de'))
  }

  const directPoliciesByObject = new Map<string, typeof directPolicies>()
  for (const p of directPolicies) {
    const current = directPoliciesByObject.get(p.objectId) ?? []
    current.push(p)
    directPoliciesByObject.set(p.objectId, current)
  }

  const groupPoliciesByGroup = new Map<string, typeof groupPolicies>()
  for (const p of groupPolicies) {
    const current = groupPoliciesByGroup.get(p.groupId) ?? []
    current.push(p)
    groupPoliciesByGroup.set(p.groupId, current)
  }

  res.json(
    filtered.map((obj) => ({
      id: obj.id,
      externalId: obj.externalId,
      name: obj.name,
      type: obj.type,
      description: obj.description,
      metadata: obj.metadata,
      groups: obj.groupMemberships.map((m) => ({ id: m.group.id, name: m.group.name })),
      roleSummary: getRoleSummary(obj.id),
      surveyAssignments: [
        ...(directPoliciesByObject.get(obj.id) ?? []).map((policy) => {
          const taskStats = directTaskStats.get(policy.id) ?? { open: 0, done: 0 }
          const roleIds = parseStringList(policy.roleIds)
          const assignees =
            roleIds.length > 0
              ? getAssignedPeople(obj.id, { mode: 'roleIds', values: roleIds })
              : getAssignedPeople(obj.id, { mode: 'all' })
          return {
            id: `direct:${policy.id}`,
            source: 'DIRECT',
            surveyName: 'Direkte Objekt-Umfrage',
            questionnaireId: policy.questionnaire.id,
            questionnaireTitle: policy.questionnaire.title,
            questionnaireStatus: policy.questionnaire.status,
            performedCount: taskStats.done,
            openCount: taskStats.open,
            activeFrom: policy.activeFrom,
            activeTo: policy.activeTo,
            assignees,
          }
        }),
        ...obj.groupMemberships.flatMap((membership) =>
          (groupPoliciesByGroup.get(membership.group.id) ?? []).map((policy) => {
            const key = `${obj.id}:${membership.group.id}:${policy.questionnaireId}`
            const taskStats = groupTaskStats.get(key) ?? { open: 0, done: 0 }
            const roleNames = parseStringList(policy.roleNames)
            const assignees =
              roleNames.length > 0
                ? getAssignedPeople(obj.id, { mode: 'roleNames', values: roleNames })
                : getAssignedPeople(obj.id, { mode: 'all' })
            return {
              id: `group:${membership.group.id}:${policy.id}`,
              source: 'OBJECT_GROUP',
              surveyName: `Objektgruppe: ${membership.group.name}`,
              questionnaireId: policy.questionnaire.id,
              questionnaireTitle: policy.questionnaire.title,
              questionnaireStatus: policy.questionnaire.status,
              performedCount: taskStats.done,
              openCount: taskStats.open,
              activeFrom: policy.activeFrom,
              activeTo: policy.activeTo,
              assignees,
            }
          })
        ),
      ],
    }))
  )
})

app.get('/api/admin/object-picker/filter-options', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }

  const metaKeyQuery = String(req.query.metaKey || '').trim()

  const list = await prisma.objectEntity.findMany({
    orderBy: { createdAt: 'desc' },
    include: { groupMemberships: { include: { group: true } } },
  })

  let visible = list
  if (user.role !== 'ADMIN') {
    const userGroupIds = await getUserGroupIds(user.id)
    const creatorIds = Array.from(
      new Set(list.map((o) => o.createdByUserId).filter((id): id is string => Boolean(id)))
    )
    const creatorMemberships =
      creatorIds.length > 0
        ? await prisma.groupMember.findMany({
            where: { userId: { in: creatorIds } },
            select: { userId: true, groupId: true },
          })
        : []
    const creatorGroupMap = new Map<string, string[]>()
    for (const m of creatorMemberships) {
      const current = creatorGroupMap.get(m.userId) ?? []
      current.push(m.groupId)
      creatorGroupMap.set(m.userId, current)
    }
    visible = list.filter((obj) =>
      canManageObjectByScope({
        userId: user.id,
        userRole: user.role,
        userGroupIds,
        object: {
          ...obj,
          creatorGroupIds: obj.createdByUserId ? (creatorGroupMap.get(obj.createdByUserId) ?? []) : [],
        },
      })
    )
  }

  const types = Array.from(
    new Set(
      visible
        .map((obj) => (obj.type ?? '').trim())
        .filter((entry) => entry.length > 0)
    )
  ).sort((a, b) => a.localeCompare(b, 'de'))

  const metadataKeys = Array.from(
    new Set(
      visible.flatMap((obj) => {
        const meta = obj.metadata
        if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return []
        return Object.keys(meta as Record<string, unknown>)
      })
    )
  ).sort((a, b) => a.localeCompare(b, 'de'))

  const metadataValues = metaKeyQuery
    ? Array.from(
        new Set(
          visible.flatMap((obj) => {
            const meta = obj.metadata
            if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return []
            const value = (meta as Record<string, unknown>)[metaKeyQuery]
            if (value === undefined || value === null) return []
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
              return [String(value)]
            }
            return [JSON.stringify(value)]
          })
        )
      ).sort((a, b) => a.localeCompare(b, 'de'))
    : []

  const groupMap = new Map<string, { id: string; name: string }>()
  visible.forEach((obj) => {
    obj.groupMemberships.forEach((m) => {
      groupMap.set(m.group.id, { id: m.group.id, name: m.group.name })
    })
  })
  const objectGroups = Array.from(groupMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'de'))

  res.json({ types, metadataKeys, metadataValues, objectGroups })
})

app.post('/api/objects', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const { name, type, metadata, externalId, description } = req.body as { name?: string; type?: string; metadata?: unknown; externalId?: string; description?: string }
  const normalizedName = (name ?? '').trim()
  const normalizedExternalId = (externalId ?? '').trim() || null
  if (!normalizedName) {
    res.status(400).json({ error: 'MISSING_NAME' })
    return
  }
  if (normalizedExternalId) {
    const existingByExternalId = await prisma.objectEntity.findUnique({
      where: { externalId: normalizedExternalId },
      select: { id: true },
    })
    if (existingByExternalId) {
      res.status(409).json({ error: 'OBJECT_ID_ALREADY_EXISTS' })
      return
    }
  }
  const creatorGroupIds = user.role === 'ADMIN' ? [] : await getUserGroupIds(user.id)
  const obj = await prisma.objectEntity.create({
    data: {
      name: normalizedName,
      type,
      metadata,
      externalId: normalizedExternalId,
      description,
      createdByUserId: user.id,
      adminGroupIds: creatorGroupIds,
    },
  })
  res.json(obj)
})

app.put('/api/objects/:id', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const { id } = req.params
  const { name, type, metadata, externalId, description } = req.body as { name?: string; type?: string; metadata?: unknown; externalId?: string; description?: string }
  const normalizedExternalId = externalId === undefined ? undefined : ((externalId ?? '').trim() || null)
  const current = await prisma.objectEntity.findUnique({ where: { id } })
  if (!current) {
    res.status(404).json({ error: 'NOT_FOUND' })
    return
  }
  const userGroupIds = user.role === 'ADMIN' ? [] : await getUserGroupIds(user.id)
  const allowed = canManageObjectByScope({
    userId: user.id,
    userRole: user.role,
    userGroupIds,
    object: current,
  })
  if (!allowed) {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }
  if (normalizedExternalId !== undefined && normalizedExternalId) {
    const existingByExternalId = await prisma.objectEntity.findUnique({
      where: { externalId: normalizedExternalId },
      select: { id: true },
    })
    if (existingByExternalId && existingByExternalId.id !== id) {
      res.status(409).json({ error: 'OBJECT_ID_ALREADY_EXISTS' })
      return
    }
  }
  const obj = await prisma.objectEntity.update({
    where: { id },
    data: { name: name?.trim() || undefined, type, metadata, externalId: normalizedExternalId, description },
  })
  res.json(obj)
})

app.delete('/api/objects/:id', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const { id } = req.params
  const current = await prisma.objectEntity.findUnique({ where: { id } })
  if (!current) {
    res.status(404).json({ error: 'NOT_FOUND' })
    return
  }
  const userGroupIds = user.role === 'ADMIN' ? [] : await getUserGroupIds(user.id)
  const allowed = canManageObjectByScope({
    userId: user.id,
    userRole: user.role,
    userGroupIds,
    object: current,
  })
  if (!allowed) {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }
  await prisma.$transaction(async (tx) => {
    await tx.objectSurveyTask.deleteMany({ where: { objectId: id } })
    await tx.objectPolicyOverride.deleteMany({ where: { objectId: id } })
    await tx.objectSurveyPolicy.deleteMany({ where: { objectId: id } })
    await tx.objectRoleAssignment.deleteMany({ where: { objectId: id } })
    await tx.objectGroupMembership.deleteMany({ where: { objectId: id } })
    await tx.objectEntity.delete({ where: { id } })
  })
  res.json({ ok: true })
})

app.get('/api/objects/:id/prefills/:questionnaireId', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const { id, questionnaireId } = req.params
  await ensureObjectQuestionnairePrefillTable()
  const current = await prisma.objectEntity.findUnique({ where: { id } })
  if (!current) {
    res.status(404).json({ error: 'NOT_FOUND' })
    return
  }
  const userGroupIds = user.role === 'ADMIN' ? [] : await getUserGroupIds(user.id)
  const allowed = canManageObjectByScope({
    userId: user.id,
    userRole: user.role,
    userGroupIds,
    object: current,
  })
  if (!allowed) {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }
  const rows = (await prisma.$queryRawUnsafe(
    `
      SELECT *
      FROM "ObjectQuestionnairePrefill"
      WHERE "objectId" = $1 AND "questionnaireId" = $2
      LIMIT 1
    `,
    id,
    questionnaireId
  )) as Array<{
    id: string
    objectId: string
    questionnaireId: string
    questionnaireVersion: number | null
    answersJson: unknown
    createdByUserId: string | null
    updatedByUserId: string | null
    createdAt: Date
    updatedAt: Date
  }>
  const row = rows[0]
  if (!row) {
    res.json({ exists: false })
    return
  }
  res.json({
    exists: true,
    id: row.id,
    objectId: row.objectId,
    questionnaireId: row.questionnaireId,
    questionnaireVersion: row.questionnaireVersion,
    answers: row.answersJson ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })
})

app.post('/api/prefills/bulk', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const { rows, defaultQuestionnaireVersion } = req.body as {
    rows?: Array<Record<string, unknown>>
    defaultQuestionnaireVersion?: number | null
  }
  if (!Array.isArray(rows)) {
    res.status(400).json({ error: 'MISSING_ROWS' })
    return
  }
  await ensureObjectQuestionnairePrefillTable()

  const normalizedRows = rows.map((row, index) => {
    const objectIdentifier = String(
      row.object_id ?? row.object_external_id ?? row.ObjektId ?? row.objectId ?? ''
    ).trim()
    const questionnaireId = String(
      row.questionnaire_id ?? row.FragebogenId ?? row.questionnaireId ?? ''
    ).trim()
    const questionnaireTitle = String(
      row.questionnaire_title ?? row.FragebogenTitel ?? row.questionnaireTitle ?? ''
    ).trim()
    const questionId = String(row.question_id ?? row.FrageId ?? row.questionId ?? '').trim()
    return {
      rowNo: index + 2,
      row,
      objectIdentifier,
      questionnaireId,
      questionnaireTitle,
      questionId,
    }
  })

  const objectIdentifiers = Array.from(
    new Set(normalizedRows.map((r) => r.objectIdentifier).filter(Boolean))
  )
  const questionnaireIds = Array.from(
    new Set(normalizedRows.map((r) => r.questionnaireId).filter(Boolean))
  )
  const questionnaireTitles = Array.from(
    new Set(normalizedRows.map((r) => r.questionnaireTitle).filter(Boolean))
  )

  const [objects, questionnairesById, questionnairesByTitle] = await Promise.all([
    objectIdentifiers.length > 0
      ? prisma.objectEntity.findMany({
          where: {
            OR: [
              { externalId: { in: objectIdentifiers } },
              { id: { in: objectIdentifiers } },
            ],
          },
          select: { id: true, externalId: true, name: true },
        })
      : Promise.resolve([]),
    questionnaireIds.length > 0
      ? prisma.questionnaire.findMany({
          where: { id: { in: questionnaireIds } },
          select: { id: true, title: true, version: true, sections: true },
        })
      : Promise.resolve([]),
    questionnaireTitles.length > 0
      ? prisma.questionnaire.findMany({
          where: { title: { in: questionnaireTitles } },
          select: { id: true, title: true, version: true, sections: true },
        })
      : Promise.resolve([]),
  ])

  const objectByIdentifier = new Map<string, { id: string; externalId?: string | null; name: string }>()
  objects.forEach((o) => {
    objectByIdentifier.set(o.id, o)
    if (o.externalId) objectByIdentifier.set(o.externalId, o)
  })
  const questionnaireById = new Map(questionnairesById.map((q) => [q.id, q]))
  const questionnaireByTitle = new Map(questionnairesByTitle.map((q) => [q.title, q]))
  const visibleObjectIds =
    user.role === 'ADMIN' ? null : new Set((await getVisibleObjectIdsForUser(user)) ?? [])

  const grouped = new Map<
    string,
    {
      objectId: string
      questionnaireId: string
      questionnaireVersion: number | null
      sections: unknown
      rows: Array<{ rowNo: number; row: Record<string, unknown>; questionId: string }>
    }
  >()
  const errors: string[] = []
  let skippedRows = 0

  normalizedRows.forEach((entry) => {
    if (!entry.objectIdentifier || !entry.questionId || (!entry.questionnaireId && !entry.questionnaireTitle)) {
      skippedRows += 1
      return
    }
    const obj = objectByIdentifier.get(entry.objectIdentifier)
    if (!obj) {
      errors.push(`Zeile ${entry.rowNo}: Objekt nicht gefunden (${entry.objectIdentifier}).`)
      return
    }
    if (visibleObjectIds && !visibleObjectIds.has(obj.id)) {
      errors.push(`Zeile ${entry.rowNo}: Kein Zugriff auf Objekt (${entry.objectIdentifier}).`)
      return
    }
    const questionnaire =
      (entry.questionnaireId ? questionnaireById.get(entry.questionnaireId) : undefined) ??
      (entry.questionnaireTitle ? questionnaireByTitle.get(entry.questionnaireTitle) : undefined)
    if (!questionnaire) {
      errors.push(
        `Zeile ${entry.rowNo}: Fragebogen nicht gefunden (${entry.questionnaireId || entry.questionnaireTitle}).`
      )
      return
    }
    const key = `${obj.id}::${questionnaire.id}`
    const group =
      grouped.get(key) ??
      {
        objectId: obj.id,
        questionnaireId: questionnaire.id,
        questionnaireVersion:
          questionnaire.version ?? (defaultQuestionnaireVersion ?? null),
        sections: questionnaire.sections,
        rows: [],
      }
    group.rows.push({ rowNo: entry.rowNo, row: entry.row, questionId: entry.questionId })
    grouped.set(key, group)
  })

  let importedPairs = 0
  for (const group of grouped.values()) {
    const questionsById = new Map<string, any>()
    if (Array.isArray(group.sections)) {
      for (const section of group.sections as any[]) {
        if (!Array.isArray(section?.questions)) continue
        for (const question of section.questions as any[]) {
          if (typeof question?.id === 'string' && question.id.trim()) {
            questionsById.set(question.id.trim(), question)
          }
        }
      }
    }

    const answersRaw: Record<string, unknown> = {}
    const byQuestion = new Map<string, Array<{ rowNo: number; row: Record<string, unknown> }>>()
    group.rows.forEach((r) => {
      const list = byQuestion.get(r.questionId) ?? []
      list.push({ rowNo: r.rowNo, row: r.row })
      byQuestion.set(r.questionId, list)
    })

    byQuestion.forEach((items, questionId) => {
      const question = questionsById.get(questionId)
      if (!question) {
        errors.push(`Objekt ${group.objectId}: Unbekannte Frage-ID ${questionId}.`)
        return
      }
      if (question.type === 'info') return

      if (
        question.type === 'multi' ||
        question.type === 'ranking' ||
        (question.type === 'object_picker' && question.objectPickerAllowMultiple)
      ) {
        const multi: string[] = []
        items.forEach(({ row }) => {
          const rawAnswer = String(row.answer ?? row.AntwortId ?? row.AntwortLabel ?? '').trim()
          const parsed = parsePrefillAnswerForQuestion(question, rawAnswer)
          if (Array.isArray(parsed)) multi.push(...parsed.map((x) => String(x)))
          else if (typeof parsed === 'string') multi.push(parsed)
          const reason = String(row.answer_reason ?? row.Begruendung ?? '').trim()
          if (reason) answersRaw[`${questionId}__reason`] = reason
          const objectMeta = String(row.object_meta_json ?? '').trim()
          if (objectMeta) answersRaw[`${questionId}__objectMeta`] = objectMeta
          const custom = String(row.custom_options_json ?? '').trim()
          if (custom) answersRaw[`${questionId}__customOptions`] = custom
        })
        if (multi.length > 0) answersRaw[questionId] = Array.from(new Set(multi))
        return
      }

      const first = items[0]
      const rawAnswer = String(
        first.row.answer ?? first.row.AntwortId ?? first.row.AntwortLabel ?? ''
      ).trim()
      const parsed = parsePrefillAnswerForQuestion(question, rawAnswer)
      if (parsed !== undefined) answersRaw[questionId] = parsed
      const reason = String(first.row.answer_reason ?? first.row.Begruendung ?? '').trim()
      if (reason) answersRaw[`${questionId}__reason`] = reason
      const objectMeta = String(first.row.object_meta_json ?? '').trim()
      if (objectMeta) answersRaw[`${questionId}__objectMeta`] = objectMeta
      const custom = String(first.row.custom_options_json ?? '').trim()
      if (custom) answersRaw[`${questionId}__customOptions`] = custom
    })

    const sanitized = sanitizePrefillAnswers(group.sections, answersRaw)
    if (Object.keys(sanitized).length === 0) continue

    await prisma.$executeRawUnsafe(
      `
        INSERT INTO "ObjectQuestionnairePrefill" (
          "id","objectId","questionnaireId","questionnaireVersion","answersJson","createdByUserId","updatedByUserId","createdAt","updatedAt"
        )
        VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,now(),now())
        ON CONFLICT ("objectId","questionnaireId")
        DO UPDATE SET
          "questionnaireVersion" = EXCLUDED."questionnaireVersion",
          "answersJson" = EXCLUDED."answersJson",
          "updatedByUserId" = EXCLUDED."updatedByUserId",
          "updatedAt" = now()
      `,
      crypto.randomUUID(),
      group.objectId,
      group.questionnaireId,
      group.questionnaireVersion,
      JSON.stringify(sanitized),
      user.id,
      user.id
    )
    importedPairs += 1
  }

  res.json({
    ok: true,
    processedRows: rows.length,
    importedPairs,
    skippedRows,
    errors,
  })
})

app.put('/api/objects/:id/prefills/:questionnaireId', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const { id, questionnaireId } = req.params
  const { answers, questionnaireVersion } = req.body as { answers?: unknown; questionnaireVersion?: number }
  await ensureObjectQuestionnairePrefillTable()
  const [currentObject, questionnaire] = await Promise.all([
    prisma.objectEntity.findUnique({ where: { id } }),
    prisma.questionnaire.findUnique({ where: { id: questionnaireId } }),
  ])
  if (!currentObject || !questionnaire) {
    res.status(404).json({ error: 'NOT_FOUND' })
    return
  }
  const userGroupIds = user.role === 'ADMIN' ? [] : await getUserGroupIds(user.id)
  const allowed = canManageObjectByScope({
    userId: user.id,
    userRole: user.role,
    userGroupIds,
    object: currentObject,
  })
  if (!allowed) {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }
  const sanitized = sanitizePrefillAnswers(questionnaire.sections, answers)
  const effectiveVersion =
    Number.isFinite(Number(questionnaireVersion)) && Number(questionnaireVersion) > 0
      ? Number(questionnaireVersion)
      : questionnaire.version

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO "ObjectQuestionnairePrefill" (
        "id","objectId","questionnaireId","questionnaireVersion","answersJson","createdByUserId","updatedByUserId","createdAt","updatedAt"
      ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,now(),now())
      ON CONFLICT ("objectId","questionnaireId")
      DO UPDATE SET
        "questionnaireVersion" = EXCLUDED."questionnaireVersion",
        "answersJson" = EXCLUDED."answersJson",
        "updatedByUserId" = EXCLUDED."updatedByUserId",
        "updatedAt" = now()
    `,
    crypto.randomUUID(),
    id,
    questionnaireId,
    effectiveVersion,
    JSON.stringify(sanitized),
    user.id,
    user.id
  )

  res.json({ ok: true, answerCount: Object.keys(sanitized).length })
})

app.post('/api/objects/bulk-delete', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const { type } = req.body as { type?: string }
  if (!type) {
    res.status(400).json({ error: 'MISSING_TYPE' })
    return
  }
  const list = await prisma.objectEntity.findMany({
    where: { type },
    select: { id: true, createdByUserId: true, importedByUserId: true, adminGroupIds: true },
  })
  const userGroupIds = user.role === 'ADMIN' ? [] : await getUserGroupIds(user.id)
  const objectIds = list
    .filter((obj) =>
      canManageObjectByScope({
        userId: user.id,
        userRole: user.role,
        userGroupIds,
        object: obj,
      })
    )
    .map((o) => o.id)
  if (objectIds.length === 0) {
    res.json({ ok: true, count: 0 })
    return
  }
  await prisma.$transaction(async (tx) => {
    await tx.objectSurveyTask.deleteMany({ where: { objectId: { in: objectIds } } })
    await tx.objectPolicyOverride.deleteMany({ where: { objectId: { in: objectIds } } })
    await tx.objectSurveyPolicy.deleteMany({ where: { objectId: { in: objectIds } } })
    await tx.objectRoleAssignment.deleteMany({ where: { objectId: { in: objectIds } } })
    await tx.objectGroupMembership.deleteMany({ where: { objectId: { in: objectIds } } })
    await tx.objectEntity.deleteMany({ where: { id: { in: objectIds } } })
  })
  res.json({ ok: true, count: objectIds.length })
})

app.get('/api/roles', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const roles = await prisma.roleDefinition.findMany({ orderBy: { name: 'asc' } })
  const assignmentCounts = await prisma.objectRoleAssignment.groupBy({
    by: ['roleId'],
    where: { userId: { not: null } },
    _count: { _all: true },
  })
  const countMap = new Map<string, number>(
    assignmentCounts.map((entry) => [entry.roleId, entry._count._all])
  )
  const withCounts = roles.map((role) => ({
    ...role,
    assignedUserCount: countMap.get(role.id) ?? 0,
  }))
  if (user.role === 'ADMIN') {
    res.json(withCounts)
    return
  }
  const userGroupIds = await getUserGroupIds(user.id)
  const creatorIds = Array.from(
    new Set(withCounts.map((r) => r.createdByUserId).filter((id): id is string => Boolean(id)))
  )
  const creatorMemberships =
    creatorIds.length > 0
      ? await prisma.groupMember.findMany({
          where: { userId: { in: creatorIds } },
          select: { userId: true, groupId: true },
        })
      : []
  const creatorGroupMap = new Map<string, string[]>()
  for (const m of creatorMemberships) {
    const current = creatorGroupMap.get(m.userId) ?? []
    current.push(m.groupId)
    creatorGroupMap.set(m.userId, current)
  }
  const visible = withCounts.filter((role) =>
    canSeeEntityByOwnerImportOrGroups({
      userId: user.id,
      userRole: user.role,
      userGroupIds,
      entity: {
        ...role,
        creatorGroupIds: role.createdByUserId ? (creatorGroupMap.get(role.createdByUserId) ?? []) : [],
      },
    })
  )
  res.json(visible)
})

app.get('/api/objects/:id/groups', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const access = await canAccessObjectById(user, id)
  if (!access.ok) {
    res.status(access.notFound ? 404 : 403).json({ error: access.notFound ? 'NOT_FOUND' : 'FORBIDDEN' })
    return
  }
  const memberships = await prisma.objectGroupMembership.findMany({
    where: { objectId: id },
    include: { group: true },
  })
  res.json(memberships.map((m) => ({ id: m.group.id, name: m.group.name })))
})

app.get('/api/object-groups', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const list = await prisma.objectGroup.findMany({ orderBy: { createdAt: 'desc' } })
  if (user.role === 'ADMIN') {
    res.json(list)
    return
  }
  const userGroupIds = await getUserGroupIds(user.id)
  const creatorIds = Array.from(
    new Set(list.map((g) => g.createdByUserId).filter((id): id is string => Boolean(id)))
  )
  const creatorMemberships =
    creatorIds.length > 0
      ? await prisma.groupMember.findMany({
          where: { userId: { in: creatorIds } },
          select: { userId: true, groupId: true },
        })
      : []
  const creatorGroupMap = new Map<string, string[]>()
  for (const m of creatorMemberships) {
    const current = creatorGroupMap.get(m.userId) ?? []
    current.push(m.groupId)
    creatorGroupMap.set(m.userId, current)
  }
  const visible = list.filter(
    (g) =>
      canSeeEntityByOwnerImportOrGroups({
        userId: user.id,
        userRole: user.role,
        userGroupIds,
        entity: {
          ...g,
          creatorGroupIds: g.createdByUserId ? (creatorGroupMap.get(g.createdByUserId) ?? []) : [],
        },
      })
  )
  res.json(visible)
})

app.get('/api/object-groups/summary', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const pageRaw = Number(req.query.page ?? 1)
  const pageSizeRaw = Number(req.query.pageSize ?? 20)
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1
  const pageSize = Number.isFinite(pageSizeRaw) && pageSizeRaw > 0 ? Math.min(100, Math.floor(pageSizeRaw)) : 20

  const list = await prisma.objectGroup.findMany({
    orderBy: { createdAt: 'desc' },
  })
  let visible = list
  if (user.role !== 'ADMIN') {
    const userGroupIds = await getUserGroupIds(user.id)
    const creatorIds = Array.from(
      new Set(list.map((g) => g.createdByUserId).filter((id): id is string => Boolean(id)))
    )
    const creatorMemberships =
      creatorIds.length > 0
        ? await prisma.groupMember.findMany({
            where: { userId: { in: creatorIds } },
            select: { userId: true, groupId: true },
          })
        : []
    const creatorGroupMap = new Map<string, string[]>()
    for (const m of creatorMemberships) {
      const current = creatorGroupMap.get(m.userId) ?? []
      current.push(m.groupId)
      creatorGroupMap.set(m.userId, current)
    }
    visible = list.filter(
      (g) =>
        canSeeEntityByOwnerImportOrGroups({
          userId: user.id,
          userRole: user.role,
          userGroupIds,
          entity: {
            ...g,
            creatorGroupIds: g.createdByUserId ? (creatorGroupMap.get(g.createdByUserId) ?? []) : [],
          },
        })
    )
  }
  const total = visible.length
  const start = (page - 1) * pageSize
  const pageGroups = visible.slice(start, start + pageSize)
  const groupIds = pageGroups.map((g) => g.id)
  const [objectCountRows, surveyCountRows] = await Promise.all([
    groupIds.length > 0
      ? prisma.objectGroupMembership.groupBy({
          by: ['groupId'],
          where: { groupId: { in: groupIds } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    groupIds.length > 0
      ? prisma.objectGroupPolicy.groupBy({
          by: ['groupId'],
          where: { groupId: { in: groupIds } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ])

  const objectCountByGroupId = new Map(objectCountRows.map((row) => [row.groupId, row._count._all]))
  const surveyCountByGroupId = new Map(surveyCountRows.map((row) => [row.groupId, row._count._all]))

  const items = pageGroups.map((g) => ({
    id: g.id,
    name: g.name,
    objectCount: objectCountByGroupId.get(g.id) ?? 0,
    surveyCount: surveyCountByGroupId.get(g.id) ?? 0,
  }))

  res.json({
    items,
    total,
    page,
    pageSize,
  })
})

app.post('/api/object-groups', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const actor = req.user
  const { name } = req.body as { name?: string }
  if (!name) {
    res.status(400).json({ error: 'MISSING_NAME' })
    return
  }
  const actorGroupIds = actor ? await getUserGroupIds(actor.id) : []
  const group = await prisma.objectGroup.create({
    data: { name, createdByUserId: actor?.id ?? null, adminGroupIds: actorGroupIds },
  })
  res.json(group)
})

app.put('/api/object-groups/:id', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const access = await canAccessObjectGroupById(user, id)
  if (!access.ok) return res.status(access.notFound ? 404 : 403).json({ error: access.notFound ? 'NOT_FOUND' : 'FORBIDDEN' })
  const { name } = req.body as { name?: string }
  const group = await prisma.objectGroup.update({ where: { id }, data: { name } })
  res.json(group)
})

app.delete('/api/object-groups/:id', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const access = await canAccessObjectGroupById(user, id)
  if (!access.ok) return res.status(access.notFound ? 404 : 403).json({ error: access.notFound ? 'NOT_FOUND' : 'FORBIDDEN' })
  await prisma.$transaction(async (tx) => {
    await tx.groupObjectGroup.deleteMany({ where: { objectGroupId: id } })
    await tx.objectGroupRule.deleteMany({ where: { groupId: id } })
    await tx.objectGroupPolicy.deleteMany({ where: { groupId: id } })
    await tx.objectGroupMembership.deleteMany({ where: { groupId: id } })
    const policies = await tx.objectSurveyPolicy.findMany({
      where: { createdByObjectGroupId: id },
      select: { id: true },
    })
    const policyIds = policies.map((p) => p.id)
    if (policyIds.length > 0) {
      await tx.objectSurveyTask.deleteMany({ where: { policyId: { in: policyIds } } })
      await tx.objectSurveyPolicy.deleteMany({ where: { id: { in: policyIds } } })
    }
    await tx.objectGroup.delete({ where: { id } })
  })
  res.json({ ok: true })
})

app.get('/api/object-groups/:id/members', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const access = await canAccessObjectGroupById(user, id)
  if (!access.ok) return res.status(access.notFound ? 404 : 403).json({ error: access.notFound ? 'NOT_FOUND' : 'FORBIDDEN' })
  const list = await prisma.objectGroupMembership.findMany({
    where: { groupId: id },
    include: { object: true },
  })
  res.json(list)
})

app.get('/api/object-groups/:id/rules', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const access = await canAccessObjectGroupById(user, id)
  if (!access.ok) return res.status(access.notFound ? 404 : 403).json({ error: access.notFound ? 'NOT_FOUND' : 'FORBIDDEN' })
  const rules = await prisma.objectGroupRule.findMany({ where: { groupId: id } })
  res.json(rules)
})

app.get('/api/object-groups/:id/rule-config', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const access = await canAccessObjectGroupById(user, id)
  if (!access.ok) return res.status(access.notFound ? 404 : 403).json({ error: access.notFound ? 'NOT_FOUND' : 'FORBIDDEN' })
  const config = await getObjectGroupRuleConfig(id)
  res.json(config)
})

app.put('/api/object-groups/:id/rule-config', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const access = await canAccessObjectGroupById(user, id)
  if (!access.ok) return res.status(access.notFound ? 404 : 403).json({ error: access.notFound ? 'NOT_FOUND' : 'FORBIDDEN' })
  const body = req.body as {
    matchMode?: string
    autoSyncEnabled?: boolean
    autoSyncIntervalMinutes?: number
  }
  const current = await getObjectGroupRuleConfig(id)
  let matchMode = current.matchMode
  let autoSyncEnabled = current.autoSyncEnabled
  let autoSyncIntervalMinutes = current.autoSyncIntervalMinutes

  if (body.matchMode !== undefined) {
    const matchModeRaw = String(body.matchMode ?? '').toUpperCase()
    const parsedMatchMode = matchModeRaw === 'OR' ? 'OR' : matchModeRaw === 'AND' ? 'AND' : null
    if (!parsedMatchMode) {
      res.status(400).json({ error: 'INVALID_MATCH_MODE' })
      return
    }
    matchMode = parsedMatchMode
  }

  if (body.autoSyncEnabled !== undefined) {
    if (typeof body.autoSyncEnabled !== 'boolean') {
      res.status(400).json({ error: 'INVALID_AUTO_SYNC_ENABLED' })
      return
    }
    autoSyncEnabled = body.autoSyncEnabled
  }

  if (body.autoSyncIntervalMinutes !== undefined) {
    const parsed = Number(body.autoSyncIntervalMinutes)
    if (!Number.isFinite(parsed) || parsed < 0) {
      res.status(400).json({ error: 'INVALID_AUTO_SYNC_INTERVAL_MINUTES' })
      return
    }
    autoSyncIntervalMinutes = Math.floor(parsed)
  }

  if (autoSyncEnabled && autoSyncIntervalMinutes <= 0) {
    res.status(400).json({ error: 'INVALID_AUTO_SYNC_INTERVAL_MINUTES' })
    return
  }

  await ensureObjectGroupRuleConfigTable()
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO "ObjectGroupRuleConfig" (
        "groupId",
        "matchMode",
        "autoSyncEnabled",
        "autoSyncIntervalMinutes",
        "updatedAt"
      )
      VALUES ($1, $2, $3, $4, now())
      ON CONFLICT ("groupId")
      DO UPDATE SET
        "matchMode" = EXCLUDED."matchMode",
        "autoSyncEnabled" = EXCLUDED."autoSyncEnabled",
        "autoSyncIntervalMinutes" = EXCLUDED."autoSyncIntervalMinutes",
        "updatedAt" = now()
    `,
    id,
    matchMode,
    autoSyncEnabled,
    autoSyncIntervalMinutes
  )
  const config = await getObjectGroupRuleConfig(id)
  res.json({ ok: true, ...config })
})

app.post('/api/object-groups/:id/rules', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const access = await canAccessObjectGroupById(user, id)
  if (!access.ok) return res.status(access.notFound ? 404 : 403).json({ error: access.notFound ? 'NOT_FOUND' : 'FORBIDDEN' })
  const { field, operator, value } = req.body as { field?: string; operator?: string; value?: string }
  if (!field || !operator || !value) {
    res.status(400).json({ error: 'MISSING_FIELDS' })
    return
  }
  const rule = await prisma.objectGroupRule.create({
    data: { groupId: id, field, operator, value },
  })
  res.json(rule)
})

app.delete('/api/object-group-rules/:id', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const existing = await prisma.objectGroupRule.findUnique({ where: { id }, select: { groupId: true } })
  if (!existing) return res.status(404).json({ error: 'NOT_FOUND' })
  const access = await canAccessObjectGroupById(user, existing.groupId)
  if (!access.ok) return res.status(403).json({ error: 'FORBIDDEN' })
  await prisma.objectGroupRule.delete({ where: { id } })
  res.json({ ok: true })
})

app.post('/api/object-groups/:id/apply-rules', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const access = await canAccessObjectGroupById(user, id)
  if (!access.ok) return res.status(access.notFound ? 404 : 403).json({ error: access.notFound ? 'NOT_FOUND' : 'FORBIDDEN' })
  const result = await applyObjectGroupRulesForGroup(id)
  res.json({ ok: true, ...result })
})
app.put('/api/object-groups/:id/members', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const access = await canAccessObjectGroupById(user, id)
  if (!access.ok) return res.status(access.notFound ? 404 : 403).json({ error: access.notFound ? 'NOT_FOUND' : 'FORBIDDEN' })
  const { objectIds } = req.body as { objectIds?: string[] }
  if (!Array.isArray(objectIds)) {
    res.status(400).json({ error: 'MISSING_OBJECT_IDS' })
    return
  }
  const existingObjects = await prisma.objectEntity.findMany({
    where: { id: { in: objectIds } },
    select: { id: true },
  })
  const validObjectIds = new Set(existingObjects.map((o) => o.id))
  const filteredObjectIds = objectIds.filter((oid) => validObjectIds.has(oid))
  const existing = await prisma.objectGroupMembership.findMany({ where: { groupId: id } })
  const existingIds = new Set(existing.map((m) => m.objectId))
  const nextIds = new Set(filteredObjectIds)
  const removed = Array.from(existingIds).filter((x) => !nextIds.has(x))

  await prisma.objectGroupMembership.deleteMany({ where: { groupId: id } })
  if (filteredObjectIds.length > 0) {
    await prisma.objectGroupMembership.createMany({
      data: filteredObjectIds.map((objectId) => ({ objectId, groupId: id })),
    })
  }

  if (removed.length > 0) {
    const policies = await prisma.objectSurveyPolicy.findMany({
      where: { objectId: { in: removed }, createdByObjectGroupId: id },
      select: { id: true },
    })
    const policyIds = policies.map((p) => p.id)
    if (policyIds.length > 0) {
      await prisma.objectSurveyTask.deleteMany({ where: { policyId: { in: policyIds } } })
      await prisma.objectSurveyPolicy.deleteMany({ where: { id: { in: policyIds } } })
    }
  }
  res.json({ ok: true })
})

app.get('/api/object-groups/:id/policies', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const access = await canAccessObjectGroupById(user, id)
  if (!access.ok) return res.status(access.notFound ? 404 : 403).json({ error: access.notFound ? 'NOT_FOUND' : 'FORBIDDEN' })
  const list = await prisma.objectGroupPolicy.findMany({ where: { groupId: id } })
  const map = await getObjectGroupPolicyPrefillConfigMap(list.map((p) => p.id))
  res.json(
    list.map((p) => ({
      ...p,
      allowLastSubmissionPrefill: map.get(p.id) ?? false,
    }))
  )
})

app.get('/api/object-groups/:id/summary', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const access = await canAccessObjectGroupById(user, id)
  if (!access.ok) return res.status(access.notFound ? 404 : 403).json({ error: access.notFound ? 'NOT_FOUND' : 'FORBIDDEN' })
  const memberships = await prisma.objectGroupMembership.findMany({ where: { groupId: id } })
  const objectIds = memberships.map((m) => m.objectId)
  await ensureTasksForObjectIds(objectIds)
  const policies = await prisma.objectGroupPolicy.findMany({
    where: { groupId: id },
    include: {
      questionnaire: { select: { id: true, title: true, status: true } },
    },
  })

  const total = await prisma.objectSurveyTask.count({
    where: {
      objectId: { in: objectIds },
      policy: { createdByObjectGroupId: id },
    },
  })
  const open = await prisma.objectSurveyTask.count({
    where: {
      objectId: { in: objectIds },
      status: 'OPEN',
      policy: { createdByObjectGroupId: id },
    },
  })
  const done = await prisma.objectSurveyTask.count({
    where: {
      objectId: { in: objectIds },
      status: 'DONE',
      policy: { createdByObjectGroupId: id },
    },
  })
  const closedByOther = await prisma.objectSurveyTask.count({
    where: {
      objectId: { in: objectIds },
      status: 'CLOSED_BY_OTHER',
      policy: { createdByObjectGroupId: id },
    },
  })
  const lastDone = await prisma.objectSurveyTask.findFirst({
    where: {
      objectId: { in: objectIds },
      status: 'DONE',
      completedAt: { not: null },
      policy: { createdByObjectGroupId: id },
    },
    orderBy: { completedAt: 'desc' },
  })
  const nextDue = await prisma.objectSurveyTask.findFirst({
    where: {
      objectId: { in: objectIds },
      status: 'OPEN',
      policy: { createdByObjectGroupId: id },
    },
    orderBy: { dueAt: 'asc' },
  })

  const groupedTaskStats =
    policies.length > 0
      ? await prisma.objectSurveyTask.groupBy({
          by: ['questionnaireId', 'status'],
          where: {
            objectId: { in: objectIds },
            policy: { createdByObjectGroupId: id },
          },
          _count: { _all: true },
        })
      : []
  const taskStatsByQuestionnaire = new Map<string, { open: number; done: number }>()
  for (const row of groupedTaskStats) {
    const current = taskStatsByQuestionnaire.get(row.questionnaireId) ?? { open: 0, done: 0 }
    if (row.status === 'OPEN') current.open += row._count._all
    if (row.status === 'DONE') current.done += row._count._all
    taskStatsByQuestionnaire.set(row.questionnaireId, current)
  }
  const surveyAssignments = policies.map((p) => {
    const stats = taskStatsByQuestionnaire.get(p.questionnaireId) ?? { open: 0, done: 0 }
    return {
      id: p.id,
      questionnaireId: p.questionnaireId,
      questionnaireTitle: p.questionnaire.title,
      questionnaireStatus: p.questionnaire.status,
      objectCount: objectIds.length,
      openCount: stats.open,
      doneCount: stats.done,
      dueAt: p.activeTo ?? null,
    }
  })

  res.json({
    total,
    open,
    done,
    closedByOther,
    lastCompletedAt: lastDone?.completedAt ?? null,
    nextDueAt: nextDue?.dueAt ?? null,
    surveyAssignments,
  })
})

app.get('/api/object-groups/:id/tasks', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const access = await canAccessObjectGroupById(user, id)
  if (!access.ok) return res.status(access.notFound ? 404 : 403).json({ error: access.notFound ? 'NOT_FOUND' : 'FORBIDDEN' })
  const memberships = await prisma.objectGroupMembership.findMany({ where: { groupId: id } })
  const objectIds = memberships.map((m) => m.objectId)
  await ensureTasksForObjectIds(objectIds)
  const list = await prisma.objectSurveyTask.findMany({
    where: { objectId: { in: objectIds } },
    include: {
      questionnaire: true,
      completedBy: true,
      object: true,
    },
    orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
  })
  res.json(list)
})

app.post('/api/object-groups/:id/policies', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const access = await canAccessObjectGroupById(user, id)
  if (!access.ok) return res.status(access.notFound ? 404 : 403).json({ error: access.notFound ? 'NOT_FOUND' : 'FORBIDDEN' })
  const { questionnaireId, frequency, intervalDays, roleNames, activeFrom, activeTo, allowLastSubmissionPrefill } = req.body as {
    questionnaireId?: string
    frequency?: Frequency
    intervalDays?: number
    roleNames?: string[]
    activeFrom?: string | null
    activeTo?: string | null
    allowLastSubmissionPrefill?: boolean
  }
  if (!questionnaireId || !frequency) {
    res.status(400).json({ error: 'MISSING_FIELDS' })
    return
  }
  const roleList = Array.isArray(roleNames) ? roleNames : []
  if (roleList.length > 0) {
    const defs = await prisma.roleDefinition.findMany({ where: { name: { in: roleList } } })
    if (defs.length !== roleList.length) {
      const missing = roleList.filter((r) => !defs.find((d) => d.name === r))
      res.status(400).json({ error: 'UNKNOWN_ROLES', missing })
      return
    }
  }
  const policy = await prisma.objectGroupPolicy.create({
    data: {
      groupId: id,
      questionnaireId,
      frequency,
      intervalDays: intervalDays ?? null,
      roleNames: roleList,
      activeFrom: activeFrom ? new Date(activeFrom) : null,
      activeTo: activeTo ? new Date(activeTo) : null,
    },
  })
  await setObjectGroupPolicyPrefillConfig(policy.id, Boolean(allowLastSubmissionPrefill))
  res.json(policy)
})

app.put('/api/object-group-policies/:id', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const existing = await prisma.objectGroupPolicy.findUnique({ where: { id }, select: { groupId: true } })
  if (!existing) return res.status(404).json({ error: 'NOT_FOUND' })
  const access = await canAccessObjectGroupById(user, existing.groupId)
  if (!access.ok) return res.status(403).json({ error: 'FORBIDDEN' })

  const { frequency, intervalDays, roleNames, activeFrom, activeTo, allowLastSubmissionPrefill } = req.body as {
    frequency?: Frequency
    intervalDays?: number
    roleNames?: string[]
    activeFrom?: string | null
    activeTo?: string | null
    allowLastSubmissionPrefill?: boolean
  }
  if (frequency === 'CUSTOM_DAYS' && (intervalDays === undefined || intervalDays === null || intervalDays < 0)) {
    res.status(400).json({ error: 'INVALID_INTERVAL_DAYS' })
    return
  }
  if (roleNames !== undefined) {
    if (!Array.isArray(roleNames)) {
      res.status(400).json({ error: 'INVALID_ROLE_NAMES' })
      return
    }
    if (roleNames.length > 0) {
      const defs = await prisma.roleDefinition.findMany({ where: { name: { in: roleNames } } })
      if (defs.length !== roleNames.length) {
        const missing = roleNames.filter((r) => !defs.find((d) => d.name === r))
        res.status(400).json({ error: 'UNKNOWN_ROLES', missing })
        return
      }
    }
  }

  const policy = await prisma.objectGroupPolicy.update({
    where: { id },
    data: {
      frequency,
      intervalDays:
        frequency === undefined
          ? intervalDays ?? undefined
          : frequency === 'ONCE'
            ? null
            : (intervalDays ?? undefined),
      roleNames: roleNames ?? undefined,
      activeFrom: activeFrom === undefined ? undefined : activeFrom ? new Date(activeFrom) : null,
      activeTo: activeTo === undefined ? undefined : activeTo ? new Date(activeTo) : null,
    },
  })
  if (allowLastSubmissionPrefill !== undefined) {
    await setObjectGroupPolicyPrefillConfig(id, Boolean(allowLastSubmissionPrefill))
  }
  res.json(policy)
})

app.delete('/api/object-group-policies/:id', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const existing = await prisma.objectGroupPolicy.findUnique({ where: { id }, select: { groupId: true } })
  if (!existing) return res.status(404).json({ error: 'NOT_FOUND' })
  const access = await canAccessObjectGroupById(user, existing.groupId)
  if (!access.ok) return res.status(403).json({ error: 'FORBIDDEN' })
  await ensureObjectPolicyPrefillConfigTables()
  await prisma.$executeRawUnsafe(
    `DELETE FROM "ObjectGroupPolicyPrefillConfig" WHERE "groupPolicyId" = $1`,
    id
  )
  await prisma.objectGroupPolicy.delete({ where: { id } })
  res.json({ ok: true })
})

app.get('/api/objects/:id/overrides', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const access = await canAccessObjectById(user, id)
  if (!access.ok) {
    res.status(access.notFound ? 404 : 403).json({ error: access.notFound ? 'NOT_FOUND' : 'FORBIDDEN' })
    return
  }
  const list = await prisma.objectPolicyOverride.findMany({ where: { objectId: id } })
  res.json(list)
})

app.post('/api/objects/:id/overrides', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const access = await canAccessObjectById(user, id)
  if (!access.ok) {
    res.status(access.notFound ? 404 : 403).json({ error: access.notFound ? 'NOT_FOUND' : 'FORBIDDEN' })
    return
  }
  const { questionnaireId, frequency, intervalDays, roleIds, activeFrom, activeTo } = req.body as {
    questionnaireId?: string
    frequency?: Frequency
    intervalDays?: number
    roleIds?: string[]
    activeFrom?: string | null
    activeTo?: string | null
  }
  if (!questionnaireId || !frequency || !Array.isArray(roleIds)) {
    res.status(400).json({ error: 'MISSING_FIELDS' })
    return
  }
  if (frequency === 'CUSTOM_DAYS' && (intervalDays === undefined || intervalDays === null || intervalDays < 0)) {
    res.status(400).json({ error: 'INVALID_INTERVAL_DAYS' })
    return
  }
  const defs = await prisma.roleDefinition.findMany({ where: { id: { in: roleIds } } })
  if (defs.length !== roleIds.length) {
    res.status(400).json({ error: 'UNKNOWN_ROLES' })
    return
  }
  const policy = await prisma.objectPolicyOverride.create({
    data: {
      objectId: id,
      questionnaireId,
      frequency,
      intervalDays: frequency === 'ONCE' ? null : (intervalDays ?? null),
      roleIds,
      activeFrom: activeFrom ? new Date(activeFrom) : null,
      activeTo: activeTo ? new Date(activeTo) : null,
    },
  })
  res.json(policy)
})

app.delete('/api/object-overrides/:id', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const existing = await prisma.objectPolicyOverride.findUnique({ where: { id }, select: { objectId: true } })
  if (!existing) return res.status(404).json({ error: 'NOT_FOUND' })
  const access = await canAccessObjectById(user, existing.objectId)
  if (!access.ok) return res.status(403).json({ error: 'FORBIDDEN' })
  await prisma.objectPolicyOverride.delete({ where: { id } })
  res.json({ ok: true })
})

app.post('/api/roles', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const actor = req.user
  const { name } = req.body as { name?: string }
  if (!name) {
    res.status(400).json({ error: 'MISSING_NAME' })
    return
  }
  const actorGroupIds = actor ? await getUserGroupIds(actor.id) : []
  const role = await prisma.roleDefinition.create({
    data: { name, createdByUserId: actor?.id ?? null, adminGroupIds: actorGroupIds },
  })
  res.json(role)
})

app.put('/api/roles/:id', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const { id } = req.params
  const access = await canAccessRoleById(user, id)
  if (!access.ok) return res.status(access.notFound ? 404 : 403).json({ error: access.notFound ? 'NOT_FOUND' : 'FORBIDDEN' })
  const { name } = req.body as { name?: string }
  const role = await prisma.roleDefinition.update({ where: { id }, data: { name } })
  res.json(role)
})

app.delete('/api/roles/:id', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const { id } = req.params
  const access = await canAccessRoleById(user, id)
  if (!access.ok) return res.status(access.notFound ? 404 : 403).json({ error: access.notFound ? 'NOT_FOUND' : 'FORBIDDEN' })
  await prisma.$transaction(async (tx) => {
    await tx.objectRoleAssignment.deleteMany({ where: { roleId: id } })
    const policies = await tx.objectSurveyPolicy.findMany({
      where: {},
      select: { id: true, roleIds: true },
    })
    for (const policy of policies) {
      const roleIds = Array.isArray(policy.roleIds) ? (policy.roleIds as string[]) : []
      if (roleIds.includes(id)) {
        const next = roleIds.filter((rid) => rid !== id)
        await tx.objectSurveyPolicy.update({ where: { id: policy.id }, data: { roleIds: next } })
      }
    }
    const overrides = await tx.objectPolicyOverride.findMany({
      select: { id: true, roleIds: true },
    })
    for (const override of overrides) {
      const roleIds = Array.isArray(override.roleIds) ? (override.roleIds as string[]) : []
      if (roleIds.includes(id)) {
        const next = roleIds.filter((rid) => rid !== id)
        await tx.objectPolicyOverride.update({ where: { id: override.id }, data: { roleIds: next } })
      }
    }
    await tx.roleDefinition.delete({ where: { id } })
  })
  res.json({ ok: true })
})

app.get('/api/objects/:id/assignments', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const access = await canAccessObjectById(user, id)
  if (!access.ok) {
    res.status(access.notFound ? 404 : 403).json({ error: access.notFound ? 'NOT_FOUND' : 'FORBIDDEN' })
    return
  }
  const list = await prisma.objectRoleAssignment.findMany({
    where: { objectId: id },
    include: { user: true, group: true, role: true },
  })
  res.json(list)
})

app.put('/api/objects/:id/assignments', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const access = await canAccessObjectById(user, id)
  if (!access.ok) {
    res.status(access.notFound ? 404 : 403).json({ error: access.notFound ? 'NOT_FOUND' : 'FORBIDDEN' })
    return
  }
  const { assignments } = req.body as {
    assignments?: Array<{ roleId: string; userId?: string; groupId?: string }>
  }
  if (!Array.isArray(assignments)) {
    res.status(400).json({ error: 'MISSING_ASSIGNMENTS' })
    return
  }
  await prisma.objectRoleAssignment.deleteMany({ where: { objectId: id } })
  if (assignments.length > 0) {
    await prisma.objectRoleAssignment.createMany({
      data: assignments.map((a) => ({
        objectId: id,
        roleId: a.roleId,
        userId: a.userId ?? null,
        groupId: a.groupId ?? null,
      })),
    })
  }
  res.json({ ok: true })
})

app.get('/api/objects/:id/policies', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const access = await canAccessObjectById(user, id)
  if (!access.ok) {
    res.status(access.notFound ? 404 : 403).json({ error: access.notFound ? 'NOT_FOUND' : 'FORBIDDEN' })
    return
  }
  await ensureTasksForObject(id)
  const list = await prisma.objectSurveyPolicy.findMany({
    where: { objectId: id, createdByObjectGroupId: null },
  })
  const map = await getObjectPolicyPrefillConfigMap(list.map((p) => p.id))
  res.json(
    list.map((p) => ({
      ...p,
      allowLastSubmissionPrefill: map.get(p.id) ?? false,
    }))
  )
})

app.get('/api/objects/:id/summary', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const access = await canAccessObjectById(user, id)
  if (!access.ok) {
    res.status(access.notFound ? 404 : 403).json({ error: access.notFound ? 'NOT_FOUND' : 'FORBIDDEN' })
    return
  }
  await ensureTasksForObject(id)
  const total = await prisma.objectSurveyTask.count({ where: { objectId: id } })
  const open = await prisma.objectSurveyTask.count({ where: { objectId: id, status: 'OPEN' } })
  const closedByOther = await prisma.objectSurveyTask.count({
    where: { objectId: id, status: 'CLOSED_BY_OTHER' },
  })
  const done = await prisma.objectSurveyTask.count({ where: { objectId: id, status: 'DONE' } })
  const lastDone = await prisma.objectSurveyTask.findFirst({
    where: { objectId: id, status: 'DONE', completedAt: { not: null } },
    orderBy: { completedAt: 'desc' },
  })
  const nextDue = await prisma.objectSurveyTask.findFirst({
    where: { objectId: id, status: 'OPEN' },
    orderBy: { dueAt: 'asc' },
  })
  res.json({
    total,
    open,
    done,
    closedByOther,
    lastCompletedAt: lastDone?.completedAt ?? null,
    nextDueAt: nextDue?.dueAt ?? null,
  })
})

app.get('/api/objects/:id/tasks', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const access = await canAccessObjectById(user, id)
  if (!access.ok) {
    res.status(access.notFound ? 404 : 403).json({ error: access.notFound ? 'NOT_FOUND' : 'FORBIDDEN' })
    return
  }
  await ensureTasksForObject(id)
  const list = await prisma.objectSurveyTask.findMany({
    where: { objectId: id },
    include: {
      questionnaire: true,
      completedBy: true,
    },
    orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
  })
  res.json(list)
})

app.post('/api/objects/:id/policies', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const access = await canAccessObjectById(user, id)
  if (!access.ok) {
    res.status(access.notFound ? 404 : 403).json({ error: access.notFound ? 'NOT_FOUND' : 'FORBIDDEN' })
    return
  }
  const { questionnaireId, frequency, intervalDays, roleIds, activeFrom, activeTo, allowLastSubmissionPrefill } = req.body as {
    questionnaireId?: string
    frequency?: Frequency
    intervalDays?: number
    roleIds?: string[]
    activeFrom?: string | null
    activeTo?: string | null
    allowLastSubmissionPrefill?: boolean
  }
  if (!questionnaireId || !frequency || !Array.isArray(roleIds)) {
    res.status(400).json({ error: 'MISSING_FIELDS' })
    return
  }
  if (frequency === 'CUSTOM_DAYS' && (intervalDays === undefined || intervalDays === null || intervalDays < 0)) {
    res.status(400).json({ error: 'INVALID_INTERVAL_DAYS' })
    return
  }
  const defs = await prisma.roleDefinition.findMany({ where: { id: { in: roleIds } } })
  if (defs.length !== roleIds.length) {
    res.status(400).json({ error: 'UNKNOWN_ROLES' })
    return
  }
  const policy = await prisma.objectSurveyPolicy.create({
    data: {
      objectId: id,
      questionnaireId,
      frequency,
      intervalDays: frequency === 'ONCE' ? null : (intervalDays ?? null),
      roleIds,
      activeFrom: activeFrom ? new Date(activeFrom) : null,
      activeTo: activeTo ? new Date(activeTo) : null,
    },
  })
  await setObjectPolicyPrefillConfig(policy.id, Boolean(allowLastSubmissionPrefill))
  res.json(policy)
})

app.put('/api/policies/:id', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const existing = await prisma.objectSurveyPolicy.findUnique({ where: { id }, select: { objectId: true } })
  if (!existing) return res.status(404).json({ error: 'NOT_FOUND' })
  const access = await canAccessObjectById(user, existing.objectId)
  if (!access.ok) return res.status(403).json({ error: 'FORBIDDEN' })
  const { frequency, intervalDays, roleIds, activeFrom, activeTo, allowLastSubmissionPrefill } = req.body as {
    frequency?: Frequency
    intervalDays?: number
    roleIds?: string[]
    activeFrom?: string | null
    activeTo?: string | null
    allowLastSubmissionPrefill?: boolean
  }
  if (frequency === 'CUSTOM_DAYS' && (intervalDays === undefined || intervalDays === null || intervalDays < 0)) {
    res.status(400).json({ error: 'INVALID_INTERVAL_DAYS' })
    return
  }
  if (roleIds !== undefined) {
    if (!Array.isArray(roleIds)) {
      res.status(400).json({ error: 'INVALID_ROLE_IDS' })
      return
    }
    const defs = await prisma.roleDefinition.findMany({ where: { id: { in: roleIds } } })
    if (defs.length !== roleIds.length) {
      res.status(400).json({ error: 'UNKNOWN_ROLES' })
      return
    }
  }
  const policy = await prisma.objectSurveyPolicy.update({
    where: { id },
    data: {
      frequency,
      intervalDays:
        frequency === undefined
          ? intervalDays ?? undefined
          : frequency === 'ONCE'
            ? null
            : (intervalDays ?? undefined),
      roleIds: roleIds ?? undefined,
      activeFrom: activeFrom === undefined ? undefined : activeFrom ? new Date(activeFrom) : null,
      activeTo: activeTo === undefined ? undefined : activeTo ? new Date(activeTo) : null,
    },
  })
  if (allowLastSubmissionPrefill !== undefined) {
    await setObjectPolicyPrefillConfig(id, Boolean(allowLastSubmissionPrefill))
  }
  res.json(policy)
})

app.delete('/api/policies/:id', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' })
  const existing = await prisma.objectSurveyPolicy.findUnique({ where: { id }, select: { objectId: true } })
  if (!existing) return res.status(404).json({ error: 'NOT_FOUND' })
  const access = await canAccessObjectById(user, existing.objectId)
  if (!access.ok) return res.status(403).json({ error: 'FORBIDDEN' })
  await prisma.$transaction(async (tx) => {
    await tx.objectSurveyTask.deleteMany({ where: { policyId: id } })
    await tx.$executeRawUnsafe(`DELETE FROM "ObjectSurveyPolicyPrefillConfig" WHERE "policyId" = $1`, id)
    await tx.objectSurveyPolicy.delete({ where: { id } })
  })
  res.json({ ok: true })
})

app.get('/api/object-import-definitions', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const actor = req.user
  if (!actor) return res.status(401).json({ error: 'UNAUTHORIZED' })
  await ensureExternalObjectImportTables()
  const rows = (await prisma.$queryRawUnsafe(`
    SELECT *
    FROM "ExternalObjectImportDefinition"
    ORDER BY "name" ASC
  `)) as ExternalObjectImportDefinitionRow[]
  if (actor.role === 'ADMIN') {
    res.json(rows.map(toImportDefinitionView))
    return
  }
  const actorGroupIds = await getUserGroupIds(actor.id)
  const filtered = rows.filter((row) =>
    canManageExternalImportDefinitionByScope({
      userId: actor.id,
      userRole: actor.role,
      userGroupIds: actorGroupIds,
      definition: row,
    })
  )
  res.json(filtered.map(toImportDefinitionView))
})

app.get('/api/object-import-definitions/:id', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const actor = req.user
  if (!actor) return res.status(401).json({ error: 'UNAUTHORIZED' })
  await ensureExternalObjectImportTables()
  const { id } = req.params
  const rows = (await prisma.$queryRawUnsafe(
    `
      SELECT *
      FROM "ExternalObjectImportDefinition"
      WHERE "id" = $1
      LIMIT 1
    `,
    id
  )) as ExternalObjectImportDefinitionRow[]
  const row = rows[0]
  if (!row) return res.status(404).json({ error: 'NOT_FOUND' })
  if (actor.role !== 'ADMIN') {
    const actorGroupIds = await getUserGroupIds(actor.id)
    const allowed = canManageExternalImportDefinitionByScope({
      userId: actor.id,
      userRole: actor.role,
      userGroupIds: actorGroupIds,
      definition: row,
    })
    if (!allowed) return res.status(403).json({ error: 'FORBIDDEN' })
  }
  res.json(toImportDefinitionView(row))
})

app.get(
  '/api/object-import-definitions/:id/runs',
  authMiddleware,
  requireRole(['ADMIN', 'EDITOR']),
  async (req, res) => {
    const actor = req.user
    if (!actor) return res.status(401).json({ error: 'UNAUTHORIZED' })
    await ensureExternalObjectImportTables()
    const { id } = req.params
    const limitRaw = Number(req.query.limit ?? 50)
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT * FROM "ExternalObjectImportDefinition" WHERE "id" = $1 LIMIT 1`,
      id
    )) as ExternalObjectImportDefinitionRow[]
    const definition = rows[0]
    if (!definition) return res.status(404).json({ error: 'NOT_FOUND' })
    if (actor.role !== 'ADMIN') {
      const actorGroupIds = await getUserGroupIds(actor.id)
      const allowed = canManageExternalImportDefinitionByScope({
        userId: actor.id,
        userRole: actor.role,
        userGroupIds: actorGroupIds,
        definition,
      })
      if (!allowed) return res.status(403).json({ error: 'FORBIDDEN' })
    }
    const runs = (await prisma.$queryRawUnsafe(
      `
        SELECT *
        FROM "ExternalObjectImportRun"
        WHERE "definitionId" = $1
        ORDER BY "startedAt" DESC
        LIMIT $2
      `,
      id,
      limit
    )) as ExternalObjectImportRunRow[]
    res.json(runs)
  }
)

app.post('/api/object-import-definitions', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const actor = req.user
  if (!actor) return res.status(401).json({ error: 'UNAUTHORIZED' })
  await ensureExternalObjectImportTables()
  const actorGroupIds = actor.role === 'ADMIN' ? [] : await getUserGroupIds(actor.id)
  const {
    name,
    description,
    importMode,
    sqlQuery,
    sqlHost,
    sqlPort,
    sqlDatabase,
    sqlUsername,
    sqlPassword,
    sqlEncrypt,
    sqlTrustServerCertificate,
    mapObjectIdColumn,
    mapTypeColumn,
    mapNameColumn,
    mapDescriptionColumn,
    mapMetadataColumn,
    mapUserIdColumn,
    mapUserEmailColumn,
    mapUserDisplayNameColumn,
    mapRoleNameColumn,
    scheduleEveryMinutes,
    enabled,
    deleteMissing,
  } = req.body as any

  if (!name || !String(name).trim()) return res.status(400).json({ error: 'MISSING_NAME' })
  if (!sqlQuery || !String(sqlQuery).trim()) return res.status(400).json({ error: 'MISSING_SQL_QUERY' })
  if (!sqlHost || !String(sqlHost).trim()) return res.status(400).json({ error: 'MISSING_SQL_HOST' })
  if (!sqlDatabase || !String(sqlDatabase).trim()) return res.status(400).json({ error: 'MISSING_SQL_DATABASE' })
  if (!sqlUsername || !String(sqlUsername).trim()) return res.status(400).json({ error: 'MISSING_SQL_USERNAME' })
  if (!sqlPassword || !String(sqlPassword).trim()) return res.status(400).json({ error: 'MISSING_SQL_PASSWORD' })

  const id = crypto.randomUUID()
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO "ExternalObjectImportDefinition" (
        "id","name","description","importMode","sqlQuery","sqlHost","sqlPort","sqlDatabase","sqlUsername","sqlPassword",
        "sqlEncrypt","sqlTrustServerCertificate","mapObjectIdColumn","mapTypeColumn","mapNameColumn","mapDescriptionColumn","mapMetadataColumn",
        "mapUserIdColumn","mapUserEmailColumn","mapUserDisplayNameColumn","mapRoleNameColumn",
        "scheduleEveryMinutes","enabled","deleteMissing","createdByUserId","importedByUserId","adminGroupIds","createdAt","updatedAt"
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27::jsonb, now(), now())
    `,
    id,
    String(name).trim(),
    description ? String(description).trim() : null,
    normalizeExternalImportMode(importMode),
    String(sqlQuery),
    String(sqlHost).trim(),
    Number.isFinite(Number(sqlPort)) ? Number(sqlPort) : 1433,
    String(sqlDatabase).trim(),
    String(sqlUsername).trim(),
    String(sqlPassword),
    sqlEncrypt !== false,
    !!sqlTrustServerCertificate,
    typeof mapObjectIdColumn === 'string' && mapObjectIdColumn.trim() ? mapObjectIdColumn.trim() : 'object_id',
    typeof mapTypeColumn === 'string' && mapTypeColumn.trim() ? mapTypeColumn.trim() : 'type',
    typeof mapNameColumn === 'string' && mapNameColumn.trim() ? mapNameColumn.trim() : 'name',
    typeof mapDescriptionColumn === 'string' && mapDescriptionColumn.trim() ? mapDescriptionColumn.trim() : 'description',
    typeof mapMetadataColumn === 'string' && mapMetadataColumn.trim() ? mapMetadataColumn.trim() : 'meta_json',
    typeof mapUserIdColumn === 'string' && mapUserIdColumn.trim() ? mapUserIdColumn.trim() : 'user_id',
    typeof mapUserEmailColumn === 'string' && mapUserEmailColumn.trim() ? mapUserEmailColumn.trim() : 'email',
    typeof mapUserDisplayNameColumn === 'string' && mapUserDisplayNameColumn.trim() ? mapUserDisplayNameColumn.trim() : 'display_name',
    typeof mapRoleNameColumn === 'string' && mapRoleNameColumn.trim() ? mapRoleNameColumn.trim() : 'role_name',
    Number.isFinite(Number(scheduleEveryMinutes)) && Number(scheduleEveryMinutes) > 0
      ? Number(scheduleEveryMinutes)
      : null,
    enabled !== false,
    !!deleteMissing,
    actor.id,
    actor.id,
    JSON.stringify(actorGroupIds)
  )
  const row = (await prisma.$queryRawUnsafe(
    `SELECT * FROM "ExternalObjectImportDefinition" WHERE "id" = $1 LIMIT 1`,
    id
  )) as ExternalObjectImportDefinitionRow[]
  res.json(toImportDefinitionView(row[0]))
})

app.put('/api/object-import-definitions/:id', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const actor = req.user
  if (!actor) return res.status(401).json({ error: 'UNAUTHORIZED' })
  await ensureExternalObjectImportTables()
  const { id } = req.params
  const currentRows = (await prisma.$queryRawUnsafe(
    `SELECT * FROM "ExternalObjectImportDefinition" WHERE "id" = $1 LIMIT 1`,
    id
  )) as ExternalObjectImportDefinitionRow[]
  const current = currentRows[0]
  if (!current) return res.status(404).json({ error: 'NOT_FOUND' })
  if (actor.role !== 'ADMIN') {
    const actorGroupIds = await getUserGroupIds(actor.id)
    const allowed = canManageExternalImportDefinitionByScope({
      userId: actor.id,
      userRole: actor.role,
      userGroupIds: actorGroupIds,
      definition: current,
    })
    if (!allowed) return res.status(403).json({ error: 'FORBIDDEN' })
  }

  const {
    name,
    description,
    importMode,
    sqlQuery,
    sqlHost,
    sqlPort,
    sqlDatabase,
    sqlUsername,
    sqlPassword,
    sqlEncrypt,
    sqlTrustServerCertificate,
    mapObjectIdColumn,
    mapTypeColumn,
    mapNameColumn,
    mapDescriptionColumn,
    mapMetadataColumn,
    mapUserIdColumn,
    mapUserEmailColumn,
    mapUserDisplayNameColumn,
    mapRoleNameColumn,
    scheduleEveryMinutes,
    enabled,
    deleteMissing,
  } = req.body as any

  const nextPassword =
    sqlPassword !== undefined && String(sqlPassword).trim() !== '' ? String(sqlPassword) : current.sqlPassword
  await prisma.$executeRawUnsafe(
    `
      UPDATE "ExternalObjectImportDefinition"
      SET
        "name" = $2,
        "description" = $3,
        "importMode" = $4,
        "sqlQuery" = $5,
        "sqlHost" = $6,
        "sqlPort" = $7,
        "sqlDatabase" = $8,
        "sqlUsername" = $9,
        "sqlPassword" = $10,
        "sqlEncrypt" = $11,
        "sqlTrustServerCertificate" = $12,
        "mapObjectIdColumn" = $13,
        "mapTypeColumn" = $14,
        "mapNameColumn" = $15,
        "mapDescriptionColumn" = $16,
        "mapMetadataColumn" = $17,
        "mapUserIdColumn" = $18,
        "mapUserEmailColumn" = $19,
        "mapUserDisplayNameColumn" = $20,
        "mapRoleNameColumn" = $21,
        "scheduleEveryMinutes" = $22,
        "enabled" = $23,
        "deleteMissing" = $24,
        "importedByUserId" = $25,
        "updatedAt" = now()
      WHERE "id" = $1
    `,
    id,
    typeof name === 'string' && name.trim() ? name.trim() : current.name,
    description === undefined ? current.description : description ? String(description).trim() : null,
    importMode === undefined
      ? normalizeExternalImportMode(current.importMode)
      : normalizeExternalImportMode(importMode),
    typeof sqlQuery === 'string' && sqlQuery.trim() ? String(sqlQuery) : current.sqlQuery,
    typeof sqlHost === 'string' && sqlHost.trim() ? String(sqlHost).trim() : current.sqlHost,
    Number.isFinite(Number(sqlPort)) ? Number(sqlPort) : current.sqlPort,
    typeof sqlDatabase === 'string' && sqlDatabase.trim() ? String(sqlDatabase).trim() : current.sqlDatabase,
    typeof sqlUsername === 'string' && sqlUsername.trim() ? String(sqlUsername).trim() : current.sqlUsername,
    nextPassword,
    sqlEncrypt === undefined ? current.sqlEncrypt : sqlEncrypt !== false,
    sqlTrustServerCertificate === undefined ? current.sqlTrustServerCertificate : !!sqlTrustServerCertificate,
    typeof mapObjectIdColumn === 'string' && mapObjectIdColumn.trim()
      ? mapObjectIdColumn.trim()
      : current.mapObjectIdColumn || 'object_id',
    typeof mapTypeColumn === 'string' && mapTypeColumn.trim()
      ? mapTypeColumn.trim()
      : current.mapTypeColumn || 'type',
    typeof mapNameColumn === 'string' && mapNameColumn.trim()
      ? mapNameColumn.trim()
      : current.mapNameColumn || 'name',
    typeof mapDescriptionColumn === 'string' && mapDescriptionColumn.trim()
      ? mapDescriptionColumn.trim()
      : current.mapDescriptionColumn || 'description',
    typeof mapMetadataColumn === 'string' && mapMetadataColumn.trim()
      ? mapMetadataColumn.trim()
      : current.mapMetadataColumn || 'meta_json',
    typeof mapUserIdColumn === 'string' && mapUserIdColumn.trim()
      ? mapUserIdColumn.trim()
      : current.mapUserIdColumn || 'user_id',
    typeof mapUserEmailColumn === 'string' && mapUserEmailColumn.trim()
      ? mapUserEmailColumn.trim()
      : current.mapUserEmailColumn || 'email',
    typeof mapUserDisplayNameColumn === 'string' && mapUserDisplayNameColumn.trim()
      ? mapUserDisplayNameColumn.trim()
      : current.mapUserDisplayNameColumn || 'display_name',
    typeof mapRoleNameColumn === 'string' && mapRoleNameColumn.trim()
      ? mapRoleNameColumn.trim()
      : current.mapRoleNameColumn || 'role_name',
    scheduleEveryMinutes === undefined
      ? current.scheduleEveryMinutes
      : Number.isFinite(Number(scheduleEveryMinutes)) && Number(scheduleEveryMinutes) > 0
        ? Number(scheduleEveryMinutes)
        : null,
    enabled === undefined ? current.enabled : enabled !== false,
    deleteMissing === undefined ? current.deleteMissing : !!deleteMissing,
    actor.id
  )
  const row = (await prisma.$queryRawUnsafe(
    `SELECT * FROM "ExternalObjectImportDefinition" WHERE "id" = $1 LIMIT 1`,
    id
  )) as ExternalObjectImportDefinitionRow[]
  res.json(toImportDefinitionView(row[0]))
})

app.delete('/api/object-import-definitions/:id', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const actor = req.user
  if (!actor) return res.status(401).json({ error: 'UNAUTHORIZED' })
  await ensureExternalObjectImportTables()
  const { id } = req.params
  const currentRows = (await prisma.$queryRawUnsafe(
    `SELECT * FROM "ExternalObjectImportDefinition" WHERE "id" = $1 LIMIT 1`,
    id
  )) as ExternalObjectImportDefinitionRow[]
  const current = currentRows[0]
  if (!current) return res.status(404).json({ error: 'NOT_FOUND' })
  if (actor.role !== 'ADMIN') {
    const actorGroupIds = await getUserGroupIds(actor.id)
    const allowed = canManageExternalImportDefinitionByScope({
      userId: actor.id,
      userRole: actor.role,
      userGroupIds: actorGroupIds,
      definition: current,
    })
    if (!allowed) return res.status(403).json({ error: 'FORBIDDEN' })
  }
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`DELETE FROM "ExternalObjectImportItem" WHERE "definitionId" = $1`, id)
    await tx.$executeRawUnsafe(`DELETE FROM "ExternalObjectImportDefinition" WHERE "id" = $1`, id)
  })
  res.json({ ok: true })
})

app.post('/api/object-import-definitions/:id/test', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const actor = req.user
  if (!actor) return res.status(401).json({ error: 'UNAUTHORIZED' })
  await ensureExternalObjectImportTables()
  const { id } = req.params
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT * FROM "ExternalObjectImportDefinition" WHERE "id" = $1 LIMIT 1`,
    id
  )) as ExternalObjectImportDefinitionRow[]
  const definition = rows[0]
  if (!definition) return res.status(404).json({ error: 'NOT_FOUND' })
  if (actor.role !== 'ADMIN') {
    const actorGroupIds = await getUserGroupIds(actor.id)
    const allowed = canManageExternalImportDefinitionByScope({
      userId: actor.id,
      userRole: actor.role,
      userGroupIds: actorGroupIds,
      definition,
    })
    if (!allowed) return res.status(403).json({ error: 'FORBIDDEN' })
  }

  let pool: sql.ConnectionPool | null = null
  try {
    pool = await sql.connect({
      server: definition.sqlHost,
      port: definition.sqlPort || 1433,
      database: definition.sqlDatabase,
      user: definition.sqlUsername,
      password: definition.sqlPassword,
      options: {
        encrypt: definition.sqlEncrypt,
        trustServerCertificate: definition.sqlTrustServerCertificate,
      },
    })
    const result = await pool.request().query(definition.sqlQuery)
    const rawRows = normalizeSqlRows(result.recordset)
    const importMode = normalizeExternalImportMode(definition.importMode)
    if (importMode === 'USERS_LDAP') {
      const normalized = normalizeImportedLdapUserRows(rawRows, {
        userIdColumn: definition.mapUserIdColumn,
        userEmailColumn: definition.mapUserEmailColumn,
        userDisplayNameColumn: definition.mapUserDisplayNameColumn,
      })
      res.json({
        ok: true,
        rowCount: rawRows.length,
        normalizedCount: normalized.rows.length,
        warnings: normalized.warnings,
        sample: normalized.rows.slice(0, 20),
      })
    } else if (importMode === 'PEOPLE_ROLES_OBJECT') {
      const normalized = normalizeImportedPersonRoleRows(rawRows, {
        objectIdColumn: definition.mapObjectIdColumn,
        userIdColumn: definition.mapUserIdColumn,
        userEmailColumn: definition.mapUserEmailColumn,
        userDisplayNameColumn: definition.mapUserDisplayNameColumn,
        roleNameColumn: definition.mapRoleNameColumn,
      })
      res.json({
        ok: true,
        rowCount: rawRows.length,
        normalizedCount: normalized.rows.length,
        warnings: normalized.warnings,
        sample: normalized.rows.slice(0, 20),
      })
    } else {
      const normalized = normalizeImportedObjectRows(rawRows, {
        objectIdColumn: definition.mapObjectIdColumn,
        typeColumn: definition.mapTypeColumn,
        nameColumn: definition.mapNameColumn,
        descriptionColumn: definition.mapDescriptionColumn,
        metadataColumn: definition.mapMetadataColumn,
      })
      const metadataMappedCount = normalized.rows.filter((row) => !!row.metadata).length
      res.json({
        ok: true,
        rowCount: rawRows.length,
        normalizedCount: normalized.rows.length,
        metadataMappedCount,
        warnings: normalized.warnings,
        sample: normalized.rows.slice(0, 20),
      })
    }
  } catch (error) {
    res.status(400).json({
      error: 'IMPORT_TEST_FAILED',
      details: error instanceof Error ? error.message : 'Unknown error',
    })
  } finally {
    if (pool) await pool.close()
  }
})

app.post('/api/object-import-definitions/:id/run', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const actor = req.user
  if (!actor) return res.status(401).json({ error: 'UNAUTHORIZED' })
  await ensureExternalObjectImportTables()
  const { id } = req.params
  const { dryRun } = req.body as { dryRun?: boolean }
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT * FROM "ExternalObjectImportDefinition" WHERE "id" = $1 LIMIT 1`,
    id
  )) as ExternalObjectImportDefinitionRow[]
  const definition = rows[0]
  if (!definition) return res.status(404).json({ error: 'NOT_FOUND' })
  if (!definition.enabled && !dryRun) return res.status(400).json({ error: 'IMPORT_DEFINITION_DISABLED' })

  const actorGroupIds = actor.role === 'ADMIN' ? [] : await getUserGroupIds(actor.id)
  if (actor.role !== 'ADMIN') {
    const allowed = canManageExternalImportDefinitionByScope({
      userId: actor.id,
      userRole: actor.role,
      userGroupIds: actorGroupIds,
      definition,
    })
    if (!allowed) return res.status(403).json({ error: 'FORBIDDEN' })
  }

  try {
    const result = await executeExternalObjectImport(definition, {
      dryRun: !!dryRun,
      actor,
      actorGroupIds,
      enforceObjectScope: true,
    })
    res.json({ ok: true, summary: result.summary, warnings: result.warnings })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    res.status(400).json({ error: 'IMPORT_RUN_FAILED', details: message })
  }
})

app.post('/api/import/bulk', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const actor = req.user
  if (!actor) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const actorGroupIds = actor ? await getUserGroupIds(actor.id) : []
  const { users, objects, roles, assignments, policies, object_groups, group_memberships, group_policies } = req.body as {
    users?: Array<{ email: string; password?: string; role?: Role; external_id?: string; display_name?: string }>
    objects?: Array<{ object_id: string; object_name: string; object_type?: string; description?: string; meta_json?: unknown }>
    roles?: Array<{ role_name: string }>
    assignments?: Array<{
      object_id: string
      role_name: string
      user_email?: string
      user_id?: string
      group_name?: string
    }>
    policies?: Array<{
      object_id: string
      questionnaire_title: string
      frequency: Frequency
      interval_days?: number
      role_names: string
      active_from?: string
      active_to?: string
    }>
    object_groups?: Array<{ group_name: string }>
    group_memberships?: Array<{ group_name: string; object_id: string }>
    group_policies?: Array<{
      group_name: string
      questionnaire_title: string
      frequency: Frequency
      interval_days?: number
      role_names: string
      active_from?: string
      active_to?: string
    }>
  }

  const errors: string[] = []
  const objMap = new Map<string, string>()
  const groupMap = new Map<string, string>()
  let importedUsers = 0
  let skippedUsers = 0
  let invalidUserRoles = 0
  let usersMissingEmail = 0
  let usersParsed = 0

  const normalizeEmail = (value?: string | null) => (value ?? '').trim().toLowerCase()
  const userRows = (users ?? [])
    .map((row) => {
      const externalRaw = String(row.external_id ?? '').trim()
      return {
        email: normalizeEmail(row.email),
        password: row.password ?? '',
        roleRaw: String(row.role ?? 'VIEWER').trim().toUpperCase(),
        externalId: externalRaw ? externalRaw : null,
        displayName: String(row.display_name ?? '').trim() || null,
      }
    })
    .filter((row) => {
      if (!row.email) {
        usersMissingEmail += 1
        return false
      }
      return true
    })

  usersParsed = userRows.length

  const allowedRoles = actor.role === 'ADMIN' ? ['ADMIN', 'EDITOR', 'VIEWER'] : ['EDITOR', 'VIEWER']
  const invalidUsers = userRows.filter((row) => !allowedRoles.includes(row.roleRaw))
  invalidUserRoles = invalidUsers.length
  invalidUsers.forEach((row) => {
    errors.push(`Invalid role for user ${row.email}: ${row.roleRaw}`)
  })

  const validUsers = userRows.filter((row) => allowedRoles.includes(row.roleRaw))

  if (validUsers.length > 0) {
    const existing = await prisma.user.findMany({
      where: { email: { in: validUsers.map((u) => u.email) } },
      select: { id: true, email: true },
    })
    const existingEmails = new Set(existing.map((u) => u.email))
    const newUsers = validUsers.filter((u) => !existingEmails.has(u.email))
    skippedUsers = validUsers.length - newUsers.length

    const chunk = <T>(arr: T[], size: number) => {
      const res: T[][] = []
      for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size))
      return res
    }

      for (const batch of chunk(newUsers, 200)) {
        const data = await Promise.all(
          batch.map(async (row) => ({
            email: row.email,
            role: row.roleRaw as Role,
            externalId: row.externalId || normalizeGeneratedExternalIdBase(row.email),
            displayName: row.displayName,
            passwordHash: await bcrypt.hash(row.password || crypto.randomUUID(), 10),
            imported: true,
            importedByUserId: actor?.id ?? null,
          }))
        )
        if (data.length > 0) {
          const created = await prisma.user.createMany({ data, skipDuplicates: true })
          importedUsers += created.count
        }
      }
    }

  await prisma.$transaction(async (tx) => {
    const normalizeName = (value?: string | null) => (value ?? '').trim()
    const normalizeExternalId = (value?: string | null) => (value ?? '').toString().trim()
    const getObjectIdByExternalId = async (externalRaw?: string | null) => {
      const externalId = normalizeExternalId(externalRaw)
      if (!externalId) return null
      const existing = await tx.objectEntity.findUnique({ where: { externalId } })
      return existing?.id ?? null
    }

    for (const row of objects ?? []) {
      if (!row.object_name || !row.object_id) {
        errors.push('Object missing object_id or object_name')
        continue
      }
      const objectName = normalizeName(row.object_name)
      const externalId = normalizeExternalId(row.object_id)
      if (!objectName || !externalId) {
        errors.push('Object missing object_id or object_name')
        continue
      }
      if (actor.role !== 'ADMIN') {
        const existingObject = await tx.objectEntity.findUnique({
          where: { externalId },
          select: { createdByUserId: true, importedByUserId: true, adminGroupIds: true },
        })
        if (
          existingObject &&
          !canManageObjectByScope({
            userId: actor.id,
            userRole: actor.role,
            userGroupIds: actorGroupIds,
            object: existingObject,
          })
        ) {
          errors.push(`Object not allowed for import update: ${externalId}`)
          continue
        }
      }
      const obj = await tx.objectEntity.upsert({
        where: { externalId },
        update: {
          name: objectName,
          type: row.object_type,
          metadata: row.meta_json ?? undefined,
          description: row.description ?? undefined,
          importedByUserId: actor?.id ?? undefined,
        },
        create: {
          name: objectName,
          type: row.object_type,
          metadata: row.meta_json ?? undefined,
          externalId,
          description: row.description ?? undefined,
          createdByUserId: actor?.id ?? null,
          importedByUserId: actor?.id ?? null,
          adminGroupIds: actorGroupIds,
        },
      })
      objMap.set(externalId, obj.id)
    }

    for (const row of object_groups ?? []) {
      if (!row.group_name) continue
      if (actor.role !== 'ADMIN') {
        const existingGroup = await tx.objectGroup.findUnique({
          where: { name: row.group_name },
          select: { createdByUserId: true, importedByUserId: true, adminGroupIds: true },
        })
        if (
          existingGroup &&
          !canSeeEntityByOwnerImportOrGroups({
            userId: actor.id,
            userRole: actor.role,
            userGroupIds: actorGroupIds,
            entity: existingGroup,
          })
        ) {
          errors.push(`Object group not allowed for import update: ${row.group_name}`)
          continue
        }
      }
      const group = await tx.objectGroup.upsert({
        where: { name: row.group_name },
        update: { importedByUserId: actor?.id ?? undefined },
        create: {
          name: row.group_name,
          createdByUserId: actor?.id ?? null,
          importedByUserId: actor?.id ?? null,
          adminGroupIds: actorGroupIds,
        },
      })
      groupMap.set(row.group_name, group.id)
    }

    for (const row of roles ?? []) {
      if (!row.role_name) {
        errors.push('Role missing role_name')
        continue
      }
      if (actor.role !== 'ADMIN') {
        const existingRole = await tx.roleDefinition.findUnique({
          where: { name: row.role_name },
          select: { createdByUserId: true, importedByUserId: true, adminGroupIds: true },
        })
        if (
          existingRole &&
          !canSeeEntityByOwnerImportOrGroups({
            userId: actor.id,
            userRole: actor.role,
            userGroupIds: actorGroupIds,
            entity: existingRole,
          })
        ) {
          errors.push(`Role not allowed for import update: ${row.role_name}`)
          continue
        }
      }
      await tx.roleDefinition.upsert({
        where: { name: row.role_name },
        update: { importedByUserId: actor?.id ?? undefined },
        create: {
          name: row.role_name,
          createdByUserId: actor?.id ?? null,
          importedByUserId: actor?.id ?? null,
          adminGroupIds: actorGroupIds,
        },
      })
    }

    for (const row of group_memberships ?? []) {
      if (!row.group_name || !row.object_id) {
        errors.push('Group membership missing group_name or object_id')
        continue
      }
      const groupId =
        groupMap.get(row.group_name) ??
        (await tx.objectGroup.upsert({
          where: { name: row.group_name },
          update: { importedByUserId: actor?.id ?? undefined },
          create: {
            name: row.group_name,
            createdByUserId: actor?.id ?? null,
            importedByUserId: actor?.id ?? null,
            adminGroupIds: actorGroupIds,
          },
        })).id
      groupMap.set(row.group_name, groupId)
      const objectId =
        objMap.get(normalizeExternalId(row.object_id)) ??
        (await getObjectIdByExternalId(row.object_id))
      if (!objectId) {
        errors.push(`Object not found: ${row.object_id}`)
        continue
      }
      await tx.objectGroupMembership.create({
        data: { groupId, objectId },
      })
    }

    for (const row of assignments ?? []) {
      if (!row.object_id || !row.role_name) {
        errors.push('Assignment missing object_id or role_name')
        continue
      }
      const objectId =
        objMap.get(normalizeExternalId(row.object_id)) ??
        (await getObjectIdByExternalId(row.object_id))
      if (!objectId) {
        errors.push(`Object not found: ${row.object_id}`)
        continue
      }
      const role = await tx.roleDefinition.findUnique({
        where: { name: row.role_name },
      })
      if (!role) {
        errors.push(`Role not found: ${row.role_name}`)
        continue
      }
      let userId: string | null = null
      if (row.user_email) {
        const user = await tx.user.findUnique({ where: { email: row.user_email } })
        userId = user?.id ?? null
      } else if (row.user_id) {
        const externalId = String(row.user_id).trim()
        const user = await tx.user.findUnique({ where: { externalId } })
        userId = user?.id ?? null
      }
      let groupId: string | null = null
      if (row.group_name) {
        const group = await tx.group.findUnique({ where: { name: row.group_name } })
        groupId = group?.id ?? null
      }
      if (!userId && !groupId) {
        errors.push(`Assignment missing user/group: ${row.object_id} / ${row.role_name}`)
        continue
      }
      await tx.objectRoleAssignment.create({
        data: {
          objectId,
          roleId: role.id,
          userId,
          groupId,
        },
      })
    }

    for (const row of policies ?? []) {
      if (!row.object_id || !row.questionnaire_title || !row.frequency || !row.role_names) {
        errors.push(`Policy missing fields for object ${row.object_id}`)
        continue
      }
      const objectId =
        objMap.get(normalizeExternalId(row.object_id)) ??
        (await getObjectIdByExternalId(row.object_id))
      if (!objectId) {
        errors.push(`Object not found: ${row.object_id}`)
        continue
      }
      const questionnaire = await tx.questionnaire.findFirst({
        where: { title: row.questionnaire_title },
      })
      if (!questionnaire) {
        errors.push(`Questionnaire not found: ${row.questionnaire_title}`)
        continue
      }
      const roleNames = row.role_names.split(',').map((r) => r.trim()).filter(Boolean)
      const roleList = await tx.roleDefinition.findMany({
        where: { name: { in: roleNames } },
      })
      if (roleList.length !== roleNames.length) {
        const missing = roleNames.filter((r) => !roleList.find((x) => x.name === r))
        errors.push(`Missing roles for policy ${row.object_id}: ${missing.join(', ')}`)
        continue
      }
      const roleIds = roleList.map((r) => r.id)
      if (row.frequency === 'CUSTOM_DAYS' && (row.interval_days === undefined || row.interval_days === null || row.interval_days < 0)) {
        errors.push(`Invalid interval_days for policy ${row.object_id}`)
        continue
      }
      await tx.objectSurveyPolicy.create({
        data: {
          objectId,
          questionnaireId: questionnaire.id,
          frequency: row.frequency,
          intervalDays: row.interval_days ?? null,
          roleIds,
          activeFrom: row.active_from ? new Date(row.active_from) : null,
          activeTo: row.active_to ? new Date(row.active_to) : null,
        },
      })
    }

    for (const row of group_policies ?? []) {
      if (!row.group_name || !row.questionnaire_title || !row.frequency || !row.role_names) {
        errors.push(`Group policy missing fields for group ${row.group_name}`)
        continue
      }
      const groupId =
        groupMap.get(row.group_name) ??
        (await tx.objectGroup.upsert({
          where: { name: row.group_name },
          update: {},
          create: { name: row.group_name },
        })).id
      groupMap.set(row.group_name, groupId)
      const questionnaire = await tx.questionnaire.findFirst({
        where: { title: row.questionnaire_title },
      })
      if (!questionnaire) {
        errors.push(`Questionnaire not found: ${row.questionnaire_title}`)
        continue
      }
      const roleNames = row.role_names.split(',').map((r) => r.trim()).filter(Boolean)
      if (roleNames.length > 0) {
        const defs = await tx.roleDefinition.findMany({ where: { name: { in: roleNames } } })
        if (defs.length !== roleNames.length) {
          const missing = roleNames.filter((r) => !defs.find((d) => d.name === r))
          errors.push(`Missing roles for group policy ${row.group_name}: ${missing.join(', ')}`)
          continue
        }
      }
      if (row.frequency === 'CUSTOM_DAYS' && (row.interval_days === undefined || row.interval_days === null || row.interval_days < 0)) {
        errors.push(`Invalid interval_days for group policy ${row.group_name}`)
        continue
      }
      await tx.objectGroupPolicy.create({
        data: {
          groupId,
          questionnaireId: questionnaire.id,
          frequency: row.frequency,
          intervalDays: row.interval_days ?? null,
          roleNames,
          activeFrom: row.active_from ? new Date(row.active_from) : null,
          activeTo: row.active_to ? new Date(row.active_to) : null,
        },
      })
    }

    if (errors.length > 0) {
      throw new Error('IMPORT_VALIDATION_FAILED')
    }
  }, { timeout: 30000 })

  res.json({
    ok: errors.length === 0,
    errors,
    summary: {
      users: (users ?? []).length,
      usersImported: importedUsers,
      usersSkipped: skippedUsers,
      usersInvalidRoles: invalidUserRoles,
      usersParsed,
      usersMissingEmail,
      objects: (objects ?? []).length,
      roles: (roles ?? []).length,
      assignments: (assignments ?? []).length,
      policies: (policies ?? []).length,
      object_groups: (object_groups ?? []).length,
      group_memberships: (group_memberships ?? []).length,
      group_policies: (group_policies ?? []).length,
    },
  })
})

app.get('/api/admin/question-types', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (_req, res) => {
  const settings = await getQuestionTypeSettingsMap()
  const questionnaires = await prisma.questionnaire.findMany({
    where: { deletedAt: null },
    select: { id: true, sections: true },
  })

  const usageByType = new Map<string, { questionnaireIds: Set<string>; questionCount: number }>()
  const touchType = (typeKey: string, questionnaireId: string) => {
    const current = usageByType.get(typeKey) ?? {
      questionnaireIds: new Set<string>(),
      questionCount: 0,
    }
    current.questionnaireIds.add(questionnaireId)
    current.questionCount += 1
    usageByType.set(typeKey, current)
  }

  for (const questionnaire of questionnaires) {
    const sections = Array.isArray(questionnaire.sections) ? questionnaire.sections : []
    for (const section of sections as any[]) {
      if (!Array.isArray(section?.questions)) continue
      for (const question of section.questions) {
        const key = typeof question?.type === 'string' ? question.type : ''
        if (!key) continue
        touchType(key, questionnaire.id)
      }
    }
  }

  const result = QUESTION_TYPE_CATALOG.map((entry) => {
    const usage = usageByType.get(entry.key)
    return {
      key: entry.key,
      label: entry.label,
      answerTypeLabel: entry.answerTypeLabel,
      enabled: settings.get(entry.key) ?? true,
      usage: {
        questionnaireCount: usage?.questionnaireIds.size ?? 0,
        questionCount: usage?.questionCount ?? 0,
      },
    }
  })

  res.json(result)
})

app.put('/api/admin/question-types', authMiddleware, requireRole(['ADMIN']), async (req, res) => {
  const { items } = req.body as { items?: Array<{ key?: string; enabled?: boolean }> }
  if (!Array.isArray(items)) {
    res.status(400).json({ error: 'INVALID_ITEMS' })
    return
  }

  await ensureQuestionTypeSettingsTable()
  const allowedKeys = new Set(QUESTION_TYPE_CATALOG.map((entry) => entry.key))

  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      const key = typeof item?.key === 'string' ? item.key : ''
      if (!allowedKeys.has(key)) continue
      const enabled = !!item?.enabled
      await tx.$executeRawUnsafe(
        `
          INSERT INTO "QuestionTypeSetting" ("key", "enabled", "updatedAt")
          VALUES ($1, $2, now())
          ON CONFLICT ("key")
          DO UPDATE SET "enabled" = EXCLUDED."enabled", "updatedAt" = now()
        `,
        key,
        enabled
      )
    }
  })

  res.json({ ok: true })
})

app.get('/api/questionnaires', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (_req, res) => {
  const user = _req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const includeDeleted = String(_req.query.includeDeleted ?? '') === '1'
  const withStats = String(_req.query.withStats ?? '') === '1'
  const raw = await prisma.questionnaire.findMany({
    where: includeDeleted ? undefined : { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    include: { groups: true, submissions: true },
  })
  const editorGroupIds = user.role === 'ADMIN' ? [] : await getUserGroupIds(user.id)
  const creatorGroupMap = new Map<string, string[]>()
  if (user.role !== 'ADMIN') {
    const creatorIds = Array.from(
      new Set(raw.map((q) => q.createdByUserId).filter((id): id is string => Boolean(id)))
    )
    if (creatorIds.length > 0) {
      const creatorMemberships = await prisma.groupMember.findMany({
        where: { userId: { in: creatorIds } },
        select: { userId: true, groupId: true },
      })
      for (const m of creatorMemberships) {
        const current = creatorGroupMap.get(m.userId) ?? []
        current.push(m.groupId)
        creatorGroupMap.set(m.userId, current)
      }
    }
  }
  const questionnaires =
    user.role === 'ADMIN'
      ? raw
      : raw.filter((q) =>
          canManageQuestionnaireByScope({
            userId: user.id,
            userRole: user.role,
            userGroupIds: editorGroupIds,
            questionnaire: {
              ...q,
              assignedGroupIds: q.groups.map((g) => g.groupId),
              creatorGroupIds: q.createdByUserId ? (creatorGroupMap.get(q.createdByUserId) ?? []) : [],
            },
          })
        )
  const questionnaireIds = questionnaires.map((q) => q.id)
  const lockMap = await getActiveQuestionnaireEditorLockMap(questionnaireIds)

  type QuestionnaireStats = {
    objectCount: number
    objectGroupCount: number
    personCount: number
    openCount: number
    completedCount: number
    totalTaskCount: number
    assignmentTypes: Array<{ frequency: string; count: number }>
  }
  const statsByQuestionnaireId = new Map<string, QuestionnaireStats>()

  if (withStats && questionnaireIds.length > 0) {
    const [objectPolicies, objectGroupPolicies, groupQuestionnaires, tasks] = await Promise.all([
      prisma.objectSurveyPolicy.findMany({
        where: { questionnaireId: { in: questionnaireIds } },
        select: { questionnaireId: true, objectId: true, frequency: true, roleIds: true },
      }),
      prisma.objectGroupPolicy.findMany({
        where: { questionnaireId: { in: questionnaireIds } },
        select: { questionnaireId: true, groupId: true, frequency: true, roleNames: true },
      }),
      prisma.groupQuestionnaire.findMany({
        where: { questionnaireId: { in: questionnaireIds } },
        select: { questionnaireId: true, groupId: true, frequency: true },
      }),
      prisma.objectSurveyTask.findMany({
        where: { questionnaireId: { in: questionnaireIds } },
        select: { questionnaireId: true, status: true },
      }),
    ])

    const objectGroupIds = Array.from(new Set(objectGroupPolicies.map((p) => p.groupId)))
    const objectMemberships =
      objectGroupIds.length > 0
        ? await prisma.objectGroupMembership.findMany({
            where: { groupId: { in: objectGroupIds } },
            select: { groupId: true, objectId: true },
          })
        : []
    const objectsByGroup = new Map<string, string[]>()
    for (const m of objectMemberships) {
      const current = objectsByGroup.get(m.groupId) ?? []
      current.push(m.objectId)
      objectsByGroup.set(m.groupId, current)
    }

    const allObjectIds = Array.from(
      new Set([
        ...objectPolicies.map((p) => p.objectId),
        ...objectMemberships.map((m) => m.objectId),
      ])
    )
    const roleAssignments =
      allObjectIds.length > 0
        ? await prisma.objectRoleAssignment.findMany({
            where: { objectId: { in: allObjectIds } },
            include: {
              role: { select: { id: true, name: true } },
              group: { select: { members: { select: { userId: true } } } },
            },
          })
        : []
    const assignmentsByObject = new Map<string, typeof roleAssignments>()
    for (const a of roleAssignments) {
      const current = assignmentsByObject.get(a.objectId) ?? []
      current.push(a)
      assignmentsByObject.set(a.objectId, current)
    }
    const roleIdByName = new Map<string, string>()
    for (const a of roleAssignments) {
      roleIdByName.set(a.role.name.toLowerCase(), a.roleId)
    }

    const allGroupIds = Array.from(new Set(groupQuestionnaires.map((g) => g.groupId)))
    const groupMembers =
      allGroupIds.length > 0
        ? await prisma.groupMember.findMany({
            where: { groupId: { in: allGroupIds } },
            select: { groupId: true, userId: true },
          })
        : []
    const usersByGroup = new Map<string, string[]>()
    for (const gm of groupMembers) {
      const current = usersByGroup.get(gm.groupId) ?? []
      current.push(gm.userId)
      usersByGroup.set(gm.groupId, current)
    }

    const parseStringList = (value: unknown): string[] =>
      Array.isArray(value) ? value.map((v) => String(v ?? '').trim()).filter(Boolean) : []

    for (const qid of questionnaireIds) {
      const qObjectPolicies = objectPolicies.filter((p) => p.questionnaireId === qid)
      const qObjectGroupPolicies = objectGroupPolicies.filter((p) => p.questionnaireId === qid)
      const qGroupQuestionnaires = groupQuestionnaires.filter((g) => g.questionnaireId === qid)
      const qTasks = tasks.filter((t) => t.questionnaireId === qid)

      const objectIds = new Set<string>(qObjectPolicies.map((p) => p.objectId))
      qObjectGroupPolicies.forEach((p) => {
        ;(objectsByGroup.get(p.groupId) ?? []).forEach((oid) => objectIds.add(oid))
      })
      const objectGroupSet = new Set<string>(qObjectGroupPolicies.map((p) => p.groupId))

      const personIds = new Set<string>()
      qGroupQuestionnaires.forEach((gq) => {
        ;(usersByGroup.get(gq.groupId) ?? []).forEach((uid) => personIds.add(uid))
      })

      qObjectPolicies.forEach((policy) => {
        const roleIdsFilter = new Set(parseStringList(policy.roleIds))
        const objectAssignments = assignmentsByObject.get(policy.objectId) ?? []
        for (const a of objectAssignments) {
          if (roleIdsFilter.size > 0 && !roleIdsFilter.has(a.roleId)) continue
          if (a.userId) personIds.add(a.userId)
          a.group?.members.forEach((m) => personIds.add(m.userId))
        }
      })

      qObjectGroupPolicies.forEach((policy) => {
        const roleNames = parseStringList(policy.roleNames)
        const roleIdsFilter = new Set(
          roleNames
            .map((name) => roleIdByName.get(name.toLowerCase()))
            .filter((v): v is string => !!v)
        )
        const targetObjectIds = objectsByGroup.get(policy.groupId) ?? []
        for (const objectId of targetObjectIds) {
          const objectAssignments = assignmentsByObject.get(objectId) ?? []
          for (const a of objectAssignments) {
            if (roleIdsFilter.size > 0 && !roleIdsFilter.has(a.roleId)) continue
            if (a.userId) personIds.add(a.userId)
            a.group?.members.forEach((m) => personIds.add(m.userId))
          }
        }
      })

      const openCount = qTasks.filter((t) => t.status === 'OPEN').length
      const completedCount = qTasks.filter((t) => t.status === 'DONE').length
      const frequencyCounter = new Map<string, number>()
      const addFrequency = (f: string) => {
        frequencyCounter.set(f, (frequencyCounter.get(f) ?? 0) + 1)
      }
      qObjectPolicies.forEach((p) => addFrequency(p.frequency))
      qObjectGroupPolicies.forEach((p) => addFrequency(p.frequency))
      qGroupQuestionnaires.forEach((g) => addFrequency(g.frequency))

      statsByQuestionnaireId.set(qid, {
        objectCount: objectIds.size,
        objectGroupCount: objectGroupSet.size,
        personCount: personIds.size,
        openCount,
        completedCount,
        totalTaskCount: qTasks.length,
        assignmentTypes: Array.from(frequencyCounter.entries())
          .map(([frequency, count]) => ({ frequency, count }))
          .sort((a, b) => a.frequency.localeCompare(b.frequency, 'de')),
      })
    }
  }

  res.json(
    questionnaires.map((q) => ({
      id: q.id,
      title: q.title,
      subtitle: q.subtitle,
      sections: q.sections,
      version: q.version,
      createdAt: q.createdAt,
      updatedAt: q.updatedAt,
      allowMultipleSubmissions: q.allowMultipleSubmissions,
      globalForAllUsers: q.globalForAllUsers,
      createdByUserId: q.createdByUserId,
      adminAccessMode: q.adminAccessMode,
      adminGroupIds: q.adminGroupIds,
      status: q.status,
      homeTileDescriptionHtml: q.homeTileDescriptionHtml,
      homeTileColor: q.homeTileColor,
      homeTileAttributes: q.homeTileAttributes,
      activeFrom: q.activeFrom,
      activeTo: q.activeTo,
      deletedAt: q.deletedAt,
      groupIds: q.groups.map((g) => g.groupId),
      submissionCount: q.submissions.length,
      stats: statsByQuestionnaireId.get(q.id) ?? undefined,
      editorLock: lockMap.has(q.id)
        ? {
            userId: lockMap.get(q.id)?.userId,
            userEmail: lockMap.get(q.id)?.userEmail ?? null,
            lockedAt: lockMap.get(q.id)?.lockedAt,
            expiresAt: lockMap.get(q.id)?.expiresAt,
          }
        : null,
    }))
  )
})

app.get('/api/questionnaires/:id', authMiddleware, async (req, res) => {
  const { id } = req.params
  const q = await prisma.questionnaire.findUnique({
    where: { id },
    include: { groups: true },
  })
  if (!q) {
    res.status(404).json({ error: 'NOT_FOUND' })
    return
  }
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  if (q.deletedAt && user?.role !== 'ADMIN' && user?.role !== 'EDITOR') {
    res.status(404).json({ error: 'NOT_FOUND' })
    return
  }
  const completionMap = await getQuestionnaireCompletionConfigMap([q.id])
  const completion = completionMap.get(q.id)
  const lock = await getActiveQuestionnaireEditorLock(q.id)
  const withCompletion = {
    ...q,
    completionPageTitle: completion?.title ?? null,
    completionPageContent: completion?.content ?? null,
    showJiraTicketLinkInHistory: completion?.showJiraTicketLink ?? false,
    showReadonlyResultLinkInHistory: completion?.showReadonlyResultLink ?? false,
    allowReadonlyResultLinkForAllUsers: completion?.allowReadonlyResultLinkForAllUsers ?? false,
    editorLock: lock
      ? {
          userId: lock.userId,
          userEmail: lock.userEmail,
          lockedAt: lock.lockedAt,
          expiresAt: lock.expiresAt,
        }
      : null,
  }

  if (user?.role === 'ADMIN' || user?.role === 'EDITOR') {
    const editorGroupIds = user.role === 'ADMIN' ? [] : await getUserGroupIds(user.id)
    const creatorGroupIds =
      user.role === 'ADMIN' || !q.createdByUserId
        ? []
        : (await prisma.groupMember.findMany({
            where: { userId: q.createdByUserId },
            select: { groupId: true },
          })).map((m) => m.groupId)
    const allowedForAdminArea = canManageQuestionnaireByScope({
      userId: user.id,
      userRole: user.role,
      userGroupIds: editorGroupIds,
      questionnaire: {
        ...q,
        assignedGroupIds: q.groups.map((g) => g.groupId),
        creatorGroupIds,
      },
    })
    if (!allowedForAdminArea) {
      res.status(403).json({ error: 'FORBIDDEN' })
      return
    }
    res.json(withCompletion)
    return
  }
  const memberships = await prisma.groupMember.findMany({
    where: { userId: user?.id ?? '' },
  })
  const groupIds = new Set(memberships.map((m) => m.groupId))
  const allowed = q.groups.some((g) => groupIds.has(g.groupId))
  const globallyAllowed = q.globalForAllUsers
  if ((!allowed && !globallyAllowed) || !isCurrent(q.status, q.activeFrom, q.activeTo)) {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }
  res.json(withCompletion)
})

app.get('/api/admin/questionnaires/:id/kpi-overview', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }

  const questionnaire = await prisma.questionnaire.findUnique({
    where: { id },
    include: { groups: { select: { groupId: true } } },
  })
  if (!questionnaire) {
    res.status(404).json({ error: 'NOT_FOUND' })
    return
  }

  const editorGroupIds = user.role === 'ADMIN' ? [] : await getUserGroupIds(user.id)
  const creatorGroupIds =
    user.role === 'ADMIN' || !questionnaire.createdByUserId
      ? []
      : (
          await prisma.groupMember.findMany({
            where: { userId: questionnaire.createdByUserId },
            select: { groupId: true },
          })
        ).map((m) => m.groupId)

  const allowedForAdminArea = canManageQuestionnaireByScope({
    userId: user.id,
    userRole: user.role,
    userGroupIds: editorGroupIds,
    questionnaire: {
      ...questionnaire,
      assignedGroupIds: questionnaire.groups.map((g) => g.groupId),
      creatorGroupIds,
    },
  })
  if (!allowedForAdminArea) {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }

  const [objectPolicies, objectGroupPolicies] = await Promise.all([
    prisma.objectSurveyPolicy.findMany({
      where: { questionnaireId: id, createdByObjectGroupId: null },
      select: { id: true, objectId: true, roleIds: true },
    }),
    prisma.objectGroupPolicy.findMany({
      where: { questionnaireId: id },
      select: { id: true, groupId: true, roleNames: true },
    }),
  ])

  const objectGroupIds = Array.from(new Set(objectGroupPolicies.map((p) => p.groupId)))
  const objectMemberships =
    objectGroupIds.length > 0
      ? await prisma.objectGroupMembership.findMany({
          where: { groupId: { in: objectGroupIds } },
          select: { groupId: true, objectId: true },
        })
      : []

  const objectsByGroup = new Map<string, string[]>()
  objectMemberships.forEach((membership) => {
    const list = objectsByGroup.get(membership.groupId) ?? []
    list.push(membership.objectId)
    objectsByGroup.set(membership.groupId, list)
  })

  const allObjectIds = Array.from(
    new Set([
      ...objectPolicies.map((p) => p.objectId),
      ...objectMemberships.map((m) => m.objectId),
    ])
  )
  if (allObjectIds.length === 0) {
    res.json({
      questionnaireId: questionnaire.id,
      questionnaireTitle: questionnaire.title,
      rows: [],
    })
    return
  }

  const [objects, assignments, tasks] = await Promise.all([
    prisma.objectEntity.findMany({
      where: { id: { in: allObjectIds } },
      select: { id: true, name: true, externalId: true },
    }),
    prisma.objectRoleAssignment.findMany({
      where: { objectId: { in: allObjectIds } },
      include: {
        role: { select: { id: true, name: true } },
        user: { select: { id: true, email: true, displayName: true } },
        group: {
          select: {
            id: true,
            members: {
              select: {
                user: { select: { id: true, email: true, displayName: true } },
              },
            },
          },
        },
      },
    }),
    prisma.objectSurveyTask.findMany({
      where: { questionnaireId: id, objectId: { in: allObjectIds } },
      select: {
        id: true,
        objectId: true,
        status: true,
        startedAt: true,
        dueAt: true,
        startedByUserId: true,
        startedBy: { select: { id: true, email: true, displayName: true } },
      },
    }),
  ])

  const objectById = new Map(objects.map((obj) => [obj.id, obj]))
  const assignmentsByObjectId = new Map<string, typeof assignments>()
  assignments.forEach((assignment) => {
    const list = assignmentsByObjectId.get(assignment.objectId) ?? []
    list.push(assignment)
    assignmentsByObjectId.set(assignment.objectId, list)
  })

  const tasksByObjectId = new Map<string, typeof tasks>()
  tasks.forEach((task) => {
    const list = tasksByObjectId.get(task.objectId) ?? []
    list.push(task)
    tasksByObjectId.set(task.objectId, list)
  })

  const roleIdByName = new Map<string, string>()
  assignments.forEach((assignment) => {
    roleIdByName.set(assignment.role.name.toLowerCase(), assignment.role.id)
  })

  const parseStringList = (value: unknown): string[] =>
    Array.isArray(value) ? value.map((v) => String(v ?? '').trim()).filter(Boolean) : []

  const roleScopeByObjectId = new Map<
    string,
    { allRoles: boolean; roleIds: Set<string> }
  >()
  const ensureRoleScope = (objectId: string) => {
    const current = roleScopeByObjectId.get(objectId)
    if (current) return current
    const next = { allRoles: false, roleIds: new Set<string>() }
    roleScopeByObjectId.set(objectId, next)
    return next
  }

  objectPolicies.forEach((policy) => {
    const roleScope = ensureRoleScope(policy.objectId)
    const roleIds = parseStringList(policy.roleIds)
    if (roleIds.length === 0) {
      roleScope.allRoles = true
      return
    }
    roleIds.forEach((roleId) => roleScope.roleIds.add(roleId))
  })

  objectGroupPolicies.forEach((policy) => {
    const objectIds = objectsByGroup.get(policy.groupId) ?? []
    const roleNames = parseStringList(policy.roleNames)
    objectIds.forEach((objectId) => {
      const roleScope = ensureRoleScope(objectId)
      if (roleNames.length === 0) {
        roleScope.allRoles = true
        return
      }
      roleNames
        .map((name) => roleIdByName.get(name.toLowerCase()))
        .filter((roleId): roleId is string => !!roleId)
        .forEach((roleId) => roleScope.roleIds.add(roleId))
    })
  })

  const eligibleUsersByObjectId = new Map<
    string,
    Array<{ id: string; displayName: string | null; email: string }>
  >()

  allObjectIds.forEach((objectId) => {
    const roleScope = roleScopeByObjectId.get(objectId)
    const assignmentList = assignmentsByObjectId.get(objectId) ?? []
    const userMap = new Map<string, { id: string; displayName: string | null; email: string }>()
    assignmentList.forEach((assignment) => {
      const roleAllowed =
        !roleScope ||
        roleScope.allRoles ||
        roleScope.roleIds.size === 0 ||
        roleScope.roleIds.has(assignment.roleId)
      if (!roleAllowed) return
      if (assignment.user) {
        userMap.set(assignment.user.id, {
          id: assignment.user.id,
          displayName: assignment.user.displayName,
          email: assignment.user.email,
        })
      }
      assignment.group?.members.forEach((member) => {
        const memberUser = member.user
        userMap.set(memberUser.id, {
          id: memberUser.id,
          displayName: memberUser.displayName,
          email: memberUser.email,
        })
      })
    })
    const users = Array.from(userMap.values()).sort((a, b) => {
      const aKey = `${a.displayName ?? ''} ${a.email}`.toLowerCase()
      const bKey = `${b.displayName ?? ''} ${b.email}`.toLowerCase()
      return aKey.localeCompare(bKey, 'de')
    })
    eligibleUsersByObjectId.set(objectId, users)
  })

  const rows = allObjectIds
    .map((objectId) => {
      const object = objectById.get(objectId)
      if (!object) return null
      const objectTasks = tasksByObjectId.get(objectId) ?? []
      const openTasks = objectTasks.filter((task) => task.status === 'OPEN')
      const doneTasks = objectTasks.filter((task) => task.status === 'DONE')
      const activeEditorTask = openTasks
        .filter((task) => !!task.startedByUserId)
        .sort((a, b) => {
          const aTs = a.startedAt ? new Date(a.startedAt).getTime() : 0
          const bTs = b.startedAt ? new Date(b.startedAt).getTime() : 0
          return bTs - aTs
        })[0]

      const status =
        activeEditorTask
          ? 'IN_PROGRESS'
          : openTasks.length > 0
            ? 'OPEN'
            : doneTasks.length > 0
              ? 'DONE'
              : 'NO_TASK'

      const editor = activeEditorTask?.startedBy
        ? {
            id: activeEditorTask.startedBy.id,
            displayName: activeEditorTask.startedBy.displayName,
            email: activeEditorTask.startedBy.email,
          }
        : null

      return {
        questionnaireId: questionnaire.id,
        questionnaireTitle: questionnaire.title,
        objectId: object.id,
        objectName: object.name,
        objectExternalId: object.externalId ?? null,
        status,
        directPath: `/link/open-tasks?objectId=${encodeURIComponent(object.id)}&questionnaireId=${encodeURIComponent(questionnaire.id)}`,
        eligibleUsers: eligibleUsersByObjectId.get(object.id) ?? [],
        currentEditor: editor,
      }
    })
    .filter((row): row is NonNullable<typeof row> => !!row)
    .sort((a, b) => a.objectName.localeCompare(b.objectName, 'de'))

  res.json({
    questionnaireId: questionnaire.id,
    questionnaireTitle: questionnaire.title,
    rows,
  })
})

app.post('/api/questionnaires/:id/editor-lock', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const q = await prisma.questionnaire.findUnique({
    where: { id },
    include: { groups: { select: { groupId: true } } },
  })
  if (!q) {
    res.status(404).json({ error: 'NOT_FOUND' })
    return
  }
  if (q.deletedAt) {
    res.status(409).json({ error: 'QUESTIONNAIRE_DELETED' })
    return
  }
  const editorGroupIds = user.role === 'ADMIN' ? [] : await getUserGroupIds(user.id)
  const creatorGroupIds =
    user.role === 'ADMIN' || !q.createdByUserId
      ? []
      : (await prisma.groupMember.findMany({
          where: { userId: q.createdByUserId },
          select: { groupId: true },
        })).map((m) => m.groupId)
  const allowedForAdminArea = canManageQuestionnaireByScope({
    userId: user.id,
    userRole: user.role,
    userGroupIds: editorGroupIds,
    questionnaire: {
      ...q,
      assignedGroupIds: q.groups.map((g) => g.groupId),
      creatorGroupIds,
    },
  })
  if (!allowedForAdminArea) {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }

  const result = await acquireQuestionnaireEditorLock(id, user.id)
  if (!result.acquired || !result.lock) {
    res.status(409).json({
      error: 'QUESTIONNAIRE_LOCKED',
      lockedByUserId: result.lock?.userId ?? null,
      lockedByEmail: result.lock?.userEmail ?? null,
      lockedAt: result.lock?.lockedAt ?? null,
      expiresAt: result.lock?.expiresAt ?? null,
    })
    return
  }

  res.json({
    ok: true,
    userId: result.lock.userId,
    userEmail: result.lock.userEmail,
    lockedAt: result.lock.lockedAt,
    expiresAt: result.lock.expiresAt,
    ttlSeconds: QUESTIONNAIRE_EDITOR_LOCK_TTL_SECONDS,
  })
})

app.post('/api/questionnaires/:id/editor-lock/release', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const released = await releaseQuestionnaireEditorLock(id, user.id)
  res.json({ ok: true, released })
})

app.post('/api/questionnaires', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const {
    title,
    subtitle,
    sections,
    allowMultipleSubmissions,
    globalForAllUsers,
    status,
    activeFrom,
    activeTo,
    adminAccessMode,
    completionPageTitle,
    completionPageContent,
    showJiraTicketLinkInHistory,
    showReadonlyResultLinkInHistory,
    allowReadonlyResultLinkForAllUsers,
    homeTileDescriptionHtml,
    homeTileColor,
    homeTileAttributes,
  } = req.body as {
    title?: string
    subtitle?: string
    sections?: unknown
    allowMultipleSubmissions?: boolean
    globalForAllUsers?: boolean
    status?: 'DRAFT' | 'PUBLISHED'
    activeFrom?: string | null
    activeTo?: string | null
    adminAccessMode?: string
    completionPageTitle?: string | null
    completionPageContent?: string | null
    showJiraTicketLinkInHistory?: boolean
    showReadonlyResultLinkInHistory?: boolean
    allowReadonlyResultLinkForAllUsers?: boolean
    homeTileDescriptionHtml?: string | null
    homeTileColor?: string
    homeTileAttributes?: unknown
  }
  if (!title || !sections) {
    res.status(400).json({ error: 'MISSING_FIELDS' })
    return
  }
  const createMissingTitle = findMissingQuestionTitle(sections)
  if (createMissingTitle) {
    res.status(400).json({
      error: `QUESTION_TITLE_REQUIRED: Sektion ${createMissingTitle.sectionRef}, Frage ${createMissingTitle.questionRef}`,
      section: createMissingTitle.sectionRef,
      question: createMissingTitle.questionRef,
    })
    return
  }
  const questionTypes = extractQuestionTypes(sections)
  if (questionTypes.length > 0) {
    const settings = await getQuestionTypeSettingsMap()
    const disabled = questionTypes.filter((typeKey) => settings.get(typeKey) === false)
    if (disabled.length > 0) {
      res.status(400).json({ error: 'QUESTION_TYPE_DISABLED', types: disabled })
      return
    }
  }
  const normalizedAccessMode = normalizeAdminAccessMode(adminAccessMode)
  const creatorGroupIds = await getUserGroupIds(user.id)
  const q = await prisma.questionnaire.create({
    data: {
      title,
      subtitle,
      sections,
      version: 1,
      allowMultipleSubmissions: Boolean(allowMultipleSubmissions),
      globalForAllUsers: Boolean(globalForAllUsers),
      createdByUserId: user.id,
      adminAccessMode: normalizedAccessMode,
      adminGroupIds: normalizedAccessMode === 'OWNER_ONLY' ? [] : creatorGroupIds,
      status: status ?? 'DRAFT',
      homeTileDescriptionHtml: homeTileDescriptionHtml ?? null,
      homeTileColor: normalizeHomeTileColor(homeTileColor),
      homeTileAttributes: normalizeHomeTileAttributes(homeTileAttributes),
      activeFrom: activeFrom ? new Date(activeFrom) : null,
      activeTo: activeTo ? new Date(activeTo) : null,
    },
  })
  await setQuestionnaireCompletionConfig(
    q.id,
    completionPageTitle,
    completionPageContent,
    showJiraTicketLinkInHistory,
    showReadonlyResultLinkInHistory,
    allowReadonlyResultLinkForAllUsers
  )
  res.json({
    ...q,
    completionPageTitle: completionPageTitle ?? null,
    completionPageContent: completionPageContent ?? null,
    showJiraTicketLinkInHistory: Boolean(showJiraTicketLinkInHistory),
    showReadonlyResultLinkInHistory: Boolean(showReadonlyResultLinkInHistory),
    allowReadonlyResultLinkForAllUsers: Boolean(allowReadonlyResultLinkForAllUsers),
  })
})

app.put('/api/questionnaires/:id', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const {
    title,
    subtitle,
    sections,
    allowMultipleSubmissions,
    globalForAllUsers,
    status,
    activeFrom,
    activeTo,
    adminAccessMode,
    completionPageTitle,
    completionPageContent,
    showJiraTicketLinkInHistory,
    showReadonlyResultLinkInHistory,
    allowReadonlyResultLinkForAllUsers,
    homeTileDescriptionHtml,
    homeTileColor,
    homeTileAttributes,
  } = req.body as {
    title?: string
    subtitle?: string
    sections?: unknown
    allowMultipleSubmissions?: boolean
    globalForAllUsers?: boolean
    status?: 'DRAFT' | 'PUBLISHED'
    activeFrom?: string | null
    activeTo?: string | null
    adminAccessMode?: string
    completionPageTitle?: string | null
    completionPageContent?: string | null
    showJiraTicketLinkInHistory?: boolean
    showReadonlyResultLinkInHistory?: boolean
    allowReadonlyResultLinkForAllUsers?: boolean
    homeTileDescriptionHtml?: string | null
    homeTileColor?: string
    homeTileAttributes?: unknown
  }
  const current = await prisma.questionnaire.findUnique({
    where: { id },
    include: { groups: { select: { groupId: true } } },
  })
  if (!current) {
    res.status(404).json({ error: 'NOT_FOUND' })
    return
  }
  if (current.deletedAt) {
    res.status(409).json({ error: 'QUESTIONNAIRE_DELETED' })
    return
  }
  const editorGroupIds = user.role === 'ADMIN' ? [] : await getUserGroupIds(user.id)
  const creatorGroupIds =
    user.role === 'ADMIN' || !current.createdByUserId
      ? []
      : (await prisma.groupMember.findMany({
          where: { userId: current.createdByUserId },
          select: { groupId: true },
        })).map((m) => m.groupId)
  const allowedForAdminArea = canManageQuestionnaireByScope({
    userId: user.id,
    userRole: user.role,
    userGroupIds: editorGroupIds,
    questionnaire: {
      ...current,
      assignedGroupIds: current.groups.map((g) => g.groupId),
      creatorGroupIds,
    },
  })
  if (!allowedForAdminArea) {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }
  const activeLock = await getActiveQuestionnaireEditorLock(id)
  if (!activeLock || activeLock.userId !== user.id) {
    res.status(409).json({
      error: 'QUESTIONNAIRE_LOCK_NOT_HELD',
      lockedByUserId: activeLock?.userId ?? null,
      lockedByEmail: activeLock?.userEmail ?? null,
      lockedAt: activeLock?.lockedAt ?? null,
      expiresAt: activeLock?.expiresAt ?? null,
    })
    return
  }
  const normalizedAccessMode =
    adminAccessMode === undefined ? undefined : normalizeAdminAccessMode(adminAccessMode)
  let nextAdminGroupIds: string[] | undefined = undefined
  if (normalizedAccessMode !== undefined) {
    if (normalizedAccessMode === 'OWNER_ONLY') {
      nextAdminGroupIds = []
    } else {
      const existingAdminGroupIds = parseStringArray(current.adminGroupIds)
      if (existingAdminGroupIds.length > 0) {
        nextAdminGroupIds = existingAdminGroupIds
      } else {
        const sourceUserId = current.createdByUserId ?? user.id
        nextAdminGroupIds = await getUserGroupIds(sourceUserId)
      }
    }
  }
  const hasCatalogChange =
    (title !== undefined && title !== current.title) ||
    (subtitle !== undefined && (subtitle ?? null) !== current.subtitle) ||
    (sections !== undefined && JSON.stringify(sections) !== JSON.stringify(current.sections))
  if (sections !== undefined) {
    const updateMissingTitle = findMissingQuestionTitle(sections)
    if (updateMissingTitle) {
      res.status(400).json({
        error: `QUESTION_TITLE_REQUIRED: Sektion ${updateMissingTitle.sectionRef}, Frage ${updateMissingTitle.questionRef}`,
        section: updateMissingTitle.sectionRef,
        question: updateMissingTitle.questionRef,
      })
      return
    }
  }
  const q = await prisma.questionnaire.update({
    where: { id },
    data: {
      title,
      subtitle,
      sections,
      version: hasCatalogChange ? current.version + 1 : undefined,
      allowMultipleSubmissions:
        allowMultipleSubmissions === undefined ? undefined : Boolean(allowMultipleSubmissions),
      globalForAllUsers: globalForAllUsers === undefined ? undefined : Boolean(globalForAllUsers),
      adminAccessMode: normalizedAccessMode,
      adminGroupIds: nextAdminGroupIds,
      status,
      homeTileDescriptionHtml: homeTileDescriptionHtml === undefined ? undefined : homeTileDescriptionHtml ?? null,
      homeTileColor: homeTileColor === undefined ? undefined : normalizeHomeTileColor(homeTileColor),
      homeTileAttributes:
        homeTileAttributes === undefined ? undefined : normalizeHomeTileAttributes(homeTileAttributes),
      activeFrom: activeFrom === undefined ? undefined : activeFrom ? new Date(activeFrom) : null,
      activeTo: activeTo === undefined ? undefined : activeTo ? new Date(activeTo) : null,
    },
  })
  if (
    completionPageTitle !== undefined ||
    completionPageContent !== undefined ||
    showJiraTicketLinkInHistory !== undefined ||
    showReadonlyResultLinkInHistory !== undefined ||
    allowReadonlyResultLinkForAllUsers !== undefined
  ) {
    await setQuestionnaireCompletionConfig(
      q.id,
      completionPageTitle,
      completionPageContent,
      showJiraTicketLinkInHistory,
      showReadonlyResultLinkInHistory,
      allowReadonlyResultLinkForAllUsers
    )
  }
  const completionMap = await getQuestionnaireCompletionConfigMap([q.id])
  const completion = completionMap.get(q.id)
  res.json({
    ...q,
    completionPageTitle: completion?.title ?? null,
    completionPageContent: completion?.content ?? null,
    showJiraTicketLinkInHistory: completion?.showJiraTicketLink ?? false,
    showReadonlyResultLinkInHistory: completion?.showReadonlyResultLink ?? false,
    allowReadonlyResultLinkForAllUsers: completion?.allowReadonlyResultLinkForAllUsers ?? false,
  })
})

app.delete('/api/questionnaires/:id', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const current = await prisma.questionnaire.findUnique({
    where: { id },
    include: { groups: { select: { groupId: true } } },
  })
  if (!current) {
    res.status(404).json({ error: 'NOT_FOUND' })
    return
  }
  const editorGroupIds = user.role === 'ADMIN' ? [] : await getUserGroupIds(user.id)
  const creatorGroupIds =
    user.role === 'ADMIN' || !current.createdByUserId
      ? []
      : (await prisma.groupMember.findMany({
          where: { userId: current.createdByUserId },
          select: { groupId: true },
        })).map((m) => m.groupId)
  const allowedForAdminArea = canManageQuestionnaireByScope({
    userId: user.id,
    userRole: user.role,
    userGroupIds: editorGroupIds,
    questionnaire: {
      ...current,
      assignedGroupIds: current.groups.map((g) => g.groupId),
      creatorGroupIds,
    },
  })
  if (!allowedForAdminArea) {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }
  const deleteResults = req.body?.deleteResults !== false
  await prisma.$transaction(async (tx) => {
    await tx.objectSurveyTask.deleteMany({ where: { questionnaireId: id } })
    await tx.objectPolicyOverride.deleteMany({ where: { questionnaireId: id } })
    await tx.objectGroupPolicy.deleteMany({ where: { questionnaireId: id } })
    await tx.objectSurveyPolicy.deleteMany({ where: { questionnaireId: id } })
    await tx.groupQuestionnaire.deleteMany({ where: { questionnaireId: id } })
    if (deleteResults) {
      await tx.submission.deleteMany({ where: { questionnaireId: id } })
      await tx.questionnaire.delete({ where: { id } })
    } else {
      await tx.questionnaire.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          status: 'DRAFT',
          globalForAllUsers: false,
          activeFrom: null,
          activeTo: null,
        },
      })
    }
  })
  await prisma.$executeRawUnsafe(
    `DELETE FROM "QuestionnaireCompletionConfig" WHERE "questionnaireId" = $1`,
    id
  )
  res.json({ ok: true })
})

app.get('/api/me/questionnaires', authMiddleware, async (req, res) => {
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  if (user.role === 'ADMIN' || user.role === 'EDITOR') {
    const all = await prisma.questionnaire.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { groups: { select: { groupId: true } } },
    })
    if (user.role === 'ADMIN') {
      res.json(all)
      return
    }
    const editorGroupIds = await getUserGroupIds(user.id)
    const creatorIds = Array.from(
      new Set(all.map((q) => q.createdByUserId).filter((id): id is string => Boolean(id)))
    )
    const creatorMemberships =
      creatorIds.length > 0
        ? await prisma.groupMember.findMany({
            where: { userId: { in: creatorIds } },
            select: { userId: true, groupId: true },
          })
        : []
    const creatorGroupMap = new Map<string, string[]>()
    for (const m of creatorMemberships) {
      const current = creatorGroupMap.get(m.userId) ?? []
      current.push(m.groupId)
      creatorGroupMap.set(m.userId, current)
    }
    const visible = all.filter((q) =>
      canManageQuestionnaireByScope({
        userId: user.id,
        userRole: user.role,
        userGroupIds: editorGroupIds,
        questionnaire: {
          ...q,
          assignedGroupIds: q.groups.map((g) => g.groupId),
          creatorGroupIds: q.createdByUserId ? (creatorGroupMap.get(q.createdByUserId) ?? []) : [],
        },
      })
    )
    res.json(visible)
    return
  }
  const memberships = await prisma.groupMember.findMany({ where: { userId: user.id } })
  const groupIds = memberships.map((m) => m.groupId)
  const assignments = await prisma.groupQuestionnaire.findMany({
    where: { groupId: { in: groupIds } },
    include: { questionnaire: true },
  })
  const globalQuestionnaires = await prisma.questionnaire.findMany({
    where: { globalForAllUsers: true, deletedAt: null },
  })
  const currentOnly = (req.query.status as string) === 'current'
  const merged = [
    ...assignments.map((a) => a.questionnaire).filter((q) => !q.deletedAt),
    ...globalQuestionnaires,
  ]
  const deduped = Array.from(new Map(merged.map((q) => [q.id, q])).values())
  const list = deduped.filter((q) => (!currentOnly ? true : isCurrent(q.status, q.activeFrom, q.activeTo)))
  res.json(list)
})

const SUBMISSION_NOTE_DISPLAY_KEY = '__submissionNote'
const MAX_SUBMISSION_NOTE_LENGTH = 200

function normalizeSubmissionNoteInput(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const compact = raw.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim()
  if (!compact) return null
  return compact.slice(0, MAX_SUBMISSION_NOTE_LENGTH)
}

function getSubmissionNoteFromDisplayAnswers(displayAnswers: unknown): string | null {
  if (!displayAnswers || typeof displayAnswers !== 'object' || Array.isArray(displayAnswers)) return null
  const raw = (displayAnswers as Record<string, unknown>)[SUBMISSION_NOTE_DISPLAY_KEY]
  return normalizeSubmissionNoteInput(raw)
}

function withSubmissionNoteDisplayAnswer(
  displayAnswers: unknown,
  submissionNote: string | null
): Record<string, unknown> | null {
  const base =
    displayAnswers && typeof displayAnswers === 'object' && !Array.isArray(displayAnswers)
      ? { ...(displayAnswers as Record<string, unknown>) }
      : {}
  if (submissionNote) {
    base[SUBMISSION_NOTE_DISPLAY_KEY] = submissionNote
  } else {
    delete base[SUBMISSION_NOTE_DISPLAY_KEY]
  }
  return Object.keys(base).length > 0 ? base : null
}

app.get('/api/me/submissions', authMiddleware, async (req, res) => {
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const submissions = await prisma.submission.findMany({
    where: { userId: user.id },
    include: {
      user: { select: { id: true, email: true, externalId: true } },
      questionnaire: {
        select: {
          id: true,
          title: true,
          subtitle: true,
          version: true,
          globalForAllUsers: true,
          homeTileDescriptionHtml: true,
          homeTileColor: true,
          homeTileAttributes: true,
        },
      },
    },
    orderBy: { submittedAt: 'desc' },
  })
  const completionMap = await getQuestionnaireCompletionConfigMap(
    Array.from(new Set(submissions.map((entry) => entry.questionnaireId)))
  )
  const jiraMap = await getLatestSubmissionJiraIssueMap(submissions.map((entry) => entry.id))
  res.json(
    submissions.map((entry) => ({
      ...entry,
      submissionNote: getSubmissionNoteFromDisplayAnswers(entry.displayAnswers),
      questionnaire: entry.questionnaire
        ? {
            ...entry.questionnaire,
            showJiraTicketLinkInHistory:
              completionMap.get(entry.questionnaireId)?.showJiraTicketLink ?? false,
            showReadonlyResultLinkInHistory:
              completionMap.get(entry.questionnaireId)?.showReadonlyResultLink ?? false,
            allowReadonlyResultLinkForAllUsers:
              completionMap.get(entry.questionnaireId)?.allowReadonlyResultLinkForAllUsers ?? false,
          }
        : null,
      jiraIssue: jiraMap.get(entry.id) ?? null,
    }))
  )
})

app.put('/api/me/submissions/:id/note', authMiddleware, async (req, res) => {
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const { id } = req.params
  const { submissionNote } = req.body as { submissionNote?: unknown }
  const submission = await prisma.submission.findUnique({
    where: { id },
    select: { id: true, userId: true, displayAnswers: true, submittedAt: true },
  })
  if (!submission) {
    res.status(404).json({ error: 'NOT_FOUND' })
    return
  }
  if (submission.userId !== user.id) {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }
  const normalizedSubmissionNote = normalizeSubmissionNoteInput(submissionNote)
  const resolvedDisplayAnswers = withSubmissionNoteDisplayAnswer(
    submission.displayAnswers,
    normalizedSubmissionNote
  )
  await prisma.submission.update({
    where: { id },
    data: {
      displayAnswers: resolvedDisplayAnswers,
    },
  })
  res.json({
    ok: true,
    submissionId: submission.id,
    submissionNote: normalizedSubmissionNote,
    submittedAt: submission.submittedAt,
  })
})

app.get('/api/me/user-options', authMiddleware, async (req, res) => {
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const query = String(req.query.q ?? '').trim()
  const queryTokens = query
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
  const page = Math.max(1, Number(req.query.page ?? 1))
  const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize ?? 20)))
  const toLc = (value: string | null | undefined) => (value ?? '').toLocaleLowerCase('de')
  const scoreUser = (
    item: { id: string; email: string; displayName: string | null; externalId: string | null },
    fullQuery: string,
    tokens: string[]
  ) => {
    if (!fullQuery) return 0
    const q = toLc(fullQuery)
    const id = toLc(item.id)
    const ext = toLc(item.externalId)
    const name = toLc(item.displayName)
    const email = toLc(item.email)
    let score = 0
    if (id === q || ext === q) score += 1000
    if (id.startsWith(q) || ext.startsWith(q)) score += 700
    if (name.startsWith(q) || email.startsWith(q)) score += 550
    if (id.includes(q) || ext.includes(q)) score += 450
    if (name.includes(q) || email.includes(q)) score += 300
    tokens.forEach((token) => {
      const t = toLc(token)
      if (!t) return
      if (id.startsWith(t) || ext.startsWith(t)) score += 180
      if (name.startsWith(t) || email.startsWith(t)) score += 140
      if (id.includes(t) || ext.includes(t)) score += 120
      if (name.includes(t) || email.includes(t)) score += 80
    })
    return score
  }
  const where = query
    ? {
        OR: [
          { id: query },
          { externalId: { contains: query, mode: 'insensitive' as const } },
          {
            AND: queryTokens.map((token) => ({
              OR: [
                { email: { contains: token, mode: 'insensitive' as const } },
                { displayName: { contains: token, mode: 'insensitive' as const } },
                { externalId: { contains: token, mode: 'insensitive' as const } },
              ],
            })),
          },
        ],
      }
    : undefined
  const total = await prisma.user.count({ where })
  const baseSelect = { id: true, email: true, displayName: true, externalId: true } as const
  const defaultOrderBy = [{ displayName: 'asc' as const }, { email: 'asc' as const }]
  const items = query
    ? (
        await prisma.user.findMany({
          where,
          select: baseSelect,
          orderBy: defaultOrderBy,
          take: Math.min(1000, Math.max(page * pageSize * 6, 240)),
        })
      )
        .map((item) => ({
          item,
          score: scoreUser(item, query, queryTokens),
        }))
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score
          const nameA = (a.item.displayName || a.item.email).toLocaleLowerCase('de')
          const nameB = (b.item.displayName || b.item.email).toLocaleLowerCase('de')
          const byName = nameA.localeCompare(nameB, 'de')
          if (byName !== 0) return byName
          return a.item.id.localeCompare(b.item.id, 'de')
        })
        .slice((page - 1) * pageSize, page * pageSize)
        .map((entry) => entry.item)
    : await prisma.user.findMany({
        where,
        select: baseSelect,
        orderBy: defaultOrderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      })
  res.json({ items, total, page, pageSize })
})

app.get('/api/me/object-picker-options', authMiddleware, async (req, res) => {
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }

  const query = String(req.query.q ?? '').trim()
  const queryTokens = query
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
  const page = Math.max(1, Number(req.query.page ?? 1))
  const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize ?? 20)))
  const toLc = (value: string | null | undefined) => (value ?? '').toLocaleLowerCase('de')
  const scoreObject = (
    item: { id: string; name: string; externalId: string | null; type: string | null },
    fullQuery: string,
    tokens: string[]
  ) => {
    if (!fullQuery) return 0
    const q = toLc(fullQuery)
    const id = toLc(item.id)
    const ext = toLc(item.externalId)
    const name = toLc(item.name)
    const typeValue = toLc(item.type)
    let score = 0
    if (id === q || ext === q) score += 1000
    if (id.startsWith(q) || ext.startsWith(q)) score += 700
    if (name.startsWith(q)) score += 560
    if (typeValue.startsWith(q)) score += 420
    if (id.includes(q) || ext.includes(q)) score += 460
    if (name.includes(q)) score += 320
    if (typeValue.includes(q)) score += 220
    tokens.forEach((token) => {
      const t = toLc(token)
      if (!t) return
      if (id.startsWith(t) || ext.startsWith(t)) score += 180
      if (name.startsWith(t)) score += 150
      if (typeValue.startsWith(t)) score += 100
      if (id.includes(t) || ext.includes(t)) score += 120
      if (name.includes(t)) score += 90
      if (typeValue.includes(t)) score += 60
    })
    return score
  }
  const typeFilter = String(req.query.types ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  const type = String(req.query.type ?? '').trim()
  const idFilter = String(req.query.ids ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  const metadataKey = String(req.query.metadataKey ?? '').trim()
  const metadataValue = String(req.query.metadataValue ?? '').trim()
  const objectGroupIds = String(req.query.objectGroupIds ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  const questionnaireId = String(req.query.questionnaireId ?? '').trim()
  const taskId = String(req.query.taskId ?? '').trim()
  const allowAllObjectsForStartedSurvey =
    (questionnaireId && (await canUserAccessQuestionnaireForPicker(user, questionnaireId))) ||
    (taskId && (await canUserAccessTaskForPicker(user, taskId)))

  const visibleObjectIds = allowAllObjectsForStartedSurvey
    ? null
    : await getVisibleObjectIdsForUser(user)
  if (visibleObjectIds && visibleObjectIds.length === 0) {
    res.json({ items: [], total: 0, page, pageSize })
    return
  }

  const idCandidates =
    visibleObjectIds && idFilter.length > 0
      ? visibleObjectIds.filter((id) => idFilter.includes(id))
      : visibleObjectIds ?? (idFilter.length > 0 ? idFilter : null)

  const where: any = {
    ...(idCandidates ? { id: { in: idCandidates } } : {}),
    ...(typeFilter.length > 0 ? { type: { in: typeFilter } } : {}),
    ...(type ? { type } : {}),
    ...(objectGroupIds.length > 0
      ? { groupMemberships: { some: { groupId: { in: objectGroupIds } } } }
      : {}),
    ...(metadataKey && metadataValue
      ? {
          metadata: {
            path: [metadataKey],
            string_contains: metadataValue,
          },
        }
      : {}),
    ...(query
      ? {
          OR: [
            { id: query },
            { externalId: { contains: query, mode: 'insensitive' } },
            {
              AND: queryTokens.map((token) => ({
                OR: [
                  { name: { contains: token, mode: 'insensitive' } },
                  { externalId: { contains: token, mode: 'insensitive' } },
                  { type: { contains: token, mode: 'insensitive' } },
                ],
              })),
            },
          ],
        }
      : {}),
  }

  const total = await prisma.objectEntity.count({ where })
  const baseSelect = { id: true, name: true, externalId: true, type: true } as const
  const items = query
    ? (
        await prisma.objectEntity.findMany({
          where,
          select: baseSelect,
          orderBy: [{ name: 'asc' }],
          take: Math.min(1000, Math.max(page * pageSize * 6, 240)),
        })
      )
        .map((item) => ({
          item,
          score: scoreObject(item, query, queryTokens),
        }))
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score
          const byName = a.item.name.localeCompare(b.item.name, 'de')
          if (byName !== 0) return byName
          return a.item.id.localeCompare(b.item.id, 'de')
        })
        .slice((page - 1) * pageSize, page * pageSize)
        .map((entry) => entry.item)
    : await prisma.objectEntity.findMany({
        where,
        select: baseSelect,
        orderBy: [{ name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      })

  res.json({ items, total, page, pageSize })
})

app.get('/api/me/object-tasks', authMiddleware, async (req, res) => {
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const { userGroupIds, rolesByObject, objectIds } = await getUserRoleAssignments(user.id)
  await ensureTasksForUser(user.id)
  if (objectIds.length === 0) {
    res.json([])
    return
  }
  const tasks = await prisma.objectSurveyTask.findMany({
    where: {
      objectId: { in: objectIds },
      policy: {
        OR: [{ createdByGroupId: null }, { createdByGroupId: { in: userGroupIds } }],
      },
    },
    include: {
      object: { include: { groupMemberships: { include: { group: true } } } },
      questionnaire: true,
      startedBy: true,
      completedBy: true,
      policy: true,
      submission: { select: { id: true, submittedAt: true, displayAnswers: true } },
    },
    orderBy: { dueAt: 'asc' },
  })
  const filtered = tasks.filter((task) => {
    const assignedRoles = rolesByObject.get(task.objectId) ?? new Set<string>()
    return hasPolicyRoleAccess(task.policy?.roleIds, assignedRoles)
  })
  const completionMap = await getQuestionnaireCompletionConfigMap(
    Array.from(new Set(filtered.map((task) => task.questionnaireId)))
  )
  const jiraMap = await getLatestSubmissionJiraIssueMap(
    filtered
      .map((task) => task.submissionId)
      .filter((submissionId): submissionId is string => typeof submissionId === 'string' && submissionId.length > 0)
  )
  res.json(
    filtered.map((task) => ({
      ...task,
      submissionNote: getSubmissionNoteFromDisplayAnswers(task.submission?.displayAnswers),
      submissionSubmittedAt: task.submission?.submittedAt ?? null,
      jiraIssue:
        typeof task.submissionId === 'string' && task.submissionId
          ? (jiraMap.get(task.submissionId) ?? null)
          : null,
      questionnaire: task.questionnaire
        ? {
            ...task.questionnaire,
            completionPageTitle: completionMap.get(task.questionnaireId)?.title ?? null,
            completionPageContent: completionMap.get(task.questionnaireId)?.content ?? null,
            showJiraTicketLinkInHistory:
              completionMap.get(task.questionnaireId)?.showJiraTicketLink ?? false,
            showReadonlyResultLinkInHistory:
              completionMap.get(task.questionnaireId)?.showReadonlyResultLink ?? false,
            allowReadonlyResultLinkForAllUsers:
              completionMap.get(task.questionnaireId)?.allowReadonlyResultLinkForAllUsers ?? false,
          }
        : null,
    }))
  )
})

app.get('/api/me/submissions/:id/readonly-data', authMiddleware, async (req, res) => {
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const { id } = req.params
  const submission = await prisma.submission.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, email: true, externalId: true } },
      questionnaire: { select: { id: true, title: true, subtitle: true, sections: true, version: true } },
      objectTask: {
        include: {
          object: { select: { id: true, externalId: true, name: true, type: true, metadata: true } },
        },
      },
    },
  })
  if (!submission) {
    res.status(404).json({ error: 'NOT_FOUND' })
    return
  }
  if (submission.userId !== user.id) {
    const completionMap = await getQuestionnaireCompletionConfigMap([submission.questionnaireId])
    const allowForAllUsers =
      completionMap.get(submission.questionnaireId)?.allowReadonlyResultLinkForAllUsers ?? false
    if (!allowForAllUsers && user.role !== 'ADMIN' && user.role !== 'EDITOR') {
      res.status(403).json({ error: 'FORBIDDEN' })
      return
    }
  }
  const snapshot = submission.questionnaireSnapshot as
    | { id?: string; title?: string; subtitle?: string | null; sections?: unknown; version?: number }
    | null
  const questionnaire = {
    id: snapshot?.id || submission.questionnaire.id,
    title: snapshot?.title || submission.questionnaire.title,
    subtitle: snapshot?.subtitle ?? submission.questionnaire.subtitle,
    sections: Array.isArray(snapshot?.sections)
      ? snapshot.sections
      : ((submission.questionnaire.sections as unknown[]) ?? []),
    version:
      snapshot?.version || submission.questionnaireVersion || submission.questionnaire.version || 1,
  }
  res.json({
    submission,
    questionnaire,
  })
})

app.get('/api/object-tasks/:id', authMiddleware, async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const task = await prisma.objectSurveyTask.findUnique({
    where: { id },
    include: { questionnaire: true, object: true, startedBy: true, completedBy: true, policy: true },
  })
  if (!task) {
    res.status(404).json({ error: 'NOT_FOUND' })
    return
  }
  const { userGroupIds, rolesByObject } = await getUserRoleAssignments(user.id)
  if (task.policy?.createdByGroupId && !userGroupIds.includes(task.policy.createdByGroupId)) {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }
  const assignedRoles = rolesByObject.get(task.objectId) ?? new Set<string>()
  if (!hasPolicyRoleAccess(task.policy?.roleIds, assignedRoles)) {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }

  if (task.status === 'OPEN') {
    if (task.startedByUserId && task.startedByUserId !== user.id) {
      res.status(409).json({
        error: 'TASK_ALREADY_STARTED',
        startedByUserId: task.startedByUserId,
        startedByEmail: task.startedBy?.email ?? null,
        startedAt: task.startedAt,
      })
      return
    }

    if (!task.startedByUserId) {
      const claim = await prisma.objectSurveyTask.updateMany({
        where: { id, status: 'OPEN', startedByUserId: null },
        data: { startedByUserId: user.id, startedAt: new Date() },
      })
      if (claim.count === 0) {
        const latest = await prisma.objectSurveyTask.findUnique({
          where: { id },
          include: { startedBy: true },
        })
        if (!latest || latest.status !== 'OPEN') {
          res.status(409).json({ error: 'TASK_NOT_OPEN' })
          return
        }
        if (latest.startedByUserId && latest.startedByUserId !== user.id) {
          res.status(409).json({
            error: 'TASK_ALREADY_STARTED',
            startedByUserId: latest.startedByUserId,
            startedByEmail: latest.startedBy?.email ?? null,
            startedAt: latest.startedAt,
          })
          return
        }
      }
    }
  }

  const hydrated = await prisma.objectSurveyTask.findUnique({
    where: { id },
    include: { questionnaire: true, object: true, startedBy: true, completedBy: true, policy: true },
  })
  if (!hydrated) {
    res.status(404).json({ error: 'NOT_FOUND' })
    return
  }
  const completionMap = await getQuestionnaireCompletionConfigMap([hydrated.questionnaireId])
  res.json({
    ...hydrated,
    questionnaire: hydrated.questionnaire
      ? {
          ...hydrated.questionnaire,
          completionPageTitle: completionMap.get(hydrated.questionnaireId)?.title ?? null,
          completionPageContent: completionMap.get(hydrated.questionnaireId)?.content ?? null,
          showJiraTicketLinkInHistory:
            completionMap.get(hydrated.questionnaireId)?.showJiraTicketLink ?? false,
          showReadonlyResultLinkInHistory:
            completionMap.get(hydrated.questionnaireId)?.showReadonlyResultLink ?? false,
          allowReadonlyResultLinkForAllUsers:
            completionMap.get(hydrated.questionnaireId)?.allowReadonlyResultLinkForAllUsers ?? false,
        }
      : null,
  })
})

app.get('/api/object-tasks/:id/prefill', authMiddleware, async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  await ensureObjectQuestionnairePrefillTable()
  const task = await prisma.objectSurveyTask.findUnique({
    where: { id },
    include: { questionnaire: true, policy: true },
  })
  if (!task) {
    res.status(404).json({ error: 'NOT_FOUND' })
    return
  }
  const { userGroupIds, rolesByObject } = await getUserRoleAssignments(user.id)
  if (task.policy?.createdByGroupId && !userGroupIds.includes(task.policy.createdByGroupId)) {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }
  const assignedRoles = rolesByObject.get(task.objectId) ?? new Set<string>()
  if (!hasPolicyRoleAccess(task.policy?.roleIds, assignedRoles)) {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }

  const rows = (await prisma.$queryRawUnsafe(
    `
      SELECT *
      FROM "ObjectQuestionnairePrefill"
      WHERE "objectId" = $1 AND "questionnaireId" = $2
      LIMIT 1
    `,
    task.objectId,
    task.questionnaireId
  )) as Array<{
    id: string
    questionnaireVersion: number | null
    answersJson: unknown
    createdAt: Date
    updatedAt: Date
  }>
  const row = rows[0]
  if (row) {
    const sanitized = sanitizePrefillAnswers(task.questionnaire.sections, row.answersJson)
    const hasAnswers = Object.keys(sanitized).some(
      (key) =>
        !key.endsWith('__customOptions') &&
        !key.endsWith('__reason') &&
        !key.endsWith('__objectMeta')
    )
    if (hasAnswers) {
      res.json({
        exists: true,
        source: 'MANUAL_IMPORT',
        id: row.id,
        questionnaireVersion: row.questionnaireVersion,
        versionMatches:
          row.questionnaireVersion === null ||
          row.questionnaireVersion === undefined ||
          row.questionnaireVersion === task.questionnaire.version,
        answers: sanitized,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })
      return
    }
  }

  const prefillMap = await getObjectPolicyPrefillConfigMap([task.policyId])
  const allowLastSubmissionPrefill = prefillMap.get(task.policyId) ?? false
  if (!allowLastSubmissionPrefill || task.policy?.frequency === 'ONCE') {
    res.json({ exists: false })
    return
  }

  const lastDone = await prisma.objectSurveyTask.findFirst({
    where: {
      objectId: task.objectId,
      questionnaireId: task.questionnaireId,
      status: 'DONE',
      submissionId: { not: null },
      id: { not: task.id },
    },
    include: {
      submission: {
        select: {
          id: true,
          questionnaireVersion: true,
          answers: true,
          submittedAt: true,
        },
      },
    },
    orderBy: { completedAt: 'desc' },
  })
  if (!lastDone?.submission) {
    res.json({ exists: false })
    return
  }

  const sanitized = sanitizePrefillAnswers(task.questionnaire.sections, lastDone.submission.answers)
  const hasAnswers = Object.keys(sanitized).some(
    (key) =>
      !key.endsWith('__customOptions') &&
      !key.endsWith('__reason') &&
      !key.endsWith('__objectMeta')
  )
  if (!hasAnswers) {
    res.json({ exists: false })
    return
  }
  res.json({
    exists: true,
    source: 'LAST_SUBMISSION',
    questionnaireVersion: lastDone.submission.questionnaireVersion ?? null,
    versionMatches:
      lastDone.submission.questionnaireVersion === null ||
      lastDone.submission.questionnaireVersion === undefined ||
      lastDone.submission.questionnaireVersion === task.questionnaire.version,
    answers: sanitized,
    updatedAt: lastDone.completedAt ?? lastDone.submission.submittedAt,
  })
})

app.post('/api/object-tasks/:id/submit', authMiddleware, async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const { answers, displayAnswers, submissionNote } = req.body as {
    answers?: unknown
    displayAnswers?: unknown
    submissionNote?: unknown
  }
  if (!answers) {
    res.status(400).json({ error: 'MISSING_ANSWERS' })
    return
  }
  const task = await prisma.objectSurveyTask.findUnique({
    where: { id },
    include: { policy: true, questionnaire: true },
  })
  if (!task) {
    res.status(404).json({ error: 'NOT_FOUND' })
    return
  }
  const { userGroupIds, rolesByObject } = await getUserRoleAssignments(user.id)
  if (task.policy?.createdByGroupId && !userGroupIds.includes(task.policy.createdByGroupId)) {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }
  const assignedRoles = rolesByObject.get(task.objectId) ?? new Set<string>()
  if (!hasPolicyRoleAccess(task.policy?.roleIds, assignedRoles)) {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }
  if (task.status !== 'OPEN') {
    res.status(409).json({ error: 'TASK_NOT_OPEN' })
    return
  }
  const assignmentValidation = validateAssignmentPickerRequiredOptions(
    task.questionnaire.sections,
    answers
  )
  if (!assignmentValidation.ok) {
    res.status(400).json({ error: assignmentValidation.error })
    return
  }

  if (task.startedByUserId && task.startedByUserId !== user.id) {
    const starter = await prisma.user.findUnique({
      where: { id: task.startedByUserId },
      select: { id: true, email: true },
    })
    res.status(409).json({
      error: 'TASK_ALREADY_STARTED',
      startedByUserId: task.startedByUserId,
      startedByEmail: starter?.email ?? null,
      startedAt: task.startedAt,
    })
    return
  }

  if (!task.startedByUserId) {
    const claim = await prisma.objectSurveyTask.updateMany({
      where: { id, status: 'OPEN', startedByUserId: null },
      data: { startedByUserId: user.id, startedAt: new Date() },
    })
    if (claim.count === 0) {
      const latest = await prisma.objectSurveyTask.findUnique({
        where: { id },
        include: { startedBy: true },
      })
      if (!latest || latest.status !== 'OPEN') {
        res.status(409).json({ error: 'TASK_NOT_OPEN' })
        return
      }
      if (latest.startedByUserId && latest.startedByUserId !== user.id) {
        res.status(409).json({
          error: 'TASK_ALREADY_STARTED',
          startedByUserId: latest.startedByUserId,
          startedByEmail: latest.startedBy?.email ?? null,
          startedAt: latest.startedAt,
        })
        return
      }
    }
  }

  const normalizedSubmissionNote = normalizeSubmissionNoteInput(submissionNote)
  const resolvedDisplayAnswers = withSubmissionNoteDisplayAnswer(displayAnswers, normalizedSubmissionNote)

  const submission = await prisma.submission.create({
    data: {
      questionnaireId: task.questionnaireId,
      questionnaireVersion: task.questionnaire.version,
      questionnaireSnapshot: buildQuestionnaireSnapshot(task.questionnaire),
      answers,
      displayAnswers: resolvedDisplayAnswers,
      userId: user.id,
    },
  })

  const completedAt = new Date()
  await prisma.objectSurveyTask.update({
    where: { id },
    data: {
      status: 'DONE',
      completedAt,
      completedByUserId: user.id,
      submissionId: submission.id,
    },
  })

  await prisma.objectSurveyTask.updateMany({
    where: {
      id: { not: id },
      policyId: task.policyId,
      objectId: task.objectId,
      status: 'OPEN',
    },
    data: {
      status: 'CLOSED_BY_OTHER',
      completedAt,
      completedByUserId: user.id,
    },
  })

  const jiraIssue = await tryAutoCreateJiraIssueForSubmission(submission.id)
  res.json({ ok: true, submissionId: submission.id, jiraIssue })
})

app.post('/api/object-tasks/:id/cancel', authMiddleware, async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }

  const task = await prisma.objectSurveyTask.findUnique({
    where: { id },
    include: { policy: true, startedBy: true },
  })
  if (!task) {
    res.status(404).json({ error: 'NOT_FOUND' })
    return
  }

  const { userGroupIds, rolesByObject } = await getUserRoleAssignments(user.id)
  if (task.policy?.createdByGroupId && !userGroupIds.includes(task.policy.createdByGroupId)) {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }
  const assignedRoles = rolesByObject.get(task.objectId) ?? new Set<string>()
  if (!hasPolicyRoleAccess(task.policy?.roleIds, assignedRoles)) {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }

  if (task.status !== 'OPEN') {
    res.status(409).json({ error: 'TASK_NOT_OPEN' })
    return
  }

  if (task.startedByUserId && task.startedByUserId !== user.id) {
    res.status(409).json({
      error: 'TASK_ALREADY_STARTED',
      startedByUserId: task.startedByUserId,
      startedByEmail: task.startedBy?.email ?? null,
      startedAt: task.startedAt,
    })
    return
  }

  if (!task.startedByUserId) {
    res.json({ ok: true, released: false })
    return
  }

  const released = await prisma.objectSurveyTask.updateMany({
    where: { id, status: 'OPEN', startedByUserId: user.id },
    data: { startedByUserId: null },
  })
  if (released.count === 0) {
    const latest = await prisma.objectSurveyTask.findUnique({
      where: { id },
      include: { startedBy: true },
    })
    if (!latest || latest.status !== 'OPEN') {
      res.status(409).json({ error: 'TASK_NOT_OPEN' })
      return
    }
    if (latest.startedByUserId && latest.startedByUserId !== user.id) {
      res.status(409).json({
        error: 'TASK_ALREADY_STARTED',
        startedByUserId: latest.startedByUserId,
        startedByEmail: latest.startedBy?.email ?? null,
        startedAt: latest.startedAt,
      })
      return
    }
    res.json({ ok: true, released: false })
    return
  }

  res.json({ ok: true, released: true })
})

app.post('/api/questionnaires/:id/submissions', authMiddleware, async (req, res) => {
  const { id } = req.params
  const { answers, displayAnswers, submissionNote } = req.body as {
    answers?: unknown
    displayAnswers?: unknown
    submissionNote?: unknown
  }
  if (!answers) {
    res.status(400).json({ error: 'MISSING_ANSWERS' })
    return
  }
  const q = await prisma.questionnaire.findUnique({
    where: { id },
    include: { groups: true },
  })
  if (!q) {
    res.status(404).json({ error: 'NOT_FOUND' })
    return
  }
  if (q.deletedAt) {
    res.status(404).json({ error: 'NOT_FOUND' })
    return
  }
  const user = req.user
  if (user?.id && !q.allowMultipleSubmissions) {
    const existing = await prisma.submission.findFirst({
      where: { questionnaireId: id, userId: user.id },
      orderBy: { submittedAt: 'desc' },
    })
    if (existing) {
      res.status(409).json({
        error: 'ALREADY_SUBMITTED',
        submittedAt: existing.submittedAt,
      })
      return
    }
  }
  if (user?.role !== 'ADMIN' && user?.role !== 'EDITOR') {
    const memberships = await prisma.groupMember.findMany({
      where: { userId: user?.id ?? '' },
    })
    const groupIds = new Set(memberships.map((m) => m.groupId))
    const allowed = q.groups.some((g) => groupIds.has(g.groupId))
    const globallyAllowed = q.globalForAllUsers
    if ((!allowed && !globallyAllowed) || !isCurrent(q.status, q.activeFrom, q.activeTo)) {
      res.status(403).json({ error: 'FORBIDDEN' })
      return
    }
  }
  const assignmentValidation = validateAssignmentPickerRequiredOptions(q.sections, answers)
  if (!assignmentValidation.ok) {
    res.status(400).json({ error: assignmentValidation.error })
    return
  }
  const normalizedSubmissionNote = normalizeSubmissionNoteInput(submissionNote)
  const resolvedDisplayAnswers = withSubmissionNoteDisplayAnswer(displayAnswers, normalizedSubmissionNote)
  const submission = await prisma.submission.create({
    data: {
      questionnaireId: id,
      questionnaireVersion: q.version,
      questionnaireSnapshot: buildQuestionnaireSnapshot(q),
      answers,
      displayAnswers: resolvedDisplayAnswers,
      userId: user?.id,
    },
  })
  const jiraIssue = await tryAutoCreateJiraIssueForSubmission(submission.id)
  res.json({ ...submission, jiraIssue })
})

app.get('/api/questionnaires/:id/submissions', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const questionnaire = await prisma.questionnaire.findUnique({
    where: { id },
    select: {
      id: true,
      createdByUserId: true,
      adminAccessMode: true,
      adminGroupIds: true,
      groups: { select: { groupId: true } },
    },
  })
  if (!questionnaire) {
    res.status(404).json({ error: 'NOT_FOUND' })
    return
  }
  const editorGroupIds = user.role === 'ADMIN' ? [] : await getUserGroupIds(user.id)
  const creatorGroupIds =
    user.role === 'ADMIN' || !questionnaire.createdByUserId
      ? []
      : (await prisma.groupMember.findMany({
          where: { userId: questionnaire.createdByUserId },
          select: { groupId: true },
        })).map((m) => m.groupId)
  const allowedForAdminArea = canManageQuestionnaireByScope({
    userId: user.id,
    userRole: user.role,
    userGroupIds: editorGroupIds,
    questionnaire: {
      ...questionnaire,
      assignedGroupIds: questionnaire.groups.map((g) => g.groupId),
      creatorGroupIds,
    },
  })
  if (!allowedForAdminArea) {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }
  const list = await prisma.submission.findMany({
    where: { questionnaireId: id },
    include: {
      user: { select: { id: true, email: true, externalId: true } },
      objectTask: {
        include: {
          object: { select: { id: true, externalId: true, name: true, type: true, metadata: true } },
        },
      },
    },
    orderBy: { submittedAt: 'desc' },
  })
  const jiraMap = await getLatestSubmissionJiraIssueMap(list.map((entry) => entry.id))
  res.json(
    list.map((entry) => ({
      ...entry,
      jiraIssue: jiraMap.get(entry.id) ?? null,
    }))
  )
})

app.delete('/api/submissions/:id', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const submission = await prisma.submission.findUnique({
    where: { id },
    include: {
      questionnaire: {
        select: {
          id: true,
          createdByUserId: true,
          adminAccessMode: true,
          adminGroupIds: true,
          groups: { select: { groupId: true } },
        },
      },
    },
  })
  if (!submission) {
    res.status(404).json({ error: 'NOT_FOUND' })
    return
  }
  const editorGroupIds = user.role === 'ADMIN' ? [] : await getUserGroupIds(user.id)
  const creatorGroupIds =
    user.role === 'ADMIN' || !submission.questionnaire.createdByUserId
      ? []
      : (await prisma.groupMember.findMany({
          where: { userId: submission.questionnaire.createdByUserId },
          select: { groupId: true },
        })).map((m) => m.groupId)
  const allowedForAdminArea = canManageQuestionnaireByScope({
    userId: user.id,
    userRole: user.role,
    userGroupIds: editorGroupIds,
    questionnaire: {
      ...submission.questionnaire,
      assignedGroupIds: submission.questionnaire.groups.map((g) => g.groupId),
      creatorGroupIds,
    },
  })
  if (!allowedForAdminArea) {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }
  await prisma.submission.delete({ where: { id } })
  res.json({ ok: true })
})

app.get('/api/admin/questionnaires/:id/jira-config', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const questionnaire = await prisma.questionnaire.findUnique({
    where: { id },
    select: {
      id: true,
      createdByUserId: true,
      adminAccessMode: true,
      adminGroupIds: true,
      groups: { select: { groupId: true } },
    },
  })
  if (!questionnaire) {
    res.status(404).json({ error: 'NOT_FOUND' })
    return
  }
  const editorGroupIds = user.role === 'ADMIN' ? [] : await getUserGroupIds(user.id)
  const creatorGroupIds =
    user.role === 'ADMIN' || !questionnaire.createdByUserId
      ? []
      : (await prisma.groupMember.findMany({
          where: { userId: questionnaire.createdByUserId },
          select: { groupId: true },
        })).map((m) => m.groupId)
  const allowedForAdminArea = canManageQuestionnaireByScope({
    userId: user.id,
    userRole: user.role,
    userGroupIds: editorGroupIds,
    questionnaire: {
      ...questionnaire,
      assignedGroupIds: questionnaire.groups.map((g) => g.groupId),
      creatorGroupIds,
    },
  })
  if (!allowedForAdminArea) {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }
  const config = await getQuestionnaireJiraConfig(id)
  res.json(config)
})

app.put('/api/admin/questionnaires/:id/jira-config', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const { id } = req.params
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const questionnaire = await prisma.questionnaire.findUnique({
    where: { id },
    select: {
      id: true,
      createdByUserId: true,
      adminAccessMode: true,
      adminGroupIds: true,
      groups: { select: { groupId: true } },
    },
  })
  if (!questionnaire) {
    res.status(404).json({ error: 'NOT_FOUND' })
    return
  }
  const editorGroupIds = user.role === 'ADMIN' ? [] : await getUserGroupIds(user.id)
  const creatorGroupIds =
    user.role === 'ADMIN' || !questionnaire.createdByUserId
      ? []
      : (await prisma.groupMember.findMany({
          where: { userId: questionnaire.createdByUserId },
          select: { groupId: true },
        })).map((m) => m.groupId)
  const allowedForAdminArea = canManageQuestionnaireByScope({
    userId: user.id,
    userRole: user.role,
    userGroupIds: editorGroupIds,
    questionnaire: {
      ...questionnaire,
      assignedGroupIds: questionnaire.groups.map((g) => g.groupId),
      creatorGroupIds,
    },
  })
  if (!allowedForAdminArea) {
    res.status(403).json({ error: 'FORBIDDEN' })
    return
  }

  const body = req.body as Partial<QuestionnaireJiraConfig>
  const config = await upsertQuestionnaireJiraConfig(id, {
    autoCreateOnSubmission: body.autoCreateOnSubmission,
    attachExcelToIssue: body.attachExcelToIssue,
    attachPdfToIssue: body.attachPdfToIssue,
    includeSurveyTextInDescription: body.includeSurveyTextInDescription,
    includeReadonlyLinkInDescription: body.includeReadonlyLinkInDescription,
    descriptionIntroHtml: body.descriptionIntroHtml,
    projectKey: body.projectKey,
    issueType: body.issueType,
    summaryTemplate: body.summaryTemplate,
    summaryQuestionId: body.summaryQuestionId,
    summaryPrefix: body.summaryPrefix,
    summarySuffix: body.summarySuffix,
    includeObjectInSummary: body.includeObjectInSummary,
    includeObjectAsComponent: body.includeObjectAsComponent,
    assignee: body.assignee,
    contactPerson: body.contactPerson,
    contactPersonMode: body.contactPersonMode,
    epicName: body.epicName,
    components: body.components,
    dueDate: body.dueDate,
  })
  res.json(config)
})

app.get('/api/admin/jira-configs', authMiddleware, requireRole(['ADMIN', 'EDITOR']), async (req, res) => {
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  const list = await listQuestionnaireJiraConfigsForUser({ id: user.id, role: user.role })
  res.json(list)
})

app.get('/api/integrations/jira/meta', authMiddleware, requireRole(['ADMIN']), async (_req, res) => {
  res.json({
    enabled: Boolean(JIRA_ISSUE_CREATE_URL && JIRA_BASIC_AUTH),
    issueCreateUrl: JIRA_ISSUE_CREATE_URL,
    issueBrowseUrl: JIRA_ISSUE_BROWSE_URL,
    userSearchUrl: JIRA_USER_SEARCH_URL,
    defaultProjectKey: JIRA_DEFAULT_PROJECT_KEY,
    defaultIssueType: JIRA_DEFAULT_ISSUE_TYPE,
    contactCustomFieldId: JIRA_CONTACT_CUSTOM_FIELD_ID,
    epicNameCustomFieldId: JIRA_EPIC_NAME_CUSTOM_FIELD_ID,
    defaultComponents: JIRA_DEFAULT_COMPONENTS,
  })
})

app.post('/api/integrations/jira/debug/create', authMiddleware, requireRole(['ADMIN']), async (req, res) => {
  const {
    submissionId,
    projectKey,
    summary,
    assignee,
    issueType,
    dryRun,
    contactPerson,
    epicName,
    components,
    dueDate,
    attachExcelToIssue,
    attachPdfToIssue,
  } = req.body as {
    submissionId?: string
    projectKey?: string
    summary?: string
    assignee?: string
    issueType?: string
    contactPerson?: string
    epicName?: string
    components?: string[]
    dueDate?: string
    attachExcelToIssue?: boolean
    attachPdfToIssue?: boolean
    dryRun?: boolean
  }
  if (!submissionId) {
    res.status(400).json({ error: 'MISSING_FIELDS', details: 'submissionId is required' })
    return
  }
  if (!JIRA_ISSUE_CREATE_URL || !JIRA_BASIC_AUTH) {
    res.status(500).json({ error: 'JIRA_NOT_CONFIGURED' })
    return
  }

  const submission = await loadSubmissionForJira(submissionId)
  if (!submission) {
    res.status(404).json({ error: 'SUBMISSION_NOT_FOUND' })
    return
  }

  const config = await getQuestionnaireJiraConfig(submission.questionnaireId)
  const merged = await mergeJiraIssueInput(submission, config, {
    projectKey,
    summary,
    assignee,
    issueType,
    contactPerson,
    epicName,
    components,
    dueDate,
    attachExcelToIssue,
    attachPdfToIssue,
  })
  if (!merged.projectKey) {
    res.status(400).json({ error: 'MISSING_PROJECT_KEY' })
    return
  }
  if (!merged.summary) {
    res.status(400).json({ error: 'MISSING_SUMMARY' })
    return
  }

  const description = await resolveJiraDescriptionFromConfig(config, submission)

  const payload = buildJiraIssuePayload({
    projectKey: merged.projectKey,
    summary: merged.summary,
    description,
    issueType: merged.issueType ?? undefined,
    assignee: merged.assignee ?? undefined,
    contactPerson: merged.contactPerson ?? undefined,
    epicName: merged.epicName ?? undefined,
    components: merged.components,
    dueDate: merged.dueDate ?? undefined,
  })

  const plannedAttachments: string[] = []
  if (merged.attachExcelToIssue) plannedAttachments.push(`${buildJiraAttachmentBaseName(submission)}.xlsx`)
  if (merged.attachPdfToIssue) plannedAttachments.push(`${buildJiraAttachmentBaseName(submission)}.pdf`)

  const runDry = dryRun !== false
  if (runDry) {
    res.json({
      ok: true,
      dryRun: true,
      request: {
        url: JIRA_ISSUE_CREATE_URL,
        method: 'POST',
        payload,
      },
      diagnostics: {
        configured: Boolean(JIRA_ISSUE_CREATE_URL && JIRA_BASIC_AUTH),
        issueCreateUrl: JIRA_ISSUE_CREATE_URL,
        issueBrowseUrl: JIRA_ISSUE_BROWSE_URL,
        issueType: merged.issueType || JIRA_DEFAULT_ISSUE_TYPE || 'Task',
        contactCustomFieldId: JIRA_CONTACT_CUSTOM_FIELD_ID,
        epicNameCustomFieldId: JIRA_EPIC_NAME_CUSTOM_FIELD_ID,
        questionnaireConfig: config,
        plannedAttachments,
      },
    })
    return
  }

  try {
    const response = await fetch(JIRA_ISSUE_CREATE_URL, {
      method: 'POST',
      headers: {
        Authorization: JIRA_BASIC_AUTH,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const text = await response.text()
    if (!response.ok) {
      res.status(502).json({
        error: 'JIRA_CREATE_FAILED',
        status: response.status,
        statusText: response.statusText,
        details: text.slice(0, 2000),
        request: { url: JIRA_ISSUE_CREATE_URL, method: 'POST', payload },
      })
      return
    }
    const data = JSON.parse(text)
    const key = data?.key ? String(data.key) : ''
    const attachments: Array<{ filename: string; ok: boolean; error?: string }> = []
    if (key) {
      const files: JiraIssueAttachmentFile[] = []
      if (merged.attachExcelToIssue) files.push(await buildJiraExcelAttachment(submission))
      if (merged.attachPdfToIssue) files.push(await buildJiraPdfAttachment(submission))
      for (const file of files) {
        try {
          await uploadJiraIssueAttachment(key, file)
          attachments.push({ filename: file.filename, ok: true })
        } catch (err) {
          attachments.push({ filename: file.filename, ok: false, error: String(err) })
        }
      }
    }

    res.json({
      ok: true,
      dryRun: false,
      key,
      id: data?.id ?? null,
      browseUrl: key && JIRA_ISSUE_BROWSE_URL ? `${JIRA_ISSUE_BROWSE_URL}${key}` : null,
      response: data,
      attachments,
    })
  } catch (err) {
    res.status(502).json({
      error: 'JIRA_CREATE_FAILED',
      details: String(err),
      request: { url: JIRA_ISSUE_CREATE_URL, method: 'POST', payload },
    })
  }
})

app.post('/api/integrations/jira/debug/connectivity', authMiddleware, requireRole(['ADMIN']), async (req, res) => {
  const { projectKey, issueNumber, userQuery } = req.body as {
    projectKey?: string
    issueNumber?: string
    userQuery?: string
  }

  const checks: any[] = []
  const hasCreateConfig = Boolean(JIRA_ISSUE_CREATE_URL && JIRA_BASIC_AUTH)
  const hasUserSearchConfig = Boolean(JIRA_USER_SEARCH_URL && JIRA_BASIC_AUTH)

  if (JIRA_ISSUE_CREATE_URL) {
    checks.push(
      await jiraProbe('issue-create-endpoint (OPTIONS)', JIRA_ISSUE_CREATE_URL, {
        method: 'OPTIONS',
        headers: {
          Authorization: JIRA_BASIC_AUTH,
          Accept: 'application/json',
        },
      })
    )
    checks.push(
      await jiraProbe('issue-create-endpoint (POST dry payload)', JIRA_ISSUE_CREATE_URL, {
        method: 'POST',
        headers: {
          Authorization: JIRA_BASIC_AUTH,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          fields: {
            project: { key: String(projectKey || JIRA_DEFAULT_PROJECT_KEY || 'PIT') },
            summary: 'Connectivity test only - please ignore',
            description: 'Connectivity test only',
            issuetype: { name: JIRA_DEFAULT_ISSUE_TYPE || 'Task' },
          },
        }),
      })
    )
  }

  if (JIRA_USER_SEARCH_URL) {
    const q = encodeURIComponent(String(userQuery || 'svc').trim() || 'svc')
    checks.push(
      await jiraProbe('user-search-endpoint (GET)', `${JIRA_USER_SEARCH_URL}${q}`, {
        method: 'GET',
        headers: {
          Authorization: JIRA_BASIC_AUTH,
          Accept: 'application/json',
        },
      })
    )
  }

  const issueBase = getJiraIssueApiBaseUrl()
  const pk = String(projectKey || '').trim().toUpperCase()
  const nr = String(issueNumber || '').trim()
  if (issueBase && pk && nr) {
    const issueKey = `${pk}-${nr}`
    checks.push(
      await jiraProbe('issue-read-endpoint (GET)', `${issueBase}/${encodeURIComponent(issueKey)}`, {
        method: 'GET',
        headers: {
          Authorization: JIRA_BASIC_AUTH,
          Accept: 'application/json',
        },
      })
    )
  }

  const successCount = checks.filter((c) => c.ok).length
  res.json({
    ok: successCount > 0,
    checks,
    summary: {
      total: checks.length,
      succeeded: successCount,
      failed: checks.length - successCount,
    },
    config: {
      hasCreateConfig,
      hasUserSearchConfig,
      issueCreateUrl: JIRA_ISSUE_CREATE_URL || null,
      issueBrowseUrl: JIRA_ISSUE_BROWSE_URL || null,
      userSearchUrl: JIRA_USER_SEARCH_URL || null,
      jiraApiBase: issueBase || null,
      jiraAuthUser: getJiraAuthDebugUser(),
    },
  })
})

app.get('/api/integrations/jira/issues/:projectKey/:issueNumber', authMiddleware, requireRole(['ADMIN']), async (req, res) => {
  const debug = String(req.query.debug ?? '').trim() === '1'
  const projectKey = String(req.params.projectKey ?? '').trim().toUpperCase()
  const issueNumber = String(req.params.issueNumber ?? '').trim()
  if (!projectKey || !issueNumber) {
    res.status(400).json({ error: 'MISSING_FIELDS' })
    return
  }
  if (!JIRA_ISSUE_CREATE_URL || !JIRA_BASIC_AUTH) {
    res.status(500).json({ error: 'JIRA_NOT_CONFIGURED' })
    return
  }
  const base = getJiraIssueApiBaseUrl()
  if (!base) {
    res.status(500).json({ error: 'JIRA_NOT_CONFIGURED' })
    return
  }
  const issueKey = `${projectKey}-${issueNumber}`
  const issueUrl = `${base}/${encodeURIComponent(issueKey)}`
  const startedAt = Date.now()
  try {
    const response = await fetch(issueUrl, {
      method: 'GET',
      headers: {
        Authorization: JIRA_BASIC_AUTH,
        Accept: 'application/json',
      },
    })
    const text = await response.text()
    const responseHeaders = pickResponseHeaders(response)
    if (!response.ok) {
      res.status(502).json({
        error: 'JIRA_FETCH_ISSUE_FAILED',
        status: response.status,
        statusText: response.statusText,
        details: text.slice(0, 2000),
        issueKey,
        debug: {
          enabled: debug,
          issueUrl,
          jiraApiBase: base,
          timingMs: Date.now() - startedAt,
          jiraAuthUser: getJiraAuthDebugUser(),
          responseHeaders,
        },
      })
      return
    }
    let data: any = null
    try {
      data = JSON.parse(text)
    } catch {
      res.status(502).json({
        error: 'JIRA_FETCH_ISSUE_FAILED',
        details: 'Jira response is not valid JSON.',
        issueKey,
        debug: {
          enabled: debug,
          issueUrl,
          jiraApiBase: base,
          timingMs: Date.now() - startedAt,
          jiraAuthUser: getJiraAuthDebugUser(),
          responseHeaders,
          rawBodySnippet: text.slice(0, 2000),
        },
      })
      return
    }
    res.json({
      ok: true,
      issueKey,
      id: data?.id ?? null,
      key: data?.key ?? issueKey,
      summary: data?.fields?.summary ?? null,
      status: data?.fields?.status?.name ?? null,
      assignee: data?.fields?.assignee?.displayName ?? data?.fields?.assignee?.name ?? null,
      reporter: data?.fields?.reporter?.displayName ?? data?.fields?.reporter?.name ?? null,
      created: data?.fields?.created ?? null,
      updated: data?.fields?.updated ?? null,
      raw: data,
      browseUrl: JIRA_ISSUE_BROWSE_URL ? `${JIRA_ISSUE_BROWSE_URL}${issueKey}` : null,
      ...(debug
        ? {
            debug: {
              issueUrl,
              jiraApiBase: base,
              timingMs: Date.now() - startedAt,
              jiraAuthUser: getJiraAuthDebugUser(),
              responseHeaders,
            },
          }
        : {}),
    })
  } catch (err) {
    res.status(502).json({
      error: 'JIRA_FETCH_ISSUE_FAILED',
      details: String(err),
      issueKey,
      debug: {
        enabled: debug,
        issueUrl,
        jiraApiBase: base,
        timingMs: Date.now() - startedAt,
        jiraAuthUser: getJiraAuthDebugUser(),
        error: toErrorDebug(err),
      },
    })
  }
})

app.get('/api/integrations/jira/users', authMiddleware, requireRole(['ADMIN']), async (req, res) => {
  const q = String(req.query.q ?? '').trim()
  if (!q) {
    res.json([])
    return
  }
  if (!JIRA_USER_SEARCH_URL || !JIRA_BASIC_AUTH) {
    res.status(500).json({ error: 'JIRA_NOT_CONFIGURED' })
    return
  }
  try {
    const response = await fetch(`${JIRA_USER_SEARCH_URL}${encodeURIComponent(q)}`, {
      method: 'GET',
      headers: {
        Authorization: JIRA_BASIC_AUTH,
        Accept: 'application/json',
      },
    })
    const text = await response.text()
    if (!response.ok) {
      res.status(502).json({ error: 'JIRA_USER_SEARCH_FAILED', details: text.slice(0, 500) })
      return
    }
    const data = JSON.parse(text)
    const users = Array.isArray(data)
      ? data.map((u) => ({
          username: u?.name ?? '',
          displayName: u?.displayName ?? '',
          emailAddress: u?.emailAddress ?? '',
        }))
      : []
    res.json(users)
  } catch (err) {
    res.status(502).json({ error: 'JIRA_USER_SEARCH_FAILED', details: String(err) })
  }
})

app.post('/api/integrations/jira/issues', authMiddleware, requireRole(['ADMIN']), async (req, res) => {
  const {
    submissionId,
    projectKey,
    summary,
    assignee,
    issueType,
    contactPerson,
    epicName,
    components,
    dueDate,
    attachExcelToIssue,
    attachPdfToIssue,
  } = req.body as {
    submissionId?: string
    projectKey?: string
    summary?: string
    assignee?: string
    issueType?: string
    contactPerson?: string
    epicName?: string
    components?: string[]
    dueDate?: string
    attachExcelToIssue?: boolean
    attachPdfToIssue?: boolean
  }
  if (!submissionId) {
    res.status(400).json({ error: 'MISSING_FIELDS', details: 'submissionId is required' })
    return
  }
  if (!JIRA_ISSUE_CREATE_URL || !JIRA_BASIC_AUTH) {
    res.status(500).json({ error: 'JIRA_NOT_CONFIGURED' })
    return
  }

  try {
    const result = await createJiraIssueFromSubmission(submissionId, {
      projectKey,
      summary,
      assignee,
      issueType,
      contactPerson,
      epicName,
      components,
      dueDate,
      attachExcelToIssue,
      attachPdfToIssue,
    })
    res.json({
      ok: true,
      key: result.key,
      id: result.id,
      browseUrl: result.browseUrl,
      attachments: result.attachments,
    })
  } catch (err) {
    const message = String(err)
    if (message.includes('SUBMISSION_NOT_FOUND')) {
      res.status(404).json({ error: 'SUBMISSION_NOT_FOUND' })
      return
    }
    if (message.includes('MISSING_PROJECT_KEY')) {
      res.status(400).json({ error: 'MISSING_PROJECT_KEY' })
      return
    }
    if (message.includes('MISSING_SUMMARY')) {
      res.status(400).json({ error: 'MISSING_SUMMARY' })
      return
    }
    res.status(502).json({ error: 'JIRA_CREATE_FAILED', details: message })
  }
})

app.post('/api/admin/maintenance/override-cleanup', authMiddleware, requireRole(['ADMIN']), async (req, res) => {
  const { apply } = req.body as { apply?: boolean }
  const result = await cleanupStaleOverridePolicies(Boolean(apply))
  res.json({ ok: true, ...result })
})

app.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://0.0.0.0:${PORT}`)
  backfillMissingUserExternalIds().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to backfill missing user externalIds:', err)
  })
  ensureUserDisplayNameColumn().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to ensure user displayName column:', err)
  })
  ensureExternalObjectImportTables()
    .then(() => startExternalImportScheduler())
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Failed to initialize external object import tables/scheduler:', err)
    })
  ensureObjectGroupRuleConfigTable()
    .then(() => startObjectGroupRuleSyncScheduler())
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Failed to initialize object group rule config/scheduler:', err)
    })
  ensureObjectQuestionnairePrefillTable().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to initialize object questionnaire prefill table:', err)
  })
  ensureObjectPolicyPrefillConfigTables().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to initialize object policy prefill config tables:', err)
  })
  ensureQuestionnaireJiraConfigTable().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to initialize questionnaire Jira config table:', err)
  })
  ensureSubmissionJiraIssueTable().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to initialize submission Jira issue table:', err)
  })
})

