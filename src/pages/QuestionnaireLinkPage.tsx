import { Navigate, useLocation, useParams } from 'react-router-dom'
import { AppLayout } from '../components/layout/AppLayout'
import { useAuth } from '../lib/auth'

export function QuestionnaireLinkPage() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const { user, loading } = useAuth()

  if (!id) {
    return (
      <AppLayout title="Ungueltiger Link">
        <p className="text-[var(--color-muted)]">Die Fragebogen-ID fehlt im Link.</p>
      </AppLayout>
    )
  }

  if (loading) {
    return (
      <AppLayout title="Laden...">
        <p className="text-[var(--color-muted)]">Anmeldung wird geprueft...</p>
      </AppLayout>
    )
  }

  if (!user) {
    const next = `${location.pathname}${location.search}`
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  }

  return <Navigate to={`/umfrage/${id}`} replace />
}

