import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AppLayout } from '../components/layout/AppLayout'
import { QuestionnaireView } from '../components/questionnaire/QuestionnaireView'
import { api, ApiError, type ObjectSurveyTask } from '../lib/api'
import type { Answers } from '../types/questionnaire'

interface TaskStartConflict {
  startedByEmail?: string | null
  startedAt?: string | null
}

export function TaskPage() {
  const { id } = useParams<{ id: string }>()
  const [task, setTask] = useState<ObjectSurveyTask | null>(null)
  const [prefillData, setPrefillData] = useState<Answers | null>(null)
  const [prefillUpdatedAt, setPrefillUpdatedAt] = useState<string | null>(null)
  const [prefillSource, setPrefillSource] = useState<'MANUAL_IMPORT' | 'LAST_SUBMISSION' | null>(null)
  const [loading, setLoading] = useState(true)
  const [startConflict, setStartConflict] = useState<TaskStartConflict | null>(null)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    api
      .getObjectTask(id)
      .then((t) => {
        setTask(t)
        setStartConflict(null)
        setPrefillData(null)
        setPrefillUpdatedAt(null)
        setPrefillSource(null)
        if (t.status === 'OPEN') {
          api
            .getObjectTaskPrefill(t.id)
            .then((prefill) => {
              if (prefill.exists && prefill.answers) {
                setPrefillData(prefill.answers)
                setPrefillUpdatedAt(prefill.updatedAt ?? null)
                setPrefillSource(prefill.source ?? null)
              }
            })
            .catch(() => {
              setPrefillData(null)
              setPrefillUpdatedAt(null)
              setPrefillSource(null)
            })
        }
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 409) {
          const data = (err.data ?? {}) as { startedByEmail?: string; startedAt?: string }
          if (err.message === 'TASK_ALREADY_STARTED') {
            setStartConflict({
              startedByEmail: data.startedByEmail ?? null,
              startedAt: data.startedAt ?? null,
            })
            setTask(null)
            return
          }
        }
        setStartConflict(null)
        setTask(null)
        setPrefillData(null)
        setPrefillUpdatedAt(null)
        setPrefillSource(null)
      })
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <AppLayout title="Laden...">
        <p className="text-[var(--color-muted)]">Umfrage wird geladen...</p>
      </AppLayout>
    )
  }

  if (!task || !task.questionnaire) {
    return (
      <AppLayout title="Nicht gefunden">
        {startConflict ? (
          <p className="text-[var(--color-muted)]">
            Diese Umfrage wurde bereits gestartet
            {startConflict.startedByEmail ? ` von ${startConflict.startedByEmail}` : ''}.
            {startConflict.startedAt
              ? ` Letzter gespeicherter Stand: ${new Date(startConflict.startedAt).toLocaleString('de-DE')}.`
              : ''}
          </p>
        ) : (
          <p className="text-[var(--color-muted)]">Aufgabe nicht gefunden.</p>
        )}
        <Link to="/" className="mt-4 inline-block text-sm text-[var(--color-primary)] underline">
          Zur Startseite
        </Link>
      </AppLayout>
    )
  }

  if (task.status !== 'OPEN') {
    const objectReference = task.object
      ? `Objekt ${task.object.externalId ? `${task.object.externalId} - ` : ''}${task.object.name}`
      : `Objekt ${task.objectId}`
    return (
      <AppLayout
        title={task.questionnaire.title}
        subtitle={`Diese Umfrage wird fuer ${objectReference} durchgefuehrt.`}
      >
        <p className="text-[var(--color-muted)]">
          Diese Umfrage wurde bereits abgeschlossen.
        </p>
        {task.completedBy?.email && (
          <p className="text-[var(--color-muted)]">
            Erledigt von {task.completedBy.email}
          </p>
        )}
        {task.completedAt && (
          <p className="text-[var(--color-muted)]">
            Erledigt am {new Date(task.completedAt).toLocaleString('de-DE')}
          </p>
        )}
        <Link to="/" className="mt-4 inline-block text-sm text-[var(--color-primary)] underline">
          Zur Startseite
        </Link>
      </AppLayout>
    )
  }

  return (
    <AppLayout
      title={task.questionnaire.title}
      subtitle={`Diese Umfrage wird fuer Objekt ${task.object?.externalId ? `${task.object.externalId} - ` : ''}${task.object?.name ?? task.objectId} durchgefuehrt.`}
    >
      <QuestionnaireView
        questionnaire={task.questionnaire}
        taskId={task.id}
        prefillData={prefillData}
        prefillUpdatedAt={prefillUpdatedAt}
        prefillSource={prefillSource}
        objectContext={{
          type: task.object?.type ?? null,
          metadata: (task.object?.metadata as Record<string, unknown> | null | undefined) ?? null,
        }}
      />
    </AppLayout>
  )
}
