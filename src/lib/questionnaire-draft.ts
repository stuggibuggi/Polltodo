import type { Answers } from '../types/questionnaire'

interface DraftRecord {
  answers: Answers
  currentSectionIndex: number
  savedAt: string
}

interface DraftScope {
  questionnaireId: string
  taskId?: string
  userId?: string
}

function getDraftKey(scope: DraftScope): string {
  const userPart = scope.userId ?? 'anon'
  const targetPart = scope.taskId ? `task:${scope.taskId}` : `questionnaire:${scope.questionnaireId}`
  return `umfrage:draft:${userPart}:${targetPart}`
}

export function loadQuestionnaireDraft(scope: DraftScope): DraftRecord | null {
  try {
    const raw = localStorage.getItem(getDraftKey(scope))
    if (!raw) return null
    const parsed = JSON.parse(raw) as DraftRecord
    if (!parsed || typeof parsed !== 'object') return null
    if (!parsed.answers || typeof parsed.answers !== 'object') return null
    if (typeof parsed.currentSectionIndex !== 'number') return null
    if (typeof parsed.savedAt !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

export function saveQuestionnaireDraft(
  scope: DraftScope,
  data: { answers: Answers; currentSectionIndex: number }
): string {
  const savedAt = new Date().toISOString()
  const payload: DraftRecord = {
    answers: data.answers,
    currentSectionIndex: data.currentSectionIndex,
    savedAt,
  }
  localStorage.setItem(getDraftKey(scope), JSON.stringify(payload))
  return savedAt
}

export function clearQuestionnaireDraft(scope: DraftScope): void {
  localStorage.removeItem(getDraftKey(scope))
}

