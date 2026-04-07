import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Toast, useToast } from '../../components/ui/toast'
import { api } from '../../lib/api'

type Role = { id: string; name: string; assignedUserCount?: number }

export function RoleListPage() {
  const [roles, setRoles] = useState<Role[]>([])
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')

  const { message: toastMessage, visible: toastVisible, showToast } = useToast()

  const load = async () => {
    const list = await api.listRoles()
    setRoles(list)
  }

  useEffect(() => {
    load()
  }, [])

  const handleCreate = async () => {
    if (!name.trim()) return
    setLoading(true)
    try {
      await api.createRole(name.trim())
      setName('')
      showToast('Rolle angelegt.')
      await load()
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    await api.deleteRole(id)
    showToast('Rolle geloescht.')
    await load()
  }

  const filtered = roles.filter((r) => r.name.toLowerCase().includes(filter.trim().toLowerCase()))

  return (
    <div className="space-y-6">
      <Toast message={toastMessage} visible={toastVisible} />
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-[var(--color-foreground)]">Rollen</h2>
      </div>

      <Card>
        <CardHeader>
          <h3 className="font-medium">Neue Rolle</h3>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[1fr_auto]">
          <div className="space-y-2">
            <Label htmlFor="role-name">Name</Label>
            <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button onClick={handleCreate} disabled={loading}>
              Anlegen
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="font-medium">Filter</h3>
        </CardHeader>
        <CardContent className="space-y-2">
          <Input placeholder="Rolle suchen..." value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="text-xs text-[var(--color-muted)]">Treffer: {filtered.length} / {roles.length}</div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {filtered.map((role) => (
          <Card key={role.id}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div>
                <div className="font-medium">{role.name}</div>
                <div className="text-xs text-[var(--color-muted)]">
                  Zugeordnete Personen: {role.assignedUserCount ?? 0}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="destructive" size="sm" onClick={() => handleDelete(role.id)}>
                  Loeschen
                </Button>
              </div>
            </CardHeader>
          </Card>
        ))}
        {filtered.length === 0 && (
          <div className="text-sm text-[var(--color-muted)]">Keine Rollen gefunden.</div>
        )}
      </div>
    </div>
  )
}
