import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { loadUserScopedState, saveUserScopedState } from '../../lib/filterState'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Card, CardContent, CardHeader } from '../../components/ui/card'
import { Toast, useToast } from '../../components/ui/toast'
import { DotsInfinityLoader } from '../../components/layout/DotsInfinityLoader'
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

interface ObjectEntity {
  id: string
  externalId?: string | null
  name: string
  type?: string
  description?: string | null
  groups?: Array<{ id: string; name: string }>
  metadata?: unknown
  roleSummary?: Array<{ roleName: string; personCount: number }>
  surveyAssignments?: Array<{
    id: string
    source: 'DIRECT' | 'OBJECT_GROUP'
    surveyName: string
    questionnaireId: string
    questionnaireTitle: string
    questionnaireStatus: 'DRAFT' | 'PUBLISHED'
    performedCount: number
    openCount: number
    activeFrom?: string | null
    activeTo?: string | null
    assignees: string[]
  }>
}

export function ObjectListPage() {
  const { user: currentUser } = useAuth()
  const [objects, setObjects] = useState<ObjectEntity[]>([])
  const [name, setName] = useState('')
  const [type, setType] = useState('')
  const [externalId, setExternalId] = useState('')
  const [description, setDescription] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterMetaKey, setFilterMetaKey] = useState('')
  const [filterMetaValue, setFilterMetaValue] = useState('')
  const [filterText, setFilterText] = useState('')
  const [typeOptions, setTypeOptions] = useState<string[]>([])
  const [metadataKeyOptions, setMetadataKeyOptions] = useState<string[]>([])
  const [metadataValueOptions, setMetadataValueOptions] = useState<string[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(false)
  const [loadingData, setLoadingData] = useState(false)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [metaDialogObject, setMetaDialogObject] = useState<ObjectEntity | null>(null)

  const { message: toastMessage, visible: toastVisible, showToast } = useToast()

  useEffect(() => {
    const state = loadUserScopedState(currentUser?.id, 'admin-object-list', {
      filterType: '',
      filterMetaKey: '',
      filterMetaValue: '',
      filterText: '',
      pageSize: 20,
      currentPage: 1,
    })
    setFilterType(state.filterType)
    setFilterMetaKey(state.filterMetaKey)
    setFilterMetaValue(state.filterMetaValue)
    setFilterText(state.filterText)
    setPageSize(state.pageSize)
    setCurrentPage(state.currentPage)
  }, [currentUser?.id])

  useEffect(() => {
    saveUserScopedState(currentUser?.id, 'admin-object-list', {
      filterType,
      filterMetaKey,
      filterMetaValue,
      filterText,
      pageSize,
      currentPage,
    })
  }, [currentUser?.id, filterType, filterMetaKey, filterMetaValue, filterText, pageSize, currentPage])

  const load = async (filters?: {
    type?: string
    q?: string
    metaKey?: string
    metaValue?: string
  }) => {
    const startedAt = Date.now()
    setLoadingData(true)
    try {
      const list = await api.listObjectsWithGroups(filters)
      setObjects(list)
    } finally {
      const remaining = 250 - (Date.now() - startedAt)
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))
      setLoadingData(false)
    }
  }

  useEffect(() => {
    api.getObjectPickerFilterOptions()
      .then((opts) => {
        setTypeOptions(opts.types ?? [])
        setMetadataKeyOptions(opts.metadataKeys ?? [])
        setMetadataValueOptions([])
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!filterMetaKey.trim()) {
      setMetadataValueOptions([])
      setFilterMetaValue('')
      return
    }
    api
      .getObjectPickerFilterOptions(filterMetaKey.trim())
      .then((opts) => {
        setMetadataValueOptions(opts.metadataValues ?? [])
      })
      .catch(() => setMetadataValueOptions([]))
  }, [filterMetaKey])

  const hasActiveFilter = Boolean(
    filterType.trim() || filterMetaKey.trim() || filterMetaValue.trim() || filterText.trim()
  )

  useEffect(() => {
    setCurrentPage(1)
    const timer = setTimeout(() => {
      if (!hasActiveFilter) {
        setObjects([])
        return
      }
      load({
        type: filterType.trim() || undefined,
        q: filterText.trim() || undefined,
        metaKey: filterMetaKey.trim() || undefined,
        metaValue: filterMetaValue.trim() || undefined,
      })
    }, 300)
    return () => clearTimeout(timer)
  }, [filterType, filterMetaKey, filterMetaValue, filterText, hasActiveFilter])

  const resetFilters = async () => {
    setFilterType('')
    setFilterMetaKey('')
    setFilterMetaValue('')
    setFilterText('')
    setObjects([])
    setCurrentPage(1)
  }

  const handleCreate = async () => {
    if (!name.trim()) return
    setLoading(true)
    try {
      await api.createObject({ name: name.trim(), type: type.trim() || undefined, externalId: externalId.trim() || undefined, description: description.trim() || undefined })
      setName('')
      setType('')
      setExternalId('')
      setDescription('')
      showToast('Objekt angelegt.')
      if (hasActiveFilter) {
        await load({
          type: filterType.trim() || undefined,
          q: filterText.trim() || undefined,
          metaKey: filterMetaKey.trim() || undefined,
          metaValue: filterMetaValue.trim() || undefined,
        })
      }
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await api.deleteObject(id)
      showToast('Objekt geloescht.')
      if (hasActiveFilter) {
        await load({
          type: filterType.trim() || undefined,
          q: filterText.trim() || undefined,
          metaKey: filterMetaKey.trim() || undefined,
          metaValue: filterMetaValue.trim() || undefined,
        })
      }
    } catch {
      showToast('Loeschen fehlgeschlagen.')
    }
  }

  const handleBulkDelete = async () => {
    if (!filterType) return
    try {
      const result = await api.deleteObjectsByType(filterType.trim())
      showToast(`${result.count} Objekte geloescht.`)
      if (hasActiveFilter) {
        await load({
          type: filterType.trim() || undefined,
          q: filterText.trim() || undefined,
          metaKey: filterMetaKey.trim() || undefined,
          metaValue: filterMetaValue.trim() || undefined,
        })
      }
    } catch {
      showToast('Bulk-Loeschen fehlgeschlagen.')
    }
  }

  const totalPages = Math.max(1, Math.ceil(objects.length / pageSize))
  const safePage = Math.min(currentPage, totalPages)
  const visibleObjects = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return objects.slice(start, start + pageSize)
  }, [objects, safePage, pageSize])

  const selectedMetadataEntries = useMemo(() => {
    const metadata = metaDialogObject?.metadata
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return []
    return Object.entries(metadata as Record<string, unknown>)
  }, [metaDialogObject])

  return (
    <div className="space-y-6">
      <Toast message={toastMessage} visible={toastVisible} />
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-[var(--color-foreground)]">Objekte</h2>
      </div>

      <Card>
        <CardHeader>
          <h3 className="font-medium">Neues Objekt</h3>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[1fr_1fr_1fr_1fr_auto]">
          <div className="space-y-2">
            <Label htmlFor="object-name">Name</Label>
            <Input id="object-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="object-type">Typ</Label>
            <Input id="object-type" value={type} onChange={(e) => setType(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="object-external-id">Objekt-ID</Label>
            <Input id="object-external-id" value={externalId} onChange={(e) => setExternalId(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="object-description">Beschreibung</Label>
            <Input id="object-description" value={description} onChange={(e) => setDescription(e.target.value)} />
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
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Textfilter (Name, Typ, ID, Beschreibung)</Label>
            <Input
              placeholder="z. B. APP-001 oder Zahlungsverkehr"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Typ</Label>
            <Select value={filterType || '__all__'} onValueChange={(v) => setFilterType(v === '__all__' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Alle Typen" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Alle Typen</SelectItem>
                {typeOptions.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Meta-JSON Key</Label>
            <Select
              value={filterMetaKey || '__all__'}
              onValueChange={(v) => {
                setFilterMetaKey(v === '__all__' ? '' : v)
                setFilterMetaValue('')
              }}
            >
              <SelectTrigger><SelectValue placeholder="Alle Keys" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Alle Keys</SelectItem>
                {metadataKeyOptions.map((key) => (
                  <SelectItem key={key} value={key}>
                    {key}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Meta-JSON Wert</Label>
            <Select
              value={filterMetaValue || '__all__'}
              onValueChange={(v) => setFilterMetaValue(v === '__all__' ? '' : v)}
              disabled={!filterMetaKey || metadataValueOptions.length === 0}
            >
              <SelectTrigger><SelectValue placeholder="Alle Werte" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Alle Werte</SelectItem>
                {metadataValueOptions.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void resetFilters()}>
              Zuruecksetzen
            </Button>
            <Button
              variant="destructive"
              onClick={() => setBulkDeleteOpen(true)}
              disabled={!filterType}
            >
              Alle vom Typ loeschen
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm text-[var(--color-muted)]">
        <span>
          {hasActiveFilter ? `Treffer: ${objects.length}` : 'Bitte mindestens einen Filter setzen, um Objekte zu laden.'}
        </span>
        {hasActiveFilter && (
          <div className="flex items-center gap-2">
            <span>Pro Seite</span>
            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setCurrentPage(1) }}>
              <SelectTrigger className="w-[90px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="30">30</SelectItem>
                <SelectItem value="40">40</SelectItem>
              </SelectContent>
            </Select>
            {objects.length > 0 && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                >
                  Zurueck
                </Button>
                <span className="text-sm text-[var(--color-muted)]">
                  Seite {safePage} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                >
                  Weiter
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3">
        {loadingData && (
          <div className="flex min-h-[22vh] items-center justify-center">
            <DotsInfinityLoader />
          </div>
        )}
        {!loadingData && (
          <>
        {visibleObjects.map((obj) => (
          <Card key={obj.id}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div>
                <div className="font-medium">{obj.name}</div>
                {obj.type && <div className="text-xs text-[var(--color-muted)]">{obj.type}</div>}
                {obj.externalId && <div className="text-xs text-[var(--color-muted)]">ID: {obj.externalId}</div>}
                {obj.groups?.length ? (
                  <div className="text-xs text-[var(--color-muted)]">
                    Gruppen: {obj.groups.map((g) => g.name).join(', ')}
                  </div>
                ) : null}
                {obj.metadata !== null && obj.metadata !== undefined && (
                  <div className="mt-1">
                    <Button variant="outline" size="sm" onClick={() => setMetaDialogObject(obj)}>
                      Meta anzeigen
                    </Button>
                  </div>
                )}
                {obj.roleSummary && obj.roleSummary.length > 0 && (
                  <div className="mt-1 text-xs text-[var(--color-muted)]">
                    Rollen: {obj.roleSummary.map((r) => `${r.roleName}: ${r.personCount} Personen`).join(' | ')}
                  </div>
                )}
                <div className="mt-2 space-y-1">
                  <div className="text-xs font-medium text-[var(--color-muted)]">
                    Zugeordnete Umfragen: {obj.surveyAssignments?.length ?? 0}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/admin/objects/${obj.id}`}>Bearbeiten</Link>
                </Button>
                <Button variant="destructive" size="sm" onClick={() => handleDelete(obj.id)}>
                  Loeschen
                </Button>
              </div>
            </CardHeader>
          </Card>
        ))}
          </>
        )}
      </div>

      {hasActiveFilter && objects.length > 0 && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}>
            Zurueck
          </Button>
          <span className="text-sm text-[var(--color-muted)]">
            Seite {safePage} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage >= totalPages}
          >
            Weiter
          </Button>
        </div>
      )}

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Objekte loeschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Es werden alle Objekte mit Typ "{filterType || '-'}" geloescht.
              Dieser Vorgang kann nicht rueckgaengig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--color-required)] hover:opacity-90"
              onClick={async () => {
                await handleBulkDelete()
                setBulkDeleteOpen(false)
              }}
            >
              Loeschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!metaDialogObject} onOpenChange={(open) => { if (!open) setMetaDialogObject(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Meta-Informationen</AlertDialogTitle>
            <AlertDialogDescription>
              {metaDialogObject?.name ?? 'Objekt'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-[50vh] space-y-2 overflow-auto text-sm">
            {!Boolean(metaDialogObject?.metadata) && (
              <div className="text-[var(--color-muted)]">Keine Meta-Informationen vorhanden.</div>
            )}
            {Boolean(metaDialogObject?.metadata) && selectedMetadataEntries.length === 0 && (
              <div className="text-[var(--color-muted)]">
                {JSON.stringify(metaDialogObject?.metadata)}
              </div>
            )}
            {selectedMetadataEntries.map(([key, value]) => (
              <div key={key} className="rounded-md border border-[var(--color-border)] p-2">
                <div className="font-medium">{key}</div>
                <div className="text-[var(--color-muted)] break-all">
                  {typeof value === 'string'
                    ? value
                    : value === null
                      ? 'null'
                      : JSON.stringify(value)}
                </div>
              </div>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Schliessen</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
