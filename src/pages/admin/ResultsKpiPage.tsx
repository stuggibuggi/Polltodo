import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { api, type QuestionnaireKpiOverviewRow } from '../../lib/api'
import type { Questionnaire } from '../../types/questionnaire'
import { Card, CardContent, CardHeader } from '../../components/ui/card'
import { DotsInfinityLoader } from '../../components/layout/DotsInfinityLoader'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

function percent(part: number, total: number) {
  if (total <= 0) return 0
  return Math.round((part / total) * 1000) / 10
}

export function ResultsKpiPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [questionnaires, setQuestionnaires] = useState<Questionnaire[]>([])
  const [loading, setLoading] = useState(true)
  const [overviewLoading, setOverviewLoading] = useState(false)
  const [selectedOverviewQuestionnaireId, setSelectedOverviewQuestionnaireId] = useState('')
  const [overviewRows, setOverviewRows] = useState<QuestionnaireKpiOverviewRow[]>([])
  const [overviewTitle, setOverviewTitle] = useState('')
  const [detailStatusFilter, setDetailStatusFilter] = useState<'ALL' | QuestionnaireKpiOverviewRow['status']>('ALL')
  const [detailSearch, setDetailSearch] = useState('')

  useEffect(() => {
    let active = true
    api
      .listQuestionnaires({ includeDeleted: true, withStats: true })
      .then((items) => {
        if (!active) return
        setQuestionnaires(items)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const totals = useMemo(() => {
    const all = questionnaires
    const active = all.filter((q) => !q.deletedAt)
    const published = active.filter((q) => q.status === 'PUBLISHED').length
    const draft = active.filter((q) => q.status === 'DRAFT').length
    const deleted = all.filter((q) => !!q.deletedAt).length
    const objectCount = active.reduce((sum, q) => sum + (q.stats?.objectCount ?? 0), 0)
    const personCount = active.reduce((sum, q) => sum + (q.stats?.personCount ?? 0), 0)
    const openCount = active.reduce((sum, q) => sum + (q.stats?.openCount ?? 0), 0)
    const completedCount = active.reduce((sum, q) => sum + (q.stats?.completedCount ?? 0), 0)
    const totalTaskCount = active.reduce((sum, q) => sum + (q.stats?.totalTaskCount ?? 0), 0)
    return {
      questionnaireCount: all.length,
      published,
      draft,
      deleted,
      objectCount,
      personCount,
      openCount,
      completedCount,
      totalTaskCount,
      completionRate: percent(completedCount, openCount + completedCount),
    }
  }, [questionnaires])

  const sorted = useMemo(
    () =>
      questionnaires
        .filter((q) => !q.deletedAt)
        .sort((a, b) => {
          const aOpen = a.stats?.openCount ?? 0
          const bOpen = b.stats?.openCount ?? 0
          if (bOpen !== aOpen) return bOpen - aOpen
          return a.title.localeCompare(b.title)
        }),
    [questionnaires]
  )

  const queryQuestionnaireId = searchParams.get('questionnaireId') ?? ''

  const applySelectedOverviewQuestionnaireId = (nextId: string) => {
    setSelectedOverviewQuestionnaireId(nextId)
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('questionnaireId', nextId)
    setSearchParams(nextParams, { replace: true })
  }

  useEffect(() => {
    if (sorted.length === 0) return
    if (selectedOverviewQuestionnaireId && sorted.some((item) => item.id === selectedOverviewQuestionnaireId)) {
      return
    }
    const nextId =
      queryQuestionnaireId && sorted.some((item) => item.id === queryQuestionnaireId)
        ? queryQuestionnaireId
        : sorted[0].id
    setSelectedOverviewQuestionnaireId(nextId)
  }, [queryQuestionnaireId, selectedOverviewQuestionnaireId, sorted])

  const completionByCatalog = useMemo(
    () =>
      sorted.slice(0, 14).map((q) => {
        const openCount = q.stats?.openCount ?? 0
        const doneCount = q.stats?.completedCount ?? 0
        return {
          title: q.title,
          openCount,
          doneCount,
          doneRate: percent(doneCount, openCount + doneCount),
        }
      }),
    [sorted]
  )

  const statusData = useMemo(
    () => [
      { name: 'Publiziert', value: totals.published, color: '#22c55e' },
      { name: 'Entwurf', value: totals.draft, color: '#f59e0b' },
      { name: 'Geloescht', value: totals.deleted, color: '#ef4444' },
    ],
    [totals.deleted, totals.draft, totals.published]
  )

  useEffect(() => {
    if (!selectedOverviewQuestionnaireId) {
      setOverviewRows([])
      setOverviewTitle('')
      return
    }
    let active = true
    setOverviewLoading(true)
    api
      .getQuestionnaireKpiOverview(selectedOverviewQuestionnaireId)
      .then((payload) => {
        if (!active) return
        setOverviewRows(payload.rows)
        setOverviewTitle(payload.questionnaireTitle)
      })
      .finally(() => {
        if (active) setOverviewLoading(false)
      })
    return () => {
      active = false
    }
  }, [selectedOverviewQuestionnaireId])

  const statusLabel = (status: QuestionnaireKpiOverviewRow['status']) => {
    if (status === 'IN_PROGRESS') return 'In Bearbeitung'
    if (status === 'OPEN') return 'Offen'
    if (status === 'DONE') return 'Erledigt'
    return 'Kein Task'
  }

  const filteredOverviewRows = useMemo(() => {
    const token = detailSearch.trim().toLowerCase()
    return overviewRows.filter((row) => {
      if (detailStatusFilter !== 'ALL' && row.status !== detailStatusFilter) return false
      if (!token) return true
      const people = row.eligibleUsers
        .map((person) => `${person.displayName ?? ''} ${person.email}`.toLowerCase())
        .join(' ')
      const editor = row.currentEditor
        ? `${row.currentEditor.displayName ?? ''} ${row.currentEditor.email}`.toLowerCase()
        : ''
      const haystack = `${row.questionnaireTitle} ${row.objectName} ${row.objectExternalId ?? ''} ${row.objectId} ${statusLabel(
        row.status
      )} ${people} ${editor}`.toLowerCase()
      return haystack.includes(token)
    })
  }, [detailSearch, detailStatusFilter, overviewRows])

  const exportOverviewExcel = () => {
    if (!selectedOverviewQuestionnaireId || filteredOverviewRows.length === 0) return
    const rows = filteredOverviewRows.map((row) => ({
      questionnaire_id: row.questionnaireId,
      questionnaire_title: row.questionnaireTitle,
      object_id: row.objectId,
      object_name: row.objectName,
      object_external_id: row.objectExternalId ?? '',
      status: statusLabel(row.status),
      direct_link: `${window.location.origin}${row.directPath}`,
      eligible_people: row.eligibleUsers
        .map((person) => `${person.displayName?.trim() || '-'} <${person.email}>`)
        .join(' | '),
      current_editor: row.currentEditor
        ? `${row.currentEditor.displayName?.trim() || '-'} <${row.currentEditor.email}>`
        : '',
    }))
    const workbook = XLSX.utils.book_new()
    const sheet = XLSX.utils.json_to_sheet(rows)
    XLSX.utils.book_append_sheet(workbook, sheet, 'kpi_overview')
    const title = (overviewTitle || selectedOverviewQuestionnaireId).replace(/[^a-z0-9-_]+/gi, '_')
    XLSX.writeFile(workbook, `kpi_overview_${title}.xlsx`)
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <DotsInfinityLoader />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-[var(--color-foreground)]">KPI Uebersicht</h2>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardHeader>
            <h3 className="text-sm font-medium">Fragenkataloge</h3>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{totals.questionnaireCount}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <h3 className="text-sm font-medium">Publiziert / Entwurf</h3>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {totals.published} / {totals.draft}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <h3 className="text-sm font-medium">Offene / Erledigte Aufgaben</h3>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {totals.openCount} / {totals.completedCount}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <h3 className="text-sm font-medium">Erledigungsquote</h3>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{totals.completionRate}%</CardContent>
        </Card>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardHeader>
            <h3 className="text-sm font-medium">Zugeordnete Objekte (Summe)</h3>
          </CardHeader>
          <CardContent className="text-xl font-semibold">{totals.objectCount}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <h3 className="text-sm font-medium">Zugeordnete Personen (Summe)</h3>
          </CardHeader>
          <CardContent className="text-xl font-semibold">{totals.personCount}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <h3 className="text-sm font-medium">Tasks gesamt</h3>
          </CardHeader>
          <CardContent className="text-xl font-semibold">{totals.totalTaskCount}</CardContent>
        </Card>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <h3 className="font-medium">Katalog-Status Verteilung</h3>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={statusData} dataKey="value" nameKey="name" outerRadius={90} labelLine={false}>
                  {statusData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-card)',
                    color: 'var(--color-foreground)',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="font-medium">Offen vs Erledigt je Fragenkatalog</h3>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={completionByCatalog} margin={{ top: 8, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis
                  dataKey="title"
                  tick={{ fill: 'var(--color-muted)', fontSize: 11 }}
                  tickFormatter={(value: string) => (value.length > 16 ? `${value.slice(0, 16)}...` : value)}
                />
                <YAxis tick={{ fill: 'var(--color-muted)', fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-card)',
                    color: 'var(--color-foreground)',
                  }}
                />
                <Bar dataKey="openCount" stackId="tasks" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                <Bar dataKey="doneCount" stackId="tasks" fill="#22c55e" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <h3 className="font-medium">KPI pro Fragenkatalog</h3>
        </CardHeader>
        <CardContent className="space-y-3">
          {sorted.map((q) => {
            const openCount = q.stats?.openCount ?? 0
            const doneCount = q.stats?.completedCount ?? 0
            const doneRate = percent(doneCount, openCount + doneCount)
            return (
              <div key={q.id} className="rounded-md border border-[var(--color-border)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">{q.title}</div>
                  <div className="text-xs text-[var(--color-muted)]">
                    Status: {q.status ?? '-'} {q.deletedAt ? '| geloescht' : ''}
                  </div>
                </div>
                <div className="mt-2 grid gap-2 text-xs text-[var(--color-muted)] md:grid-cols-5">
                  <div>Objekte: {q.stats?.objectCount ?? 0}</div>
                  <div>Objektgruppen: {q.stats?.objectGroupCount ?? 0}</div>
                  <div>Personen: {q.stats?.personCount ?? 0}</div>
                  <div>Offen: {openCount}</div>
                  <div>Erledigt: {doneCount}</div>
                </div>
                <div className="mt-2 text-xs text-[var(--color-muted)]">Erledigungsquote: {doneRate}%</div>
              </div>
            )
          })}
          {sorted.length === 0 && (
            <div className="text-sm text-[var(--color-muted)]">Keine KPI-Daten vorhanden.</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-medium">Detailuebersicht pro Fragenkatalog</h3>
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-72">
                  <Select
                  value={selectedOverviewQuestionnaireId}
                  onValueChange={applySelectedOverviewQuestionnaireId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Fragenkatalog waehlen" />
                  </SelectTrigger>
                  <SelectContent>
                    {sorted.map((q) => (
                      <SelectItem key={q.id} value={q.id}>
                        {q.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Select
                value={detailStatusFilter}
                onValueChange={(value) =>
                  setDetailStatusFilter(value as 'ALL' | QuestionnaireKpiOverviewRow['status'])
                }
              >
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Status filtern" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Alle Status</SelectItem>
                  <SelectItem value="OPEN">Offen</SelectItem>
                  <SelectItem value="IN_PROGRESS">In Bearbeitung</SelectItem>
                  <SelectItem value="DONE">Erledigt</SelectItem>
                  <SelectItem value="NO_TASK">Kein Task</SelectItem>
                </SelectContent>
              </Select>
              <Input
                className="w-72"
                value={detailSearch}
                onChange={(event) => setDetailSearch(event.target.value)}
                placeholder="Suche Objekt/Person/Bearbeiter"
              />
              <Button variant="outline" onClick={exportOverviewExcel} disabled={filteredOverviewRows.length === 0}>
                Excel exportieren
              </Button>
            </div>
          </div>
          {selectedOverviewQuestionnaireId && (
            <div className="text-xs text-[var(--color-muted)]">
              Direktlink:{' '}
              <a
                href={`/admin/results/kpis?questionnaireId=${encodeURIComponent(selectedOverviewQuestionnaireId)}`}
                className="text-[var(--color-primary)] underline"
              >
                /admin/results/kpis?questionnaireId={selectedOverviewQuestionnaireId}
              </a>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {overviewLoading ? (
            <div className="text-sm text-[var(--color-muted)]">Detailuebersicht wird geladen...</div>
          ) : filteredOverviewRows.length === 0 ? (
            <div className="text-sm text-[var(--color-muted)]">Keine Daten fuer den gewaelten Fragenkatalog.</div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs text-[var(--color-muted)]">Treffer: {filteredOverviewRows.length}</div>
              <div className="overflow-auto">
              <table className="min-w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-muted)]">
                    <th className="px-2 py-2">Umfrage</th>
                    <th className="px-2 py-2">Objekt</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Direktlink</th>
                    <th className="px-2 py-2">Berechtigte Personen</th>
                    <th className="px-2 py-2">Aktueller Bearbeiter</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOverviewRows.map((row) => (
                    <tr key={`${row.questionnaireId}-${row.objectId}`} className="border-b border-[var(--color-border)]/60 align-top">
                      <td className="px-2 py-2">
                        <div className="font-medium">{row.questionnaireTitle}</div>
                      </td>
                      <td className="px-2 py-2">
                        <div>{row.objectName}</div>
                        <div className="text-xs text-[var(--color-muted)]">
                          ID: {row.objectExternalId || row.objectId}
                        </div>
                      </td>
                      <td className="px-2 py-2">{statusLabel(row.status)}</td>
                      <td className="px-2 py-2">
                        <a
                          href={row.directPath}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--color-primary)] underline"
                        >
                          Oeffnen
                        </a>
                      </td>
                      <td className="px-2 py-2">
                        {row.eligibleUsers.length > 0 ? (
                          <div className="space-y-1">
                            {row.eligibleUsers.map((person) => (
                              <div key={person.id} className="text-xs">
                                {(person.displayName?.trim() || '-') + ' | ' + person.email}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-[var(--color-muted)]">-</span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {row.currentEditor
                          ? `${row.currentEditor.displayName?.trim() || '-'} | ${row.currentEditor.email}`
                          : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
