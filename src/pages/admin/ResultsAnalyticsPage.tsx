import { useEffect, useMemo, useState } from 'react'
import { api, type SubmissionRecord } from '../../lib/api'
import type { Question, Questionnaire } from '../../types/questionnaire'
import { Card, CardContent, CardHeader } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import { DotsInfinityLoader } from '../../components/layout/DotsInfinityLoader'
import { decodeCustomOptionValue } from '../../lib/custom-options'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

type OptionRow = { label: string; count: number }
type QuestionStats = {
  questionId: string
  title: string
  type: string
  answeredSubmissions: number
  denominator: number
  options: OptionRow[]
}
type TrendGranularity = 'month' | 'quarter'

const SUPPORTED_TYPES = new Set(['single', 'multi', 'boolean', 'likert', 'percentage'])
const CHART_COLORS = ['#2563eb', '#0ea5e9', '#06b6d4', '#14b8a6', '#22c55e', '#f59e0b', '#f97316']

function toNumeric(value: string): number | null {
  const normalized = value.replace(',', '.').replace(/[^\d.-]/g, '')
  const number = Number(normalized)
  return Number.isFinite(number) ? number : null
}

function sortOptionsByType(options: OptionRow[], type: string): OptionRow[] {
  if (type === 'likert' || type === 'percentage') {
    return [...options].sort((a, b) => {
      const aNum = toNumeric(a.label)
      const bNum = toNumeric(b.label)
      if (aNum === null && bNum === null) return b.count - a.count
      if (aNum === null) return 1
      if (bNum === null) return -1
      return aNum - bNum
    })
  }
  return [...options].sort((a, b) => b.count - a.count)
}

function getSnapshotSections(submission: SubmissionRecord, questionnaire: Questionnaire) {
  if (submission.questionnaireSnapshot && Array.isArray(submission.questionnaireSnapshot.sections)) {
    return submission.questionnaireSnapshot.sections
  }
  return questionnaire.sections
}

function toDisplayLabel(question: Question, raw: unknown): string {
  if (typeof raw === 'boolean') return raw ? 'Ja' : 'Nein'
  const value = String(raw ?? '').trim()
  if (!value) return '-'
  const option = question.options?.find((entry) => entry.value === value || entry.label === value)
  if (option?.label) return option.label
  const custom = decodeCustomOptionValue(value)
  if (custom) return `${custom} (added)`
  return value
}

export function ResultsAnalyticsPage() {
  const [questionnaires, setQuestionnaires] = useState<Questionnaire[]>([])
  const [selectedQuestionnaireId, setSelectedQuestionnaireId] = useState('')
  const [submissions, setSubmissions] = useState<SubmissionRecord[]>([])
  const [loadingCatalogs, setLoadingCatalogs] = useState(true)
  const [loadingSubmissions, setLoadingSubmissions] = useState(false)
  const [questionFilter, setQuestionFilter] = useState('')
  const [trendGranularity, setTrendGranularity] = useState<TrendGranularity>('month')

  useEffect(() => {
    let active = true
    api
      .listQuestionnaires({ includeDeleted: true })
      .then((items) => {
        if (!active) return
        setQuestionnaires(items)
        if (items.length > 0) setSelectedQuestionnaireId(items[0].id)
      })
      .finally(() => {
        if (active) setLoadingCatalogs(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!selectedQuestionnaireId) {
      setSubmissions([])
      return
    }
    let active = true
    setLoadingSubmissions(true)
    api
      .listSubmissions(selectedQuestionnaireId)
      .then((items) => {
        if (!active) return
        setSubmissions(items)
      })
      .finally(() => {
        if (active) setLoadingSubmissions(false)
      })
    return () => {
      active = false
    }
  }, [selectedQuestionnaireId])

  const selectedQuestionnaire = useMemo(
    () => questionnaires.find((item) => item.id === selectedQuestionnaireId) ?? null,
    [questionnaires, selectedQuestionnaireId]
  )

  const stats = useMemo<QuestionStats[]>(() => {
    if (!selectedQuestionnaire) return []
    const questions = selectedQuestionnaire.sections.flatMap((section) => section.questions)
    const result: QuestionStats[] = []

    questions.forEach((question) => {
      if (!SUPPORTED_TYPES.has(question.type)) return
      const counter = new Map<string, number>()
      let answeredSubmissions = 0
      let denominator = 0

      submissions.forEach((submission) => {
        const sections = getSnapshotSections(submission, selectedQuestionnaire)
        const snapshotQuestion = sections
          .flatMap((section) => section.questions)
          .find((entry) => entry.id === question.id)
        const q = snapshotQuestion ?? question
        const raw = submission.answers?.[question.id]
        const isEmpty =
          raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0)
        if (isEmpty) return

        answeredSubmissions += 1
        if (Array.isArray(raw)) {
          const labels = raw
            .map((entry) => toDisplayLabel(q, entry))
            .filter((entry) => entry !== '-')
          denominator += labels.length
          labels.forEach((label) => counter.set(label, (counter.get(label) ?? 0) + 1))
          return
        }
        const label = toDisplayLabel(q, raw)
        if (label === '-') return
        denominator += 1
        counter.set(label, (counter.get(label) ?? 0) + 1)
      })

      const options = sortOptionsByType(
        Array.from(counter.entries()).map(([label, count]) => ({ label, count })),
        question.type
      )

      result.push({
        questionId: question.id,
        title: question.title || question.id,
        type: question.type,
        answeredSubmissions,
        denominator: Math.max(denominator, 1),
        options,
      })
    })

    return result
  }, [selectedQuestionnaire, submissions])

  const filteredStats = useMemo(() => {
    const token = questionFilter.trim().toLowerCase()
    if (!token) return stats
    return stats.filter((entry) => {
      const hay = `${entry.title} ${entry.questionId} ${entry.type}`.toLowerCase()
      return hay.includes(token)
    })
  }, [questionFilter, stats])

  const trendData = useMemo(() => {
    const map = new Map<string, { label: string; count: number; sortKey: string }>()
    submissions.forEach((submission) => {
      const date = new Date(submission.submittedAt)
      if (Number.isNaN(date.getTime())) return
      const year = date.getFullYear()
      if (trendGranularity === 'quarter') {
        const quarter = Math.floor(date.getMonth() / 3) + 1
        const key = `${year}-Q${quarter}`
        const current = map.get(key) ?? { label: `${year} Q${quarter}`, count: 0, sortKey: `${year}-${quarter}` }
        current.count += 1
        map.set(key, current)
        return
      }
      const month = `${date.getMonth() + 1}`.padStart(2, '0')
      const key = `${year}-${month}`
      const current = map.get(key) ?? { label: key, count: 0, sortKey: key }
      current.count += 1
      map.set(key, current)
    })
    return Array.from(map.values()).sort((a, b) => a.sortKey.localeCompare(b.sortKey))
  }, [submissions, trendGranularity])

  if (loadingCatalogs) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <DotsInfinityLoader />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-[var(--color-foreground)]">Grafische Auswertung</h2>
      </div>

      <Card>
        <CardHeader>
          <h3 className="font-medium">Filter</h3>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_1fr]">
          <Select value={selectedQuestionnaireId} onValueChange={setSelectedQuestionnaireId}>
            <SelectTrigger>
              <SelectValue placeholder="Fragenkatalog waehlen" />
            </SelectTrigger>
            <SelectContent>
              {questionnaires.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="Frage filtern (Titel/ID/Typ)"
            value={questionFilter}
            onChange={(event) => setQuestionFilter(event.target.value)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="font-medium">Uebersicht</h3>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-3">
          <div className="rounded-md border border-[var(--color-border)] p-3">
            Fragebogen: {selectedQuestionnaire?.title ?? '-'}
          </div>
          <div className="rounded-md border border-[var(--color-border)] p-3">
            Durchfuehrungen: {submissions.length}
          </div>
          <div className="rounded-md border border-[var(--color-border)] p-3">
            Auswertbare Fragen: {stats.length}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-medium">Zeitverlauf Einreichungen</h3>
            <div className="w-48">
              <Select
                value={trendGranularity}
                onValueChange={(value) => setTrendGranularity(value as TrendGranularity)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="month">Monat</SelectItem>
                  <SelectItem value="quarter">Quartal</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="h-72">
          {trendData.length === 0 ? (
            <div className="text-sm text-[var(--color-muted)]">Noch keine zeitlichen Daten vorhanden.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="label" tick={{ fill: 'var(--color-muted)', fontSize: 11 }} />
                <YAxis tick={{ fill: 'var(--color-muted)', fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-card)',
                    color: 'var(--color-foreground)',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {loadingSubmissions ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <DotsInfinityLoader />
        </div>
      ) : filteredStats.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-[var(--color-muted)]">
            Keine Daten zur Auswertung gefunden.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredStats.map((entry) => (
            <Card key={entry.questionId}>
              <CardHeader>
                <h3 className="font-medium">{entry.title}</h3>
                <div className="text-xs text-[var(--color-muted)]">
                  ID: {entry.questionId} | Typ: {entry.type} | beantwortet: {entry.answeredSubmissions}
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {entry.options.length === 0 ? (
                  <div className="text-xs text-[var(--color-muted)]">Keine Antworten vorhanden.</div>
                ) : (
                  <>
                    {entry.type === 'boolean' || (entry.type === 'single' && entry.options.length <= 5) ? (
                      <div className="h-72 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={entry.options.slice(0, 8).map((opt) => ({
                                label: opt.label,
                                value: opt.count,
                              }))}
                              dataKey="value"
                              nameKey="label"
                              cx="50%"
                              cy="50%"
                              innerRadius={55}
                              outerRadius={95}
                              labelLine={false}
                            >
                              {entry.options.slice(0, 8).map((opt, index) => (
                                <Cell
                                  key={`${entry.questionId}-${opt.label}-pie`}
                                  fill={CHART_COLORS[index % CHART_COLORS.length]}
                                />
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
                      </div>
                    ) : entry.type === 'multi' || entry.type === 'likert' || entry.type === 'percentage' ? (
                      <div className="h-80 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            layout="vertical"
                            data={entry.options.slice(0, 12).map((opt) => ({
                              label: opt.label,
                              count: opt.count,
                              ratio: Math.round((opt.count / entry.denominator) * 1000) / 10,
                            }))}
                            margin={{ top: 8, right: 24, left: 24, bottom: 0 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                            <XAxis type="number" tick={{ fill: 'var(--color-muted)', fontSize: 11 }} allowDecimals={false} />
                            <YAxis
                              type="category"
                              dataKey="label"
                              width={160}
                              tick={{ fill: 'var(--color-muted)', fontSize: 11 }}
                              tickFormatter={(value: string) =>
                                value.length > 22 ? `${value.slice(0, 22)}...` : value
                              }
                            />
                            <Tooltip
                              contentStyle={{
                                border: '1px solid var(--color-border)',
                                background: 'var(--color-card)',
                                color: 'var(--color-foreground)',
                              }}
                            />
                            <Bar dataKey="count" radius={[0, 4, 4, 0]} fill="#0ea5e9" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="h-72 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={entry.options.slice(0, 12).map((opt) => ({
                              label: opt.label,
                              count: opt.count,
                              ratio: Math.round((opt.count / entry.denominator) * 1000) / 10,
                            }))}
                            margin={{ top: 8, right: 10, left: 10, bottom: 0 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                            <XAxis
                              dataKey="label"
                              tick={{ fill: 'var(--color-muted)', fontSize: 11 }}
                              tickFormatter={(value: string) =>
                                value.length > 16 ? `${value.slice(0, 16)}...` : value
                              }
                            />
                            <YAxis tick={{ fill: 'var(--color-muted)', fontSize: 11 }} allowDecimals={false} />
                            <Tooltip
                              contentStyle={{
                                border: '1px solid var(--color-border)',
                                background: 'var(--color-card)',
                                color: 'var(--color-foreground)',
                              }}
                            />
                            <Bar dataKey="count" radius={[4, 4, 0, 0]} fill="var(--color-primary)" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                    <div className="space-y-1 text-xs text-[var(--color-muted)]">
                      {entry.options.slice(0, 12).map((opt, index) => {
                        const ratio = Math.round((opt.count / entry.denominator) * 1000) / 10
                        return (
                          <div key={`${entry.questionId}-${opt.label}-legend`} className="flex items-center gap-2">
                            <span
                              className="inline-block h-2 w-2 rounded-full"
                              style={{
                                backgroundColor:
                                  entry.type === 'boolean' || (entry.type === 'single' && entry.options.length <= 5)
                                    ? CHART_COLORS[index % CHART_COLORS.length]
                                    : entry.type === 'multi' || entry.type === 'likert' || entry.type === 'percentage'
                                      ? '#0ea5e9'
                                      : 'var(--color-primary)',
                              }}
                            />
                            <span className="truncate">{opt.label}</span>
                            <span className="ml-auto">
                              {opt.count} ({ratio}%)
                            </span>
                          </div>
                        )
                      })}
                      {entry.options.length > 12 && (
                        <div>Nur die Top 12 Antwortoptionen werden im Chart angezeigt.</div>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
