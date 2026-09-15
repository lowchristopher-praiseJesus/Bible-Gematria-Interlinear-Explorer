import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TextStyle, FontSize } from '@tiptap/extension-text-style'
import Image from '@tiptap/extension-image'
import { Bold, Italic, Underline as UnderlineIcon, ImagePlus, NotebookPen } from 'lucide-react'
import { MAX_NOTES_PER_SESSION, useSessionsStore } from '@/store/useSessionsStore'
import { useArtifactStore } from '@/store/useArtifactStore'
import { formatSessionTimestamp } from '@/lib/formatTimestamp'

interface Props {
  sessionId: string
  /** Empty string means "a new, unsaved note". */
  noteId: string
  /**
   * The consumer MUST mount this with `key={`${sessionId}:${noteId}`}` so
   * that local state (mode, draft) resets on the draft→saved transition,
   * when `noteId` changes from `''` to the created note's id.
   */
}

const PILL_PRIMARY =
  'text-sm px-3 py-1.5 rounded-full bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)] transition-opacity hover:opacity-90 disabled:opacity-40'
const PILL_SECONDARY =
  'text-sm px-3 py-1.5 rounded-full border border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)] transition-colors'

const FONT_SIZES = [
  { label: 'Small', value: '13px' },
  { label: 'Normal', value: '15px' },
  { label: 'Large', value: '19px' },
  { label: 'X-Large', value: '24px' },
]

/** Max dimension (px) a pasted-in image is downscaled to before it's
 * embedded as a base64 data URI, so a single photo can't dominate the
 * note's serialized size (see MAX_NOTE_SIZE_CHARS in useSessionsStore). */
const MAX_IMAGE_DIMENSION = 800
const IMAGE_JPEG_QUALITY = 0.82

/** PNG only compresses losslessly, so a photo saved as PNG (common from
 * screenshots) can stay several times larger than the same pixels as JPEG
 * even after downscaling. Only keep PNG output when the image actually
 * uses transparency — everything else goes out as JPEG. */
function hasTransparency(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const { data } = ctx.getImageData(0, 0, width, height)
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true
  }
  return false
}

function resizeImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const img = new window.Image()
      img.onerror = () => reject(new Error('Could not read image'))
      img.onload = () => {
        const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(img.width, img.height))
        const width = Math.round(img.width * scale)
        const height = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Canvas unsupported'))
          return
        }
        ctx.drawImage(img, 0, 0, width, height)
        const isPng = file.type === 'image/png' && hasTransparency(ctx, width, height)
        resolve(canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', IMAGE_JPEG_QUALITY))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

function ToolbarButton({
  active,
  onClick,
  label,
  children,
}: {
  active?: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={!!active}
      title={label}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
        active
          ? 'bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      {children}
    </button>
  )
}

function Toolbar({ editor }: { editor: Editor }) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [imageError, setImageError] = useState<string | null>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImageError(null)
    try {
      const dataUrl = await resizeImageFile(file)
      editor.chain().focus().setImage({ src: dataUrl }).run()
    } catch {
      setImageError('Could not insert that image.')
    }
  }

  const currentFontSize =
    editor.getAttributes('textStyle').fontSize ?? FONT_SIZES[1].value

  return (
    <div className="flex flex-col gap-1 shrink-0">
      <div className="flex items-center gap-1 rounded-lg border border-[var(--color-theme-border)] bg-[var(--color-surface-alt)] p-1">
        <ToolbarButton
          label="Bold"
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold className="h-4 w-4" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic className="h-4 w-4" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          label="Underline"
          active={editor.isActive('underline')}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <UnderlineIcon className="h-4 w-4" aria-hidden="true" />
        </ToolbarButton>
        <select
          aria-label="Font size"
          value={currentFontSize}
          onChange={(e) => editor.chain().focus().setFontSize(e.target.value).run()}
          className="h-7 rounded-md border border-[var(--color-theme-border)] bg-[var(--color-surface)] px-1 text-xs"
        >
          {FONT_SIZES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <ToolbarButton label="Insert image" onClick={() => fileInputRef.current?.click()}>
          <ImagePlus className="h-4 w-4" aria-hidden="true" />
        </ToolbarButton>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>
      {imageError && <div className="text-xs text-red-600">{imageError}</div>}
    </div>
  )
}

export function NoteEditor({ sessionId, noteId }: Props) {
  const isDraft = noteId === ''
  const note = useSessionsStore((s) => {
    const session = s.sessions[sessionId]
    return session ? session.notes.find((n) => n.id === noteId) : undefined
  })
  const addNote = useSessionsStore((s) => s.addNote)
  const updateNote = useSessionsStore((s) => s.updateNote)
  const deleteNote = useSessionsStore((s) => s.deleteNote)
  const openNote = useArtifactStore((s) => s.openNote)
  const close = useArtifactStore((s) => s.close)

  const [mode, setMode] = useState<'view' | 'edit'>(isDraft ? 'edit' : 'view')
  const [title, setTitle] = useState(note?.title ?? '')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [saveError, setSaveError] = useState<'count' | 'size' | null>(null)
  const [openedAt] = useState(() => Date.now())
  const notesCount = useSessionsStore((s) => s.sessions[sessionId]?.notes.length ?? 0)

  const editor = useEditor({
    extensions: [StarterKit, TextStyle, FontSize, Image.configure({ allowBase64: true })],
    content: note?.body ?? '',
    editable: mode === 'edit',
    immediatelyRender: false,
    editorProps: {
      attributes: { 'aria-label': 'Note text' },
    },
  })

  useEffect(() => {
    editor?.setEditable(mode === 'edit')
  }, [editor, mode])

  if (!isDraft && !note) {
    return (
      <div className="text-sm text-[var(--color-text-secondary)] italic">
        This note is no longer available.
      </div>
    )
  }

  const createdAt = note?.createdAt ?? openedAt
  const edited = !!note && note.updatedAt > note.createdAt
  const isEmpty = !!editor && editor.isEmpty && !title.trim()

  function handleSaveDraft() {
    if (!editor) return
    // `addNote` returns null for two unrelated reasons (the 5-note cap and
    // the size cap) — check the cap we can see here first so a size
    // failure isn't misreported as "5 notes" when there's only one.
    if (notesCount >= MAX_NOTES_PER_SESSION) {
      setSaveError('count')
      return
    }
    const created = addNote(sessionId, editor.getHTML(), title.trim() || undefined)
    if (!created) {
      setSaveError('size')
      return
    }
    openNote(sessionId, created.id)
    // Harmless under the ArtifactPane remount (the component is replaced
    // via its `key`); correct if ever mounted without one.
    setMode('view')
  }

  function handleSaveEdit() {
    if (!editor) return
    const ok = updateNote(sessionId, noteId, editor.getHTML(), title.trim() || undefined)
    setSaveError(ok ? null : 'size')
    if (ok) setMode('view')
  }

  function handleDelete() {
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    deleteNote(sessionId, noteId)
    close()
  }

  function handleCancel() {
    if (isDraft) {
      close()
      return
    }
    setTitle(note!.title ?? '')
    editor?.commands.setContent(note!.body)
    setMode('view')
  }

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] shrink-0">
        <NotebookPen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{formatSessionTimestamp(createdAt)}</span>
        {edited && <span className="opacity-70">· edited {formatSessionTimestamp(note!.updatedAt)}</span>}
      </div>

      {mode === 'edit' ? (
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (optional)"
          aria-label="Note title"
          className="w-full shrink-0 rounded-lg border border-[var(--color-theme-border)] bg-[var(--color-surface-alt)] px-3 py-1.5 text-sm font-medium outline-none focus:border-[var(--color-theme-accent)] transition-colors"
        />
      ) : (
        title.trim() && <div className="shrink-0 text-sm font-semibold text-[var(--color-text-primary)]">{title}</div>
      )}

      {mode === 'edit' && editor && <Toolbar editor={editor} />}

      <div
        className={`flex-1 min-h-[12rem] overflow-y-auto rounded-lg text-sm [&_.ProseMirror]:h-full [&_.ProseMirror]:outline-none [&_.ProseMirror_p]:my-1 [&_.ProseMirror_img]:max-w-full [&_.ProseMirror_img]:rounded-md ${
          mode === 'edit'
            ? 'border border-[var(--color-theme-border)] bg-[var(--color-surface-alt)] p-3 focus-within:border-[var(--color-theme-accent)] transition-colors'
            : ''
        }`}
      >
        {isEmpty && mode === 'view' ? (
          <span className="italic text-[var(--color-text-secondary)]">Empty note.</span>
        ) : (
          <EditorContent editor={editor} />
        )}
      </div>

      {saveError && (
        <div className="text-xs text-red-600 shrink-0">
          {saveError === 'count'
            ? `This conversation already has ${MAX_NOTES_PER_SESSION} notes.`
            : 'This note is too large to save — try removing or shrinking an image.'}
        </div>
      )}

      <div className="flex items-center gap-2 shrink-0">
        {mode === 'edit' ? (
          <>
            <button className={PILL_PRIMARY} onClick={isDraft ? handleSaveDraft : handleSaveEdit}>
              Save
            </button>
            <button className={PILL_SECONDARY} onClick={handleCancel}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              className={PILL_SECONDARY}
              onClick={() => {
                setMode('edit')
              }}
            >
              Edit
            </button>
            <button
              className="text-sm px-3 py-1.5 rounded-full text-red-600 hover:bg-[var(--color-surface-alt)] transition-colors"
              onClick={handleDelete}
            >
              {confirmingDelete ? 'Click again to confirm' : 'Delete'}
            </button>
            {confirmingDelete && (
              <button
                className="text-sm px-3 py-1.5 rounded-full text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)] transition-colors"
                onClick={() => setConfirmingDelete(false)}
              >
                Cancel
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
