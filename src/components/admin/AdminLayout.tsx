import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { Link, useLocation, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useTheme } from '../../lib/theme'
import { api } from '../../lib/api'
import { Button } from '../ui/button'
import { DotsInfinityLoader } from '../layout/DotsInfinityLoader'

const QuestionnaireListPage = lazy(() =>
  import('../../pages/admin/QuestionnaireListPage').then((m) => ({ default: m.QuestionnaireListPage }))
)
const QuestionnaireEditPage = lazy(() =>
  import('../../pages/admin/QuestionnaireEditPage').then((m) => ({ default: m.QuestionnaireEditPage }))
)
const ResultsPage = lazy(() =>
  import('../../pages/admin/ResultsPage').then((m) => ({ default: m.ResultsPage }))
)
const ResultsAnalyticsPage = lazy(() =>
  import('../../pages/admin/ResultsAnalyticsPage').then((m) => ({ default: m.ResultsAnalyticsPage }))
)
const ResultsKpiPage = lazy(() =>
  import('../../pages/admin/ResultsKpiPage').then((m) => ({ default: m.ResultsKpiPage }))
)
const ResultReadonlyPage = lazy(() =>
  import('../../pages/admin/ResultReadonlyPage').then((m) => ({ default: m.ResultReadonlyPage }))
)
const UserListPage = lazy(() =>
  import('../../pages/admin/UserListPage').then((m) => ({ default: m.UserListPage }))
)
const GroupListPage = lazy(() =>
  import('../../pages/admin/GroupListPage').then((m) => ({ default: m.GroupListPage }))
)
const GroupDetailPage = lazy(() =>
  import('../../pages/admin/GroupDetailPage').then((m) => ({ default: m.GroupDetailPage }))
)
const ObjectListPage = lazy(() =>
  import('../../pages/admin/ObjectListPage').then((m) => ({ default: m.ObjectListPage }))
)
const ObjectDetailPage = lazy(() =>
  import('../../pages/admin/ObjectDetailPage').then((m) => ({ default: m.ObjectDetailPage }))
)
const RoleListPage = lazy(() =>
  import('../../pages/admin/RoleListPage').then((m) => ({ default: m.RoleListPage }))
)
const ImportPage = lazy(() =>
  import('../../pages/admin/ImportPage').then((m) => ({ default: m.ImportPage }))
)
const ObjectGroupListPage = lazy(() =>
  import('../../pages/admin/ObjectGroupListPage').then((m) => ({ default: m.ObjectGroupListPage }))
)
const ObjectGroupDetailPage = lazy(() =>
  import('../../pages/admin/ObjectGroupDetailPage').then((m) => ({ default: m.ObjectGroupDetailPage }))
)
const JiraPage = lazy(() =>
  import('../../pages/admin/JiraPage').then((m) => ({ default: m.JiraPage }))
)
const JiraConfigPage = lazy(() =>
  import('../../pages/admin/JiraConfigPage').then((m) => ({ default: m.JiraConfigPage }))
)
const QuestionTypeAdminPage = lazy(() =>
  import('../../pages/admin/QuestionTypeAdminPage').then((m) => ({ default: m.QuestionTypeAdminPage }))
)
const HomeConfigPage = lazy(() =>
  import('../../pages/admin/HomeConfigPage').then((m) => ({ default: m.HomeConfigPage }))
)
const ExternalObjectImportsPage = lazy(() =>
  import('../../pages/admin/ExternalObjectImportsPage').then((m) => ({ default: m.ExternalObjectImportsPage }))
)
const EditorMenuConfigPage = lazy(() =>
  import('../../pages/admin/EditorMenuConfigPage').then((m) => ({ default: m.EditorMenuConfigPage }))
)

type NavItem = {
  key: string
  label: string
  path: string
  matchExact?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { key: 'questionnaires', label: 'Fragebogen', path: '/admin/questionnaires' },
  { key: 'groups', label: 'Benutzergruppen', path: '/admin/groups' },
  { key: 'objects', label: 'Objekte', path: '/admin/objects' },
  { key: 'roles', label: 'Rollen', path: '/admin/roles' },
  { key: 'objectGroups', label: 'Objektgruppen', path: '/admin/object-groups' },
  { key: 'homeConfig', label: 'Startseite', path: '/admin/home-config' },
  { key: 'questionTypes', label: 'Fragetypen', path: '/admin/question-types' },
  { key: 'import', label: 'Import', path: '/admin/import' },
  { key: 'objectImports', label: 'Objekt-Import (SQL)', path: '/admin/object-imports' },
  { key: 'results', label: 'Ergebnisse', path: '/admin/results', matchExact: true },
  { key: 'resultsAnalytics', label: 'Grafische Auswertung', path: '/admin/results/analytics', matchExact: true },
  { key: 'resultsKpis', label: 'KPI', path: '/admin/results/kpis', matchExact: true },
  { key: 'jira', label: 'Jira', path: '/admin/jira', matchExact: true },
  { key: 'jiraConfig', label: 'Jira-Konfig', path: '/admin/jira-config' },
]

function isActive(pathname: string, item: NavItem): boolean {
  if (item.matchExact) return pathname === item.path
  return pathname === item.path || pathname.startsWith(item.path + '/')
}

const activeCls = 'border-[var(--color-primary)] bg-[color-mix(in_oklab,var(--color-primary)_10%,white)] text-[var(--color-primary)]'
const inactiveCls = 'border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]'
const pillBase = 'rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors'

export function AdminLayout() {
  const location = useLocation()
  const { user, loading, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const headerRef = useRef<HTMLElement | null>(null)
  const [stickyOffsetPx, setStickyOffsetPx] = useState(140)
  const [editorMenu, setEditorMenu] = useState<Record<string, boolean> | null>(null)

  useEffect(() => {
    const node = headerRef.current
    if (!node) return
    const update = () => {
      const h = Math.ceil(node.getBoundingClientRect().height || 0)
      setStickyOffsetPx(Math.max(80, h + 16))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  useEffect(() => {
    if (!user || (user.role !== 'ADMIN' && user.role !== 'EDITOR')) return
    api.getEditorMenuConfig().then(setEditorMenu).catch(() => setEditorMenu(null))
  }, [user])

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <DotsInfinityLoader />
      </div>
    )
  }

  if (!user) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />
  }

  if (user.role !== 'ADMIN' && user.role !== 'EDITOR') {
    return <Navigate to="/" replace />
  }

  const isAdmin = user.role === 'ADMIN'
  const canSee = (key: string) => isAdmin || !editorMenu || editorMenu[key] !== false

  const blockedRoute = <Navigate to="/admin/questionnaires" replace />

  return (
    <div
      className="min-h-screen bg-[var(--color-background)]"
      style={{ ['--layout-sticky-offset' as string]: `${stickyOffsetPx}px` }}
    >
      <header
        ref={headerRef}
        className="sticky top-0 z-30 border-b border-[var(--color-border)]/80 bg-[var(--header-bg)] backdrop-blur-md"
      >
        <div className="mx-auto max-w-6xl px-6 py-4 sm:px-8">
          <h1 className="text-lg font-bold text-[var(--color-foreground)] sm:text-xl">
            Administration
          </h1>
          <nav className="mt-3 flex flex-wrap items-center gap-2">
            {NAV_ITEMS.filter((item) => canSee(item.key)).map((item) => (
              <Link
                key={item.key}
                to={item.path}
                className={`${pillBase} ${isActive(location.pathname, item) ? activeCls : inactiveCls}`}
              >
                {item.label}
              </Link>
            ))}
            {isAdmin && (
              <>
                <Link
                  to="/admin/users"
                  className={`${pillBase} ${location.pathname.startsWith('/admin/users') ? activeCls : inactiveCls}`}
                >
                  Benutzer
                </Link>
                <Link
                  to="/admin/editor-menu"
                  className={`${pillBase} ${location.pathname.startsWith('/admin/editor-menu') ? activeCls : inactiveCls}`}
                >
                  Editor-Zugriff
                </Link>
              </>
            )}
            <Link
              to="/"
              className={`${pillBase} border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]`}
            >
              Umfrage oeffnen
            </Link>
            <Button variant="outline" size="sm" onClick={toggleTheme}>
              {theme === 'dark' ? 'Hell' : 'Dunkel'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => logout()}>
              Abmelden
            </Button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8 sm:px-8">
        <Suspense
          fallback={
            <div className="flex min-h-[40vh] items-center justify-center">
              <DotsInfinityLoader />
            </div>
          }
        >
          <Routes>
            <Route path="questionnaires/new" element={canSee('questionnaires') ? <QuestionnaireEditPage /> : blockedRoute} />
            <Route path="questionnaires/:id/edit" element={canSee('questionnaires') ? <QuestionnaireEditPage /> : blockedRoute} />
            <Route path="questionnaires" element={canSee('questionnaires') ? <QuestionnaireListPage /> : blockedRoute} />
            <Route path="groups" element={canSee('groups') ? <GroupListPage /> : blockedRoute} />
            <Route path="groups/:id" element={canSee('groups') ? <GroupDetailPage /> : blockedRoute} />
            <Route
              path="users"
              element={isAdmin ? <UserListPage /> : blockedRoute}
            />
            <Route path="objects" element={canSee('objects') ? <ObjectListPage /> : blockedRoute} />
            <Route path="objects/:id" element={canSee('objects') ? <ObjectDetailPage /> : blockedRoute} />
            <Route path="roles" element={canSee('roles') ? <RoleListPage /> : blockedRoute} />
            <Route path="object-groups" element={canSee('objectGroups') ? <ObjectGroupListPage /> : blockedRoute} />
            <Route path="object-groups/:id" element={canSee('objectGroups') ? <ObjectGroupDetailPage /> : blockedRoute} />
            <Route path="home-config" element={canSee('homeConfig') ? <HomeConfigPage /> : blockedRoute} />
            <Route path="question-types" element={canSee('questionTypes') ? <QuestionTypeAdminPage /> : blockedRoute} />
            <Route path="import" element={canSee('import') ? <ImportPage /> : blockedRoute} />
            <Route path="object-imports" element={canSee('objectImports') ? <ExternalObjectImportsPage /> : blockedRoute} />
            <Route path="results" element={canSee('results') ? <ResultsPage /> : blockedRoute} />
            <Route path="results/analytics" element={canSee('resultsAnalytics') ? <ResultsAnalyticsPage /> : blockedRoute} />
            <Route path="results/kpis" element={canSee('resultsKpis') ? <ResultsKpiPage /> : blockedRoute} />
            <Route path="results/view" element={<ResultReadonlyPage />} />
            <Route path="jira" element={canSee('jira') ? <JiraPage /> : blockedRoute} />
            <Route path="jira-config" element={canSee('jiraConfig') ? <JiraConfigPage /> : blockedRoute} />
            <Route path="editor-menu" element={isAdmin ? <EditorMenuConfigPage /> : blockedRoute} />
            <Route index element={<Navigate to="questionnaires" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  )
}
