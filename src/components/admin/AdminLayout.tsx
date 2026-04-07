import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { Link, useLocation, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useTheme } from '../../lib/theme'
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

export function AdminLayout() {
  const location = useLocation()
  const { user, loading, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const headerRef = useRef<HTMLElement | null>(null)
  const [stickyOffsetPx, setStickyOffsetPx] = useState(140)

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
            <Link
              to="/admin/questionnaires"
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                location.pathname === '/admin/questionnaires' ||
                location.pathname.startsWith('/admin/questionnaires/')
                  ? 'border-[var(--color-primary)] bg-[color-mix(in_oklab,var(--color-primary)_10%,white)] text-[var(--color-primary)]'
                  : 'border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]'
              }`}
            >
              Fragebogen
            </Link>
            <Link
              to="/admin/groups"
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                location.pathname.startsWith('/admin/groups')
                  ? 'border-[var(--color-primary)] bg-[color-mix(in_oklab,var(--color-primary)_10%,white)] text-[var(--color-primary)]'
                  : 'border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]'
              }`}
            >
              Benutzergruppen
            </Link>
            {user.role === 'ADMIN' && (
              <Link
                to="/admin/users"
                className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                  location.pathname.startsWith('/admin/users')
                    ? 'border-[var(--color-primary)] bg-[color-mix(in_oklab,var(--color-primary)_10%,white)] text-[var(--color-primary)]'
                    : 'border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]'
                }`}
              >
                Benutzer
              </Link>
            )}
            <Link
              to="/admin/objects"
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                location.pathname.startsWith('/admin/objects')
                  ? 'border-[var(--color-primary)] bg-[color-mix(in_oklab,var(--color-primary)_10%,white)] text-[var(--color-primary)]'
                  : 'border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]'
              }`}
            >
              Objekte
            </Link>
            <Link
              to="/admin/roles"
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                location.pathname.startsWith('/admin/roles')
                  ? 'border-[var(--color-primary)] bg-[color-mix(in_oklab,var(--color-primary)_10%,white)] text-[var(--color-primary)]'
                  : 'border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]'
              }`}
            >
              Rollen
            </Link>
            <Link
              to="/admin/object-groups"
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                location.pathname.startsWith('/admin/object-groups')
                  ? 'border-[var(--color-primary)] bg-[color-mix(in_oklab,var(--color-primary)_10%,white)] text-[var(--color-primary)]'
                  : 'border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]'
              }`}
            >
              Objektgruppen
            </Link>
            <Link
              to="/admin/home-config"
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                location.pathname.startsWith('/admin/home-config')
                  ? 'border-[var(--color-primary)] bg-[color-mix(in_oklab,var(--color-primary)_10%,white)] text-[var(--color-primary)]'
                  : 'border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]'
              }`}
            >
              Startseite
            </Link>
            <Link
              to="/admin/question-types"
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                location.pathname.startsWith('/admin/question-types')
                  ? 'border-[var(--color-primary)] bg-[color-mix(in_oklab,var(--color-primary)_10%,white)] text-[var(--color-primary)]'
                  : 'border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]'
              }`}
            >
              Fragetypen
            </Link>
            <Link
              to="/admin/import"
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                location.pathname.startsWith('/admin/import')
                  ? 'border-[var(--color-primary)] bg-[color-mix(in_oklab,var(--color-primary)_10%,white)] text-[var(--color-primary)]'
                  : 'border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]'
              }`}
            >
              Import
            </Link>
            <Link
              to="/admin/object-imports"
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                location.pathname.startsWith('/admin/object-imports')
                  ? 'border-[var(--color-primary)] bg-[color-mix(in_oklab,var(--color-primary)_10%,white)] text-[var(--color-primary)]'
                  : 'border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]'
              }`}
            >
              Objekt-Import (SQL)
            </Link>
            <Link
              to="/admin/results"
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                location.pathname === '/admin/results'
                  ? 'border-[var(--color-primary)] bg-[color-mix(in_oklab,var(--color-primary)_10%,white)] text-[var(--color-primary)]'
                  : 'border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]'
              }`}
            >
              Ergebnisse
            </Link>
            <Link
              to="/admin/results/analytics"
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                location.pathname === '/admin/results/analytics'
                  ? 'border-[var(--color-primary)] bg-[color-mix(in_oklab,var(--color-primary)_10%,white)] text-[var(--color-primary)]'
                  : 'border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]'
              }`}
            >
              Grafische Auswertung
            </Link>
            <Link
              to="/admin/results/kpis"
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                location.pathname === '/admin/results/kpis'
                  ? 'border-[var(--color-primary)] bg-[color-mix(in_oklab,var(--color-primary)_10%,white)] text-[var(--color-primary)]'
                  : 'border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]'
              }`}
            >
              KPI
            </Link>
            <Link
              to="/admin/jira"
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                location.pathname === '/admin/jira'
                  ? 'border-[var(--color-primary)] bg-[color-mix(in_oklab,var(--color-primary)_10%,white)] text-[var(--color-primary)]'
                  : 'border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]'
              }`}
            >
              Jira
            </Link>
            <Link
              to="/admin/jira-config"
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                location.pathname === '/admin/jira-config'
                  ? 'border-[var(--color-primary)] bg-[color-mix(in_oklab,var(--color-primary)_10%,white)] text-[var(--color-primary)]'
                  : 'border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]'
              }`}
            >
              Jira-Konfig
            </Link>
            <Link
              to="/"
              className="rounded-full border border-[var(--color-border)] px-3 py-1.5 text-sm font-semibold text-[var(--color-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
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
            <Route path="questionnaires/new" element={<QuestionnaireEditPage />} />
            <Route path="questionnaires/:id/edit" element={<QuestionnaireEditPage />} />
            <Route path="questionnaires" element={<QuestionnaireListPage />} />
            <Route path="groups" element={<GroupListPage />} />
            <Route path="groups/:id" element={<GroupDetailPage />} />
            <Route
              path="users"
              element={user.role === 'ADMIN' ? <UserListPage /> : <Navigate to="/admin/questionnaires" replace />}
            />
            <Route path="objects" element={<ObjectListPage />} />
            <Route path="objects/:id" element={<ObjectDetailPage />} />
            <Route path="roles" element={<RoleListPage />} />
            <Route path="object-groups" element={<ObjectGroupListPage />} />
            <Route path="object-groups/:id" element={<ObjectGroupDetailPage />} />
            <Route path="home-config" element={<HomeConfigPage />} />
            <Route path="question-types" element={<QuestionTypeAdminPage />} />
            <Route path="import" element={<ImportPage />} />
            <Route path="object-imports" element={<ExternalObjectImportsPage />} />
            <Route path="results" element={<ResultsPage />} />
            <Route path="results/analytics" element={<ResultsAnalyticsPage />} />
            <Route path="results/kpis" element={<ResultsKpiPage />} />
            <Route path="results/view" element={<ResultReadonlyPage />} />
            <Route path="jira" element={<JiraPage />} />
            <Route path="jira-config" element={<JiraConfigPage />} />
            <Route index element={<Navigate to="questionnaires" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  )
}
