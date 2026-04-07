import { useState } from 'react'
import * as XLSX from 'xlsx'
import { api, ApiError } from '../../lib/api'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader } from '../../components/ui/card'
import { Toast, useToast } from '../../components/ui/toast'

export function ImportPage() {
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [maintenanceRunning, setMaintenanceRunning] = useState(false)
  const [prefillBulkLoading, setPrefillBulkLoading] = useState(false)

  const { message: toastMessage, visible: toastVisible, showToast } = useToast()

  const downloadTemplate = () => {
    const workbook = XLSX.utils.book_new()
    const addSheet = (name: string, headers: string[], sample: Record<string, unknown>[]) => {
      const ws = XLSX.utils.json_to_sheet([Object.fromEntries(headers.map((h) => [h, ''])), ...sample])
      XLSX.utils.book_append_sheet(workbook, ws, name)
    }
    addSheet('users', ['email', 'password', 'role', 'external_id', 'display_name'], [
      { email: 'user@firma.de', password: 'secret', role: 'VIEWER', external_id: 'uid123', display_name: 'Max Mustermann' },
    ])
    addSheet('objects', ['object_id', 'object_name', 'object_type', 'description', 'meta_json'], [
      { object_id: 'APP-001', object_name: 'Zahlungssystem A', object_type: 'Anwendung', description: 'Kernsystem Zahlungsverkehr', meta_json: '{"kritikalitaet":"hoch"}' },
    ])
    addSheet('roles', ['role_name'], [
      { role_name: 'Fachlich verantwortlich' },
    ])
    addSheet('role_assignments', ['object_id', 'role_name', 'user_email', 'user_id', 'group_name'], [
      { object_id: 'APP-001', role_name: 'Fachlich verantwortlich', user_email: 'user@firma.de', user_id: '', group_name: '' },
    ])
    addSheet('policies', ['object_id', 'questionnaire_title', 'frequency', 'interval_days', 'role_names', 'active_from', 'active_to'], [
      { object_id: 'APP-001', questionnaire_title: 'Regulatorische Jahresbewertung', frequency: 'YEARLY', interval_days: '', role_names: 'Fachlich verantwortlich', active_from: '', active_to: '' },
    ])
    addSheet('object_groups', ['group_name'], [
      { group_name: 'Anwendungen' },
    ])
    addSheet('group_memberships', ['group_name', 'object_id'], [
      { group_name: 'Anwendungen', object_id: 'APP-001' },
    ])
    addSheet('group_policies', ['group_name', 'questionnaire_title', 'frequency', 'interval_days', 'role_names', 'active_from', 'active_to'], [
      { group_name: 'Anwendungen', questionnaire_title: 'Regulatorische Jahresbewertung', frequency: 'YEARLY', interval_days: '', role_names: 'Fachlich verantwortlich', active_from: '', active_to: '' },
    ])
    addSheet(
      'prefill_bulk',
      [
        'object_id',
        'questionnaire_id',
        'questionnaire_title',
        'question_id',
        'question_type',
        'answer',
        'answer_reason',
        'object_meta_json',
        'custom_options_json',
        'FragebogenId',
        'FragebogenTitel',
        'FrageId',
        'FrageTyp',
        'AntwortId',
        'AntwortLabel',
        'Begruendung',
      ],
      [
        {
          object_id: 'APP-001',
          questionnaire_id: '',
          questionnaire_title: 'Regulatorische Jahresbewertung',
          question_id: 'q-1',
          question_type: 'single',
          answer: 'ja',
          answer_reason: '',
          object_meta_json: '',
          custom_options_json: '',
          FragebogenId: '',
          FragebogenTitel: '',
          FrageId: '',
          FrageTyp: '',
          AntwortId: '',
          AntwortLabel: '',
          Begruendung: '',
        },
      ]
    )
    XLSX.writeFile(workbook, 'object-import-template.xlsx')
    showToast('Template heruntergeladen.')
  }

  const downloadPrefillBulkTemplate = () => {
    const workbook = XLSX.utils.book_new()
    const rows = [
      {
        object_id: 'APP-001',
        questionnaire_id: 'uuid-fragebogen-1',
        questionnaire_title: '',
        question_id: 'q-1',
        question_type: 'single',
        answer: 'ja',
        answer_reason: '',
        object_meta_json: '',
        custom_options_json: '',
        FragebogenId: '',
        FragebogenTitel: '',
        FrageId: '',
        FrageTyp: '',
        AntwortId: '',
        AntwortLabel: '',
        Begruendung: '',
      },
      {
        object_id: 'APP-001',
        questionnaire_id: '',
        questionnaire_title: 'Regulatorische Jahresbewertung',
        question_id: 'q-2',
        question_type: 'multi',
        answer: 'optA | optB',
        answer_reason: '',
        object_meta_json: '',
        custom_options_json: '',
        FragebogenId: '',
        FragebogenTitel: '',
        FrageId: '',
        FrageTyp: '',
        AntwortId: '',
        AntwortLabel: '',
        Begruendung: '',
      },
      {
        object_id: 'APP-001',
        questionnaire_id: '',
        questionnaire_title: '',
        question_id: '',
        question_type: '',
        answer: '',
        answer_reason: '',
        object_meta_json: '',
        custom_options_json: '',
        FragebogenId: 'uuid-fragebogen-1',
        FragebogenTitel: '',
        FrageId: 'q-3',
        FrageTyp: 'boolean',
        AntwortId: 'true',
        AntwortLabel: 'Ja',
        Begruendung: '',
      },
    ]
    const ws = XLSX.utils.json_to_sheet(rows)
    XLSX.utils.book_append_sheet(workbook, ws, 'prefill_bulk')
    XLSX.writeFile(workbook, 'prefill-bulk-template.xlsx')
    showToast('Prefill-Template heruntergeladen.')
  }

  const handleBulkPrefillFile = async (file: File) => {
    setError(null)
    setResult(null)
    setPrefillBulkLoading(true)
    try {
      const data = await file.arrayBuffer()
      const workbook = XLSX.read(data)
      const firstSheetName = workbook.SheetNames[0]
      if (!firstSheetName) {
        setError('Keine Tabelle gefunden.')
        return
      }
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { defval: '' }) as Array<Record<string, unknown>>
      const response = await api.importObjectPrefillsBulk({ rows })
      const msg = `Prefill-Import abgeschlossen. (Zeilen: ${response.processedRows}, Objekt+Fragebogen: ${response.importedPairs}, uebersprungen: ${response.skippedRows})`
      setResult(msg)
      if (response.errors.length > 0) {
        setError(response.errors.join('\n'))
        showToast('Prefill-Import mit Hinweisen abgeschlossen.')
      } else {
        showToast('Prefill-Import erfolgreich.')
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Prefill-Import fehlgeschlagen.')
      showToast('Prefill-Import fehlgeschlagen.')
    } finally {
      setPrefillBulkLoading(false)
    }
  }

  const handleFile = async (file: File) => {
    setError(null)
    setResult(null)
    setLoading(true)
    try {
      const data = await file.arrayBuffer()
      const workbook = XLSX.read(data)
      const sheet = (name: string) => workbook.Sheets[name]
      const toJson = (name: string) => {
        const ws = sheet(name)
        if (!ws) return []
        return XLSX.utils.sheet_to_json(ws, { defval: '' }) as Record<string, unknown>[]
      }

      const objects = toJson('objects')
      const users = toJson('users')
      const roles = toJson('roles')
      const assignments = toJson('role_assignments')
      const policies = toJson('policies')
      const object_groups = toJson('object_groups')
      const group_memberships = toJson('group_memberships')
      const group_policies = toJson('group_policies')

      const response = await api.importBulk({
        users: users as Array<{ email: string; password?: string; role?: 'ADMIN' | 'EDITOR' | 'VIEWER'; external_id?: string; display_name?: string }>,
        objects: objects as Array<{ object_id: string; object_name: string; object_type?: string; description?: string; meta_json?: unknown }>,
        roles: roles as Array<{ role_name: string }>,
        assignments: assignments as Array<{
          object_id: string
          role_name: string
          user_email?: string
          user_id?: string
          group_name?: string
        }>,
        policies: policies as Array<{
          object_id: string
          questionnaire_title: string
          frequency: 'ONCE' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'CUSTOM_DAYS'
          interval_days?: number
          role_names: string
          active_from?: string
          active_to?: string
        }>,
        object_groups: object_groups as Array<{ group_name: string }>,
        group_memberships: group_memberships as Array<{ group_name: string; object_id: string }>,
        group_policies: group_policies as Array<{
          group_name: string
          questionnaire_title: string
          frequency: 'ONCE' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'CUSTOM_DAYS'
          interval_days?: number
          role_names: string
          active_from?: string
          active_to?: string
        }>,
      })
      if (response.errors?.length) {
        setError(response.errors.join('\n'))
        showToast('Import mit Fehlern.')
      } else {
        const summary = response.summary
          ? `Import erfolgreich. (users: ${response.summary.users ?? 0}, usersParsed: ${response.summary.usersParsed ?? 0}, usersImported: ${response.summary.usersImported ?? 0}, usersSkipped: ${response.summary.usersSkipped ?? 0}, invalidRoles: ${response.summary.usersInvalidRoles ?? 0}, missingEmail: ${response.summary.usersMissingEmail ?? 0})`
          : 'Import erfolgreich.'
        setResult(summary)
        showToast('Import erfolgreich.')
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || 'Import fehlgeschlagen.')
      } else {
        setError('Import fehlgeschlagen.')
      }
      showToast('Import fehlgeschlagen.')
    } finally {
      setLoading(false)
    }
  }

  const runOverrideCleanup = async (apply: boolean) => {
    setMaintenanceRunning(true)
    try {
      const r = await api.maintenanceOverrideCleanup(apply)
      const msg = apply
        ? `Bereinigung ausgefuehrt. Policies: ${r.stalePolicyCount}, Tasks: ${r.staleTaskCount}`
        : `Pruefung abgeschlossen. Zu bereinigen: Policies ${r.stalePolicyCount}, Tasks ${r.staleTaskCount}`
      setResult(msg)
      setError(null)
      showToast(apply ? 'Bereinigung abgeschlossen.' : 'Pruefung abgeschlossen.')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Wartung fehlgeschlagen.'
      setError(message)
      showToast('Wartung fehlgeschlagen.')
    } finally {
      setMaintenanceRunning(false)
    }
  }

  return (
    <div className="space-y-6">
      <Toast message={toastMessage} visible={toastVisible} />
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-[var(--color-foreground)]">Import</h2>
      </div>

      <Card>
        <CardHeader>
          <h3 className="font-medium">Excel-Import</h3>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-[var(--color-muted)]">
          <p>Erwartete Sheets: `users`, `objects`, `roles`, `role_assignments`, `policies`, `object_groups`, `group_memberships`, `group_policies`.</p>
          <Button variant="outline" onClick={downloadTemplate}>
            Template herunterladen
          </Button>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFile(file)
            }}
          />
          <div className="text-xs text-[var(--color-muted)]">
            Hinweis: In allen objektbezogenen Reitern wird `object_id` verwendet (kein `object_name`). Im Sheet `objects` sind `object_id` und `object_name` erforderlich. Im Sheet `roles` reicht `role_name`.
            Fuellen Sie entweder `user_email` oder `user_id`.
          </div>
          {loading && <p className="text-sm text-[var(--color-muted)]">Import laeuft...</p>}
          {result && <p className="text-sm text-green-600">{result}</p>}
          {error && (
            <pre className="whitespace-pre-wrap text-sm text-[var(--color-required)]">{error}</pre>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="font-medium">Wartung</h3>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-[var(--color-muted)]">
          <p>
            Verwaiste Override-Policies und zugehoerige Tasks pruefen oder bereinigen.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={maintenanceRunning}
              onClick={() => runOverrideCleanup(false)}
            >
              Pruefen (Dry-Run)
            </Button>
            <Button
              variant="destructive"
              disabled={maintenanceRunning}
              onClick={() => runOverrideCleanup(true)}
            >
              Bereinigen
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="font-medium">Vorbefuellung Massenimport (Objekt + Fragebogen)</h3>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-[var(--color-muted)]">
          <p>
            Importiert Vorbefuellungen fuer viele Objekte auf einmal. Unterstuetzt sowohl
            das PreFill-Template (`object_id`, `questionnaire_id|questionnaire_title`, `question_id`, `answer`) als auch das Ergebnis-Exportformat
            (`FragebogenId`, `FrageId`, `AntwortId`, `Begruendung`).
          </p>
          <Button variant="outline" onClick={downloadPrefillBulkTemplate}>
            Prefill-Template herunterladen
          </Button>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleBulkPrefillFile(file)
            }}
          />
          {prefillBulkLoading && <p className="text-sm text-[var(--color-muted)]">Prefill-Import laeuft...</p>}
        </CardContent>
      </Card>
    </div>
  )
}
