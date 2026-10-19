/** Bounded decoding of the official authenticated plugin event stream. */
import { createParser } from 'eventsource-parser';

/** @param request - Authenticated backend request. @param signal - Subscription lifetime. @param limit - Maximum event size. @param emit - Complete SSE data payload. @returns Completion when the stream ends or is cancelled. */
export async function readPluginEvents(request: (path: string, init: RequestInit) => Promise<Response>, signal: AbortSignal,
  limit: number, emit: (data: string) => void): Promise<void> {
  const response = await request('/plugins/events', { headers: { accept: 'text/event-stream' }, signal });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('text/event-stream') || !response.body) {
    await response.body?.cancel();
    throw new Error(`Plugin updates HTTP ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = createParser({ maxBufferSize: limit, onEvent: event => emit(event.data), onError: error => { throw error; } });
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      signal.throwIfAborted();
      parser.feed(decoder.decode(item.value, { stream: true }));
    }
    parser.feed(decoder.decode());
  } finally {
    try { await reader.cancel(); } finally { reader.releaseLock(); }
  }
}
