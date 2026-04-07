import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Card, CardContent, CardHeader } from '../../components/ui/card'
import { Toast, useToast } from '../../components/ui/toast'
import { DotsInfinityLoader } from '../../components/layout/DotsInfinityLoader'

export function ObjectGroupListPage() {
  const [groups, setGroups] = useState<Array<{
    id: string
    name: string
    objectCount?: number
    surveyCount?: number
  }>>([])
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingData, setLoadingData] = useState(false)
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const { message: toastMessage, visible: toastVisible, showToast } = useToast()

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const currentPage = Math.min(page, totalPages)

  const load = async () => {
    const startedAt = Date.now()
    setLoadingData(true)
    try {
      const result = await api.listObjectGroupsSummary({ page: currentPage, pageSize })
      setGroups(result.items)
      setTotalCount(result.total)
      const recalculatedTotalPages = Math.max(1, Math.ceil(result.total / pageSize))
      if (currentPage > recalculatedTotalPages) {
        setPage(recalculatedTotalPages)
      }
    } finally {
      const remaining = 250 - (Date.now() - startedAt)
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))
      setLoadingData(false)
    }
  }

  useEffect(() => {
    load()
  }, [page, pageSize])

  const handleCreate = async () => {
    if (!name.trim()) return
    setLoading(true)
    try {
      await api.createObjectGroup(name.trim())
      setName('')
      showToast('Objektgruppe angelegt.')
      if (page !== 1) setPage(1)
      else await load()
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    await api.deleteObjectGroup(id)
    showToast('Objektgruppe geloescht.')
    await load()
  }

  return (
    <div className="space-y-6">
      <Toast message={toastMessage} visible={toastVisible} />
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-[var(--color-foreground)]">Objektgruppen</h2>
      </div>

      <Card>
        <CardHeader>
          <h3 className="font-medium">Anzeige</h3>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
          <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
            <span>Pro Seite</span>
            <div className="flex items-center gap-1">
              {[10, 20, 30, 40].map((n) => (
                <Button
                  key={n}
                  size="sm"
                  variant={pageSize === n ? 'default' : 'outline'}
                  onClick={() => {
                    setPageSize(n)
                    setPage(1)
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
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
            >
              Zurueck
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
            >
              Weiter
            </Button>
          </div>
          <div className="text-xs text-[var(--color-muted)]">
            Seite {currentPage} / {totalPages} - {totalCount} Gruppen
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="font-medium">Neue Gruppe</h3>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[1fr_auto]">
          <div className="space-y-2">
            <Label htmlFor="group-name">Name</Label>
            <Input id="group-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button onClick={handleCreate} disabled={loading}>
              Anlegen
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {loadingData && (
          <div className="flex min-h-[22vh] items-center justify-center">
            <DotsInfinityLoader />
          </div>
        )}
        {!loadingData && (
          <>
        {groups.map((group) => (
          <Card key={group.id}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div>
                <div className="font-medium">{group.name}</div>
                <div className="text-xs text-[var(--color-muted)]">
                  {group.objectCount ?? 0} Objekte
                </div>
                <div className="text-xs text-[var(--color-muted)]">
                  Zugeordnete Umfragen: {group.surveyCount ?? 0}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/admin/object-groups/${group.id}`}>Bearbeiten</Link>
                </Button>
                <Button variant="destructive" size="sm" onClick={() => handleDelete(group.id)}>
                  Loeschen
                </Button>
              </div>
            </CardHeader>
          </Card>
        ))}
          </>
        )}
      </div>
    </div>
  )
}
