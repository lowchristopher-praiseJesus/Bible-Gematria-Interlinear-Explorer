# Chat Sidebar Design

**Date:** 2026-04-27  
**Status:** Approved

## Goal

Replace the floating `BibleChatWidget` popup in the React frontend with a persistent right-side panel that slides in and compresses the main content. Chat messages survive page navigation.

## Approach

Flex-row root layout at the `App` level. Chat state lives in a `ChatContext` above the router so navigation never unmounts it. The sidebar animates its width; the content area is `flex-1` so it compresses naturally.

## Architecture

### ChatContext (`src/context/ChatContext.tsx`)

New context + provider holding all chat state:

```ts
interface ChatContextValue {
  isOpen: boolean
  toggle: () => void
  messages: ChatMessage[]
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>
}
```

`ChatMessage` is imported from the existing `src/components/chatbot/types.ts`. The provider wraps the entire app so state is never reset by navigation.

### Root Layout (`src/App.tsx`)

Restructured into a flex row inside `ChatProvider`:

```tsx
<ChatProvider>
  <div className="flex h-screen overflow-hidden">
    <div className="flex-1 min-w-0 overflow-y-auto">
      <Routes>…</Routes>
    </div>
    <ChatSidebar />
  </div>
</ChatProvider>
```

The sidebar transitions between `w-0 overflow-hidden` (closed) and `w-[360px] shrink-0` (open) using `transition-[width] duration-300`. The `flex-1` content div compresses automatically — no overlay.

### ChatSidebar (`src/components/chatbot/ChatSidebar.tsx`)

New component. Reads `isOpen`, `messages`, `setMessages` from `ChatContext`. Contains:

- **Header:** "Bible Study Chat" title + `×` close button. Background `#1e3a5f` (matches existing brand colour).
- **Messages area:** Scrollable. Contains its own `VerseCard`, `StudyCard`, `StrongsCard` sub-components (duplicated from `BibleChatWidget.tsx` — they are small and `BibleChatWidget` must stay unchanged for the UMD build).
- **Input:** Textarea + send button. Enter submits, Shift+Enter inserts newline.
- **sendMessage:** Non-streaming fetch to `/api/bible-chat/chat`. Error handling shows inline error message.

Loading state (three-dot bounce) shown while awaiting response.

### AppLayout Header (`src/components/layout/AppLayout.tsx`)

A chat toggle button added to the right end of the header bar. Uses a speech-bubble SVG icon. Highlighted (indigo background) when sidebar is open. Reads `toggle` and `isOpen` from `ChatContext`.

### BibleChatWidget (`src/components/chatbot/BibleChatWidget.tsx`)

Unchanged. Still used for the Flask/UMD bundle. Not rendered in the React app after this change.

## Files Changed

| File | Change |
|---|---|
| `src/context/ChatContext.tsx` | New |
| `src/components/chatbot/ChatSidebar.tsx` | New |
| `src/App.tsx` | Restructure layout, wrap in ChatProvider, remove BibleChatWidget |
| `src/components/layout/AppLayout.tsx` | Add toggle button |
| `src/components/chatbot/BibleChatWidget.tsx` | Unchanged |

## Out of Scope

- Streaming responses (can be added later)
- Conversation history across page reloads (sessionStorage/localStorage)
- Dark mode for the sidebar
