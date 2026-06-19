import WebSocket from 'ws';

const url = process.argv[2] ?? 'ws://127.0.0.1:8787/api/ws';
const expected = process.argv[3] ?? 'ready';
const timeout = Number(process.argv[4] ?? 10000);

const ws = new WebSocket(url);
const timer = setTimeout(() => {
  console.error(`Timed out waiting for ${expected}`);
  ws.close();
  process.exit(2);
}, timeout);

ws.on('message', (message) => {
  const text = message.toString();
  console.log(text);
  if (text.includes(expected)) {
    clearTimeout(timer);
    ws.close();
    process.exit(0);
  }
});

ws.on('error', (error) => {
  clearTimeout(timer);
  console.error(error.message);
  process.exit(1);
});

ws.on('close', (code, reason) => {
  if (expected === 'close') {
    clearTimeout(timer);
    console.log(`close ${code} ${reason.toString()}`);
    process.exit(0);
  }
});
