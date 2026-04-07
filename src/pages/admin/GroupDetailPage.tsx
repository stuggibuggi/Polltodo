import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, type ApiGroup, type ApiUser } from '../../lib/api'
import type { Questionnaire } from '../../types/questionnaire'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import { Toast, useToast } from '../../components/ui/toast'
import { useAuth } from '../../lib/auth'
import { loadUserScopedState, saveUserScopedState } from '../../lib/filterState'


export function GroupDetailPage() {
  const { user: currentUser } = useAuth()
  const { id } = useParams<{ id: string }>()
  const [group, setGroup] = useState<ApiGroup | null>(null)
  const [users, setUsers] = useState<ApiUser[]>([])
  const [questionnaires, setQuestionnaires] = useState<Questionnaire[]>([])
  const [objectGroups, setObjectGroups] = useState<Array<{ id: string; name: string }>>([])
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [questionnaireIds, setQuestionnaireIds] = useState<string[]>([])
  const [questionnaireSettings, setQuestionnaireSettings] = useState<Record<string, {
    frequency: 'ONCE' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'CUSTOM_DAYS'
    intervalDays: string
    activeFrom: string
    activeTo: string
  }>>({})
  const [userFilter, setUserFilter] = useState('')
  const [userRoleFilter, setUserRoleFilter] = useState<'ALL' | ApiUser['role']>('ALL')
  const [showSelectedOnly, setShowSelectedOnly] = useState(false)
  const [userPage, setUserPage] = useState(1)
  const [userPageSize, setUserPageSize] = useState(20)
  const [objectGroupIds, setObjectGroupIds] = useState<string[]>([])
  const [memberIdentifierInput, setMemberIdentifierInput] = useState('')
  const [memberIdentifiers, setMemberIdentifiers] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const { message: toastMessage, visible: toastVisible, showToast } = useToast()

  useEffect(() => {
    const state = loadUserScopedState(currentUser?.id, 'admin-group-detail-members', {
      userFilter: '',
      userRoleFilter: 'ALL' as 'ALL' | ApiUser['role'],
      showSelectedOnly: false,
      userPage: 1,
      userPageSize: 20,
    })
    setUserFilter(state.userFilter)
    setUserRoleFilter(state.userRoleFilter)
    setShowSelectedOnly(state.showSelectedOnly)
    setUserPage(state.userPage)
    setUserPageSize(state.userPageSize)
  }, [currentUser?.id])

  useEffect(() => {
    saveUserScopedState(currentUser?.id, 'admin-group-detail-members', {
      userFilter,
      userRoleFilter,
      showSelectedOnly,
      userPage,
      userPageSize,
    })
  }, [currentUser?.id, userFilter, userRoleFilter, showSelectedOnly, userPage, userPageSize])

  useEffect(() => {
    if (!id) return
    Promise.all([
      api.getGroup(id),
      api.listUsers(),
      api.listQuestionnaires(),
      api.groupMembers(id),
      api.groupQuestionnaires(id),
      api.listObjectGroups(),
      api.groupObjectGroups(id),
    ]).then(([groupData, userList, questionnaireList, members, assigned, objectGroupList, assignedObjectGroups]) => {
      setGroup(groupData)
      setUsers(userList)
      setQuestionnaires(questionnaireList)
      setMemberIds(members.map((m) => m.id))
      setQuestionnaireIds(assigned.map((q) => q.id))
      const settings: Record<string, { frequency: 'ONCE' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'CUSTOM_DAYS'; intervalDays: string; activeFrom: string; activeTo: string }> = {}
      assigned.forEach((q) => {
        settings[q.id] = {
          frequency: q.assignment?.frequency ?? 'ONCE',
          intervalDays: q.assignment?.intervalDays ? String(q.assignment.intervalDays) : '',
          activeFrom: q.assignment?.activeFrom ? toInputDate(q.assignment.activeFrom) : '',
          activeTo: q.assignment?.activeTo ? toInputDate(q.assignment.activeTo) : '',
        }
      })
      setQuestionnaireSettings(settings)
      setObjectGroups(objectGroupList)
      setObjectGroupIds(assignedObjectGroups.map((g) => g.id))
    })
  }, [id])

  const toggleId = (list: string[], value: string) =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value]

  const handleSave = async () => {
    if (!id || !group) return
    setSaving(true)
    try {
      await api.updateGroup(id, { name: group.name, description: group.description })
      await api.setGroupMembers(id, memberIds, memberIdentifiers)
      await api.setGroupQuestionnaires(
        id,
        questionnaireIds.map((qid) => {
          const frequency = questionnaireSettings[qid]?.frequency ?? 'ONCE'
          const intervalRaw = Number(questionnaireSettings[qid]?.intervalDays || 0)
          return {
            questionnaireId: qid,
            frequency,
            intervalDays: frequency === 'CUSTOM_DAYS' && intervalRaw > 0 ? intervalRaw : undefined,
            activeFrom: fromInputDate(questionnaireSettings[qid]?.activeFrom ?? ''),
            activeTo: fromInputDate(questionnaireSettings[qid]?.activeTo ?? ''),
          }
        })
      )
      await api.setGroupObjectGroups(id, objectGroupIds)
      const [userList, members] = await Promise.all([api.listUsers(), api.groupMembers(id)])
      setUsers(userList)
      setMemberIds(members.map((m) => m.id))
      setMemberIdentifiers([])
      setMemberIdentifierInput('')
      showToast('Benutzergruppe gespeichert.')
    } finally {
      setSaving(false)
    }
  }

  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => a.email.localeCompare(b.email)),
    [users]
  )

  const filteredUsers = useMemo(() => {
    let list = sortedUsers
    if (userRoleFilter !== 'ALL') {
      list = list.filter((u) => u.role === userRoleFilter)
    }
    if (showSelectedOnly) {
      const selected = new Set(memberIds)
      list = list.filter((u) => selected.has(u.id))
    }
    if (!userFilter.trim()) return list
    const q = userFilter.trim().toLowerCase()
    return list.filter((u) => `${u.email} ${u.externalId ?? ''}`.toLowerCase().includes(q))
  }, [sortedUsers, userFilter, userRoleFilter, showSelectedOnly, memberIds])

  const parseIdentifiers = (raw: string) =>
    Array.from(
      new Set(
        raw
          .split(/[\n,;\s]+/)
          .map((entry) => entry.trim())
          .filter(Boolean)
      )
    )

  const appendIdentifiers = () => {
    const parsed = parseIdentifiers(memberIdentifierInput)
    if (parsed.length === 0) return
    setMemberIdentifiers((prev) => Array.from(new Set([...prev, ...parsed])))
    setMemberIdentifierInput('')
  }

  const removeIdentifier = (value: string) => {
    setMemberIdentifiers((prev) => prev.filter((entry) => entry !== value))
  }

  const formatLoginStatus = (u: ApiUser) =>
    u.lastLoginAt ? `angemeldet (${new Date(u.lastLoginAt).toLocaleString('de-DE')})` : 'noch nie angemeldet'

  const userTotalPages = Math.max(1, Math.ceil(filteredUsers.length / userPageSize))
  const userCurrentPage = Math.min(userPage, userTotalPages)
  const userPageStart = (userCurrentPage - 1) * userPageSize
  const pagedUsers = filteredUsers.slice(userPageStart, userPageStart + userPageSize)

  const sortedQuestionnaires = useMemo(
    () => [...questionnaires].sort((a, b) => a.title.localeCompare(b.title)),
    [questionnaires]
  )
  const sortedObjectGroups = useMemo(
    () => [...objectGroups].sort((a, b) => a.name.localeCompare(b.name)),
    [objectGroups]
  )

  if (!group) {
    return <div className="text-[var(--color-muted)]">Laden...</div>
  }

  return (
    <div className="space-y-6">
      <Toast message={toastMessage} visible={toastVisible} />
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-[var(--color-foreground)]">
          Benutzergruppe: {group.name}
        </h2>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to="/admin/groups">Zur Liste</Link>
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            Speichern
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <h3 className="font-medium">Benutzergruppeninfo</h3>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              value={group.name}
              onChange={(e) => setGroup({ ...group, name: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Beschreibung</Label>
            <Input
              value={group.description ?? ''}
              onChange={(e) => setGroup({ ...group, description: e.target.value || undefined })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="font-medium">Mitglieder</h3>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
            <Input
              placeholder="Benutzer suchen (E-Mail oder UserID)"
              value={userFilter}
              onChange={(e) => {
                setUserFilter(e.target.value)
                setUserPage(1)
              }}
            />
            <Select
              value={userRoleFilter}
              onValueChange={(v) => {
                setUserRoleFilter(v as any)
                setUserPage(1)
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Rolle" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Alle Rollen</SelectItem>
                {currentUser?.role === 'ADMIN' && <SelectItem value="ADMIN">Admin</SelectItem>}
                <SelectItem value="EDITOR">Editor</SelectItem>
                <SelectItem value="VIEWER">Viewer</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
              <span>Pro Seite</span>
              <div className="flex items-center gap-1">
                {[10, 20, 30, 40].map((n) => (
                  <Button
                    key={n}
                    size="sm"
                    variant={userPageSize === n ? 'default' : 'outline'}
                    onClick={() => {
                      setUserPageSize(n)
                      setUserPage(1)
                    }}
                  >
                    {n}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setUserPage((p) => Math.max(1, p - 1))}
                disabled={userCurrentPage <= 1}
              >
                Zurueck
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setUserPage((p) => Math.min(userTotalPages, p + 1))}
                disabled={userCurrentPage >= userTotalPages}
              >
                Weiter
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={showSelectedOnly}
                onChange={(e) => {
                  setShowSelectedOnly(e.target.checked)
                  setUserPage(1)
                }}
              />
              Nur ausgewaehlte
            </label>
          </div>
          <div className="text-xs text-[var(--color-muted)]">
            {filteredUsers.length} Benutzer · Seite {userCurrentPage} / {userTotalPages}
          </div>
          <div className="space-y-2 rounded-[var(--radius-card)] border border-[var(--color-border)] p-3">
            <Label>Weitere Benutzer hinzufuegen (UserID oder E-Mail)</Label>
            <textarea
              className="flex w-full rounded-[var(--radius-button)] border border-[var(--color-border)] bg-white px-3 py-2 text-sm shadow-sm placeholder:text-[var(--color-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-0"
              rows={3}
              value={memberIdentifierInput}
              onChange={(e) => setMemberIdentifierInput(e.target.value)}
              placeholder="Werte getrennt mit Leerzeichen, Komma oder Zeilenumbruch"
            />
            <Button type="button" variant="outline" size="sm" onClick={appendIdentifiers}>
              Zur Aufnahme vormerken
            </Button>
            {memberIdentifiers.length > 0 && (
              <div className="flex flex-wrap gap-2 text-xs">
                {memberIdentifiers.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    className="rounded-full border border-[var(--color-border)] px-2 py-1 hover:bg-[var(--color-muted-bg)]"
                    onClick={() => removeIdentifier(entry)}
                    title="Entfernen"
                  >
                    {entry} x
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {pagedUsers.map((user) => (
            <label key={user.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-[var(--color-border)]"
                checked={memberIds.includes(user.id)}
                onChange={() => setMemberIds((prev) => toggleId(prev, user.id))}
              />
              <span>
                {user.email}
                {user.externalId ? ` | UserID: ${user.externalId}` : ''}
              </span>
              <span className="text-xs text-[var(--color-muted)]">({user.role})</span>
              <span className="text-xs text-[var(--color-muted)]">{formatLoginStatus(user)}</span>
            </label>
          ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="font-medium">Zugeordnete Umfragen</h3>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          {sortedQuestionnaires.map((q) => (
            <label key={q.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-[var(--color-border)]"
                checked={questionnaireIds.includes(q.id)}
                onChange={() => setQuestionnaireIds((prev) => toggleId(prev, q.id))}
              />
              <span>{q.title}</span>
              <span className="text-xs text-[var(--color-muted)]">
                {q.status === 'PUBLISHED' ? 'veroeffentlicht' : 'entwurf'}
              </span>
            </label>
          ))}
        </CardContent>
        {questionnaireIds.length > 0 && (
          <CardContent className="space-y-3">
            {sortedQuestionnaires
              .filter((q) => questionnaireIds.includes(q.id))
              .map((q) => {
                const settings = questionnaireSettings[q.id] ?? {
                  frequency: 'ONCE',
                  intervalDays: '',
                  activeFrom: '',
                  activeTo: '',
                }
                return (
                  <div key={q.id} className="grid gap-2 md:grid-cols-4 text-sm">
                    <div className="md:col-span-2">
                      <div className="font-medium">{q.title}</div>
                      <div className="text-xs text-[var(--color-muted)]">{q.status}</div>
                    </div>
                    <div className="space-y-1">
                      <Label>Intervall</Label>
                      <Select
                        value={settings.frequency}
                        onValueChange={(v) =>
                          setQuestionnaireSettings((prev) => ({
                            ...prev,
                            [q.id]: { ...settings, frequency: v as any },
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ONCE">Einmalig</SelectItem>
                          <SelectItem value="MONTHLY">Monatlich</SelectItem>
                          <SelectItem value="QUARTERLY">Vierteljaehrlich</SelectItem>
                          <SelectItem value="YEARLY">Jaehrlich</SelectItem>
                          <SelectItem value="CUSTOM_DAYS">Individuell (Tage)</SelectItem>
                        </SelectContent>
                      </Select>
                      {settings.frequency === 'CUSTOM_DAYS' && (
                        <Input
                          placeholder="Intervall (Tage)"
                          value={settings.intervalDays}
                          onChange={(e) =>
                            setQuestionnaireSettings((prev) => ({
                              ...prev,
                              [q.id]: { ...settings, intervalDays: e.target.value },
                            }))
                          }
                        />
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label>Aktiv ab/bis</Label>
                      <div className="grid gap-2">
                        <Input
                          type="datetime-local"
                          value={settings.activeFrom}
                          onChange={(e) =>
                            setQuestionnaireSettings((prev) => ({
                              ...prev,
                              [q.id]: { ...settings, activeFrom: e.target.value },
                            }))
                          }
                        />
                        <Input
                          type="datetime-local"
                          value={settings.activeTo}
                          onChange={(e) =>
                            setQuestionnaireSettings((prev) => ({
                              ...prev,
                              [q.id]: { ...settings, activeTo: e.target.value },
                            }))
                          }
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <h3 className="font-medium">Zugeordnete Objektgruppen</h3>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          {sortedObjectGroups.map((g) => (
            <label key={g.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-[var(--color-border)]"
                checked={objectGroupIds.includes(g.id)}
                onChange={() => setObjectGroupIds((prev) => toggleId(prev, g.id))}
              />
              <span>{g.name}</span>
            </label>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

const toInputDate = (value?: string | null) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 16)
}

const fromInputDate = (value: string) => (value ? new Date(value).toISOString() : undefined)
