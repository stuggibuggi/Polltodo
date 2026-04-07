import { useEffect, useMemo, useState } from 'react'
import { api, type QuestionTypeCatalogItem } from '../../lib/api'
import { Card, CardContent, CardHeader } from '../../components/ui/card'
import { Button } from '../../components/ui/button'

export function QuestionTypeAdminPage() {
  const [items, setItems] = useState<QuestionTypeCatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      setItems(await api.listQuestionTypeCatalog())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fragetypen konnten nicht geladen werden.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const totalQuestionnaires = useMemo(
    () => items.reduce((acc, item) => acc + item.usage.questionnaireCount, 0),
    [items]
  )

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.updateQuestionTypeCatalog(
        items.map((item) => ({ key: item.key, enabled: item.enabled }))
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-[var(--color-muted)]">Laden...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Fragetypen-Baukasten</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void load()}>
            Neu laden
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            Speichern
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <h3 className="font-medium">Hinweis</h3>
        </CardHeader>
        <CardContent className="text-sm text-[var(--color-muted)]">
          Aktivierung/Deaktivierung gilt nur fuer neue Frageboegen. Bereits verwendete Fragetypen
          bleiben in bestehenden Frageboegen erhalten.
          <div className="mt-2">
            Summe Verwendungen in Frageboegen: <strong>{totalQuestionnaires}</strong>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-required)] bg-white p-3 text-sm text-[var(--color-required)]">
          {error}
        </div>
      )}

      <div className="grid gap-3">
        {items.map((item) => (
          <Card key={item.key}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <div className="font-medium text-[var(--color-foreground)]">{item.label}</div>
                <div className="text-xs text-[var(--color-muted)]">Antworttyp: {item.answerTypeLabel}</div>
                <div className="mt-1 text-xs text-[var(--color-muted)]">
                  Verwendet in {item.usage.questionnaireCount} Frageboegen, {item.usage.questionCount}{' '}
                  Fragen
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={item.enabled}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((entry) =>
                        entry.key === item.key ? { ...entry, enabled: e.target.checked } : entry
                      )
                    )
                  }
                  className="h-4 w-4 rounded border-[var(--color-border)]"
                />
                Aktiv
              </label>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

