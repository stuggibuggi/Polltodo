import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { cn } from '../../lib/utils'
import { sanitizeRichHtml } from '../../lib/rich-text'
import { Button } from '../ui/button'
import { Dialog, DialogContent } from '../ui/dialog'

interface QuestionCardProps {
  title: string
  description?: string
  descriptionAsPopup?: boolean
  linkUrl?: string
  linkText?: string
  required: boolean
  showRequiredBadge?: boolean
  children: ReactNode
  className?: string
  /** Für abhängige Fragen: weiche Ein-/Ausblendung */
  isVisible?: boolean
}

export function QuestionCard({
  title,
  description,
  descriptionAsPopup = false,
  linkUrl,
  linkText,
  required,
  showRequiredBadge = true,
  children,
  className,
  isVisible = true,
}: QuestionCardProps) {
  const [showDescription, setShowDescription] = useState(false)
  const descriptionHtml = useMemo(() => sanitizeRichHtml(description), [description])
  return (
    <div
      className={cn(
        'transition-all duration-300 ease-out',
        isVisible
          ? 'translate-y-0 opacity-100'
          : 'pointer-events-none -translate-y-2 opacity-0'
      )}
      aria-hidden={!isVisible}
    >
      <Card className={cn('overflow-hidden', className)}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-baseline gap-2 text-base font-medium">
            <span>{title}</span>
            {showRequiredBadge &&
              (required ? (
                <span
                  className="text-xs font-normal text-[var(--color-required)]"
                  aria-label="Pflichtfeld"
                >
                  Pflichtfeld
                </span>
              ) : (
                <span
                  className="text-xs font-normal text-[var(--color-optional)]"
                  aria-label="Optional"
                >
                  Optional
                </span>
              ))}
          </CardTitle>
          {description && !descriptionAsPopup && (
            <div
              className="rich-text-content mt-1 text-sm text-[var(--color-muted)]"
              dangerouslySetInnerHTML={{ __html: descriptionHtml }}
            />
          )}
          {description && descriptionAsPopup && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2 w-fit"
                onClick={() => setShowDescription(true)}
              >
                Beschreibung anzeigen
              </Button>
              <Dialog open={showDescription} onOpenChange={setShowDescription}>
                <DialogContent title="Beschreibung" className="max-w-2xl">
                  <div
                    className="rich-text-content max-h-[70vh] overflow-auto text-sm text-[var(--color-foreground)]"
                    dangerouslySetInnerHTML={{ __html: descriptionHtml }}
                  />
                </DialogContent>
              </Dialog>
            </>
          )}
          {linkUrl && (
            <a
              href={linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-2 text-sm text-[var(--color-primary)] hover:underline"
            >
              <span className="inline-flex h-4 w-4 items-center justify-center">
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 1 0-7.07-7.07L11 4" />
                  <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07L13 20" />
                </svg>
              </span>
              {linkText || 'Link zu weiterführenden Informationen'}
            </a>
          )}
        </CardHeader>
        <CardContent className="pt-0">{children}</CardContent>
      </Card>
    </div>
  )
}
