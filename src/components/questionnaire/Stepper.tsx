import { cn } from '../../lib/utils'

export interface StepperStep {
  id: string
  label: string
  status: 'completed' | 'current' | 'upcoming'
}

interface StepperProps {
  steps: StepperStep[]
  className?: string
}

export function Stepper({ steps, className }: StepperProps) {
  return (
    <nav aria-label="Fortschritt" className={cn('', className)}>
      <ol className="flex items-stretch">
        {steps.map((step, index) => (
          <li key={step.id} className="flex flex-1 flex-col items-center">
            <div className="flex w-full items-center">
              {index > 0 && (
                <span
                  className={cn(
                    'h-px flex-1 shrink',
                    steps[index - 1].status === 'completed'
                      ? 'bg-[var(--color-primary)]'
                      : 'bg-[var(--color-border)]'
                  )}
                  aria-hidden
                />
              )}
              <span
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-medium transition-colors',
                  step.status === 'completed' &&
                    'border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)]',
                  step.status === 'current' &&
                    'border-[var(--color-primary)] bg-white text-[var(--color-primary)]',
                  step.status === 'upcoming' &&
                    'border-[var(--color-border)] bg-white text-[var(--color-muted)]'
                )}
                aria-current={step.status === 'current' ? 'step' : undefined}
              >
                {step.status === 'completed' ? '✓' : index + 1}
              </span>
              {index < steps.length - 1 && (
                <span
                  className={cn(
                    'h-px flex-1 shrink',
                    step.status === 'completed'
                      ? 'bg-[var(--color-primary)]'
                      : 'bg-[var(--color-border)]'
                  )}
                  aria-hidden
                />
              )}
            </div>
            <span
              className={cn(
                'mt-2 text-center text-xs font-medium',
                step.status === 'current' && 'text-[var(--color-primary)]',
                step.status === 'completed' && 'text-[var(--color-muted)]',
                step.status === 'upcoming' && 'text-[var(--color-muted)]'
              )}
            >
              {step.label}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  )
}
