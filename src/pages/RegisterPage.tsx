import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google'
import { AppLayout } from '../components/layout/AppLayout'
import { DotsInfinityLoader } from '../components/layout/DotsInfinityLoader'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'

const ERROR_MESSAGES: Record<string, string> = {
  MISSING_FIELDS: 'Bitte E-Mail und Passwort eingeben.',
  INVALID_EMAIL: 'Bitte eine gueltige E-Mail-Adresse eingeben.',
  PASSWORD_TOO_SHORT: 'Das Passwort muss mindestens 6 Zeichen lang sein.',
  EMAIL_ALREADY_EXISTS: 'Diese E-Mail-Adresse ist bereits registriert.',
  REGISTRATION_DISABLED: 'Die Registrierung ist derzeit deaktiviert.',
  REGISTRATION_FAILED: 'Registrierung fehlgeschlagen. Bitte versuchen Sie es erneut.',
  GOOGLE_AUTH_NOT_CONFIGURED: 'Google-Anmeldung ist nicht konfiguriert.',
  GOOGLE_AUTH_FAILED: 'Google-Anmeldung fehlgeschlagen. Bitte versuchen Sie es erneut.',
}

function translateError(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = (err as { message: string }).message
    for (const [key, text] of Object.entries(ERROR_MESSAGES)) {
      if (msg.includes(key)) return text
    }
  }
  return 'Ein unerwarteter Fehler ist aufgetreten.'
}

function RegisterForm({ googleClientId }: { googleClientId: string | null }) {
  const navigate = useNavigate()
  const { register, googleAuth } = useAuth()
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (password !== passwordConfirm) {
      setError('Die Passwoerter stimmen nicht ueberein.')
      return
    }
    setLoading(true)
    try {
      await register(email.trim(), password, displayName.trim() || undefined)
      navigate('/')
    } catch (err) {
      setError(translateError(err))
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
      navigate('/')
    } catch (err) {
      setError(translateError(err))
    } finally {
      setLoading(false)
    }
  }

  const heroWidth = 'clamp(320px, 33vw, 720px)'

  return (
    <AppLayout title="Registrieren" subtitle="Erstellen Sie ein neues Konto." showGlobalWaveBackground>
      <div className="mx-auto w-full max-w-md space-y-4">
        <div className="flex flex-col items-center gap-4 pt-10 pb-8">
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
        </div>

        {googleClientId && (
          <div className="flex flex-col items-center gap-3">
            <GoogleLogin
              onSuccess={handleGoogleSuccess}
              onError={() => setError('Google-Anmeldung fehlgeschlagen.')}
              text="signup_with"
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

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="displayName">Anzeigename (optional)</Label>
            <Input
              id="displayName"
              type="text"
              placeholder="Ihr Name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reg-email">E-Mail-Adresse</Label>
            <Input
              id="reg-email"
              type="email"
              placeholder="name@beispiel.de"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reg-password">Passwort</Label>
            <Input
              id="reg-password"
              type="password"
              placeholder="Mindestens 6 Zeichen"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reg-password-confirm">Passwort bestaetigen</Label>
            <Input
              id="reg-password-confirm"
              type="password"
              placeholder="Passwort wiederholen"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              required
              minLength={6}
            />
          </div>
          {error && <p className="text-sm text-[var(--color-required)]">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Registrierung...' : 'Konto erstellen'}
          </Button>
        </form>

        <p className="text-center text-sm text-[var(--color-muted)]">
          Bereits ein Konto?{' '}
          <Link to="/login" className="text-[var(--color-primary)] hover:underline">
            Anmelden
          </Link>
        </p>
      </div>
    </AppLayout>
  )
}

export function RegisterPage() {
  const [googleClientId, setGoogleClientId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    api
      .getGoogleClientId()
      .then((res) => setGoogleClientId(res.clientId || null))
      .catch(() => undefined)
      .finally(() => setLoaded(true))
  }, [])

  if (!loaded) return null

  if (googleClientId) {
    return (
      <GoogleOAuthProvider clientId={googleClientId}>
        <RegisterForm googleClientId={googleClientId} />
      </GoogleOAuthProvider>
    )
  }

  return <RegisterForm googleClientId={null} />
}
