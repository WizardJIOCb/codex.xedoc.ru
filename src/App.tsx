import {
  ArrowUp,
  Bot,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  Code2,
  Copy,
  Folder,
  GitPullRequest,
  History,
  KeyRound,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  PanelLeft,
  Plus,
  RotateCcw,
  Search,
  SendHorizontal,
  Settings,
  ShieldAlert,
  Sparkles,
  Terminal,
  Trash2,
  User,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';

type Role = 'user' | 'assistant' | 'system' | 'event';
type Status = 'idle' | 'running' | 'done' | 'error';

type ChatMessage = {
  id: string;
  role: Role;
  text: string;
  createdAt: number;
  eventName?: string;
};

type Chat = {
  id: string;
  title: string;
  projectPath: string;
  threadId?: string;
  status: Status;
  model: string;
  effort: string;
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access';
  messages: ChatMessage[];
  updatedAt: number;
};

type ServerEvent = {
  type: string;
  conversationId?: string;
  threadId?: string;
  message?: string;
  method?: string;
  delta?: string;
  payload?: unknown;
};

const storageKey = 'xedoc.codex.chats.v1';
const defaultProjectPath = 'C:\\Projects\\codex.xedoc.ru';
const sandboxLabels = {
  'read-only': 'Read only',
  'workspace-write': 'Workspace',
  'danger-full-access': 'Full access',
};

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

const initialChat = (): Chat => ({
  id: id('chat'),
  title: 'Новый чат',
  projectPath: defaultProjectPath,
  status: 'idle',
  model: 'gpt-5.4',
  effort: 'high',
  sandbox: 'danger-full-access',
  messages: [
    {
      id: id('msg'),
      role: 'system',
      text: 'Готов к работе локально через Codex. Выберите проект, режим доступа и отправьте задачу.',
      createdAt: Date.now(),
    },
  ],
  updatedAt: Date.now(),
});

function loadChats() {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [initialChat()];
    const parsed = JSON.parse(raw) as Chat[];
    return parsed.length ? parsed : [initialChat()];
  } catch {
    return [initialChat()];
  }
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
}

function titleFrom(text: string) {
  const firstLine = text.trim().split('\n')[0] ?? 'Новый чат';
  return firstLine.length > 48 ? `${firstLine.slice(0, 48)}...` : firstLine || 'Новый чат';
}

function getWsUrl(accessToken: string) {
  const configured = import.meta.env.VITE_API_URL as string | undefined;
  const base = configured || `${window.location.protocol}//${window.location.hostname}:8787`;
  const token = accessToken ? `?token=${encodeURIComponent(accessToken)}` : '';
  return base.replace(/^http/, 'ws').replace(/\/$/, '') + `/api/ws${token}`;
}

function eventText(event: ServerEvent) {
  if (event.message) return event.message;
  if (event.method) return event.method;
  if (typeof event.payload === 'string') return event.payload;
  return '';
}

export function App() {
  const [chats, setChats] = useState<Chat[]>(loadChats);
  const [activeId, setActiveId] = useState(() => chats[0]?.id ?? '');
  const [prompt, setPrompt] = useState('');
  const [query, setQuery] = useState('');
  const [accessToken, setAccessToken] = useState(() => localStorage.getItem('xedoc.codex.token') ?? '');
  const [serverState, setServerState] = useState<'offline' | 'connecting' | 'online'>('connecting');
  const socketRef = useRef<WebSocket | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  const activeChat = chats.find((chat) => chat.id === activeId) ?? chats[0];
  const filteredChats = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return chats;
    return chats.filter((chat) => {
      const haystack = `${chat.title} ${chat.projectPath}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [chats, query]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(chats));
  }, [chats]);

  useEffect(() => {
    localStorage.setItem('xedoc.codex.token', accessToken);
  }, [accessToken]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [activeChat?.messages.length, activeChat?.messages.at(-1)?.text]);

  useEffect(() => {
    let closedByApp = false;
    const socket = new WebSocket(getWsUrl(accessToken));
    socketRef.current = socket;
    setServerState('connecting');

    socket.addEventListener('open', () => setServerState('online'));
    socket.addEventListener('close', () => {
      if (!closedByApp) setServerState('offline');
    });
    socket.addEventListener('error', () => setServerState('offline'));
    socket.addEventListener('message', (raw) => {
      const event = JSON.parse(raw.data) as ServerEvent;
      handleServerEvent(event);
    });

    return () => {
      closedByApp = true;
      socket.close();
    };
  }, [accessToken]);

  function patchChat(chatId: string, patcher: (chat: Chat) => Chat) {
    setChats((items) => items.map((chat) => (chat.id === chatId ? patcher(chat) : chat)));
  }

  function pushMessage(chatId: string, message: ChatMessage) {
    patchChat(chatId, (chat) => ({
      ...chat,
      messages: [...chat.messages, message],
      updatedAt: Date.now(),
    }));
  }

  function appendAssistantDelta(chatId: string, delta: string) {
    if (!delta) return;
    patchChat(chatId, (chat) => {
      const next = [...chat.messages];
      const last = next.at(-1);
      if (last?.role === 'assistant') {
        next[next.length - 1] = { ...last, text: last.text + delta };
      } else {
        next.push({
          id: id('msg'),
          role: 'assistant',
          text: delta,
          createdAt: Date.now(),
        });
      }
      return { ...chat, messages: next, updatedAt: Date.now() };
    });
  }

  function handleServerEvent(event: ServerEvent) {
    const chatId = event.conversationId;
    if (!chatId) {
      if (event.type === 'ready') setServerState('online');
      return;
    }

    if (event.type === 'thread') {
      patchChat(chatId, (chat) => ({ ...chat, threadId: event.threadId, updatedAt: Date.now() }));
      return;
    }

    if (event.type === 'delta') {
      appendAssistantDelta(chatId, event.delta ?? '');
      return;
    }

    if (event.type === 'status') {
      patchChat(chatId, (chat) => ({ ...chat, status: event.message === 'completed' ? 'done' : 'running' }));
      return;
    }

    if (event.type === 'error') {
      patchChat(chatId, (chat) => ({ ...chat, status: 'error' }));
      pushMessage(chatId, {
        id: id('msg'),
        role: 'system',
        text: event.message ?? 'Codex bridge вернул ошибку.',
        createdAt: Date.now(),
      });
      return;
    }

    const text = eventText(event);
    if (text && event.type === 'event') {
      pushMessage(chatId, {
        id: id('msg'),
        role: 'event',
        text,
        eventName: event.method,
        createdAt: Date.now(),
      });
    }
  }

  function createChat() {
    const chat = initialChat();
    setChats((items) => [chat, ...items]);
    setActiveId(chat.id);
    setPrompt('');
  }

  function removeChat(chatId: string) {
    setChats((items) => {
      const next = items.filter((chat) => chat.id !== chatId);
      if (chatId === activeId) setActiveId(next[0]?.id ?? '');
      return next.length ? next : [initialChat()];
    });
  }

  function updateActive<K extends keyof Chat>(key: K, value: Chat[K]) {
    if (!activeChat) return;
    patchChat(activeChat.id, (chat) => ({ ...chat, [key]: value, updatedAt: Date.now() }));
  }

  function sendPrompt(event?: FormEvent) {
    event?.preventDefault();
    const text = prompt.trim();
    if (!text || !activeChat || serverState !== 'online') return;

    const nextTitle = activeChat.messages.filter((message) => message.role === 'user').length
      ? activeChat.title
      : titleFrom(text);

    patchChat(activeChat.id, (chat) => ({
      ...chat,
      title: nextTitle,
      status: 'running',
      messages: [
        ...chat.messages,
        { id: id('msg'), role: 'user', text, createdAt: Date.now() },
        { id: id('msg'), role: 'assistant', text: '', createdAt: Date.now() },
      ],
      updatedAt: Date.now(),
    }));

    socketRef.current?.send(
      JSON.stringify({
        type: 'turn.start',
        conversationId: activeChat.id,
        threadId: activeChat.threadId,
        input: text,
        options: {
          cwd: activeChat.projectPath,
          model: activeChat.model,
          effort: activeChat.effort,
          sandbox: activeChat.sandbox,
        },
      }),
    );
    setPrompt('');
  }

  function quickPrompt(text: string) {
    setPrompt(text);
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendPrompt();
    }
  }

  const statusIcon = activeChat?.status === 'running' ? Loader2 : activeChat?.status === 'error' ? ShieldAlert : Circle;
  const StatusIcon = statusIcon;

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Code2 size={18} />
          </div>
          <div>
            <strong>Codex Xedoc</strong>
            <span>{serverState === 'online' ? 'Local bridge online' : serverState}</span>
          </div>
        </div>

        <button className="new-chat" type="button" onClick={createChat}>
          <Plus size={17} />
          Новый чат
        </button>

        <label className="search">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск чатов" />
        </label>

        <div className="chat-list">
          {filteredChats.map((chat) => (
            <button
              className={`chat-row ${chat.id === activeId ? 'active' : ''}`}
              key={chat.id}
              type="button"
              onClick={() => setActiveId(chat.id)}
            >
              <MessageSquare size={16} />
              <span>
                <strong>{chat.title}</strong>
                <small>{formatTime(chat.updatedAt)} · {sandboxLabels[chat.sandbox]}</small>
              </span>
            </button>
          ))}
        </div>

        <div className="sidebar-footer">
          <button type="button" title="История">
            <History size={17} />
          </button>
          <button type="button" title="Настройки">
            <Settings size={17} />
          </button>
          <button type="button" title="Скрыть панель">
            <PanelLeft size={17} />
          </button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="title-block">
            <button className="icon-button" type="button" title="Назад">
              <PanelLeft size={18} />
            </button>
            <div>
              <h1>{activeChat?.title ?? 'Codex'}</h1>
              <p>{activeChat?.projectPath}</p>
            </div>
          </div>

          <div className="top-actions">
            <label className="pill">
              <Bot size={15} />
              <input
                value={activeChat?.model ?? ''}
                onChange={(event) => updateActive('model', event.target.value)}
                aria-label="Model"
              />
            </label>
            <label className="pill select-pill">
              <Zap size={15} />
              <select
                value={activeChat?.effort ?? 'high'}
                onChange={(event) => updateActive('effort', event.target.value)}
                aria-label="Effort"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
              <ChevronDown size={14} />
            </label>
            <label className="pill token-pill">
              <KeyRound size={15} />
              <input
                value={accessToken}
                onChange={(event) => setAccessToken(event.target.value)}
                aria-label="Access token"
                placeholder="token"
                type="password"
              />
            </label>
            <button className="icon-button" type="button" title="Больше">
              <MoreHorizontal size={19} />
            </button>
          </div>
        </header>

        <div className="toolbar">
          <label>
            <Folder size={15} />
            <input
              value={activeChat?.projectPath ?? ''}
              onChange={(event) => updateActive('projectPath', event.target.value)}
              aria-label="Project path"
            />
          </label>
          <label>
            <ShieldAlert size={15} />
            <select
              value={activeChat?.sandbox ?? 'workspace-write'}
              onChange={(event) => updateActive('sandbox', event.target.value as Chat['sandbox'])}
              aria-label="Sandbox"
            >
              <option value="read-only">Read only</option>
              <option value="workspace-write">Workspace write</option>
              <option value="danger-full-access">Full access</option>
            </select>
          </label>
          <button type="button" onClick={() => quickPrompt('Проверь репозиторий и найди самые важные проблемы.')}>
            <CheckCircle2 size={15} />
            Review
          </button>
          <button type="button" onClick={() => quickPrompt('Сделай краткий план реализации и начни с первого шага.')}>
            <GitPullRequest size={15} />
            Plan
          </button>
          <button type="button" onClick={() => quickPrompt('Запусти нужные проверки и исправь найденные ошибки.')}>
            <Terminal size={15} />
            Fix
          </button>
        </div>

        <div className="transcript" ref={transcriptRef}>
          {activeChat?.messages.map((message) => (
            <article className={`message ${message.role}`} key={message.id}>
              <div className="avatar">
                {message.role === 'user' && <User size={16} />}
                {message.role === 'assistant' && <Sparkles size={16} />}
                {message.role === 'system' && <Settings size={16} />}
                {message.role === 'event' && <Terminal size={16} />}
              </div>
              <div className="bubble">
                <div className="message-meta">
                  <strong>
                    {message.role === 'user' && 'Вы'}
                    {message.role === 'assistant' && 'Codex'}
                    {message.role === 'system' && 'System'}
                    {message.role === 'event' && (message.eventName ?? 'Event')}
                  </strong>
                  <span>{formatTime(message.createdAt)}</span>
                </div>
                {message.text ? <p>{message.text}</p> : <p className="typing">Codex думает...</p>}
                {message.role === 'assistant' && message.text && (
                  <div className="message-actions">
                    <button type="button" title="Копировать">
                      <Copy size={14} />
                    </button>
                    <button type="button" title="Повторить">
                      <RotateCcw size={14} />
                    </button>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>

        <form className="composer" onSubmit={sendPrompt}>
          <div className="composer-status">
            <span className={`state-dot ${activeChat?.status ?? 'idle'}`}>
              <StatusIcon size={14} />
              {activeChat?.status === 'running' ? 'Работает' : activeChat?.status === 'error' ? 'Ошибка' : 'Готов'}
            </span>
            <span>
              <Clock3 size={14} />
              Work locally
            </span>
          </div>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={onComposerKeyDown}
            placeholder="Напишите задачу для Codex..."
            rows={3}
          />
          <div className="composer-bottom">
            <div className="composer-tools">
              <button type="button" title="Новый чат" onClick={createChat}>
                <Plus size={17} />
              </button>
              <button type="button" title="Удалить чат" onClick={() => activeChat && removeChat(activeChat.id)}>
                <Trash2 size={17} />
              </button>
              <span>{sandboxLabels[activeChat?.sandbox ?? 'workspace-write']}</span>
            </div>
            <button className="send" type="submit" disabled={!prompt.trim() || serverState !== 'online'}>
              <SendHorizontal size={17} />
              <ArrowUp size={15} />
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
