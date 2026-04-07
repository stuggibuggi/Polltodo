import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type ApiGroup } from '../../lib/api'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Card, CardContent, CardHeader } from '../../components/ui/card'
import { Toast, useToast } from '../../components/ui/toast'

export function GroupListPage() {
  const [groups, setGroups] = useState<ApiGroup[]>([])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)

  const { message: toastMessage, visible: toastVisible, showToast } = useToast()

  const load = async () => {
    const list = await api.listGroups()
    setGroups(list)
  }

  useEffect(() => {
    load()
  }, [])

  const handleCreate = async () => {
    if (!name.trim()) return
    setLoading(true)
    try {
      await api.createGroup({ name: name.trim(), description: description.trim() || undefined })
      setName('')
      setDescription('')
      showToast('Benutzergruppe angelegt.')
      await load()
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    await api.deleteGroup(id)
    showToast('Benutzergruppe geloescht.')
    await load()
  }

  return (
    <div className="space-y-6">
      <Toast message={toastMessage} visible={toastVisible} />
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-[var(--color-foreground)]">Benutzergruppen</h2>
      </div>

      <Card>
        <CardHeader>
          <h3 className="font-medium">Neue Benutzergruppe</h3>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[1fr_2fr_auto]">
          <div className="space-y-2">
            <Label htmlFor="group-name">Name</Label>
            <Input id="group-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="group-desc">Beschreibung</Label>
            <Input
              id="group-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button onClick={handleCreate} disabled={loading}>
              Anlegen
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {groups.map((group) => (
          <Card key={group.id}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div>
                <div className="font-medium">{group.name}</div>
                {group.description && (
                  <div className="text-xs text-[var(--color-muted)]">{group.description}</div>
                )}
                <div className="mt-1 text-xs text-[var(--color-muted)]">
                  {group.memberCount ?? 0} Mitglieder, {group.questionnaireCount ?? 0} Umfragen
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/admin/groups/${group.id}`}>Bearbeiten</Link>
                </Button>
                <Button variant="destructive" size="sm" onClick={() => handleDelete(group.id)}>
                  Loeschen
                </Button>
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  )
}
