import { useEffect, useState } from 'react'
import { api, type ApiUser, type UserAssignmentOverview } from '../../lib/api'
import type { Questionnaire } from '../../types/questionnaire'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Card, CardContent, CardHeader } from '../../components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog'
import { Toast, useToast } from '../../components/ui/toast'
import { useAuth } from '../../lib/auth'
import { loadUserScopedState, saveUserScopedState } from '../../lib/filterState'

const ROLE_LABELS: Record<ApiUser['role'], string> = {
  ADMIN: 'Admin',
  EDITOR: 'Editor',
  VIEWER: 'Viewer',
}

export function UserListPage() {
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState<ApiUser[]>([])
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<ApiUser['role']>('VIEWER')
  const [loading, setLoading] = useState(false)
  const [questionnaires, setQuestionnaires] = useState<Questionnaire[]>([])
  const [userSelection, setUserSelection] = useState<Record<string, string>>({})
  const [filterText, setFilterText] = useState('')
  const [pageSize, setPageSize] = useState(10)
  const [page, setPage] = useState(1)
  const [bulkDeleteFilter, setBulkDeleteFilter] = useState('')
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [includeAdmins, setIncludeAdmins] = useState(false)
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [overviewOpenByUserId, setOverviewOpenByUserId] = useState<Record<string, boolean>>({})
  const [overviewLoadingByUserId, setOverviewLoadingByUserId] = useState<Record<string, boolean>>({})
  const [overviewByUserId, setOverviewByUserId] = useState<Record<string, UserAssignmentOverview>>({})

  const { message: toastMessage, visible: toastVisible, showToast } = useToast()
  const canAssignAdmin = currentUser?.role === 'ADMIN'
  const allowedRoleEntries = Object.entries(ROLE_LABELS).filter(
    ([value]) => canAssignAdmin || value !== 'ADMIN'
  )

  const load = async () => {
    const list = await api.listUsers()
    const qs = await api.listQuestionnaires()
    setUsers(list)
    setQuestionnaires(qs)
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    const state = loadUserScopedState(currentUser?.id, 'admin-user-list', {
      filterText: '',
      pageSize: 10,
      page: 1,
      bulkDeleteFilter: '',
      includeAdmins: false,
    })
    setFilterText(state.filterText)
    setPageSize(state.pageSize)
    setPage(state.page)
    setBulkDeleteFilter(state.bulkDeleteFilter)
    setIncludeAdmins(state.includeAdmins)
  }, [currentUser?.id])

  useEffect(() => {
    saveUserScopedState(currentUser?.id, 'admin-user-list', {
      filterText,
      pageSize,
      page,
      bulkDeleteFilter,
      includeAdmins,
    })
  }, [currentUser?.id, filterText, pageSize, page, bulkDeleteFilter, includeAdmins])

  const handleCreate = async () => {
    if (!email || !password) return
    setLoading(true)
    try {
      await api.createUser({ email: email.trim(), password, role, displayName: displayName.trim() || undefined })
      setEmail('')
      setDisplayName('')
      setPassword('')
      setRole('VIEWER')
      showToast('Benutzer angelegt.')
      await load()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Benutzer konnte nicht angelegt werden.'
      showToast(message)
    } finally {
      setLoading(false)
    }
  }

  const handleRoleChange = async (id: string, nextRole: ApiUser['role']) => {
    try {
      await api.updateUser(id, { role: nextRole })
      showToast('Rolle aktualisiert.')
      await load()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Rolle konnte nicht geaendert werden.'
      showToast(message)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await api.deleteUser(id)
      showToast('Benutzer geloescht.')
      await load()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Benutzer konnte nicht geloescht werden.'
      showToast(message)
    }
  }

  const handleReset = async (userId: string) => {
    const qId = userSelection[userId]
    if (!qId) return
    await api.resetUserQuestionnaire(userId, qId)
    showToast('Umfrage zurueckgesetzt.')
  }

  const handleBulkDelete = async () => {
    const value = bulkDeleteFilter.trim()
    if (!value) return
    const result = await api.deleteUsersByEmailFilter(value, !includeAdmins)
    showToast(`${result.count} Benutzer geloescht.`)
    setBulkDeleteOpen(false)
    await load()
  }

  const matchesFilter = (user: ApiUser) => {
    const raw = filterText.trim()
    if (!raw) return true

    const tokens = raw.split(' ').map((t) => t.trim()).filter(Boolean)
    let importFilter: boolean | null = null
    const freeTokens: string[] = []

    tokens.forEach((token) => {
      const idx = token.indexOf(':')
      if (idx > 0) {
        const key = token.slice(0, idx).toLowerCase()
        const value = token.slice(idx + 1).toLowerCase()
        if (key === 'imported') {
          if (value === 'true' || value === 'ja' || value === '1') importFilter = true
          if (value === 'false' || value === 'nein' || value === '0') importFilter = false
        } else {
          freeTokens.push(token.toLowerCase())
        }
      } else {
        freeTokens.push(token.toLowerCase())
      }
    })

    if (importFilter !== null) {
      if (!!user.imported !== importFilter) return false
    }

    if (freeTokens.length === 0) return true
    const hay = `${user.email} ${user.displayName ?? ''} ${user.externalId ?? ''} ${user.id} ${ROLE_LABELS[user.role]}`.toLowerCase()
    return freeTokens.every((t) => hay.includes(t))
  }

  const filtered = users.filter(matchesFilter)
  const total = users.length
  const importedCount = users.filter((u) => u.imported).length
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageStart = (currentPage - 1) * pageSize
  const pagedUsers = filtered.slice(pageStart, pageStart + pageSize)

  const goToPage = (next: number) => {
    const safe = Math.max(1, Math.min(totalPages, next))
    setPage(safe)
  }

  const handlePageSize = (size: number) => {
    setPageSize(size)
    setPage(1)
  }

  const toggleOverview = async (userId: string) => {
    const isOpen = !!overviewOpenByUserId[userId]
    if (isOpen) {
      setOverviewOpenByUserId((prev) => ({ ...prev, [userId]: false }))
      return
    }
    setOverviewOpenByUserId((prev) => ({ ...prev, [userId]: true }))
    if (overviewByUserId[userId] || overviewLoadingByUserId[userId]) return
    setOverviewLoadingByUserId((prev) => ({ ...prev, [userId]: true }))
    try {
      const data = await api.getUserAssignmentOverview(userId)
      setOverviewByUserId((prev) => ({ ...prev, [userId]: data }))
    } catch {
      showToast('Zuordnungsdaten konnten nicht geladen werden.')
    } finally {
      setOverviewLoadingByUserId((prev) => ({ ...prev, [userId]: false }))
    }
  }

  const formatLastLogin = (value?: string | null) => {
    if (!value) return 'nie'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return 'nie'
    return date.toLocaleString('de-DE')
  }

  return (
    <div className="space-y-6">
      <Toast message={toastMessage} visible={toastVisible} />
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-[var(--color-foreground)]">Benutzer</h2>
      </div>

      <div className="grid gap-4 md:grid-cols-[240px_1fr]">
        <Card>
          <CardHeader>
            <h3 className="font-medium">Statistik</h3>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>Gesamt: {total}</div>
            <div>Importiert: {importedCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <h3 className="font-medium">Filter & Seiten</h3>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
            <Input
              placeholder="Filter (E-Mail, Name, UserID, Rolle, imported:true/false)"
              value={filterText}
              onChange={(e) => { setFilterText(e.target.value); setPage(1) }}
            />
            <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
              <span>Pro Seite</span>
              <div className="flex items-center gap-1">
                {[10,20,30,40].map((n) => (
                  <Button
                    key={n}
                    size="sm"
                    variant={pageSize === n ? 'default' : 'outline'}
                    onClick={() => handlePageSize(n)}
                  >
                    {n}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}>
                Zurueck
              </Button>
              <Button variant="outline" size="sm" onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages}>
                Weiter
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <h3 className="font-medium">Bulk-Loeschen</h3>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_auto]">
          <Input
            placeholder="E-Mail Filter (z. B. @firma.de oder max.)"
            value={bulkDeleteFilter}
            onChange={(e) => { setBulkDeleteFilter(e.target.value); setPreviewCount(null) }}
          />
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={async () => {
                const value = bulkDeleteFilter.trim()
                if (!value) return
                setPreviewLoading(true)
                try {
                  const result = await api.previewDeleteUsersByEmailFilter(value, !includeAdmins)
                  setPreviewCount(result.count)
                } finally {
                  setPreviewLoading(false)
                }
              }}
              disabled={!bulkDeleteFilter.trim()}
            >
              Vorschau
            </Button>
            <Button
              variant="destructive"
              onClick={() => setBulkDeleteOpen(true)}
              disabled={!bulkDeleteFilter.trim()}
            >
              Benutzer loeschen
            </Button>
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--color-muted)] md:col-span-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeAdmins}
                onChange={(e) => { setIncludeAdmins(e.target.checked); setPreviewCount(null) }}
              />
              Admins einschliessen
            </label>
            {previewLoading && <span>Berechne...</span>}
            {previewCount !== null && !previewLoading && (
              <span>Wuerde {previewCount} Benutzer loeschen.</span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="font-medium">Neuen Benutzer anlegen</h3>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[1fr_1fr_1fr_200px_auto]">
          <div className="space-y-2">
            <Label htmlFor="email">E-Mail</Label>
            <Input id="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="displayName">Name (Displayname)</Label>
            <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Passwort</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Rolle</Label>
            <Select value={role} onValueChange={(v) => setRole(v as ApiUser['role'])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {allowedRoleEntries.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button onClick={handleCreate} disabled={loading}>
              Anlegen
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {pagedUsers.map((user) => (
          <Card key={user.id}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div>
                <div className="font-medium">{user.email}</div>
                <div className="text-xs text-[var(--color-muted)]">
                  {user.displayName ? `Name: ${user.displayName} | ` : ''}
                  {ROLE_LABELS[user.role]}
                  {user.externalId ? ` | UserID: ${user.externalId}` : ''}
                  {` | Letzter Login: ${formatLastLogin(user.lastLoginAt)}`}
                </div>
              </div>
              {user.imported && (
                <span className="rounded-full border border-[var(--color-border)] px-2 py-1 text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                  importiert
                </span>
              )}
              <div className="flex items-center gap-2">
                <Select
                  value={user.role}
                  onValueChange={(v) => handleRoleChange(user.id, v as ApiUser['role'])}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {allowedRoleEntries.map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="destructive" size="sm" onClick={() => handleDelete(user.id)}>
                  Loeschen
                </Button>
                <Button variant="outline" size="sm" onClick={() => void toggleOverview(user.id)}>
                  {overviewOpenByUserId[user.id] ? 'Details ausblenden' : 'Details anzeigen'}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-[var(--color-muted)]">Umfrage zuruecksetzen:</span>
              <Select
                value={userSelection[user.id] ?? ''}
                onValueChange={(v) =>
                  setUserSelection((prev) => ({ ...prev, [user.id]: v }))
                }
              >
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Umfrage waehlen" />
                </SelectTrigger>
                <SelectContent>
                  {questionnaires.map((q) => (
                    <SelectItem key={q.id} value={q.id}>
                      {q.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => handleReset(user.id)}>
                Zuruecksetzen
              </Button>
              {overviewOpenByUserId[user.id] && (
                <div className="mt-3 w-full space-y-3 rounded border border-[var(--color-border)] p-3">
                  {overviewLoadingByUserId[user.id] ? (
                    <div className="text-xs text-[var(--color-muted)]">Lade Zuordnungen...</div>
                  ) : (
                    <>
                      <div className="space-y-1">
                        <div className="text-xs font-medium text-[var(--color-muted)]">
                          Objekt-Rollen-Zuordnungen ({overviewByUserId[user.id]?.roleAssignments?.length ?? 0})
                        </div>
                        {(overviewByUserId[user.id]?.roleAssignments ?? []).map((row) => (
                          <div key={row.id} className="text-xs text-[var(--color-muted)]">
                            {row.objectName} | {row.roleName}
                            {row.via === 'GROUP' && row.groupName ? ` | ueber Benutzergruppe: ${row.groupName}` : ''}
                          </div>
                        ))}
                        {(overviewByUserId[user.id]?.roleAssignments ?? []).length === 0 && (
                          <div className="text-xs text-[var(--color-muted)]">Keine Objekt-Rollen-Zuordnungen.</div>
                        )}
                      </div>
                      <div className="space-y-1">
                        <div className="text-xs font-medium text-[var(--color-muted)]">
                          Zugeordnete Umfragen ({overviewByUserId[user.id]?.surveyAssignments?.length ?? 0})
                        </div>
                        {(overviewByUserId[user.id]?.surveyAssignments ?? []).map((row) => (
                          <div key={row.id} className="rounded border border-[var(--color-border)] bg-[var(--color-muted-bg)] px-2 py-1 text-xs text-[var(--color-muted)]">
                            <div>
                              {row.surveyName} | Fragenkatalog: {row.questionnaireTitle} ({row.questionnaireStatus})
                              {row.objectName ? ` | Objekt: ${row.objectName}` : ''}
                            </div>
                            <div>
                              Rollen: {row.roleNames.join(', ') || '-'} | Durchgefuehrt: {row.performedCount} | Offen: {row.openCount}
                            </div>
                            <div>
                              Aktiv von: {row.activeFrom ? new Date(row.activeFrom).toLocaleString('de-DE') : '-'} | Aktiv bis: {row.activeTo ? new Date(row.activeTo).toLocaleString('de-DE') : 'offen'}
                            </div>
                          </div>
                        ))}
                        {(overviewByUserId[user.id]?.surveyAssignments ?? []).length === 0 && (
                          <div className="text-xs text-[var(--color-muted)]">Keine Umfragen zugeordnet.</div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Benutzer loeschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Alle Benutzer mit E-Mail die "{bulkDeleteFilter || '-'}" enthaelt werden geloescht.
              {includeAdmins ? 'Admins werden mit geloescht.' : 'Admins werden nicht geloescht.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--color-required)] hover:opacity-90"
              onClick={handleBulkDelete}
            >
              Loeschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
