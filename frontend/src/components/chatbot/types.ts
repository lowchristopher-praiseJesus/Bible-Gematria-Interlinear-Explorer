import type { Trace } from '../../types/trace'

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  type?: string;
  text: string;
  data?: Record<string, any>;
  route?: string;
  trace?: Trace;
  isStreaming?: boolean;
  followUpQuestions?: string[];
}

export interface BibleChatWidgetProps {
  apiUrl: string;
  theme?: 'light' | 'dark';
  position?: 'bottom-right' | 'bottom-left' | 'inline';
  title?: string;
  welcomeMessage?: string;
}
