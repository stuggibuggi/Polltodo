import { useEffect, useState } from 'react'

type ToastOptions = {
  durationMs?: number
  fadeMs?: number
}

export function useToast(options: ToastOptions = {}) {
  const { durationMs = 2600, fadeMs = 300 } = options
  const [message, setMessage] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!message) return
    setVisible(true)
    const hideTimer = setTimeout(() => setVisible(false), Math.max(0, durationMs - fadeMs))
    const clearTimer = setTimeout(() => setMessage(null), durationMs)
    return () => {
      clearTimeout(hideTimer)
      clearTimeout(clearTimer)
    }
  }, [message, durationMs, fadeMs])

  const showToast = (msg: string) => {
    setMessage(msg)
  }

  return { message, visible, showToast }
}

export function Toast({ message, visible }: { message: string | null; visible: boolean }) {
  if (!message) return null
  return (
    <div
      className={`fixed right-4 top-4 z-50 rounded border border-[var(--color-border)] bg-white px-3 py-2 text-sm shadow transition-opacity duration-300 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  )
}
