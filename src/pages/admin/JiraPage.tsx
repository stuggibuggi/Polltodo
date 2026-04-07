import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  api,
  ApiError,
  type JiraMeta,
  type SubmissionRecord,
  type JiraConnectivityDebugResult,
} from '../../lib/api'
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

function formatDate(iso?: string) {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleString('de-DE')
  } catch {
    return iso
  }
}

function statusBadgeClass(ok: boolean, status: number | null) {
  if (ok) return 'border-green-300 bg-green-50 text-green-700'
  if (status !== null && status < 500) return 'border-amber-300 bg-amber-50 text-amber-700'
  return 'border-red-300 bg-red-50 text-red-700'
}

function statusLabel(ok: boolean, status: number | null) {
  if (ok) return 'OK'
  if (status !== null && status < 500) return 'WARN'
  return 'FEHLER'
}

function diagnoseHint(ok: boolean, status: number | null, error?: unknown) {
  if (ok) return 'Verbindung und Authentifizierung sind fuer diesen Check in Ordnung.'
  if (status === 400) return 'Request-Format ungueltig. Payload/Parameter pruefen.'
  if (status === 401) return 'Authentifizierung fehlgeschlagen. JIRA_BASIC_AUTH (User/Passwort) pruefen.'
  if (status === 403) return 'Authentifiziert, aber keine Berechtigung auf Projekt/Endpoint.'
  if (status === 404) return 'Endpoint oder Ticket nicht gefunden. URL, Project Key und Ticketnummer pruefen.'
  if (status === 405) return 'Methode nicht erlaubt. Endpoint erreichbar, aber HTTP-Methode passt nicht.'
  if (status === 407) return 'Proxy-Authentifizierung erforderlich. Netzwerk/Proxy-Konfiguration pruefen.'
  if (status !== null && status >= 500) return 'Jira-Serverfehler oder Upstream-Problem.'
  const asText = typeof error === 'string' ? error : JSON.stringify(error ?? {})
  if (asText.toLowerCase().includes('enotfound')) return 'DNS-Aufloesung fehlgeschlagen. Hostname/Netzwerk pruefen.'
  if (asText.toLowerCase().includes('econnrefused')) return 'Verbindung abgelehnt. Port/Firewall/Service pruefen.'
  if (asText.toLowerCase().includes('etimedout') || asText.toLowerCase().includes('timeout')) {
    return 'Zeitueberschreitung. Netzwerkweg/Proxy/Firewall pruefen.'
  }
  return 'Unklare Ursache. JSON-Details und Server-Logs pruefen.'
}

export function JiraPage() {
  const [searchParams] = useSearchParams()
  const initialSubmissionId = (searchParams.get('submissionId') ?? '').trim()
  const initialQuestionnaireId = (searchParams.get('questionnaireId') ?? '').trim()
  const [meta, setMeta] = useState<JiraMeta | null>(null)
  const [questionnaires, setQuestionnaires] = useState<Questionnaire[]>([])
  const [questionnaireId, setQuestionnaireId] = useState('')
  const [submissions, setSubmissions] = useState<SubmissionRecord[]>([])
  const [submissionId, setSubmissionId] = useState('')
  const [projectKey, setProjectKey] = useState('')
  const [summary, setSummary] = useState('')
  const [issueType, setIssueType] = useState('Task')
  const [assignee, setAssignee] = useState('')
  const [contactPerson, setContactPerson] = useState('')
  const [epicName, setEpicName] = useState('')
  const [componentsText, setComponentsText] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [attachExcelToIssue, setAttachExcelToIssue] = useState(false)
  const [attachPdfToIssue, setAttachPdfToIssue] = useState(false)
  const [userSearch, setUserSearch] = useState('')
  const [userOptions, setUserOptions] = useState<Array<{ username: string; displayName: string; emailAddress: string }>>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createdIssue, setCreatedIssue] = useState<{
    key?: string
    browseUrl?: string | null
    attachments?: Array<{ filename: string; ok: boolean; error?: string }>
  } | null>(null)
  const [debugResult, setDebugResult] = useState<unknown>(null)
  const [debugRunning, setDebugRunning] = useState(false)
  const [lookupProjectKey, setLookupProjectKey] = useState('')
  const [lookupIssueNumber, setLookupIssueNumber] = useState('')
  const [lookupRunning, setLookupRunning] = useState(false)
  const [lookupResult, setLookupResult] = useState<{
    issueKey?: string
    summary?: string | null
    status?: string | null
    assignee?: string | null
    reporter?: string | null
    created?: string | null
    updated?: string | null
    browseUrl?: string | null
  } | null>(null)
  const [connectivityRunning, setConnectivityRunning] = useState(false)
  const [connectivityResult, setConnectivityResult] = useState<JiraConnectivityDebugResult | null>(null)
  const [errorDetails, setErrorDetails] = useState<string | null>(null)

  const { message: toastMessage, visible: toastVisible, showToast } = useToast()

  const stringifyError = (error: unknown) => {
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

  const applyQuestionnaireConfigToForm = (config: {
    projectKey?: string | null
    issueType?: string | null
    assignee?: string | null
    contactPerson?: string | null
    epicName?: string | null
    components?: string[]
    dueDate?: string | null
    attachExcelToIssue?: boolean
    attachPdfToIssue?: boolean
  }, metaData?: JiraMeta | null) => {
    setProjectKey(config.projectKey?.trim() || metaData?.defaultProjectKey || '')
    setIssueType(config.issueType?.trim() || metaData?.defaultIssueType || 'Task')
    setAssignee(config.assignee?.trim() || '')
    setContactPerson(config.contactPerson?.trim() || '')
    setEpicName(config.epicName?.trim() || '')
    setComponentsText(
      (config.components?.length ? config.components : metaData?.defaultComponents ?? []).join(', ')
    )
    setDueDate(config.dueDate?.trim() || '')
    setAttachExcelToIssue(!!config.attachExcelToIssue)
    setAttachPdfToIssue(!!config.attachPdfToIssue)
  }

  useEffect(() => {
    Promise.all([api.jiraMeta(), api.listQuestionnaires()]).then(([metaData, list]) => {
      setMeta(metaData)
      setProjectKey(metaData.defaultProjectKey || '')
      setLookupProjectKey(metaData.defaultProjectKey || '')
      setIssueType(metaData.defaultIssueType || 'Task')
      setComponentsText((metaData.defaultComponents ?? []).join(', '))
      setQuestionnaires(list)
      if (initialQuestionnaireId && list.some((q) => q.id === initialQuestionnaireId)) {
        setQuestionnaireId(initialQuestionnaireId)
      } else if (list.length > 0) {
        setQuestionnaireId(list[0].id)
      }
    })
  }, [initialQuestionnaireId])

  useEffect(() => {
    if (!questionnaireId) return
    api.listSubmissions(questionnaireId).then((list) => {
      setSubmissions(list)
      if (initialSubmissionId && list.some((s) => s.id === initialSubmissionId)) {
        setSubmissionId(initialSubmissionId)
      } else {
        setSubmissionId(list[0]?.id ?? '')
      }
    })
  }, [questionnaireId, initialSubmissionId])

  useEffect(() => {
    if (!questionnaireId) return
    api
      .getQuestionnaireJiraConfig(questionnaireId)
      .then((config) => {
        applyQuestionnaireConfigToForm(config, meta)
      })
      .catch((error) => {
        const msg = stringifyError(error)
        setErrorDetails(msg)
        showToast(msg)
      })
  }, [questionnaireId, meta])

  useEffect(() => {
    const selected = submissions.find((s) => s.id === submissionId)
    const q = questionnaires.find((item) => item.id === questionnaireId)
    if (!selected || !q) return
    setSummary((prev) =>
      prev.trim()
        ? prev
        : `${q.title} - ${formatDate(selected.submittedAt)} - ${selected.user?.email ?? 'ohne Benutzer'}`
    )
  }, [submissionId, submissions, questionnaireId, questionnaires])

  const selectedSubmission = useMemo(
    () => submissions.find((s) => s.id === submissionId),
    [submissions, submissionId]
  )

  const searchUsers = async () => {
    const query = userSearch.trim()
    if (!query) return
    setLoadingUsers(true)
    try {
      const users = await api.jiraSearchUsers(query)
      setUserOptions(users)
      setErrorDetails(null)
    } catch (error) {
      const msg = stringifyError(error)
      setErrorDetails(msg)
      showToast(msg)
    } finally {
      setLoadingUsers(false)
    }
  }

  const createIssue = async () => {
    if (!submissionId) {
      showToast('Bitte eine Submission auswaehlen.')
      return
    }
    setCreating(true)
    try {
      const result = await api.jiraCreateIssue({
        submissionId,
        projectKey: projectKey.trim() || undefined,
        summary: summary.trim() || undefined,
        assignee: assignee.trim() || undefined,
        issueType: issueType.trim() || undefined,
        contactPerson: contactPerson.trim() || undefined,
        epicName: epicName.trim() || undefined,
        components: componentsText
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
        dueDate: dueDate.trim() || undefined,
        attachExcelToIssue,
        attachPdfToIssue,
      })
      setCreatedIssue({ key: result.key, browseUrl: result.browseUrl, attachments: result.attachments })
      setErrorDetails(null)
      showToast(`Jira Ticket erstellt${result.key ? `: ${result.key}` : '.'}`)
    } catch (error) {
      const msg = stringifyError(error)
      setErrorDetails(msg)
      showToast(msg)
    } finally {
      setCreating(false)
    }
  }

  const runDebug = async (dryRun: boolean) => {
    if (!submissionId) {
      showToast('Bitte eine Submission auswaehlen.')
      return
    }
    setDebugRunning(true)
    setDebugResult(null)
    try {
      const result = await api.jiraDebugCreateIssue({
        submissionId,
        projectKey: projectKey.trim() || undefined,
        summary: summary.trim() || undefined,
        assignee: assignee.trim() || undefined,
        issueType: issueType.trim() || undefined,
        contactPerson: contactPerson.trim() || undefined,
        epicName: epicName.trim() || undefined,
        components: componentsText
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
        dueDate: dueDate.trim() || undefined,
        attachExcelToIssue,
        attachPdfToIssue,
        dryRun,
      })
      setDebugResult(result)
      setErrorDetails(null)
      showToast(dryRun ? 'Jira Debug (Dry-Run) abgeschlossen.' : 'Jira Debug (Live) abgeschlossen.')
    } catch (error) {
      const msg = stringifyError(error)
      setErrorDetails(msg)
      showToast(msg)
    } finally {
      setDebugRunning(false)
    }
  }

  const runConnectivityTest = async () => {
    setConnectivityRunning(true)
    setConnectivityResult(null)
    try {
      const result = await api.jiraDebugConnectivity({
        projectKey: lookupProjectKey.trim() || undefined,
        issueNumber: lookupIssueNumber.trim() || undefined,
        userQuery: userSearch.trim() || undefined,
      })
      setConnectivityResult(result)
      setErrorDetails(null)
      showToast(`Jira Erreichbarkeit geprueft. OK: ${result.summary.succeeded}/${result.summary.total}`)
    } catch (error) {
      const msg = stringifyError(error)
      setErrorDetails(msg)
      showToast(msg)
    } finally {
      setConnectivityRunning(false)
    }
  }

  const lookupIssue = async () => {
    const pk = lookupProjectKey.trim()
    const nr = lookupIssueNumber.trim()
    if (!pk || !nr) {
      showToast('Bitte Bereich und Ticket-Nr eingeben.')
      return
    }
    setLookupRunning(true)
    setLookupResult(null)
    try {
      const result = await api.jiraGetIssue(pk, nr)
      setLookupResult(result)
      setErrorDetails(null)
      showToast(`Ticket geladen: ${result.issueKey}`)
    } catch (error) {
      const msg = stringifyError(error)
      setErrorDetails(msg)
      showToast(msg)
    } finally {
      setLookupRunning(false)
    }
  }

  return (
    <div className="space-y-6">
      <Toast message={toastMessage} visible={toastVisible} />
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-[var(--color-foreground)]">Jira Integration</h2>
      </div>

      <Card>
        <CardHeader>
          <h3 className="font-medium">Status</h3>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-[var(--color-muted)]">
          <div>
            {meta?.enabled
              ? 'Jira ist konfiguriert.'
              : 'Jira ist nicht vollstaendig konfiguriert (JIRA_ISSUE_CREATE_URL / JIRA_BASIC_AUTH).'}
          </div>
          {meta && (
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white p-3 text-xs">
              <div><strong>Create URL:</strong> {meta.issueCreateUrl || '-'}</div>
              <div><strong>User Search URL:</strong> {meta.userSearchUrl || '-'}</div>
              <div><strong>Browse URL:</strong> {meta.issueBrowseUrl || '-'}</div>
              <div><strong>Default Project:</strong> {meta.defaultProjectKey || '-'}</div>
              <div><strong>Default Issue Type:</strong> {meta.defaultIssueType || '-'}</div>
            </div>
          )}
          {errorDetails && (
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-[var(--radius-card)] border border-[var(--color-required)] bg-white p-3 text-xs text-[var(--color-required)]">
              {errorDetails}
            </pre>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="font-medium">Jira Erreichbarkeitstest</h3>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-[var(--color-muted)]">
            Testet, ob die konfigurierten Jira API Endpunkte aus dem Backend erreichbar sind
            (Netzwerk, Auth, URL, Antwortcodes). Optional kann ein konkretes Ticket getestet werden.
          </p>
          <div className="grid gap-4 md:grid-cols-[220px_1fr_1fr_auto]">
            <div className="space-y-2">
              <Label>Project Key (optional)</Label>
              <Input value={lookupProjectKey} onChange={(e) => setLookupProjectKey(e.target.value)} placeholder="z. B. PIT" />
            </div>
            <div className="space-y-2">
              <Label>Issue Number (optional)</Label>
              <Input value={lookupIssueNumber} onChange={(e) => setLookupIssueNumber(e.target.value)} placeholder="z. B. 6039" />
            </div>
            <div className="space-y-2">
              <Label>User Search Query (optional)</Label>
              <Input value={userSearch} onChange={(e) => setUserSearch(e.target.value)} placeholder="z. B. svc" />
            </div>
            <div className="flex items-end">
              <Button onClick={runConnectivityTest} disabled={connectivityRunning}>
                {connectivityRunning ? 'Teste...' : 'Erreichbarkeit testen'}
              </Button>
            </div>
          </div>
          {connectivityResult && (
            <div className="space-y-2">
              <div className="text-sm text-[var(--color-muted)]">
                Ergebnis: {connectivityResult.summary.succeeded}/{connectivityResult.summary.total} erfolgreich
              </div>
              <div className="space-y-2">
                {connectivityResult.checks.map((check) => (
                  <div
                    key={`${check.label}-${check.url}`}
                    className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-medium text-[var(--color-foreground)]">{check.label}</div>
                      <span
                        className={`rounded border px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(
                          check.ok,
                          check.status
                        )}`}
                      >
                        {statusLabel(check.ok, check.status)}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-[var(--color-muted)] break-all">{check.url}</div>
                    <div className="mt-2 grid gap-1 text-xs text-[var(--color-muted)] sm:grid-cols-3">
                      <div>
                        <strong>Status:</strong>{' '}
                        {check.status !== null ? `${check.status} ${check.statusText ?? ''}`.trim() : '-'}
                      </div>
                      <div>
                        <strong>Dauer:</strong> {check.timingMs} ms
                      </div>
                      <div>
                        <strong>Auth-Header erkannt:</strong>{' '}
                        {check.responseHeaders?.xAusername ? 'Ja' : 'Nein'}
                      </div>
                    </div>
                    <div className="mt-2 rounded border border-[var(--color-border)] bg-[var(--color-background)] p-2 text-xs text-[var(--color-foreground)]">
                      <strong>Wahrscheinliche Ursache:</strong>{' '}
                      {diagnoseHint(check.ok, check.status, check.error)}
                    </div>
                    {!check.ok && !!check.error && (
                      <div className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                        {typeof check.error === 'string'
                          ? check.error
                          : JSON.stringify(check.error, null, 2)}
                      </div>
                    )}
                    {!check.ok && check.bodySnippet && (
                      <div className="mt-2 rounded border border-[var(--color-border)] bg-[var(--color-background)] p-2 text-xs text-[var(--color-muted)]">
                        <strong>Antwortauszug:</strong> {check.bodySnippet.slice(0, 400)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <pre className="max-h-80 overflow-auto rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white p-3 text-xs">
                {JSON.stringify(connectivityResult, null, 2)}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="font-medium">Ticket aus Umfrage erstellen</h3>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Fragebogen</Label>
              <Select value={questionnaireId} onValueChange={setQuestionnaireId}>
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
            </div>
            <div className="space-y-2">
              <Label>Durchgefuehrte Umfrage (Submission)</Label>
              <Select value={submissionId} onValueChange={setSubmissionId}>
                <SelectTrigger>
                  <SelectValue placeholder="Submission waehlen" />
                </SelectTrigger>
                <SelectContent>
                  {submissions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {formatDate(s.submittedAt)} | {s.user?.email ?? '-'} | v{s.questionnaireVersion ?? '-'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white p-3 text-xs text-[var(--color-muted)]">
            Fragebogen-spezifische Standardwerte werden aus dem Reiter
            <strong> Jira-Konfig </strong> geladen und koennen hier bei Bedarf fuer das einzelne Ticket ueberschrieben werden.
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Jira Bereich (Project Key)</Label>
              <Input value={projectKey} onChange={(e) => setProjectKey(e.target.value)} placeholder="z. B. PIT" />
            </div>
            <div className="space-y-2">
              <Label>Issue Type</Label>
              <Input value={issueType} onChange={(e) => setIssueType(e.target.value)} placeholder="Task" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Ticket Ueberschrift (optional, ueberschreibt Template)</Label>
            <Input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Leer = Summary-Template/Standard nutzen" />
          </div>

          <div className="grid gap-4 md:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <Label>Zugeordneter Benutzer (Jira username)</Label>
              <Input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="z. B. vorname.nachname" />
            </div>
            <div className="flex items-end">
              <Button variant="outline" onClick={searchUsers} disabled={loadingUsers || !userSearch.trim()}>
                Jira User suchen
              </Button>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Ansprechpartner (customfield_11341)</Label>
              <Input
                value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)}
                placeholder="z. B. ddawjk (leer = assignee)"
              />
            </div>
            <div className="space-y-2">
              <Label>Epic Name (customfield_10941)</Label>
              <Input
                value={epicName}
                onChange={(e) => setEpicName(e.target.value)}
                placeholder="z. B. Neuanlage ..."
              />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Komponenten (Komma-getrennt)</Label>
              <Input
                value={componentsText}
                onChange={(e) => setComponentsText(e.target.value)}
                placeholder="z. B. QS-Kreis, Neuanlage2026"
              />
            </div>
            <div className="space-y-2">
              <Label>Zieldatum (optional)</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Anhang: Excel</Label>
              <label className="flex items-center gap-2 text-sm text-[var(--color-foreground)]">
                <input
                  type="checkbox"
                  checked={attachExcelToIssue}
                  onChange={(e) => setAttachExcelToIssue(e.target.checked)}
                />
                Excel-Datei mit Ergebnissen am Jira Ticket anhaengen
              </label>
            </div>
            <div className="space-y-2">
              <Label>Anhang: PDF</Label>
              <label className="flex items-center gap-2 text-sm text-[var(--color-foreground)]">
                <input
                  type="checkbox"
                  checked={attachPdfToIssue}
                  onChange={(e) => setAttachPdfToIssue(e.target.checked)}
                />
                PDF-Datei mit Ergebnissen am Jira Ticket anhaengen
              </label>
            </div>
          </div>
          <Input value={userSearch} onChange={(e) => setUserSearch(e.target.value)} placeholder="Suchbegriff fuer Jira User" />
          {userOptions.length > 0 && (
            <div className="space-y-2 text-sm">
              {userOptions.map((u) => (
                <button
                  key={`${u.username}-${u.emailAddress}`}
                  type="button"
                  className="block w-full rounded border border-[var(--color-border)] bg-white px-3 py-2 text-left hover:bg-[var(--color-background)]"
                  onClick={() => setAssignee(u.username)}
                >
                  {u.displayName || u.username} ({u.username}) {u.emailAddress ? `- ${u.emailAddress}` : ''}
                </button>
              ))}
            </div>
          )}

          <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white p-3 text-xs text-[var(--color-muted)]">
            Beschreibung wird automatisch aus den Umfrageergebnissen formatiert erzeugt
            (Segment, Frage, Antwort je in eigener Zeile, optional Begruendung; ohne Frage-IDs in Klammern).
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={createIssue} disabled={creating || !meta?.enabled || !selectedSubmission}>
              {creating ? 'Erstelle Ticket...' : 'Jira Ticket erstellen'}
            </Button>
            {createdIssue?.key && (
              <span className="text-sm text-[var(--color-muted)]">
                Erstellt: {createdIssue.key}
                {createdIssue.browseUrl && (
                  <>
                    {' '}
                    -{' '}
                    <a
                      href={createdIssue.browseUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--color-primary)] underline"
                    >
                      Oeffnen
                    </a>
                  </>
                )}
                {createdIssue.attachments && createdIssue.attachments.length > 0 && (
                  <> | Anhaenge: {createdIssue.attachments.map((entry) => `${entry.filename}${entry.ok ? '' : ' (Fehler)'}`).join(', ')}</>
                )}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="font-medium">Jira Debug</h3>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => runDebug(true)} disabled={debugRunning || !meta?.enabled}>
              Dry-Run (ohne Ticket)
            </Button>
            <Button onClick={() => runDebug(false)} disabled={debugRunning || !meta?.enabled}>
              Live-Debug (Ticket anlegen)
            </Button>
          </div>
          {Boolean(debugResult) && (
            <pre className="max-h-72 overflow-auto rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white p-3 text-xs">
              {JSON.stringify(debugResult, null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="font-medium">Jira Ticket abrufen</h3>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[220px_1fr_auto]">
            <div className="space-y-2">
              <Label>Bereich</Label>
              <Input value={lookupProjectKey} onChange={(e) => setLookupProjectKey(e.target.value)} placeholder="z. B. PIT" />
            </div>
            <div className="space-y-2">
              <Label>Ticket-Nr</Label>
              <Input value={lookupIssueNumber} onChange={(e) => setLookupIssueNumber(e.target.value)} placeholder="z. B. 12345" />
            </div>
            <div className="flex items-end">
              <Button onClick={lookupIssue} disabled={lookupRunning || !meta?.enabled}>
                Abrufen
              </Button>
            </div>
          </div>
          {lookupResult && (
            <div className="space-y-2 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white p-3 text-sm">
              <div><strong>Key:</strong> {lookupResult.issueKey ?? '-'}</div>
              <div><strong>Summary:</strong> {lookupResult.summary ?? '-'}</div>
              <div><strong>Status:</strong> {lookupResult.status ?? '-'}</div>
              <div><strong>Assignee:</strong> {lookupResult.assignee ?? '-'}</div>
              <div><strong>Reporter:</strong> {lookupResult.reporter ?? '-'}</div>
              <div><strong>Created:</strong> {lookupResult.created ? formatDate(lookupResult.created) : '-'}</div>
              <div><strong>Updated:</strong> {lookupResult.updated ? formatDate(lookupResult.updated) : '-'}</div>
              {lookupResult.browseUrl && (
                <a
                  href={lookupResult.browseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--color-primary)] underline"
                >
                  Ticket in Jira oeffnen
                </a>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
