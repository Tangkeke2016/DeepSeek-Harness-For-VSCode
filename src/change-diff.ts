/** Validate recorded hunks and produce excerpt documents, without reading working files. */
import { record, string } from './protocol.ts';
/** A recorded file has no text excerpts to compare. */
export class DiffUnavailable extends Error {
  constructor(readonly reason: 'binary' | 'oversized' | 'empty' | 'coarse') { super(reason); }
}
/** Recorded before/after snippets and their file label. */
export interface DiffFragments {
  path: string; display: string; before: string; after: string;
  beforeLines: (number | null)[]; afterLines: (number | null)[];
}
/** One file in a turn's collapsible review; unsupported comparisons retain their summary. */
export interface DiffFile extends DiffFragments { added: number; deleted: number; unavailable?: boolean }
/** @param value - Summary and recorded comparisons from the bridge. @returns Ordered, validated review files. */
export function diffCollection(value: unknown): DiffFile[] {
  const data = record(value);
  if (data.kind !== 'collection' || !Array.isArray(data.files)) throw new Error('Invalid change collection');
  return data.files.map(value => {
    const file = record(value), path = string(file.path), display = string(file.display);
    if (!path || !display || ![file.added, file.deleted].every(value => Number.isSafeInteger(value) && Number(value) >= 0)) {
      throw new Error('Invalid change summary');
    }
    const summary = { path, display, added: Number(file.added), deleted: Number(file.deleted) };
    const unavailable = { ...summary, before: '', after: '', beforeLines: [], afterLines: [], unavailable: true };
    if (file.unavailable === true) return unavailable;
    try {
      const fragments = diffFragments(file.diff);
      if (fragments.path !== path) throw new Error('Change path mismatch');
      return { ...fragments, ...summary };
    } catch (error) {
      if (error instanceof DiffUnavailable) return unavailable;
      throw error;
    }
  });
}
/** @param value - Backend JSON. @returns Excerpts with original file positions; separators have no line number. */
export function diffFragments(value: unknown): DiffFragments {
  const data = record(value);
  const path = string(data.path), display = string(data.display);
  if (!path || !display) throw new Error('Invalid diff path');
  if (data.kind === 'binary' || data.kind === 'oversized') throw new DiffUnavailable(data.kind);
  if (data.kind !== 'text' || !Array.isArray(data.hunks)) throw new Error('Invalid diff response');
  if (data.coarse === true) throw new DiffUnavailable('coarse');
  if (!data.hunks.length) throw new DiffUnavailable('empty');
  const before: string[] = [], after: string[] = [];
  const beforeLines: (number | null)[] = [], afterLines: (number | null)[] = [];
  let first = true;
  for (const item of data.hunks) {
    const hunk = record(item);
    for (const key of ['oldStart', 'oldLines', 'newStart', 'newLines']) {
      if (!Number.isSafeInteger(hunk[key]) || Number(hunk[key]) < 0) throw new Error('Invalid diff range');
    }
    if (!Array.isArray(hunk.lines)) throw new Error('Invalid diff lines');
    if (!first) { before.push(''); after.push(''); beforeLines.push(null); afterLines.push(null); }
    first = false;
    let oldCount = 0, newCount = 0;
    for (const value of hunk.lines) {
      const raw = string(value);
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      if (!/^[+ -]/.test(line) || /[\r\n]/.test(line)) throw new Error('Invalid diff line');
      if (line[0] !== '+') { before.push(line.slice(1)); beforeLines.push(Number(hunk.oldStart) + oldCount++); }
      if (line[0] !== '-') { after.push(line.slice(1)); afterLines.push(Number(hunk.newStart) + newCount++); }
    }
    if (oldCount !== hunk.oldLines || newCount !== hunk.newLines) throw new Error('Diff line counts disagree');
  }
  return { path, display, before: before.join('\n'), after: after.join('\n'), beforeLines, afterLines };
}
