import { useMemo } from 'react'
import type { Question, QuestionDependency, Questionnaire } from '../../types/questionnaire'
import { Button } from '../ui/button'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '../ui/dialog'

type GraphNode = {
  id: string
  kind: 'section' | 'question'
  x: number
  y: number
  width: number
  height: number
  title: string
  lines: string[]
}

type GraphEdge = {
  fromId: string
  toId: string
  label: string
  dashed?: boolean
}

const mergedDeps = (item: { dependency?: QuestionDependency; dependencies?: QuestionDependency[] }) =>
  item.dependencies ?? (item.dependency ? [item.dependency] : [])

const wrap = (value: string, maxLen = 46) => {
  if (!value) return ['']
  const words = value.split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (next.length > maxLen && current) {
      lines.push(current)
      current = word
    } else {
      current = next
    }
  }
  if (current) lines.push(current)
  return lines
}

const questionOptionsLabel = (question: Question) => {
  if (question.type === 'boolean') return 'Antworten: Ja | Nein'
  if (question.type === 'single' || question.type === 'multi') {
    const values = (question.options ?? []).map((o) => o.label || o.value).filter(Boolean)
    if (values.length === 0) return 'Antworten: -'
    return `Antworten: ${values.join(' | ')}`
  }
  if (question.type === 'ranking') {
    const values = (question.rankingOptions ?? []).map((o) => o.label || o.id).filter(Boolean)
    return `Ranking: ${values.join(' | ') || '-'}`
  }
  if (question.type === 'likert') return `Skala: ${question.likertMinLabel || 'niedrig'} -> ${question.likertMaxLabel || 'hoch'}`
  if (question.type === 'percentage') return 'Prozentwert'
  if (question.type === 'date_time') return question.dateTimeMode === 'date' ? 'Datum' : 'Datum + Uhrzeit'
  if (question.type === 'object_picker') return question.objectPickerAllowMultiple ? 'Objekt-Picker (mehrfach)' : 'Objekt-Picker'
  if (question.type === 'info') return 'Hinweistext'
  if (question.type === 'multiline') return 'Mehrzeiliger Text'
  return 'Text'
}

const dependencyLabel = (dep: QuestionDependency, sourceQuestion?: Question) => {
  const op = dep.operator ?? 'eq'
  const valueToText = (value: unknown) => {
    if (value === true) return 'Ja'
    if (value === false) return 'Nein'
    if (Array.isArray(value)) return value.join(', ')
    return String(value ?? '')
  }
  const rawValue = valueToText(dep.value)
  if (sourceQuestion?.type === 'single' && sourceQuestion.options?.length) {
    const opt = sourceQuestion.options.find((o) => o.value === rawValue || o.label === rawValue)
    if (opt) return `${op}: ${opt.label}`
  }
  if (sourceQuestion?.type === 'multi' && Array.isArray(dep.value)) {
    const labels = dep.value.map((entry) => {
      const opt = sourceQuestion.options?.find((o) => o.value === entry || o.label === entry)
      return opt?.label ?? String(entry)
    })
    return `${op}: ${labels.join(', ')}`
  }
  if (op === 'date_within_future_days') return `in den naechsten ${dep.dayOffset ?? 0} Tagen`
  if (op === 'date_equals') return `Datum = ${dep.dateValue || '-'} (+/-${dep.dayOffset ?? 0}d)`
  if (op === 'date_is_future') return `Datum in Zukunft (+/-${dep.dayOffset ?? 0}d)`
  if (op === 'date_is_past') return `Datum in Vergangenheit (+/-${dep.dayOffset ?? 0}d)`
  if (op === 'ranking_position_eq') return `Position = ${dep.positionValue ?? 1}`
  if (op === 'ranking_position_better_than') return `Position < ${dep.positionValue ?? 1}`
  return `${op}: ${rawValue}`
}

export function DependencyGraphDialog({ questionnaire }: { questionnaire: Questionnaire }) {
  const { nodes, edges, width, height } = useMemo(() => {
    const nodeWidth = 320
    const sectionHeight = 56
    const questionHeight = 118
    const columnGap = 380
    const startX = 40
    const sectionY = 20
    const questionStartY = 104
    const questionGap = 170

    const nextNodes: GraphNode[] = []
    const nextEdges: GraphEdge[] = []
    const questionById = new Map<string, Question>()

    questionnaire.sections.forEach((section, sectionIndex) => {
      const x = startX + sectionIndex * columnGap
      nextNodes.push({
        id: `section:${section.id}`,
        kind: 'section',
        x,
        y: sectionY,
        width: nodeWidth,
        height: sectionHeight,
        title: `Sektion ${sectionIndex + 1}: ${section.title || '(ohne Titel)'}`,
        lines: [],
      })

      section.questions.forEach((question, questionIndex) => {
        questionById.set(question.id, question)
        const title = `${sectionIndex + 1}.${questionIndex + 1} ${question.title || question.id}`
        const answers = questionOptionsLabel(question)
        const xQ = x
        const yQ = questionStartY + questionIndex * questionGap
        nextNodes.push({
          id: question.id,
          kind: 'question',
          x: xQ,
          y: yQ,
          width: nodeWidth,
          height: questionHeight,
          title,
          lines: [answers, `Typ: ${question.type}`],
        })
      })
    })

    questionnaire.sections.forEach((section) => {
      mergedDeps(section).forEach((dep) => {
        nextEdges.push({
          fromId: dep.questionId,
          toId: `section:${section.id}`,
          label: dependencyLabel(dep, questionById.get(dep.questionId)),
          dashed: true,
        })
      })
      section.questions.forEach((question) => {
        mergedDeps(question).forEach((dep) => {
          nextEdges.push({
            fromId: dep.questionId,
            toId: question.id,
            label: dependencyLabel(dep, questionById.get(dep.questionId)),
          })
        })
      })
    })

    const maxQuestions = Math.max(...questionnaire.sections.map((s) => s.questions.length), 0)
    const graphHeight = Math.max(460, questionStartY + Math.max(1, maxQuestions) * questionGap + 40)
    const graphWidth = Math.max(900, startX * 2 + questionnaire.sections.length * columnGap)
    return { nodes: nextNodes, edges: nextEdges, width: graphWidth, height: graphHeight }
  }, [questionnaire])

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">Abhaengigkeiten grafisch</Button>
      </DialogTrigger>
      <DialogContent title="Abhaengigkeiten zwischen Fragen" className="max-h-[88vh] max-w-[96vw] p-4">
        <div className="rounded border border-[var(--color-border)] bg-white p-2 text-xs text-[var(--color-muted)]">
          Durchgezogen: Frage {'->'} Frage | Gestrichelt: Frage {'->'} Sektion
        </div>
        <div className="max-h-[75vh] overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-muted-bg)]">
          <svg width={width} height={height}>
            <defs>
              <marker id="arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
                <path d="M0,0 L10,4 L0,8 Z" fill="#64748b" />
              </marker>
            </defs>

            {nodes.map((node) => (
              <g key={node.id}>
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  rx={10}
                  ry={10}
                  fill={node.kind === 'section' ? '#eef2ff' : '#ffffff'}
                  stroke={node.kind === 'section' ? '#6366f1' : '#cbd5e1'}
                  strokeWidth={node.kind === 'section' ? 1.4 : 1}
                />
                {wrap(node.title, node.kind === 'section' ? 52 : 48).slice(0, 2).map((line, idx) => (
                  <text
                    key={`${node.id}-title-${idx}`}
                    x={node.x + 10}
                    y={node.y + 18 + idx * 13}
                    fontSize={node.kind === 'section' ? 12 : 11}
                    fontWeight={node.kind === 'section' ? 600 : 500}
                    fill="#0f172a"
                  >
                    {line}
                  </text>
                ))}
                {node.lines.flatMap((line) => wrap(line, 48)).slice(0, 4).map((line, idx) => (
                  <text
                    key={`${node.id}-line-${idx}`}
                    x={node.x + 10}
                    y={node.y + 48 + idx * 12}
                    fontSize="10"
                    fill="#475569"
                  >
                    {line}
                  </text>
                ))}
              </g>
            ))}

            {edges.map((edge, index) => {
              const from = nodeMap.get(edge.fromId)
              const to = nodeMap.get(edge.toId)
              if (!from || !to) return null
              const sx = from.x + from.width
              const sy = from.y + from.height / 2
              const tx = to.x
              const ty = to.y + to.height / 2
              const dx = Math.max(60, Math.abs(tx - sx) * 0.5)
              const path = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`
              const lx = (sx + tx) / 2
              const ly = (sy + ty) / 2 - 4
              const label = edge.label || '-'
              const labelWidth = Math.max(40, Math.min(260, label.length * 6.2 + 10))
              return (
                <g key={`${edge.fromId}-${edge.toId}-${index}`}>
                  <path
                    d={path}
                    fill="none"
                    stroke="#64748b"
                    strokeWidth="1.6"
                    strokeDasharray={edge.dashed ? '5 4' : undefined}
                    markerEnd="url(#arrow)"
                  />
                  <rect
                    x={lx - labelWidth / 2}
                    y={ly - 10}
                    rx={4}
                    ry={4}
                    width={labelWidth}
                    height={16}
                    fill="#ffffff"
                    stroke="#cbd5e1"
                  />
                  <text x={lx} y={ly + 1} textAnchor="middle" fontSize="10" fill="#334155">
                    {label}
                  </text>
                </g>
              )
            })}
          </svg>
        </div>
        <div className="flex justify-end">
          <DialogClose asChild>
            <Button type="button" variant="outline">Schliessen</Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  )
}
