import type { Questionnaire, Answers, Question } from '../types/questionnaire'
import { sampleQuestionnaire } from '../data/sample-questionnaire'
import { generateId } from './ids'
import { decodeCustomOptionValue } from './custom-options'

const STORAGE_KEY = 'umfrage-questionnaires'
const SUBMISSIONS_KEY = 'umfrage-submissions'

export interface SubmissionRecord {
  id: string
  questionnaireId: string
  answers: Answers
  displayAnswers?: Record<string, string>
  submittedAt: string
}

function readAll(): Questionnaire[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return [sampleQuestionnaire]
    const parsed = JSON.parse(raw) as Questionnaire[]
    if (!Array.isArray(parsed) || parsed.length === 0) return [sampleQuestionnaire]
    const hasSample = parsed.some((q) => q.id === sampleQuestionnaire.id)
    return hasSample ? parsed : [...parsed, sampleQuestionnaire]
  } catch {
    return [sampleQuestionnaire]
  }
}

function writeAll(list: Questionnaire[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
}

export function getQuestionnaires(): Questionnaire[] {
  return readAll()
}

export function getQuestionnaire(id: string): Questionnaire | undefined {
  return readAll().find((q) => q.id === id)
}

export function saveQuestionnaire(questionnaire: Questionnaire): void {
  const list = readAll()
  const normalized = normalizeQuestionnaire(questionnaire)
  const index = list.findIndex((q) => q.id === normalized.id)
  if (index >= 0) {
    list[index] = normalized
  } else {
    list.push(normalized)
  }
  writeAll(list)
}

export function deleteQuestionnaire(id: string): void {
  const list = readAll().filter((q) => q.id !== id)
  writeAll(list.length > 0 ? list : [sampleQuestionnaire])
}

export function duplicateQuestionnaire(id: string): Questionnaire {
  const source = getQuestionnaire(id)
  if (!source) throw new Error('Questionnaire not found')
  const clone: Questionnaire = {
    ...JSON.parse(JSON.stringify(source)),
    id: crypto.randomUUID(),
    title: source.title + ' (Kopie)',
    sections: source.sections.map((sec) => ({
      ...sec,
      id: crypto.randomUUID(),
      questions: sec.questions.map((q) => ({ ...q, id: crypto.randomUUID() })),
    })),
  }
  saveQuestionnaire(clone)
  return clone
}

function normalizeQuestionnaire(questionnaire: Questionnaire): Questionnaire {
  return {
    ...questionnaire,
    sections: questionnaire.sections.map((section) => ({
      ...section,
      questions: section.questions.map((question) => {
        if (!question.options?.length) return question
        const options = question.options.map((opt, index) => {
          const value = opt.value || opt.label || `opt-${index}`
          const label = opt.label || opt.value || value
          return { ...opt, value, label }
        })
        return { ...question, options }
      }),
    })),
  }
}

function readSubmissions(): SubmissionRecord[] {
  try {
    const raw = localStorage.getItem(SUBMISSIONS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as SubmissionRecord[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeSubmissions(list: SubmissionRecord[]) {
  localStorage.setItem(SUBMISSIONS_KEY, JSON.stringify(list))
}

function formatAnswer(question: Question, value: unknown): string {
  const normalize = (val: unknown): string => {
    if (val === undefined || val === null || val === '') return '—'
    if (typeof val === 'object') {
      const obj = val as { label?: string; value?: string }
      if (obj.label) return obj.label
      if (obj.value) return obj.value
    }
    return String(val)
  }

  if (Array.isArray(value)) {
    return value
      .map((v) => {
        if (typeof v === 'object' && v !== null) {
          const obj = v as { label?: string; value?: string }
          if (obj.label && obj.value) return `${obj.label} (${obj.value})`
          if (obj.label) return obj.label
          if (obj.value) return obj.value
        }
        const opt = question.options?.find((o) => o.value === v)
        if (opt?.label) return `${opt.label} (${opt.value})`
        const custom = decodeCustomOptionValue(v)
        if (custom) return `${custom} (added)`
        const byLabel = question.options?.find((o) => o.label === String(v))
        return byLabel?.label ? `${byLabel.label} (${byLabel.value})` : normalize(v)
      })
      .join(', ')
  }
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nein'
  if (question.type === 'single' && question.options?.length) {
    const opt = question.options.find((o) => o.value === value)
    if (opt?.label) return `${opt.label} (${opt.value})`
    const custom = decodeCustomOptionValue(value)
    if (custom) return `${custom} (added)`
    const byLabel = question.options.find((o) => o.label === String(value))
    if (byLabel?.label) return `${byLabel.label} (${byLabel.value})`
  }
  return normalize(value)
}

export function saveSubmission(questionnaire: Questionnaire, answers: Answers): void {
  const list = readSubmissions()
  const displayAnswers: Record<string, string> = {}
  questionnaire.sections.forEach((section) => {
    section.questions.forEach((question) => {
      displayAnswers[question.id] = formatAnswer(question, answers[question.id])
    })
  })
  list.push({
    id: generateId(),
    questionnaireId: questionnaire.id,
    answers,
    displayAnswers,
    submittedAt: new Date().toISOString(),
  })
  writeSubmissions(list)
}

export function getSubmissions(): SubmissionRecord[] {
  return readSubmissions().sort(
    (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
  )
}

export function deleteSubmission(id: string): void {
  const list = readSubmissions().filter((s) => s.id !== id)
  writeSubmissions(list)
}

export function rebuildSubmissions(questionnaires: Questionnaire[]): SubmissionRecord[] {
  const byId = new Map(questionnaires.map((q) => [q.id, q]))
  const rebuilt: SubmissionRecord[] = []
  readSubmissions().forEach((s) => {
    const q = byId.get(s.questionnaireId)
    if (!q) return
    const displayAnswers: Record<string, string> = {}
    q.sections.forEach((section) => {
      section.questions.forEach((question) => {
        displayAnswers[question.id] = formatAnswer(question, s.answers[question.id])
      })
    })
    rebuilt.push({
      ...s,
      displayAnswers,
    })
  })
  writeSubmissions(rebuilt)
  return rebuilt
}
