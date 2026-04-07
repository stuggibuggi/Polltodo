import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AppLayout } from '../components/layout/AppLayout'
import { DotsInfinityLoader } from '../components/layout/DotsInfinityLoader'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { api, type LoginPageConfig } from '../lib/api'
import { useAuth } from '../lib/auth'

const DEFAULT_LOGIN_CONFIG: LoginPageConfig = {
  title: 'Anmelden',
  subtitle: 'Bitte melden Sie sich an, um fortzufahren.',
  hintText: '',
  usernameLabel: 'E-Mail oder Benutzername',
  usernamePlaceholder: 'E-Mail oder Benutzername',
  passwordLabel: 'Passwort',
  passwordPlaceholder: 'Passwort',
  submitButtonLabel: 'Anmelden',
  logoDataUrl: '',
  logoWidthPx: 180,
  logoPlacement: 'top',
}

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [config, setConfig] = useState<LoginPageConfig>(DEFAULT_LOGIN_CONFIG)

  const next = new URLSearchParams(location.search).get('next') || '/'
  const heroWidth = 'clamp(320px, 33vw, 720px)'

  useEffect(() => {
    api.getPublicLoginConfig().then(setConfig).catch(() => undefined)
  }, [])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(email.trim(), password)
      if (next !== '/') {
        navigate(next)
      } else {
        try {
          const cfg = await api.getMyHomeConfig()
          navigate(cfg.defaultRouteAfterLogin || '/')
        } catch {
          navigate('/')
        }
      }
    } catch {
      setError('Login fehlgeschlagen. Bitte pruefen Sie Ihre Zugangsdaten.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AppLayout title={config.title} subtitle={config.subtitle} showGlobalWaveBackground>
      <form onSubmit={handleSubmit} className="mx-auto w-full max-w-md space-y-4">
        <div className="flex flex-col items-center gap-4 pt-16 pb-[100px]">
          <div className="flex items-center justify-center gap-10" style={{ width: heroWidth }}>
            <div style={{ transform: 'scale(2)', transformOrigin: 'center' }}>
              <DotsInfinityLoader />
            </div>
            <span
              className="font-brand-icto tracking-tight text-[var(--color-foreground)]"
              style={{ fontSize: 'clamp(2rem, 3.2vw, 4rem)', lineHeight: 1.05 }}
            >
              ICTOMAT<sup style={{ fontSize: '0.5em', marginLeft: '0.08em' }}>2</sup>
            </span>
          </div>
          {config.logoDataUrl && (
            <img
              src={config.logoDataUrl}
              alt="Login Logo"
              style={{ width: heroWidth, maxWidth: '100%' }}
              className="h-auto object-contain"
            />
          )}
        </div>
        {config.hintText.trim() && (
          <p className="text-sm text-[var(--color-muted)]">{config.hintText}</p>
        )}
        <div className="space-y-2">
          <Label htmlFor="email">{config.usernameLabel}</Label>
          <Input
            id="email"
            type="text"
            placeholder={config.usernamePlaceholder}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">{config.passwordLabel}</Label>
          <Input
            id="password"
            type="password"
            placeholder={config.passwordPlaceholder}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className="text-sm text-[var(--color-required)]">{error}</p>}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? `${config.submitButtonLabel}...` : config.submitButtonLabel}
        </Button>
      </form>
    </AppLayout>
  )
}
