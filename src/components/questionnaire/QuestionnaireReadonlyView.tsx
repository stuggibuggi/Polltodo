import { useMemo } from 'react'
import type { Answers, Questionnaire } from '../../types/questionnaire'
import { isQuestionVisible, isSectionVisible } from '../../lib/questionnaire-utils'
import { sanitizeRichHtml } from '../../lib/rich-text'
import { QuestionField } from './QuestionField'

interface QuestionnaireReadonlyViewProps {
  questionnaire: Questionnaire
  answers: Answers
  objectContext?: { type?: string | null; metadata?: Record<string, unknown> | null } | null
}

export function QuestionnaireReadonlyView({
  questionnaire,
  answers,
  objectContext,
}: QuestionnaireReadonlyViewProps) {
  const sections = useMemo(
    () =>
      questionnaire.sections.filter((section) =>
        isSectionVisible(section, answers, objectContext ?? undefined)
      ),
    [questionnaire.sections, answers, objectContext]
  )

  const isAnswered = (value: Answers[string]) => {
    if (typeof value === 'boolean') return true
    if (Array.isArray(value)) return value.length > 0
    return value !== undefined && value !== null && String(value).trim() !== ''
  }

  const isQuestionRequired = (question: Questionnaire['sections'][number]['questions'][number]) => {
    if (question.type === 'assignment_picker') {
      return (question.assignmentOptions ?? []).some((option) => !!option.required)
    }
    return !!question.required
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-10">
      <aside className="h-fit rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white p-4 text-sm lg:col-span-3">
        <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]">
          Uebersicht
        </div>
        <div className="mt-4 space-y-4">
          {sections.map((section, sIndex) => (
            <div key={section.id} className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[var(--color-primary)]" />
                <span className="font-medium text-[var(--color-foreground)]">
                  {sIndex + 1}. {section.title}
                </span>
              </div>
              <div className="ml-3 space-y-2 border-l border-[var(--color-border)] pl-3">
                {section.questions
                  .filter((question) =>
                    isQuestionVisible(question, answers, objectContext ?? undefined)
                  )
                  .map((question, qIndex) => {
                    const answered =
                      question.type === 'info' ? true : isAnswered(answers[question.id])
                    const dotClass = answered
                      ? 'bg-green-500'
                      : isQuestionRequired(question)
                        ? 'bg-[var(--color-required)]'
                        : 'bg-amber-400'
                    return (
                      <div key={question.id} className="relative">
                        <span className={`absolute -left-3 top-2 h-2 w-2 rounded-full ${dotClass}`} />
                        <span className="text-[var(--color-muted)]">
                          {sIndex + 1}.{qIndex + 1} {question.title}
                        </span>
                      </div>
                    )
                  })}
              </div>
            </div>
          ))}
        </div>
      </aside>

      <section className="space-y-6 lg:col-span-9">
        {sections.map((section) => (
          <div key={section.id} className="space-y-4">
            <h2 className="text-sm font-medium uppercase tracking-wider text-[var(--color-muted)]">
              {section.title}
            </h2>
            {(section.description || section.linkUrl) && (
              <div className="space-y-2 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white p-4 text-sm text-[var(--color-foreground)]">
                {section.description && (
                  <div
                    className="rich-text-content"
                    dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(section.description) }}
                  />
                )}
                {section.linkUrl && (
                  <a
                    href={section.linkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex text-[var(--color-primary)] underline"
                  >
                    {(section.linkText || section.linkUrl).trim()}
                  </a>
                )}
              </div>
            )}
            <div className="space-y-6">
              {section.questions
                .filter((question) =>
                  isQuestionVisible(question, answers, objectContext ?? undefined)
                )
                .map((question) => {
                  const reasonKey = `${question.id}__reason`
                  const objectMetaKey = `${question.id}__objectMeta`
                  const customOptionsKey = `${question.id}__customOptions`
                  const customOptions = Array.isArray(answers[customOptionsKey])
                    ? (answers[customOptionsKey] as string[])
                    : []
                  return (
                    <QuestionField
                      key={question.id}
                      question={question}
                      value={answers[question.id]}
                      onChange={() => {}}
                      customOptions={customOptions}
                      onCustomOptionsChange={() => {}}
                      reasonValue={answers[reasonKey] as string | undefined}
                      onReasonChange={() => {}}
                      objectMetadataValue={answers[objectMetaKey] as string | undefined}
                      onObjectMetadataChange={() => {}}
                      isVisible
                      readOnly
                    />
                  )
                })}
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}
