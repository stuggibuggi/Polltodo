import { useEffect, useState } from 'react'
import { api, type HomePageConfig, type LoginPageConfig } from '../../lib/api'
import { Card, CardContent, CardHeader } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Button } from '../../components/ui/button'
import { RichTextEditor } from '../../components/admin/RichTextEditor'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'

const ROUTE_OPTIONS = [
  { value: '/', label: 'Startseite (/)' },
  { value: '/admin/questionnaires', label: 'Admin - Fragebogen' },
  { value: '/admin/results', label: 'Admin - Ergebnisse' },
]

export function HomeConfigPage() {
  const [config, setConfig] = useState<HomePageConfig | null>(null)
  const [loginConfig, setLoginConfig] = useState<LoginPageConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([api.getAdminHomeConfig(), api.getAdminLoginConfig()])
      .then(([cfg, loginCfg]) => {
        setConfig(cfg)
        setLoginConfig(loginCfg)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Konfiguration konnte nicht geladen werden.'))
      .finally(() => setLoading(false))
  }, [])

  const update = (patch: Partial<HomePageConfig>) => {
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev))
  }
  const updateLogin = (patch: Partial<LoginPageConfig>) => {
    setLoginConfig((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  const save = async () => {
    if (!config || !loginConfig) return
    setSaving(true)
    setError(null)
    try {
      const [saved, savedLogin] = await Promise.all([
        api.updateAdminHomeConfig(config),
        api.updateAdminLoginConfig(loginConfig),
      ])
      setConfig(saved)
      setLoginConfig(savedLogin)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-[var(--color-muted)]">Laden...</div>
  if (!config || !loginConfig) return <div className="text-[var(--color-muted)]">Keine Daten</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Startseite konfigurieren</h2>
        <Button onClick={save} disabled={saving}>
          Speichern
        </Button>
      </div>
      {error && (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-required)] bg-white p-3 text-sm text-[var(--color-required)]">
          {error}
        </div>
      )}
      <Card>
        <CardHeader>
          <h3 className="font-medium">Allgemein</h3>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Titel</Label>
            <Input value={config.title} onChange={(e) => update({ title: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Untertitel</Label>
            <Input value={config.subtitle} onChange={(e) => update({ subtitle: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Beschreibung (WYSIWYG)</Label>
            <RichTextEditor
              value={config.descriptionHtml}
              onChange={(html) => update({ descriptionHtml: html || '' })}
            />
          </div>
          <div className="space-y-2">
            <Label>Startseiten-Intro oberhalb der Kacheln (WYSIWYG)</Label>
            <RichTextEditor
              value={config.welcomeContentHtml}
              onChange={(html) => update({ welcomeContentHtml: html || '' })}
            />
          </div>
          <div className="space-y-2">
            <Label>Website-Icon (Favicon)</Label>
            <Input
              type="file"
              accept="image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,image/jpeg,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = () => {
                  const result = typeof reader.result === 'string' ? reader.result : ''
                  update({ faviconDataUrl: result })
                }
                reader.readAsDataURL(file)
              }}
            />
            {config.faviconDataUrl && (
              <div className="flex items-center gap-3">
                <img
                  src={config.faviconDataUrl}
                  alt="Favicon Vorschau"
                  className="h-8 w-8 rounded border border-[var(--color-border)] bg-white object-contain"
                />
                <Button variant="outline" onClick={() => update({ faviconDataUrl: '' })}>
                  Icon entfernen
                </Button>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label>Default-Seite nach Login</Label>
            <Select
              value={config.defaultRouteAfterLogin}
              onValueChange={(value) => update({ defaultRouteAfterLogin: value })}
            >
              <SelectTrigger className="w-96">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROUTE_OPTIONS.map((route) => (
                  <SelectItem key={route.value} value={route.value}>
                    {route.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <h3 className="font-medium">Anmeldeseite</h3>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Ueberschrift</Label>
              <Input value={loginConfig.title} onChange={(e) => updateLogin({ title: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Untertitel</Label>
              <Input value={loginConfig.subtitle} onChange={(e) => updateLogin({ subtitle: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Hinweistext</Label>
            <Input value={loginConfig.hintText} onChange={(e) => updateLogin({ hintText: e.target.value })} />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Label fuer Benutzerfeld</Label>
              <Input
                value={loginConfig.usernameLabel}
                onChange={(e) => updateLogin({ usernameLabel: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Platzhalter fuer Benutzerfeld</Label>
              <Input
                value={loginConfig.usernamePlaceholder}
                onChange={(e) => updateLogin({ usernamePlaceholder: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Label fuer Passwortfeld</Label>
              <Input
                value={loginConfig.passwordLabel}
                onChange={(e) => updateLogin({ passwordLabel: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Platzhalter fuer Passwortfeld</Label>
              <Input
                value={loginConfig.passwordPlaceholder}
                onChange={(e) => updateLogin({ passwordPlaceholder: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Text des Anmeldebuttons</Label>
            <Input
              value={loginConfig.submitButtonLabel}
              onChange={(e) => updateLogin({ submitButtonLabel: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Logo hochladen</Label>
            <Input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = () => {
                  const result = typeof reader.result === 'string' ? reader.result : ''
                  updateLogin({ logoDataUrl: result })
                }
                reader.readAsDataURL(file)
              }}
            />
            {loginConfig.logoDataUrl && (
              <div className="space-y-2">
                <img
                  src={loginConfig.logoDataUrl}
                  alt="Login-Logo Vorschau"
                  style={{ width: `${loginConfig.logoWidthPx}px`, maxWidth: '100%' }}
                  className="h-auto rounded border border-[var(--color-border)] bg-white p-2"
                />
                <Button variant="outline" onClick={() => updateLogin({ logoDataUrl: '' })}>
                  Logo entfernen
                </Button>
              </div>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Logo-Groesse (px)</Label>
              <Input
                type="number"
                min={40}
                max={800}
                value={String(loginConfig.logoWidthPx)}
                onChange={(e) =>
                  updateLogin({ logoWidthPx: Math.max(40, Math.min(800, Number(e.target.value) || 180)) })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Logo-Platzierung</Label>
              <Select
                value={loginConfig.logoPlacement}
                onValueChange={(value) =>
                  updateLogin({ logoPlacement: value as LoginPageConfig['logoPlacement'] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="top">Oben</SelectItem>
                  <SelectItem value="center">Zentriert</SelectItem>
                  <SelectItem value="left">Links</SelectItem>
                  <SelectItem value="right">Rechts</SelectItem>
                  <SelectItem value="header">Im Header neben Titel</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <h3 className="font-medium">Inhalte</h3>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Kachel: Offene Umfragen (Titel)</Label>
              <Input
                value={config.tileOpenTitle}
                onChange={(e) => update({ tileOpenTitle: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Kachel: Offene Umfragen (Text)</Label>
              <RichTextEditor
                value={config.tileOpenDescription}
                onChange={(html) => update({ tileOpenDescription: html || '' })}
              />
            </div>
            <div className="space-y-2">
              <Label>Kachel: Offene Umfragen (Hintergrundfarbe Hell)</Label>
              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  type="color"
                  value={config.tileOpenBackgroundColor || '#fffbeb'}
                  onChange={(e) => update({ tileOpenBackgroundColor: e.target.value })}
                />
                <Input
                  type="color"
                  value={config.tileOpenBackgroundColorDark || '#3a2f15'}
                  onChange={(e) => update({ tileOpenBackgroundColorDark: e.target.value })}
                />
              </div>
              <div className="text-xs text-[var(--color-muted)]">Links: Hellmodus, rechts: Dunkelmodus</div>
            </div>
            <div className="space-y-2">
              <Label>Kachel: Allgemeine Fragenkataloge (Titel)</Label>
              <Input
                value={config.tileGlobalTitle}
                onChange={(e) => update({ tileGlobalTitle: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Kachel: Allgemeine Fragenkataloge (Text)</Label>
              <RichTextEditor
                value={config.tileGlobalDescription}
                onChange={(html) => update({ tileGlobalDescription: html || '' })}
              />
            </div>
            <div className="space-y-2">
              <Label>Kachel: Allgemeine Fragenkataloge (Hintergrundfarbe Hell)</Label>
              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  type="color"
                  value={config.tileGlobalBackgroundColor || '#eff6ff'}
                  onChange={(e) => update({ tileGlobalBackgroundColor: e.target.value })}
                />
                <Input
                  type="color"
                  value={config.tileGlobalBackgroundColorDark || '#172d45'}
                  onChange={(e) => update({ tileGlobalBackgroundColorDark: e.target.value })}
                />
              </div>
              <div className="text-xs text-[var(--color-muted)]">Links: Hellmodus, rechts: Dunkelmodus</div>
            </div>
            <div className="space-y-2">
              <Label>Kachel: Durchgefuehrte Umfragen (Titel)</Label>
              <Input
                value={config.tileHistoryTitle}
                onChange={(e) => update({ tileHistoryTitle: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Kachel: Durchgefuehrte Umfragen (Text)</Label>
              <RichTextEditor
                value={config.tileHistoryDescription}
                onChange={(html) => update({ tileHistoryDescription: html || '' })}
              />
            </div>
            <div className="space-y-2">
              <Label>Kachel: Durchgefuehrte Umfragen (Hintergrundfarbe Hell)</Label>
              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  type="color"
                  value={config.tileHistoryBackgroundColor || '#ecfdf5'}
                  onChange={(e) => update({ tileHistoryBackgroundColor: e.target.value })}
                />
                <Input
                  type="color"
                  value={config.tileHistoryBackgroundColorDark || '#143427'}
                  onChange={(e) => update({ tileHistoryBackgroundColorDark: e.target.value })}
                />
              </div>
              <div className="text-xs text-[var(--color-muted)]">Links: Hellmodus, rechts: Dunkelmodus</div>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={config.showOpenTasks}
              onChange={(e) => update({ showOpenTasks: e.target.checked })}
              className="h-4 w-4 rounded border-[var(--color-border)]"
            />
            Offene Umfragen anzeigen
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Ueberschrift offene Umfragen</Label>
              <Input
                value={config.headingOpenTasks}
                onChange={(e) => update({ headingOpenTasks: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Darstellung offene Umfragen</Label>
              <Select
                value={config.openTasksGrouping}
                onValueChange={(value) => update({ openTasksGrouping: value as HomePageConfig['openTasksGrouping'] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="object_group">Nach Objektgruppen</SelectItem>
                  <SelectItem value="object">Nach Objekten</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={config.showGlobalCatalogs}
              onChange={(e) => update({ showGlobalCatalogs: e.target.checked })}
              className="h-4 w-4 rounded border-[var(--color-border)]"
            />
            Globale Fragenkataloge anzeigen
          </label>
          <div className="space-y-2">
            <Label>Ueberschrift globale Fragenkataloge</Label>
            <Input
              value={config.headingGlobalCatalogs}
              onChange={(e) => update({ headingGlobalCatalogs: e.target.value })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={config.showClosedTasks}
              onChange={(e) => update({ showClosedTasks: e.target.checked })}
              className="h-4 w-4 rounded border-[var(--color-border)]"
            />
            Abgeschlossene Umfragen anzeigen
          </label>
          <div className="space-y-2">
            <Label>Ueberschrift abgeschlossene Umfragen</Label>
            <Input
              value={config.headingClosedTasks}
              onChange={(e) => update({ headingClosedTasks: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
