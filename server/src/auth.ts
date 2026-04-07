import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import type { Role } from '@prisma/client'

export interface AuthUser {
  id: string
  email: string
  role: Role
}

const COOKIE_NAME = 'umfrage_auth'

export function signToken(user: AuthUser, jwtSecret: string) {
  return jwt.sign(user, jwtSecret, { expiresIn: '7d' })
}

const COOKIE_SECURE = process.env.NODE_ENV === 'production'

export function setAuthCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  })
}

export function clearAuthCookie(res: Response) {
  res.clearCookie(COOKIE_NAME)
}

export function getAuthUser(req: Request, jwtSecret: string): AuthUser | null {
  const token = req.cookies?.[COOKIE_NAME]
  if (!token) return null
  try {
    return jwt.verify(token, jwtSecret) as AuthUser
  } catch {
    return null
  }
}

export function requireAuth(jwtSecret: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = getAuthUser(req, jwtSecret)
    if (!user) {
      res.status(401).json({ error: 'UNAUTHORIZED' })
      return
    }
    req.user = user
    next()
  }
}

export function requireRole(roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user
    if (!user || !roles.includes(user.role)) {
      res.status(403).json({ error: 'FORBIDDEN' })
      return
    }
    next()
  }
}
