import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import { api, type SubmissionRecord } from '../../lib/api'
import { Card, CardContent, CardHeader } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import type { Question, Questionnaire } from '../../types/questionnaire'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import { Toast, useToast } from '../../components/ui/toast'
import { decodeCustomOptionValue, isCustomOptionValue } from '../../lib/custom-options'

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString('de-DE')
  } catch {
    return iso
  }
}

type ExportRow = {
  ObjektId: string
  ObjektName: string
  FragebogenId: string
  FragebogenTitel: string
  FragebogenVersion: number
  SubmissionId: string
  EingereichtAm: string
  BenutzerEmail: string
  BenutzerUserID: string
  SegmentIndex: number
  SegmentId: string
  SegmentTitel: string
  FrageIndex: number
  FrageId: string
  FrageTitel: string
  FrageTyp: string
  AntwortIndex: number
  AntwortId: string
  AntwortLabel: string
  Begruendung: string
}

export function ResultsPage() {
  const [questionnaires, setQuestionnaires] = useState<Questionnaire[]>([])
  const [submissionsByQuestionnaire, setSubmissionsByQuestionnaire] = useState<
    Map<string, SubmissionRecord[]>
  >(new Map())
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest')
  const [objectLabelById, setObjectLabelById] = useState<Map<string, { objectId: string; objectName: string }>>(
    new Map()
  )

  const { message: toastMessage, visible: toastVisible, showToast } = useToast()

  useEffect(() => {
    let isMounted = true
    api
      .listQuestionnaires({ includeDeleted: true })
      .then(async (qs) => {
        if (!isMounted) return
        setQuestionnaires(qs)
        const [entries, objects] = await Promise.all([
          Promise.all(qs.map(async (q) => [q.id, await api.listSubmissions(q.id)] as const)),
          api.listObjects(),
        ])
        if (!isMounted) return
        setSubmissionsByQuestionnaire(new Map(entries))
        const objectMap = new Map<string, { objectId: string; objectName: string }>()
        objects.forEach((obj) => {
          const objectId = obj.externalId?.trim() || obj.id
          const objectName = obj.name?.trim() || obj.id
          objectMap.set(obj.id, { objectId, objectName })
          if (obj.externalId?.trim()) {
            objectMap.set(obj.externalId.trim(), { objectId, objectName })
          }
        })
        setObjectLabelById(objectMap)
      })
      .finally(() => {
        if (isMounted) setLoading(false)
      })
    return () => {
      isMounted = false
    }
  }, [])

  const getObjectLabel = (value: unknown) => {
    const key = String(value ?? '').trim()
    if (!key) return '-'
    const found = objectLabelById.get(key)
    if (!found) return key
    return `${found.objectId} - ${found.objectName}`
  }

  const getAnswerText = (question: Question, value: unknown) => {
    const normalize = (val: unknown): string => {
      if (val === undefined || val === null || val === '') return '-'
      if (typeof val === 'object') {
        const obj = val as { label?: string; value?: string }
        if (obj.label) return obj.label
        if (obj.value) return obj.value
      }
      return String(val)
    }

    if (question.type === 'object_picker') {
      if (Array.isArray(value)) {
        if (value.length === 0) return '-'
        return value.map((entry) => getObjectLabel(entry)).join(', ')
      }
      return getObjectLabel(value)
    }
    if (question.type === 'assignment_picker') {
      if (typeof value !== 'string' || !value.trim()) return '-'
      try {
        const parsed = JSON.parse(value) as Record<string, unknown>
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '-'
        const optionMap = new Map((question.assignmentOptions ?? []).map((opt) => [opt.id, opt]))
        const lines: string[] = []
        Object.entries(parsed).forEach(([optionId, rawEntry]) => {
          const option = optionMap.get(optionId)
          const label = option?.label || optionId
          if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) return
          const valuesRaw = (rawEntry as { values?: unknown }).values
          const values = Array.isArray(valuesRaw)
            ? valuesRaw.map((entry) => String(entry ?? '').trim()).filter(Boolean)
            : []
          const rendered = values
            .map((entry) => (option?.targetType === 'object' ? getObjectLabel(entry) : entry))
            .join(', ')
          lines.push(`${label}: ${rendered || '-'}`)
        })
        return lines.length > 0 ? lines.join(' | ') : '-'
      } catch {
        return '-'
      }
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

  const normalizeDisplayFallback = (value: unknown): string | null => {
    if (typeof value !== 'string') return null
    const normalized = value.trim()
    if (!normalized) return null
    // Legacy placeholder variants (encoding issue around em dash)
    if (
      normalized === '-' ||
      normalized === '—' ||
      normalized === 'Ã¢â‚¬â€' ||
      normalized === 'â€”'
    ) {
      return null
    }
    return normalized
  }

  const getQuestionnaireForSubmission = (questionnaire: Questionnaire, submission: SubmissionRecord) => {
    const snapshot = submission.questionnaireSnapshot
    if (snapshot && Array.isArray(snapshot.sections)) {
      return {
        id: snapshot.id || questionnaire.id,
        title: snapshot.title || questionnaire.title,
        sections: snapshot.sections as Questionnaire['sections'],
        version: snapshot.version || submission.questionnaireVersion || questionnaire.version || 1,
      }
    }
    return {
      id: questionnaire.id,
      title: questionnaire.title,
      sections: questionnaire.sections,
      version: submission.questionnaireVersion || questionnaire.version || 1,
    }
  }

  const buildRowsForSubmission = (questionnaire: Questionnaire, submission: SubmissionRecord): ExportRow[] => {
    const source = getQuestionnaireForSubmission(questionnaire, submission)
    const submittedAt = formatDate(submission.submittedAt)
    const userEmail = submission.user?.email ?? '-'
    const userExternalId = submission.user?.externalId ?? '-'
    const objectId = submission.objectTask?.object?.externalId || submission.objectTask?.object?.id || '-'
    const objectName = submission.objectTask?.object?.name || '-'
    const rows: ExportRow[] = []

    source.sections.forEach((section, sIndex) => {
      section.questions.forEach((question, qIndex) => {
        const value = submission.answers[question.id]
        const reason = submission.answers[`${question.id}__reason`]
        const reasonText = typeof reason === 'string' && reason.trim() ? reason.trim() : '-'

        if (Array.isArray(value)) {
          if (value.length === 0) {
            rows.push({
              ObjektId: objectId,
              ObjektName: objectName,
              FragebogenId: source.id,
              FragebogenTitel: source.title,
              FragebogenVersion: source.version,
              SubmissionId: submission.id,
              EingereichtAm: submittedAt,
              BenutzerEmail: userEmail,
              BenutzerUserID: userExternalId,
              SegmentIndex: sIndex + 1,
              SegmentId: section.id,
              SegmentTitel: section.title,
              FrageIndex: qIndex + 1,
              FrageId: question.id,
              FrageTitel: question.title || question.id,
              FrageTyp: question.type,
              AntwortIndex: 1,
              AntwortId: '-',
              AntwortLabel: '-',
              Begruendung: reasonText,
            })
            return
          }
          value.forEach((entry, vIndex) => {
            const mappedObject = question.type === 'object_picker'
              ? objectLabelById.get(String(entry ?? '').trim())
              : null
            const opt = question.options?.find((o) => o.value === entry)
            rows.push({
              ObjektId: objectId,
              ObjektName: objectName,
              FragebogenId: source.id,
              FragebogenTitel: source.title,
              FragebogenVersion: source.version,
              SubmissionId: submission.id,
              EingereichtAm: submittedAt,
              BenutzerEmail: userEmail,
              BenutzerUserID: userExternalId,
              SegmentIndex: sIndex + 1,
              SegmentId: section.id,
              SegmentTitel: section.title,
              FrageIndex: qIndex + 1,
              FrageId: question.id,
              FrageTitel: question.title || question.id,
              FrageTyp: question.type,
              AntwortIndex: vIndex + 1,
              AntwortId:
                question.type === 'object_picker'
                  ? mappedObject?.objectId ?? String(entry ?? '-')
                  : isCustomOptionValue(entry)
                    ? 'custom'
                    : String(opt?.value ?? entry ?? '-'),
              AntwortLabel:
                question.type === 'object_picker'
                  ? mappedObject
                    ? `${mappedObject.objectId} - ${mappedObject.objectName}`
                    : String(entry ?? '-')
                  : getAnswerText(question, [entry]),
              Begruendung: reasonText,
            })
          })
          return
        }

        let answerId = '-'
        let answerLabel = '-'
        if (value !== undefined && value !== null && value !== '') {
          if (question.type === 'assignment_picker') {
            answerId = '-'
            answerLabel = getAnswerText(question, value)
          } else if (question.type === 'single' && question.options?.length) {
            const opt = question.options.find((o) => o.value === value)
            const custom = decodeCustomOptionValue(value)
            answerId = custom ? 'custom' : String(opt?.value ?? value)
            answerLabel = opt?.label ?? (custom ? `${custom} (added)` : String(value))
          } else if (typeof value === 'boolean') {
            answerId = value ? 'true' : 'false'
            answerLabel = value ? 'Ja' : 'Nein'
          } else {
            answerId = String(value)
            answerLabel = getAnswerText(question, value)
          }
        }
        if (answerLabel === '-') {
          const fallback = normalizeDisplayFallback(submission.displayAnswers?.[question.id])
          if (fallback) answerLabel = fallback
        }

        rows.push({
          ObjektId: objectId,
          ObjektName: objectName,
          FragebogenId: source.id,
          FragebogenTitel: source.title,
          FragebogenVersion: source.version,
          SubmissionId: submission.id,
          EingereichtAm: submittedAt,
          BenutzerEmail: userEmail,
          BenutzerUserID: userExternalId,
          SegmentIndex: sIndex + 1,
          SegmentId: section.id,
          SegmentTitel: section.title,
          FrageIndex: qIndex + 1,
          FrageId: question.id,
          FrageTitel: question.title || question.id,
          FrageTyp: question.type,
          AntwortIndex: 1,
          AntwortId: answerId,
          AntwortLabel: answerLabel,
          Begruendung: reasonText,
        })
      })
    })

    return rows
  }

  const exportSubmission = (questionnaire: Questionnaire, submission: SubmissionRecord) => {
    const rows = buildRowsForSubmission(questionnaire, submission)
    const sheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'Ergebnisse')
    const safeTitle = questionnaire.title.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 48)
    const fileName = `${safeTitle || 'umfrage'}-${submission.id.slice(0, 8)}.xlsx`
    XLSX.writeFile(workbook, fileName)
    showToast('Excel exportiert.')
  }

  const exportSubmissionPdf = (questionnaire: Questionnaire, submission: SubmissionRecord) => {
    const source = getQuestionnaireForSubmission(questionnaire, submission)
    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const margin = 12
    const contentWidth = pageWidth - margin * 2
    let y = margin

    const ensureSpace = (needed = 6) => {
      if (y + needed > pageHeight - margin) {
        doc.addPage()
        y = margin
      }
    }

    const writeLine = (text: string, size = 10, gap = 5) => {
      ensureSpace(gap)
      doc.setFontSize(size)
      const lines = doc.splitTextToSize(text, contentWidth)
      lines.forEach((line: string) => {
        ensureSpace(gap)
        doc.text(line, margin, y)
        y += gap
      })
    }

    doc.setFontSize(14)
    doc.text(`Ergebnis: ${source.title} (v${source.version ?? 1})`, margin, y)
    y += 7
    writeLine(`Submission: ${submission.id}`, 9, 4.5)
    writeLine(`Eingereicht: ${formatDate(submission.submittedAt)}`, 9, 4.5)
    writeLine(`Benutzer: ${submission.user?.email ?? '-'} | UserID: ${submission.user?.externalId ?? '-'}`, 9, 4.5)
    y += 2

    source.sections.forEach((section) => {
      ensureSpace(8)
      doc.setFontSize(11)
      doc.text(section.title || section.id, margin, y)
      y += 6
      section.questions.forEach((question) => {
        const base = getAnswerText(question, submission.answers[question.id])
        const answer =
          base === '-' && submission.displayAnswers?.[question.id]
            ? submission.displayAnswers[question.id]
            : base
        writeLine(`Frage: ${question.title || question.id}`, 9, 4.5)
        writeLine(`Antwort: ${answer}`, 9, 4.5)
        const reason = submission.answers[`${question.id}__reason`]
        if (typeof reason === 'string' && reason.trim()) {
          writeLine(`Begruendung: ${reason.trim()}`, 9, 4.5)
        }
        y += 1
      })
      y += 2
    })

    const safeTitle = source.title.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 48)
    doc.save(`${safeTitle || 'umfrage'}-${submission.id.slice(0, 8)}.pdf`)
    showToast('PDF exportiert.')
  }

  const exportAllSubmissions = () => {
    const rows: ExportRow[] = []
    questionnaires.forEach((q) => {
      const list = submissionsByQuestionnaire.get(q.id) ?? []
      list.forEach((s) => {
        rows.push(...buildRowsForSubmission(q, s))
      })
    })
    if (rows.length === 0) {
      showToast('Keine Daten fuer Export vorhanden.')
      return
    }
    const sheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'Alle_Ergebnisse')
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16)
    XLSX.writeFile(workbook, `umfrage-gesamtuebersicht-${stamp}.xlsx`)
    showToast('Gesamtexport erstellt.')
  }

  const exportQuestionnaireAllSubmissions = (questionnaire: Questionnaire, list: SubmissionRecord[]) => {
    const rows: ExportRow[] = []
    list.forEach((s) => {
      rows.push(...buildRowsForSubmission(questionnaire, s))
    })
    if (rows.length === 0) {
      showToast('Keine Daten fuer diesen Fragebogen vorhanden.')
      return
    }
    const sheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'Fragebogen_Ergebnisse')
    const safeTitle = questionnaire.title.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 48)
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16)
    XLSX.writeFile(workbook, `${safeTitle || 'fragebogen'}-alle-versionen-${stamp}.xlsx`)
    showToast('Fragebogen-Gesamtexport erstellt.')
  }

  const sortSubmissions = (list: SubmissionRecord[]) => {
    const sorted = [...list]
    sorted.sort((a, b) => {
      const aTime = new Date(a.submittedAt).getTime()
      const bTime = new Date(b.submittedAt).getTime()
      return sortOrder === 'newest' ? bTime - aTime : aTime - bTime
    })
    return sorted
  }

  const hasAny = useMemo(
    () => Array.from(submissionsByQuestionnaire.values()).some((list) => list.length > 0),
    [submissionsByQuestionnaire]
  )

  const handleDelete = async () => {
    if (!deleteId) return
    await api.deleteSubmission(deleteId)
    const updated = new Map(submissionsByQuestionnaire)
    updated.forEach((list, key) => {
      updated.set(
        key,
        list.filter((s) => s.id !== deleteId)
      )
    })
    setSubmissionsByQuestionnaire(updated)
    setDeleteId(null)
    showToast('Ergebnis geloescht.')
  }

  if (loading) {
    return <div className="text-[var(--color-muted)]">Laden...</div>
  }

  return (
    <div className="space-y-6">
      <Toast message={toastMessage} visible={toastVisible} />
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-[var(--color-foreground)]">Ergebnisse</h2>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
            <span>Sortierung</span>
            <Select value={sortOrder} onValueChange={(value) => setSortOrder(value as typeof sortOrder)}>
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Neueste zuerst</SelectItem>
                <SelectItem value="oldest">Aelteste zuerst</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="sm" onClick={() => { window.location.reload(); showToast('Ansicht aktualisiert.') }}>
            Aktualisieren
          </Button>
          <Button variant="default" size="sm" onClick={exportAllSubmissions} disabled={!hasAny}>
            Gesamt-Excel
          </Button>
        </div>
      </div>

      {!hasAny && (
        <Card>
          <CardContent className="py-6 text-sm text-[var(--color-muted)]">
            Noch keine Antworten gespeichert.
          </CardContent>
        </Card>
      )}

      {questionnaires.map((q) => {
        const list = sortSubmissions(submissionsByQuestionnaire.get(q.id) ?? [])
        return (
          <Card key={q.id}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div>
                <h3 className="font-medium">
                  {q.title} (v{q.version ?? 1})
                  {q.deletedAt ? ' [Archiviert]' : ''}
                </h3>
                {q.subtitle && (
                  <p className="text-sm text-[var(--color-muted)]">{q.subtitle}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--color-muted)]">
                  {list.length} Antwort{list.length !== 1 ? 'en' : ''}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => exportQuestionnaireAllSubmissions(q, list)}
                  disabled={list.length === 0}
                >
                  Excel (alle Versionen)
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {list.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">
                  Keine Antworten fuer diesen Fragebogen.
                </p>
              ) : (
                <div className="space-y-3">
                  {list.map((s, index) => {
                    const isOpen = expandedId === s.id
                    return (
                      <div
                        key={s.id}
                        className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white"
                      >
                        <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                          <button
                            type="button"
                            onClick={() => setExpandedId(isOpen ? null : s.id)}
                            className="flex flex-1 items-center justify-between text-left"
                          >
                            <div>
                              <div className="text-[var(--color-foreground)]">
                                Ergebnis #{index + 1} (v{s.questionnaireVersion ?? q.version ?? 1})
                              </div>
                              <div className="text-xs text-[var(--color-muted)]">
                                Eingang: {formatDate(s.submittedAt)} | Benutzer: {s.user?.email ?? '-'}
                              </div>
                            </div>
                            <span className="text-xs text-[var(--color-muted)]">
                              {isOpen ? 'Schliessen' : 'Anzeigen'}
                            </span>
                          </button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => exportSubmission(q, s)}
                          >
                            Excel exportieren
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => exportSubmissionPdf(q, s)}
                          >
                            PDF exportieren
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const url = `/admin/results/view?questionnaireId=${encodeURIComponent(
                                q.id
                              )}&submissionId=${encodeURIComponent(s.id)}`
                              window.open(url, '_blank', 'noopener,noreferrer')
                            }}
                          >
                            Originaldesign (readonly)
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const url = `/admin/results/view?questionnaireId=${encodeURIComponent(
                                q.id
                              )}&submissionId=${encodeURIComponent(s.id)}&autoprint=1`
                              window.open(url, '_blank', 'noopener,noreferrer')
                            }}
                          >
                            Originaldesign als PDF
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            asChild
                          >
                            <Link to={`/admin/jira?questionnaireId=${q.id}&submissionId=${s.id}`}>
                              Jira Ticket
                            </Link>
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={() => setDeleteId(s.id)}
                          >
                            Loeschen
                          </Button>
                        </div>
                        {isOpen && (
                          <div className="border-t border-[var(--color-border)] p-4 text-sm">
                            <div className="space-y-4">
                              {getQuestionnaireForSubmission(q, s).sections.map((section) => (
                                <div key={section.id} className="space-y-2">
                                  <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]">
                                    {section.title}
                                  </div>
                                  <div className="space-y-1">
                                    {section.questions.map((question) => {
                                      const formatted = (() => {
                                        const base = getAnswerText(question, s.answers[question.id])
                                        return base === '-' && s.displayAnswers?.[question.id]
                                          ? s.displayAnswers[question.id]
                                          : base
                                      })()
                                      const reason = s.answers[`${question.id}__reason`]
                                      return (
                                        <div key={question.id} className="space-y-1">
                                          <div className="flex flex-wrap gap-2">
                                            <span className="min-w-[180px] font-medium text-[var(--color-foreground)]">
                                              {question.title || question.id}
                                            </span>
                                            <span className="text-[var(--color-muted)]">
                                              {formatted}
                                            </span>
                                          </div>
                                          {typeof reason === 'string' && reason.trim() !== '' && (
                                            <div className="flex flex-wrap gap-2 text-xs text-[var(--color-muted)]">
                                              <span className="min-w-[180px] font-medium">
                                                Begruendung
                                              </span>
                                              <span>{reason}</span>
                                            </div>
                                          )}
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ergebnis loeschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Diese Aktion kann nicht rueckgaengig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--color-required)] hover:opacity-90"
              onClick={handleDelete}
            >
              Loeschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
