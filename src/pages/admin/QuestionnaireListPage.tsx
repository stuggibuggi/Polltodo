import { useState, useEffect, useMemo, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { api } from '../../lib/api'
import type { Question, Questionnaire } from '../../types/questionnaire'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog'
import { Toast, useToast } from '../../components/ui/toast'
import { useAuth } from '../../lib/auth'

type PrefillOptionRow = {
  optionValue: string
  optionLabel: string
  optionSource: string
  requiresReason: string
}

const toYesNo = (value: boolean) => (value ? 'Ja' : 'Nein')

const sanitizeFilename = (value: string) =>
  value.replace(/[^a-z0-9-_]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'fragebogen'

function getLikertOptions(question: Question): PrefillOptionRow[] {
  const steps = Number(question.likertSteps ?? 5)
  const safeSteps = Number.isFinite(steps) && steps >= 2 ? Math.floor(steps) : 5
  const rows: PrefillOptionRow[] = []
  for (let i = 1; i <= safeSteps; i += 1) {
    let label = String(i)
    if (i === 1 && question.likertMinLabel) label = `${i} (${question.likertMinLabel})`
    if (i === safeSteps && question.likertMaxLabel) label = `${i} (${question.likertMaxLabel})`
    rows.push({
      optionValue: String(i),
      optionLabel: label,
      optionSource: 'likert_scale',
      requiresReason: 'false',
    })
  }
  return rows
}

function getPercentageOptions(question: Question): PrefillOptionRow[] {
  if (Array.isArray(question.percentageOptions) && question.percentageOptions.length > 0) {
    return question.percentageOptions.map((value) => ({
      optionValue: String(value),
      optionLabel: `${value}%`,
      optionSource: 'percentage_options',
      requiresReason: 'false',
    }))
  }
  return [
    {
      optionValue: '',
      optionLabel: 'Freie Zahl (0-100)',
      optionSource: 'free_input',
      requiresReason: 'false',
    },
  ]
}

function getOptionsForQuestion(question: Question): PrefillOptionRow[] {
  if (question.type === 'boolean') {
    return [
      { optionValue: 'true', optionLabel: 'Ja', optionSource: 'fixed_boolean', requiresReason: 'false' },
      { optionValue: 'false', optionLabel: 'Nein', optionSource: 'fixed_boolean', requiresReason: 'false' },
    ]
  }
  if (question.type === 'likert') return getLikertOptions(question)
  if (question.type === 'percentage') return getPercentageOptions(question)
  if (question.type === 'ranking' && Array.isArray(question.rankingOptions)) {
    return question.rankingOptions.map((opt) => ({
      optionValue: String(opt.id ?? '').trim(),
      optionLabel: String(opt.label ?? '').trim(),
      optionSource: 'ranking_options',
      requiresReason: 'false',
    }))
  }
  if (question.options && question.options.length > 0) {
    return question.options.map((opt) => ({
      optionValue: String(opt.value ?? '').trim(),
      optionLabel: String(opt.label ?? '').trim(),
      optionSource: 'question_options',
      requiresReason: toYesNo(!!opt.requiresReason).toLowerCase(),
    }))
  }
  return []
}

export function QuestionnaireListPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [list, setList] = useState<Questionnaire[]>([])
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteResults, setDeleteResults] = useState(true)
  const [directLink, setDirectLink] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [filterText, setFilterText] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DRAFT' | 'PUBLISHED'>('ALL')
  const [globalFilter, setGlobalFilter] = useState<'ALL' | 'GLOBAL' | 'NON_GLOBAL'>('ALL')
  const [multipleFilter, setMultipleFilter] = useState<'ALL' | 'MULTI' | 'SINGLE'>('ALL')
  const [updatedFilter, setUpdatedFilter] = useState<'ALL' | '7' | '30' | '90' | '365'>('ALL')
  const [sortBy, setSortBy] = useState<'title' | 'status' | 'updatedAt' | 'createdAt'>('title')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const { message: toastMessage, visible: toastVisible, showToast } = useToast()

  const load = async () => {
    const items = await api.listQuestionnaires({ withStats: true })
    setList(items)
  }

  useEffect(() => {
    load()
    const interval = window.setInterval(() => {
      void load()
    }, 30000)
    return () => window.clearInterval(interval)
  }, [])

  const filteredAndSortedList = useMemo(() => {
    const search = filterText.trim().toLowerCase()
    const now = Date.now()
    const updatedDays = updatedFilter === 'ALL' ? null : Number(updatedFilter)

    const filtered = list.filter((q) => {
      if (statusFilter !== 'ALL' && (q.status ?? 'DRAFT') !== statusFilter) return false
      if (globalFilter === 'GLOBAL' && !q.globalForAllUsers) return false
      if (globalFilter === 'NON_GLOBAL' && q.globalForAllUsers) return false
      if (multipleFilter === 'MULTI' && !q.allowMultipleSubmissions) return false
      if (multipleFilter === 'SINGLE' && q.allowMultipleSubmissions) return false

      if (updatedDays !== null) {
        const updatedAt = q.updatedAt ? Date.parse(q.updatedAt) : NaN
        if (!Number.isFinite(updatedAt)) return false
        const diffDays = (now - updatedAt) / (1000 * 60 * 60 * 24)
        if (diffDays > updatedDays) return false
      }

      if (!search) return true
      const haystack = [q.title, q.subtitle ?? '', q.id].join(' ').toLowerCase()
      return haystack.includes(search)
    })

    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0
      if (sortBy === 'title') {
        cmp = (a.title ?? '').localeCompare(b.title ?? '', 'de', { sensitivity: 'base' })
      } else if (sortBy === 'status') {
        cmp = (a.status ?? 'DRAFT').localeCompare(b.status ?? 'DRAFT')
      } else if (sortBy === 'updatedAt') {
        cmp = Date.parse(a.updatedAt ?? '') - Date.parse(b.updatedAt ?? '')
      } else if (sortBy === 'createdAt') {
        cmp = Date.parse(a.createdAt ?? '') - Date.parse(b.createdAt ?? '')
      }
      return sortDirection === 'asc' ? cmp : -cmp
    })

    return sorted
  }, [filterText, globalFilter, list, multipleFilter, sortBy, sortDirection, statusFilter, updatedFilter])

  const formatDate = (value?: string | null) => {
    if (!value) return '-'
    const parsed = Date.parse(value)
    if (!Number.isFinite(parsed)) return '-'
    return new Date(parsed).toLocaleString('de-DE')
  }

  const handleDelete = async (id: string) => {
    try {
      await api.deleteQuestionnaire(id, { deleteResults })
      await load()
      setDeleteId(null)
      setDeleteResults(true)
      showToast('Fragebogen geloescht.')
      if (list.length <= 1) return
      navigate('/admin/questionnaires')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Loeschen fehlgeschlagen.'
      showToast(message)
    }
  }

  const handleDuplicate = async (id: string) => {
    const source = await api.getQuestionnaire(id)
    const copy = await api.createQuestionnaire({
      ...source,
      title: `${source.title} (Kopie)`,
    })
    await load()
    showToast('Fragebogen dupliziert.')
    navigate(`/admin/questionnaires/${copy.id}/edit`)
  }

  const openDirectLinkDialog = (id: string) => {
    const link = `${window.location.origin}/link/questionnaire/${id}`
    setDirectLink(link)
  }

  const copyDirectLink = async () => {
    if (!directLink) return
    try {
      await navigator.clipboard.writeText(directLink)
      showToast('Direktlink kopiert.')
    } catch {
      showToast('Kopieren fehlgeschlagen. Link bitte manuell markieren und kopieren.')
    }
  }

  const downloadJson = (filename: string, value: unknown) => {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const exportQuestionnaire = async (id: string) => {
    const q = await api.getQuestionnaire(id)
    const filename = `${sanitizeFilename(q.title)}.json`
    downloadJson(filename, q)
    showToast('Fragebogen exportiert.')
  }

  const exportPrefillTemplateExcel = async (id: string) => {
    try {
      const questionnaire = await api.getQuestionnaire(id)
      const prefillRows: Array<Record<string, string | number>> = []
      const catalogRows: Array<Record<string, string | number>> = []
      const optionRows: Array<Record<string, string | number>> = []

      for (const section of questionnaire.sections ?? []) {
        for (const question of section.questions ?? []) {
          const options = getOptionsForQuestion(question)
          const optionValues = options.map((row) => row.optionValue).filter(Boolean).join(' | ')
          const optionLabels = options.map((row) => row.optionLabel).filter(Boolean).join(' | ')
          const supportsMulti =
            question.type === 'multi' ||
            question.type === 'ranking' ||
            (question.type === 'object_picker' && question.objectPickerAllowMultiple)
          const answerFormat = supportsMulti ? 'value1|value2|value3' : 'single_value'

          catalogRows.push({
            questionnaire_id: questionnaire.id,
            questionnaire_title: questionnaire.title,
            questionnaire_version: questionnaire.version ?? 1,
            section_id: section.id,
            section_title: section.title ?? '',
            question_id: question.id,
            question_type: question.type,
            question_title: question.title ?? '',
            required: toYesNo(!!question.required),
            allow_custom_options: toYesNo(!!question.allowCustomOptions),
            answer_format: answerFormat,
            possible_option_count: options.length,
            possible_option_values: optionValues,
            possible_option_labels: optionLabels,
            question_description: question.description ?? '',
          })

          prefillRows.push({
            questionnaire_id: questionnaire.id,
            questionnaire_title: questionnaire.title,
            questionnaire_version: questionnaire.version ?? 1,
            section_id: section.id,
            section_title: section.title ?? '',
            question_id: question.id,
            question_type: question.type,
            question_title: question.title ?? '',
            required: toYesNo(!!question.required),
            answer: '',
            answer_reason: '',
            custom_options_json: '',
            object_meta_json: '',
            allowed_option_values: optionValues,
            allowed_option_labels: optionLabels,
            answer_hint: answerFormat,
          })

          if (options.length === 0) {
            optionRows.push({
              questionnaire_id: questionnaire.id,
              section_id: section.id,
              question_id: question.id,
              question_type: question.type,
              question_title: question.title ?? '',
              option_value: '',
              option_label: 'Freie Eingabe / dynamische Optionen',
              option_source: 'free_or_dynamic',
              requires_reason: 'false',
            })
          } else {
            options.forEach((opt) => {
              optionRows.push({
                questionnaire_id: questionnaire.id,
                section_id: section.id,
                question_id: question.id,
                question_type: question.type,
                question_title: question.title ?? '',
                option_value: opt.optionValue,
                option_label: opt.optionLabel,
                option_source: opt.optionSource,
                requires_reason: opt.requiresReason,
              })
            })
          }
        }
      }

      const workbook = XLSX.utils.book_new()
      const prefillSheet = XLSX.utils.json_to_sheet(prefillRows)
      const catalogSheet = XLSX.utils.json_to_sheet(catalogRows)
      const optionsSheet = XLSX.utils.json_to_sheet(optionRows)
      XLSX.utils.book_append_sheet(workbook, prefillSheet, 'prefill_input')
      XLSX.utils.book_append_sheet(workbook, catalogSheet, 'question_catalog')
      XLSX.utils.book_append_sheet(workbook, optionsSheet, 'options')

      const baseName = sanitizeFilename(questionnaire.title)
      const version = questionnaire.version ?? 1
      XLSX.writeFile(workbook, `prefill_template_${baseName}_v${version}.xlsx`)
      showToast('Vorbefuellungsvorlage exportiert.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Export fehlgeschlagen.'
      showToast(message)
    }
  }

  const exportPrefillTemplateExcelMinimal = async (id: string) => {
    try {
      const questionnaire = await api.getQuestionnaire(id)
      const minimalRows: Array<Record<string, string | number>> = []

      for (const section of questionnaire.sections ?? []) {
        for (const question of section.questions ?? []) {
          minimalRows.push({
            question_id: question.id,
            answer: '',
            answer_reason: '',
            object_meta_json: '',
            custom_options_json: '',
          })
        }
      }

      const workbook = XLSX.utils.book_new()
      const prefillSheet = XLSX.utils.json_to_sheet(minimalRows)
      const helpSheet = XLSX.utils.json_to_sheet([
        {
          field: 'question_id',
          description: 'Muss exakt der Frage-ID entsprechen (nicht aendern).',
        },
        {
          field: 'answer',
          description:
            'Antwortwert. Bei Mehrfachantworten mit | trennen, z.B. value1|value2.',
        },
        {
          field: 'answer_reason',
          description: 'Optional: Begruendungstext.',
        },
        {
          field: 'object_meta_json',
          description: 'Optional: JSON-Objekt als Text, z.B. {"owner":"Max"}.',
        },
        {
          field: 'custom_options_json',
          description: 'Optional: JSON-Array eigener Optionen, z.B. ["Option A","Option B"].',
        },
      ])

      XLSX.utils.book_append_sheet(workbook, prefillSheet, 'prefill_minimal')
      XLSX.utils.book_append_sheet(workbook, helpSheet, 'hinweise')

      const baseName = sanitizeFilename(questionnaire.title)
      const version = questionnaire.version ?? 1
      XLSX.writeFile(workbook, `prefill_minimal_${baseName}_v${version}.xlsx`)
      showToast('Minimale Vorbefuellungsvorlage exportiert.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Export fehlgeschlagen.'
      showToast(message)
    }
  }

  const exportAllQuestionnaires = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      questionnaires: list,
    }
    downloadJson('fragebogen-export-alle.json', payload)
    showToast('Alle Fragebogen exportiert.')
  }

  const normalizeImportedQuestionnaires = (value: unknown): Questionnaire[] => {
    if (Array.isArray(value)) return value as Questionnaire[]
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>
      if (Array.isArray(obj.questionnaires)) return obj.questionnaires as Questionnaire[]
      if (Array.isArray((obj as any).sections) && typeof obj.title === 'string') {
        return [obj as unknown as Questionnaire]
      }
    }
    return []
  }

  const importQuestionnairesFromFile = async (file: File) => {
    setImporting(true)
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      const items = normalizeImportedQuestionnaires(parsed)
      if (items.length === 0) {
        showToast('Keine gueltigen Fragebogen im JSON gefunden.')
        return
      }

      let success = 0
      const failed: string[] = []
      for (const item of items) {
        try {
          if (!item.title || !Array.isArray(item.sections)) {
            failed.push(item.title || '(ohne Titel)')
            continue
          }
          await api.createQuestionnaire({
            id: item.id ?? '',
            title: item.title,
            subtitle: item.subtitle,
            sections: item.sections,
            allowMultipleSubmissions: !!item.allowMultipleSubmissions,
            globalForAllUsers: !!item.globalForAllUsers,
            status: item.status ?? 'DRAFT',
            activeFrom: item.activeFrom ?? null,
            activeTo: item.activeTo ?? null,
            adminAccessMode: item.adminAccessMode ?? 'OWNER_AND_GROUP',
            version: item.version ?? 1,
          } as Questionnaire)
          success += 1
        } catch {
          failed.push(item.title || '(ohne Titel)')
        }
      }

      await load()
      if (failed.length === 0) {
        showToast(`Import erfolgreich (${success}).`)
      } else {
        showToast(`Import teilweise erfolgreich (${success}), Fehler: ${failed.length}.`)
      }
    } catch {
      showToast('Import fehlgeschlagen. Bitte gueltige JSON-Datei verwenden.')
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-6">
      <Toast message={toastMessage} visible={toastVisible} />
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-[var(--color-foreground)]">
          Fragebogen
        </h2>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) importQuestionnairesFromFile(file)
            }}
          />
          <Button
            variant="outline"
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
          >
            JSON importieren
          </Button>
          <Button variant="outline" onClick={exportAllQuestionnaires} disabled={list.length === 0}>
            Alle als JSON
          </Button>
          <Button asChild>
            <Link to="/admin/questionnaires/new">Neuer Fragebogen</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-3 pt-6 md:grid-cols-2 xl:grid-cols-7">
          <Input
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filter nach Name, Untertitel, ID"
          />
          <Select
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as 'ALL' | 'DRAFT' | 'PUBLISHED')}
          >
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Alle Status</SelectItem>
              <SelectItem value="DRAFT">Entwurf</SelectItem>
              <SelectItem value="PUBLISHED">Veroeffentlicht</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={globalFilter}
            onValueChange={(value) => setGlobalFilter(value as 'ALL' | 'GLOBAL' | 'NON_GLOBAL')}
          >
            <SelectTrigger>
              <SelectValue placeholder="Global" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Global: egal</SelectItem>
              <SelectItem value="GLOBAL">Nur global</SelectItem>
              <SelectItem value="NON_GLOBAL">Nur nicht-global</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={multipleFilter}
            onValueChange={(value) => setMultipleFilter(value as 'ALL' | 'MULTI' | 'SINGLE')}
          >
            <SelectTrigger>
              <SelectValue placeholder="Mehrfachdurchfuehrung" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Mehrfach: egal</SelectItem>
              <SelectItem value="MULTI">Nur mehrfach</SelectItem>
              <SelectItem value="SINGLE">Nur einmalig</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={updatedFilter}
            onValueChange={(value) => setUpdatedFilter(value as 'ALL' | '7' | '30' | '90' | '365')}
          >
            <SelectTrigger>
              <SelectValue placeholder="Letzte Aenderung" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Aenderung: egal</SelectItem>
              <SelectItem value="7">Geaendert letzte 7 Tage</SelectItem>
              <SelectItem value="30">Geaendert letzte 30 Tage</SelectItem>
              <SelectItem value="90">Geaendert letzte 90 Tage</SelectItem>
              <SelectItem value="365">Geaendert letzte 365 Tage</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={sortBy}
            onValueChange={(value) => setSortBy(value as 'title' | 'status' | 'updatedAt' | 'createdAt')}
          >
            <SelectTrigger>
              <SelectValue placeholder="Sortieren nach" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="title">Sortierung: Name</SelectItem>
              <SelectItem value="status">Sortierung: Status</SelectItem>
              <SelectItem value="updatedAt">Sortierung: Letzte Aenderung</SelectItem>
              <SelectItem value="createdAt">Sortierung: Erstellungsdatum</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={sortDirection}
            onValueChange={(value) => setSortDirection(value as 'asc' | 'desc')}
          >
            <SelectTrigger>
              <SelectValue placeholder="Richtung" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="asc">Aufsteigend</SelectItem>
              <SelectItem value="desc">Absteigend</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <p className="text-xs text-[var(--color-muted)]">
        Angezeigt: {filteredAndSortedList.length} von {list.length}
      </p>

      <ul className="space-y-4">
        {filteredAndSortedList.map((q) => {
          const lockedByOther =
            !!q.editorLock?.userId && !!user?.id && q.editorLock.userId !== user.id
          return (
            <li key={q.id}>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div>
                  <h3 className="font-medium">{q.title}</h3>
                  <p className="text-xs text-[var(--color-muted)]">
                    Status: {q.status === 'PUBLISHED' ? 'Veroeffentlicht' : 'Entwurf'} | Version:{' '}
                    {q.version ?? 1}
                  </p>
                  <p className="text-xs text-[var(--color-muted)]">
                    Letzte Aenderung: {formatDate(q.updatedAt)}
                  </p>
                  <p className="text-xs text-[var(--color-muted)]">
                    Mehrfachdurchfuehrung: {q.allowMultipleSubmissions ? 'Ja' : 'Nein'}
                  </p>
                  <p className="text-xs text-[var(--color-muted)]">
                    Admin-Bearbeitung:{' '}
                    {q.adminAccessMode === 'OWNER_ONLY'
                      ? 'Nur Ersteller'
                      : 'Ersteller + gleiche Benutzergruppe'}
                  </p>
                  {q.globalForAllUsers && (
                    <p className="text-xs text-[var(--color-muted)]">
                      Global: Fuer alle angemeldeten Benutzer sichtbar
                    </p>
                  )}
                  {q.editorLock?.userId && (
                    <p className="text-xs text-[var(--color-required)]">
                      Gesperrt durch Bearbeiter {q.editorLock.userEmail ?? q.editorLock.userId}
                      {q.editorLock.expiresAt
                        ? ` (bis ${new Date(q.editorLock.expiresAt).toLocaleTimeString('de-DE')})`
                        : ''}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <a href={`/umfrage/${q.id}`} target="_blank" rel="noopener noreferrer">
                      Oeffnen
                    </a>
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => handleDuplicate(q.id)}>
                    Duplizieren
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openDirectLinkDialog(q.id)}>
                    Direktlink
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => exportQuestionnaire(q.id)}
                  >
                    Export JSON
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => exportPrefillTemplateExcel(q.id)}
                  >
                    Export Prefill Excel
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => exportPrefillTemplateExcelMinimal(q.id)}
                  >
                    Export Prefill Minimal
                  </Button>
                  {lockedByOther ? (
                    <Button variant="outline" size="sm" disabled>
                      Gesperrt
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" asChild>
                      <Link to={`/admin/questionnaires/${q.id}/edit`}>Bearbeiten</Link>
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setDeleteId(q.id)}
                  >
                    Loeschen
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {q.subtitle && (
                  <p className="text-sm text-[var(--color-muted)]">{q.subtitle}</p>
                )}
                <p className="mt-1 text-sm text-[var(--color-muted)]">
                  {q.sections.length} Sektion{q.sections.length !== 1 ? 'en' : ''},{' '}
                  {q.sections.reduce((n, s) => n + s.questions.length, 0)} Fragen
                </p>
                {q.stats && (
                  <div className="mt-2 space-y-1 text-xs text-[var(--color-muted)]">
                    <p>
                      Zugeordnet: {q.stats.objectCount} Objekte | {q.stats.objectGroupCount} Objektgruppen |{' '}
                      {q.stats.personCount} Personen
                    </p>
                    <p>
                      Umfragen: Offen {q.stats.openCount} | Abgeschlossen {q.stats.completedCount} | Gesamt{' '}
                      {q.stats.totalTaskCount}
                    </p>
                    <p>
                      Zuordnungstypen:{' '}
                      {q.stats.assignmentTypes.length > 0
                        ? q.stats.assignmentTypes
                            .map((entry) => `${entry.frequency}: ${entry.count}`)
                            .join(' | ')
                        : '-'}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
            </li>
          )
        })}
        {filteredAndSortedList.length === 0 && (
          <li>
            <Card>
              <CardContent className="pt-6 text-sm text-[var(--color-muted)]">
                Keine Frageboegen fuer die aktuellen Filter gefunden.
              </CardContent>
            </Card>
          </li>
        )}
      </ul>

      <AlertDialog
        open={!!deleteId}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteId(null)
            setDeleteResults(true)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fragebogen loeschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Soll beim Loeschen auch die Ergebnis-Historie entfernt werden?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-center gap-2 text-sm text-[var(--color-foreground)]">
            <input
              type="checkbox"
              checked={deleteResults}
              onChange={(e) => setDeleteResults(e.target.checked)}
            />
            Ergebnisse ebenfalls loeschen
          </label>
          {!deleteResults && (
            <p className="text-xs text-[var(--color-muted)]">
              Der Fragebogen wird archiviert und in Listen ausgeblendet. Ergebnisse bleiben in
              der Ergebnisansicht erhalten.
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--color-required)] hover:opacity-90"
              onClick={() => deleteId && handleDelete(deleteId)}
            >
              Loeschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!directLink} onOpenChange={(open) => !open && setDirectLink(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Direktlink</AlertDialogTitle>
            <AlertDialogDescription>
              Link kann markiert und manuell kopiert werden. Alternativ den Kopieren-Button nutzen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Input
              readOnly
              value={directLink ?? ''}
              onFocus={(e) => e.target.select()}
              onClick={(e) => e.currentTarget.select()}
            />
            {directLink && (
              <a
                href={directLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[var(--color-primary)] underline"
              >
                Link öffnen
              </a>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Schließen</AlertDialogCancel>
            <Button onClick={copyDirectLink}>Kopieren</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
