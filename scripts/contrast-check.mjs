import fs from 'node:fs'
import path from 'node:path'

const cssPath = path.resolve('src/index.css')
const css = fs.readFileSync(cssPath, 'utf8')

function parseCssVars(block) {
  const vars = {}
  const varRegex = /--([a-zA-Z0-9-_]+)\s*:\s*([^;]+);/g
  let match = varRegex.exec(block)
  while (match) {
    vars[`--${match[1]}`] = match[2].trim()
    match = varRegex.exec(block)
  }
  return vars
}

function parseThemeVars(source) {
  const base = {}
  const dark = {}
  const light = {}
  const blockRegex = /([^{}]+)\{([^{}]+)\}/g
  let match = blockRegex.exec(source)
  while (match) {
    const selector = match[1].trim()
    const body = match[2]
    const vars = parseCssVars(body)
    if (!Object.keys(vars).length) {
      match = blockRegex.exec(source)
      continue
    }
    if (selector.includes('@theme')) {
      Object.assign(base, vars)
    }
    if (
      selector.includes(':root') ||
      selector.includes("html[data-theme='dark']")
    ) {
      Object.assign(dark, vars)
    }
    if (selector.includes("html[data-theme='light']")) {
      Object.assign(light, vars)
    }
    match = blockRegex.exec(source)
  }
  const darkResolved = { ...base, ...dark }
  return { dark: darkResolved, light: { ...darkResolved, ...light } }
}

function parseColor(input) {
  const value = input.trim().toLowerCase()
  if (value.startsWith('#')) {
    const hex = value.slice(1)
    if (hex.length === 3) {
      const [r, g, b] = hex.split('').map((c) => parseInt(c + c, 16))
      return { r, g, b }
    }
    if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      }
    }
  }
  const rgbMatch = value.match(/^rgba?\(([^)]+)\)$/)
  if (rgbMatch) {
    const [r, g, b] = rgbMatch[1]
      .split(',')
      .slice(0, 3)
      .map((x) => Number(x.trim()))
    if ([r, g, b].every((n) => Number.isFinite(n))) {
      return { r, g, b }
    }
  }
  return null
}

function toLinear(channel) {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(color) {
  return 0.2126 * toLinear(color.r) + 0.7152 * toLinear(color.g) + 0.0722 * toLinear(color.b)
}

function contrastRatio(fg, bg) {
  const l1 = luminance(fg)
  const l2 = luminance(bg)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

function resolveToken(value, vars) {
  const varMatch = value.match(/^var\((--[a-zA-Z0-9-_]+)\)$/)
  if (varMatch) {
    const next = vars[varMatch[1]]
    if (!next) return null
    return resolveToken(next, vars)
  }
  return value
}

const themeVars = parseThemeVars(css)
const checks = [
  {
    name: 'Button default',
    fg: 'var(--color-primary-button-text)',
    bg: 'var(--color-primary)',
    min: 4.5,
  },
  {
    name: 'Button secondary',
    fg: 'var(--color-foreground)',
    bg: 'var(--color-muted-bg)',
    min: 4.5,
  },
  {
    name: 'Button outline',
    fg: 'var(--color-foreground)',
    bg: 'var(--surface-base)',
    min: 4.5,
  },
  {
    name: 'Button destructive',
    fg: '#ffffff',
    bg: 'var(--color-required)',
    min: 4.5,
  },
  {
    name: 'Input text',
    fg: 'var(--color-foreground)',
    bg: 'var(--surface-elevated)',
    min: 4.5,
  },
  {
    name: 'Link text',
    fg: 'var(--color-primary)',
    bg: 'var(--surface-base)',
    min: 4.5,
  },
  {
    name: 'Table header text',
    fg: 'var(--color-foreground)',
    bg: 'var(--surface-base)',
    min: 4.5,
  },
  {
    name: 'Muted badge text',
    fg: 'var(--color-muted)',
    bg: 'var(--color-muted-bg)',
    min: 4.5,
  },
  {
    name: 'Button secondary hover text',
    fg: 'var(--color-primary)',
    bg: 'var(--color-muted-bg)',
    min: 4.5,
  },
  {
    name: 'Button outline hover text',
    fg: 'var(--color-primary)',
    bg: 'var(--surface-base)',
    min: 4.5,
  },
  {
    name: 'Button ghost hover text',
    fg: 'var(--color-primary)',
    bg: 'var(--color-muted-bg)',
    min: 4.5,
  },
]

let hasError = false
for (const [themeName, vars] of Object.entries(themeVars)) {
  console.log(`\nTheme: ${themeName}`)
  for (const check of checks) {
    const fgRaw = resolveToken(check.fg, vars)
    const bgRaw = resolveToken(check.bg, vars)
    const fg = fgRaw ? parseColor(fgRaw) : null
    const bg = bgRaw ? parseColor(bgRaw) : null
    if (!fg || !bg) {
      console.log(`- ${check.name}: SKIP (unbekannte Farbe: fg=${fgRaw} bg=${bgRaw})`)
      continue
    }
    const ratio = contrastRatio(fg, bg)
    const ok = ratio >= check.min
    if (!ok) hasError = true
    console.log(`- ${check.name}: ${ratio.toFixed(2)} ${ok ? 'OK' : 'FAIL'} (min ${check.min})`)
  }
}

if (hasError) {
  console.error('\nKontrastcheck fehlgeschlagen.')
  process.exit(1)
}

console.log('\nKontrastcheck erfolgreich.')
