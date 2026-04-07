import { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Questionnaire, Answers } from '../../types/questionnaire'
import type { StepperStep } from './Stepper'
import { Stepper } from './Stepper'
import { QuestionField } from './QuestionField'
import { Button } from '../ui/button'
import { isQuestionVisible, isSectionVisible } from '../../lib/questionnaire-utils'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import {
  loadQuestionnaireDraft,
  saveQuestionnaireDraft,
  clearQuestionnaireDraft,
} from '../../lib/questionnaire-draft'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog'
import { sanitizeRichHtml } from '../../lib/rich-text'

interface QuestionnaireViewProps {
  questionnaire: Questionnaire
  taskId?: string
  prefillData?: Answers | null
  prefillUpdatedAt?: string | null
  prefillSource?: 'MANUAL_IMPORT' | 'LAST_SUBMISSION' | null
  objectContext?: { type?: string | null; metadata?: Record<string, unknown> | null } | null
}

export function QuestionnaireView({
  questionnaire,
  taskId,
  prefillData,
  prefillUpdatedAt,
  prefillSource,
  objectContext,
}: QuestionnaireViewProps) {
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const [answers, setAnswers] = useState<Answers>({})
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0)
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [submittedJiraIssue, setSubmittedJiraIssue] = useState<{
    issueKey: string
    browseUrl?: string | null
  } | null>(null)
  const [missingRequired, setMissingRequired] = useState<string[]>([])
  const [assignmentOptionIssues, setAssignmentOptionIssues] = useState<
    Record<string, Record<string, 'required' | 'single_only'>>
  >({})
  const [showMissingPopup, setShowMissingPopup] = useState(false)
  const [draftLoadedAt, setDraftLoadedAt] = useState<string | null>(null)
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null)
  const [draftHydrated, setDraftHydrated] = useState(false)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submissionNote, setSubmissionNote] = useState('')
  const [submittedSubmissionId, setSubmittedSubmissionId] = useState<string | null>(null)
  const [savingSubmittedNote, setSavingSubmittedNote] = useState(false)
  const [submittedNoteMessage, setSubmittedNoteMessage] = useState<string | null>(null)
  const [prefillApplied, setPrefillApplied] = useState(false)
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null)
  const questionRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const summaryQuestionRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const summaryScrollRef = useRef<HTMLDivElement | null>(null)

  const draftScope = useMemo(
    () => ({
      questionnaireId: questionnaire.id,
      taskId,
      userId: user?.id,
    }),
    [questionnaire.id, taskId, user?.id]
  )

  const isAnswered = (value: Answers[string]) => {
    if (typeof value === 'boolean') return true
    if (Array.isArray(value)) return value.length > 0
    return value !== undefined && value !== null && String(value).trim() !== ''
  }

  const isReasonRequired = (
    question: Questionnaire['sections'][number]['questions'][number],
    value: Answers[string]
  ) => {
    if (!question.options?.length) return false
    if (question.type === 'single') {
      return question.options.some((opt) => opt.value === value && opt.requiresReason)
    }
    if (question.type === 'multi' && Array.isArray(value)) {
      return question.options.some((opt) => value.includes(opt.value) && opt.requiresReason)
    }
    return false
  }

  const hasObjectMetadataGaps = (
    question: Questionnaire['sections'][number]['questions'][number],
    value: Answers[string],
    metadataRaw: Answers[string]
  ) => {
    if (question.type !== 'object_picker' || !question.objectPickerPerObjectMetaEnabled) return false
    const optionEnabled = (question.objectPickerPerObjectMetaOptions?.length ?? 0) > 0
    const textEnabled = !!question.objectPickerPerObjectMetaAllowCustomText
    if (!optionEnabled && !textEnabled) return false
    const selected = Array.isArray(value)
      ? value
      : typeof value === 'string' && value
        ? [value]
        : []
    if (selected.length === 0) return false
    let metadata: Record<string, { option?: string; text?: string }> = {}
    if (typeof metadataRaw === 'string' && metadataRaw.trim()) {
      try {
        const parsed = JSON.parse(metadataRaw) as Record<string, unknown>
        Object.entries(parsed ?? {}).forEach(([key, val]) => {
          if (typeof val === 'string') {
            metadata[key] = { option: val }
            return
          }
          if (val && typeof val === 'object') {
            const option =
              typeof (val as { option?: unknown }).option === 'string'
                ? String((val as { option?: unknown }).option)
                : undefined
            const text =
              typeof (val as { text?: unknown }).text === 'string'
                ? String((val as { text?: unknown }).text)
                : undefined
            metadata[key] = { option, text }
          }
        })
      } catch {
        metadata = {}
      }
    }
    return selected.some((id) => {
      const entry = metadata[id] ?? {}
      const hasOption = !!entry.option?.trim()
      const hasText = !!entry.text?.trim()
      if (optionEnabled && textEnabled) return !hasOption && !hasText
      if (optionEnabled) return !hasOption
      return !hasText
    })
  }

  const isQuestionRequired = (question: Questionnaire['sections'][number]['questions'][number]) => {
    if (question.type === 'assignment_picker') {
      return (question.assignmentOptions ?? []).some((option) => !!option.required)
    }
    return !!question.required
  }

  const getAssignmentPickerIssues = (
    question: Questionnaire['sections'][number]['questions'][number],
    value: Answers[string]
  ) => {
    if (question.type !== 'assignment_picker') return {} as Record<string, 'required' | 'single_only'>
    const options = question.assignmentOptions ?? []
    let parsed: Record<string, { values?: unknown }> = {}
    if (typeof value === 'string' && value.trim()) {
      try {
        const candidate = JSON.parse(value) as Record<string, unknown>
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
          parsed = candidate as Record<string, { values?: unknown }>
        }
      } catch {
        const issues: Record<string, 'required' | 'single_only'> = {}
        options.forEach((option) => {
          if (option.required) issues[option.id] = 'required'
        })
        return issues
      }
    }
    const issues: Record<string, 'required' | 'single_only'> = {}
    options.forEach((option) => {
      const valuesRaw = parsed[option.id]?.values
      const values = Array.isArray(valuesRaw)
        ? valuesRaw.map((entry) => String(entry ?? '').trim()).filter(Boolean)
        : []
      if (option.required && values.length === 0) {
        issues[option.id] = 'required'
        return
      }
      if (!option.allowMultiple && values.length > 1) {
        issues[option.id] = 'single_only'
      }
    })
    return issues
  }

  const sections = useMemo(
    () =>
      questionnaire.sections.filter((section) =>
        isSectionVisible(section, answers, objectContext ?? undefined)
      ),
    [questionnaire.sections, answers, objectContext]
  )
  const currentSection = sections[currentSectionIndex]
  const isFirstSection = currentSectionIndex === 0
  const isLastSection = currentSectionIndex === sections.length - 1
  const visibleQuestionsBySection = useMemo(
    () =>
      sections.map((section) => ({
        section,
        questions: section.questions.filter((question) =>
          isQuestionVisible(question, answers, objectContext ?? undefined)
        ),
      })),
    [sections, answers, objectContext]
  )

  const validateSection = () => {
    if (!currentSection) return true
    const missing: string[] = []
    const nextAssignmentIssues: Record<string, Record<string, 'required' | 'single_only'>> = {}
    currentSection.questions.forEach((question) => {
      if (question.type === 'info') return
      if (!isQuestionRequired(question)) return
      if (!isQuestionVisible(question, answers, objectContext ?? undefined)) return
      const value = answers[question.id]
      if (question.type === 'assignment_picker') {
        const optionIssues = getAssignmentPickerIssues(question, value)
        if (Object.keys(optionIssues).length > 0) {
          missing.push(question.id)
          nextAssignmentIssues[question.id] = optionIssues
        }
        return
      }
      if (question.type === 'object_picker') {
        const selected = Array.isArray(value)
          ? value.filter((entry) => String(entry ?? '').trim() !== '')
          : typeof value === 'string' && value.trim() !== ''
            ? [value]
            : []
        if (selected.length === 0) {
          missing.push(question.id)
          return
        }
      }
      if (!isAnswered(value)) {
        missing.push(question.id)
        return
      }
      const objectMetaKey = `${question.id}__objectMeta`
      if (hasObjectMetadataGaps(question, value, answers[objectMetaKey])) {
        missing.push(question.id)
        return
      }
      if (isReasonRequired(question, value)) {
        const reasonKey = `${question.id}__reason`
        const reasonValue = answers[reasonKey]
        if (!isAnswered(reasonValue)) missing.push(question.id)
      }
    })
    setAssignmentOptionIssues(nextAssignmentIssues)
    setMissingRequired(missing)
    if (missing.length > 0) {
      const first = questionRefs.current[missing[0]]
      if (first) {
        first.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
      setShowMissingPopup(true)
    }
    return missing.length === 0
  }

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [currentSectionIndex])

  useEffect(() => {
    if (!currentSection) {
      setActiveQuestionId(null)
      return
    }
    const visibleQuestions = currentSection.questions.filter((question) =>
      isQuestionVisible(question, answers, objectContext ?? undefined)
    )
    if (visibleQuestions.length === 0) {
      setActiveQuestionId(null)
      return
    }

    const elements = visibleQuestions
      .map((question) => ({ id: question.id, node: questionRefs.current[question.id] }))
      .filter((entry): entry is { id: string; node: HTMLDivElement } => Boolean(entry.node))

    if (elements.length === 0) {
      setActiveQuestionId(visibleQuestions[0].id)
      return
    }

    const ratios = new Map<string, number>()
    elements.forEach((entry) => ratios.set(entry.id, 0))
    setActiveQuestionId((prev) => prev ?? visibleQuestions[0].id)

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const id = (entry.target as HTMLElement).dataset.questionId
          if (!id) return
          ratios.set(id, entry.isIntersecting ? entry.intersectionRatio : 0)
        })

        let bestId = visibleQuestions[0].id
        let bestRatio = -1
        visibleQuestions.forEach((question) => {
          const ratio = ratios.get(question.id) ?? 0
          if (ratio > bestRatio) {
            bestRatio = ratio
            bestId = question.id
          }
        })
        setActiveQuestionId(bestId)
      },
      {
        threshold: [0.1, 0.25, 0.5, 0.75, 1],
        rootMargin: '-15% 0px -65% 0px',
      }
    )

    elements.forEach((entry) => observer.observe(entry.node))
    return () => observer.disconnect()
  }, [currentSection, answers])

  useEffect(() => {
    if (!activeQuestionId) return
    const target = summaryQuestionRefs.current[activeQuestionId]
    const container = summaryScrollRef.current
    if (!target || !container) return
    const targetTop = target.offsetTop
    const targetBottom = targetTop + target.offsetHeight
    const viewTop = container.scrollTop
    const viewBottom = viewTop + container.clientHeight
    if (targetTop < viewTop) {
      container.scrollTop = Math.max(0, targetTop - 8)
      return
    }
    if (targetBottom > viewBottom) {
      container.scrollTop = targetBottom - container.clientHeight + 8
    }
  }, [activeQuestionId, currentSectionIndex])

  useEffect(() => {
    if (sections.length === 0) {
      setCurrentSectionIndex(0)
      return
    }
    if (currentSectionIndex > sections.length - 1) {
      setCurrentSectionIndex(sections.length - 1)
    }
  }, [sections.length, currentSectionIndex])

  const truncateChars = (text: string, maxChars = 100) =>
    text.length > maxChars ? `${text.slice(0, maxChars)}…` : text

  const stepperSteps: StepperStep[] = useMemo(
    () =>
      sections.map((section, index) => ({
        id: section.id,
        label: section.title,
        status:
          index < currentSectionIndex
            ? 'completed'
            : index === currentSectionIndex
              ? 'current'
              : 'upcoming',
      })),
    [sections, currentSectionIndex]
  )

  const setAnswer = useCallback((questionId: string, value: string | string[] | boolean) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }))
  }, [])

  const persistDraft = useCallback(
    (explicit = false): boolean => {
      const hasProgress = currentSectionIndex > 0 || Object.keys(answers).length > 0
      if (!hasProgress) {
        clearQuestionnaireDraft(draftScope)
        setDraftSavedAt(null)
        if (explicit) {
          setSaveNotice('Es gibt noch keine Antworten zum Speichern.')
        }
        return false
      }

      const savedAt = saveQuestionnaireDraft(draftScope, { answers, currentSectionIndex })
      setDraftSavedAt(savedAt)
      if (explicit) {
        setSaveNotice(`Zwischengespeichert am ${new Date(savedAt).toLocaleString('de-DE')}.`)
      }
      return true
    },
    [answers, currentSectionIndex, draftScope]
  )

  useEffect(() => {
    if (authLoading) return
    const draft = loadQuestionnaireDraft(draftScope)
    setAnswers(draft?.answers ?? {})
    if (draft) {
      const safeSectionIndex = Math.min(
        Math.max(draft.currentSectionIndex, 0),
        Math.max(sections.length - 1, 0)
      )
      setCurrentSectionIndex(safeSectionIndex)
      setDraftLoadedAt(draft.savedAt)
      setDraftSavedAt(draft.savedAt)
    } else {
      setCurrentSectionIndex(0)
      setDraftLoadedAt(null)
      setDraftSavedAt(null)
    }
    setDraftHydrated(true)
  }, [authLoading, draftScope])

  useEffect(() => {
    if (authLoading || !draftHydrated || submitted) return
    persistDraft(false)
  }, [authLoading, draftHydrated, persistDraft, submitted])

  const goNext = () => {
    if (!validateSection()) return
    if (!isLastSection) setCurrentSectionIndex((i) => Math.min(i + 1, sections.length - 1))
  }

  const goPrev = () => {
    if (!isFirstSection) setCurrentSectionIndex((i) => Math.max(i - 1, 0))
  }

  const handleSave = () => {
    persistDraft(true)
  }

  const handleSaveAndExit = () => {
    persistDraft(true)
    navigate('/')
  }

  const handleCancel = async () => {
    const confirmed = window.confirm(
      taskId
        ? 'Umfrage wirklich abbrechen? Die Sperre fuer diese Umfrage wird freigegeben.'
        : 'Umfrage wirklich abbrechen? Nicht gespeicherte Eingaben gehen verloren.'
    )
    if (!confirmed) return
    setSubmitError(null)
    setCancelling(true)
    try {
      if (taskId) {
        await api.cancelObjectTask(taskId)
      }
      clearQuestionnaireDraft(draftScope)
      navigate('/')
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Abbrechen fehlgeschlagen. Bitte erneut versuchen.'
      setSubmitError(message)
    } finally {
      setCancelling(false)
    }
  }

  const handleApplyPrefill = () => {
    if (!prefillData) return
    const hasAnswers = Object.keys(answers).length > 0
    if (hasAnswers) {
      const ok = window.confirm(
        'Es gibt bereits Antworten im aktuellen Stand. Vorbefuellung trotzdem laden und vorhandene Werte ueberschreiben?'
      )
      if (!ok) return
    }
    setAnswers((prev) => ({ ...prev, ...prefillData }))
    setPrefillApplied(true)
    setSaveNotice('Vorbefuellung wurde geladen. Nicht vorbefuellte Pflichtfragen muessen weiterhin beantwortet werden.')
  }

  const handleSubmit = async () => {
    if (!validateSection()) return
    setSaving(true)
    setSubmitError(null)
    setSubmittedNoteMessage(null)
    try {
      let jiraIssue: { issueKey?: string; browseUrl?: string | null } | null = null
      let newSubmissionId: string | null = null
      const normalizedSubmissionNote = submissionNote
        .replace(/\r?\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (taskId) {
        const result = await api.submitObjectTask(
          taskId,
          questionnaire,
          answers,
          normalizedSubmissionNote || undefined
        )
        jiraIssue = result.jiraIssue ?? null
        newSubmissionId = result.submissionId
      } else {
        const result = await api.saveSubmission(
          questionnaire,
          answers,
          normalizedSubmissionNote || undefined
        )
        jiraIssue = result.jiraIssue ?? null
        newSubmissionId = result.id
      }
      clearQuestionnaireDraft(draftScope)
      setSubmittedSubmissionId(newSubmissionId)
      if (jiraIssue?.issueKey) {
        setSubmittedJiraIssue({
          issueKey: jiraIssue.issueKey,
          browseUrl: jiraIssue.browseUrl ?? null,
        })
      } else {
        setSubmittedJiraIssue(null)
      }
      setSubmitted(true)
    } catch (error) {
      const defaultMessage = 'Absenden fehlgeschlagen. Bitte pruefen Sie die Eingaben.'
      const message = error instanceof Error && error.message ? error.message : defaultMessage
      if (message.startsWith('ASSIGNMENT_PICKER_')) {
        const [code, questionId, optionId] = message.split(':')
        const question = questionnaire.sections
          .flatMap((section) => section.questions)
          .find((entry) => entry.id === questionId)
        const optionLabel =
          optionId && question?.type === 'assignment_picker'
            ? question.assignmentOptions?.find((opt) => opt.id === optionId)?.label
            : undefined
        if (questionId) {
          setMissingRequired((prev) => (prev.includes(questionId) ? prev : [...prev, questionId]))
          if (optionId) {
            setAssignmentOptionIssues((prev) => ({
              ...prev,
              [questionId]: {
                ...(prev[questionId] ?? {}),
                [optionId]: code === 'ASSIGNMENT_PICKER_SINGLE_ONLY' ? 'single_only' : 'required',
              },
            }))
          }
          const first = questionRefs.current[questionId]
          if (first) first.scrollIntoView({ behavior: 'smooth', block: 'start' })
          setShowMissingPopup(true)
        }
        if (code === 'ASSIGNMENT_PICKER_REQUIRED') {
          setSubmitError(
            optionLabel
              ? `Bitte fuellen Sie die Pflichtzuordnung "${optionLabel}" aus.`
              : 'Bitte fuellen Sie alle Pflichtzuordnungen aus.'
          )
        } else if (code === 'ASSIGNMENT_PICKER_SINGLE_ONLY') {
          setSubmitError(
            optionLabel
              ? `Fuer "${optionLabel}" ist nur eine Zuordnung erlaubt.`
              : 'Fuer eine Option ist nur eine einzelne Zuordnung erlaubt.'
          )
        } else {
          setSubmitError('Die Zuordnungen sind ungueltig. Bitte pruefen Sie die Eingaben.')
        }
      } else {
        setSubmitError(message)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleSaveSubmittedNote = async () => {
    if (!submittedSubmissionId) return
    setSavingSubmittedNote(true)
    setSubmittedNoteMessage(null)
    try {
      const normalizedSubmissionNote = submissionNote
        .replace(/\r?\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      const result = await api.updateMySubmissionNote(
        submittedSubmissionId,
        normalizedSubmissionNote || undefined
      )
      setSubmissionNote(result.submissionNote ?? '')
      setSubmittedNoteMessage('Hinweis gespeichert.')
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Hinweis konnte nicht gespeichert werden.'
      setSubmittedNoteMessage(message)
    } finally {
      setSavingSubmittedNote(false)
    }
  }

  if (submitted) {
    const completionHtmlRaw = questionnaire.completionPageContent?.trim() || ''
    const completionHtmlResolved = completionHtmlRaw
      ? completionHtmlRaw
          .replace(
            /\{\{\s*jiraTicketLink\s*\}\}/g,
            submittedJiraIssue?.browseUrl
              ? `<a href="${submittedJiraIssue.browseUrl}" target="_blank" rel="noopener noreferrer">${submittedJiraIssue.issueKey}</a>`
              : ''
          )
          .replace(/\{\{\s*jiraTicketKey\s*\}\}/g, submittedJiraIssue?.issueKey ?? '')
      : ''
    return (
      <div className="space-y-6">
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white p-6">
          <h2 className="text-xl font-semibold text-[var(--color-foreground)]">
            {questionnaire.completionPageTitle?.trim() || 'Vielen Dank.'}
          </h2>
          {completionHtmlResolved ? (
            <div
              className="prose prose-sm mt-4 max-w-none"
              dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(completionHtmlResolved) }}
            />
          ) : (
            <p className="mt-4 text-sm text-[var(--color-muted)]">
              Ihre Antworten wurden gespeichert.
            </p>
          )}
          {submittedJiraIssue?.browseUrl && (
            <p className="mt-4 text-sm">
              Jira Ticket:{' '}
              <a
                href={submittedJiraIssue.browseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-primary)] underline"
              >
                {submittedJiraIssue.issueKey}
              </a>
            </p>
          )}
          <div className="mt-6 space-y-2">
            <label className="block text-xs text-[var(--color-muted)]">
              Hinweis zur Durchfuehrung (optional, einzeilig)
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={submissionNote}
                onChange={(e) => setSubmissionNote(e.target.value)}
                maxLength={200}
                placeholder="z. B. Version 2 geprueft"
                className="min-w-72 flex-1 rounded-[var(--radius-button)] border border-[var(--color-border)] px-3 py-2 text-sm"
                disabled={!submittedSubmissionId || savingSubmittedNote}
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleSaveSubmittedNote}
                disabled={!submittedSubmissionId || savingSubmittedNote}
              >
                {savingSubmittedNote ? 'Speichert...' : 'Hinweis speichern'}
              </Button>
            </div>
            {submittedNoteMessage && (
              <div className="text-xs text-[var(--color-muted)]">{submittedNoteMessage}</div>
            )}
          </div>
        </div>
        <div className="flex justify-end">
          <Button type="button" onClick={() => navigate('/')}>
            Zur Startseite
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={handleSave}>
          Speichern
        </Button>
        <Button type="button" variant="outline" onClick={handleSaveAndExit}>
          Speichern und beenden
        </Button>
        <Button type="button" variant="outline" onClick={handleCancel} disabled={cancelling}>
          {cancelling ? 'Abbrechen...' : 'Abbrechen'}
        </Button>
        {prefillData && Object.keys(prefillData).length > 0 && (
          <Button type="button" variant="outline" onClick={handleApplyPrefill}>
            {prefillApplied ? 'Vorbefuellung erneut laden' : 'Vorbefuellung laden'}
          </Button>
        )}
      </div>

      {prefillData && Object.keys(prefillData).length > 0 && (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white p-3 text-xs text-[var(--color-muted)]">
          Vorbefuellung verfuegbar
          {prefillSource
            ? prefillSource === 'MANUAL_IMPORT'
              ? ' (Quelle: Import)'
              : ' (Quelle: letzte Durchfuehrung)'
            : ''}
          {prefillUpdatedAt ? ` (Stand: ${new Date(prefillUpdatedAt).toLocaleString('de-DE')})` : ''}.
          Nicht vorbefuellte Fragen bleiben offen.
        </div>
      )}

      {saveNotice && (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white p-3 text-xs text-[var(--color-muted)]">
          {saveNotice}
        </div>
      )}
      {submitError && (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-required)] bg-white p-3 text-sm text-[var(--color-required)]">
          {submitError}
        </div>
      )}

      {(draftLoadedAt || draftSavedAt) && (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white p-3 text-xs text-[var(--color-muted)]">
          {draftLoadedAt && (
            <p>Zwischenspeicher geladen: {new Date(draftLoadedAt).toLocaleString('de-DE')}</p>
          )}
          {draftSavedAt && (
            <p>
              Letzte automatische Speicherung: {new Date(draftSavedAt).toLocaleString('de-DE')}
            </p>
          )}
        </div>
      )}

      {submitted && (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white p-4 text-sm text-[var(--color-foreground)]">
          Vielen Dank. Ihre Antworten wurden gespeichert.
        </div>
      )}

      <Stepper steps={stepperSteps} />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-10">
        <aside
          className="h-fit rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white p-4 text-sm lg:sticky lg:col-span-3"
          style={{ top: 'var(--layout-sticky-offset, 120px)' }}
        >
          <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]">
            Übersicht
          </div>
          <div
            ref={summaryScrollRef}
            className="mt-4 space-y-4 overflow-auto pr-1"
            style={{ maxHeight: 'calc(100vh - var(--layout-sticky-offset, 120px) - 16px)' }}
          >
            {visibleQuestionsBySection.map(({ section, questions }, sIndex) => (
              <div key={section.id} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[var(--color-primary)]" />
                  <span className="font-medium text-[var(--color-foreground)]">
                    {sIndex + 1}. {section.title}
                  </span>
                </div>
                <div className="ml-3 space-y-2 border-l border-[var(--color-border)] pl-3">
                  {questions.map((question, qIndex) => {
                    const answered =
                      question.type === 'info' ? true : isAnswered(answers[question.id])
                    const dotClass = answered
                      ? 'bg-green-500'
                      : isQuestionRequired(question)
                        ? 'bg-[var(--color-required)]'
                        : 'bg-amber-400'
                    return (
                      <div
                        key={question.id}
                        ref={(el) => {
                          summaryQuestionRefs.current[question.id] = el
                        }}
                        className="relative"
                      >
                        <span className={`absolute -left-3 top-2 h-2 w-2 rounded-full ${dotClass}`} />
                        <div className="flex items-start justify-between gap-2">
                          <span
                            className={`text-[var(--color-foreground)] ${
                              activeQuestionId === question.id
                                ? 'font-semibold text-[var(--color-primary)]'
                                : sIndex === currentSectionIndex
                                  ? ''
                                  : 'text-[var(--color-muted)]'
                            }`}
                          >
                            {sIndex + 1}.{qIndex + 1} {truncateChars(question.title)}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <section
          className="lg:col-span-9"
          aria-labelledby={currentSection ? `section-${currentSection.id}` : undefined}
        >
          {currentSection ? (
            <>
              <h2
                id={`section-${currentSection.id}`}
                className="mb-6 text-sm font-medium uppercase tracking-wider text-[var(--color-muted)]"
              >
                {currentSection.title}
              </h2>
              {(currentSection.description || currentSection.linkUrl) && (
                <div className="mb-6 space-y-2 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white p-4 text-sm text-[var(--color-foreground)]">
                  {currentSection.description && (
                    <div
                      className="rich-text-content"
                      dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(currentSection.description) }}
                    />
                  )}
                  {currentSection.linkUrl && (
                    <a
                      href={currentSection.linkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex text-[var(--color-primary)] underline"
                    >
                      {(currentSection.linkText || currentSection.linkUrl).trim()}
                    </a>
                  )}
                </div>
              )}
              {missingRequired.length > 0 && (
                <div className="mb-6 rounded-[var(--radius-card)] border border-[var(--color-required)] bg-white p-4 text-sm text-[var(--color-foreground)]">
                  Bitte füllen Sie alle Pflichtfragen aus, bevor Sie fortfahren.
                </div>
              )}
              <div className="space-y-6">
                {currentSection.questions
                  .filter((question) =>
                    isQuestionVisible(question, answers, objectContext ?? undefined)
                  )
                  .map((question) => {
                  const visible = isQuestionVisible(
                    question,
                    answers,
                    objectContext ?? undefined
                  )
                  const reasonKey = `${question.id}__reason`
                  const objectMetaKey = `${question.id}__objectMeta`
                  const customOptionsKey = `${question.id}__customOptions`
                  const customOptions = Array.isArray(answers[customOptionsKey])
                    ? (answers[customOptionsKey] as string[])
                    : []
                  const reasonRequired = isReasonRequired(question, answers[question.id])
                  const reasonMissing = reasonRequired && !isAnswered(answers[reasonKey])
                  const isMissing = missingRequired.includes(question.id)
                  return (
                    <div
                      key={question.id}
                      ref={(el) => {
                        questionRefs.current[question.id] = el
                        if (el) el.dataset.questionId = question.id
                      }}
                      className={
                        isMissing || reasonMissing
                          ? 'rounded-[var(--radius-card)] ring-2 ring-[var(--color-required)]/50'
                          : ''
                      }
                    >
                      <QuestionField
                        question={question}
                        questionnaireId={questionnaire.id}
                        taskId={taskId}
                        value={answers[question.id]}
                        onChange={(value) => setAnswer(question.id, value)}
                        customOptions={customOptions}
                        onCustomOptionsChange={(value) => setAnswer(customOptionsKey, value)}
                        reasonValue={answers[reasonKey] as string | undefined}
                        onReasonChange={(value) => setAnswer(reasonKey, value)}
                        objectMetadataValue={answers[objectMetaKey] as string | undefined}
                        onObjectMetadataChange={(value) => setAnswer(objectMetaKey, value)}
                        assignmentOptionIssues={assignmentOptionIssues[question.id] ?? {}}
                        reasonMissing={reasonMissing}
                        isVisible={visible}
                      />
                      {reasonMissing && (
                        <div className="mt-2 text-xs text-[var(--color-required)]">
                          Bitte Begründung ausfüllen.
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <div className="mt-8 flex justify-between border-t border-[var(--color-border)] pt-6">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={goPrev}
                    disabled={isFirstSection}
                  >
                    Zurück
                  </Button>
                  <Button type="button" variant="outline" onClick={handleSaveAndExit}>
                    Speichern und beenden
                  </Button>
                  <Button type="button" variant="outline" onClick={handleCancel} disabled={cancelling}>
                    {cancelling ? 'Abbrechen...' : 'Abbrechen'}
                  </Button>
                </div>
                <div className="flex items-end gap-2">
                  <Button type="button" variant="outline" onClick={handleSave}>
                    Speichern
                  </Button>
                  {isLastSection ? (
                    <Button type="button" onClick={handleSubmit} disabled={saving}>
                      {saving ? 'Senden...' : 'Absenden'}
                    </Button>
                  ) : (
                    <Button type="button" onClick={goNext}>
                      Weiter
                    </Button>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white p-4 text-sm text-[var(--color-muted)]">
              Aktuell sind keine Sektionen sichtbar. Bitte pruefen Sie die Abhaengigkeiten.
            </div>
          )}
        </section>
      </div>

      <AlertDialog open={showMissingPopup} onOpenChange={setShowMissingPopup}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pflichtfragen fehlen</AlertDialogTitle>
            <AlertDialogDescription>
              Bitte füllen Sie alle Pflichtfragen aus, bevor Sie fortfahren.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>Verstanden</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

