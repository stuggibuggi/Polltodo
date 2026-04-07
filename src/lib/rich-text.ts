export function sanitizeRichHtml(input?: string): string {
  if (!input) return ''
  if (typeof window === 'undefined') return input

  const parser = new DOMParser()
  const doc = parser.parseFromString(input, 'text/html')

  doc.querySelectorAll('script,style,iframe,object,embed').forEach((node) => node.remove())

  doc.querySelectorAll('*').forEach((el) => {
    Array.from(el.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase()
      const value = attr.value
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name)
        return
      }
      if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(value)) {
        el.removeAttribute(attr.name)
      }
    })
  })

  return doc.body.innerHTML
}

