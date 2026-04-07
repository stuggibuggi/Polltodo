import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader } from '../../components/ui/card'
import { api } from '../../lib/api'

const MENU_ITEMS: Array<{ key: string; label: string; description: string }> = [
  { key: 'questionnaires', label: 'Fragebogen', description: 'Frageboegen erstellen, bearbeiten und verwalten' },
  { key: 'groups', label: 'Benutzergruppen', description: 'Benutzergruppen anlegen und Mitglieder verwalten' },
  { key: 'objects', label: 'Objekte', description: 'Objekte (z.B. Standorte, Geraete) anlegen und verwalten' },
  { key: 'roles', label: 'Rollen', description: 'Rollendefinitionen fuer die Objektzuordnung' },
  { key: 'objectGroups', label: 'Objektgruppen', description: 'Objekte in Gruppen organisieren' },
  { key: 'homeConfig', label: 'Startseite', description: 'Startseiten-Konfiguration (Kacheln, Texte, Favicon)' },
  { key: 'questionTypes', label: 'Fragetypen', description: 'Benutzerdefinierte Fragetypen verwalten' },
  { key: 'import', label: 'Import', description: 'Daten aus Excel/CSV importieren' },
  { key: 'objectImports', label: 'Objekt-Import (SQL)', description: 'Objekte aus externen SQL-Datenbanken importieren' },
  { key: 'results', label: 'Ergebnisse', description: 'Umfrageergebnisse einsehen und exportieren' },
  { key: 'resultsAnalytics', label: 'Grafische Auswertung', description: 'Diagramme und grafische Analysen' },
  { key: 'resultsKpis', label: 'KPI', description: 'KPI-Dashboard und Kennzahlen' },
  { key: 'jira', label: 'Jira', description: 'Jira-Tickets aus Umfragen erstellen' },
  { key: 'jiraConfig', label: 'Jira-Konfig', description: 'Jira-Integration konfigurieren' },
]

export function EditorMenuConfigPage() {
  const [config, setConfig] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api
      .getEditorMenuConfig()
      .then(setConfig)
      .catch(() => {
        const defaults: Record<string, boolean> = {}
        MENU_ITEMS.forEach((item) => (defaults[item.key] = true))
        setConfig(defaults)
      })
      .finally(() => setLoading(false))
  }, [])

  const toggleItem = (key: string) => {
    setConfig((prev) => ({ ...prev, [key]: !prev[key] }))
    setSaved(false)
  }

  const toggleAll = (value: boolean) => {
    const next: Record<string, boolean> = {}
    MENU_ITEMS.forEach((item) => (next[item.key] = value))
    setConfig(next)
    setSaved(false)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const result = await api.updateEditorMenuConfig(config)
      setConfig(result)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      alert('Speichern fehlgeschlagen.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-sm text-[var(--color-muted)]">Laden...</div>

  const enabledCount = MENU_ITEMS.filter((item) => config[item.key] !== false).length

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-[var(--color-foreground)]">Editor-Zugriff</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Legen Sie fest, welche Administrationsbereiche fuer Benutzer mit der Rolle &quot;Editor&quot; sichtbar sind.
          Admins sehen immer alle Bereiche.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h3 className="font-medium">
              Menuepunkte ({enabledCount} von {MENU_ITEMS.length} aktiv)
            </h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => toggleAll(true)}>
                Alle aktivieren
              </Button>
              <Button variant="outline" size="sm" onClick={() => toggleAll(false)}>
                Alle deaktivieren
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-[var(--color-border)]">
            {MENU_ITEMS.map((item) => (
              <label
                key={item.key}
                className="flex cursor-pointer items-center gap-4 py-3 transition-colors hover:bg-[var(--color-surface)]/50"
              >
                <input
                  type="checkbox"
                  checked={config[item.key] !== false}
                  onChange={() => toggleItem(item.key)}
                  className="h-4 w-4 rounded"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-[var(--color-foreground)]">{item.label}</div>
                  <div className="text-xs text-[var(--color-muted)]">{item.description}</div>
                </div>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Speichern...' : 'Speichern'}
        </Button>
        {saved && <span className="text-sm text-green-600">Gespeichert!</span>}
      </div>
    </div>
  )
}
