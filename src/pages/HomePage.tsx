import { Link, Navigate } from 'react-router-dom'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { AppLayout } from '../components/layout/AppLayout'
import { DotsInfinityLoader } from '../components/layout/DotsInfinityLoader'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { useAuth } from '../lib/auth'
import { api, type HomePageConfig, type ObjectSurveyTask, type SubmissionRecord } from '../lib/api'
import type { Questionnaire } from '../types/questionnaire'
import { sanitizeRichHtml } from '../lib/rich-text'
import { loadUserScopedState, saveUserScopedState } from '../lib/filterState'
import { useTheme } from '../lib/theme'

const DEFAULT_HOME_CONFIG: HomePageConfig = {
  title: 'Anwendungs-Fragenkatalog',
  subtitle: 'Waehlen Sie einen Fragebogen zum Ausfuellen.',
  descriptionHtml: '',
  faviconDataUrl: '',
  welcomeContentHtml:
    '<h2>Willkommen bei ICTOMAT</h2><p>Offene Umfragen, globale Kataloge und Historie auf einen Blick.</p>',
  headingOpenTasks: 'Offene Umfragen',
  headingGlobalCatalogs: 'Globale Fragenkataloge',
  headingClosedTasks: 'Abgeschlossene Umfragen',
  tileOpenTitle: 'Offene Umfragen',
  tileOpenDescription: 'Zeigt alle Ihnen zugewiesenen offenen Umfragen.',
  tileOpenBackgroundColor: '#fffbeb',
  tileOpenBackgroundColorDark: '#3a2f15',
  tileGlobalTitle: 'Allgemeine Fragenkataloge',
  tileGlobalDescription: 'Zeigt globale Fragenkataloge fuer alle Benutzer.',
  tileGlobalBackgroundColor: '#eff6ff',
  tileGlobalBackgroundColorDark: '#172d45',
  tileHistoryTitle: 'Bereits durchgefuehrte Umfragen',
  tileHistoryDescription: 'Zeigt abgeschlossene Umfragen und Historie.',
  tileHistoryBackgroundColor: '#ecfdf5',
  tileHistoryBackgroundColorDark: '#143427',
  showOpenTasks: true,
  showGlobalCatalogs: true,
  showClosedTasks: true,
  openTasksGrouping: 'object_group',
  defaultRouteAfterLogin: '/',
}

type HomeSection = 'none' | 'open' | 'global' | 'history'

const tileColorPreset: Record<string, string> = {
  blue: '#3b82f6',
  green: '#10b981',
  amber: '#f59e0b',
  rose: '#f43f5e',
  slate: '#64748b',
}

function toAttrSet(input: unknown): Set<string> {
  return new Set(Array.isArray(input) ? input.filter((v): v is string => typeof v === 'string') : [])
}

function resolveTileColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim().toLowerCase()
  if (!raw || raw === 'default') return null
  if (tileColorPreset[raw]) return tileColorPreset[raw]
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)) return raw
  return null
}

function hasAttr(attrs: Set<string>, key: string) {
  return attrs.has(key)
}

function tileAccentStyle(color: string | null): CSSProperties | undefined {
  if (!color) return undefined
  return {
    borderLeftWidth: '18px',
    borderLeftStyle: 'solid',
    borderLeftColor: color,
  }
}

function resolveDashboardTileBackground(value: string | undefined, fallback: string) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)) return raw
  return fallback
}

export function HomePage() {
  const { user, loading } = useAuth()
  const { theme } = useTheme()
  const [tasks, setTasks] = useState<ObjectSurveyTask[]>([])
  const [globalCatalogs, setGlobalCatalogs] = useState<Questionnaire[]>([])
  const [closedGlobalSubmissions, setClosedGlobalSubmissions] = useState<SubmissionRecord[]>([])
  const [homeConfig, setHomeConfig] = useState<HomePageConfig>(DEFAULT_HOME_CONFIG)
  const [error, setError] = useState<string | null>(null)
  const [loadingTasks, setLoadingTasks] = useState(false)
  const [filterText, setFilterText] = useState('')
  const [pageSize, setPageSize] = useState(10)
  const [page, setPage] = useState(1)
  const [openQuestionnaireFilter, setOpenQuestionnaireFilter] = useState('__all__')
  const [openSort, setOpenSort] = useState<'due_asc' | 'due_desc' | 'title_asc' | 'title_desc'>('due_asc')
  const [globalFilterText, setGlobalFilterText] = useState('')
  const [globalQuestionnaireFilter, setGlobalQuestionnaireFilter] = useState('__all__')
  const [globalSort, setGlobalSort] = useState<'title_asc' | 'title_desc' | 'date_desc' | 'date_asc'>('title_asc')
  const [globalPageSize, setGlobalPageSize] = useState(10)
  const [globalPage, setGlobalPage] = useState(1)
  const [historyFilterText, setHistoryFilterText] = useState('')
  const [historyQuestionnaireFilter, setHistoryQuestionnaireFilter] = useState('__all__')
  const [historySort, setHistorySort] = useState<'date_desc' | 'date_asc' | 'title_asc' | 'title_desc'>('date_desc')
  const [historyPageSize, setHistoryPageSize] = useState(10)
  const [historyPage, setHistoryPage] = useState(1)
  const [activeSection, setActiveSection] = useState<HomeSection>('global')
  const [favoriteQuestionnaireIds, setFavoriteQuestionnaireIds] = useState<string[]>([])
  const [onlyFavorites, setOnlyFavorites] = useState(false)
  const [savingNoteBySubmissionId, setSavingNoteBySubmissionId] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const state = loadUserScopedState(user?.id, 'home-open-tasks', {
      filterText: '',
      pageSize: 10,
      page: 1,
      questionnaireFilter: '__all__',
      sort: 'due_asc',
    })
    setFilterText(state.filterText)
    setPageSize(state.pageSize)
    setPage(state.page)
    setOpenQuestionnaireFilter(state.questionnaireFilter ?? '__all__')
    setOpenSort(
      state.sort === 'due_desc' || state.sort === 'title_asc' || state.sort === 'title_desc'
        ? state.sort
        : 'due_asc'
    )
  }, [user?.id])

  useEffect(() => {
    const state = loadUserScopedState(user?.id, 'home-favorite-questionnaires', {
      ids: [] as string[],
      onlyFavorites: false,
    })
    setFavoriteQuestionnaireIds(Array.isArray(state.ids) ? state.ids.filter((v) => typeof v === 'string') : [])
    setOnlyFavorites(Boolean(state.onlyFavorites))
  }, [user?.id])

  useEffect(() => {
    saveUserScopedState(user?.id, 'home-open-tasks', {
      filterText,
      pageSize,
      page,
      questionnaireFilter: openQuestionnaireFilter,
      sort: openSort,
    })
  }, [user?.id, filterText, pageSize, page, openQuestionnaireFilter, openSort])

  useEffect(() => {
    saveUserScopedState(user?.id, 'home-favorite-questionnaires', {
      ids: favoriteQuestionnaireIds,
      onlyFavorites,
    })
  }, [user?.id, favoriteQuestionnaireIds, onlyFavorites])

  useEffect(() => {
    if (!user) return
    setLoadingTasks(true)
    Promise.all([
      api.listMyObjectTasks(),
      api.listMyQuestionnaires('current'),
      api.listMySubmissions(),
      api.getMyHomeConfig(),
    ])
      .then(([taskList, questionnaires, submissions, cfg]) => {
        setTasks(taskList)
        setGlobalCatalogs(questionnaires.filter((q) => q.globalForAllUsers))
        setClosedGlobalSubmissions(
          submissions.filter((s) => s.questionnaire?.globalForAllUsers)
        )
        setHomeConfig(cfg)
        setActiveSection('global')
      })
      .catch(() => setError('Aktuelle Umfragen konnten nicht geladen werden.'))
      .finally(() => setLoadingTasks(false))
  }, [user])

  const openTasks = tasks.filter((t) => t.status === 'OPEN')
  const closedTasks = tasks.filter((t) => t.status !== 'OPEN')
  const favoriteSet = useMemo(() => new Set(favoriteQuestionnaireIds), [favoriteQuestionnaireIds])

  const toggleFavorite = (questionnaireId?: string | null) => {
    const qid = (questionnaireId ?? '').trim()
    if (!qid) return
    setFavoriteQuestionnaireIds((prev) =>
      prev.includes(qid) ? prev.filter((entry) => entry !== qid) : [...prev, qid]
    )
  }

  const favoriteButton = (questionnaireId?: string | null) => {
    const qid = (questionnaireId ?? '').trim()
    const isFav = !!qid && favoriteSet.has(qid)
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-pressed={isFav}
        className={`h-9 w-9 min-w-9 rounded-full border p-0 text-[22px] leading-none transition ${
          isFav
            ? 'border-amber-400 text-amber-500 bg-amber-100/20'
            : 'border-[var(--color-border)] text-[var(--color-muted)]'
        }`}
        onClick={() => toggleFavorite(qid)}
        title={isFav ? 'Favorit entfernen' : 'Als Favorit markieren'}
      >
        {isFav ? '\u2605' : '\u2606'}
      </Button>
    )
  }

  const editSubmissionNote = async (submissionId: string, currentNote?: string | null) => {
    const next = window.prompt(
      'Hinweis zur durchgefuehrten Umfrage (leer lassen, um Hinweis zu entfernen):',
      currentNote ?? ''
    )
    if (next === null) return
    const normalized = next.replace(/\r?\n/g, ' ').trim()
    setSavingNoteBySubmissionId((prev) => ({ ...prev, [submissionId]: true }))
    try {
      const result = await api.updateMySubmissionNote(submissionId, normalized || undefined)
      setClosedGlobalSubmissions((prev) =>
        prev.map((entry) =>
          entry.id === submissionId
            ? { ...entry, submissionNote: result.submissionNote ?? null }
            : entry
        )
      )
      setTasks((prev) =>
        prev.map((entry) =>
          entry.submissionId === submissionId
            ? { ...entry, submissionNote: result.submissionNote ?? null }
            : entry
        )
      )
    } catch {
      setError('Hinweis konnte nicht gespeichert werden.')
    } finally {
      setSavingNoteBySubmissionId((prev) => ({ ...prev, [submissionId]: false }))
    }
  }

  const groupTasksByObjectGroup = (list: ObjectSurveyTask[]) => {
    const groups = new Map<string, { name: string; objects: Map<string, { name: string; tasks: ObjectSurveyTask[] }> }>()
    list.forEach((task) => {
      const objectName = task.object?.name ?? 'Unbekanntes Objekt'
      const memberships = task.object?.groupMemberships ?? []
      const policyGroupIdRaw = task.policy?.createdByObjectGroupId ?? null
      const policyGroupId =
        policyGroupIdRaw && !policyGroupIdRaw.startsWith('override:')
          ? policyGroupIdRaw
          : null
      const policyGroupMatch = policyGroupId
        ? memberships.find((m) => m.group.id === policyGroupId)
        : undefined
      const groupList = policyGroupMatch
        ? [{ id: policyGroupMatch.group.id, name: policyGroupMatch.group.name }]
        : memberships.length
          ? memberships.map((m) => ({ id: m.group.id, name: m.group.name }))
          : [{ id: 'none', name: 'Ohne Objektgruppe' }]
      groupList.forEach((g) => {
        const groupEntry = groups.get(g.id) ?? { name: g.name, objects: new Map() }
        const objEntry = groupEntry.objects.get(task.objectId) ?? { name: objectName, tasks: [] }
        objEntry.tasks.push(task)
        groupEntry.objects.set(task.objectId, objEntry)
        groups.set(g.id, groupEntry)
      })
    })
    return Array.from(groups.values())
  }

  const groupTasksByObject = (list: ObjectSurveyTask[]) => {
    const objects = new Map<string, { name: string; tasks: ObjectSurveyTask[] }>()
    list.forEach((task) => {
      const objectName = task.object?.name ?? 'Unbekanntes Objekt'
      const entry = objects.get(task.objectId) ?? { name: objectName, tasks: [] }
      entry.tasks.push(task)
      objects.set(task.objectId, entry)
    })
    return Array.from(objects.values())
  }

  const taskRow = (task: ObjectSurveyTask) => {
    const startedByOther =
      task.status === 'OPEN' &&
      !!task.startedByUserId &&
      task.startedByUserId !== user?.id
    const startedBySelf =
      task.status === 'OPEN' &&
      !!task.startedByUserId &&
      task.startedByUserId === user?.id
    const startedLabel = startedBySelf
      ? 'von Ihnen'
      : task.startedBy?.email
        ? `von ${task.startedBy.email}`
        : 'von einem anderen Benutzer'

    const attrs = toAttrSet(task.questionnaire?.homeTileAttributes)
    const tileDescriptionHtml = sanitizeRichHtml(task.questionnaire?.homeTileDescriptionHtml ?? '')
    const tileColor = resolveTileColor(task.questionnaire?.homeTileColor)
    const objectLabel = task.object
      ? `${task.object.externalId ?? task.object.id} - ${task.object.name}`
      : 'Kein Objekt'
    const groupNames = (() => {
      const memberships = task.object?.groupMemberships ?? []
      const policyGroupIdRaw = task.policy?.createdByObjectGroupId ?? null
      const policyGroupId =
        policyGroupIdRaw && !policyGroupIdRaw.startsWith('override:')
          ? policyGroupIdRaw
          : null
      if (policyGroupId) {
        const match = memberships.find((m) => m.group.id === policyGroupId)
        return match ? [match.group.name] : []
      }
      return memberships.map((m) => m.group.name).filter(Boolean)
    })()
    return (
      <Card
        key={task.id}
        className="h-full"
        style={tileAccentStyle(tileColor)}
      >
        <CardContent className="flex h-full flex-col gap-3 p-4">
          <div className="space-y-1">
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium">{task.questionnaire?.title}</div>
              {favoriteButton(task.questionnaire?.id)}
            </div>
            {task.questionnaire?.subtitle && (
              <div className="text-xs text-[var(--color-muted)]">{task.questionnaire.subtitle}</div>
            )}
            {tileDescriptionHtml && (
              <div
                className="prose prose-sm max-w-none text-sm leading-5 text-[var(--color-muted)]"
                dangerouslySetInnerHTML={{ __html: tileDescriptionHtml }}
              />
            )}
            {hasAttr(attrs, 'object') && (
              <div className="text-xs text-[var(--color-muted)]">Objektbezug: {objectLabel}</div>
            )}
            {hasAttr(attrs, 'objectGroup') && groupNames.length > 0 && (
              <div className="text-xs text-[var(--color-muted)]">Objektgruppe: {groupNames.join(', ')}</div>
            )}
            {hasAttr(attrs, 'status') && (
              <div className="text-xs text-[var(--color-muted)]">Status: {task.status}</div>
            )}
            {hasAttr(attrs, 'version') && (
              <div className="text-xs text-[var(--color-muted)]">Version: {task.questionnaire?.version ?? '-'}</div>
            )}
            {hasAttr(attrs, 'globalTag') && task.questionnaire?.globalForAllUsers && (
              <div className="text-xs text-[var(--color-muted)]">Global verfuegbar</div>
            )}
          </div>
          {hasAttr(attrs, 'dueDate') && (
            <div className="text-xs text-[var(--color-muted)]">
              Faellig bis: {new Date(task.dueAt).toLocaleString('de-DE')}
            </div>
          )}
          {task.status === 'OPEN' && task.startedAt && (
            <div className="text-xs text-[var(--color-muted)]">
              Bereits gestartet ({startedLabel}) am {new Date(task.startedAt).toLocaleString('de-DE')}
            </div>
          )}
          <div className="mt-auto">
            {startedByOther ? (
              <Button size="sm" disabled>
                Bereits gestartet
              </Button>
            ) : (
              <Button asChild size="sm">
                <Link to={`/task/${task.id}`}>{startedBySelf ? 'Fortsetzen' : 'Starten'}</Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    )
  }

  const renderGroupedOpen = (list: ObjectSurveyTask[]) => {
    if (homeConfig.openTasksGrouping === 'object') {
      return groupTasksByObject(list).map((obj) => (
        <Card key={obj.name}>
          <CardHeader>
            <h3 className="font-medium">{obj.name}</h3>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {obj.tasks.map((task) => taskRow(task))}
            </div>
          </CardContent>
        </Card>
      ))
    }

    return groupTasksByObjectGroup(list).map((group) => (
      <Card key={group.name}>
        <CardHeader>
          <h3 className="font-medium">{group.name}</h3>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from(group.objects.values()).map((obj) => (
            <div key={obj.name} className="space-y-2">
              <div className="text-sm font-medium text-[var(--color-foreground)]">{obj.name}</div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {obj.tasks.map((task) => taskRow(task))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    ))
  }

  const matchesFilter = (task: ObjectSurveyTask) => {
    const raw = filterText.trim()
    if (!raw) return true
    const q = (task.questionnaire?.title ?? '').toLowerCase()
    const o = (task.object?.name ?? '').toLowerCase()
    const groups = (task.object?.groupMemberships?.map((m) => m.group.name).join(' ') ?? '').toLowerCase()
    const status = task.status.toLowerCase()
    return `${q} ${o} ${groups} ${status}`.includes(raw.toLowerCase())
  }

  const openQuestionnaireOptions = useMemo(
    () => {
      const optionsMap = new Map<string, string>()
      openTasks.forEach((task) => {
        const id = (task.questionnaire?.id ?? task.questionnaireId ?? '').trim()
        if (!id) return
        optionsMap.set(id, task.questionnaire?.title ?? 'Unbekannt')
      })
      return Array.from(optionsMap.entries())
        .map(([id, title]) => ({ id, title }))
        .sort((a, b) => a.title.localeCompare(b.title, 'de'))
    },
    [openTasks]
  )
  useEffect(() => {
    if (openQuestionnaireFilter === '__all__') return
    const exists = openQuestionnaireOptions.some((opt) => opt.id === openQuestionnaireFilter)
    if (!exists) setOpenQuestionnaireFilter('__all__')
  }, [openQuestionnaireFilter, openQuestionnaireOptions])
  const filteredOpen = openTasks
    .filter((task) => {
      if (!matchesFilter(task)) return false
      if (openQuestionnaireFilter !== '__all__') {
        const qid = task.questionnaire?.id ?? task.questionnaireId
        if (qid !== openQuestionnaireFilter) return false
      }
      if (!onlyFavorites) return true
      return !!task.questionnaire?.id && favoriteSet.has(task.questionnaire.id)
    })
    .slice()
    .sort((a, b) => {
      if (openSort === 'title_asc') {
        return (a.questionnaire?.title ?? '').localeCompare(b.questionnaire?.title ?? '', 'de')
      }
      if (openSort === 'title_desc') {
        return (b.questionnaire?.title ?? '').localeCompare(a.questionnaire?.title ?? '', 'de')
      }
      const aTime = new Date(a.dueAt).getTime()
      const bTime = new Date(b.dueAt).getTime()
      return openSort === 'due_desc' ? bTime - aTime : aTime - bTime
    })
  const totalFiltered = filteredOpen.length
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageStart = (currentPage - 1) * pageSize
  const pagedOpen = filteredOpen.slice(pageStart, pageStart + pageSize)
  const goToPage = (next: number) => setPage(Math.max(1, Math.min(totalPages, next)))
  const handlePageSize = (size: number) => {
    setPageSize(size)
    setPage(1)
  }

  const globalQuestionnaireOptions = useMemo(
    () => globalCatalogs.map((q) => ({ id: q.id, title: q.title })).sort((a, b) => a.title.localeCompare(b.title, 'de')),
    [globalCatalogs]
  )
  useEffect(() => {
    if (globalQuestionnaireFilter === '__all__') return
    const exists = globalQuestionnaireOptions.some((opt) => opt.id === globalQuestionnaireFilter)
    if (!exists) setGlobalQuestionnaireFilter('__all__')
  }, [globalQuestionnaireFilter, globalQuestionnaireOptions])
  const filteredGlobal = globalCatalogs
    .filter((q) => (!onlyFavorites ? true : favoriteSet.has(q.id)))
    .filter((q) => (globalQuestionnaireFilter === '__all__' ? true : q.id === globalQuestionnaireFilter))
    .filter((q) => {
      const raw = globalFilterText.trim().toLowerCase()
      if (!raw) return true
      return `${q.title ?? ''} ${q.subtitle ?? ''}`.toLowerCase().includes(raw)
    })
    .slice()
    .sort((a, b) => {
      if (globalSort === 'title_asc') return (a.title ?? '').localeCompare(b.title ?? '', 'de')
      if (globalSort === 'title_desc') return (b.title ?? '').localeCompare(a.title ?? '', 'de')
      const aTime = new Date((a.activeFrom as string | undefined) ?? (a.activeTo as string | undefined) ?? 0).getTime()
      const bTime = new Date((b.activeFrom as string | undefined) ?? (b.activeTo as string | undefined) ?? 0).getTime()
      return globalSort === 'date_asc' ? aTime - bTime : bTime - aTime
    })
  const totalGlobalFiltered = filteredGlobal.length
  const totalGlobalPages = Math.max(1, Math.ceil(totalGlobalFiltered / globalPageSize))
  const currentGlobalPage = Math.min(globalPage, totalGlobalPages)
  const pagedGlobal = filteredGlobal.slice(
    (currentGlobalPage - 1) * globalPageSize,
    (currentGlobalPage - 1) * globalPageSize + globalPageSize
  )

  type HistoryItem =
    | {
        kind: 'task'
        key: string
        questionnaireId: string
        title: string
        date: string
        text: string
        task: ObjectSurveyTask
      }
    | {
        kind: 'submission'
        key: string
        questionnaireId: string
        title: string
        date: string
        text: string
        submission: SubmissionRecord
      }
  const historyItems: HistoryItem[] = [
    ...closedTasks.map((task) => ({
      kind: 'task' as const,
      key: `task:${task.id}`,
      questionnaireId: task.questionnaire?.id ?? task.questionnaireId,
      title: task.questionnaire?.title ?? 'Unbekannt',
      date: task.completedAt ?? task.submissionSubmittedAt ?? task.dueAt,
      text: `${task.questionnaire?.title ?? ''} ${task.object?.name ?? ''} ${task.submissionNote ?? ''}`,
      task,
    })),
    ...closedGlobalSubmissions.map((submission) => ({
      kind: 'submission' as const,
      key: `submission:${submission.id}`,
      questionnaireId: submission.questionnaire?.id ?? submission.questionnaireId,
      title: submission.questionnaireSnapshot?.title ?? submission.questionnaire?.title ?? 'Globaler Fragebogen',
      date: submission.submittedAt,
      text: `${submission.questionnaireSnapshot?.title ?? submission.questionnaire?.title ?? ''} ${submission.submissionNote ?? ''}`,
      submission,
    })),
  ]
  const historyQuestionnaireOptions = useMemo(
    () => {
      const optionsMap = new Map<string, string>()
      historyItems.forEach((item) => {
        if (!item.questionnaireId) return
        optionsMap.set(item.questionnaireId, item.title)
      })
      return Array.from(optionsMap.entries())
        .map(([id, title]) => ({ id, title }))
        .sort((a, b) => a.title.localeCompare(b.title, 'de'))
    },
    [historyItems]
  )
  useEffect(() => {
    if (historyQuestionnaireFilter === '__all__') return
    const exists = historyQuestionnaireOptions.some((opt) => opt.id === historyQuestionnaireFilter)
    if (!exists) setHistoryQuestionnaireFilter('__all__')
  }, [historyQuestionnaireFilter, historyQuestionnaireOptions])
  const filteredHistory = historyItems
    .filter((item) => {
      if (!onlyFavorites) return true
      return favoriteSet.has(item.questionnaireId)
    })
    .filter((item) =>
      historyQuestionnaireFilter === '__all__' ? true : item.questionnaireId === historyQuestionnaireFilter
    )
    .filter((item) => {
      const raw = historyFilterText.trim().toLowerCase()
      if (!raw) return true
      return item.text.toLowerCase().includes(raw)
    })
    .slice()
    .sort((a, b) => {
      if (historySort === 'title_asc') return a.title.localeCompare(b.title, 'de')
      if (historySort === 'title_desc') return b.title.localeCompare(a.title, 'de')
      const aTime = new Date(a.date).getTime()
      const bTime = new Date(b.date).getTime()
      return historySort === 'date_asc' ? aTime - bTime : bTime - aTime
    })
  const totalHistoryFiltered = filteredHistory.length
  const totalHistoryPages = Math.max(1, Math.ceil(totalHistoryFiltered / historyPageSize))
  const currentHistoryPage = Math.min(historyPage, totalHistoryPages)
  const pagedHistory = filteredHistory.slice(
    (currentHistoryPage - 1) * historyPageSize,
    (currentHistoryPage - 1) * historyPageSize + historyPageSize
  )
  useEffect(() => {
    if (activeSection === 'open') setPage(1)
    if (activeSection === 'global') setGlobalPage(1)
    if (activeSection === 'history') setHistoryPage(1)
  }, [activeSection])

  const descriptionHtml = useMemo(() => sanitizeRichHtml(homeConfig.descriptionHtml), [homeConfig.descriptionHtml])
  const welcomeContentHtml = useMemo(
    () => sanitizeRichHtml(homeConfig.welcomeContentHtml),
    [homeConfig.welcomeContentHtml]
  )
  const tileOpenDescriptionHtml = useMemo(
    () => sanitizeRichHtml(homeConfig.tileOpenDescription),
    [homeConfig.tileOpenDescription]
  )
  const openDashboardTileBackground = useMemo(
    () =>
      theme === 'dark'
        ? resolveDashboardTileBackground(
            homeConfig.tileOpenBackgroundColorDark,
            DEFAULT_HOME_CONFIG.tileOpenBackgroundColorDark
          )
        : resolveDashboardTileBackground(homeConfig.tileOpenBackgroundColor, DEFAULT_HOME_CONFIG.tileOpenBackgroundColor),
    [homeConfig.tileOpenBackgroundColor, homeConfig.tileOpenBackgroundColorDark, theme]
  )
  const tileGlobalDescriptionHtml = useMemo(
    () => sanitizeRichHtml(homeConfig.tileGlobalDescription),
    [homeConfig.tileGlobalDescription]
  )
  const globalDashboardTileBackground = useMemo(
    () =>
      theme === 'dark'
        ? resolveDashboardTileBackground(
            homeConfig.tileGlobalBackgroundColorDark,
            DEFAULT_HOME_CONFIG.tileGlobalBackgroundColorDark
          )
        : resolveDashboardTileBackground(
            homeConfig.tileGlobalBackgroundColor,
            DEFAULT_HOME_CONFIG.tileGlobalBackgroundColor
          ),
    [homeConfig.tileGlobalBackgroundColor, homeConfig.tileGlobalBackgroundColorDark, theme]
  )
  const tileHistoryDescriptionHtml = useMemo(
    () => sanitizeRichHtml(homeConfig.tileHistoryDescription),
    [homeConfig.tileHistoryDescription]
  )
  const historyDashboardTileBackground = useMemo(
    () =>
      theme === 'dark'
        ? resolveDashboardTileBackground(
            homeConfig.tileHistoryBackgroundColorDark,
            DEFAULT_HOME_CONFIG.tileHistoryBackgroundColorDark
          )
        : resolveDashboardTileBackground(
            homeConfig.tileHistoryBackgroundColor,
            DEFAULT_HOME_CONFIG.tileHistoryBackgroundColor
          ),
    [homeConfig.tileHistoryBackgroundColor, homeConfig.tileHistoryBackgroundColorDark, theme]
  )
  const historyCount = closedTasks.length + closedGlobalSubmissions.length

  return (
    <AppLayout
      title={homeConfig.title}
      subtitle={homeConfig.subtitle}
      titleAddonLeft={<DotsInfinityLoader />}
      showGlobalWaveBackground
    >
      {!loading && !user && <Navigate to="/login" replace />}

      {user && (
        <main className="space-y-5">
          {welcomeContentHtml && (
            <Card>
              <CardContent
                className="prose prose-sm max-w-none py-4"
                dangerouslySetInnerHTML={{ __html: welcomeContentHtml }}
              />
            </Card>
          )}

          {descriptionHtml && (
            <Card>
              <CardContent className="prose prose-sm max-w-none py-4" dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
            </Card>
          )}

          {error && <p className="text-sm text-[var(--color-required)]">{error}</p>}

          <Card>
            <CardContent className="py-3">
              <label className="flex items-center gap-2 text-sm text-[var(--color-foreground)]">
                <input
                  type="checkbox"
                  checked={onlyFavorites}
                  onChange={(e) => setOnlyFavorites(e.target.checked)}
                />
                Nur Favoriten anzeigen
              </label>
            </CardContent>
          </Card>

          <section aria-label="Umfrage Dashboard" className="space-y-3">
            <Card className="overflow-hidden border-[var(--color-border)] bg-[var(--color-surface)]">
              <CardContent className="space-y-4 p-4 md:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                      Umfrage Dashboard
                    </p>
                    <p className="text-sm text-[var(--color-foreground)]">
                      Schneller Zugriff auf offene, globale und bereits durchgefuehrte Umfragen.
                    </p>
                  </div>
                </div>
                <dl className="grid gap-3 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => setActiveSection('open')}
                    style={{ backgroundColor: openDashboardTileBackground }}
                    className={`rounded-[var(--radius-card)] border p-3 text-left transition hover:shadow-sm ${
                      activeSection === 'open'
                        ? 'border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]'
                        : 'border-[var(--color-border)]'
                    }`}
                  >
                    <dt className="text-xs uppercase tracking-wider text-[var(--color-muted)]">{homeConfig.tileOpenTitle}</dt>
                    <dd
                      className="prose prose-sm mt-1 max-w-none text-[var(--color-muted)]"
                      dangerouslySetInnerHTML={{ __html: tileOpenDescriptionHtml }}
                    />
                    <dd className="mt-1 text-2xl font-semibold text-[var(--color-foreground)]">{openTasks.length}</dd>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveSection('global')}
                    style={{ backgroundColor: globalDashboardTileBackground }}
                    className={`rounded-[var(--radius-card)] border p-3 text-left transition hover:shadow-sm ${
                      activeSection === 'global'
                        ? 'border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]'
                        : 'border-[var(--color-border)]'
                    }`}
                  >
                    <dt className="text-xs uppercase tracking-wider text-[var(--color-muted)]">{homeConfig.tileGlobalTitle}</dt>
                    <dd
                      className="prose prose-sm mt-1 max-w-none text-[var(--color-muted)]"
                      dangerouslySetInnerHTML={{ __html: tileGlobalDescriptionHtml }}
                    />
                    <dd className="mt-1 text-2xl font-semibold text-[var(--color-foreground)]">{globalCatalogs.length}</dd>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveSection('history')}
                    style={{ backgroundColor: historyDashboardTileBackground }}
                    className={`rounded-[var(--radius-card)] border p-3 text-left transition hover:shadow-sm ${
                      activeSection === 'history'
                        ? 'border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]'
                        : 'border-[var(--color-border)]'
                    }`}
                  >
                    <dt className="text-xs uppercase tracking-wider text-[var(--color-muted)]">{homeConfig.tileHistoryTitle}</dt>
                    <dd
                      className="prose prose-sm mt-1 max-w-none text-[var(--color-muted)]"
                      dangerouslySetInnerHTML={{ __html: tileHistoryDescriptionHtml }}
                    />
                    <dd className="mt-1 text-2xl font-semibold text-[var(--color-foreground)]">{historyCount}</dd>
                  </button>
                </dl>
              </CardContent>
            </Card>
          </section>

          {loadingTasks && (
            <div className="space-y-2">
              <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
                <div className="h-full w-1/2 animate-pulse bg-[var(--color-primary)]" />
              </div>
              <div className="text-xs text-[var(--color-muted)]">Daten werden geladen...</div>
            </div>
          )}

          {activeSection === 'open' && (
            <section className="space-y-3" aria-label={homeConfig.headingOpenTasks}>
              <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
                <Input
                  placeholder="Filter (Titel, Objekt, Gruppe, Status)"
                  value={filterText}
                  onChange={(e) => {
                    setFilterText(e.target.value)
                    setPage(1)
                  }}
                />
                <div className="flex flex-wrap items-center gap-1">
                  <select
                    className="h-9 rounded-[var(--radius-button)] border border-[var(--color-border)] bg-white px-2 text-sm"
                    value={openQuestionnaireFilter}
                    onChange={(e) => {
                      setOpenQuestionnaireFilter(e.target.value)
                      setPage(1)
                    }}
                  >
                    <option value="__all__">Alle Fragebogen</option>
                    {openQuestionnaireOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.title}
                      </option>
                    ))}
                  </select>
                  <select
                    className="h-9 rounded-[var(--radius-button)] border border-[var(--color-border)] bg-white px-2 text-sm"
                    value={openSort}
                    onChange={(e) => {
                      setOpenSort(e.target.value as typeof openSort)
                      setPage(1)
                    }}
                  >
                    <option value="due_asc">Datum faellig aufsteigend</option>
                    <option value="due_desc">Datum faellig absteigend</option>
                    <option value="title_asc">Fragebogen A-Z</option>
                    <option value="title_desc">Fragebogen Z-A</option>
                  </select>
                  {[10, 20, 30, 40].map((n) => (
                    <Button key={n} size="sm" variant={pageSize === n ? 'default' : 'outline'} onClick={() => handlePageSize(n)}>
                      {n}
                    </Button>
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}>
                    Zurueck
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages}>
                    Weiter
                  </Button>
                </div>
              </div>
              <div className="text-xs text-[var(--color-muted)]">
                Treffer: {totalFiltered} | Seite {currentPage}/{totalPages}
              </div>
              {pagedOpen.length > 0 ? (
                renderGroupedOpen(pagedOpen)
              ) : (
                <Card>
                  <CardContent className="py-6 text-sm text-[var(--color-muted)]">
                    Keine offenen Umfragen fuer den aktuellen Filter.
                  </CardContent>
                </Card>
              )}
            </section>
          )}

          {activeSection === 'global' && (
            <section className="space-y-3" aria-label={homeConfig.headingGlobalCatalogs}>
              <div>
                <div className="mb-3 grid gap-3 md:grid-cols-[1fr_auto_auto]">
                  <Input
                    placeholder="Filter (Fragebogen)"
                    value={globalFilterText}
                    onChange={(e) => {
                      setGlobalFilterText(e.target.value)
                      setGlobalPage(1)
                    }}
                  />
                  <div className="flex flex-wrap items-center gap-1">
                    <select
                      className="h-9 rounded-[var(--radius-button)] border border-[var(--color-border)] bg-white px-2 text-sm"
                      value={globalQuestionnaireFilter}
                      onChange={(e) => {
                        setGlobalQuestionnaireFilter(e.target.value)
                        setGlobalPage(1)
                      }}
                    >
                      <option value="__all__">Alle Fragebogen</option>
                      {globalQuestionnaireOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.title}
                        </option>
                      ))}
                    </select>
                    <select
                      className="h-9 rounded-[var(--radius-button)] border border-[var(--color-border)] bg-white px-2 text-sm"
                      value={globalSort}
                      onChange={(e) => {
                        setGlobalSort(e.target.value as typeof globalSort)
                        setGlobalPage(1)
                      }}
                    >
                      <option value="title_asc">Fragebogen A-Z</option>
                      <option value="title_desc">Fragebogen Z-A</option>
                      <option value="date_desc">Datum absteigend</option>
                      <option value="date_asc">Datum aufsteigend</option>
                    </select>
                    {[10, 20, 30, 40].map((n) => (
                      <Button
                        key={`global-${n}`}
                        size="sm"
                        variant={globalPageSize === n ? 'default' : 'outline'}
                        onClick={() => {
                          setGlobalPageSize(n)
                          setGlobalPage(1)
                        }}
                      >
                        {n}
                      </Button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setGlobalPage((p) => Math.max(1, p - 1))}
                      disabled={currentGlobalPage <= 1}
                    >
                      Zurueck
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setGlobalPage((p) => Math.min(totalGlobalPages, p + 1))}
                      disabled={currentGlobalPage >= totalGlobalPages}
                    >
                      Weiter
                    </Button>
                  </div>
                </div>
                <div className="mb-3 text-xs text-[var(--color-muted)]">
                  Treffer: {totalGlobalFiltered} | Seite {currentGlobalPage}/{totalGlobalPages}
                </div>
                {pagedGlobal.length > 0 ? (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {pagedGlobal.map((q) => {
                      const attrs = toAttrSet(q.homeTileAttributes)
                      const tileColor = resolveTileColor(q.homeTileColor)
                      return (
                      <Card
                        key={q.id}
                        className="h-full"
                        style={tileAccentStyle(tileColor)}
                      >
                        <CardContent className="flex h-full flex-col gap-3 p-4">
                          <div className="space-y-1">
                            <div className="flex items-start justify-between gap-2">
                              <div className="font-medium">{q.title}</div>
                              {favoriteButton(q.id)}
                            </div>
                            {q.subtitle && <div className="text-xs text-[var(--color-muted)]">{q.subtitle}</div>}
                            {!!q.homeTileDescriptionHtml && (
                              <div
                                className="prose prose-sm max-w-none text-sm leading-5 text-[var(--color-muted)]"
                                dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(q.homeTileDescriptionHtml) }}
                              />
                            )}
                            {hasAttr(attrs, 'object') && (
                              <div className="text-xs text-[var(--color-muted)]">Objektbezug: Kein Objektbezug (global)</div>
                            )}
                            {hasAttr(attrs, 'status') && (
                              <div className="text-xs text-[var(--color-muted)]">Status: {q.status ?? '-'}</div>
                            )}
                            {hasAttr(attrs, 'version') && (
                              <div className="text-xs text-[var(--color-muted)]">Version: {q.version ?? '-'}</div>
                            )}
                            {hasAttr(attrs, 'globalTag') && (
                              <div className="text-xs text-[var(--color-muted)]">Global verfuegbar</div>
                            )}
                          </div>
                          <div className="mt-auto">
                            <Button asChild size="sm">
                              <Link to={`/link/questionnaire/${q.id}`}>Starten</Link>
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    )})}
                  </div>
                ) : (
                  <div className="text-sm text-[var(--color-muted)]">Keine allgemeinen Fragenkataloge verfuegbar.</div>
                )}
              </div>
            </section>
          )}

          {activeSection === 'history' && (
            <section className="space-y-3" aria-label={homeConfig.headingClosedTasks}>
              <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
                <Input
                  placeholder="Filter (Fragebogen, Kommentar, Objekt)"
                  value={historyFilterText}
                  onChange={(e) => {
                    setHistoryFilterText(e.target.value)
                    setHistoryPage(1)
                  }}
                />
                <div className="flex flex-wrap items-center gap-1">
                  <select
                    className="h-9 rounded-[var(--radius-button)] border border-[var(--color-border)] bg-white px-2 text-sm"
                    value={historyQuestionnaireFilter}
                    onChange={(e) => {
                      setHistoryQuestionnaireFilter(e.target.value)
                      setHistoryPage(1)
                    }}
                  >
                    <option value="__all__">Alle Fragebogen</option>
                    {historyQuestionnaireOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.title}
                      </option>
                    ))}
                  </select>
                  <select
                    className="h-9 rounded-[var(--radius-button)] border border-[var(--color-border)] bg-white px-2 text-sm"
                    value={historySort}
                    onChange={(e) => {
                      setHistorySort(e.target.value as typeof historySort)
                      setHistoryPage(1)
                    }}
                  >
                    <option value="date_desc">Datum absteigend</option>
                    <option value="date_asc">Datum aufsteigend</option>
                    <option value="title_asc">Fragebogen A-Z</option>
                    <option value="title_desc">Fragebogen Z-A</option>
                  </select>
                  {[10, 20, 30, 40].map((n) => (
                    <Button
                      key={`history-${n}`}
                      size="sm"
                      variant={historyPageSize === n ? 'default' : 'outline'}
                      onClick={() => {
                        setHistoryPageSize(n)
                        setHistoryPage(1)
                      }}
                    >
                      {n}
                    </Button>
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                    disabled={currentHistoryPage <= 1}
                  >
                    Zurueck
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setHistoryPage((p) => Math.min(totalHistoryPages, p + 1))}
                    disabled={currentHistoryPage >= totalHistoryPages}
                  >
                    Weiter
                  </Button>
                </div>
              </div>
              <div className="text-xs text-[var(--color-muted)]">
                Treffer: {totalHistoryFiltered} | Seite {currentHistoryPage}/{totalHistoryPages}
              </div>
              {totalHistoryFiltered > 0 ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {pagedHistory.map((item) => {
                    if (item.kind === 'task') {
                      const task = item.task
                      const attrs = toAttrSet(task.questionnaire?.homeTileAttributes)
                      const tileColor = resolveTileColor(task.questionnaire?.homeTileColor)
                      return (
                        <Card
                          key={`closed-task-${task.id}`}
                          className="h-full"
                          style={tileAccentStyle(tileColor)}
                        >
                          <CardContent className="flex h-full flex-col gap-3 p-4">
                            <div className="space-y-1">
                              <div className="flex items-start justify-between gap-2">
                                <div className="font-medium">{task.questionnaire?.title}</div>
                                {favoriteButton(task.questionnaire?.id)}
                              </div>
                              {!!task.questionnaire?.homeTileDescriptionHtml && (
                                <div
                                  className="prose prose-sm max-w-none text-sm leading-5 text-[var(--color-muted)]"
                                  dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(task.questionnaire.homeTileDescriptionHtml) }}
                                />
                              )}
                              {hasAttr(attrs, 'object') && (
                                <div className="text-xs text-[var(--color-muted)]">
                                  Objektbezug: {(task.object?.externalId ?? task.object?.id ?? '-')} - {task.object?.name ?? 'Unbekanntes Objekt'}
                                </div>
                              )}
                              <div className="text-xs text-[var(--color-muted)]">
                                Durchgefuehrt am{' '}
                                {task.completedAt
                                  ? new Date(task.completedAt).toLocaleString('de-DE')
                                  : task.submissionSubmittedAt
                                    ? new Date(task.submissionSubmittedAt).toLocaleString('de-DE')
                                    : '-'}
                              </div>
                              {task.submissionNote && (
                                <div className="text-xs text-[var(--color-muted)]">
                                  Hinweis: {task.submissionNote}
                                </div>
                              )}
                              {hasAttr(attrs, 'completedBy') && task.completedBy?.email && (
                                <div className="text-xs text-[var(--color-muted)]">Erledigt von {task.completedBy.email}</div>
                              )}
                            </div>
                            <div className="mt-auto flex flex-wrap gap-2">
                              {task.submissionId && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => editSubmissionNote(task.submissionId as string, task.submissionNote)}
                                  disabled={!!savingNoteBySubmissionId[task.submissionId]}
                                >
                                  {savingNoteBySubmissionId[task.submissionId]
                                    ? 'Speichert...'
                                    : 'Hinweis bearbeiten'}
                                </Button>
                              )}
                              {task.questionnaire?.showReadonlyResultLinkInHistory && task.submissionId && (
                                <Button variant="outline" size="sm" asChild>
                                  <Link to={`/result/${task.submissionId}/readonly`}>Readonly</Link>
                                </Button>
                              )}
                              {task.questionnaire?.showJiraTicketLinkInHistory && (
                                task.jiraIssue?.browseUrl ? (
                                  <Button variant="outline" size="sm" asChild>
                                    <a href={task.jiraIssue.browseUrl} target="_blank" rel="noopener noreferrer">
                                      Jira
                                    </a>
                                  </Button>
                                ) : (
                                  <Button variant="outline" size="sm" disabled>
                                    Jira
                                  </Button>
                                )
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      )
                    }

                    const submission = item.submission
                    const attrs = toAttrSet(submission.questionnaire?.homeTileAttributes)
                    const tileColor = resolveTileColor(submission.questionnaire?.homeTileColor)
                    const submissionQid = submission.questionnaire?.id ?? submission.questionnaireId
                    return (
                      <Card
                        key={`closed-global-${submission.id}`}
                        className="h-full"
                        style={tileAccentStyle(tileColor)}
                      >
                        <CardContent className="flex h-full flex-col gap-3 p-4">
                          <div className="space-y-1">
                            <div className="flex items-start justify-between gap-2">
                              <div className="font-medium">
                                {submission.questionnaireSnapshot?.title ?? submission.questionnaire?.title ?? 'Globaler Fragebogen'}
                              </div>
                              {favoriteButton(submissionQid)}
                            </div>
                            {!!submission.questionnaire?.homeTileDescriptionHtml && (
                              <div
                                className="prose prose-sm max-w-none text-sm leading-5 text-[var(--color-muted)]"
                                dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(submission.questionnaire.homeTileDescriptionHtml) }}
                              />
                            )}
                            {hasAttr(attrs, 'object') && (
                              <div className="text-xs text-[var(--color-muted)]">Objektbezug: Kein Objektbezug (global)</div>
                            )}
                            <div className="text-xs text-[var(--color-muted)]">
                              Durchgefuehrt am {new Date(submission.submittedAt).toLocaleString('de-DE')}
                            </div>
                            {submission.submissionNote && (
                              <div className="text-xs text-[var(--color-muted)]">
                                Hinweis: {submission.submissionNote}
                              </div>
                            )}
                          </div>
                          <div className="mt-auto flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => editSubmissionNote(submission.id, submission.submissionNote)}
                              disabled={!!savingNoteBySubmissionId[submission.id]}
                            >
                              {savingNoteBySubmissionId[submission.id]
                                ? 'Speichert...'
                                : 'Hinweis bearbeiten'}
                            </Button>
                            {submission.questionnaire?.showReadonlyResultLinkInHistory && (
                              <Button variant="outline" size="sm" asChild>
                                <Link to={`/result/${submission.id}/readonly`}>Readonly</Link>
                              </Button>
                            )}
                            {submission.questionnaire?.showJiraTicketLinkInHistory && (
                              submission.jiraIssue?.browseUrl ? (
                                <Button variant="outline" size="sm" asChild>
                                  <a href={submission.jiraIssue.browseUrl} target="_blank" rel="noopener noreferrer">
                                    Jira
                                  </a>
                                </Button>
                              ) : (
                                <Button variant="outline" size="sm" disabled>
                                  Jira
                                </Button>
                              )
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              ) : (
                <Card>
                  <CardContent className="py-6 text-sm text-[var(--color-muted)]">
                    Keine abgeschlossenen Umfragen vorhanden.
                  </CardContent>
                </Card>
              )}
            </section>
          )}
        </main>
      )}
    </AppLayout>
  )
}
