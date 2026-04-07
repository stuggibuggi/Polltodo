import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, type SubmissionRecord } from '../../lib/api'
import type { Questionnaire } from '../../types/questionnaire'
import { QuestionnaireReadonlyView } from '../../components/questionnaire/QuestionnaireReadonlyView'
import { Button } from '../../components/ui/button'

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString('de-DE')
  } catch {
    return iso
  }
}

export function ResultReadonlyPage() {
  const [params] = useSearchParams()
  const questionnaireId = (params.get('questionnaireId') ?? '').trim()
  const submissionId = (params.get('submissionId') ?? '').trim()
  const autoPrint = (params.get('autoprint') ?? '').trim() === '1'

  const [loading, setLoading] = useState(true)
  const [questionnaire, setQuestionnaire] = useState<Questionnaire | null>(null)
  const [submission, setSubmission] = useState<SubmissionRecord | null>(null)

  useEffect(() => {
    let isMounted = true
    if (!questionnaireId || !submissionId) {
      setLoading(false)
      return
    }
    Promise.all([api.getQuestionnaire(questionnaireId), api.listSubmissions(questionnaireId)])
      .then(([q, submissions]) => {
        if (!isMounted) return
        setQuestionnaire(q)
        setSubmission(submissions.find((s) => s.id === submissionId) ?? null)
      })
      .finally(() => {
        if (isMounted) setLoading(false)
      })
    return () => {
      isMounted = false
    }
  }, [questionnaireId, submissionId])

  const sourceQuestionnaire = useMemo(() => {
    if (!questionnaire || !submission) return null
    const snapshot = submission.questionnaireSnapshot
    if (snapshot && Array.isArray(snapshot.sections)) {
      return {
        id: snapshot.id || questionnaire.id,
        title: snapshot.title || questionnaire.title,
        subtitle: snapshot.subtitle ?? questionnaire.subtitle,
        sections: snapshot.sections as Questionnaire['sections'],
        version: snapshot.version || submission.questionnaireVersion || questionnaire.version || 1,
      } as Questionnaire
    }
    return {
      id: questionnaire.id,
      title: questionnaire.title,
      subtitle: questionnaire.subtitle,
      sections: questionnaire.sections,
      version: submission.questionnaireVersion || questionnaire.version || 1,
    } as Questionnaire
  }, [questionnaire, submission])

  useEffect(() => {
    if (!autoPrint) return
    if (loading) return
    if (!sourceQuestionnaire || !submission) return
    const id = window.setTimeout(() => window.print(), 200)
    return () => window.clearTimeout(id)
  }, [autoPrint, loading, sourceQuestionnaire, submission])

  if (loading) {
    return <div className="p-6 text-[var(--color-muted)]">Laden...</div>
  }

  if (!questionnaireId || !submissionId) {
    return <div className="p-6 text-[var(--color-required)]">Fehlende Parameter.</div>
  }

  if (!sourceQuestionnaire || !submission) {
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
              {sourceQuestionnaire.title} (v{sourceQuestionnaire.version ?? 1}) ·{' '}
              {formatDate(submission.submittedAt)} · {submission.user?.email ?? '-'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => window.print()}>
              Als PDF speichern
            </Button>
            <Button variant="outline" asChild>
              <Link to="/admin/results">Zur Ergebnisseite</Link>
            </Button>
            <Button variant="outline" onClick={() => window.close()}>
              Fenster schliessen
            </Button>
          </div>
        </div>

        <QuestionnaireReadonlyView
          questionnaire={sourceQuestionnaire}
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
