
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link, useMatch } from 'react-router-dom'
import type {
  Questionnaire,
  QuestionnaireSection,
  Question,
  QuestionType,
  QuestionOption,
  QuestionDependency,
  AssignmentOption,
} from '../../types/questionnaire'
import { api, ApiError, type ObjectPickerFilterOptions } from '../../lib/api'
import { generateId } from '../../lib/ids'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Card, CardContent, CardHeader } from '../../components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTrigger,
} from '../../components/ui/dialog'
import { RichTextEditor } from '../../components/admin/RichTextEditor'
import { DependencyGraphDialog } from '../../components/admin/DependencyGraphDialog'
import { QuestionField } from '../../components/questionnaire/QuestionField'

const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
  { value: 'info', label: 'Hinweistext (ohne Antwort)' },
  { value: 'text', label: 'Kurzer Text' },
  { value: 'multiline', label: 'Mehrzeiliger Text' },
  { value: 'single', label: 'Einzelauswahl' },
  { value: 'multi', label: 'Mehrfachauswahl' },
  { value: 'boolean', label: 'Ja/Nein' },
  { value: 'date_time', label: 'Datum / Datum+Uhrzeit' },
  { value: 'percentage', label: 'Prozent' },
  { value: 'likert', label: 'Skala / Likert' },
  { value: 'ranking', label: 'Ranking' },
  { value: 'object_picker', label: 'Objekt-Picker' },
  { value: 'assignment_picker', label: 'Zuordnungs-Picker' },
]

const truncateText = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}...` : text

function emptySection(): QuestionnaireSection {
  return { id: generateId(), title: '', description: '', linkUrl: '', linkText: '', questions: [] }
}

function emptyQuestion(): Question {
  return {
    id: generateId(),
    type: 'text',
    title: '',
    required: false,
  }
}

const toInputDate = (value?: string | null) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 16)
}

const fromInputDate = (value: string) => (value ? new Date(value).toISOString() : null)

const mergedDeps = (item: { dependency?: QuestionDependency; dependencies?: QuestionDependency[] }) => (
  item.dependencies ?? (item.dependency ? [item.dependency] : [])
)

const OBJECT_TYPE_DEP_ID = '__object_type__'
const OBJECT_META_DEP_ID = '__object_meta__'

const buildDefaultDependency = (question?: Question): QuestionDependency => {
  if (!question) return { questionId: '', value: '' }
  if (question.type === 'boolean') {
    return { questionId: question.id, value: true }
  }
  if (question.type === 'single' && question.options?.[0]) {
    return { questionId: question.id, value: question.options[0].value }
  }
  if (question.type === 'multi' && question.options?.[0]) {
    return { questionId: question.id, value: [question.options[0].value] }
  }
  if (question.type === 'date_time') {
    return { questionId: question.id, value: '', operator: 'date_is_future', dayOffset: 0 }
  }
  if (question.type === 'percentage' || question.type === 'likert') {
    return { questionId: question.id, value: '0', operator: 'gte' }
  }
  if (question.type === 'ranking') {
    return {
      questionId: question.id,
      value: question.rankingOptions?.[0]?.id ?? '',
      operator: 'ranking_contains',
      positionValue: 1,
    }
  }
  if (question.type === 'object_picker') {
    return { questionId: question.id, value: '', operator: 'eq' }
  }
  return { questionId: question.id, value: '' }
}

const buildObjectTypeDependency = (): QuestionDependency => ({
  questionId: OBJECT_TYPE_DEP_ID,
  operator: 'object_type_eq',
  value: '',
})

const buildObjectMetaDependency = (): QuestionDependency => ({
  questionId: OBJECT_META_DEP_ID,
  operator: 'object_meta_eq',
  objectMetaKey: '',
  value: '',
})

const isQuestionConfiguredRequired = (question: Question) =>
  question.type === 'assignment_picker'
    ? (question.assignmentOptions ?? []).some((opt) => !!opt.required)
    : !!question.required

export function QuestionnaireEditPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const matchNew = useMatch('/admin/questionnaires/new')
  const isNew = matchNew !== null
  const [q, setQ] = useState<Questionnaire | null>(null)
  const [saving, setSaving] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showValidationErrors, setShowValidationErrors] = useState(false)
  const [editorLock, setEditorLock] = useState<{
    userId: string
    userEmail?: string | null
    lockedAt: string
    expiresAt: string
    ttlSeconds: number
  } | null>(null)
  const [enabledQuestionTypes, setEnabledQuestionTypes] = useState<Record<string, boolean>>({})
  const [editorTab, setEditorTab] = useState<'catalog' | 'postsubmit' | 'homeTile'>('catalog')
  const [objectPickerFilterOptions, setObjectPickerFilterOptions] = useState<ObjectPickerFilterOptions>({
    types: [],
    metadataKeys: [],
    objectGroups: [],
  })
  const [sectionSortOpen, setSectionSortOpen] = useState(false)
  const [dragSectionId, setDragSectionId] = useState<string | null>(null)
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<string[]>([])
  const [pendingOverviewTarget, setPendingOverviewTarget] = useState<{ type: 'section' | 'question'; id: string } | null>(null)

  useEffect(() => {
    api
      .listQuestionTypeCatalog()
      .then((list) => {
        const map: Record<string, boolean> = {}
        list.forEach((entry) => {
          map[entry.key] = entry.enabled
        })
        setEnabledQuestionTypes(map)
      })
      .catch(() => {})
    api
      .getObjectPickerFilterOptions()
      .then((options) => setObjectPickerFilterOptions(options))
      .catch(() => {})
  }, [])

  const releaseEditorLock = useCallback(async () => {
    if (isNew || !id) return
    try {
      await api.releaseQuestionnaireEditorLock(id)
    } catch {
      // best effort
    }
  }, [id, isNew])

  useEffect(() => {
    if (isNew) {
      setQ({
        id: generateId(),
        title: '',
        subtitle: '',
        sections: [emptySection()],
        status: 'DRAFT',
        allowMultipleSubmissions: false,
        globalForAllUsers: false,
        allowReadonlyResultLinkForAllUsers: false,
        adminAccessMode: 'OWNER_AND_GROUP',
        activeFrom: null,
        activeTo: null,
      })
      setEditorLock(null)
      setHasLoaded(true)
    } else if (id) {
      let active = true
      api
        .acquireQuestionnaireEditorLock(id)
        .then((lock) => {
          if (!active) return
          setEditorLock(lock)
          return api.getQuestionnaire(id)
        })
        .then((loaded) => {
          if (!active || !loaded) return
          setQ(loaded ?? null)
          setError(null)
        })
        .catch((e) => {
          if (!active) return
          if (e instanceof ApiError && e.status === 409 && e.message === 'QUESTIONNAIRE_LOCKED') {
            const data = (e.data ?? {}) as {
              lockedByEmail?: string | null
              lockedByUserId?: string | null
              expiresAt?: string | null
            }
            const by = data.lockedByEmail ?? data.lockedByUserId ?? 'anderen Bearbeiter'
            const until = data.expiresAt
              ? ` bis ${new Date(data.expiresAt).toLocaleTimeString('de-DE')}`
              : ''
            setError(`Fragebogen ist aktuell gesperrt durch ${by}${until}.`)
            setQ(null)
            return
          }
          setError('Fragebogen konnte nicht geladen werden.')
          setQ(null)
        })
        .finally(() => {
          if (active) setHasLoaded(true)
        })
      return () => {
        active = false
      }
    } else {
      setHasLoaded(true)
    }
  }, [id, isNew])

  useEffect(() => {
    if (isNew || !id || !editorLock) return
    const refreshMs = Math.max(20_000, Math.min(90_000, Math.floor((editorLock.ttlSeconds * 1000) / 2)))
    const interval = window.setInterval(async () => {
      try {
        const lock = await api.acquireQuestionnaireEditorLock(id)
        setEditorLock(lock)
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          setError('Bearbeitungssperre wurde verloren. Bitte erneut aus der Liste oeffnen.')
          setQ(null)
        }
      }
    }, refreshMs)
    return () => window.clearInterval(interval)
  }, [id, isNew, editorLock])

  useEffect(() => {
    if (isNew || !id) return
    const onPageHide = () => {
      try {
        void fetch(`/api/questionnaires/${id}/editor-lock/release`, {
          method: 'POST',
          credentials: 'include',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
        })
      } catch {
        // best effort
      }
    }
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      void releaseEditorLock()
    }
  }, [id, isNew, releaseEditorLock])

  const update = (patch: Partial<Questionnaire>) => {
    setQ((prev) => (prev ? { ...prev, ...patch } : null))
  }

  const updateSection = (sectionIndex: number, patch: Partial<QuestionnaireSection>) => {
    if (!q) return
    const sections = [...q.sections]
    sections[sectionIndex] = { ...sections[sectionIndex], ...patch }
    setQ({ ...q, sections })
  }

  const updateQuestion = (sectionIndex: number, questionIndex: number, patch: Partial<Question>) => {
    if (!q) return
    const sections = [...q.sections]
    const questions = [...sections[sectionIndex].questions]
    questions[questionIndex] = { ...questions[questionIndex], ...patch }
    sections[sectionIndex] = { ...sections[sectionIndex], questions }
    setQ({ ...q, sections })
  }

  const addSection = () => {
    if (!q) return
    const nextSection = emptySection()
    setQ({ ...q, sections: [...q.sections, nextSection] })
    setPendingOverviewTarget({ type: 'section', id: nextSection.id })
  }

  const removeSection = (sectionIndex: number) => {
    if (!q || q.sections.length <= 1) return
    const sections = q.sections.filter((_, i) => i !== sectionIndex)
    setQ({ ...q, sections })
  }

  const addQuestion = (sectionIndex: number) => {
    if (!q) return
    const sections = [...q.sections]
    const section = sections[sectionIndex]
    const nextQuestion = emptyQuestion()
    sections[sectionIndex] = {
      ...section,
      questions: [...section.questions, nextQuestion],
    }
    setQ({ ...q, sections })
    setPendingOverviewTarget({ type: 'question', id: nextQuestion.id })
  }

  const removeQuestion = (sectionIndex: number, questionIndex: number) => {
    if (!q) return
    const sections = [...q.sections]
    const questions = sections[sectionIndex].questions.filter((_, i) => i !== questionIndex)
    sections[sectionIndex] = { ...sections[sectionIndex], questions }
    setQ({ ...q, sections })
  }

  const cloneQuestion = (sectionIndex: number, questionIndex: number) => {
    if (!q) return
    const sections = [...q.sections]
    const questions = [...sections[sectionIndex].questions]
    const source = questions[questionIndex]
    if (!source) return
    const clone: Question = {
      ...source,
      id: generateId(),
      title: source.title ? `${source.title} (Kopie)` : 'Kopie',
      options: source.options ? source.options.map((opt) => ({ ...opt })) : source.options,
      assignmentOptions: source.assignmentOptions
        ? source.assignmentOptions.map((opt) => ({
            ...opt,
            objectTypeFilter: opt.objectTypeFilter ? [...opt.objectTypeFilter] : undefined,
            objectGroupIds: opt.objectGroupIds ? [...opt.objectGroupIds] : undefined,
          }))
        : source.assignmentOptions,
      dependencies: source.dependencies ? source.dependencies.map((dep) => ({ ...dep })) : source.dependencies,
    }
    questions.splice(questionIndex + 1, 0, clone)
    sections[sectionIndex] = { ...sections[sectionIndex], questions }
    setQ({ ...q, sections })
    setPendingOverviewTarget({ type: 'question', id: clone.id })
  }

  const moveSectionById = (fromSectionId: string, toSectionId: string) => {
    if (!q || fromSectionId === toSectionId) return
    const sections = [...q.sections]
    const fromIndex = sections.findIndex((section) => section.id === fromSectionId)
    const toIndex = sections.findIndex((section) => section.id === toSectionId)
    if (fromIndex < 0 || toIndex < 0) return
    const [moved] = sections.splice(fromIndex, 1)
    sections.splice(toIndex, 0, moved)
    setQ({ ...q, sections })
  }

  const toggleSectionCollapsed = (sectionId: string) => {
    setCollapsedSectionIds((prev) =>
      prev.includes(sectionId) ? prev.filter((id) => id !== sectionId) : [...prev, sectionId]
    )
  }

  const collapseAllSections = () => {
    if (!q) return
    setCollapsedSectionIds(q.sections.map((section) => section.id))
  }

  const expandAllSections = () => {
    setCollapsedSectionIds([])
  }

  const moveQuestion = (sectionIndex: number, questionIndex: number, dir: 'up' | 'down') => {
    if (!q) return
    const questions = [...q.sections[sectionIndex].questions]
    const i = dir === 'up' ? questionIndex - 1 : questionIndex + 1
    if (i < 0 || i >= questions.length) return
    ;[questions[questionIndex], questions[i]] = [questions[i], questions[questionIndex]]
    const sections = [...q.sections]
    sections[sectionIndex] = { ...sections[sectionIndex], questions }
    setQ({ ...q, sections })
  }

  const moveQuestionToSection = (
    fromSectionIndex: number,
    questionIndex: number,
    toSectionIndex: number
  ) => {
    if (!q || fromSectionIndex === toSectionIndex) return
    const sections = [...q.sections]
    const fromQuestions = [...sections[fromSectionIndex].questions]
    const [moved] = fromQuestions.splice(questionIndex, 1)
    if (!moved) return
    const toQuestions = [...sections[toSectionIndex].questions, moved]
    sections[fromSectionIndex] = { ...sections[fromSectionIndex], questions: fromQuestions }
    sections[toSectionIndex] = { ...sections[toSectionIndex], questions: toQuestions }
    setQ({ ...q, sections })
  }

  const save = async () => {
    if (!q || !q.title.trim()) return
    if (validationIssues.length > 0) {
      setShowValidationErrors(true)
      const first = validationIssues[0]
      if (first?.questionId) {
        scrollToQuestion(first.questionId)
      } else {
        scrollToSection(first.sectionId)
      }
      return
    }
    const sectionQuestionIdSets = q.sections.map((section) => new Set(section.questions.map((question) => question.id)))
    const sanitizedSections = q.sections.map((section, sectionIndex) => {
      const ownQuestionIds = sectionQuestionIdSets[sectionIndex]
      const deps = mergedDeps(section).filter((dep) => !ownQuestionIds.has(dep.questionId))
      return { ...section, dependencies: deps, dependency: undefined }
    })
    const sanitizedQuestionnaire: Questionnaire = { ...q, sections: sanitizedSections }
    setSaving(true)
    try {
      if (isNew) {
        await api.createQuestionnaire(sanitizedQuestionnaire)
      } else {
        if (id) {
          // Refresh lock directly before save to avoid TTL race conditions.
          const lock = await api.acquireQuestionnaireEditorLock(id)
          setEditorLock(lock)
        }
        await api.updateQuestionnaire(q.id, sanitizedQuestionnaire)
        await releaseEditorLock()
      }
      navigate('/admin/questionnaires')
    } catch (error) {
      let message = error instanceof Error ? error.message : 'Speichern fehlgeschlagen.'
      if (error instanceof ApiError && error.status === 409 && error.message === 'QUESTIONNAIRE_LOCK_NOT_HELD') {
        message = 'Speichern nicht moeglich: Bearbeitungssperre ist nicht mehr gueltig.'
      }
      window.alert(message)
    } finally {
      setSaving(false)
    }
  }

  const handleCancelEdit = async () => {
    await releaseEditorLock()
    navigate('/admin/questionnaires')
  }

  const questionRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const overviewSectionRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const overviewQuestionRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const validationIssues = useMemo(() => {
    if (!q) return [] as Array<{ key: string; label: string; sectionId: string; questionId?: string }>
    const issues: Array<{ key: string; label: string; sectionId: string; questionId?: string }> = []
    q.sections.forEach((section, sectionIndex) => {
      if (!section.title.trim()) {
        issues.push({
          key: `section-${section.id}`,
          label: `Sektion ${sectionIndex + 1}: Sektionstitel fehlt`,
          sectionId: section.id,
        })
      }
      section.questions.forEach((question, questionIndex) => {
        if (!question.title.trim()) {
          issues.push({
            key: `question-${question.id}`,
            label: `Sektion ${sectionIndex + 1}, Frage ${questionIndex + 1}: Fragentitel fehlt`,
            sectionId: section.id,
            questionId: question.id,
          })
        }
      })
    })
    return issues
  }, [q])
  const invalidSectionIds = useMemo(
    () =>
      new Set(
        validationIssues
          .filter((issue) => !issue.questionId)
          .map((issue) => issue.sectionId)
      ),
    [validationIssues]
  )
  const invalidQuestionIds = useMemo(
    () =>
      new Set(
        validationIssues
          .filter((issue) => !!issue.questionId)
          .map((issue) => issue.questionId as string)
      ),
    [validationIssues]
  )
  const truncate = (text: string, max = 100) => truncateText(text, max)
  const scrollToQuestion = (qid: string) => {
    if (!q) return
    const sectionId = q.sections.find((section) => section.questions.some((question) => question.id === qid))?.id
    if (sectionId) {
      setCollapsedSectionIds((prev) => prev.filter((id) => id !== sectionId))
    }
    const node = questionRefs.current[qid]
    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const scrollToSection = (sid: string) => {
    setCollapsedSectionIds((prev) => prev.filter((id) => id !== sid))
    const node = sectionRefs.current[sid]
    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  useEffect(() => {
    if (!q) return
    setCollapsedSectionIds((prev) => prev.filter((id) => q.sections.some((section) => section.id === id)))
  }, [q])

  useEffect(() => {
    if (!pendingOverviewTarget) return
    const node =
      pendingOverviewTarget.type === 'section'
        ? overviewSectionRefs.current[pendingOverviewTarget.id]
        : overviewQuestionRefs.current[pendingOverviewTarget.id]
    if (!node) return
    node.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    setPendingOverviewTarget(null)
  }, [pendingOverviewTarget, q])

  if (!hasLoaded) return <div className="text-[var(--color-muted)]">Laden...</div>
  if (error) {
    return (
      <div className="space-y-4">
        <div className="text-[var(--color-muted)]">{error}</div>
        <Button variant="outline" asChild>
          <Link to="/admin/questionnaires">Zur Liste</Link>
        </Button>
      </div>
    )
  }
  if (!isNew && id && !q) {
    return (
      <div className="space-y-4">
        <p className="text-[var(--color-muted)]">Fragebogen nicht gefunden.</p>
        <Button variant="outline" asChild>
          <Link to="/admin/questionnaires">Zur Liste</Link>
        </Button>
      </div>
    )
  }
  if (!q) return null
  const allQuestions = q.sections.flatMap((s) => s.questions)
  const availableQuestionTypes = QUESTION_TYPES.filter((entry) =>
    isNew ? enabledQuestionTypes[entry.value] !== false : true
  )

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">
          {isNew ? 'Neuer Fragebogen' : `Fragebogen bearbeiten (Version ${q.version ?? 1})`}
        </h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void handleCancelEdit()}>
            Abbrechen
          </Button>
          <Button onClick={save} disabled={saving || !q.title.trim()}>
            Speichern
          </Button>
        </div>
      </div>
      {!isNew && editorLock?.userId && (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white px-3 py-2 text-xs text-[var(--color-muted)]">
          Gesperrt durch Bearbeiter {editorLock.userEmail ?? editorLock.userId}
          {editorLock.expiresAt
            ? ` (automatische Verlaengerung aktiv, aktuell bis ${new Date(editorLock.expiresAt).toLocaleTimeString('de-DE')})`
            : ''}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-2">
          <Button
            type="button"
            variant={editorTab === 'catalog' ? 'default' : 'outline'}
            onClick={() => setEditorTab('catalog')}
          >
            Fragenkatalog
          </Button>
          <Button
            type="button"
            variant={editorTab === 'postsubmit' ? 'default' : 'outline'}
            onClick={() => setEditorTab('postsubmit')}
          >
            Nach Absenden
          </Button>
          <Button
            type="button"
            variant={editorTab === 'homeTile' ? 'default' : 'outline'}
            onClick={() => setEditorTab('homeTile')}
          >
            Startseiten-Kachel
          </Button>
        </div>
        {editorTab === 'catalog' && <DependencyGraphDialog questionnaire={q} />}
      </div>
      {editorTab === 'catalog' && (
        <>
      {showValidationErrors && validationIssues.length > 0 && (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-required)] bg-white p-4">
          <div className="text-sm font-medium text-[var(--color-required)]">
            Speichern nicht moeglich. Bitte die Pflichtfelder ausfuellen:
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {validationIssues.map((issue) => (
              <li key={issue.key}>
                <button
                  type="button"
                  className="text-left text-[var(--color-required)] underline"
                  onClick={() =>
                    issue.questionId ? scrollToQuestion(issue.questionId) : scrollToSection(issue.sectionId)
                  }
                >
                  {issue.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Card>
        <CardHeader>
          <h3 className="font-medium">Grunddaten</h3>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Titel</Label>
            <Input
              id="title"
              value={q.title}
              onChange={(e) => update({ title: e.target.value })}
              placeholder="z. B. Compliance-Grundlagen"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="subtitle">Untertitel (optional)</Label>
            <Input
              id="subtitle"
              value={q.subtitle ?? ''}
              onChange={(e) => update({ subtitle: e.target.value || undefined })}
              placeholder="z. B. Schritt fuer Schritt"
            />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={q.status ?? 'DRAFT'}
                onValueChange={(v) => update({ status: v as Questionnaire['status'] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DRAFT">Entwurf</SelectItem>
                  <SelectItem value="PUBLISHED">Veroeffentlicht</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Mehrfachdurchfuehrung</Label>
              <Select
                value={q.allowMultipleSubmissions ? 'yes' : 'no'}
                onValueChange={(v) => update({ allowMultipleSubmissions: v === 'yes' })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="no">Nein, nur einmal pro Benutzer</SelectItem>
                  <SelectItem value="yes">Ja, mehrfach pro Benutzer erlaubt</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Verfuegbarkeit</Label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!q.globalForAllUsers}
                  onChange={(e) => update({ globalForAllUsers: e.target.checked })}
                  className="h-4 w-4 rounded border-[var(--color-border)]"
                />
                Fuer alle angemeldeten Benutzer ohne Zuordnung sichtbar
              </label>
            </div>
            <div className="space-y-2">
              <Label>Readonly-Ergebnisse</Label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!q.allowReadonlyResultLinkForAllUsers}
                  onChange={(e) =>
                    update({ allowReadonlyResultLinkForAllUsers: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-[var(--color-border)]"
                />
                Ergebnisse per Link fuer alle angemeldeten Benutzer freigeben
              </label>
            </div>
            <div className="space-y-2">
              <Label>Admin-Bearbeitung</Label>
              <Select
                value={q.adminAccessMode ?? 'OWNER_AND_GROUP'}
                onValueChange={(v) => update({ adminAccessMode: v as Questionnaire['adminAccessMode'] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OWNER_ONLY">Nur Ersteller</SelectItem>
                  <SelectItem value="OWNER_AND_GROUP">Ersteller und gleiche Benutzergruppe</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Aktiv ab (optional)</Label>
              <Input
                type="datetime-local"
                value={toInputDate(q.activeFrom)}
                onChange={(e) => update({ activeFrom: fromInputDate(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label>Aktiv bis (optional)</Label>
              <Input
                type="datetime-local"
                value={toInputDate(q.activeTo)}
                onChange={(e) => update({ activeTo: fromInputDate(e.target.value) })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[340px_1fr] lg:pr-6">
        <aside
          className="h-fit rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white p-4 text-sm lg:sticky lg:-ml-6"
          style={{ top: 'var(--layout-sticky-offset, 120px)' }}
        >
          <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]">
            Uebersicht
          </div>
          <div
            className="mt-4 space-y-4 overflow-auto pr-1"
            style={{ maxHeight: 'calc(100vh - var(--layout-sticky-offset, 120px) - 16px)' }}
          >
            {q.sections.map((section, sectionIndex) => (
              <div
                key={section.id}
                className="space-y-2"
                ref={(el) => {
                  overviewSectionRefs.current[section.id] = el
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[var(--color-primary)]" />
                  <span className="font-medium text-[var(--color-foreground)]">
                    {sectionIndex + 1}. {section.title || `Sektion ${sectionIndex + 1}`}
                  </span>
                  {mergedDeps(section).length > 0 && (
                    <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-muted)]">
                      abhaengig
                    </span>
                  )}
                </div>
                <div className="ml-3 space-y-2 border-l border-[var(--color-border)] pl-3">
                  {section.questions.map((question, qIndex) => (
                    <div
                      key={question.id}
                      className="relative"
                      ref={(el) => {
                        overviewQuestionRefs.current[question.id] = el
                      }}
                    >
                      <span
                        className={`absolute -left-3 top-2 h-2 w-2 rounded-full ${
                          isQuestionConfiguredRequired(question) ? 'bg-[var(--color-required)]' : 'bg-amber-400'
                        }`}
                      />
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => scrollToQuestion(question.id)}
                          className="text-left text-[var(--color-foreground)] hover:underline"
                          title={question.title || question.id}
                        >
                          {truncate(`${sectionIndex + 1}.${qIndex + 1} ${question.title || question.id}`, 100)}
                        </button>
                        <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-muted)]">
                          {isQuestionConfiguredRequired(question) ? 'pflicht' : 'optional'}
                        </span>
                        {(question.dependencies?.length || question.dependency) && (
                          <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-muted)]">
                            abhaengig
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-[var(--color-border)] pt-3">
            <DependencyGraphDialog questionnaire={q} />
          </div>
        </aside>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Sektionen & Fragen</h3>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={collapseAllSections}>
                Alle einklappen
              </Button>
              <Button variant="outline" size="sm" onClick={expandAllSections}>
                Alle ausklappen
              </Button>
              <Button variant="outline" size="sm" onClick={addSection}>
                Sektion hinzufuegen
              </Button>
            </div>
          </div>

          {q.sections.map((section, sectionIndex) => (
            <Card
              key={section.id}
              ref={(el) => {
                sectionRefs.current[section.id] = el
              }}
            >
              {(() => {
                const isCollapsed = collapsedSectionIds.includes(section.id)
                return (
                  <>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div className="max-w-xs">
                  <Input
                    value={section.title}
                    onChange={(e) => updateSection(sectionIndex, { title: e.target.value })}
                    placeholder="Sektionstitel"
                    className={`font-medium ${
                      showValidationErrors && invalidSectionIds.has(section.id)
                        ? 'border-[var(--color-required)] ring-1 ring-[var(--color-required)]/30'
                        : ''
                    }`}
                  />
                  {showValidationErrors && invalidSectionIds.has(section.id) && (
                    <p className="mt-1 text-xs text-[var(--color-required)]">Sektionstitel fehlt.</p>
                  )}
                  {isCollapsed && (
                    <p className="mt-1 text-xs text-[var(--color-muted)]">
                      {section.questions.length} Frage(n) eingeklappt
                    </p>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleSectionCollapsed(section.id)}
                  >
                    {isCollapsed ? 'Ausklappen' : 'Einklappen'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setSectionSortOpen(true)}
                  >
                    Sektionen verschieben
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => removeSection(sectionIndex)}
                    disabled={q.sections.length <= 1}
                  >
                    Sektion loeschen
                  </Button>
                </div>
              </CardHeader>
              {!isCollapsed && (
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Beschreibung (WYSIWYG, optional)</Label>
                  <RichTextEditor
                    value={section.description ?? ''}
                    onChange={(html) => updateSection(sectionIndex, { description: html ?? '' })}
                  />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Link URL (optional)</Label>
                    <Input
                      value={section.linkUrl ?? ''}
                      onChange={(e) => updateSection(sectionIndex, { linkUrl: e.target.value })}
                      placeholder="https://..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Linktext (optional)</Label>
                    <Input
                      value={section.linkText ?? ''}
                      onChange={(e) => updateSection(sectionIndex, { linkText: e.target.value })}
                      placeholder="Weiterfuehrende Informationen"
                    />
                  </div>
                </div>
                <SectionDependencyEditor
                  section={section}
                  dependencyCandidates={q.sections.flatMap((s, idx) =>
                    idx === sectionIndex ? [] : s.questions
                  )}
                  objectPickerFilterOptions={objectPickerFilterOptions}
                  onUpdate={(patch) => updateSection(sectionIndex, patch)}
                />
                <div className="flex justify-end">
                  <Button variant="secondary" size="sm" onClick={() => addQuestion(sectionIndex)}>
                    Frage hinzufuegen
                  </Button>
                </div>
                {section.questions.map((question, questionIndex) => (
                  <div
                    key={question.id}
                    ref={(el) => {
                      questionRefs.current[question.id] = el
                    }}
                  >
                    <div className="mb-2 text-xs text-[var(--color-muted)]">
                      Frage {sectionIndex + 1}.{questionIndex + 1}
                    </div>
                    <QuestionEditor
                      question={question}
                      sectionIndex={sectionIndex}
                      questionIndex={questionIndex}
                      availableQuestionTypes={availableQuestionTypes}
                      objectPickerFilterOptions={objectPickerFilterOptions}
                      sections={q.sections}
                      allQuestions={allQuestions}
                      currentQuestionId={question.id}
                      onUpdate={(patch) => updateQuestion(sectionIndex, questionIndex, patch)}
                      onRemove={() => removeQuestion(sectionIndex, questionIndex)}
                      onClone={() => cloneQuestion(sectionIndex, questionIndex)}
                      onMoveUp={() => moveQuestion(sectionIndex, questionIndex, 'up')}
                      onMoveDown={() => moveQuestion(sectionIndex, questionIndex, 'down')}
                      onMoveSection={(toSectionIndex) =>
                        moveQuestionToSection(sectionIndex, questionIndex, toSectionIndex)
                      }
                      canMoveUp={questionIndex > 0}
                      canMoveDown={questionIndex < section.questions.length - 1}
                      titleMissing={showValidationErrors && invalidQuestionIds.has(question.id)}
                    />
                  </div>
                ))}
                <div className="flex justify-end border-t border-[var(--color-border)] pt-3">
                  <Button variant="secondary" size="sm" onClick={() => addQuestion(sectionIndex)}>
                    Frage hinzufuegen
                  </Button>
                </div>
              </CardContent>
              )}
                  </>
                )
              })()}
            </Card>
          ))}
          <Card>
            <CardContent className="flex flex-wrap items-center justify-end gap-2 pt-6">
              <Button
                variant="secondary"
                onClick={() => addQuestion(Math.max(0, q.sections.length - 1))}
                disabled={q.sections.length === 0}
              >
                Frage hinzufuegen (letzte Sektion)
              </Button>
              <Button variant="outline" onClick={addSection}>
                Sektion hinzufuegen
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
        </>
      )}
      {editorTab === 'postsubmit' && (
        <Card>
          <CardHeader>
            <h3 className="font-medium">Seite nach Absenden</h3>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="completion-title">Ueberschrift</Label>
              <Input
                id="completion-title"
                value={q.completionPageTitle ?? ''}
                onChange={(e) => update({ completionPageTitle: e.target.value || undefined })}
                placeholder="Vielen Dank fuer Ihre Teilnahme"
              />
            </div>
            <div className="space-y-2">
              <Label>Text (WYSIWYG)</Label>
              <p className="text-xs text-[var(--color-muted)]">
                Platzhalter: {'{{jiraTicketLink}}'} (klickbarer Link), {'{{jiraTicketKey}}'} (Ticket-Key).
                Wird nur gesetzt, wenn beim Absenden ein Jira Ticket angelegt wurde.
              </p>
              <RichTextEditor
                value={q.completionPageContent ?? ''}
                onChange={(html) => update({ completionPageContent: html || undefined })}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-foreground)]">
                <input
                  type="checkbox"
                  checked={!!q.showJiraTicketLinkInHistory}
                  onChange={(e) => update({ showJiraTicketLinkInHistory: e.target.checked })}
                />
                Jira-Link in Historie anzeigen
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--color-foreground)]">
                <input
                  type="checkbox"
                  checked={!!q.showReadonlyResultLinkInHistory}
                  onChange={(e) => update({ showReadonlyResultLinkInHistory: e.target.checked })}
                />
                Link zur Originaldesign-Ansicht anzeigen
              </label>
            </div>
          </CardContent>
        </Card>
      )}
      {editorTab === 'homeTile' && (
        <Card>
          <CardHeader>
            <h3 className="font-medium">Darstellung in Startseiten-Kachel</h3>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Kacheltext (WYSIWYG)</Label>
              <RichTextEditor
                value={q.homeTileDescriptionHtml ?? ''}
                onChange={(html) => update({ homeTileDescriptionHtml: html || undefined })}
              />
            </div>
            <div className="space-y-2">
              <Label>Farbe der Kachel</Label>
              <div className="flex items-center gap-3">
                <Input
                  type="color"
                  value={
                    typeof q.homeTileColor === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(q.homeTileColor)
                      ? q.homeTileColor
                      : '#3b82f6'
                  }
                  onChange={(e) => update({ homeTileColor: e.target.value })}
                  className="h-10 w-20 p-1"
                />
                <Input
                  value={q.homeTileColor ?? ''}
                  onChange={(e) => update({ homeTileColor: e.target.value || undefined })}
                  placeholder="#3b82f6"
                />
                <Button type="button" variant="outline" onClick={() => update({ homeTileColor: 'default' })}>
                  Standard
                </Button>
              </div>
              <div className="text-xs text-[var(--color-muted)]">
                Vorschau-Farbe: <span className="font-mono">{q.homeTileColor || 'default'}</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Angezeigte Attribute</Label>
              <div className="grid gap-2 md:grid-cols-2">
                {[
                  ['object', 'Objektbezug'],
                  ['objectGroup', 'Objektgruppe'],
                  ['dueDate', 'Faelligkeit'],
                  ['status', 'Status'],
                  ['version', 'Version'],
                  ['completedAt', 'Erledigt am'],
                  ['completedBy', 'Erledigt von'],
                  ['globalTag', 'Global-Kennzeichen'],
                ].map(([key, label]) => {
                  const attrs = q.homeTileAttributes ?? []
                  const checked = attrs.includes(key as any)
                  return (
                    <label key={key} className="flex items-center gap-2 text-sm text-[var(--color-foreground)]">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? Array.from(new Set([...attrs, key as any]))
                            : attrs.filter((entry) => entry !== key)
                          update({ homeTileAttributes: next as Questionnaire['homeTileAttributes'] })
                        }}
                      />
                      {label}
                    </label>
                  )
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      <Dialog open={sectionSortOpen} onOpenChange={setSectionSortOpen}>
        <DialogContent className="max-w-xl">
          <div className="space-y-3">
            <h3 className="text-base font-medium">Sektionen per Drag & Drop sortieren</h3>
            <p className="text-xs text-[var(--color-muted)]">
              Sektion greifen und an die gewuenschte Position ziehen.
            </p>
            <div className="space-y-2 rounded border border-[var(--color-border)] bg-[var(--color-muted-bg)] p-2">
              {q.sections.map((section, index) => (
                <div
                  key={section.id}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData('text/plain', section.id)
                    event.dataTransfer.effectAllowed = 'move'
                    setDragSectionId(section.id)
                  }}
                  onDragOver={(event) => {
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    const sourceId = event.dataTransfer.getData('text/plain') || dragSectionId
                    if (!sourceId) return
                    moveSectionById(sourceId, section.id)
                    setDragSectionId(null)
                  }}
                  onDragEnd={() => setDragSectionId(null)}
                  className={`flex cursor-move items-center justify-between rounded border bg-white px-3 py-2 text-sm ${
                    dragSectionId === section.id
                      ? 'border-[var(--color-primary)] opacity-70'
                      : 'border-[var(--color-border)]'
                  }`}
                >
                  <span className="text-[var(--color-muted)]">#{index + 1}</span>
                  <span className="flex-1 px-3 text-left text-[var(--color-foreground)]">
                    {section.title || `Sektion ${index + 1}`}
                  </span>
                  <span className="text-xs text-[var(--color-muted)]">Drag</span>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setSectionSortOpen(false)}>
              Schliessen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] pt-4">
        <Button
          variant="outline"
          onClick={() => void handleCancelEdit()}
          disabled={saving}
        >
          Abbrechen
        </Button>
        <Button onClick={save} disabled={saving || !q.title.trim()}>
          {saving ? 'Speichern...' : 'Speichern'}
        </Button>
      </div>
    </div>
  )
}

interface SectionDependencyEditorProps {
  section: QuestionnaireSection
  dependencyCandidates: Question[]
  objectPickerFilterOptions: ObjectPickerFilterOptions
  onUpdate: (patch: Partial<QuestionnaireSection>) => void
}

function ObjectMetaDependencyFields({
  dep,
  metadataKeys,
  onPatch,
}: {
  dep: QuestionDependency
  metadataKeys: string[]
  onPatch: (patch: Partial<QuestionDependency>) => void
}) {
  const [valueOptions, setValueOptions] = useState<string[]>([])
  const [loadingValues, setLoadingValues] = useState(false)
  const NONE_VALUE = '__none__'
  const EMPTY_STRING_VALUE = '__empty_string__'
  const selectedKey = dep.objectMetaKey ?? ''
  const selectedValue = typeof dep.value === 'string' ? dep.value : ''
  const keySelectValue = selectedKey || NONE_VALUE
  const valueSelectValue = selectedValue === '' ? NONE_VALUE : selectedValue

  useEffect(() => {
    let active = true
    if (!selectedKey) {
      setValueOptions([])
      return () => {
        active = false
      }
    }
    setLoadingValues(true)
    api
      .getObjectPickerFilterOptions(selectedKey)
      .then((options) => {
        if (!active) return
        setValueOptions(options.metadataValues ?? [])
      })
      .catch(() => {
        if (!active) return
        setValueOptions([])
      })
      .finally(() => {
        if (!active) return
        setLoadingValues(false)
      })
    return () => {
      active = false
    }
  }, [selectedKey])

  return (
    <div className="w-full rounded-[var(--radius-button)] border border-[var(--color-border)] bg-white p-3 space-y-2">
      <Label className="text-xs">Meta-JSON Bedingung</Label>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Meta-Key</Label>
          <Select
            value={keySelectValue}
            onValueChange={(value) => {
              const nextKey = value === NONE_VALUE ? '' : value
              onPatch({ operator: 'object_meta_eq', objectMetaKey: nextKey, value: '' })
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Bitte Meta-Key waehlen" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>Bitte Meta-Key waehlen</SelectItem>
              {metadataKeys.map((key) => (
                <SelectItem key={key} value={key}>
                  {key}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Meta-Wert (Distinct)</Label>
          <Select
            value={valueSelectValue}
            onValueChange={(value) => {
              onPatch({
                operator: 'object_meta_eq',
                value:
                  value === NONE_VALUE
                    ? ''
                    : value === EMPTY_STRING_VALUE
                      ? ''
                      : value,
              })
            }}
            disabled={!selectedKey || loadingValues}
          >
            <SelectTrigger className="w-full">
              <SelectValue
                placeholder={
                  !selectedKey
                    ? 'Bitte zuerst Meta-Key waehlen'
                    : loadingValues
                      ? 'Werte werden geladen...'
                      : 'Bitte Meta-Wert waehlen'
                }
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>Bitte Meta-Wert waehlen</SelectItem>
              {valueOptions.map((value) => (
                <SelectItem
                  key={value === '' ? EMPTY_STRING_VALUE : value}
                  value={value === '' ? EMPTY_STRING_VALUE : value}
                >
                  {value === '' ? '(leer)' : value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}

function SectionDependencyEditor({
  section,
  dependencyCandidates,
  objectPickerFilterOptions,
  onUpdate,
}: SectionDependencyEditorProps) {
  const [depsOpen, setDepsOpen] = useState(false)
  const deps = mergedDeps(section)
  const mode = section.dependencyMode === 'ANY' ? 'ANY' : 'ALL'

  const setDependencies = (next: QuestionDependency[]) => {
    onUpdate({ dependencies: next, dependency: undefined })
  }

  const updateDependency = (index: number, patch: Partial<QuestionDependency>) => {
    const next = [...deps]
    next[index] = { ...next[index], ...patch }
    setDependencies(next)
  }

  const addDependency = () => {
    if (dependencyCandidates.length === 0) {
      setDependencies([...deps, buildObjectTypeDependency()])
      return
    }
    const first = dependencyCandidates[0]
    setDependencies([...deps, buildDefaultDependency(first)])
  }

  const removeDependency = (index: number) => {
    setDependencies(deps.filter((_, i) => i !== index))
  }

  const findQuestion = (id: string) => dependencyCandidates.find((q) => q.id === id)

  return (
    <div className="space-y-2 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white p-3">
      <div className="flex items-center gap-2">
        <Label>Sektions-Abhaengigkeiten (optional)</Label>
        <span className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px] uppercase text-[var(--color-muted)]">
          {mode === 'ANY' ? 'ODER' : 'UND'}
        </span>
      </div>
      <p className="text-xs text-[var(--color-muted)]">
        Waehlen Sie, ob alle Bedingungen (UND) oder mindestens eine Bedingung (ODER) erfuellt sein muss.
      </p>
      <div className="max-w-[280px]">
        <Label className="text-xs">Logik</Label>
        <Select
          value={mode}
          onValueChange={(value) => onUpdate({ dependencyMode: value as 'ALL' | 'ANY' })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">UND (alle Bedingungen)</SelectItem>
            <SelectItem value="ANY">ODER (mindestens eine)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Dialog open={depsOpen} onOpenChange={setDepsOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            Abhaengigkeiten bearbeiten ({deps.length}) - {mode === 'ANY' ? 'ODER' : 'UND'}
          </Button>
        </DialogTrigger>
        <DialogContent
          title="Sektions-Abhaengigkeiten bearbeiten"
          className="max-w-3xl max-h-[85vh] overflow-hidden"
        >
          <div className="space-y-3 overflow-y-auto pr-1 max-h-[65vh]">
            {deps.length === 0 && (
              <p className="text-sm text-[var(--color-muted)]">Keine Abhaengigkeiten gesetzt.</p>
            )}
            {deps.map((dep, idx) => {
              const question = findQuestion(dep.questionId)
              return (
                <div key={`${dep.questionId}-${idx}`} className="space-y-2 rounded-[var(--radius-card)] border border-[var(--color-border)] p-3">
                  <Select
                    value={dep.questionId}
                    onValueChange={(questionId) => {
                      if (questionId === OBJECT_TYPE_DEP_ID) {
                        updateDependency(idx, buildObjectTypeDependency())
                        return
                      }
                      if (questionId === OBJECT_META_DEP_ID) {
                        updateDependency(idx, buildObjectMetaDependency())
                        return
                      }
                      const nextQuestion = findQuestion(questionId)
                      if (!nextQuestion) return
                      updateDependency(idx, buildDefaultDependency(nextQuestion))
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Frage waehlen" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={OBJECT_TYPE_DEP_ID}>Objekt-Typ ist ...</SelectItem>
                      <SelectItem value={OBJECT_META_DEP_ID}>Objekt-Metadatenwert ist ...</SelectItem>
                      {dependencyCandidates.map((q) => (
                        <SelectItem key={q.id} value={q.id}>
                          {truncateText(q.title || q.id, 90)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {dep.questionId === OBJECT_TYPE_DEP_ID && (
                    <div className="w-full rounded-[var(--radius-button)] border border-[var(--color-border)] bg-white p-3 space-y-2">
                      <Label className="text-xs">Objekt-Typ</Label>
                      <Input
                        className="w-full"
                        placeholder="z. B. Anwendung"
                        value={typeof dep.value === 'string' ? dep.value : ''}
                        onChange={(e) => updateDependency(idx, { operator: 'object_type_eq', value: e.target.value })}
                      />
                    </div>
                  )}
                  {dep.questionId === OBJECT_META_DEP_ID && (
                    <ObjectMetaDependencyFields
                      dep={dep}
                      metadataKeys={objectPickerFilterOptions.metadataKeys}
                      onPatch={(patch) => updateDependency(idx, patch)}
                    />
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    {question?.type === 'boolean' && (
                      <Select
                        value={String(dep.value)}
                        onValueChange={(v) => updateDependency(idx, { value: v === 'true' })}
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="true">Ja</SelectItem>
                          <SelectItem value="false">Nein</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                    {question?.type === 'single' && question.options?.length && (
                      <Select
                        value={String(dep.value)}
                        onValueChange={(v) => updateDependency(idx, { value: v })}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Wert" />
                        </SelectTrigger>
                        <SelectContent>
                          {question.options.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {truncateText(opt.label, 60)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {question?.type === 'multi' && question.options?.length && (
                      <div className="w-full rounded-[var(--radius-button)] border border-[var(--color-border)] bg-white p-3 text-sm">
                        <div className="mb-2 text-xs text-[var(--color-muted)]">Antworten auswaehlen</div>
                        <div className="grid gap-2">
                          {question.options.map((opt) => {
                            const current = Array.isArray(dep.value) ? dep.value : []
                            const checked = current.includes(opt.value)
                            return (
                              <label key={opt.value} className="flex items-start gap-2">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const next = e.target.checked
                                      ? [...current, opt.value]
                                      : current.filter((v) => v !== opt.value)
                                    updateDependency(idx, { value: next })
                                  }}
                                  className="mt-1 h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-primary)]"
                                />
                                <span>{truncateText(opt.label, 60)}</span>
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    )}
                    {question?.type === 'text' && (
                      <Input
                        className="w-full"
                        placeholder="Wert"
                        value={typeof dep.value === 'string' ? dep.value : ''}
                        onChange={(e) => updateDependency(idx, { value: e.target.value })}
                      />
                    )}
                    {question?.type === 'multiline' && (
                      <div className="w-full rounded-[var(--radius-button)] border border-[var(--color-border)] bg-white p-3 space-y-2">
                        <Label className="text-xs">Textbedingung</Label>
                        <Select
                          value={dep.operator ?? 'eq'}
                          onValueChange={(operator) =>
                            updateDependency(idx, { operator: operator as QuestionDependency['operator'] })
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="eq">ist genau</SelectItem>
                            <SelectItem value="contains">enthaelt</SelectItem>
                            <SelectItem value="not_contains">enthaelt nicht</SelectItem>
                            <SelectItem value="starts_with">beginnt mit</SelectItem>
                            <SelectItem value="ends_with">endet mit</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          className="w-full"
                          placeholder="Wert"
                          value={typeof dep.value === 'string' ? dep.value : ''}
                          onChange={(e) => updateDependency(idx, { value: e.target.value })}
                        />
                      </div>
                    )}
                    {question?.type === 'date_time' && (
                      <div className="w-full rounded-[var(--radius-button)] border border-[var(--color-border)] bg-white p-3 space-y-2">
                        <Label className="text-xs">Datumsbedingung</Label>
                        <Select
                          value={dep.operator ?? 'date_is_future'}
                          onValueChange={(operator) =>
                            updateDependency(idx, {
                              operator: operator as QuestionDependency['operator'],
                              dateValue: operator === 'date_equals' ? dep.dateValue ?? '' : undefined,
                            })
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="date_is_future">Datum liegt in der Zukunft</SelectItem>
                            <SelectItem value="date_is_past">Datum liegt in der Vergangenheit</SelectItem>
                            <SelectItem value="date_within_future_days">Datum liegt innerhalb der naechsten X Tage</SelectItem>
                            <SelectItem value="date_equals">Datum trifft auf genaues Datum</SelectItem>
                          </SelectContent>
                        </Select>
                        {dep.operator === 'date_equals' && (
                          <Input
                            type={question.dateTimeMode === 'datetime' ? 'datetime-local' : 'date'}
                            value={dep.dateValue ?? ''}
                            onChange={(e) => updateDependency(idx, { dateValue: e.target.value })}
                          />
                        )}
                        <div className="space-y-1">
                          <Label className="text-xs">Tagesdifferenz (+/-)</Label>
                          <Input
                            type="number"
                            value={String(dep.dayOffset ?? 0)}
                            onChange={(e) =>
                              updateDependency(idx, {
                                dayOffset: Number.isNaN(Number(e.target.value))
                                  ? 0
                                  : Number(e.target.value),
                              })
                            }
                          />
                          <p className="text-xs text-[var(--color-muted)]">
                            Beispiele: +7 = mindestens 7 Tage in der Zukunft, -3 = mindestens 3 Tage in der Vergangenheit.
                            "Innerhalb der naechsten X Tage": 14 = innerhalb der naechsten 14 Tage.
                            Bei "genaues Datum" gilt die Zahl als Toleranz (z. B. 2 = +/-2 Tage).
                          </p>
                        </div>
                      </div>
                    )}
                    {(question?.type === 'percentage' || question?.type === 'likert') && (
                      <div className="w-full rounded-[var(--radius-button)] border border-[var(--color-border)] bg-white p-3 space-y-2">
                        <Label className="text-xs">Numerische Bedingung</Label>
                        <div className="grid gap-2 md:grid-cols-[220px_1fr]">
                          <Select
                            value={dep.operator ?? 'gte'}
                            onValueChange={(operator) =>
                              updateDependency(idx, { operator: operator as QuestionDependency['operator'] })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="eq">=</SelectItem>
                              <SelectItem value="gt">&gt;</SelectItem>
                              <SelectItem value="gte">&gt;=</SelectItem>
                              <SelectItem value="lt">&lt;</SelectItem>
                              <SelectItem value="lte">&lt;=</SelectItem>
                            </SelectContent>
                          </Select>
                          <Input
                            type="number"
                            value={typeof dep.value === 'string' ? dep.value : ''}
                            onChange={(e) => updateDependency(idx, { value: e.target.value })}
                            placeholder="Wert"
                          />
                        </div>
                      </div>
                    )}
                    {question?.type === 'ranking' && (
                      <div className="w-full rounded-[var(--radius-button)] border border-[var(--color-border)] bg-white p-3 space-y-2">
                        <Label className="text-xs">Ranking-Bedingung</Label>
                        <Select
                          value={dep.operator ?? 'ranking_contains'}
                          onValueChange={(operator) =>
                            updateDependency(idx, { operator: operator as QuestionDependency['operator'] })
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ranking_contains">enthaelt Option</SelectItem>
                            <SelectItem value="ranking_position_eq">Option ist genau auf Position X</SelectItem>
                            <SelectItem value="ranking_position_better_than">Option ist besser als Position X</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select
                          value={typeof dep.value === 'string' ? dep.value : ''}
                          onValueChange={(value) => updateDependency(idx, { value })}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Option waehlen" />
                          </SelectTrigger>
                          <SelectContent>
                            {(question.rankingOptions ?? []).map((opt) => (
                              <SelectItem key={opt.id} value={opt.id}>
                                {truncateText(opt.label || opt.id, 70)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {(dep.operator === 'ranking_position_eq' ||
                          dep.operator === 'ranking_position_better_than') && (
                          <div className="space-y-1">
                            <Label className="text-xs">Position X</Label>
                            <Input
                              type="number"
                              min={1}
                              value={String(dep.positionValue ?? 1)}
                              onChange={(e) =>
                                updateDependency(idx, {
                                  positionValue: Number.isNaN(Number(e.target.value))
                                    ? 1
                                    : Math.max(1, Number(e.target.value)),
                                })
                              }
                            />
                          </div>
                        )}
                      </div>
                    )}
                    {question?.type === 'object_picker' && (
                      <div className="w-full rounded-[var(--radius-button)] border border-[var(--color-border)] bg-white p-3 space-y-2">
                        <Label className="text-xs">Objekt-Bedingung</Label>
                        <Select
                          value={dep.operator ?? 'eq'}
                          onValueChange={(operator) =>
                            updateDependency(idx, { operator: operator as QuestionDependency['operator'] })
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="eq">ist genau Objekt-ID</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          className="w-full"
                          placeholder="Objekt-ID"
                          value={typeof dep.value === 'string' ? dep.value : ''}
                          onChange={(e) => updateDependency(idx, { value: e.target.value })}
                        />
                      </div>
                    )}
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeDependency(idx)}>
                      Entfernen
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={addDependency}>
              Bedingung hinzufuegen
            </Button>
            <Button type="button" onClick={() => setDepsOpen(false)}>
              Fertig
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface QuestionEditorProps {
  question: Question
  sectionIndex: number
  questionIndex: number
  availableQuestionTypes: Array<{ value: QuestionType; label: string }>
  objectPickerFilterOptions: ObjectPickerFilterOptions
  sections: QuestionnaireSection[]
  allQuestions: Question[]
  currentQuestionId: string
  onUpdate: (patch: Partial<Question>) => void
  onRemove: () => void
  onClone: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onMoveSection: (toSectionIndex: number) => void
  canMoveUp: boolean
  canMoveDown: boolean
  titleMissing?: boolean
}

function QuestionEditor({
  question,
  sectionIndex,
  questionIndex,
  availableQuestionTypes,
  objectPickerFilterOptions,
  sections,
  allQuestions,
  currentQuestionId,
  onUpdate,
  onRemove,
  onClone,
  onMoveUp,
  onMoveDown,
  onMoveSection,
  canMoveUp,
  canMoveDown,
  titleMissing = false,
}: QuestionEditorProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [depsOpen, setDepsOpen] = useState(false)
  const [previewValue, setPreviewValue] = useState<string | string[] | boolean | undefined>(undefined)
  const [previewCustomOptions, setPreviewCustomOptions] = useState<string[]>([])
  const [previewReason, setPreviewReason] = useState('')
  const [previewObjectMetadata, setPreviewObjectMetadata] = useState('')
  const dependencyCandidates = allQuestions.filter(
    (qu) => qu.id !== currentQuestionId && qu.type !== 'info'
  )
  const deps = question.dependencies ?? (question.dependency ? [question.dependency] : [])
  const dependencyMode = question.dependencyMode === 'ANY' ? 'ANY' : 'ALL'
  const questionNumberMap = useMemo(() => {
    const map = new Map<string, string>()
    sections.forEach((section, sIndex) => {
      section.questions.forEach((q, qIndex) => {
        map.set(q.id, `${sIndex + 1}.${qIndex + 1}`)
      })
    })
    return map
  }, [sections])

  const formatOptionValue = (optionIndex: number) =>
    `${sectionIndex + 1}-${questionIndex + 1}-${optionIndex + 1}-Option`

  const normalizeOptions = (options: QuestionOption[]) =>
    options.map((opt, index) => ({
      ...opt,
      value: formatOptionValue(index),
    }))

  useEffect(() => {
    if (question.type !== 'single' && question.type !== 'multi') return
    const opts = question.options ?? []
    const needsNormalize = opts.some((opt, idx) => opt.value !== formatOptionValue(idx))
    if (needsNormalize && opts.length > 0) {
      setOptions(normalizeOptions(opts))
    }
    if (!question.options) {
      setOptions([])
    }
  }, [question.type, question.options, sectionIndex, questionIndex])

  useEffect(() => {
    setPreviewValue(undefined)
    setPreviewCustomOptions([])
    setPreviewReason('')
    setPreviewObjectMetadata('')
  }, [question.id, question.type])

  const setOptions = (options: QuestionOption[]) => onUpdate({ options })
  const addOption = () => {
    const opts = question.options ?? []
    const next = [...opts, { value: '', label: '' }]
    setOptions(normalizeOptions(next))
  }
  const updateOption = (index: number, patch: Partial<QuestionOption>) => {
    const opts = [...(question.options ?? [])]
    opts[index] = { ...opts[index], ...patch }
    setOptions(normalizeOptions(opts))
  }
  const moveOptionTo = (from: number, to: number) => {
    const opts = [...(question.options ?? [])]
    if (from === to || from < 0 || to < 0 || from >= opts.length || to >= opts.length) return
    const [item] = opts.splice(from, 1)
    opts.splice(to, 0, item)
    setOptions(normalizeOptions(opts))
  }
  const handleDragStart = (index: number) => (event: React.DragEvent) => {
    setDragIndex(index)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
  }
  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }
  const handleDrop = (index: number) => (event: React.DragEvent) => {
    event.preventDefault()
    const raw = event.dataTransfer.getData('text/plain')
    const from = raw ? Number(raw) : dragIndex
    if (from === null || Number.isNaN(from)) return
    moveOptionTo(from, index)
    setDragIndex(null)
  }
  const handleDragEnd = () => setDragIndex(null)
  const removeOption = (index: number) => {
    const next = (question.options ?? []).filter((_, i) => i !== index)
    setOptions(normalizeOptions(next))
  }
  const setAssignmentOptions = (options: AssignmentOption[]) =>
    onUpdate({
      assignmentOptions: options,
      required: options.some((opt) => !!opt.required),
    })
  const addAssignmentOption = () => {
    const next: AssignmentOption[] = [
      ...(question.assignmentOptions ?? []),
      {
        id: generateId(),
        label: '',
        required: false,
        allowMultiple: false,
        targetType: 'object',
        objectTypeFilter: [],
        objectGroupIds: [],
      },
    ]
    setAssignmentOptions(next)
  }
  const updateAssignmentOption = (index: number, patch: Partial<AssignmentOption>) => {
    const current = [...(question.assignmentOptions ?? [])]
    const entry = current[index]
    if (!entry) return
    current[index] = { ...entry, ...patch }
    setAssignmentOptions(current)
  }
  const removeAssignmentOption = (index: number) => {
    const next = (question.assignmentOptions ?? []).filter((_, i) => i !== index)
    setAssignmentOptions(next)
  }

  const setDependencies = (next: QuestionDependency[]) => {
    onUpdate({ dependencies: next, dependency: undefined })
  }

  const updateDependency = (index: number, patch: Partial<QuestionDependency>) => {
    const next = [...deps]
    next[index] = { ...next[index], ...patch }
    setDependencies(next)
  }

  const addDependency = () => {
    if (dependencyCandidates.length === 0) {
      setDependencies([...deps, buildObjectTypeDependency()])
      return
    }
    const first = dependencyCandidates[0]
    setDependencies([...deps, buildDefaultDependency(first)])
  }

  const removeDependency = (index: number) => {
    const next = deps.filter((_, i) => i !== index)
    setDependencies(next)
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-muted-bg)]/50 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Label className="w-24 shrink-0">Typ</Label>
        <Select
          value={question.type}
          onValueChange={(v) => {
            const nextType = v as QuestionType
            const patch: Partial<Question> = {
              type: nextType,
              required: nextType === 'info' ? false : question.required,
              allowCustomOptions:
                nextType === 'single' || nextType === 'multi'
                  ? question.allowCustomOptions
                  : false,
            }
            if (nextType === 'date_time') {
              patch.dateTimeMode = question.dateTimeMode ?? 'date'
            }
            if (nextType === 'percentage') {
              patch.percentageMode = question.percentageMode ?? 'input'
              patch.percentageOptions = question.percentageOptions ?? [0, 25, 50, 75, 100]
              patch.percentageMinLabel = question.percentageMinLabel ?? ''
              patch.percentageMaxLabel = question.percentageMaxLabel ?? ''
            }
            if (nextType === 'likert') {
              patch.likertSteps = question.likertSteps ?? 5
              patch.likertMinLabel = question.likertMinLabel ?? 'Trifft nicht zu'
              patch.likertMaxLabel = question.likertMaxLabel ?? 'Trifft voll zu'
            }
            if (nextType === 'ranking') {
              patch.rankingOptions =
                question.rankingOptions && question.rankingOptions.length > 0
                  ? question.rankingOptions
                  : [
                      { id: generateId(), label: 'Option A' },
                      { id: generateId(), label: 'Option B' },
                      { id: generateId(), label: 'Option C' },
                    ]
            }
            if (nextType === 'object_picker') {
              patch.objectPickerMode = question.objectPickerMode ?? 'all'
              patch.objectPickerPageSize = question.objectPickerPageSize ?? 20
              patch.objectPickerType = question.objectPickerType ?? ''
              patch.objectPickerGroupIds = question.objectPickerGroupIds ?? []
              patch.objectPickerAllowMultiple = question.objectPickerAllowMultiple ?? false
              patch.objectPickerMultiMode = question.objectPickerMultiMode ?? 'checklist'
              patch.objectPickerPerObjectMetaEnabled = question.objectPickerPerObjectMetaEnabled ?? false
              patch.objectPickerPerObjectMetaLabel =
                question.objectPickerPerObjectMetaLabel ?? 'Labeltext'
              patch.objectPickerPerObjectMetaOptions =
                question.objectPickerPerObjectMetaOptions ?? ['Option1', 'Option2']
              patch.objectPickerPerObjectMetaAllowCustomText =
                question.objectPickerPerObjectMetaAllowCustomText ?? false
              patch.objectPickerPerObjectMetaCustomLabel =
                question.objectPickerPerObjectMetaCustomLabel ?? 'Freitext'
            }
            if (nextType === 'assignment_picker') {
              const nextAssignmentOptions: AssignmentOption[] =
                question.assignmentOptions && question.assignmentOptions.length > 0
                  ? question.assignmentOptions
                  : [
                      {
                        id: generateId(),
                        label: 'Fachlicher Ansprechpartner',
                        required: true,
                        allowMultiple: false,
                        targetType: 'user' as const,
                      },
                      {
                        id: generateId(),
                        label: 'Technischer Ansprechpartner',
                        required: true,
                        allowMultiple: false,
                        targetType: 'user' as const,
                      },
                    ]
              patch.assignmentOptions = nextAssignmentOptions
              patch.required = nextAssignmentOptions.some((opt) => !!opt.required)
            }
            onUpdate({
              ...patch,
            })
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {availableQuestionTypes.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-[var(--color-muted)]">Sektion</Label>
          <Select
            value={String(sectionIndex)}
            onValueChange={(v) => onMoveSection(Number(v))}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sections.map((section, idx) => (
                <SelectItem key={section.id} value={String(idx)}>
                  {section.title || `Sektion ${idx + 1}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-1 ml-auto">
          <Button type="button" variant="outline" size="sm" onClick={onClone}>
            Klonen
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onMoveUp} disabled={!canMoveUp}>^</Button>
          <Button type="button" variant="ghost" size="sm" onClick={onMoveDown} disabled={!canMoveDown}>v</Button>
          <Button type="button" variant="destructive" size="sm" onClick={onRemove}>Entfernen</Button>
        </div>
      </div>
      <div className="space-y-2">
        <Label>Titel</Label>
        <Input
          value={question.title}
          onChange={(e) => onUpdate({ title: e.target.value })}
          placeholder="Fragentitel"
          className={
            titleMissing
              ? 'border-[var(--color-required)] ring-1 ring-[var(--color-required)]/30'
              : ''
          }
          required
        />
        {titleMissing && (
          <p className="text-xs text-[var(--color-required)]">Fragentitel fehlt.</p>
        )}
      </div>
      <div className="space-y-2">
        <Label>Beschreibung (optional)</Label>
        <RichTextEditor
          value={question.description ?? ''}
          onChange={(html) => onUpdate({ description: html ?? '' })}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!question.descriptionAsPopup}
            onChange={(e) => onUpdate({ descriptionAsPopup: e.target.checked })}
            className="h-4 w-4 rounded border-[var(--color-border)]"
          />
          Beschreibung in Popup anzeigen
        </label>
      </div>
      <div className="space-y-2">
        <Label>Externer Link (optional)</Label>
        <Input
          value={question.linkUrl ?? ''}
          onChange={(e) => onUpdate({ linkUrl: e.target.value })}
          placeholder="https://..."
        />
      </div>
      <div className="space-y-2">
        <Label>Linktext (optional)</Label>
        <Input
          value={question.linkText ?? ''}
          onChange={(e) => onUpdate({ linkText: e.target.value })}
          placeholder="Link zu weiterfuehrenden Informationen"
        />
      </div>
      {question.type !== 'info' && question.type !== 'assignment_picker' && (
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id={`req-${question.id}`}
            checked={question.required}
            onChange={(e) => onUpdate({ required: e.target.checked })}
            className="h-4 w-4 rounded border-[var(--color-border)]"
          />
          <Label htmlFor={`req-${question.id}`}>Pflichtfeld</Label>
        </div>
      )}
      {question.type !== 'info' && question.type !== 'assignment_picker' && (
        <>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id={`allow-custom-${question.id}`}
              checked={!!question.allowCustomOptions}
              disabled={question.type !== 'single' && question.type !== 'multi'}
              onChange={(e) => onUpdate({ allowCustomOptions: e.target.checked })}
              className="h-4 w-4 rounded border-[var(--color-border)] disabled:cursor-not-allowed"
            />
            <Label htmlFor={`allow-custom-${question.id}`}>
              Individuelle Antworten zulassen
            </Label>
          </div>
          {question.type !== 'single' && question.type !== 'multi' && (
            <p className="text-xs text-[var(--color-muted)]">
              Diese Funktion ist nur bei Einzelauswahl und Mehrfachauswahl verfuegbar.
            </p>
          )}
        </>
      )}
      {question.type !== 'info' && question.type !== 'assignment_picker' && (
        <div className="space-y-2">
          <Label>Platzhalter (optional)</Label>
          <Input
            value={question.placeholder ?? ''}
            onChange={(e) => onUpdate({ placeholder: e.target.value || undefined })}
            placeholder="Placeholder-Text"
          />
        </div>
      )}

      {(question.type === 'single' || question.type === 'multi') && (
        <div className="space-y-2">
          <Label>Optionen</Label>
          {(question.options ?? []).map((opt, i) => (
            <div
              key={i}
              className={`flex gap-2 rounded-md border border-transparent px-1 py-1 ${
                dragIndex === i ? 'bg-[var(--color-muted-bg)]' : ''
              }`}
              onDragOver={handleDragOver}
              onDrop={handleDrop(i)}
            >
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-button)] border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] cursor-move"
                draggable
                onDragStart={handleDragStart(i)}
                onDragEnd={handleDragEnd}
                aria-label="Option verschieben"
                title="Ziehen zum Sortieren"
              >
                ::
              </button>
              <span className="self-center text-xs text-[var(--color-muted)]">Drag</span>
              <Input
                placeholder="Label"
                value={opt.label}
                onChange={(e) => updateOption(i, { label: e.target.value })}
              />
              <label className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
                <input
                  type="checkbox"
                  checked={!!opt.requiresReason}
                  onChange={(e) => updateOption(i, { requiresReason: e.target.checked })}
                  className="h-4 w-4 rounded border-[var(--color-border)]"
                />
                Begruendung
              </label>
              <Input
                placeholder="Wert"
                value={opt.value}
                readOnly
                className="w-32"
              />
              <Button type="button" variant="ghost" size="sm" onClick={() => removeOption(i)}>
                (x)
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addOption}>
            Option hinzufuegen
          </Button>
        </div>
      )}

      {question.type === 'assignment_picker' && (
        <div className="space-y-2">
          <Label>Zuordnungsoptionen</Label>
          {(question.assignmentOptions ?? []).map((opt, index) => (
            <div
              key={opt.id}
              className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white p-3 space-y-3"
            >
              <div className="grid gap-2 md:grid-cols-[220px_180px_180px_auto] md:items-center">
                <Select
                  value={opt.targetType}
                  onValueChange={(value) =>
                    updateAssignmentOption(index, {
                      targetType: value as 'object' | 'user',
                      objectTypeFilter: value === 'user' ? [] : (opt.objectTypeFilter ?? []),
                      objectGroupIds: value === 'user' ? [] : (opt.objectGroupIds ?? []),
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="object">Objekt</SelectItem>
                    <SelectItem value="user">Benutzer</SelectItem>
                  </SelectContent>
                </Select>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!opt.required}
                    onChange={(e) => updateAssignmentOption(index, { required: e.target.checked })}
                    className="h-4 w-4 rounded border-[var(--color-border)]"
                  />
                  Pflicht
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!opt.allowMultiple}
                    onChange={(e) =>
                      updateAssignmentOption(index, { allowMultiple: e.target.checked })
                    }
                    className="h-4 w-4 rounded border-[var(--color-border)]"
                  />
                  Mehrfach
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeAssignmentOption(index)}
                >
                  Entfernen
                </Button>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Ueberschriftentext</Label>
                  <Input
                    placeholder="z. B. Fachlicher Ansprechpartner"
                    value={opt.label}
                    onChange={(e) => updateAssignmentOption(index, { label: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Suchfeld-Text (optional)</Label>
                  <Input
                    placeholder="z. B. Benutzer suchen..."
                    value={opt.searchPlaceholder ?? ''}
                    onChange={(e) =>
                      updateAssignmentOption(index, {
                        searchPlaceholder: e.target.value || undefined,
                      })
                    }
                  />
                </div>
              </div>
              {opt.targetType === 'object' && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Erlaubte Objekttypen</Label>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {objectPickerFilterOptions.types.map((type) => {
                        const selected = (opt.objectTypeFilter ?? []).includes(type)
                        return (
                          <label key={`${opt.id}-${type}`} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={(e) => {
                                const current = opt.objectTypeFilter ?? []
                                const next = e.target.checked
                                  ? [...current, type]
                                  : current.filter((entry) => entry !== type)
                                updateAssignmentOption(index, { objectTypeFilter: next })
                              }}
                              className="h-4 w-4 rounded border-[var(--color-border)]"
                            />
                            <span>{type}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Erlaubte Objektgruppen</Label>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {objectPickerFilterOptions.objectGroups.map((group) => {
                        const selected = (opt.objectGroupIds ?? []).includes(group.id)
                        return (
                          <label key={`${opt.id}-${group.id}`} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={(e) => {
                                const current = opt.objectGroupIds ?? []
                                const next = e.target.checked
                                  ? [...current, group.id]
                                  : current.filter((entry) => entry !== group.id)
                                updateAssignmentOption(index, { objectGroupIds: next })
                              }}
                              className="h-4 w-4 rounded border-[var(--color-border)]"
                            />
                            <span>{group.name}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addAssignmentOption}>
            Option hinzufuegen
          </Button>
        </div>
      )}

      {question.type === 'date_time' && (
        <div className="space-y-2">
          <Label>Darstellung</Label>
          <Select
            value={question.dateTimeMode ?? 'date'}
            onValueChange={(value) => onUpdate({ dateTimeMode: value as 'date' | 'datetime' })}
          >
            <SelectTrigger className="w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date">Nur Datum</SelectItem>
              <SelectItem value="datetime">Datum und Uhrzeit</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {question.type === 'percentage' && (
        <div className="space-y-3 rounded-[var(--radius-card)] border border-[var(--color-border)] p-3">
          <Label>Prozentdarstellung</Label>
          <Select
            value={question.percentageMode ?? 'input'}
            onValueChange={(value) =>
              onUpdate({ percentageMode: value as 'input' | 'slider' | 'select' })
            }
          >
            <SelectTrigger className="w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="input">Direkteingabe</SelectItem>
              <SelectItem value="slider">Schieberegler</SelectItem>
              <SelectItem value="select">Vordefinierte Werte</SelectItem>
            </SelectContent>
          </Select>
          {(question.percentageMode ?? 'input') === 'select' && (
            <div className="space-y-1">
              <Label>Auswahlwerte (kommagetrennt)</Label>
              <Input
                value={(question.percentageOptions ?? [0, 25, 50, 75, 100]).join(', ')}
                onChange={(e) => {
                  const values = e.target.value
                    .split(',')
                    .map((entry) => Number(entry.trim()))
                    .filter((entry) => !Number.isNaN(entry) && entry >= 0 && entry <= 100)
                  onUpdate({ percentageOptions: values })
                }}
              />
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Linkes Label (optional)</Label>
              <Input
                value={question.percentageMinLabel ?? ''}
                onChange={(e) => onUpdate({ percentageMinLabel: e.target.value })}
                placeholder="z. B. Niedrig"
              />
            </div>
            <div className="space-y-1">
              <Label>Rechtes Label (optional)</Label>
              <Input
                value={question.percentageMaxLabel ?? ''}
                onChange={(e) => onUpdate({ percentageMaxLabel: e.target.value })}
                placeholder="z. B. Hoch"
              />
            </div>
          </div>
        </div>
      )}

      {question.type === 'likert' && (
        <div className="space-y-3 rounded-[var(--radius-card)] border border-[var(--color-border)] p-3">
          <Label>Likert-Konfiguration</Label>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label>Skalenpunkte</Label>
              <Select
                value={String(question.likertSteps ?? 5)}
                onValueChange={(value) => onUpdate({ likertSteps: Number(value) })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">3</SelectItem>
                  <SelectItem value="5">5</SelectItem>
                  <SelectItem value="7">7</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Linkes Label</Label>
              <Input
                value={question.likertMinLabel ?? ''}
                onChange={(e) => onUpdate({ likertMinLabel: e.target.value })}
                placeholder="Trifft nicht zu"
              />
            </div>
            <div className="space-y-1">
              <Label>Rechtes Label</Label>
              <Input
                value={question.likertMaxLabel ?? ''}
                onChange={(e) => onUpdate({ likertMaxLabel: e.target.value })}
                placeholder="Trifft voll zu"
              />
            </div>
          </div>
        </div>
      )}

      {question.type === 'ranking' && (
        <div className="space-y-3 rounded-[var(--radius-card)] border border-[var(--color-border)] p-3">
          <Label>Ranking-Optionen</Label>
          {(question.rankingOptions ?? []).map((opt, idx) => (
            <div key={opt.id} className="flex items-center gap-2">
              <Input
                value={opt.label}
                onChange={(e) => {
                  const next = [...(question.rankingOptions ?? [])]
                  next[idx] = { ...next[idx], label: e.target.value }
                  onUpdate({ rankingOptions: next })
                }}
                placeholder={`Option ${idx + 1}`}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  const next = (question.rankingOptions ?? []).filter((entry) => entry.id !== opt.id)
                  onUpdate({ rankingOptions: next })
                }}
              >
                -
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onUpdate({
                rankingOptions: [...(question.rankingOptions ?? []), { id: generateId(), label: '' }],
              })
            }
          >
            Option hinzufuegen
          </Button>
        </div>
      )}

      {question.type === 'object_picker' && (
        <div className="space-y-3 rounded-[var(--radius-card)] border border-[var(--color-border)] p-3">
          <Label>Objekt-Picker</Label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!question.objectPickerAllowMultiple}
              onChange={(e) => onUpdate({ objectPickerAllowMultiple: e.target.checked })}
              className="h-4 w-4 rounded border-[var(--color-border)]"
            />
            Mehrfachauswahl erlauben
          </label>
          {!!question.objectPickerAllowMultiple && (
            <div className="space-y-1">
              <Label>Mehrfachauswahl-Darstellung</Label>
              <Select
                value={question.objectPickerMultiMode ?? 'checklist'}
                onValueChange={(value) =>
                  onUpdate({ objectPickerMultiMode: value as 'checklist' | 'adder' })
                }
              >
                <SelectTrigger className="w-80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="checklist">Selektionsliste (Checkboxen)</SelectItem>
                  <SelectItem value="adder">Einzeln per Hinzufuegen-Button</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!question.objectPickerPerObjectMetaEnabled}
              onChange={(e) =>
                onUpdate({
                  objectPickerPerObjectMetaEnabled: e.target.checked,
                  objectPickerPerObjectMetaLabel: e.target.checked
                    ? question.objectPickerPerObjectMetaLabel ?? 'Labeltext'
                    : question.objectPickerPerObjectMetaLabel,
                  objectPickerPerObjectMetaOptions: e.target.checked
                    ? question.objectPickerPerObjectMetaOptions ?? ['Option1', 'Option2']
                    : question.objectPickerPerObjectMetaOptions,
                })
              }
              className="h-4 w-4 rounded border-[var(--color-border)]"
            />
            Zusatzinformation pro ausgewaehltem Objekt abfragen
          </label>
          {!!question.objectPickerPerObjectMetaEnabled && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Label der Zusatzinformation</Label>
                <Input
                  value={question.objectPickerPerObjectMetaLabel ?? ''}
                  onChange={(e) => onUpdate({ objectPickerPerObjectMetaLabel: e.target.value })}
                  placeholder="Labeltext"
                />
              </div>
              <div className="space-y-1">
                <Label>Optionen (kommagetrennt)</Label>
                <Input
                  value={(question.objectPickerPerObjectMetaOptions ?? []).join(', ')}
                  onChange={(e) =>
                    onUpdate({
                      objectPickerPerObjectMetaOptions: e.target.value
                        .split(',')
                        .map((entry) => entry.trim())
                        .filter((entry) => entry.length > 0),
                    })
                  }
                  placeholder="Option1,Option2,..."
                />
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!question.objectPickerPerObjectMetaAllowCustomText}
                    onChange={(e) =>
                      onUpdate({ objectPickerPerObjectMetaAllowCustomText: e.target.checked })
                    }
                    className="h-4 w-4 rounded border-[var(--color-border)]"
                  />
                  Freitexteingabe zusaetzlich erlauben
                </label>
                {!!question.objectPickerPerObjectMetaAllowCustomText && (
                  <div className="space-y-1">
                    <Label>Label fuer Freitextoption</Label>
                    <Input
                      value={question.objectPickerPerObjectMetaCustomLabel ?? ''}
                      onChange={(e) =>
                        onUpdate({ objectPickerPerObjectMetaCustomLabel: e.target.value })
                      }
                      placeholder="Freitext"
                    />
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="space-y-1">
            <Label>Objekttyp</Label>
            <Select
              value={question.objectPickerType ?? '__all__'}
              onValueChange={(value) =>
                onUpdate({
                  objectPickerType: value === '__all__' ? undefined : value,
                  objectPickerTypeFilter: value === '__all__' ? undefined : [value],
                })
              }
            >
              <SelectTrigger className="w-80">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Alle Typen</SelectItem>
                {objectPickerFilterOptions.types.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Metadaten-Feld (JSON)</Label>
              <Select
                value={question.objectPickerMetadataKey ?? '__none__'}
                onValueChange={(value) =>
                  onUpdate({
                    objectPickerMetadataKey: value === '__none__' ? undefined : value,
                    objectPickerMetadataValue:
                      value === '__none__' ? undefined : question.objectPickerMetadataValue,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Kein Metadaten-Filter</SelectItem>
                  {objectPickerFilterOptions.metadataKeys.map((key) => (
                    <SelectItem key={key} value={key}>
                      {key}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Metadaten-Wert</Label>
              <Input
                value={question.objectPickerMetadataValue ?? ''}
                onChange={(e) => onUpdate({ objectPickerMetadataValue: e.target.value || undefined })}
                placeholder="z. B. kritikal"
                disabled={!question.objectPickerMetadataKey}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Objektgruppen (optional)</Label>
            <div className="max-h-44 space-y-2 overflow-auto rounded-[var(--radius-button)] border border-[var(--color-border)] bg-white p-3">
              {objectPickerFilterOptions.objectGroups.length === 0 && (
                <p className="text-xs text-[var(--color-muted)]">Keine Objektgruppen vorhanden.</p>
              )}
              {objectPickerFilterOptions.objectGroups.map((group) => {
                const selected = (question.objectPickerGroupIds ?? []).includes(group.id)
                return (
                  <label key={group.id} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(e) => {
                        const current = question.objectPickerGroupIds ?? []
                        const next = e.target.checked
                          ? [...current, group.id]
                          : current.filter((id) => id !== group.id)
                        onUpdate({ objectPickerGroupIds: next })
                      }}
                      className="mt-0.5 h-4 w-4 rounded border-[var(--color-border)]"
                    />
                    <span>{group.name}</span>
                  </label>
                )
              })}
            </div>
          </div>
          <div className="space-y-1">
            <Label>Seitengroesse bei Auswahl</Label>
            <Select
              value={String(question.objectPickerPageSize ?? 20)}
              onValueChange={(value) => onUpdate({ objectPickerPageSize: Number(value) })}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="30">30</SelectItem>
                <SelectItem value="40">40</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      <div className="space-y-2 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white p-3">
        <Label>Vorschau</Label>
        <p className="text-xs text-[var(--color-muted)]">
          So sieht die Frage in der Durchfuehrung aus.
        </p>
        <QuestionField
          question={question}
          value={previewValue}
          onChange={(value) => setPreviewValue(value)}
          customOptions={previewCustomOptions}
          onCustomOptionsChange={setPreviewCustomOptions}
          reasonValue={previewReason}
          onReasonChange={setPreviewReason}
          objectMetadataValue={previewObjectMetadata}
          onObjectMetadataChange={setPreviewObjectMetadata}
          isVisible
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label>Abhaengigkeiten (optional)</Label>
          <span className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px] uppercase text-[var(--color-muted)]">
            {dependencyMode === 'ANY' ? 'ODER' : 'UND'}
          </span>
        </div>
        <p className="text-xs text-[var(--color-muted)]">
          Waehlen Sie, ob alle Bedingungen (UND) oder mindestens eine Bedingung (ODER) erfuellt sein muss.
        </p>
        <div className="max-w-[280px]">
          <Label className="text-xs">Logik</Label>
          <Select
            value={dependencyMode}
            onValueChange={(value) => onUpdate({ dependencyMode: value as 'ALL' | 'ANY' })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">UND (alle Bedingungen)</SelectItem>
              <SelectItem value="ANY">ODER (mindestens eine)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Dialog open={depsOpen} onOpenChange={setDepsOpen}>
          <DialogTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              Abhaengigkeiten bearbeiten ({deps.length}) - {dependencyMode === 'ANY' ? 'ODER' : 'UND'}
            </Button>
          </DialogTrigger>
          <DialogContent
            title="Abhaengigkeiten bearbeiten"
            className="max-w-3xl max-h-[85vh] overflow-hidden"
          >
            <div className="space-y-3 overflow-y-auto pr-1 max-h-[65vh]">
              {deps.length === 0 && (
                <p className="text-sm text-[var(--color-muted)]">Keine Abhaengigkeiten gesetzt.</p>
              )}
              {deps.map((dep, idx) => {
                const other = dependencyCandidates.find((qu) => qu.id === dep.questionId)
                return (
                  <div key={`${dep.questionId}-${idx}`} className="space-y-2 rounded-[var(--radius-card)] border border-[var(--color-border)] p-3">
                    <Select
                      value={dep.questionId}
                      onValueChange={(questionId) => {
                        if (questionId === OBJECT_TYPE_DEP_ID) {
                          updateDependency(idx, buildObjectTypeDependency())
                          return
                        }
                        if (questionId === OBJECT_META_DEP_ID) {
                          updateDependency(idx, buildObjectMetaDependency())
                          return
                        }
                        const nextOther = dependencyCandidates.find((qu) => qu.id === questionId)
                        if (!nextOther) return
                        updateDependency(idx, buildDefaultDependency(nextOther))
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Frage waehlen" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={OBJECT_TYPE_DEP_ID}>Objekt-Typ ist ...</SelectItem>
                        <SelectItem value={OBJECT_META_DEP_ID}>Objekt-Metadatenwert ist ...</SelectItem>
                        {dependencyCandidates.map((qu) => (
                          <SelectItem key={qu.id} value={qu.id}>
                            <span title={qu.title || qu.id}>
                              {truncateText(
                                `${questionNumberMap.get(qu.id) ?? ''} ${qu.title || qu.id}`.trim(),
                                90
                              )}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {dep.questionId === OBJECT_TYPE_DEP_ID && (
                      <div className="w-full rounded-[var(--radius-button)] border border-[var(--color-border)] bg-white p-3 space-y-2">
                        <Label className="text-xs">Objekt-Typ</Label>
                        <Input
                          className="w-full"
                          placeholder="z. B. Anwendung"
                          value={typeof dep.value === 'string' ? dep.value : ''}
                          onChange={(e) => updateDependency(idx, { operator: 'object_type_eq', value: e.target.value })}
                        />
                      </div>
                    )}
                    {dep.questionId === OBJECT_META_DEP_ID && (
                      <ObjectMetaDependencyFields
                        dep={dep}
                        metadataKeys={objectPickerFilterOptions.metadataKeys}
                        onPatch={(patch) => updateDependency(idx, patch)}
                      />
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      {other && other.type === 'boolean' && (
                        <Select
                          value={String(dep.value)}
                          onValueChange={(v) => updateDependency(idx, { value: v === 'true' })}
                        >
                          <SelectTrigger className="w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="true">Ja</SelectItem>
                            <SelectItem value="false">Nein</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                      {other && other.type === 'single' && other.options?.length && (
                        <Select
                          value={String(dep.value)}
                          onValueChange={(v) => updateDependency(idx, { value: v })}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Wert" />
                          </SelectTrigger>
                          <SelectContent>
                            {other.options.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                <span title={opt.label}>
                                  {truncateText(opt.label, 60)}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      {other && other.type === 'multi' && other.options?.length && (
                        <div className="w-full rounded-[var(--radius-button)] border border-[var(--color-border)] bg-white p-3 text-sm">
                          <div className="mb-2 text-xs text-[var(--color-muted)]">Antworten auswaehlen</div>
                          <div className="grid gap-2">
                            {other.options.map((opt) => {
                              const current = Array.isArray(dep.value) ? dep.value : []
                              const checked = current.includes(opt.value)
                              return (
                                <label key={opt.value} className="flex items-start gap-2">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      const next = e.target.checked
                                        ? [...current, opt.value]
                                        : current.filter((v) => v !== opt.value)
                                      updateDependency(idx, { value: next })
                                    }}
                                    className="mt-1 h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-primary)]"
                                  />
                                  <span title={opt.label}>{truncateText(opt.label, 60)}</span>
                                </label>
                              )
                            })}
                          </div>
                        </div>
                      )}
                      {other && other.type === 'text' && (
                        <Input
                          className="w-full"
                          placeholder="Wert"
                          value={typeof dep.value === 'string' ? dep.value : ''}
                          onChange={(e) => updateDependency(idx, { value: e.target.value })}
                        />
                      )}
                      {other && other.type === 'multiline' && (
                        <div className="w-full rounded-[var(--radius-button)] border border-[var(--color-border)] bg-white p-3 space-y-2">
                          <Label className="text-xs">Textbedingung</Label>
                          <Select
                            value={dep.operator ?? 'eq'}
                            onValueChange={(operator) =>
                              updateDependency(idx, { operator: operator as QuestionDependency['operator'] })
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="eq">ist genau</SelectItem>
                              <SelectItem value="contains">enthaelt</SelectItem>
                              <SelectItem value="not_contains">enthaelt nicht</SelectItem>
                              <SelectItem value="starts_with">beginnt mit</SelectItem>
                              <SelectItem value="ends_with">endet mit</SelectItem>
                            </SelectContent>
                          </Select>
                          <Input
                            className="w-full"
                            placeholder="Wert"
                            value={typeof dep.value === 'string' ? dep.value : ''}
                            onChange={(e) => updateDependency(idx, { value: e.target.value })}
                          />
                        </div>
                      )}
                      {other && other.type === 'date_time' && (
                        <div className="w-full rounded-[var(--radius-button)] border border-[var(--color-border)] bg-white p-3 space-y-2">
                          <Label className="text-xs">Datumsbedingung</Label>
                          <Select
                            value={dep.operator ?? 'date_is_future'}
                            onValueChange={(operator) =>
                              updateDependency(idx, {
                                operator: operator as QuestionDependency['operator'],
                                dateValue: operator === 'date_equals' ? dep.dateValue ?? '' : undefined,
                              })
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="date_is_future">Datum liegt in der Zukunft</SelectItem>
                              <SelectItem value="date_is_past">Datum liegt in der Vergangenheit</SelectItem>
                              <SelectItem value="date_within_future_days">Datum liegt innerhalb der naechsten X Tage</SelectItem>
                              <SelectItem value="date_equals">Datum trifft auf genaues Datum</SelectItem>
                            </SelectContent>
                          </Select>
                          {dep.operator === 'date_equals' && (
                            <Input
                              type={other.dateTimeMode === 'datetime' ? 'datetime-local' : 'date'}
                              value={dep.dateValue ?? ''}
                              onChange={(e) => updateDependency(idx, { dateValue: e.target.value })}
                            />
                          )}
                          <div className="space-y-1">
                            <Label className="text-xs">Tagesdifferenz (+/-)</Label>
                            <Input
                              type="number"
                              value={String(dep.dayOffset ?? 0)}
                              onChange={(e) =>
                                updateDependency(idx, {
                                  dayOffset: Number.isNaN(Number(e.target.value))
                                    ? 0
                                    : Number(e.target.value),
                                  })
                                }
                              />
                            <p className="text-xs text-[var(--color-muted)]">
                              Beispiele: +7 = mindestens 7 Tage in der Zukunft, -3 = mindestens 3 Tage in der Vergangenheit.
                              "Innerhalb der naechsten X Tage": 14 = innerhalb der naechsten 14 Tage.
                              Bei "genaues Datum" gilt die Zahl als Toleranz (z. B. 2 = +/-2 Tage).
                            </p>
                          </div>
                        </div>
                      )}
                      {(other?.type === 'percentage' || other?.type === 'likert') && (
                        <div className="w-full rounded-[var(--radius-button)] border border-[var(--color-border)] bg-white p-3 space-y-2">
                          <Label className="text-xs">Numerische Bedingung</Label>
                          <div className="grid gap-2 md:grid-cols-[220px_1fr]">
                            <Select
                              value={dep.operator ?? 'gte'}
                              onValueChange={(operator) =>
                                updateDependency(idx, { operator: operator as QuestionDependency['operator'] })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="eq">=</SelectItem>
                                <SelectItem value="gt">&gt;</SelectItem>
                                <SelectItem value="gte">&gt;=</SelectItem>
                                <SelectItem value="lt">&lt;</SelectItem>
                                <SelectItem value="lte">&lt;=</SelectItem>
                              </SelectContent>
                            </Select>
                            <Input
                              type="number"
                              value={typeof dep.value === 'string' ? dep.value : ''}
                              onChange={(e) => updateDependency(idx, { value: e.target.value })}
                              placeholder="Wert"
                            />
                          </div>
                        </div>
                      )}
                      {other && other.type === 'ranking' && (
                        <div className="w-full rounded-[var(--radius-button)] border border-[var(--color-border)] bg-white p-3 space-y-2">
                          <Label className="text-xs">Ranking-Bedingung</Label>
                          <Select
                            value={dep.operator ?? 'ranking_contains'}
                            onValueChange={(operator) =>
                              updateDependency(idx, { operator: operator as QuestionDependency['operator'] })
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="ranking_contains">enthaelt Option</SelectItem>
                              <SelectItem value="ranking_position_eq">Option ist genau auf Position X</SelectItem>
                              <SelectItem value="ranking_position_better_than">Option ist besser als Position X</SelectItem>
                            </SelectContent>
                          </Select>
                          <Select
                            value={typeof dep.value === 'string' ? dep.value : ''}
                            onValueChange={(value) => updateDependency(idx, { value })}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Option waehlen" />
                            </SelectTrigger>
                            <SelectContent>
                              {(other.rankingOptions ?? []).map((opt) => (
                                <SelectItem key={opt.id} value={opt.id}>
                                  <span title={opt.label}>{truncateText(opt.label || opt.id, 70)}</span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {(dep.operator === 'ranking_position_eq' ||
                            dep.operator === 'ranking_position_better_than') && (
                            <div className="space-y-1">
                              <Label className="text-xs">Position X</Label>
                              <Input
                                type="number"
                                min={1}
                                value={String(dep.positionValue ?? 1)}
                                onChange={(e) =>
                                  updateDependency(idx, {
                                    positionValue: Number.isNaN(Number(e.target.value))
                                      ? 1
                                      : Math.max(1, Number(e.target.value)),
                                  })
                                }
                              />
                            </div>
                          )}
                        </div>
                      )}
                      {other && other.type === 'object_picker' && (
                        <div className="w-full rounded-[var(--radius-button)] border border-[var(--color-border)] bg-white p-3 space-y-2">
                          <Label className="text-xs">Objekt-Bedingung</Label>
                          <Select
                            value={dep.operator ?? 'eq'}
                            onValueChange={(operator) =>
                              updateDependency(idx, { operator: operator as QuestionDependency['operator'] })
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="eq">ist genau Objekt-ID</SelectItem>
                            </SelectContent>
                          </Select>
                          <Input
                            className="w-full"
                            placeholder="Objekt-ID"
                            value={typeof dep.value === 'string' ? dep.value : ''}
                            onChange={(e) => updateDependency(idx, { value: e.target.value })}
                          />
                        </div>
                      )}
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeDependency(idx)}>
                        Entfernen
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={addDependency}>
                Bedingung hinzufuegen
              </Button>
              <Button type="button" onClick={() => setDepsOpen(false)}>
                Fertig
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
