import { Suspense, lazy, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AuthProvider } from './lib/auth'
import { ThemeProvider } from './lib/theme'
import { api } from './lib/api'

const HomePage = lazy(() =>
  import('./pages/HomePage').then((m) => ({ default: m.HomePage }))
)
const LoginPage = lazy(() =>
  import('./pages/LoginPage').then((m) => ({ default: m.LoginPage }))
)
const QuestionnairePage = lazy(() =>
  import('./pages/QuestionnairePage').then((m) => ({ default: m.QuestionnairePage }))
)
const QuestionnaireLinkPage = lazy(() =>
  import('./pages/QuestionnaireLinkPage').then((m) => ({ default: m.QuestionnaireLinkPage }))
)
const TaskPage = lazy(() =>
  import('./pages/TaskPage').then((m) => ({ default: m.TaskPage }))
)
const ObjectOpenTasksPage = lazy(() =>
  import('./pages/ObjectOpenTasksPage').then((m) => ({ default: m.ObjectOpenTasksPage }))
)
const ResultReadonlyPage = lazy(() =>
  import('./pages/ResultReadonlyPage').then((m) => ({ default: m.ResultReadonlyPage }))
)
const SurveyHistoryPage = lazy(() =>
  import('./pages/SurveyHistoryPage').then((m) => ({ default: m.SurveyHistoryPage }))
)
const AdminLayout = lazy(() =>
  import('./components/admin/AdminLayout').then((m) => ({ default: m.AdminLayout }))
)

function App() {
  useEffect(() => {
    let cancelled = false
    const applyFavicon = (href: string) => {
      if (!href) return
      const existing = document.querySelector<HTMLLinkElement>('link[rel*="icon"]')
      if (existing) {
        existing.href = href
        return
      }
      const link = document.createElement('link')
      link.rel = 'icon'
      link.href = href
      document.head.appendChild(link)
    }
    api
      .getPublicHomeConfig()
      .then((cfg) => {
        if (cancelled) return
        const icon = typeof cfg.faviconDataUrl === 'string' ? cfg.faviconDataUrl.trim() : ''
        if (icon) applyFavicon(icon)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <ErrorBoundary>
            <Suspense fallback={<div className="p-6 text-[var(--color-muted)]">Laden...</div>}>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/umfrage/:id" element={<QuestionnairePage />} />
                <Route path="/link/questionnaire/:id" element={<QuestionnaireLinkPage />} />
                <Route path="/task/:id" element={<TaskPage />} />
                <Route path="/result/:submissionId/readonly" element={<ResultReadonlyPage />} />
                <Route path="/history" element={<SurveyHistoryPage />} />
                <Route path="/link/open-tasks" element={<ObjectOpenTasksPage />} />
                <Route path="/admin/*" element={<AdminLayout />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}

export default App
