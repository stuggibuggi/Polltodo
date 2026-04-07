import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '../../lib/auth'
import { useTheme } from '../../lib/theme'
import { Button } from '../ui/button'
import { Link } from 'react-router-dom'
import { WaveBackground } from './WaveBackground'

interface AppLayoutProps {
  children: ReactNode
  title?: string
  subtitle?: string
  titleAddonLeft?: ReactNode
  titleAddon?: ReactNode
  showGlobalWaveBackground?: boolean
}

export function AppLayout({
  children,
  title,
  subtitle,
  titleAddonLeft,
  titleAddon,
  showGlobalWaveBackground = false,
}: AppLayoutProps) {
  const { user, loading, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const headerRef = useRef<HTMLElement | null>(null)
  const [stickyOffsetPx, setStickyOffsetPx] = useState(112)

  useEffect(() => {
    const node = headerRef.current
    if (!node) return
    const update = () => {
      const h = Math.ceil(node.getBoundingClientRect().height || 0)
      setStickyOffsetPx(Math.max(64, h + 16))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  return (
    <div
      className="relative min-h-screen bg-[var(--color-background)]"
      style={{ ['--layout-sticky-offset' as string]: `${stickyOffsetPx}px` }}
    >
      {showGlobalWaveBackground && (
        <div className="app-global-wave">
          <WaveBackground />
        </div>
      )}
      <header
        ref={headerRef}
        className="sticky top-0 z-20 border-b border-[var(--color-border)]/80 bg-[var(--header-bg)] backdrop-blur-md"
      >
        <div className="mx-auto w-full max-w-none px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-5">
                {titleAddonLeft}
                <h1 className="font-brand-icto text-xl tracking-tight text-[var(--color-foreground)] sm:text-2xl">
                  {title ?? 'Anwendungs-Fragenkatalog'}
                </h1>
                {titleAddon}
              </div>
              {subtitle && (
                <p className="mt-1 text-sm text-[var(--color-muted)]">{subtitle}</p>
              )}
            </div>
            {!loading && user && (
              <div className="flex items-center gap-3 text-sm text-[var(--color-muted)]">
                <Button variant="outline" size="sm" onClick={toggleTheme}>
                  {theme === 'dark' ? 'Hell' : 'Dunkel'}
                </Button>
                {(user.role === 'ADMIN' || user.role === 'EDITOR') && (
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/admin/questionnaires">Administration</Link>
                  </Button>
                )}
                <span className="rounded-full border border-[var(--color-border)] bg-[var(--surface-base)] px-3 py-1">
                  {user.email}
                </span>
                <Button variant="outline" size="sm" onClick={() => logout()}>
                  Abmelden
                </Button>
              </div>
            )}
            {!loading && !user && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={toggleTheme}>
                  {theme === 'dark' ? 'Hell' : 'Dunkel'}
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <Link to="/login">Anmelden</Link>
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="relative z-10 mx-auto w-full max-w-none px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  )
}
