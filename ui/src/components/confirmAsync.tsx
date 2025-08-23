// React import not needed with new JSX runtime
import { createRoot } from 'react-dom/client'
import ConfirmModal from './ConfirmModal'

interface ConfirmOptions {
  title?: string
  message?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  maxWidth?: string
  // timeout in ms to auto-cancel (optional)
  timeout?: number
}

export function confirmAsync(
  options: ConfirmOptions | string,
): Promise<boolean> {
  const opts: ConfirmOptions =
    typeof options === 'string' ? { message: options } : options

  return new Promise((resolve) => {
    const container = document.createElement('div')
    container.setAttribute('data-confirm-async', 'true')
    document.body.appendChild(container)

    const root = createRoot(container)

    let settled = false
    let timeoutId: number | undefined

    const cleanup = () => {
      try {
        root.unmount()
      } catch {
        // ignore
      }
      if (container.parentNode) container.parentNode.removeChild(container)
      if (timeoutId) window.clearTimeout(timeoutId)
    }

    const handleResult = (val: boolean) => {
      if (settled) return
      settled = true
      resolve(val)
      cleanup()
    }

    if (opts.timeout && opts.timeout > 0) {
      timeoutId = window.setTimeout(() => handleResult(false), opts.timeout)
    }

    root.render(
      <ConfirmModal
        isOpen={true}
        title={opts.title}
        message={opts.message}
        confirmLabel={opts.confirmLabel}
        cancelLabel={opts.cancelLabel}
        maxWidth={opts.maxWidth}
        onCancel={() => handleResult(false)}
        onConfirm={() => handleResult(true)}
      />,
    )
  })
}

export default confirmAsync
