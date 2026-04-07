import type { Question, QuestionDependency, Answers, QuestionnaireSection } from '../types/questionnaire'

const DAY_MS = 24 * 60 * 60 * 1000

export type DependencyObjectContext = {
  type?: string | null
  metadata?: Record<string, unknown> | null
}

function parseDateValue(input: unknown): Date | null {
  if (typeof input !== 'string' || input.trim() === '') return null
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) return null
  return date
}

function wholeDayDiff(a: Date, b: Date): number {
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.round((utcA - utcB) / DAY_MS)
}

function matchDependency(
  dep: QuestionDependency,
  answers: Answers,
  objectContext?: DependencyObjectContext
): boolean {
  const current = answers[dep.questionId]
  const op = dep.operator ?? 'eq'

  if (op === 'object_type_eq') {
    if (!objectContext?.type) return false
    return String(objectContext.type) === String(dep.value ?? '')
  }
  if (op === 'object_meta_eq') {
    if (!objectContext?.metadata || typeof objectContext.metadata !== 'object') return false
    const key = String(dep.objectMetaKey ?? '').trim()
    if (!key) return false
    const raw = objectContext.metadata[key]
    if (raw === undefined || raw === null) return false
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      return String(raw) === String(dep.value ?? '')
    }
    return JSON.stringify(raw) === String(dep.value ?? '')
  }

  if (
    dep.operator === 'date_is_future' ||
    dep.operator === 'date_is_past' ||
    dep.operator === 'date_within_future_days' ||
    dep.operator === 'date_equals'
  ) {
    const currentDate = parseDateValue(current)
    if (!currentDate) return false
    const dayOffset = Number.isFinite(dep.dayOffset) ? Number(dep.dayOffset) : 0
    if (dep.operator === 'date_is_future') {
      const reference = new Date()
      reference.setDate(reference.getDate() + dayOffset)
      return currentDate.getTime() > reference.getTime()
    }
    if (dep.operator === 'date_is_past') {
      const reference = new Date()
      reference.setDate(reference.getDate() + dayOffset)
      return currentDate.getTime() < reference.getTime()
    }
    if (dep.operator === 'date_within_future_days') {
      const now = new Date()
      const maxDays = Math.max(0, dayOffset)
      const diffMs = currentDate.getTime() - now.getTime()
      return diffMs > 0 && diffMs <= maxDays * DAY_MS
    }
    const targetDate = parseDateValue(dep.dateValue)
    if (!targetDate) return false
    const tolerance = Math.abs(dayOffset)
    return Math.abs(wholeDayDiff(currentDate, targetDate)) <= tolerance
  }
  if (op === 'contains' || op === 'not_contains' || op === 'starts_with' || op === 'ends_with') {
    if (Array.isArray(current)) {
      const needle = typeof dep.value === 'string' ? dep.value : ''
      if (!needle) return false
      const hasEntry = current.some((entry) => String(entry) === needle)
      return op === 'not_contains' ? !hasEntry : op === 'contains' ? hasEntry : false
    }
    const currentText = typeof current === 'string' ? current : ''
    const needle = typeof dep.value === 'string' ? dep.value : ''
    if (!needle) return false
    const hay = currentText.toLowerCase()
    const n = needle.toLowerCase()
    if (op === 'contains') return hay.includes(n)
    if (op === 'not_contains') return !hay.includes(n)
    if (op === 'starts_with') return hay.startsWith(n)
    return hay.endsWith(n)
  }
  if (op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte') {
    const currentNum =
      typeof current === 'number'
        ? current
        : typeof current === 'string' && current.trim() !== ''
          ? Number(current)
          : NaN
    const depNum =
      typeof dep.value === 'number'
        ? dep.value
        : typeof dep.value === 'string' && dep.value.trim() !== ''
          ? Number(dep.value)
          : NaN
    if (Number.isNaN(currentNum) || Number.isNaN(depNum)) return false
    if (op === 'gt') return currentNum > depNum
    if (op === 'gte') return currentNum >= depNum
    if (op === 'lt') return currentNum < depNum
    return currentNum <= depNum
  }
  if (op === 'ranking_contains') {
    if (!Array.isArray(current)) return false
    const needle = typeof dep.value === 'string' ? dep.value : ''
    if (!needle) return false
    return current.includes(needle)
  }
  if (op === 'ranking_position_eq' || op === 'ranking_position_better_than') {
    if (!Array.isArray(current)) return false
    const needle = typeof dep.value === 'string' ? dep.value : ''
    const positionValue = Number.isFinite(dep.positionValue) ? Number(dep.positionValue) : NaN
    if (!needle || Number.isNaN(positionValue) || positionValue < 1) return false
    const index = current.indexOf(needle)
    if (index < 0) return false
    const position = index + 1
    if (op === 'ranking_position_eq') return position === positionValue
    return position < positionValue
  }
  if (Array.isArray(dep.value)) {
    if (Array.isArray(current)) {
      return dep.value.every((v) => current.includes(v))
    }
    return dep.value.includes(current as string)
  }
  if (typeof dep.value === 'boolean') {
    return current === dep.value
  }
  if (Array.isArray(current) && typeof dep.value === 'string') {
    return current.includes(dep.value)
  }
  return current === dep.value
}

function mergedDeps(item: { dependency?: QuestionDependency; dependencies?: QuestionDependency[] }) {
  return [...(item.dependencies ?? []), ...(item.dependency ? [item.dependency] : [])]
}

function depsMode(item: { dependencyMode?: 'ALL' | 'ANY' }): 'ALL' | 'ANY' {
  return item.dependencyMode === 'ANY' ? 'ANY' : 'ALL'
}

/** Gibt zur?ck, ob eine Frage sichtbar ist (keine Abh?ngigkeit oder Bedingung erf?llt). */
export function isQuestionVisible(
  question: Question,
  answers: Answers,
  objectContext?: DependencyObjectContext
): boolean {
  const deps: QuestionDependency[] = mergedDeps(question)
  if (deps.length === 0) return true
  return depsMode(question) === 'ANY'
    ? deps.some((dep) => matchDependency(dep, answers, objectContext))
    : deps.every((dep) => matchDependency(dep, answers, objectContext))
}

/** Gibt zur?ck, ob eine Sektion sichtbar ist (keine Abh?ngigkeit oder Bedingung erf?llt). */
export function isSectionVisible(
  section: QuestionnaireSection,
  answers: Answers,
  objectContext?: DependencyObjectContext
): boolean {
  const deps: QuestionDependency[] = mergedDeps(section)
  if (deps.length === 0) return true
  return depsMode(section) === 'ANY'
    ? deps.some((dep) => matchDependency(dep, answers, objectContext))
    : deps.every((dep) => matchDependency(dep, answers, objectContext))
}

/** Alle sichtbaren Fragen einer Sektion (f?r Fortschritt/Stepper). */
export function getVisibleQuestions(
  questions: Question[],
  answers: Answers,
  objectContext?: DependencyObjectContext
): Question[] {
  return questions.filter((q) => isQuestionVisible(q, answers, objectContext))
}
