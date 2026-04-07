import { useEffect, useMemo, useState } from 'react'
import {
  api,
  ApiError,
  type ExternalObjectImportDefinition,
  type ExternalObjectImportRun,
} from '../../lib/api'
import { Card, CardContent, CardHeader } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Toast, useToast } from '../../components/ui/toast'

type FormState = {
  id?: string
  name: string
  description: string
  importMode: 'OBJECTS' | 'PEOPLE_ROLES_OBJECT' | 'USERS_LDAP'
  sqlHost: string
  sqlPort: string
  sqlDatabase: string
  sqlUsername: string
  sqlPassword: string
  sqlQuery: string
  sqlEncrypt: boolean
  sqlTrustServerCertificate: boolean
  mapObjectIdColumn: string
  mapTypeColumn: string
  mapNameColumn: string
  mapDescriptionColumn: string
  mapMetadataColumn: string
  mapUserIdColumn: string
  mapUserEmailColumn: string
  mapUserDisplayNameColumn: string
  mapRoleNameColumn: string
  scheduleEveryMinutes: string
  enabled: boolean
  deleteMissing: boolean
}

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  importMode: 'OBJECTS',
  sqlHost: '',
  sqlPort: '1433',
  sqlDatabase: '',
  sqlUsername: '',
  sqlPassword: '',
  sqlQuery: 'SELECT object_id, type, name, description FROM dbo.Objects',
  sqlEncrypt: true,
  sqlTrustServerCertificate: false,
  mapObjectIdColumn: 'object_id',
  mapTypeColumn: 'type',
  mapNameColumn: 'name',
  mapDescriptionColumn: 'description',
  mapMetadataColumn: 'meta_json',
  mapUserIdColumn: 'user_id',
  mapUserEmailColumn: 'email',
  mapUserDisplayNameColumn: 'display_name',
  mapRoleNameColumn: 'role_name',
  scheduleEveryMinutes: '',
  enabled: true,
  deleteMissing: false,
}

function toForm(item: ExternalObjectImportDefinition): FormState {
  const importMode =
    item.importMode === 'PEOPLE_ROLES_OBJECT' || item.importMode === 'USERS_LDAP'
      ? item.importMode
      : 'OBJECTS'
  return {
    id: item.id,
    name: item.name,
    description: item.description ?? '',
    importMode,
    sqlHost: item.sqlHost,
    sqlPort: String(item.sqlPort || 1433),
    sqlDatabase: item.sqlDatabase,
    sqlUsername: item.sqlUsername,
    sqlPassword: '',
    sqlQuery: item.sqlQuery,
    sqlEncrypt: item.sqlEncrypt,
    sqlTrustServerCertificate: item.sqlTrustServerCertificate,
    mapObjectIdColumn: item.mapObjectIdColumn ?? 'object_id',
    mapTypeColumn: item.mapTypeColumn ?? 'type',
    mapNameColumn: item.mapNameColumn ?? 'name',
    mapDescriptionColumn: item.mapDescriptionColumn ?? 'description',
    mapMetadataColumn: item.mapMetadataColumn ?? 'meta_json',
    mapUserIdColumn: item.mapUserIdColumn ?? 'user_id',
    mapUserEmailColumn: item.mapUserEmailColumn ?? 'email',
    mapUserDisplayNameColumn: item.mapUserDisplayNameColumn ?? 'display_name',
    mapRoleNameColumn: item.mapRoleNameColumn ?? 'role_name',
    scheduleEveryMinutes:
      typeof item.scheduleEveryMinutes === 'number' && item.scheduleEveryMinutes > 0
        ? String(item.scheduleEveryMinutes)
        : '',
    enabled: item.enabled,
    deleteMissing: item.deleteMissing,
  }
}

export function ExternalObjectImportsPage() {
  const [items, setItems] = useState<ExternalObjectImportDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [lastResult, setLastResult] = useState<string>('')
  const [runs, setRuns] = useState<ExternalObjectImportRun[]>([])
  const [resultMessages, setResultMessages] = useState<string[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const { message, visible, showToast } = useToast()

  const selected = useMemo(
    () => items.find((item) => item.id === form.id) ?? null,
    [items, form.id]
  )

  const load = async () => {
    setLoading(true)
    try {
      const list = await api.listExternalObjectImportDefinitions()
      setItems(list)
      if (form.id) {
        const exists = list.find((entry) => entry.id === form.id)
        if (!exists) setForm(EMPTY_FORM)
      }
    } finally {
      setLoading(false)
    }
  }

  const loadRuns = async (definitionId?: string) => {
    if (!definitionId) {
      setRuns([])
      return
    }
    try {
      const list = await api.listExternalObjectImportRuns(definitionId, 30)
      setRuns(list)
    } catch {
      setRuns([])
    }
  }

  useEffect(() => {
    load().catch((error) => {
      showToast(error instanceof Error ? error.message : 'Laden fehlgeschlagen.')
    })
  }, [])

  useEffect(() => {
    loadRuns(form.id)
  }, [form.id])

  const resetForm = () => {
    setForm(EMPTY_FORM)
    setLastResult('')
    setResultMessages([])
  }

  const extractMessages = (value: unknown): string[] => {
    if (!value) return []
    if (Array.isArray(value)) return value.map((entry) => String(entry)).filter(Boolean)
    if (typeof value === 'string' && value.trim()) return [value.trim()]
    return []
  }

  const save = async () => {
    if (!form.name.trim() || !form.sqlHost.trim() || !form.sqlDatabase.trim() || !form.sqlUsername.trim() || !form.sqlQuery.trim()) {
      showToast('Bitte Name, SQL-Server, Datenbank, Benutzer und SQL-Query ausfuellen.')
      return
    }
    if (!form.id && !form.sqlPassword.trim()) {
      showToast('Bitte SQL-Passwort angeben.')
      return
    }
    setSaving(true)
    try {
      if (form.id) {
        await api.updateExternalObjectImportDefinition(form.id, {
          name: form.name,
          description: form.description || undefined,
          importMode: form.importMode,
          sqlHost: form.sqlHost,
          sqlPort: Number(form.sqlPort || 1433),
          sqlDatabase: form.sqlDatabase,
          sqlUsername: form.sqlUsername,
          sqlPassword: form.sqlPassword || undefined,
          sqlQuery: form.sqlQuery,
          sqlEncrypt: form.sqlEncrypt,
          sqlTrustServerCertificate: form.sqlTrustServerCertificate,
          mapObjectIdColumn: form.mapObjectIdColumn,
          mapTypeColumn: form.mapTypeColumn,
          mapNameColumn: form.mapNameColumn,
          mapDescriptionColumn: form.mapDescriptionColumn,
          mapMetadataColumn: form.mapMetadataColumn,
          mapUserIdColumn: form.mapUserIdColumn,
          mapUserEmailColumn: form.mapUserEmailColumn,
          mapUserDisplayNameColumn: form.mapUserDisplayNameColumn,
          mapRoleNameColumn: form.mapRoleNameColumn,
          scheduleEveryMinutes:
            Number.isFinite(Number(form.scheduleEveryMinutes)) && Number(form.scheduleEveryMinutes) > 0
              ? Number(form.scheduleEveryMinutes)
              : null,
          enabled: form.enabled,
          deleteMissing: form.deleteMissing,
        })
      } else {
        const created = await api.createExternalObjectImportDefinition({
          name: form.name,
          description: form.description || undefined,
          importMode: form.importMode,
          sqlHost: form.sqlHost,
          sqlPort: Number(form.sqlPort || 1433),
          sqlDatabase: form.sqlDatabase,
          sqlUsername: form.sqlUsername,
          sqlPassword: form.sqlPassword,
          sqlQuery: form.sqlQuery,
          sqlEncrypt: form.sqlEncrypt,
          sqlTrustServerCertificate: form.sqlTrustServerCertificate,
          mapObjectIdColumn: form.mapObjectIdColumn,
          mapTypeColumn: form.mapTypeColumn,
          mapNameColumn: form.mapNameColumn,
          mapDescriptionColumn: form.mapDescriptionColumn,
          mapMetadataColumn: form.mapMetadataColumn,
          mapUserIdColumn: form.mapUserIdColumn,
          mapUserEmailColumn: form.mapUserEmailColumn,
          mapUserDisplayNameColumn: form.mapUserDisplayNameColumn,
          mapRoleNameColumn: form.mapRoleNameColumn,
          scheduleEveryMinutes:
            Number.isFinite(Number(form.scheduleEveryMinutes)) && Number(form.scheduleEveryMinutes) > 0
              ? Number(form.scheduleEveryMinutes)
              : null,
          enabled: form.enabled,
          deleteMissing: form.deleteMissing,
        })
        setForm(toForm(created))
      }
      await load()
      showToast('Importdefinition gespeichert.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Speichern fehlgeschlagen.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!form.id) return
    if (!window.confirm('Importdefinition wirklich loeschen?')) return
    try {
      await api.deleteExternalObjectImportDefinition(form.id)
      resetForm()
      await load()
      showToast('Importdefinition geloescht.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Loeschen fehlgeschlagen.')
    }
  }

  const test = async () => {
    if (!form.id) {
      showToast('Bitte erst speichern.')
      return
    }
    setRunning(true)
    try {
      const result = await api.testExternalObjectImportDefinition(form.id)
      const warnings = extractMessages(result.warnings)
      setResultMessages(warnings)
      setLastResult(
        JSON.stringify(
          {
            rowCount: result.rowCount,
            normalizedCount: result.normalizedCount,
            metadataMappedCount: result.metadataMappedCount,
            warnings: result.warnings,
            sample: result.sample,
          },
          null,
          2
        )
      )
      showToast('Testlauf abgeschlossen.')
    } catch (error) {
      const message =
        error instanceof ApiError
          ? `${error.message}${typeof error.data === 'object' && error.data ? `\n${JSON.stringify(error.data)}` : ''}`
          : error instanceof Error
            ? error.message
            : 'Testlauf fehlgeschlagen.'
      setLastResult(message)
      showToast('Testlauf fehlgeschlagen.')
    } finally {
      setRunning(false)
    }
  }

  const run = async (dryRun: boolean) => {
    if (!form.id) {
      showToast('Bitte erst speichern.')
      return
    }
    setRunning(true)
    try {
      const result = await api.runExternalObjectImportDefinition(form.id, dryRun)
      setResultMessages(extractMessages(result.warnings))
      setLastResult(JSON.stringify(result, null, 2))
      await load()
      await loadRuns(form.id)
      showToast(dryRun ? 'Dry-Run abgeschlossen.' : 'Import abgeschlossen.')
    } catch (error) {
      const message =
        error instanceof ApiError
          ? `${error.message}${typeof error.data === 'object' && error.data ? `\n${JSON.stringify(error.data)}` : ''}`
          : error instanceof Error
            ? error.message
            : 'Import fehlgeschlagen.'
      setLastResult(message)
      showToast('Import fehlgeschlagen.')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-[var(--color-foreground)]">Externer Objektimport (MS SQL)</h2>
        <p className="text-sm text-[var(--color-muted)]">
          Pro Importjob kann zwischen Objektimport, Personen+Rollen+Objekt-Zuordnung und LDAP-Benutzerimport gewechselt werden.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h3 className="font-medium">Importjobs</h3>
              <Button variant="outline" size="sm" onClick={resetForm}>Neu</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading && <p className="text-sm text-[var(--color-muted)]">Laden...</p>}
            {!loading && items.length === 0 && (
              <p className="text-sm text-[var(--color-muted)]">Keine Importjobs vorhanden.</p>
            )}
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`w-full rounded border px-3 py-2 text-left text-sm ${
                  form.id === item.id
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5'
                    : 'border-[var(--color-border)]'
                }`}
                onClick={() => {
                  setForm(toForm(item))
                  setLastResult('')
                }}
              >
                <div className="font-medium">{item.name}</div>
                <div className="text-xs text-[var(--color-muted)]">
                  {item.enabled ? 'Aktiv' : 'Inaktiv'}
                  {item.lastRunAt ? ` | Letzter Lauf: ${new Date(item.lastRunAt).toLocaleString('de-DE')}` : ''}
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="font-medium">{form.id ? 'Importjob bearbeiten' : 'Neuer Importjob'}</h3>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Beschreibung</Label>
                <Input value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Importtyp</Label>
                <select
                  value={form.importMode}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      importMode:
                        e.target.value === 'PEOPLE_ROLES_OBJECT' || e.target.value === 'USERS_LDAP'
                          ? e.target.value
                          : 'OBJECTS',
                    }))
                  }
                  className="flex h-10 w-full rounded-[var(--radius-button)] border border-[var(--color-border)] bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                >
                  <option value="OBJECTS">Objekte</option>
                  <option value="PEOPLE_ROLES_OBJECT">Personen + Rollen + Objektzuordnung</option>
                  <option value="USERS_LDAP">Benutzer (LDAP/AD)</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label>SQL Host</Label>
                <Input value={form.sqlHost} onChange={(e) => setForm((prev) => ({ ...prev, sqlHost: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>SQL Port</Label>
                <Input value={form.sqlPort} onChange={(e) => setForm((prev) => ({ ...prev, sqlPort: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>SQL Datenbank</Label>
                <Input value={form.sqlDatabase} onChange={(e) => setForm((prev) => ({ ...prev, sqlDatabase: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>SQL Benutzer</Label>
                <Input value={form.sqlUsername} onChange={(e) => setForm((prev) => ({ ...prev, sqlUsername: e.target.value }))} />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label>SQL Passwort {selected?.sqlPasswordMasked ? '(leer lassen = unveraendert)' : ''}</Label>
                <Input
                  type="password"
                  value={form.sqlPassword}
                  onChange={(e) => setForm((prev) => ({ ...prev, sqlPassword: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label>SQL Query</Label>
              <textarea
                value={form.sqlQuery}
                onChange={(e) => setForm((prev) => ({ ...prev, sqlQuery: e.target.value }))}
                rows={8}
                className="flex w-full rounded-[var(--radius-button)] border border-[var(--color-border)] bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {form.importMode !== 'USERS_LDAP' && (
                <div className="space-y-1">
                  <Label>Mapping: Objekt-ID Spalte</Label>
                  <Input
                    value={form.mapObjectIdColumn}
                    onChange={(e) => setForm((prev) => ({ ...prev, mapObjectIdColumn: e.target.value }))}
                    placeholder="object_id"
                  />
                </div>
              )}
              {form.importMode === 'OBJECTS' ? (
                <>
                  <div className="space-y-1">
                    <Label>Mapping: Typ Spalte</Label>
                    <Input
                      value={form.mapTypeColumn}
                      onChange={(e) => setForm((prev) => ({ ...prev, mapTypeColumn: e.target.value }))}
                      placeholder="type"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Mapping: Name Spalte</Label>
                    <Input
                      value={form.mapNameColumn}
                      onChange={(e) => setForm((prev) => ({ ...prev, mapNameColumn: e.target.value }))}
                      placeholder="name"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Mapping: Beschreibung Spalte</Label>
                    <Input
                      value={form.mapDescriptionColumn}
                      onChange={(e) => setForm((prev) => ({ ...prev, mapDescriptionColumn: e.target.value }))}
                      placeholder="description"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Mapping: Metadaten (JSON) Spalte</Label>
                    <Input
                      value={form.mapMetadataColumn}
                      onChange={(e) => setForm((prev) => ({ ...prev, mapMetadataColumn: e.target.value }))}
                      placeholder="meta_json"
                    />
                  </div>
                </>
              ) : form.importMode === 'PEOPLE_ROLES_OBJECT' ? (
                <>
                  <div className="space-y-1">
                    <Label>Mapping: User-ID Spalte (Schluessel)</Label>
                    <Input
                      value={form.mapUserIdColumn}
                      onChange={(e) => setForm((prev) => ({ ...prev, mapUserIdColumn: e.target.value }))}
                      placeholder="user_id"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Mapping: Rolle Spalte</Label>
                    <Input
                      value={form.mapRoleNameColumn}
                      onChange={(e) => setForm((prev) => ({ ...prev, mapRoleNameColumn: e.target.value }))}
                      placeholder="role_name"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Mapping: E-Mail Spalte (optional)</Label>
                    <Input
                      value={form.mapUserEmailColumn}
                      onChange={(e) => setForm((prev) => ({ ...prev, mapUserEmailColumn: e.target.value }))}
                      placeholder="email"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Mapping: Personenname Spalte (optional)</Label>
                    <Input
                      value={form.mapUserDisplayNameColumn}
                      onChange={(e) => setForm((prev) => ({ ...prev, mapUserDisplayNameColumn: e.target.value }))}
                      placeholder="display_name"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-1">
                    <Label>Mapping: User-ID Spalte (Schluessel)</Label>
                    <Input
                      value={form.mapUserIdColumn}
                      onChange={(e) => setForm((prev) => ({ ...prev, mapUserIdColumn: e.target.value }))}
                      placeholder="user_id"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Mapping: E-Mail Spalte (optional)</Label>
                    <Input
                      value={form.mapUserEmailColumn}
                      onChange={(e) => setForm((prev) => ({ ...prev, mapUserEmailColumn: e.target.value }))}
                      placeholder="email"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Mapping: Personenname Spalte (optional)</Label>
                    <Input
                      value={form.mapUserDisplayNameColumn}
                      onChange={(e) => setForm((prev) => ({ ...prev, mapUserDisplayNameColumn: e.target.value }))}
                      placeholder="display_name"
                    />
                  </div>
                </>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.sqlEncrypt}
                  onChange={(e) => setForm((prev) => ({ ...prev, sqlEncrypt: e.target.checked }))}
                  className="h-4 w-4 rounded border-[var(--color-border)]"
                />
                Verbindung verschluesseln (`encrypt`)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.sqlTrustServerCertificate}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, sqlTrustServerCertificate: e.target.checked }))
                  }
                  className="h-4 w-4 rounded border-[var(--color-border)]"
                />
                Zertifikat vertrauen (`trustServerCertificate`)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm((prev) => ({ ...prev, enabled: e.target.checked }))}
                  className="h-4 w-4 rounded border-[var(--color-border)]"
                />
                Job aktiviert
              </label>
              <div className="space-y-1">
                <Label>Automatisch alle X Minuten (leer = kein Scheduler)</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.scheduleEveryMinutes}
                  onChange={(e) => setForm((prev) => ({ ...prev, scheduleEveryMinutes: e.target.value }))}
                  placeholder="z. B. 60"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.deleteMissing}
                  onChange={(e) => setForm((prev) => ({ ...prev, deleteMissing: e.target.checked }))}
                  className="h-4 w-4 rounded border-[var(--color-border)]"
                />
                {form.importMode === 'OBJECTS'
                  ? 'Fehlende Objekte loeschen (Objekt-ID nicht mehr im Import)'
                  : form.importMode === 'PEOPLE_ROLES_OBJECT'
                    ? 'Fehlende Rollenzuordnungen loeschen (nicht mehr im Import)'
                    : 'Fehlende Benutzer-Marker bereinigen (keine Benutzerloeschung)'}
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={save} disabled={saving || running}>
                {saving ? 'Speichern...' : 'Speichern'}
              </Button>
              <Button variant="outline" onClick={test} disabled={saving || running || !form.id}>
                SQL testen
              </Button>
              <Button variant="outline" onClick={() => run(true)} disabled={saving || running || !form.id}>
                Dry-Run
              </Button>
              <Button onClick={() => run(false)} disabled={saving || running || !form.id}>
                Import ausfuehren
              </Button>
              {form.id && (
                <Button variant="ghost" onClick={remove} disabled={saving || running}>
                  Loeschen
                </Button>
              )}
            </div>

            {selected?.lastRunStatus && (
              <div className="rounded border border-[var(--color-border)] bg-white p-3 text-sm">
                <div>Status: {selected.lastRunStatus}</div>
                {selected.lastRunMessage && <div className="text-[var(--color-muted)]">{selected.lastRunMessage}</div>}
              </div>
            )}

            {runs.length > 0 && (
              <div className="rounded border border-[var(--color-border)] bg-white p-3">
                <div className="mb-2 text-sm font-medium">Letzte Importlaeufe</div>
                <div className="max-h-56 overflow-auto text-xs">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b border-[var(--color-border)] text-left">
                        <th className="py-1 pr-2">Start</th>
                        <th className="py-1 pr-2">Status</th>
                        <th className="py-1 pr-2">Created</th>
                        <th className="py-1 pr-2">Updated</th>
                        <th className="py-1 pr-2">Deleted</th>
                        <th className="py-1 pr-2">Warn</th>
                        <th className="py-1 pr-2">Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((runItem) => (
                        <tr key={runItem.id} className="border-b border-[var(--color-border)]">
                          <td className="py-1 pr-2">{new Date(runItem.startedAt).toLocaleString('de-DE')}</td>
                          <td className="py-1 pr-2">{runItem.status}</td>
                          <td className="py-1 pr-2">{runItem.createdCount ?? '-'}</td>
                          <td className="py-1 pr-2">{runItem.updatedCount ?? '-'}</td>
                          <td className="py-1 pr-2">{runItem.deletedCount ?? '-'}</td>
                          <td className="py-1 pr-2">{runItem.warningCount ?? '-'}</td>
                          <td className="py-1 pr-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setSelectedRunId((current) => (current === runItem.id ? null : runItem.id))
                              }
                            >
                              {selectedRunId === runItem.id ? 'Schliessen' : 'Anzeigen'}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {selectedRunId && (
                  <div className="mt-3 rounded border border-[var(--color-border)] bg-[var(--color-muted-bg)] p-3 text-xs">
                    {(() => {
                      const selectedRun = runs.find((item) => item.id === selectedRunId)
                      if (!selectedRun) return <div>Kein Lauf ausgewaehlt.</div>
                      const warnings = extractMessages(selectedRun.warnings)
                      if (warnings.length === 0) {
                        return <div>Keine Warnungen/Fehler fuer diesen Lauf hinterlegt.</div>
                      }
                      return (
                        <div className="space-y-1">
                          <div className="font-semibold">Warnungen/Fehler ({warnings.length})</div>
                          {warnings.map((entry, idx) => (
                            <div key={`${selectedRun.id}-${idx}`}>- {entry}</div>
                          ))}
                        </div>
                      )
                    })()}
                  </div>
                )}
              </div>
            )}

            {resultMessages.length > 0 && (
              <div className="rounded border border-[var(--color-border)] bg-white p-3 text-sm">
                <div className="mb-2 font-medium">Warnungen/Fehlerliste</div>
                <div className="max-h-52 space-y-1 overflow-auto text-xs">
                  {resultMessages.map((entry, idx) => (
                    <div key={`result-msg-${idx}`}>- {entry}</div>
                  ))}
                </div>
              </div>
            )}

            {lastResult && (
              <pre className="max-h-80 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-muted-bg)] p-3 text-xs">
                {lastResult}
              </pre>
            )}
          </CardContent>
        </Card>
      </div>
      <Toast message={message} visible={visible} />
    </div>
  )
}
