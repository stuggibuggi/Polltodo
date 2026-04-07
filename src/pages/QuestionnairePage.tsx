import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { AppLayout } from '../components/layout/AppLayout'
import { QuestionnaireView } from '../components/questionnaire/QuestionnaireView'
import { api, ApiError } from '../lib/api'
import type { Questionnaire } from '../types/questionnaire'

export function QuestionnairePage() {
  const { id } = useParams<{ id: string }>()
  const [questionnaire, setQuestionnaire] = useState<Questionnaire | null>(null)
  const [loading, setLoading] = useState(true)
  const [unauthorized, setUnauthorized] = useState(false)
  const [completed, setCompleted] = useState(false)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    Promise.all([api.getQuestionnaire(id), api.listMySubmissions()])
      .then(([q, submissions]) => {
        setQuestionnaire(q)
        setUnauthorized(false)
        const done =
          !q.allowMultipleSubmissions &&
          submissions.some((s) => s.questionnaireId === q.id)
        setCompleted(done)
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          setUnauthorized(true)
        }
        setQuestionnaire(null)
      })
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <AppLayout title="Laden...">
        <p className="text-[var(--color-muted)]">Fragebogen wird geladen...</p>
      </AppLayout>
    )
  }

  if (unauthorized) {
    return (
      <AppLayout title="Anmeldung erforderlich">
        <p className="text-[var(--color-muted)]">
          Bitte melden Sie sich an, um diese Umfrage zu sehen.
        </p>
        <Link to="/login" className="mt-4 inline-block text-sm text-[var(--color-primary)] underline">
          Zur Anmeldung
        </Link>
      </AppLayout>
    )
  }

  if (!questionnaire) {
    return (
      <AppLayout title="Nicht gefunden">
        <p className="text-[var(--color-muted)]">Fragebogen nicht gefunden.</p>
        <Link to="/" className="mt-4 inline-block text-sm text-[var(--color-primary)] underline">
          Zur Startseite
        </Link>
      </AppLayout>
    )
  }

  if (completed) {
    return (
      <AppLayout title={questionnaire.title} subtitle={questionnaire.subtitle}>
        <p className="text-[var(--color-muted)]">
          Diese Umfrage wurde bereits abgeschlossen und kann nicht erneut angezeigt werden.
        </p>
        <Link to="/" className="mt-4 inline-block text-sm text-[var(--color-primary)] underline">
          Zur Startseite
        </Link>
      </AppLayout>
    )
  }

  return (
    <AppLayout title={questionnaire.title} subtitle={questionnaire.subtitle}>
      <QuestionnaireView questionnaire={questionnaire} />
    </AppLayout>
  )
}
