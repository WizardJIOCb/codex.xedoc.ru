import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const port = Number(process.env.PORT ?? 8787);
const accessToken = process.env.CODEX_XEDOC_TOKEN ?? '';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/api/ws' });

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, service: 'codex-xedoc', transport: 'ws', auth: Boolean(accessToken) });
});

app.use(express.static(distDir));
app.get(/^(?!\/api).*/, (_request, response) => {
  response.sendFile(path.join(distDir, 'index.html'));
});

class CodexBridge {
  constructor(sendToBrowser) {
    this.sendToBrowser = sendToBrowser;
    this.nextId = 1;
    this.pending = new Map();
    this.threadByConversation = new Map();
    this.ready = false;
    this.proc = spawn('codex', ['app-server'], {
      cwd: rootDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.proc.once('exit', (code) => {
      this.send({ type: 'error', message: `codex app-server stopped with code ${code ?? 'unknown'}` });
    });

    this.proc.stderr.on('data', (chunk) => {
      const text = chunk.toString().trim();
      if (text) this.send({ type: 'event', method: 'stderr', message: text });
    });

    const rl = readline.createInterface({ input: this.proc.stdout });
    rl.on('line', (line) => this.onLine(line));
  }

  async init() {
    await this.request('initialize', {
      clientInfo: {
        name: 'codex_xedoc_web',
        title: 'Codex Xedoc Web',
        version: '0.1.0',
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    this.notify('initialized', {});
    this.ready = true;
    this.send({ type: 'ready' });
  }

  dispose() {
    this.proc.kill();
  }

  send(payload) {
    this.sendToBrowser(JSON.stringify(payload));
  }

  write(message) {
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params) {
    const id = this.nextId++;
    this.write({ id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
    });
  }

  notify(method, params) {
    this.write({ method, params });
  }

  onLine(line) {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.send({ type: 'event', method: 'raw', message: line });
      return;
    }

    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? 'Codex JSON-RPC error'));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    this.forwardNotification(message);
  }

  forwardNotification(message) {
    const method = message.method ?? 'notification';
    const params = message.params ?? {};
    const conversationId = this.findConversationForParams(params);

    if (method === 'item/agentMessage/delta') {
      this.send({
        type: 'delta',
        conversationId,
        method,
        delta: extractText(params),
        payload: params,
      });
      return;
    }

    if (method === 'turn/completed') {
      this.send({
        type: 'status',
        conversationId,
        method,
        message: 'completed',
        payload: params,
      });
      return;
    }

    this.send({
      type: 'event',
      conversationId,
      method,
      message: summarizeNotification(method, params),
      payload: params,
    });
  }

  findConversationForParams(params) {
    const threadId = params?.thread?.id ?? params?.threadId ?? params?.turn?.threadId;
    if (!threadId) return undefined;
    for (const [conversationId, storedThreadId] of this.threadByConversation.entries()) {
      if (storedThreadId === threadId) return conversationId;
    }
    return undefined;
  }

  async startTurn(payload) {
    if (!this.ready) throw new Error('Codex bridge is not initialized yet.');
    const conversationId = payload.conversationId;
    const options = payload.options ?? {};
    let threadId = payload.threadId ?? this.threadByConversation.get(conversationId);

    if (!threadId) {
      const thread = await this.request('thread/start', {
        model: options.model,
        cwd: options.cwd,
        sandbox: options.sandbox,
      });
      threadId = thread?.thread?.id;
      if (!threadId) throw new Error('Codex did not return a thread id.');
      this.threadByConversation.set(conversationId, threadId);
      this.send({ type: 'thread', conversationId, threadId });
    }

    await this.request('turn/start', {
      threadId,
      input: [{ type: 'text', text: payload.input }],
      cwd: options.cwd,
      model: options.model,
      effort: options.effort,
      sandbox: options.sandbox,
    });
    this.send({ type: 'status', conversationId, message: 'started' });
  }
}

function extractText(params) {
  return (
    params?.delta ??
    params?.text ??
    params?.message?.text ??
    params?.item?.text ??
    params?.item?.content?.text ??
    ''
  );
}

function summarizeNotification(method, params) {
  const text = extractText(params);
  if (text) return text;
  if (method.includes('tool') || method.includes('exec')) return method;
  if (method.includes('started')) return method;
  if (method.includes('completed')) return method;
  return '';
}

wss.on('connection', async (socket, request) => {
  if (accessToken) {
    const url = new URL(request.url ?? '', 'http://localhost');
    if (url.searchParams.get('token') !== accessToken) {
      socket.send(JSON.stringify({ type: 'error', message: 'Invalid access token.' }));
      socket.close(1008, 'Invalid access token');
      return;
    }
  }

  const bridge = new CodexBridge((message) => {
    if (socket.readyState === socket.OPEN) socket.send(message);
  });

  socket.on('message', async (raw) => {
    try {
      const payload = JSON.parse(raw.toString());
      if (payload.type === 'turn.start') await bridge.startTurn(payload);
    } catch (error) {
      socket.send(JSON.stringify({
        type: 'error',
        conversationId: safeConversationId(raw),
        message: error instanceof Error ? error.message : 'Unknown bridge error',
      }));
    }
  });

  socket.on('close', () => bridge.dispose());

  try {
    await bridge.init();
  } catch (error) {
    socket.send(JSON.stringify({
      type: 'error',
      message: error instanceof Error ? error.message : 'Failed to initialize Codex bridge',
    }));
  }
});

function safeConversationId(raw) {
  try {
    return JSON.parse(raw.toString()).conversationId;
  } catch {
    return undefined;
  }
}

server.listen(port, () => {
  console.log(`Codex Xedoc listening on http://localhost:${port}`);
});
