import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import ExplorerPage from './pages/ExplorerPage'
import StrongsPage from './pages/StrongsPage'
import GematriaPage from './pages/GematriaPage'
import EnglishPage from './pages/EnglishPage'
import { ChatProvider } from './context/ChatContext'
import { ChatSidebar } from './components/chatbot/ChatSidebar'

export default function App() {
  return (
    <ChatProvider>
      <BrowserRouter>
        <div className="flex h-screen overflow-hidden">
          <div className="flex-1 min-w-0 overflow-y-auto">
            <Routes>
              <Route path="/explorer" element={<ExplorerPage />} />
              <Route path="/strongs" element={<StrongsPage />} />
              <Route path="/gematria" element={<GematriaPage />} />
              <Route path="/english" element={<EnglishPage />} />
              <Route path="*" element={<Navigate to="/explorer" replace />} />
            </Routes>
          </div>
          <ChatSidebar />
        </div>
      </BrowserRouter>
    </ChatProvider>
  )
}
