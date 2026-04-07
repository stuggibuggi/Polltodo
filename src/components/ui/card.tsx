import * as React from 'react'
import { cn } from '../../lib/utils'

const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, style, ...props }, ref) => {
  const delay = React.useMemo(() => `${Math.floor(Math.random() * 6) * 60}ms`, [])
  const mergedStyle = {
    ...(style ?? {}),
    '--card-delay': delay,
  } as React.CSSProperties
  return (
    <div
      ref={ref}
      style={mergedStyle}
      className={cn(
        'app-card rounded-[var(--radius-card)] border border-[var(--color-border)]/90 bg-[color:var(--surface-base)]/88 text-[var(--color-foreground)] shadow-[var(--shadow-soft)] backdrop-blur-md',
        className
      )}
      {...props}
    />
  )
})
Card.displayName = 'Card'

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex flex-col space-y-1.5 p-6', className)}
    {...props}
  />
))
CardHeader.displayName = 'CardHeader'

const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn('text-lg font-bold leading-none tracking-tight', className)}
    {...props}
  />
))
CardTitle.displayName = 'CardTitle'

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
))
CardContent.displayName = 'CardContent'

export { Card, CardHeader, CardTitle, CardContent }
