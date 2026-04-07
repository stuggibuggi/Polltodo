import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { api, ApiError, type ApiUser } from './api'

interface AuthContextValue {
  user: ApiUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, displayName?: string) => Promise<void>
  googleAuth: (credential: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .me()
      .then((me) => setUser(me))
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  const login = async (email: string, password: string) => {
    const me = await api.login(email, password)
    setUser(me)
  }

  const register = async (email: string, password: string, displayName?: string) => {
    const me = await api.register(email, password, displayName)
    setUser(me)
  }

  const googleAuth = async (credential: string) => {
    const me = await api.googleAuth(credential)
    setUser(me)
  }

  const logout = async () => {
    try {
      await api.logout()
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // ignore
      }
    }
    setUser(null)
  }

  const value = useMemo(() => ({ user, loading, login, register, googleAuth, logout }), [user, loading])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
