import { useEffect, useMemo, useState } from 'react'
import { api, ApiError, type JiraMeta, type QuestionnaireJiraConfig, type QuestionnaireJiraConfigListItem } from '../../lib/api'
import type { Questionnaire } from '../../types/questionnaire'
import { Card, CardContent, CardHeader } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import { Toast, useToast } from '../../components/ui/toast'
import { RichTextEditor } from '../../components/admin/RichTextEditor'

function stringifyError(error: unknown) {
  if (error instanceof ApiError) {
    const payload =
      typeof error.data === 'object' && error.data !== null
        ? JSON.stringify(error.data, null, 2)
        : ''
    return `HTTP ${error.status}: ${error.message}${payload ? `\n${payload}` : ''}`
  }
  if (error instanceof Error) return error.message
  return String(error)
}

export function JiraConfigPage() {
  const [meta, setMeta] = useState<JiraMeta | null>(null)
  const [questionnaires, setQuestionnaires] = useState<Questionnaire[]>([])
  const [savedConfigs, setSavedConfigs] = useState<QuestionnaireJiraConfigListItem[]>([])
  const [selectedQuestionnaireId, setSelectedQuestionnaireId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [projectKey, setProjectKey] = useState('')
  const [issueType, setIssueType] = useState('Task')
  const [summaryTemplate, setSummaryTemplate] = useState('')
  const [includeSurveyTextInDescription, setIncludeSurveyTextInDescription] = useState(true)
  const [includeReadonlyLinkInDescription, setIncludeReadonlyLinkInDescription] = useState(false)
  const [descriptionIntroHtml, setDescriptionIntroHtml] = useState('')
  const [summaryQuestionId, setSummaryQuestionId] = useState('__none__')
  const [summaryPrefix, setSummaryPrefix] = useState('')
  const [summarySuffix, setSummarySuffix] = useState('')
  const [includeObjectInSummary, setIncludeObjectInSummary] = useState(false)
  const [includeObjectAsComponent, setIncludeObjectAsComponent] = useState(false)
  const [assignee, setAssignee] = useState('')
  const [contactPerson, setContactPerson] = useState('')
  const [contactPersonMode, setContactPersonMode] = useState<'STATIC' | 'SUBMITTER_USER_ID'>('STATIC')
  const [epicName, setEpicName] = useState('')
  const [componentsText, setComponentsText] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [autoCreateOnSubmission, setAutoCreateOnSubmission] = useState(false)
  const [attachExcelToIssue, setAttachExcelToIssue] = useState(false)
  const [attachPdfToIssue, setAttachPdfToIssue] = useState(false)

  const { message: toastMessage, visible: toastVisible, showToast } = useToast()
  const noResultOutputConfigured =
    !includeSurveyTextInDescription &&
    !includeReadonlyLinkInDescription &&
    !attachExcelToIssue &&
    !attachPdfToIssue

  const descriptionPreview = useMemo(() => {
    const htmlToText = (value: string) =>
      value
        .replace(/<\s*br\s*\/?>/gi, '\n')
        .replace(/<\s*\/p\s*>/gi, '\n\n')
        .replace(/<\s*\/div\s*>/gi, '\n')
        .replace(/<\s*li\s*>/gi, '\n- ')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .trim()

    const lines: string[] = []
    const introText = htmlToText(descriptionIntroHtml || '')
    if (introText) {
      lines.push(introText)
      lines.push('')
    }
    if (includeSurveyTextInDescription) {
      lines.push('h2. Umfrageergebnis')
      lines.push('*Fragebogen:* <Titel> (Version <Version>)')
      lines.push('*Eingereicht am:* <Datum>')
      lines.push('*Benutzer:* <E-Mail>')
      lines.push('*UserID:* <UserID>')
      lines.push('')
      lines.push('*Segment:* <Segmenttitel>')
      lines.push('*Frage:* <Fragetext>')
      lines.push('*Antwort:* <Antwort>')
      lines.push('*Begruendung:* <optional>')
    } else {
      lines.push('h2. Umfrageergebnis')
      lines.push('*Fragebogen:* <Titel> (Version <Version>)')
      lines.push('*Eingereicht am:* <Datum>')
      lines.push('*Benutzer:* <E-Mail>')
      lines.push('*UserID:* <UserID>')
      lines.push('*SubmissionId:* <SubmissionId>')
    }
    if (includeReadonlyLinkInDescription) {
      lines.push('')
      lines.push('*Readonly-Ergebnis:* <Link zur Readonly-Ansicht>')
    }
    return lines.join('\n').trim()
  }, [descriptionIntroHtml, includeReadonlyLinkInDescription, includeSurveyTextInDescription])

  const selectedQuestionnaire = useMemo(
    () => questionnaires.find((entry) => entry.id === selectedQuestionnaireId) ?? null,
    [questionnaires, selectedQuestionnaireId]
  )
  const summaryQuestions = useMemo(() => {
    if (!selectedQuestionnaire) return []
    return selectedQuestionnaire.sections.flatMap((section) =>
      section.questions
        .filter((question) => question.type !== 'info')
        .map((question) => ({
          id: question.id,
          label: `${section.title} - ${question.title || question.id}`,
        }))
    )
  }, [selectedQuestionnaire])

  const applyConfigToForm = (config: QuestionnaireJiraConfig, jiraMeta?: JiraMeta | null) => {
    setProjectKey(config.projectKey?.trim() || jiraMeta?.defaultProjectKey || '')
    setIssueType(config.issueType?.trim() || jiraMeta?.defaultIssueType || 'Task')
    setSummaryTemplate(config.summaryTemplate?.trim() || '')
    setIncludeSurveyTextInDescription(config.includeSurveyTextInDescription !== false)
    setIncludeReadonlyLinkInDescription(!!config.includeReadonlyLinkInDescription)
    setDescriptionIntroHtml(config.descriptionIntroHtml?.trim() || '')
    setSummaryQuestionId(config.summaryQuestionId?.trim() || '__none__')
    setSummaryPrefix(config.summaryPrefix?.trim() || '')
    setSummarySuffix(config.summarySuffix?.trim() || '')
    setIncludeObjectInSummary(!!config.includeObjectInSummary)
    setIncludeObjectAsComponent(!!config.includeObjectAsComponent)
    setAssignee(config.assignee?.trim() || '')
    setContactPerson(config.contactPerson?.trim() || '')
    setContactPersonMode(config.contactPersonMode === 'SUBMITTER_USER_ID' ? 'SUBMITTER_USER_ID' : 'STATIC')
    setEpicName(config.epicName?.trim() || '')
    setComponentsText((config.components?.length ? config.components : jiraMeta?.defaultComponents ?? []).join(', '))
    setDueDate(config.dueDate?.trim() || '')
    setAutoCreateOnSubmission(!!config.autoCreateOnSubmission)
    setAttachExcelToIssue(!!config.attachExcelToIssue)
    setAttachPdfToIssue(!!config.attachPdfToIssue)
  }

  const refreshSavedConfigs = async () => {
    const list = await api.listQuestionnaireJiraConfigs()
    setSavedConfigs(list)
  }

  useEffect(() => {
    let mounted = true
    Promise.all([api.jiraMeta(), api.listQuestionnaires({ includeDeleted: true }), api.listQuestionnaireJiraConfigs()])
      .then(([metaData, questionnaireList, configList]) => {
        if (!mounted) return
        setMeta(metaData)
        setQuestionnaires(questionnaireList)
        setSavedConfigs(configList)
        if (configList.length > 0) {
          setSelectedQuestionnaireId(configList[0].questionnaireId)
        } else if (questionnaireList.length > 0) {
          setSelectedQuestionnaireId(questionnaireList[0].id)
        }
      })
      .catch((error) => showToast(stringifyError(error)))
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!selectedQuestionnaireId) return
    api
      .getQuestionnaireJiraConfig(selectedQuestionnaireId)
      .then((config) => applyConfigToForm(config, meta))
      .catch((error) => showToast(stringifyError(error)))
  }, [selectedQuestionnaireId, meta])

  const saveConfig = async () => {
    if (!selectedQuestionnaireId) {
      showToast('Bitte einen Fragebogen auswaehlen.')
      return
    }
    setSaving(true)
    try {
      const updated = await api.updateQuestionnaireJiraConfig(selectedQuestionnaireId, {
        autoCreateOnSubmission,
        attachExcelToIssue,
        attachPdfToIssue,
        includeSurveyTextInDescription,
        includeReadonlyLinkInDescription,
        descriptionIntroHtml: descriptionIntroHtml.trim() || null,
        projectKey: projectKey.trim() || null,
        issueType: issueType.trim() || null,
        summaryTemplate: summaryTemplate.trim() || null,
        summaryQuestionId: summaryQuestionId === '__none__' ? null : summaryQuestionId,
        summaryPrefix: summaryPrefix.trim() || null,
        summarySuffix: summarySuffix.trim() || null,
        includeObjectInSummary,
        includeObjectAsComponent,
        assignee: assignee.trim() || null,
        contactPerson: contactPerson.trim() || null,
        contactPersonMode,
        epicName: epicName.trim() || null,
        components: componentsText
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean),
        dueDate: dueDate.trim() || null,
      })
      applyConfigToForm(updated, meta)
      await refreshSavedConfigs()
      showToast('Jira-Konfiguration gespeichert.')
    } catch (error) {
      showToast(stringifyError(error))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="text-[var(--color-muted)]">Laden...</div>
  }

  return (
    <div className="space-y-6">
      <Toast message={toastMessage} visible={toastVisible} />

      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-[var(--color-foreground)]">Jira-Konfig</h2>
      </div>

      <Card>
        <CardHeader>
          <h3 className="font-medium">Gespeicherte Konfigurationen</h3>
        </CardHeader>
        <CardContent className="space-y-2">
          {savedConfigs.length === 0 && (
            <p className="text-sm text-[var(--color-muted)]">Noch keine Jira-Konfiguration gespeichert.</p>
          )}
          {savedConfigs.map((item) => (
            <div
              key={item.questionnaireId}
              className="rounded border border-[var(--color-border)] bg-white px-3 py-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-[var(--color-foreground)]">
                    {item.questionnaireTitle}
                  </div>
                  <div className="text-xs text-[var(--color-muted)]">
                    Bereich: {item.projectKey || '-'} | Typ: {item.issueType || '-'} | Auto-Ticket:{' '}
                    {item.autoCreateOnSubmission ? 'Ja' : 'Nein'}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedQuestionnaireId(item.questionnaireId)}
                >
                  Bearbeiten
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="font-medium">Konfiguration bearbeiten</h3>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Fragebogen</Label>
            <Select value={selectedQuestionnaireId} onValueChange={setSelectedQuestionnaireId}>
              <SelectTrigger>
                <SelectValue placeholder="Fragebogen waehlen" />
              </SelectTrigger>
              <SelectContent>
                {questionnaires.map((q) => (
                  <SelectItem key={q.id} value={q.id}>
                    {q.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedQuestionnaire?.deletedAt && (
              <p className="text-xs text-[var(--color-muted)]">Hinweis: Dieser Fragebogen ist archiviert.</p>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Jira Bereich (Project Key)</Label>
              <Input value={projectKey} onChange={(e) => setProjectKey(e.target.value)} placeholder={meta?.defaultProjectKey || 'z. B. PIT'} />
            </div>
            <div className="space-y-2">
              <Label>Issue Type</Label>
              <Input value={issueType} onChange={(e) => setIssueType(e.target.value)} placeholder={meta?.defaultIssueType || 'Task'} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Summary-Template (optional)</Label>
            <Input
              value={summaryTemplate}
              onChange={(e) => setSummaryTemplate(e.target.value)}
              placeholder="{{questionnaireTitle}} - {{submittedAt}} - {{userEmail}}"
            />
            <div className="text-xs text-[var(--color-muted)]">
              Platzhalter: {`{{questionnaireTitle}}, {{submittedAt}}, {{userEmail}}, {{userExternalId}}, {{questionnaireVersion}}, {{submissionId}}`}
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Titel aus Frage/Antwort generieren</Label>
              <Select value={summaryQuestionId} onValueChange={setSummaryQuestionId}>
                <SelectTrigger>
                  <SelectValue placeholder="Keine" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Keine</SelectItem>
                  {summaryQuestions.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Titel: Praefix / Suffix</Label>
              <div className="grid grid-cols-2 gap-2">
                <Input value={summaryPrefix} onChange={(e) => setSummaryPrefix(e.target.value)} placeholder="Praefix" />
                <Input value={summarySuffix} onChange={(e) => setSummarySuffix(e.target.value)} placeholder="Suffix" />
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Zugeordneter Benutzer</Label>
              <Input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="z. B. vorname.nachname" />
            </div>
            <div className="space-y-2">
              <Label>Ansprechpartner</Label>
              <Input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} placeholder="z. B. ddawjk" />
            </div>
            <div className="space-y-2">
              <Label>Ansprechpartner-Quelle</Label>
              <Select value={contactPersonMode} onValueChange={(value) => setContactPersonMode(value as 'STATIC' | 'SUBMITTER_USER_ID')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="STATIC">Fester Ansprechpartner</SelectItem>
                  <SelectItem value="SUBMITTER_USER_ID">Durchfuehrer UserID</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Epic Name</Label>
              <Input value={epicName} onChange={(e) => setEpicName(e.target.value)} placeholder="z. B. Neuanlage..." />
            </div>
            <div className="space-y-2">
              <Label>Komponenten (Komma-getrennt)</Label>
              <Input value={componentsText} onChange={(e) => setComponentsText(e.target.value)} placeholder={(meta?.defaultComponents ?? []).join(', ')} />
            </div>
            <div className="space-y-2">
              <Label>Zieldatum (optional)</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Auto-Ticket bei Umfrage-Abgabe</Label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={autoCreateOnSubmission}
                  onChange={(e) => setAutoCreateOnSubmission(e.target.checked)}
                />
                Automatisch Jira Ticket erzeugen
              </label>
            </div>
            <div className="space-y-2">
              <Label>Anhang: Excel</Label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={attachExcelToIssue}
                  onChange={(e) => setAttachExcelToIssue(e.target.checked)}
                />
                Ergebnisse als Excel-Datei am Ticket anhaengen
              </label>
            </div>
            <div className="space-y-2">
              <Label>Anhang: PDF</Label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={attachPdfToIssue}
                  onChange={(e) => setAttachPdfToIssue(e.target.checked)}
                />
                Ergebnisse als PDF-Datei am Ticket anhaengen
              </label>
            </div>
            <div className="space-y-2">
              <Label>Beschreibung: Umfragetext</Label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeSurveyTextInDescription}
                  onChange={(e) => setIncludeSurveyTextInDescription(e.target.checked)}
                />
                Umfrageergebnisse direkt in Jira-Beschreibung anzeigen
              </label>
            </div>
            <div className="space-y-2">
              <Label>Beschreibung: Readonly-Link</Label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeReadonlyLinkInDescription}
                  onChange={(e) => setIncludeReadonlyLinkInDescription(e.target.checked)}
                />
                Link auf Readonly-Ergebnissicht in Jira-Beschreibung anzeigen
              </label>
            </div>
            <div className="space-y-2">
              <Label>Objekt in Jira-Titel</Label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeObjectInSummary}
                  onChange={(e) => setIncludeObjectInSummary(e.target.checked)}
                />
                Objekt-ID und Name im Titel ergaenzen (bei objektbasierten Umfragen)
              </label>
            </div>
            <div className="space-y-2">
              <Label>Objekt als Komponente</Label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeObjectAsComponent}
                  onChange={(e) => setIncludeObjectAsComponent(e.target.checked)}
                />
                Objekt-ID zusaetzlich als Jira-Komponente setzen
              </label>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Zusatztext fuer Jira-Beschreibung (WYSIWYG)</Label>
            <p className="text-xs text-[var(--color-muted)]">
              Dieser Text erscheint als erster Abschnitt in der Jira-Beschreibung.
            </p>
            <RichTextEditor value={descriptionIntroHtml} onChange={setDescriptionIntroHtml} />
          </div>
          <div className="space-y-2">
            <Label>Live-Vorschau Beschreibung</Label>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white p-3 text-xs text-[var(--color-foreground)]">
              {descriptionPreview || '-'}
            </pre>
          </div>
          {noResultOutputConfigured && (
            <div className="rounded-[var(--radius-card)] border border-[var(--color-required)] bg-white p-3 text-xs text-[var(--color-required)]">
              Hinweis: Es ist aktuell keine Ergebnis-Ausgabe aktiv (kein Umfragetext, kein Readonly-Link,
              kein Excel/PDF-Anhang). Das Jira-Ticket enthaelt dann nur den Zusatztext und Basis-Metadaten.
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={saveConfig} disabled={saving || !selectedQuestionnaireId}>
              {saving ? 'Speichert...' : 'Konfiguration speichern'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
