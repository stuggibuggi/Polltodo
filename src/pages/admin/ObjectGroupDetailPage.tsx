import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { loadUserScopedState, saveUserScopedState } from '../../lib/filterState'
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
import { DotsInfinityLoader } from '../../components/layout/DotsInfinityLoader'

type Policy = {
  id: string
  questionnaireId: string
  frequency: 'ONCE' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'CUSTOM_DAYS'
  intervalDays?: number | null
  roleNames: string[]
  activeFrom?: string | null
  activeTo?: string | null
  allowLastSubmissionPrefill?: boolean
}
type Role = { id: string; name: string }
type PolicyFormFrequency = 'ONCE' | 'CUSTOM_DAYS' | 'ALWAYS'

export function ObjectGroupDetailPage() {
  const { user: currentUser } = useAuth()
  const { id } = useParams<{ id: string }>()
  const [loadingData, setLoadingData] = useState(true)
  const [group, setGroup] = useState<{ id: string; name: string } | null>(null)
  const [objects, setObjects] = useState<Array<{ id: string; externalId?: string | null; name: string; type?: string; description?: string | null; metadata?: unknown }>>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [members, setMembers] = useState<string[]>([])
  const [policies, setPolicies] = useState<Policy[]>([])
  const [summary, setSummary] = useState<{
    total: number
    open: number
    done: number
    closedByOther: number
    lastCompletedAt?: string | null
    nextDueAt?: string | null
    surveyAssignments?: Array<{
      id: string
      questionnaireId: string
      questionnaireTitle: string
      questionnaireStatus: 'DRAFT' | 'PUBLISHED'
      objectCount: number
      openCount: number
      doneCount: number
      dueAt?: string | null
    }>
  } | null>(null)
  const [questionnaires, setQuestionnaires] = useState<Array<{ id: string; title: string }>>([])
  const [search, setSearch] = useState('')
  const [bulk, setBulk] = useState('')
  const [rules, setRules] = useState<Array<{ id: string; field: string; operator: string; value: string }>>([])
  const [ruleField, setRuleField] = useState('name')
  const [ruleOperator, setRuleOperator] = useState('contains')
  const [ruleValue, setRuleValue] = useState('')
  const [ruleMetadataKey, setRuleMetadataKey] = useState('')
  const [ruleMatchMode, setRuleMatchMode] = useState<'AND' | 'OR'>('AND')
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false)
  const [autoSyncIntervalMinutes, setAutoSyncIntervalMinutes] = useState('60')
  const [lastAutoSyncAt, setLastAutoSyncAt] = useState<string | null>(null)
  const [lastAutoSyncStatus, setLastAutoSyncStatus] = useState<string | null>(null)
  const [lastAutoSyncMessage, setLastAutoSyncMessage] = useState<string | null>(null)
  const [showRuleHits, setShowRuleHits] = useState(false)
  const [objectPage, setObjectPage] = useState(1)
  const [objectPageSize, setObjectPageSize] = useState(20)
  const [editingPolicyId, setEditingPolicyId] = useState<string | null>(null)
  const { message: toastMessage, visible: toastVisible, showToast } = useToast()
  const [form, setForm] = useState<{
    questionnaireId: string
    frequency: PolicyFormFrequency
    intervalDays: string
    roleIds: string[]
    activeFrom: string
    activeTo: string
    allowLastSubmissionPrefill: boolean
  }>({
    questionnaireId: '',
    frequency: 'ONCE',
    intervalDays: '',
    roleIds: [],
    activeFrom: '',
    activeTo: '',
    allowLastSubmissionPrefill: false,
  })

  const load = async () => {
    if (!id) return
    setLoadingData(true)
    try {
      const [groupList, objectList, memberList, policyList, qList, summaryData, ruleList, ruleConfig, roleList] = await Promise.all([
        api.listObjectGroups(),
        api.listObjects(),
        api.listObjectGroupMembers(id),
        api.listObjectGroupPolicies(id),
        api.listQuestionnaires(),
        api.getObjectGroupSummary(id),
        api.listObjectGroupRules(id),
        api.getObjectGroupRuleConfig(id).catch(() => ({
          matchMode: 'AND' as const,
          autoSyncEnabled: false,
          autoSyncIntervalMinutes: 0,
          lastAutoSyncAt: null,
          lastAutoSyncStatus: null,
          lastAutoSyncMessage: null,
        })),
        api.listRoles(),
      ])
      setGroup(groupList.find((g) => g.id === id) ?? null)
      setObjects(objectList)
      setMembers(memberList.map((m) => m.objectId))
      setPolicies(policyList as Policy[])
      setQuestionnaires(qList.map((q) => ({ id: q.id, title: q.title })))
      setRoles(roleList.map((r) => ({ id: r.id, name: r.name })))
      setSummary(summaryData)
      setRules(ruleList)
      setRuleMatchMode(ruleConfig.matchMode === 'OR' ? 'OR' : 'AND')
      setAutoSyncEnabled(!!ruleConfig.autoSyncEnabled)
      setAutoSyncIntervalMinutes(String(ruleConfig.autoSyncIntervalMinutes > 0 ? ruleConfig.autoSyncIntervalMinutes : 60))
      setLastAutoSyncAt(ruleConfig.lastAutoSyncAt ?? null)
      setLastAutoSyncStatus(ruleConfig.lastAutoSyncStatus ?? null)
      setLastAutoSyncMessage(ruleConfig.lastAutoSyncMessage ?? null)
    } catch {
      showToast('Inhalte konnten nicht geladen werden.')
    } finally {
      setLoadingData(false)
    }
  }

  useEffect(() => {
    load()
  }, [id])

  useEffect(() => {
    const state = loadUserScopedState(currentUser?.id, `admin-object-group-detail:${id ?? 'unknown'}`, {
      search: '',
      bulk: '',
      ruleField: 'name',
      ruleOperator: 'contains',
      ruleMetadataKey: '',
      ruleMatchMode: 'AND' as 'AND' | 'OR',
      showRuleHits: false,
    })
    setSearch(state.search)
    setBulk(state.bulk)
    setRuleField(state.ruleField)
    setRuleOperator(state.ruleOperator)
    setRuleMetadataKey(state.ruleMetadataKey)
    setRuleMatchMode(state.ruleMatchMode)
    setShowRuleHits(state.showRuleHits)
  }, [currentUser?.id, id])

  useEffect(() => {
    saveUserScopedState(currentUser?.id, `admin-object-group-detail:${id ?? 'unknown'}`, {
      search,
      bulk,
      ruleField,
      ruleOperator,
      ruleMetadataKey,
      ruleMatchMode,
      showRuleHits,
    })
  }, [currentUser?.id, id, search, bulk, ruleField, ruleOperator, ruleMetadataKey, ruleMatchMode, showRuleHits])

  const saveMembers = async () => {
    if (!id) return
    await api.setObjectGroupMembers(id, members)
    showToast('Mitglieder gespeichert.')
    await load()
  }

  const searchTerm = search.trim().toLowerCase()
  const assignedObjects = objects.filter((o) => members.includes(o.id))
  const searchHits = searchTerm
    ? objects.filter((o) => {
        const hay = `${o.name} ${o.externalId ?? ''} ${o.type ?? ''}`.toLowerCase()
        return hay.includes(searchTerm)
      })
    : []
  const ruleHits = showRuleHits ? objects.filter((o) => members.includes(o.id)) : []
  const filteredObjects = searchTerm ? searchHits : showRuleHits ? ruleHits : assignedObjects
  const objectTotalPages = Math.max(1, Math.ceil(filteredObjects.length / objectPageSize))
  const objectCurrentPage = Math.min(objectPage, objectTotalPages)
  const objectPageStart = (objectCurrentPage - 1) * objectPageSize
  const pageObjects = filteredObjects.slice(objectPageStart, objectPageStart + objectPageSize)

  useEffect(() => {
    setObjectPage(1)
  }, [search, showRuleHits, objectPageSize])

  useEffect(() => {
    if (objectPage > objectTotalPages) setObjectPage(objectTotalPages)
  }, [objectPage, objectTotalPages])

  const addAllFiltered = () => {
    const ids = new Set(members)
    filteredObjects.forEach((o) => ids.add(o.id))
    setMembers(Array.from(ids))
  }

  const removeAllFiltered = () => {
    const removeIds = new Set(filteredObjects.map((o) => o.id))
    setMembers(members.filter((id) => !removeIds.has(id)))
  }

  const applyBulk = (mode: 'add' | 'remove') => {
    const lines = bulk.split('\n').map((l) => l.trim()).filter(Boolean)
    const idsByName = new Map(objects.map((o) => [o.name.toLowerCase(), o.id]))
    const idsByExternal = new Map(objects.map((o) => [String(o.externalId ?? '').toLowerCase(), o.id]))
    const ids = lines.map((line) => idsByName.get(line.toLowerCase()) ?? idsByExternal.get(line.toLowerCase()) ?? line)
    if (mode === 'add') {
      const set = new Set(members)
      ids.forEach((id) => set.add(id))
      setMembers(Array.from(set))
      showToast('Bulk hinzugefuegt.')
    } else {
      const set = new Set(ids)
      setMembers(members.filter((id) => !set.has(id)))
      showToast('Bulk entfernt.')
    }
  }

  const addRule = async () => {
    if (!id || !ruleValue.trim()) return
    const field = ruleField === 'metadata' ? `metadata:${ruleMetadataKey.trim()}` : ruleField
    if (ruleField === 'metadata' && !ruleMetadataKey.trim()) {
      showToast('Bitte Meta-Key waehlen.')
      return
    }
    await api.createObjectGroupRule(id, { field, operator: ruleOperator, value: ruleValue.trim() })
    setRuleValue('')
    if (ruleField === 'metadata') setRuleMetadataKey('')
    showToast('Regel gespeichert.')
    await load()
  }

  const applyRules = async () => {
    if (!id) return
    await api.applyObjectGroupRules(id)
    setShowRuleHits(true)
    showToast('Regeln angewendet.')
    await load()
  }

  const saveRuleEngineJobConfig = async () => {
    if (!id) return
    const minutes = Math.floor(Number(autoSyncIntervalMinutes))
    if (autoSyncEnabled && (!Number.isFinite(minutes) || minutes <= 0)) {
      showToast('Bitte ein gueltiges Minuten-Intervall > 0 eingeben.')
      return
    }
    const result = await api.updateObjectGroupRuleConfig(id, {
      autoSyncEnabled,
      autoSyncIntervalMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 0,
    })
    setAutoSyncEnabled(result.autoSyncEnabled)
    setAutoSyncIntervalMinutes(String(result.autoSyncIntervalMinutes > 0 ? result.autoSyncIntervalMinutes : 60))
    setLastAutoSyncAt(result.lastAutoSyncAt ?? null)
    setLastAutoSyncStatus(result.lastAutoSyncStatus ?? null)
    setLastAutoSyncMessage(result.lastAutoSyncMessage ?? null)
    showToast('Job-Modus gespeichert.')
  }

  const addPolicy = async () => {
    if (!id || !form.questionnaireId) {
      showToast('Bitte Fragebogen waehlen.')
      return
    }
    if (form.frequency === 'CUSTOM_DAYS') {
      const days = Number(form.intervalDays)
      if (!Number.isFinite(days) || days <= 0) {
        showToast('Bitte gueltige Intervall-Tage eingeben.')
        return
      }
      if (!form.activeFrom) {
        showToast('Bei wiederkehrenden Umfragen ist ein Startdatum erforderlich.')
        return
      }
    }
    const roleNameById = new Map(roles.map((r) => [r.id, r.name]))
    const payload = {
      frequency: form.frequency === 'ALWAYS' ? 'CUSTOM_DAYS' : form.frequency,
      intervalDays:
        form.frequency === 'CUSTOM_DAYS'
          ? Number(form.intervalDays)
          : form.frequency === 'ALWAYS'
            ? 0
            : undefined,
      roleNames: form.roleIds.map((rid) => roleNameById.get(rid)).filter((x): x is string => Boolean(x)),
      activeFrom: form.activeFrom || undefined,
      activeTo: form.activeTo || undefined,
      allowLastSubmissionPrefill: form.allowLastSubmissionPrefill,
    }
    if (editingPolicyId) {
      await api.updateObjectGroupPolicy(editingPolicyId, payload)
      showToast('Objekt-Policy gespeichert.')
    } else {
      await api.createObjectGroupPolicy(id, {
        questionnaireId: form.questionnaireId,
        ...payload,
      })
      showToast('Objekt-Policy angelegt.')
    }
    setForm({
      questionnaireId: '',
      frequency: 'ONCE',
      intervalDays: '',
      roleIds: [],
      activeFrom: '',
      activeTo: '',
      allowLastSubmissionPrefill: false,
    })
    setEditingPolicyId(null)
    await load()
  }

  const editPolicy = (policy: Policy) => {
    const roleIdByName = new Map(roles.map((r) => [r.name, r.id]))
    setEditingPolicyId(policy.id)
    setForm({
      questionnaireId: policy.questionnaireId,
      frequency:
        policy.frequency === 'ONCE'
          ? 'ONCE'
          : policy.frequency === 'CUSTOM_DAYS' && Number(policy.intervalDays ?? 0) === 0
            ? 'ALWAYS'
            : 'CUSTOM_DAYS',
      intervalDays:
        policy.frequency === 'CUSTOM_DAYS'
          ? String(policy.intervalDays ?? '')
          : policy.frequency === 'MONTHLY'
            ? '30'
            : policy.frequency === 'QUARTERLY'
              ? '90'
              : policy.frequency === 'YEARLY'
                ? '365'
                : '',
      roleIds: (policy.roleNames ?? []).map((name) => roleIdByName.get(name)).filter((x): x is string => Boolean(x)),
      activeFrom: policy.activeFrom ? new Date(policy.activeFrom).toISOString().slice(0, 16) : '',
      activeTo: policy.activeTo ? new Date(policy.activeTo).toISOString().slice(0, 16) : '',
      allowLastSubmissionPrefill: !!policy.allowLastSubmissionPrefill,
    })
  }

  const resetPolicyForm = () => {
    setForm({
      questionnaireId: '',
      frequency: 'ONCE',
      intervalDays: '',
      roleIds: [],
      activeFrom: '',
      activeTo: '',
      allowLastSubmissionPrefill: false,
    })
    setEditingPolicyId(null)
  }

  const addOverride = async () => {
    if (!id || !form.questionnaireId) {
      showToast('Bitte Fragebogen waehlen.')
      return
    }
    if (members.length === 0) {
      showToast('Keine Gruppenobjekte vorhanden.')
      return
    }
    if (form.frequency === 'CUSTOM_DAYS') {
      const days = Number(form.intervalDays)
      if (!Number.isFinite(days) || days <= 0) {
        showToast('Bitte gueltige Intervall-Tage eingeben.')
        return
      }
      if (!form.activeFrom) {
        showToast('Bei wiederkehrenden Umfragen ist ein Startdatum erforderlich.')
        return
      }
    }
    let success = 0
    let failed = 0
    await Promise.all(
      members.map(async (objectId) => {
        try {
          await api.createObjectOverride(objectId, {
            questionnaireId: form.questionnaireId,
            frequency: form.frequency === 'ALWAYS' ? 'CUSTOM_DAYS' : form.frequency,
            intervalDays:
              form.frequency === 'CUSTOM_DAYS'
                ? Number(form.intervalDays)
                : form.frequency === 'ALWAYS'
                  ? 0
                  : undefined,
            roleIds: form.roleIds,
            activeFrom: form.activeFrom || undefined,
            activeTo: form.activeTo || undefined,
          })
          success += 1
        } catch {
          failed += 1
        }
      })
    )
    showToast(`Overrides angelegt: ${success}${failed > 0 ? `, Fehler: ${failed}` : ''}.`)
    await load()
  }

  const deletePolicy = async (policyId: string) => {
    await api.deleteObjectGroupPolicy(policyId)
    showToast('Gruppen-Umfrage geloescht.')
    await load()
  }

  const typeOptions = Array.from(new Set(objects.map((o) => o.type).filter(Boolean))).map(String)
  const metadataKeyOptions = Array.from(
    new Set(
      objects.flatMap((o) => {
        const meta = o.metadata
        if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return []
        return Object.keys(meta as Record<string, unknown>)
      })
    )
  ).sort((a, b) => a.localeCompare(b, 'de'))

  const metadataValueOptions = useMemo(() => {
    if (!ruleMetadataKey) return []
    const set = new Set<string>()
    for (const object of objects) {
      const meta = object.metadata
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) continue
      const value = (meta as Record<string, unknown>)[ruleMetadataKey]
      if (value === undefined || value === null) continue
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        set.add(String(value))
      } else {
        set.add(JSON.stringify(value))
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'de'))
  }, [objects, ruleMetadataKey])

  const formatPolicyFrequency = (policy: Policy): string => {
    if (policy.frequency === 'ONCE') return 'Einmalig'
    if (policy.frequency === 'CUSTOM_DAYS' && Number(policy.intervalDays ?? 0) === 0) return 'Dauerhaft (mehrfach)'
    if (policy.frequency === 'CUSTOM_DAYS') return 'Wiederkehrend'
    if (policy.frequency === 'MONTHLY') return 'Monatlich'
    if (policy.frequency === 'QUARTERLY') return 'Vierteljaehrlich'
    if (policy.frequency === 'YEARLY') return 'Jaehrlich'
    return policy.frequency
  }

  const lastAutoSyncLabel = lastAutoSyncAt
    ? new Date(lastAutoSyncAt).toLocaleString('de-DE')
    : '-'

  if (loadingData) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <DotsInfinityLoader />
      </div>
    )
  }

  if (!group) return <div className="text-[var(--color-muted)]">Gruppe nicht gefunden.</div>

  return (
    <div className="space-y-6">
      <Toast message={toastMessage} visible={toastVisible} />
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-[var(--color-foreground)]">
          Gruppe: {group.name}
        </h2>
        <Button variant="outline" asChild>
          <Link to="/admin/object-groups">Zur Liste</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <h3 className="font-medium">Objektgruppen-Dashboard</h3>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1 text-sm">
            <div>Offen: {summary?.open ?? 0}</div>
            <div>Erledigt: {summary?.done ?? 0}</div>
            <div>Bereits erledigt: {summary?.closedByOther ?? 0}</div>
            <div>Gesamt: {summary?.total ?? 0}</div>
          </div>
          <div className="space-y-1 text-sm">
            <div>
              Letzte Erledigung:{' '}
              {summary?.lastCompletedAt
                ? new Date(summary.lastCompletedAt).toLocaleString('de-DE')
                : '-'}
            </div>
            <div>
              Naechste Faelligkeit:{' '}
              {summary?.nextDueAt
                ? new Date(summary.nextDueAt).toLocaleString('de-DE')
                : '-'}
            </div>
          </div>
        </CardContent>
        <CardContent className="space-y-2">
          {(summary?.surveyAssignments ?? []).map((assignment) => (
            <div
              key={assignment.id}
              className="rounded border border-[var(--color-border)] bg-[var(--color-muted-bg)] px-3 py-2 text-sm"
            >
              <div className="font-medium">
                {assignment.questionnaireTitle} ({assignment.questionnaireStatus})
              </div>
              <div className="text-xs text-[var(--color-muted)]">
                Objekte: {assignment.objectCount} | Offen: {assignment.openCount} | Erledigt: {assignment.doneCount} | Faellig bis:{' '}
                {assignment.dueAt ? new Date(assignment.dueAt).toLocaleString('de-DE') : 'offen'}
              </div>
            </div>
          ))}
          {(summary?.surveyAssignments?.length ?? 0) === 0 && (
            <div className="text-sm text-[var(--color-muted)]">Keine direkt zugeordneten Gruppen-Umfragen vorhanden.</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="font-medium">Objekte in der Gruppe</h3>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Suche..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                if (e.target.value.trim()) setShowRuleHits(false)
              }}
            />
            <Button variant="outline" onClick={addAllFiltered}>
              Alle Treffer hinzufuegen
            </Button>
            <Button variant="outline" onClick={removeAllFiltered}>
              Alle Treffer entfernen
            </Button>
          </div>
          <div className="text-xs text-[var(--color-muted)]">
            Treffer: {filteredObjects.length} | Zugeordnet (Treffer): {filteredObjects.filter((o) => members.includes(o.id)).length} | Zugeordnet gesamt: {members.length}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
            <span>Seite {objectCurrentPage} / {objectTotalPages}</span>
            <span>Pro Seite</span>
            {[10, 20, 40].map((n) => (
              <Button
                key={n}
                size="sm"
                variant={objectPageSize === n ? 'default' : 'outline'}
                onClick={() => setObjectPageSize(n)}
              >
                {n}
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setObjectPage((p) => Math.max(1, p - 1))}
              disabled={objectCurrentPage <= 1}
            >
              Zurueck
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setObjectPage((p) => Math.min(objectTotalPages, p + 1))}
              disabled={objectCurrentPage >= objectTotalPages}
            >
              Weiter
            </Button>
          </div>
          {!searchTerm && !showRuleHits && filteredObjects.length === 0 && (
            <div className="text-xs text-[var(--color-muted)]">
              Keine zugeordneten Objekte vorhanden. Nutzen Sie Suche oder Regel-Engine.
            </div>
          )}
          <div className="grid gap-2 md:grid-cols-2">
            {pageObjects.map((o) => (
              <label key={o.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={members.includes(o.id)}
                  onChange={(e) =>
                    setMembers((prev) =>
                      e.target.checked ? [...prev, o.id] : prev.filter((id) => id !== o.id)
                    )
                  }
                />
                {o.name} {o.externalId ? `(${o.externalId})` : ''}
              </label>
            ))}
          </div>
          <div className="space-y-2">
            <Label>Bulk-Textarea (Name oder ID je Zeile)</Label>
            <textarea
              className="w-full min-h-[100px] rounded border border-[var(--color-border)] p-2 text-sm"
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
            />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => applyBulk('add')}>
                Hinzufuegen
              </Button>
              <Button variant="outline" onClick={() => applyBulk('remove')}>
                Entfernen
              </Button>
            </div>
          </div>
          <Button onClick={saveMembers}>Speichern</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="font-medium">Regel-Engine</h3>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-3">
            <Select
              value={ruleMatchMode}
              onValueChange={async (v) => {
                if (!id) return
                const next = v === 'OR' ? 'OR' : 'AND'
                setRuleMatchMode(next)
                const result = await api.updateObjectGroupRuleConfig(id, { matchMode: next })
                setLastAutoSyncAt(result.lastAutoSyncAt ?? null)
                setLastAutoSyncStatus(result.lastAutoSyncStatus ?? null)
                setLastAutoSyncMessage(result.lastAutoSyncMessage ?? null)
                showToast(`Regelmodus gespeichert: ${next}`)
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="AND">Alle Regeln muessen passen (AND)</SelectItem>
                <SelectItem value="OR">Mindestens eine Regel muss passen (OR)</SelectItem>
              </SelectContent>
            </Select>
            <Select value={ruleField} onValueChange={(v) => setRuleField(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="type">Typ</SelectItem>
                <SelectItem value="metadata">Metadata (JSON)</SelectItem>
              </SelectContent>
            </Select>
            <Select value={ruleOperator} onValueChange={(v) => setRuleOperator(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="contains">enthaelt</SelectItem>
                <SelectItem value="equals">gleich</SelectItem>
                <SelectItem value="starts_with">beginnt mit</SelectItem>
              </SelectContent>
            </Select>
            {ruleField === 'type' ? (
              <Select value={ruleValue} onValueChange={(v) => setRuleValue(v)}>
                <SelectTrigger><SelectValue placeholder="Typ" /></SelectTrigger>
                <SelectContent>
                  {typeOptions.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : ruleField === 'metadata' ? (
              <div className="grid gap-2 md:grid-cols-2">
                <Select
                  value={ruleMetadataKey}
                  onValueChange={(v) => {
                    setRuleMetadataKey(v)
                    setRuleValue('')
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Meta-Key" /></SelectTrigger>
                  <SelectContent>
                    {metadataKeyOptions.map((key) => (
                      <SelectItem key={key} value={key}>{key}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={ruleValue}
                  onValueChange={(v) => setRuleValue(v)}
                  disabled={!ruleMetadataKey || metadataValueOptions.length === 0}
                >
                  <SelectTrigger><SelectValue placeholder="Meta-Wert" /></SelectTrigger>
                  <SelectContent>
                    {metadataValueOptions.map((value) => (
                      <SelectItem key={value} value={value}>{value}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <Input value={ruleValue} onChange={(e) => setRuleValue(e.target.value)} placeholder="Wert" />
            )}
          </div>
          <div className="flex gap-2">
            <Button onClick={addRule}>Regel hinzufuegen</Button>
            <Button variant="outline" onClick={applyRules}>Regeln anwenden</Button>
          </div>
          <div className="rounded border border-[var(--color-border)] p-3 space-y-2">
            <div className="font-medium text-sm">Job-Modus (optional)</div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoSyncEnabled}
                onChange={(e) => setAutoSyncEnabled(e.target.checked)}
              />
              Automatische Aktualisierung aktiv
            </label>
            <div className="grid gap-2 md:grid-cols-[220px_1fr] md:items-center">
              <Label>Intervall (Minuten)</Label>
              <Input
                type="number"
                min={1}
                step={1}
                value={autoSyncIntervalMinutes}
                onChange={(e) => setAutoSyncIntervalMinutes(e.target.value)}
                disabled={!autoSyncEnabled}
              />
            </div>
            <div className="text-xs text-[var(--color-muted)]">
              Letzter Job-Lauf: {lastAutoSyncLabel}
              {lastAutoSyncStatus ? ` | Status: ${lastAutoSyncStatus}` : ''}
              {lastAutoSyncMessage ? ` | ${lastAutoSyncMessage}` : ''}
            </div>
            <Button variant="outline" onClick={saveRuleEngineJobConfig}>
              Job-Einstellungen speichern
            </Button>
          </div>
          <div className="space-y-1 text-sm">
            {rules.map((r) => (
              <div key={r.id} className="flex items-center justify-between">
                <span>
                  {r.field.startsWith('metadata:') ? `metadata[${r.field.slice('metadata:'.length)}]` : r.field} {r.operator} {r.value}
                </span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={async () => {
                    await api.deleteObjectGroupRule(r.id)
                    showToast('Regel geloescht.')
                    await load()
                  }}
                >
                  Loeschen
                </Button>
              </div>
            ))}
            {rules.length === 0 && <div className="text-sm text-[var(--color-muted)]">Keine Regeln definiert.</div>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="font-medium">Gruppen-Umfragen</h3>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <Select
              value={form.questionnaireId}
              onValueChange={(v) => setForm((p) => ({ ...p, questionnaireId: v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Fragebogen" />
              </SelectTrigger>
              <SelectContent>
                {questionnaires.map((q) => (
                  <SelectItem key={q.id} value={q.id}>
                    {q.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={form.frequency}
              onValueChange={(v) => setForm((p) => ({ ...p, frequency: v as PolicyFormFrequency }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Intervall" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ONCE">Einmalig</SelectItem>
                <SelectItem value="CUSTOM_DAYS">Wiederkehrend (Tage)</SelectItem>
                <SelectItem value="ALWAYS">Dauerhaft (mehrfach)</SelectItem>
              </SelectContent>
            </Select>
            {form.frequency === 'CUSTOM_DAYS' && (
              <Input
                placeholder="Intervall (Tage)"
                value={form.intervalDays}
                onChange={(e) => setForm((p) => ({ ...p, intervalDays: e.target.value }))}
              />
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Rollen</Label>
              <div className="grid gap-2 md:grid-cols-2">
                {roles.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.roleIds.includes(r.id)}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          roleIds: e.target.checked
                            ? [...p.roleIds, r.id]
                            : p.roleIds.filter((id) => id !== r.id),
                        }))
                      }
                    />
                    {r.name}
                  </label>
                ))}
              </div>
              <div className="text-xs text-[var(--color-muted)]">
                Keine Rolle ausgewaehlt = alle Rolleninhaber mit Rollenbeziehung an den Gruppenobjekten sind berechtigt.
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <Input
                type="datetime-local"
                value={form.activeFrom}
                onChange={(e) => setForm((p) => ({ ...p, activeFrom: e.target.value }))}
                placeholder="Aktiv ab"
              />
              <Input
                type="datetime-local"
                value={form.activeTo}
                onChange={(e) => setForm((p) => ({ ...p, activeTo: e.target.value }))}
                placeholder="Aktiv bis"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.allowLastSubmissionPrefill}
              onChange={(e) => setForm((p) => ({ ...p, allowLastSubmissionPrefill: e.target.checked }))}
            />
            Letzte Objekt-Beantwortung als Vorbefuellung erlauben (nur bei wiederkehrenden Umfragen)
          </label>
          <div className="flex gap-2">
            <Button onClick={addPolicy}>
              {editingPolicyId ? 'Objekt-Policy speichern' : 'Objekt-Policy anlegen'}
            </Button>
            {editingPolicyId && (
              <Button variant="outline" onClick={resetPolicyForm}>
                Abbrechen
              </Button>
            )}
            <Button variant="outline" onClick={addOverride}>
              Override anlegen
            </Button>
          </div>

          <div className="space-y-2">
            {policies.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-sm">
                <div>
                  <div>
                    {questionnaires.find((q) => q.id === p.questionnaireId)?.title ?? p.questionnaireId}
                  </div>
                  <div className="text-xs text-[var(--color-muted)]">
                    {formatPolicyFrequency(p)}
                    {p.intervalDays ? ` (${p.intervalDays} Tage)` : ''} Â· Rollen: {p.roleNames?.length ? p.roleNames.join(', ') : 'Alle Rollen'}
                  </div>
                  <div className="text-xs text-[var(--color-muted)]">
                    Vorbefuellung: {p.allowLastSubmissionPrefill ? 'Letzte Durchfuehrung erlaubt' : 'Nur manuell'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => editPolicy(p)}>
                    Bearbeiten
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => deletePolicy(p.id)}>
                    Loeschen
                  </Button>
                </div>
              </div>
            ))}
            {policies.length === 0 && (
              <div className="text-sm text-[var(--color-muted)]">Keine Gruppen-Policies vorhanden.</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

