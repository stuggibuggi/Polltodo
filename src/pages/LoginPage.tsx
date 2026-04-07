import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google'
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

function LoginForm({
  googleClientId,
  registrationEnabled,
}: {
  googleClientId: string | null
  registrationEnabled: boolean
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, googleAuth } = useAuth()
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

  const navigateAfterAuth = async () => {
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
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(email.trim(), password)
      await navigateAfterAuth()
    } catch {
      setError('Login fehlgeschlagen. Bitte pruefen Sie Ihre Zugangsdaten.')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleSuccess = async (credentialResponse: { credential?: string }) => {
    if (!credentialResponse.credential) return
    setError(null)
    setLoading(true)
    try {
      await googleAuth(credentialResponse.credential)
      await navigateAfterAuth()
    } catch {
      setError('Google-Anmeldung fehlgeschlagen.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AppLayout title={config.title} subtitle={config.subtitle} showGlobalWaveBackground>
      <div className="mx-auto w-full max-w-md space-y-4">
        <div className="flex flex-col items-center gap-4 pt-16 pb-[100px]">
          <div className="flex items-center justify-center gap-10" style={{ width: heroWidth }}>
            <div style={{ transform: 'scale(2)', transformOrigin: 'center' }}>
              <DotsInfinityLoader />
            </div>
            <span
              className="font-brand-icto tracking-tight text-[var(--color-foreground)]"
              style={{ fontSize: 'clamp(2rem, 3.2vw, 4rem)', lineHeight: 1.05 }}
            >
              Polltodo
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

        {googleClientId && (
          <div className="flex flex-col items-center gap-3">
            <GoogleLogin
              onSuccess={handleGoogleSuccess}
              onError={() => setError('Google-Anmeldung fehlgeschlagen.')}
              text="signin_with"
              shape="rectangular"
              width="400"
              locale="de"
            />
            <div className="flex w-full items-center gap-3">
              <div className="h-px flex-1 bg-[var(--color-border)]" />
              <span className="text-xs text-[var(--color-muted)]">oder</span>
              <div className="h-px flex-1 bg-[var(--color-border)]" />
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
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

        {registrationEnabled && (
          <p className="text-center text-sm text-[var(--color-muted)]">
            Noch kein Konto?{' '}
            <Link to="/register" className="text-[var(--color-primary)] hover:underline">
              Jetzt registrieren
            </Link>
          </p>
        )}
      </div>
    </AppLayout>
  )
}

export function LoginPage() {
  const [googleClientId, setGoogleClientId] = useState<string | null>(null)
  const [registrationEnabled, setRegistrationEnabled] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    api
      .getGoogleClientId()
      .then((res) => {
        setGoogleClientId(res.clientId || null)
        setRegistrationEnabled(res.registrationEnabled)
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true))
  }, [])

  if (!loaded) return null

  if (googleClientId) {
    return (
      <GoogleOAuthProvider clientId={googleClientId}>
        <LoginForm googleClientId={googleClientId} registrationEnabled={registrationEnabled} />
      </GoogleOAuthProvider>
    )
  }

  return <LoginForm googleClientId={null} registrationEnabled={registrationEnabled} />
}
