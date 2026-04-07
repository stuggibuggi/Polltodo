import type { Question } from '../../types/questionnaire'
import { QuestionCard } from './QuestionCard'
import { Label } from '../ui/label'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import { cn } from '../../lib/utils'
import { encodeCustomOptionValue, isCustomOptionValue } from '../../lib/custom-options'
import { useEffect, useMemo, useState } from 'react'
import { api, type SelectableUserOption } from '../../lib/api'

interface QuestionFieldProps {
  question: Question
  questionnaireId?: string
  taskId?: string
  value: string | string[] | boolean | undefined
  onChange: (value: string | string[] | boolean) => void
  customOptions?: string[]
  onCustomOptionsChange?: (options: string[]) => void
  reasonValue?: string
  onReasonChange?: (value: string) => void
  objectMetadataValue?: string
  onObjectMetadataChange?: (value: string) => void
  assignmentOptionIssues?: Record<string, 'required' | 'single_only'>
  reasonMissing?: boolean
  isVisible: boolean
  readOnly?: boolean
}

function formatObjectOptionLabel(item: {
  id: string
  name: string
  externalId?: string | null
}) {
  return `${item.externalId ?? item.id} - ${item.name}`
}

function formatUserOptionLabel(item: {
  id: string
  email: string
  displayName?: string | null
  externalId?: string | null
}) {
  const userId = item.externalId?.trim() || item.id
  const name = item.displayName?.trim() || item.email
  return `${name} (${userId})`
}

type AssignmentAnswerEntry = { values: string[] }
type AssignmentAnswerMap = Record<string, AssignmentAnswerEntry>

export function QuestionField({
  question,
  questionnaireId,
  taskId,
  value,
  onChange,
  customOptions = [],
  onCustomOptionsChange,
  reasonValue,
  onReasonChange,
  objectMetadataValue,
  onObjectMetadataChange,
  assignmentOptionIssues = {},
  reasonMissing = false,
  isVisible,
  readOnly = false,
}: QuestionFieldProps) {
  const assignmentHasRequiredOption =
    question.type === 'assignment_picker' &&
    (question.assignmentOptions ?? []).some((option) => !!option.required)
  const isQuestionRequired = !!question.required || assignmentHasRequiredOption
  const [customOptionInput, setCustomOptionInput] = useState('')
  const customQuestionOptions = useMemo(
    () =>
      customOptions.map((label) => ({
        value: encodeCustomOptionValue(label),
        label,
      })),
    [customOptions]
  )
  const combinedOptions = [...(question.options ?? []), ...customQuestionOptions]
  const addCustomOption = () => {
    const label = customOptionInput.trim()
    if (!label) return
    if (customOptions.includes(label)) {
      setCustomOptionInput('')
      return
    }
    const next = [...customOptions, label]
    onCustomOptionsChange?.(next)
    const encoded = encodeCustomOptionValue(label)
    if (question.type === 'single') {
      onChange(encoded)
    } else if (question.type === 'multi') {
      const current = Array.isArray(value) ? value : []
      if (!current.includes(encoded)) onChange([...current, encoded])
    }
    setCustomOptionInput('')
  }
  const removeCustomOption = (label: string) => {
    const encoded = encodeCustomOptionValue(label)
    const next = customOptions.filter((entry) => entry !== label)
    onCustomOptionsChange?.(next)
    if (question.type === 'single' && value === encoded) {
      onChange('')
      return
    }
    if (question.type === 'multi' && Array.isArray(value) && value.includes(encoded)) {
      onChange(value.filter((entry) => entry !== encoded))
    }
  }
  const showReason =
    (question.type === 'single' &&
      question.options?.some((opt) => opt.value === value && opt.requiresReason)) ||
    (question.type === 'multi' &&
      Array.isArray(value) &&
      question.options?.some((opt) => value.includes(opt.value) && opt.requiresReason))
  const textPlaceholder = question.placeholder?.trim() || 'Hier eintragen'
  const [objectSearch, setObjectSearch] = useState('')
  const [objectTotal, setObjectTotal] = useState(0)
  const [objectLoading, setObjectLoading] = useState(false)
  const [assignmentObjectSearchByOption, setAssignmentObjectSearchByOption] = useState<Record<string, string>>({})
  const [assignmentObjectItemsByOption, setAssignmentObjectItemsByOption] = useState<
    Record<string, Array<{ id: string; name: string; externalId?: string | null; type?: string | null }>>
  >({})
  const [assignmentObjectLoadingByOption, setAssignmentObjectLoadingByOption] = useState<Record<string, boolean>>({})
  const [assignmentObjectLabelCache, setAssignmentObjectLabelCache] = useState<Record<string, string>>({})
  const [assignmentUserSearchByOption, setAssignmentUserSearchByOption] = useState<Record<string, string>>({})
  const [assignmentUserItemsByOption, setAssignmentUserItemsByOption] = useState<Record<string, SelectableUserOption[]>>({})
  const [assignmentUserLoadingByOption, setAssignmentUserLoadingByOption] = useState<Record<string, boolean>>({})
  const [assignmentUserLabelCache, setAssignmentUserLabelCache] = useState<Record<string, string>>({})
  const [selectedObjectLabelCache, setSelectedObjectLabelCache] = useState<Record<string, string>>({})
  const [objectItems, setObjectItems] = useState<
    Array<{ id: string; name: string; externalId?: string | null; type?: string | null }>
  >([])
  const searchResultLimit = 10
  const objectPageSize = searchResultLimit
  const isChecklistMode = !!question.objectPickerAllowMultiple && (question.objectPickerMultiMode ?? 'checklist') === 'checklist'
  const shouldLoadObjectOptionsWithoutSearch = isChecklistMode
  const selectedObjectValues = useMemo(
    () =>
      question.type === 'object_picker'
        ? Array.isArray(value)
          ? value.map((entry) => String(entry ?? '').trim()).filter(Boolean)
          : typeof value === 'string' && value.trim()
            ? [value.trim()]
            : []
        : [],
    [question.type, value]
  )
  const objectMetaMap = useMemo(() => {
    if (!objectMetadataValue) return {} as Record<string, { option?: string; text?: string }>
    try {
      const parsed = JSON.parse(objectMetadataValue) as Record<string, unknown>
      if (!parsed || typeof parsed !== 'object') return {}
      const normalized: Record<string, { option?: string; text?: string }> = {}
      Object.entries(parsed).forEach(([key, val]) => {
        if (typeof val === 'string') {
          normalized[key] = { option: val }
          return
        }
        if (val && typeof val === 'object') {
          const option = typeof (val as { option?: unknown }).option === 'string' ? String((val as { option?: unknown }).option) : undefined
          const text = typeof (val as { text?: unknown }).text === 'string' ? String((val as { text?: unknown }).text) : undefined
          if (option || text) normalized[key] = { option, text }
        }
      })
      return normalized
    } catch {
      return {}
    }
  }, [objectMetadataValue])
  const assignmentValueMap = useMemo<AssignmentAnswerMap>(() => {
    if (question.type !== 'assignment_picker') return {}
    if (typeof value !== 'string' || !value.trim()) return {}
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
      const normalized: AssignmentAnswerMap = {}
      Object.entries(parsed).forEach(([optionId, rawEntry]) => {
        if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) return
        const valuesRaw = (rawEntry as { values?: unknown }).values
        if (!Array.isArray(valuesRaw)) return
        const values = valuesRaw.map((entry) => String(entry ?? '').trim()).filter(Boolean)
        normalized[optionId] = { values }
      })
      return normalized
    } catch {
      return {}
    }
  }, [question.type, value])

  const updateAssignmentValues = (optionId: string, nextValues: string[], allowMultiple: boolean) => {
    const trimmed = nextValues.map((entry) => String(entry ?? '').trim()).filter(Boolean)
    const resolved = allowMultiple ? Array.from(new Set(trimmed)) : trimmed.slice(0, 1)
    const next: AssignmentAnswerMap = { ...assignmentValueMap }
    if (resolved.length === 0) {
      delete next[optionId]
    } else {
      next[optionId] = { values: resolved }
    }
    if (Object.keys(next).length === 0) {
      onChange('')
      return
    }
    onChange(JSON.stringify(next))
  }

  useEffect(() => {
    if (question.type !== 'object_picker' || !isVisible) return
    const searchTerm = objectSearch.trim()
    if (!searchTerm && !shouldLoadObjectOptionsWithoutSearch) {
      setObjectItems([])
      setObjectTotal(0)
      setObjectLoading(false)
      return
    }
    let cancelled = false
    setObjectLoading(true)
    api
      .searchObjectPickerOptions({
        q: searchTerm || undefined,
        page: 1,
        pageSize: objectPageSize,
        questionnaireId,
        taskId,
        type: question.objectPickerType,
        types:
          question.objectPickerTypeFilter && question.objectPickerTypeFilter.length > 0
            ? question.objectPickerTypeFilter
            : undefined,
        ids:
          question.objectPickerMode === 'by_ids' &&
          question.objectPickerObjectIds &&
          question.objectPickerObjectIds.length > 0
            ? question.objectPickerObjectIds
            : undefined,
        metadataKey: question.objectPickerMetadataKey,
        metadataValue: question.objectPickerMetadataValue,
        objectGroupIds: question.objectPickerGroupIds,
      })
      .then((result) => {
        if (cancelled) return
        setObjectItems(result.items)
        setObjectTotal(result.total)
        setSelectedObjectLabelCache((prev) => {
          const next = { ...prev }
          result.items.forEach((item) => {
            next[item.id] = formatObjectOptionLabel(item)
            if (item.externalId?.trim()) next[item.externalId.trim()] = formatObjectOptionLabel(item)
          })
          return next
        })
      })
      .catch(() => {
        if (cancelled) return
        setObjectItems([])
        setObjectTotal(0)
      })
      .finally(() => {
        if (!cancelled) setObjectLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [
    isVisible,
    objectPageSize,
    objectSearch,
    questionnaireId,
    question.objectPickerMode,
    question.objectPickerAllowMultiple,
    question.objectPickerMultiMode,
    question.objectPickerType,
    question.objectPickerMetadataKey,
    question.objectPickerMetadataValue,
    question.objectPickerGroupIds,
    question.objectPickerObjectIds,
    question.objectPickerTypeFilter,
    question.type,
    shouldLoadObjectOptionsWithoutSearch,
    taskId,
  ])

  useEffect(() => {
    if (question.type !== 'assignment_picker' || !isVisible || readOnly) return
    const options = question.assignmentOptions ?? []
    options.forEach((option) => {
      const optionId = option.id
      const search =
        option.targetType === 'user'
          ? (assignmentUserSearchByOption[optionId] ?? '').trim()
          : (assignmentObjectSearchByOption[optionId] ?? '').trim()
      if (!search) {
        if (option.targetType === 'user') {
          setAssignmentUserItemsByOption((prev) => ({ ...prev, [optionId]: [] }))
          setAssignmentUserLoadingByOption((prev) => ({ ...prev, [optionId]: false }))
        } else {
          setAssignmentObjectItemsByOption((prev) => ({ ...prev, [optionId]: [] }))
          setAssignmentObjectLoadingByOption((prev) => ({ ...prev, [optionId]: false }))
        }
        return
      }
      if (option.targetType === 'user') {
        setAssignmentUserLoadingByOption((prev) => ({ ...prev, [optionId]: true }))
        api
          .searchSelectableUsers({ q: search, page: 1, pageSize: searchResultLimit })
          .then((result) => {
            setAssignmentUserItemsByOption((prev) => ({ ...prev, [optionId]: result.items }))
            setAssignmentUserLabelCache((prev) => {
              const next = { ...prev }
              result.items.forEach((item) => {
                const label = formatUserOptionLabel(item)
                next[item.id] = label
                if (item.externalId?.trim()) next[item.externalId.trim()] = label
              })
              return next
            })
          })
          .catch(() => {
            setAssignmentUserItemsByOption((prev) => ({ ...prev, [optionId]: [] }))
          })
          .finally(() => {
            setAssignmentUserLoadingByOption((prev) => ({ ...prev, [optionId]: false }))
          })
      } else {
        setAssignmentObjectLoadingByOption((prev) => ({ ...prev, [optionId]: true }))
        api
          .searchObjectPickerOptions({
            q: search,
            page: 1,
            pageSize: searchResultLimit,
            questionnaireId,
            taskId,
            types:
              option.objectTypeFilter && option.objectTypeFilter.length > 0
                ? option.objectTypeFilter
                : undefined,
            objectGroupIds:
              option.objectGroupIds && option.objectGroupIds.length > 0
                ? option.objectGroupIds
                : undefined,
          })
          .then((result) => {
            setAssignmentObjectItemsByOption((prev) => ({ ...prev, [optionId]: result.items }))
            setAssignmentObjectLabelCache((prev) => {
              const next = { ...prev }
              result.items.forEach((item) => {
                const label = formatObjectOptionLabel(item)
                next[item.id] = label
                if (item.externalId?.trim()) next[item.externalId.trim()] = label
              })
              return next
            })
          })
          .catch(() => {
            setAssignmentObjectItemsByOption((prev) => ({ ...prev, [optionId]: [] }))
          })
          .finally(() => {
            setAssignmentObjectLoadingByOption((prev) => ({ ...prev, [optionId]: false }))
          })
      }
    })
  }, [
    assignmentObjectSearchByOption,
    assignmentUserSearchByOption,
    isVisible,
    question.assignmentOptions,
    question.type,
    questionnaireId,
    readOnly,
    taskId,
  ])

  useEffect(() => {
    if (question.type !== 'assignment_picker' || !isVisible) return
    const options = question.assignmentOptions ?? []
    options.forEach((option) => {
      const optionId = option.id
      const selected = assignmentValueMap[optionId]?.values ?? []
      selected.forEach((candidate) => {
        if (option.targetType === 'user') {
          if (assignmentUserLabelCache[candidate]) return
          api
            .searchSelectableUsers({ q: candidate, page: 1, pageSize: 20 })
            .then((result) => {
              const match = result.items.find(
                (entry) => entry.id === candidate || entry.externalId?.trim() === candidate
              )
              if (!match) return
              const label = formatUserOptionLabel(match)
              setAssignmentUserLabelCache((prev) => {
                const next = { ...prev, [candidate]: label, [match.id]: label }
                if (match.externalId?.trim()) next[match.externalId.trim()] = label
                return next
              })
            })
            .catch(() => {})
        } else {
          if (assignmentObjectLabelCache[candidate]) return
          api
            .searchObjectPickerOptions({
              ids: [candidate],
              page: 1,
              pageSize: 10,
              questionnaireId,
              taskId,
              types:
                option.objectTypeFilter && option.objectTypeFilter.length > 0
                  ? option.objectTypeFilter
                  : undefined,
              objectGroupIds:
                option.objectGroupIds && option.objectGroupIds.length > 0
                  ? option.objectGroupIds
                  : undefined,
            })
            .then((result) => {
              const match = result.items.find(
                (entry) => entry.id === candidate || entry.externalId?.trim() === candidate
              )
              if (!match) return
              const label = formatObjectOptionLabel(match)
              setAssignmentObjectLabelCache((prev) => ({ ...prev, [candidate]: label }))
            })
            .catch(() => {})
        }
      })
    })
  }, [
    assignmentObjectLabelCache,
    assignmentUserLabelCache,
    assignmentValueMap,
    isVisible,
    question.assignmentOptions,
    question.type,
    questionnaireId,
    taskId,
  ])

  useEffect(() => {
    if (question.type !== 'object_picker' || !isVisible) return
    const missing = selectedObjectValues.filter((entry) => !selectedObjectLabelCache[entry])
    if (missing.length === 0) return
    let cancelled = false

    const hydrate = async () => {
      for (const candidate of missing) {
        if (cancelled) return
        try {
          const byId = await api.searchObjectPickerOptions({
            ids: [candidate],
            page: 1,
            pageSize: 10,
            questionnaireId,
            taskId,
            type: question.objectPickerType,
            types:
              question.objectPickerTypeFilter && question.objectPickerTypeFilter.length > 0
                ? question.objectPickerTypeFilter
                : undefined,
            metadataKey: question.objectPickerMetadataKey,
            metadataValue: question.objectPickerMetadataValue,
            objectGroupIds: question.objectPickerGroupIds,
          })
          const direct = byId.items[0]
          if (direct) {
            if (cancelled) return
            setSelectedObjectLabelCache((prev) => {
              const next = { ...prev }
              next[candidate] = formatObjectOptionLabel(direct)
              next[direct.id] = formatObjectOptionLabel(direct)
              if (direct.externalId?.trim()) next[direct.externalId.trim()] = formatObjectOptionLabel(direct)
              return next
            })
            continue
          }

          const bySearch = await api.searchObjectPickerOptions({
            q: candidate,
            page: 1,
            pageSize: 20,
            questionnaireId,
            taskId,
            type: question.objectPickerType,
            types:
              question.objectPickerTypeFilter && question.objectPickerTypeFilter.length > 0
                ? question.objectPickerTypeFilter
                : undefined,
            metadataKey: question.objectPickerMetadataKey,
            metadataValue: question.objectPickerMetadataValue,
            objectGroupIds: question.objectPickerGroupIds,
          })
          const exact = bySearch.items.find(
            (item) => item.id === candidate || item.externalId?.trim() === candidate
          )
          if (exact) {
            if (cancelled) return
            setSelectedObjectLabelCache((prev) => {
              const next = { ...prev }
              next[candidate] = formatObjectOptionLabel(exact)
              next[exact.id] = formatObjectOptionLabel(exact)
              if (exact.externalId?.trim()) next[exact.externalId.trim()] = formatObjectOptionLabel(exact)
              return next
            })
          }
        } catch {
          // ignore hydrate errors; fallback stays on raw value
        }
      }
    }

    void hydrate()
    return () => {
      cancelled = true
    }
  }, [
    isVisible,
    questionnaireId,
    question.objectPickerGroupIds,
    question.objectPickerMetadataKey,
    question.objectPickerMetadataValue,
    question.objectPickerType,
    question.objectPickerTypeFilter,
    question.type,
    selectedObjectLabelCache,
    selectedObjectValues,
    taskId,
  ])
  const renderInput = () => {
    switch (question.type) {
      case 'info':
        return null
      case 'text':
        return (
          <Input
            id={question.id}
            placeholder={textPlaceholder}
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            className={question.required ? 'border-[var(--color-required)]/30' : ''}
            required={question.required}
            aria-required={question.required}
            readOnly={readOnly}
            disabled={readOnly}
          />
        )
      case 'multiline':
        return (
          <textarea
            id={question.id}
            placeholder={textPlaceholder}
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            rows={3}
            className={cn(
              'flex w-full rounded-[var(--radius-button)] border border-[var(--color-border)] bg-white px-3 py-2 text-sm shadow-sm placeholder:text-[var(--color-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-0',
              question.required && 'border-[var(--color-required)]/30'
            )}
            required={question.required}
            aria-required={question.required}
            readOnly={readOnly}
            disabled={readOnly}
          />
        )
      case 'date_time':
        return (
          <Input
            id={question.id}
            type={question.dateTimeMode === 'datetime' ? 'datetime-local' : 'date'}
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            className={question.required ? 'border-[var(--color-required)]/30' : ''}
            required={question.required}
            aria-required={question.required}
            readOnly={readOnly}
            disabled={readOnly}
          />
        )
      case 'percentage': {
        const mode = question.percentageMode ?? 'input'
        const minLabel = question.percentageMinLabel?.trim()
        const maxLabel = question.percentageMaxLabel?.trim()
        const numeric =
          typeof value === 'number'
            ? value
            : typeof value === 'string' && value !== ''
              ? Number(value)
              : undefined
        const safeValue = Number.isFinite(numeric as number) ? (numeric as number) : 0
        if (mode === 'slider') {
          return (
            <div className="space-y-2">
              {(minLabel || maxLabel) && (
                <div className="grid grid-cols-2 gap-2 text-xs text-[var(--color-muted)]">
                  <span>{minLabel || ''}</span>
                  <span className="text-right">{maxLabel || ''}</span>
                </div>
              )}
              <input
                id={question.id}
                type="range"
                min={0}
                max={100}
                step={1}
                value={safeValue}
                onChange={(e) => onChange(e.target.value)}
                disabled={readOnly}
                className="w-full"
              />
              <div className="text-xs text-[var(--color-muted)]">{safeValue}%</div>
            </div>
          )
        }
        if (mode === 'select') {
          const options = question.percentageOptions?.length
            ? question.percentageOptions
            : [0, 25, 50, 75, 100]
          return (
            <div className="space-y-2">
              {(minLabel || maxLabel) && (
                <div className="grid grid-cols-2 gap-2 text-xs text-[var(--color-muted)]">
                  <span>{minLabel || ''}</span>
                  <span className="text-right">{maxLabel || ''}</span>
                </div>
              )}
              <Select
                value={typeof value === 'string' ? value : String(safeValue)}
                onValueChange={(v) => {
                  if (!readOnly) onChange(v)
                }}
                disabled={readOnly}
              >
                <SelectTrigger id={question.id}>
                  <SelectValue placeholder="Bitte waehlen" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((entry) => (
                    <SelectItem key={entry} value={String(entry)}>
                      {entry}%
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )
        }
        return (
          <div className="space-y-2">
            {(minLabel || maxLabel) && (
              <div className="grid grid-cols-2 gap-2 text-xs text-[var(--color-muted)]">
                <span>{minLabel || ''}</span>
                <span className="text-right">{maxLabel || ''}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Input
                id={question.id}
                type="number"
                min={0}
                max={100}
                step={1}
                value={(value as string) ?? ''}
                onChange={(e) => onChange(e.target.value)}
                readOnly={readOnly}
                disabled={readOnly}
              />
              <span className="text-sm text-[var(--color-muted)]">%</span>
            </div>
          </div>
        )
      }
      case 'likert': {
        const steps = question.likertSteps ?? 5
        return (
          <div className="space-y-2">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <span className="text-xs text-[var(--color-muted)]">
                {question.likertMinLabel ?? 'Trifft nicht zu'}
              </span>
              <span className="text-right text-xs text-[var(--color-muted)]">
                {question.likertMaxLabel ?? 'Trifft voll zu'}
              </span>
            </div>
            <div className="flex flex-wrap gap-3">
              {Array.from({ length: steps }, (_, index) => String(index + 1)).map((entry) => (
                <label key={entry} className="flex items-center gap-1 text-sm">
                  <input
                    type="radio"
                    name={question.id}
                    checked={String(value ?? '') === entry}
                    onChange={() => {
                      if (!readOnly) onChange(entry)
                    }}
                    disabled={readOnly}
                    className="h-4 w-4 border-[var(--color-border)] text-[var(--color-primary)]"
                  />
                  {entry}
                </label>
              ))}
            </div>
          </div>
        )
      }
      case 'ranking': {
        const options = question.rankingOptions ?? []
        const ranking = Array.isArray(value) ? [...value] : options.map((entry) => entry.id)
        const getLabel = (id: string) => options.find((entry) => entry.id === id)?.label ?? id
        return (
          <div className="space-y-2">
            {ranking.map((id, index) => (
              <div key={id} className="flex items-center gap-2 rounded border border-[var(--color-border)] p-2">
                <span className="w-6 text-center text-xs text-[var(--color-muted)]">{index + 1}</span>
                <span className="flex-1 text-sm">{getLabel(id)}</span>
                {!readOnly && (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={index === 0}
                      onClick={() => {
                        const next = [...ranking]
                        ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                        onChange(next)
                      }}
                    >
                      ^
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={index === ranking.length - 1}
                      onClick={() => {
                        const next = [...ranking]
                        ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
                        onChange(next)
                      }}
                    >
                      v
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        )
      }
      case 'object_picker': {
        const allowMultiple = !!question.objectPickerAllowMultiple
        const multiMode = question.objectPickerMultiMode ?? 'checklist'
        const perObjectMetaEnabled = !!question.objectPickerPerObjectMetaEnabled
        const perObjectMetaLabel = question.objectPickerPerObjectMetaLabel?.trim() || 'Zusatzinformation'
        const perObjectMetaAllowCustomText = !!question.objectPickerPerObjectMetaAllowCustomText
        const perObjectMetaCustomLabel =
          question.objectPickerPerObjectMetaCustomLabel?.trim() || 'Freitext'
        const perObjectMetaOptions = (question.objectPickerPerObjectMetaOptions ?? []).filter(
          (entry) => entry.trim().length > 0
        )
        const selectedValues = Array.isArray(value)
          ? value
          : typeof value === 'string' && value
            ? [value]
            : []
        const setObjectMeta = (
          objectId: string,
          patch: Partial<{ option?: string; text?: string }>
        ) => {
          const next = { ...objectMetaMap }
          const current = next[objectId] ?? {}
          const merged = {
            option: patch.option !== undefined ? patch.option : current.option,
            text: patch.text !== undefined ? patch.text : current.text,
          }
          if (!merged.option && !merged.text) {
            delete next[objectId]
          } else {
            next[objectId] = merged
          }
          onObjectMetadataChange?.(JSON.stringify(next))
        }
        const pruneObjectMeta = (remainingObjectIds: string[]) => {
          const keep = new Set(remainingObjectIds)
          const next: Record<string, { option?: string; text?: string }> = {}
          Object.entries(objectMetaMap).forEach(([key, val]) => {
            if (keep.has(key)) next[key] = val
          })
          onObjectMetadataChange?.(JSON.stringify(next))
        }
        const renderPerObjectMetaFields = (objectId: string) => {
          const entry = objectMetaMap[objectId] ?? {}
          return (
            <div className="space-y-2">
              {perObjectMetaOptions.length > 0 && (
                <Select
                  value={entry.option ?? ''}
                  onValueChange={(metaValue) => setObjectMeta(objectId, { option: metaValue || undefined })}
                  disabled={readOnly}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={perObjectMetaLabel} />
                  </SelectTrigger>
                  <SelectContent>
                    {perObjectMetaOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {perObjectMetaAllowCustomText && (
                <Input
                  value={entry.text ?? ''}
                  onChange={(e) => setObjectMeta(objectId, { text: e.target.value || undefined })}
                  placeholder={perObjectMetaCustomLabel}
                  readOnly={readOnly}
                  disabled={readOnly}
                />
              )}
            </div>
          )
        }
        const removeSelectedObject = (id: string) => {
          const nextSelected = selectedValues.filter((entry) => entry !== id)
          if (allowMultiple) {
            onChange(nextSelected)
          } else {
            onChange('')
          }
          pruneObjectMeta(nextSelected)
        }
        const renderSearchAndAdd = () => (
          <div className="space-y-2 rounded-[var(--radius-button)] border border-[var(--color-border)] bg-white p-3">
            {!readOnly && (
              <>
                <Input
                  placeholder="Objekt suchen (Name oder ID)"
                  value={objectSearch}
                  onChange={(e) => setObjectSearch(e.target.value)}
                />
                <div className="max-h-56 space-y-1 overflow-auto rounded-[var(--radius-button)] border border-[var(--color-border)] p-2">
                  {!objectSearch.trim() && (
                    <div className="px-2 py-1 text-xs text-[var(--color-muted)]">
                      Bitte Suchbegriff eingeben, um Objekte anzuzeigen.
                    </div>
                  )}
                  {objectLoading && (
                    <div className="px-2 py-1 text-xs text-[var(--color-muted)]">Objekte werden geladen...</div>
                  )}
                  {!!objectSearch.trim() && !objectLoading && objectItems.length === 0 && (
                    <div className="px-2 py-1 text-xs text-[var(--color-muted)]">
                      Keine Objekte fuer diese Suche gefunden.
                    </div>
                  )}
                  {!objectLoading &&
                    objectItems.slice(0, searchResultLimit).map((item) => {
                      const checked = selectedValues.includes(item.id)
                      return (
                        <label
                          key={item.id}
                          className={cn(
                            'flex w-full items-start gap-2 rounded-[var(--radius-button)] px-2 py-1 text-left text-sm hover:bg-[var(--color-muted-bg)]'
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const nextChecked = e.target.checked
                              if (allowMultiple) {
                                const next = nextChecked
                                  ? Array.from(new Set([...selectedValues, item.id]))
                                  : selectedValues.filter((id) => id !== item.id)
                                onChange(next)
                                if (!nextChecked) pruneObjectMeta(next)
                                return
                              }
                              if (nextChecked) {
                                onChange(item.id)
                                pruneObjectMeta([item.id])
                              } else {
                                onChange('')
                                pruneObjectMeta([])
                              }
                            }}
                            className="mt-0.5 h-4 w-4 rounded border-[var(--color-border)]"
                            disabled={readOnly || objectLoading}
                          />
                          <span>{formatObjectOptionLabel(item)}</span>
                        </label>
                      )
                    })}
                </div>
                <div className="text-xs text-[var(--color-muted)]">{objectTotal} Treffer</div>
              </>
            )}
          </div>
        )
        return (
          <div className="space-y-3">
            {allowMultiple && multiMode === 'checklist' ? (
              <div className="space-y-2 rounded-[var(--radius-button)] border border-[var(--color-border)] bg-white p-3">
                <div className="text-xs text-[var(--color-muted)]">
                  {selectedValues.length} Objekt(e) ausgewaehlt
                </div>
                <div className="max-h-64 space-y-2 overflow-auto">
                  {objectLoading && (
                    <div className="text-xs text-[var(--color-muted)]">Objekte werden geladen...</div>
                  )}
                  {!!objectSearch.trim() && !objectLoading && objectItems.length === 0 && (
                    <div className="text-xs text-[var(--color-muted)]">
                      Keine Objekte fuer diese Suche gefunden.
                    </div>
                  )}
                  {!objectSearch.trim() && !objectLoading && objectItems.length === 0 && (
                    <div className="text-xs text-[var(--color-muted)]">Keine Objekte verfuegbar.</div>
                  )}
                  {objectItems.map((item) => {
                    const checked = selectedValues.includes(item.id)
                    return (
                      <div key={item.id} className="space-y-2">
                        <label className="flex items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (readOnly) return
                              const next = e.target.checked
                                ? [...selectedValues, item.id]
                                : selectedValues.filter((id) => id !== item.id)
                              onChange(next)
                              if (!e.target.checked) pruneObjectMeta(next)
                            }}
                            className="mt-0.5 h-4 w-4 rounded border-[var(--color-border)]"
                            disabled={readOnly || objectLoading}
                          />
                          <span>
                            {item.name}
                            {item.externalId ? ` (${item.externalId})` : ''}
                          </span>
                        </label>
                        {perObjectMetaEnabled &&
                          checked &&
                          (perObjectMetaOptions.length > 0 || perObjectMetaAllowCustomText) && (
                          <div className="pl-6">
                            {renderPerObjectMetaFields(item.id)}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="space-y-3 rounded-[var(--radius-button)] border border-[var(--color-border)] bg-white p-3">
                {renderSearchAndAdd()}
                <div className="space-y-2">
                  <div className="text-xs text-[var(--color-muted)]">
                    Ausgewaehlte Objekte: {selectedValues.length}
                  </div>
                  {selectedValues.length === 0 && (
                    <p className="text-xs text-[var(--color-muted)]">Keine Objekte ausgewaehlt.</p>
                  )}
                  {selectedValues.length > 0 && (
                    <div className="space-y-2">
                      {selectedValues.map((id) => (
                        <div
                          key={id}
                          className="flex flex-wrap items-center gap-2 rounded-[var(--radius-button)] border border-[var(--color-border)] p-2"
                        >
                          <span className="text-sm">{selectedObjectLabelCache[id] ?? id}</span>
                          {perObjectMetaEnabled &&
                            (perObjectMetaOptions.length > 0 || perObjectMetaAllowCustomText) && (
                            <div className="min-w-56">
                              {renderPerObjectMetaFields(id)}
                            </div>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeSelectedObject(id)}
                            disabled={readOnly}
                          >
                            Entfernen
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            {perObjectMetaEnabled &&
              (perObjectMetaOptions.length > 0 || perObjectMetaAllowCustomText) &&
              !allowMultiple &&
              selectedValues.length === 1 && (
                <div>{renderPerObjectMetaFields(selectedValues[0])}</div>
              )}
          </div>
        )
      }
      case 'boolean':
        return (
          <div className="flex gap-4">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name={question.id}
                checked={value === true}
                onChange={() => {
                  if (!readOnly) onChange(true)
                }}
                className="h-4 w-4 border-[var(--color-border)] text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
                disabled={readOnly}
              />
              <span className="text-sm">Ja</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name={question.id}
                checked={value === false}
                onChange={() => {
                  if (!readOnly) onChange(false)
                }}
                className="h-4 w-4 border-[var(--color-border)] text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
                disabled={readOnly}
              />
              <span className="text-sm">Nein</span>
            </label>
          </div>
        )
      case 'single':
        if (combinedOptions.length === 0) return null
        return (
          <div className="space-y-3">
            <Select
              value={(value as string) ?? ''}
              onValueChange={(v) => {
                if (!readOnly) onChange(v)
              }}
              required={question.required}
              disabled={readOnly}
            >
              <SelectTrigger
                id={question.id}
                className={question.required ? 'border-[var(--color-required)]/30' : ''}
              >
                <SelectValue placeholder={question.placeholder ?? 'Bitte wählen'} />
              </SelectTrigger>
              <SelectContent>
                {combinedOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <span className="inline-flex items-center gap-2">
                      <span>{opt.label}</span>
                      {isCustomOptionValue(opt.value) && (
                        <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                          added
                        </span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {question.allowCustomOptions && !readOnly && (
              <div className="space-y-2 rounded-md border border-[var(--color-border)] p-3">
                <p className="text-xs text-[var(--color-muted)]">Weitere Antwort hinzufuegen</p>
                <div className="flex gap-2">
                  <Input
                    placeholder="Eigene Antwort"
                    value={customOptionInput}
                    onChange={(e) => setCustomOptionInput(e.target.value)}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={addCustomOption}>
                    Hinzufuegen
                  </Button>
                </div>
                {customOptions.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {customOptions.map((label) => (
                      <Button
                        key={label}
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeCustomOption(label)}
                      >
                        {label} x
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {showReason && (
              <div className="space-y-2">
                <p className="text-xs text-[var(--color-muted)]">
                  Für die aktuelle Auswahl ist eine Begründung notwendig.
                </p>
                <textarea
                  rows={3}
                  value={reasonValue ?? ''}
                  onChange={(e) => onReasonChange?.(e.target.value)}
                  readOnly={readOnly}
                  disabled={readOnly}
                  className={cn(
                    'flex w-full rounded-[var(--radius-button)] border border-[var(--color-border)] bg-white px-3 py-2 text-sm shadow-sm placeholder:text-[var(--color-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-0',
                    reasonMissing && 'border-[var(--color-required)]/60 ring-2 ring-[var(--color-required)]/40'
                  )}
                  placeholder="Begründung eingeben…"
                />
              </div>
            )}
          </div>
        )
      case 'multi':
        if (combinedOptions.length === 0) return null
        return (
          <div className="space-y-3">
            <div className="grid gap-2">
              {combinedOptions.map((opt) => {
                const selected = Array.isArray(value) && value.includes(opt.value)
                return (
                  <label key={opt.value} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(e) => {
                        if (readOnly) return
                        const current = Array.isArray(value) ? value : []
                        if (e.target.checked) {
                          onChange([...current, opt.value])
                        } else {
                          onChange(current.filter((v) => v !== opt.value))
                        }
                      }}
                      className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
                      disabled={readOnly}
                    />
                    <span className="inline-flex items-center gap-2">
                      <span>{opt.label}</span>
                      {isCustomOptionValue(opt.value) && (
                        <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                          added
                        </span>
                      )}
                    </span>
                  </label>
                )
              })}
            </div>
            {question.allowCustomOptions && !readOnly && (
              <div className="space-y-2 rounded-md border border-[var(--color-border)] p-3">
                <p className="text-xs text-[var(--color-muted)]">Weitere Antwort hinzufuegen</p>
                <div className="flex gap-2">
                  <Input
                    placeholder="Eigene Antwort"
                    value={customOptionInput}
                    onChange={(e) => setCustomOptionInput(e.target.value)}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={addCustomOption}>
                    Hinzufuegen
                  </Button>
                </div>
                {customOptions.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {customOptions.map((label) => (
                      <Button
                        key={label}
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeCustomOption(label)}
                      >
                        {label} x
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {showReason && (
              <div className="space-y-2">
                <p className="text-xs text-[var(--color-muted)]">
                  Für die aktuelle Auswahl ist eine Begründung notwendig.
                </p>
                <textarea
                  rows={3}
                  value={reasonValue ?? ''}
                  onChange={(e) => onReasonChange?.(e.target.value)}
                  readOnly={readOnly}
                  disabled={readOnly}
                  className={cn(
                    'flex w-full rounded-[var(--radius-button)] border border-[var(--color-border)] bg-white px-3 py-2 text-sm shadow-sm placeholder:text-[var(--color-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-0',
                    reasonMissing && 'border-[var(--color-required)]/60 ring-2 ring-[var(--color-required)]/40'
                  )}
                  placeholder="Begründung eingeben…"
                />
              </div>
            )}
          </div>
        )
      case 'assignment_picker': {
        const options = question.assignmentOptions ?? []
        if (options.length === 0) return null
        return (
          <div className="space-y-3">
            {options.map((option) => {
              const selectedValues = assignmentValueMap[option.id]?.values ?? []
              const isUserTarget = option.targetType === 'user'
              const loading = isUserTarget
                ? !!assignmentUserLoadingByOption[option.id]
                : !!assignmentObjectLoadingByOption[option.id]
              const items = isUserTarget
                ? assignmentUserItemsByOption[option.id] ?? []
                : assignmentObjectItemsByOption[option.id] ?? []
              const search = isUserTarget
                ? assignmentUserSearchByOption[option.id] ?? ''
                : assignmentObjectSearchByOption[option.id] ?? ''
              const visibleItems = items.slice(0, searchResultLimit)
              return (
                <div key={option.id} className="rounded-md border border-[var(--color-border)] p-3 space-y-2">
                  <div
                    className={
                      assignmentOptionIssues[option.id]
                        ? 'rounded-md border border-[var(--color-required)]/60 p-2'
                        : ''
                    }
                  >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium text-[var(--color-foreground)]">
                      {option.label}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-[var(--color-muted)]">
                      <span>{option.required ? 'Pflichtauswahl' : 'Optionale Auswahl'}</span>
                      <span>
                        {option.allowMultiple
                          ? 'Mehrfachauswahl erlaubt'
                          : 'Einzelauswahl'}
                      </span>
                    </div>
                  </div>
                  {assignmentOptionIssues[option.id] && (
                    <div className="mt-1 text-xs text-[var(--color-required)]">
                      {assignmentOptionIssues[option.id] === 'required'
                        ? 'Pflichtzuordnung fehlt.'
                        : 'Hier ist nur eine einzelne Zuordnung erlaubt.'}
                    </div>
                  )}
                  </div>
                  {selectedValues.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {selectedValues.map((selected) => {
                        const label = isUserTarget
                          ? assignmentUserLabelCache[selected] ?? selected
                          : assignmentObjectLabelCache[selected] ?? selected
                        return (
                          <span
                            key={`${option.id}-${selected}`}
                            className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] px-2 py-1 text-xs"
                          >
                            <span>{label}</span>
                            {!readOnly && (
                              <button
                                type="button"
                                className="text-[var(--color-muted)]"
                                onClick={() =>
                                  updateAssignmentValues(
                                    option.id,
                                    selectedValues.filter((entry) => entry !== selected),
                                    !!option.allowMultiple
                                  )
                                }
                              >
                                x
                              </button>
                            )}
                          </span>
                        )
                      })}
                    </div>
                  )}
                  {!readOnly && (
                    <>
                      <Input
                        placeholder={
                          option.searchPlaceholder?.trim()
                            ? option.searchPlaceholder.trim()
                            : isUserTarget
                              ? 'Benutzer suchen (Name, E-Mail, User-ID)'
                              : 'Objekt suchen (ID oder Name)'
                        }
                        value={search}
                        onChange={(e) => {
                          const next = e.target.value
                          if (isUserTarget) {
                            setAssignmentUserSearchByOption((prev) => ({ ...prev, [option.id]: next }))
                          } else {
                            setAssignmentObjectSearchByOption((prev) => ({ ...prev, [option.id]: next }))
                          }
                        }}
                      />
                      <div className="max-h-56 space-y-1 overflow-auto rounded-[var(--radius-button)] border border-[var(--color-border)] p-2">
                        {!search.trim() && (
                          <div className="px-2 py-1 text-xs text-[var(--color-muted)]">
                            Bitte Suchbegriff eingeben, um Treffer anzuzeigen.
                          </div>
                        )}
                        {loading && (
                          <div className="px-2 py-1 text-xs text-[var(--color-muted)]">Treffer werden geladen...</div>
                        )}
                        {!!search.trim() && !loading && items.length === 0 && (
                          <div className="px-2 py-1 text-xs text-[var(--color-muted)]">
                            Keine Treffer fuer diese Suche gefunden.
                          </div>
                        )}
                        {!loading &&
                          visibleItems.map((item) => {
                            const selectedId = item.id
                            const checked = selectedValues.includes(selectedId)
                            const label = isUserTarget
                              ? formatUserOptionLabel(item as SelectableUserOption)
                              : formatObjectOptionLabel(
                                  item as {
                                    id: string
                                    name: string
                                    externalId?: string | null
                                  }
                                )
                            return (
                              <label key={selectedId} className="flex items-start gap-2 rounded-[var(--radius-button)] px-2 py-1 text-sm hover:bg-[var(--color-muted-bg)]">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const nextChecked = e.target.checked
                                    if (option.allowMultiple) {
                                      const next = nextChecked
                                        ? Array.from(new Set([...selectedValues, selectedId]))
                                        : selectedValues.filter((entry) => entry !== selectedId)
                                      updateAssignmentValues(option.id, next, true)
                                    } else {
                                      updateAssignmentValues(option.id, nextChecked ? [selectedId] : [], false)
                                    }
                                  }}
                                  className="mt-0.5 h-4 w-4 rounded border-[var(--color-border)]"
                                  disabled={readOnly || loading}
                                />
                                <span>{label}</span>
                              </label>
                            )
                          })}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )
      }
      default:
        return null
    }
  }

  return (
    <QuestionCard
      title={question.title}
      description={question.description}
      descriptionAsPopup={question.descriptionAsPopup}
      linkUrl={question.linkUrl}
      linkText={question.linkText}
      required={isQuestionRequired}
      showRequiredBadge={question.type !== 'info'}
      isVisible={isVisible}
    >
      <div className="space-y-2">
        <Label htmlFor={question.id} className="sr-only">
          {question.title}
        </Label>
        {renderInput()}
      </div>
    </QuestionCard>
  )
}
