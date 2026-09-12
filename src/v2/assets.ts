/** Bounded, backend-lifetime cache for revision-addressed official client resources. */
export class ClientAssets {
  private readonly entries = new Map<string, { bytes: ArrayBuffer; headers: [string, string][] }>();
  private size = 0;
  /** @param limit - Maximum retained bytes across completed immutable resources. */
  constructor(private readonly limit: number) {}
  /** @param path - Official resource path. @param fetcher - Authenticated fetch owned by the requesting view. @returns Independent response body; errors and mutable routes are never cached. */
  async fetch(path: string, fetcher: (path: string) => Promise<Response>): Promise<Response> {
    const cacheable = /^\/assets\/[^?]+-[\w-]+\.[\w]+$/.test(path) || (path.startsWith('/plugins/??') && /[?&]rev=[\w-]+(?:&|$)/.test(path));
    if (!cacheable) return fetcher(path);
    const found = this.entries.get(path);
    if (found) return new Response(found.bytes.slice(0), { headers: found.headers });
    const response = await fetcher(path);
    if (response.status !== 200) return response;
    const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (reader) {
        const item = await reader.read(); if (item.done) break;
        length += item.value.byteLength;
        if (length > this.limit) { await reader.cancel(); throw new Error('Client resource exceeds the VS Code transfer limit'); }
        chunks.push(item.value);
      }
    } finally { reader?.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const headers = [...response.headers].filter(([name]) => !['set-cookie', 'content-encoding', 'content-length'].includes(name));
    if (bytes.byteLength <= this.limit) {
      const previous = this.entries.get(path); if (previous) { this.size -= previous.bytes.byteLength; this.entries.delete(path); }
      while (this.size + bytes.byteLength > this.limit) {
        const first = this.entries.keys().next().value!; this.size -= this.entries.get(first)!.bytes.byteLength; this.entries.delete(first);
      }
      this.entries.set(path, { bytes: bytes.buffer, headers }); this.size += bytes.byteLength;
    }
    return new Response(bytes.slice(0), { headers });
  }
}
