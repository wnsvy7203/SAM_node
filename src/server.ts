import express, { Response } from 'express';
import cors from 'cors';
import { createParser, EventSourceParser } from 'eventsource-parser';
import { PORT, TARGET_URL } from './env.js';
import type { RelayEvent } from './types.js';

type SseClient = Response;

const app = express();
app.use(cors());

/** 연결된 다운스트림 클라이언트 목록 */
const clients = new Set<SseClient>();

/** 업스트림 연결 상태 */
let upstreamAbort: AbortController | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let isConnecting = false;
let lastEventId: string | null = null;

/** 재연결 백오프 2s ~ 30s */
let backoffMs = 2000;

function info(...args: unknown[]) {
  console.log('[SSE-RELAY]', ...args);
}

function warn(...args: unknown[]) {
  console.warn('[SSE-RELAY]', ...args);
}

function err(...args: unknown[]) {
  console.error('[SSE-RELAY]', ...args);
}

/** 모든 다운스트림 클라이언트로 브로드캐스트 */
function broadcast(event: RelayEvent) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    if (res.writableEnded) {
      clients.delete(res);
      continue;
    }
    res.write(payload);
  }
}

/** 업스트림(SSE 원본)에 연결 */
async function connectUpstream() {
  if (isConnecting) return;
  isConnecting = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  upstreamAbort = new AbortController();

  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    ...EXTRA_HEADERS,
  };
  if (lastEventId) headers['Last-Event-ID'] = lastEventId;

  info('Connecting upstream:', TARGET_SSE_URL, lastEventId ? `(Last-Event-ID: ${lastEventId})` : '');

  try {
    const res = await fetch(TARGET_SSE_URL, {
      headers,
      signal: upstreamAbort.signal,
    });

    if (!res.ok || !res.body) {
      throw new Error(`Upstream bad response: ${res.status} ${res.statusText}`);
    }

    const parser: EventSourceParser = createParser((evt) => {
      if (evt.type === 'event') {
        const eventName = evt.event || 'message';
        const id = (evt as unknown as { id?: string }).id ?? null;
        const data = evt.data ?? '';

        if (id) lastEventId = id;

        broadcast({ event: eventName, id, data });
      }
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    isConnecting = false;
    backoffMs = 2000; // 성공했으니 백오프 초기화

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) parser.feed(decoder.decode(value));
    }

    warn('Upstream ended naturally. Scheduling reconnect...');
    scheduleReconnect();
  } catch (e) {
    isConnecting = false;
    err('Upstream error:', (e as Error).message);
    scheduleReconnect();
  }
}

/** 재연결 스케줄 */
function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    connectUpstream();
    backoffMs = Math.min(Math.floor(backoffMs * 1.5), 30000);
  }, backoffMs);
}

/** 다운스트림 SSE 엔드포인트 */
app.get('/stream', (req, res) => {
  // SSE 기본 헤더
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  (res.flushHeaders as unknown as (() => void) | undefined)?.();

  // 핑(keep-alive)
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);

  clients.add(res);

  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });

  // 업스트림 연결 트리거
  if (!isConnecting && !upstreamAbort) connectUpstream();
});

/** 헬스 체크 */
app.get('/health', (_req, res) => {
  const body: HealthStatus = {
    upstreamConnected: Boolean(upstreamAbort),
    clients: clients.size,
    lastEventId,
  };
  res.json(body);
});

/** 종료 처리 */
function shutdown() {
  try {
    upstreamAbort?.abort();
  } catch {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

app.listen(PORT, () => {
  info(`Relay listening on http://localhost:${PORT}`);
  connectUpstream();
});