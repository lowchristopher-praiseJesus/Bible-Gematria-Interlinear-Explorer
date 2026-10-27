import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'

export interface TabernacleOverlayProps {
  open: boolean
  onClose: () => void
  /** Callback ref for the element the (single) viewer iframe is moved into. */
  slotRef: (el: HTMLDivElement | null) => void
}

/** Full-screen shell for the 3D viewer. It holds no iframe of its own: the
 * artifact moves its one viewer host into `slotRef` while open. */
export function TabernacleOverlay({ open, onClose, slotRef }: TabernacleOverlayProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex flex-col bg-[var(--color-surface)] focus:outline-none"
        >
          <div className="flex items-center justify-between border-b border-[var(--color-theme-border)] px-3 py-2">
            <Dialog.Title className="text-sm font-semibold">The Tabernacle</Dialog.Title>
            <Dialog.Close
              aria-label="Close full screen"
              className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div ref={slotRef} className="relative min-h-0 flex-1" />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
