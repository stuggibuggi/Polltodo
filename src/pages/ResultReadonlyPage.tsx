import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, type SubmissionRecord } from '../lib/api'
import type { Questionnaire } from '../types/questionnaire'
import { QuestionnaireReadonlyView } from '../components/questionnaire/QuestionnaireReadonlyView'
import { Button } from '../components/ui/button'

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString('de-DE')
  } catch {
    return iso
  }
}

export function ResultReadonlyPage() {
  const { submissionId = '' } = useParams()
  const [loading, setLoading] = useState(true)
  const [questionnaire, setQuestionnaire] = useState<Questionnaire | null>(null)
  const [submission, setSubmission] = useState<SubmissionRecord | null>(null)

  useEffect(() => {
    let mounted = true
    if (!submissionId.trim()) {
      setLoading(false)
      return
    }
    api
      .getMySubmissionReadonlyData(submissionId)
      .then((data) => {
        if (!mounted) return
        setQuestionnaire(data.questionnaire)
        setSubmission(data.submission)
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [submissionId])

  if (loading) return <div className="p-6 text-[var(--color-muted)]">Laden...</div>
  if (!questionnaire || !submission) {
    return <div className="p-6 text-[var(--color-required)]">Ergebnis nicht gefunden.</div>
  }

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-6 sm:px-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-[var(--color-foreground)]">
              Originaldesign (readonly)
            </h1>
            <p className="text-sm text-[var(--color-muted)]">
              {questionnaire.title} (v{questionnaire.version ?? 1}) · {formatDate(submission.submittedAt)} ·{' '}
              {submission.user?.email ?? '-'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => window.print()}>
              Als PDF speichern
            </Button>
            <Button variant="outline" asChild>
              <Link to="/">Zur Startseite</Link>
            </Button>
          </div>
        </div>

        <QuestionnaireReadonlyView
          questionnaire={questionnaire}
          answers={submission.answers}
          objectContext={{
            type: submission.objectTask?.object?.type ?? null,
            metadata:
              (submission.objectTask?.object?.metadata as Record<string, unknown> | null | undefined) ??
              null,
          }}
        />
      </div>
    </div>
  )
}

