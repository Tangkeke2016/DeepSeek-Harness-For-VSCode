/** Redirect review clicks while preserving official hover previews. */
import type { ResourceNavigation } from './file-navigation.ts';
import { record, string } from './protocol.ts';
/** Recorded turn/file coordinates. */
export interface ChangeSelection { sessionId: string & { readonly __changeSession: unique symbol }; seq: number; turn: number; index?: number }
/** @param address - Official review address. @param index - File index. @returns Coordinates or undefined for other resources. */
export function changeSelection(address: string, index?: number): ChangeSelection | undefined {
  const match = /^dsh-resource:\/\/changes-review\/session\/([^/]+)\/(\d+)\/(\d+)$/.exec(address);
  if (!match) return undefined;
  const seq = Number(match[2]), turn = Number(match[3]);
  if (![seq, turn].every(Number.isSafeInteger) || seq < 0 || turn < 1
    || index !== undefined && (!Number.isSafeInteger(index) || index < 0)) throw new Error('Invalid review address');
  return { sessionId: decodeURIComponent(match[1]!) as ChangeSelection['sessionId'], seq, turn, index };
}
/** @param navigation - Official controller. @param post - Sends recorded JSON to the host. @param failed - Reports failure. @param collectionClick - Identifies the summary header, which also passes index zero. @returns Cancel reads and restore navigation. */
export function routeChanges(navigation: ResourceNavigation, post: (selection: ChangeSelection, diff: unknown) => void,
  failed: (error: unknown) => void, collectionClick: () => boolean = () => false): () => void {
  const original = navigation.openResource;
  const lifetime = new AbortController();
  const replacement: ResourceNavigation['openResource'] = function (this: ResourceNavigation, address, options) {
    let selection: ChangeSelection | undefined;
    try { selection = changeSelection(address, collectionClick() ? undefined : options?.params?.index); }
    catch (error) { failed(error); return; }
    if (!selection) { original.call(this, address, options); return; }
    const selected = selection;
    const query = new URLSearchParams({ sessionId: selected.sessionId, seq: String(selected.seq) });
    void (async () => {
      const response = await fetch(`/api/changes.${selected.index === undefined ? 'summary' : 'diff'}?${query}${selected.index === undefined ? '' : '&index=' + selected.index}`, { signal: lifetime.signal });
      if (!response.ok) throw new Error(`Change diff HTTP ${response.status}`);
      let diff: unknown = await response.json();
      if (selected.index === undefined) {
        const summary = record(diff);
        if (!Array.isArray(summary.files)) throw new Error('Invalid change summary');
        const files = summary.files.map(value => {
          const file = record(value);
          if (!string(file.path) || !string(file.display)
            || ![file.added, file.deleted].every(value => Number.isSafeInteger(value) && Number(value) >= 0)) throw new Error('Invalid change file');
          return { path: string(file.path), display: string(file.display), added: Number(file.added), deleted: Number(file.deleted) };
        });
        const results: object[] = new Array(files.length);
        let cursor = 0;
        await Promise.all(Array.from({ length: Math.min(3, files.length) }, async () => {
          while (cursor < files.length && !lifetime.signal.aborted) {
            const index = cursor++, file = files[index]!;
            try {
              const response = await fetch(`/api/changes.diff?${query}&index=${index}`, { signal: lifetime.signal });
              if (!response.ok) throw new Error(`Change diff HTTP ${response.status}`);
              results[index] = { ...file, diff: await response.json() };
            } catch (error) {
              if (lifetime.signal.aborted) throw error;
              results[index] = { ...file, unavailable: true };
            }
          }
        }));
        diff = { kind: 'collection', files: results };
      }
      if (!lifetime.signal.aborted) post(selected, diff);
    })().catch(error => { if (!lifetime.signal.aborted) failed(error); });
  };
  navigation.openResource = replacement;
  return () => { lifetime.abort(); if (navigation.openResource === replacement) navigation.openResource = original; };
}
