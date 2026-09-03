import type { ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle } from 'lucide-react'
import { Button } from './Button'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  title: string
  description?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
  loading?: boolean
}

export function ConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
}: ConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]" />
        <Dialog.Content
          className="admin-scope fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-admin-border bg-admin-surface p-5 shadow-xl focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex gap-3">
            {destructive && (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--admin-danger-bg)] text-[var(--admin-danger)]">
                <AlertTriangle className="h-[18px] w-[18px]" aria-hidden="true" />
              </span>
            )}
            <div className="min-w-0">
              <Dialog.Title className="text-sm font-semibold text-admin-text">{title}</Dialog.Title>
              {description && (
                <Dialog.Description className="mt-1 text-xs leading-relaxed text-admin-muted">
                  {description}
                </Dialog.Description>
              )}
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="secondary" size="sm">
                {cancelLabel}
              </Button>
            </Dialog.Close>
            <Button
              variant={destructive ? 'danger' : 'primary'}
              size="sm"
              loading={loading}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
