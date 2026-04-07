import { useEffect, useRef } from 'react'
import { Button } from '../ui/button'
import { sanitizeRichHtml } from '../../lib/rich-text'

interface RichTextEditorProps {
  value: string
  onChange: (html: string) => void
}

export function RichTextEditor({ value, onChange }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const savedRangeRef = useRef<Range | null>(null)

  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    if (el.innerHTML !== value) {
      el.innerHTML = value || ''
    }
  }, [value])

  const apply = (command: string, commandValue?: string) => {
    const editor = editorRef.current
    if (!editor) return
    editor.focus()
    const selection = window.getSelection()
    if (selection && savedRangeRef.current) {
      selection.removeAllRanges()
      selection.addRange(savedRangeRef.current)
    }
    document.execCommand(command, false, commandValue)
    const html = sanitizeRichHtml(editor.innerHTML ?? '')
    onChange(html)
  }

  useEffect(() => {
    const onSelectionChange = () => {
      const editor = editorRef.current
      const selection = window.getSelection()
      if (!editor || !selection || selection.rangeCount === 0) return
      const range = selection.getRangeAt(0)
      if (editor.contains(range.commonAncestorContainer)) {
        savedRangeRef.current = range.cloneRange()
      }
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [])

  const keepFocus = (e: React.MouseEvent) => {
    e.preventDefault()
  }

  const clearFormatting = () => {
    const editor = editorRef.current
    if (!editor) return
    const plain = editor.innerText || ''
    const html = plain
      .split(/\r?\n/)
      .map((line) =>
        line
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
      )
      .map((line) => `<p>${line || '<br>'}</p>`)
      .join('')
    editor.innerHTML = html
    onChange(sanitizeRichHtml(editor.innerHTML))
    editor.focus()
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onMouseDown={keepFocus} onClick={() => apply('bold')}>
          Fett
        </Button>
        <Button type="button" variant="outline" size="sm" onMouseDown={keepFocus} onClick={() => apply('italic')}>
          Kursiv
        </Button>
        <Button type="button" variant="outline" size="sm" onMouseDown={keepFocus} onClick={() => apply('underline')}>
          Unterstrichen
        </Button>
        <Button type="button" variant="outline" size="sm" onMouseDown={keepFocus} onClick={() => apply('insertUnorderedList')}>
          Liste
        </Button>
        <Button type="button" variant="outline" size="sm" onMouseDown={keepFocus} onClick={() => apply('insertOrderedList')}>
          Nummeriert
        </Button>
        <Button type="button" variant="outline" size="sm" onMouseDown={keepFocus} onClick={clearFormatting}>
          Format entfernen
        </Button>
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={() => onChange(sanitizeRichHtml(editorRef.current?.innerHTML ?? ''))}
        className="rich-text-editor min-h-[160px] rounded-[var(--radius-button)] border border-[var(--color-border)] bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
      />
    </div>
  )
}
