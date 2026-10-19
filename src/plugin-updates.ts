/** Reconcile official plugin updates while keeping the VS Code client entry installed. */

/** The official module controller owns dependency ordering and old instance disposal. */
export interface PluginEntries {
  sync(graph: unknown): Promise<void>;
  reload(id: string, rev: string): Promise<void>;
}

/** @param graph - Untrusted backend graph. @param entry - Local VS Code module descriptor. @param batch - Local VS Code application batch. @returns A graph retaining the local module; malformed graphs remain for official validation. */
export function retainClientEntry(graph: unknown, entry: { id: string }, batch: unknown): unknown {
  if (typeof graph !== 'object' || graph === null) return graph;
  const value = graph as Record<string, unknown>;
  if (!Array.isArray(value.entries) || !Array.isArray(value.batches)) return graph;
  const hmr = '@deepseek-ai/dsh-client-hmr';
  const rows: unknown[] = value.entries;
  const batches: unknown[] = value.batches;
  const keep = (row: unknown): boolean => {
    if (typeof row !== 'object' || row === null) return true;
    const id = (row as Record<string, unknown>).id;
    return id !== entry.id && id !== hmr;
  };
  return { ...value,
    entries: [...rows.filter(keep), entry],
    batches: [...batches.map(row => {
      if (typeof row !== 'object' || row === null) return row;
      const item = row as Record<string, unknown>;
      const ids: unknown = item.entries;
      return Array.isArray(ids) ? { ...item, entries: ids.filter((id: unknown) => id !== entry.id && id !== hmr) } : row;
    }), batch],
  };
}

/** @param input - One SSE data value. @param entries - Official module controller. @param entry - Local module descriptor. @param batch - Local application batch. @returns Completion after the official controller processes a known event. */
export async function applyPluginUpdate(input: unknown, entries: PluginEntries, entry: { id: string }, batch: unknown): Promise<void> {
  if (typeof input !== 'string') throw new Error('Invalid plugin update data');
  const frame: unknown = JSON.parse(input);
  if (typeof frame !== 'object' || frame === null) throw new Error('Invalid plugin update frame');
  const value = frame as Record<string, unknown>;
  if (value.type === 'graph') await entries.sync(retainClientEntry(value.graph, entry, batch));
  else if (value.type === 'rebuilt') {
    if (typeof value.id !== 'string' || typeof value.rev !== 'string') throw new Error('Invalid rebuilt plugin event');
    if (value.id !== entry.id && value.id !== '@deepseek-ai/dsh-client-hmr') await entries.reload(value.id, value.rev);
  }
}

/** @param open - Cancellable plugin subscription. @param apply - Serial event consumer. @param report - Reports update failure without stopping chat. @returns Stop the subscription and any pending retry. */
export function watchPluginUpdates(open: (signal: AbortSignal) => AsyncIterable<unknown>,
  apply: (frame: unknown) => Promise<void>, report: (error: unknown) => void): () => void {
  const lifetime = new AbortController();
  const run = async (): Promise<void> => {
    while (!lifetime.signal.aborted) {
      try {
        for await (const frame of open(lifetime.signal)) {
          if (lifetime.signal.aborted) break;
          try { await apply(frame); } catch (error) { report(error); }
        }
        if (!lifetime.signal.aborted) throw new Error('Plugin update stream ended; reconnecting');
      } catch (error) { if (!lifetime.signal.aborted) report(error); }
      if (lifetime.signal.aborted) break;
      await new Promise<void>(resolve => {
        const finish = (): void => { clearTimeout(timer); lifetime.signal.removeEventListener('abort', finish); resolve(); };
        const timer = setTimeout(finish, 1000);
        lifetime.signal.addEventListener('abort', finish, { once: true });
      });
    }
  };
  void run().catch(report);
  return () => { lifetime.abort(); };
}
