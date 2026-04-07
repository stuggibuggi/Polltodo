import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { AppLayout } from '../components/layout/AppLayout'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader } from '../components/ui/card'
import { api, type ObjectSurveyTask } from '../lib/api'
import { useAuth } from '../lib/auth'

export function ObjectOpenTasksPage() {
  const location = useLocation()
  const { user, loading } = useAuth()
  const [searchParams] = useSearchParams()
  const objectId = (searchParams.get('objectId') ?? '').trim()
  const questionnaireId = (searchParams.get('questionnaireId') ?? '').trim()

  const [tasks, setTasks] = useState<ObjectSurveyTask[]>([])
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [loadingTasks, setLoadingTasks] = useState(false)

  useEffect(() => {
    if (!user || !objectId) return
    setLoadingTasks(true)
    setFetchError(null)
    api
      .listMyObjectTasks()
      .then((list) => setTasks(list))
      .catch(() => setFetchError('Aufgaben konnten nicht geladen werden.'))
      .finally(() => setLoadingTasks(false))
  }, [user, objectId])

  const filteredTasks = useMemo(
    () =>
      tasks.filter(
        (task) =>
          task.status === 'OPEN' &&
          task.objectId === objectId &&
          (!questionnaireId || task.questionnaireId === questionnaireId)
      ),
    [tasks, objectId, questionnaireId]
  )

  const pageTitle = 'Offene Umfragen fuer Objekt'
  const pageSubtitle = questionnaireId
    ? `Objekt: ${objectId} | Fragebogen: ${questionnaireId}`
    : `Objekt: ${objectId}`

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

  if (!objectId) {
    return (
      <AppLayout title={pageTitle}>
        <Card>
          <CardContent className="py-6 text-sm text-[var(--color-muted)]">
            Link unvollstaendig. Bitte mindestens `objectId` in der URL mitgeben.
          </CardContent>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout title={pageTitle} subtitle={pageSubtitle}>
      <div className="space-y-4">
        {fetchError && <p className="text-sm text-[var(--color-required)]">{fetchError}</p>}

        {loadingTasks && (
          <div className="space-y-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
              <div className="h-full w-1/2 animate-pulse bg-[var(--color-primary)]" />
            </div>
            <div className="text-xs text-[var(--color-muted)]">Daten werden geladen...</div>
          </div>
        )}

        {!loadingTasks && filteredTasks.length === 0 && (
          <Card>
            <CardContent className="py-6 text-sm text-[var(--color-muted)]">
              Keine offenen Aufgaben fuer diese Kombination gefunden oder keine Berechtigung vorhanden.
            </CardContent>
          </Card>
        )}

        {filteredTasks.length > 0 && (
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-[var(--color-foreground)]">
                Offene Aufgaben ({filteredTasks.length})
              </h2>
            </CardHeader>
            <CardContent className="space-y-2">
              {filteredTasks.map((task) => {
                const startedByOther =
                  !!task.startedByUserId && task.startedByUserId !== user.id
                const startedBySelf =
                  !!task.startedByUserId && task.startedByUserId === user.id
                return (
                  <div
                    key={task.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
                  >
                    <div>
                      <div className="font-medium">{task.questionnaire?.title}</div>
                      <div className="text-xs text-[var(--color-muted)]">
                        Faellig bis: {new Date(task.dueAt).toLocaleString('de-DE')}
                      </div>
                      {task.startedAt && (
                        <div className="text-xs text-[var(--color-muted)]">
                          Bereits gestartet {startedBySelf ? 'von Ihnen' : task.startedBy?.email ? `von ${task.startedBy.email}` : 'von anderem Benutzer'} am{' '}
                          {new Date(task.startedAt).toLocaleString('de-DE')}
                        </div>
                      )}
                    </div>
                    <div>
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
                  </div>
                )
              })}
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  )
}

