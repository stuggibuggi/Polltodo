import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { AppLayout } from '../components/layout/AppLayout'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader } from '../components/ui/card'
import { useAuth } from '../lib/auth'
import { api, type HomePageConfig, type ObjectSurveyTask, type SubmissionRecord } from '../lib/api'

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

export function SurveyHistoryPage() {
  const { user } = useAuth()
  const [tasks, setTasks] = useState<ObjectSurveyTask[]>([])
  const [closedGlobalSubmissions, setClosedGlobalSubmissions] = useState<SubmissionRecord[]>([])
  const [homeConfig, setHomeConfig] = useState<HomePageConfig>(DEFAULT_HOME_CONFIG)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    setLoading(true)
    Promise.all([api.listMyObjectTasks(), api.listMySubmissions(), api.getMyHomeConfig()])
      .then(([taskList, submissions, cfg]) => {
        setTasks(taskList.filter((task) => task.status !== 'OPEN'))
        setClosedGlobalSubmissions(
          submissions.filter((s) => s.questionnaire?.globalForAllUsers)
        )
        setHomeConfig(cfg)
      })
      .finally(() => setLoading(false))
  }, [user])

  const groupTasks = () => {
    const grouped = new Map<string, ObjectSurveyTask[]>()
    tasks.forEach((task) => {
      const objectName = task.object?.name ?? 'Unbekanntes Objekt'
      const list = grouped.get(objectName) ?? []
      list.push(task)
      grouped.set(objectName, list)
    })
    return Array.from(grouped.entries())
  }

  return (
    <AppLayout title="Bereits durchgefuehrte Umfragen" subtitle={homeConfig.headingClosedTasks}>
      <div className="space-y-4">
        <div className="flex justify-end">
          <Button variant="outline" asChild>
            <Link to="/">Zur Startseite</Link>
          </Button>
        </div>

        {loading && (
          <Card>
            <CardContent className="py-6 text-sm text-[var(--color-muted)]">Daten werden geladen...</CardContent>
          </Card>
        )}

        {!loading && tasks.length > 0 && (
          <div className="space-y-3">
            {groupTasks().map(([objectName, list]) => (
              <Card key={objectName}>
                <CardHeader>
                  <h3 className="font-medium">{objectName}</h3>
                </CardHeader>
                <CardContent className="space-y-2">
                  {list.map((task) => (
                    <div
                      key={task.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
                    >
                      <div className="font-medium">{task.questionnaire?.title}</div>
                      <div className="text-xs text-[var(--color-muted)]">
                        Erledigt am {task.completedAt ? new Date(task.completedAt).toLocaleString('de-DE') : '-'}
                        {task.completedBy?.email && <> - Erledigt von {task.completedBy.email}</>}
                      </div>
                      <div className="flex items-center gap-2">
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
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {!loading && closedGlobalSubmissions.length > 0 && (
          <Card>
            <CardHeader>
              <h3 className="font-medium">Globale abgeschlossene Umfragen</h3>
            </CardHeader>
            <CardContent className="space-y-2">
              {closedGlobalSubmissions.map((submission) => (
                <div
                  key={submission.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
                >
                  <div>
                    <div className="font-medium">
                      {submission.questionnaireSnapshot?.title ??
                        submission.questionnaire?.title ??
                        'Globaler Fragebogen'}
                    </div>
                    <div className="text-xs text-[var(--color-muted)]">
                      Version {submission.questionnaireVersion ?? submission.questionnaire?.version ?? '-'}
                    </div>
                  </div>
                  <div className="text-xs text-[var(--color-muted)]">
                    Erledigt am {new Date(submission.submittedAt).toLocaleString('de-DE')}
                  </div>
                  <div className="flex items-center gap-2">
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
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {!loading && tasks.length === 0 && closedGlobalSubmissions.length === 0 && (
          <Card>
            <CardContent className="py-6 text-sm text-[var(--color-muted)]">
              Es sind noch keine abgeschlossenen Umfragen vorhanden.
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  )
}
