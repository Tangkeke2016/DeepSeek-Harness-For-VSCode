/** Monaco diff pages with explicit responsive layout and synchronized wrapping. */
import * as vscode from 'vscode';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { diffFragments, diffCollection, DiffUnavailable, type DiffFile } from './change-diff.ts';
import { record } from './protocol.ts';
import { copy } from './locale.ts';
import { diffLanguage } from './diff-language.ts';
/** Owns read-only diff pages for the extension lifetime. */
export class DiffEditor implements vscode.Disposable {
  private readonly panels = new Map<string, vscode.WebviewPanel>();
  /** @param value - Recorded JSON. @param turn - Turn number. @param extensionPath - Bundled assets. @returns Completion after opening or a refusal. */
  async open(value: unknown, turn: number, extensionPath: string): Promise<void> {
    const text = copy(vscode.env.language);
    let fragments;
    let files: DiffFile[] | undefined;
    try {
      if (record(value).kind === 'collection') {
        files = diffCollection(value);
        fragments = { path: '', display: text.diffReview, before: '', after: '', beforeLines: [], afterLines: [] };
      } else fragments = diffFragments(value);
    }
    catch (error) {
      if (!(error instanceof DiffUnavailable)) throw error;
      await vscode.window.showInformationMessage(text.diffUnavailable); return;
    }
    const hash = createHash('sha256').update(JSON.stringify({ fragments, files, turn })).digest('hex');
    const existing = this.panels.get(hash);
    if (existing) { existing.reveal(); void existing.webview.postMessage({ kind: 'layout' }); return; }
    const dist = vscode.Uri.file(join(extensionPath, 'dist'));
    const panel = vscode.window.createWebviewPanel('deepseekHarness.diff', `${files ? text.diffReview : fragments.display} · ${text.diffTurn} ${turn}`,
      vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [dist] });
    this.panels.set(hash, panel);
    const settings = vscode.workspace.getConfiguration('diffEditor');
    const breakpoint = settings.get<number>('renderSideBySideInlineBreakpoint', 900);
    const uri = (name: string) => panel.webview.asWebviewUri(vscode.Uri.file(join(extensionPath, 'dist', name))).toString();
    const config = JSON.stringify({ before: fragments.before, after: fragments.after, language: diffLanguage(fragments.path),
      beforeLines: fragments.beforeLines, afterLines: fragments.afterLines,
      files, path: fragments.display, filesTitle: text.diffFiles.replace('{count}', String(files?.length ?? 1)), unavailable: text.diffUnavailable,
      locale: vscode.env.language, copyLine: text.diffCopyLine,
      copyDeletedBlock: text.diffCopyDeletedBlock, copyChangedBlock: text.diffCopyChangedBlock,
      breakpoint: Number.isFinite(breakpoint) && breakpoint >= 0 ? breakpoint : 900,
      wrap: false,
      wrapOn: text.diffWrapOn, wrapOff: text.diffWrapOff, worker: uri('diff-worker.js'), failed: text.diffFailed }).replaceAll('<', '\\u003c');
    const nonce = randomBytes(24).toString('hex');
    panel.webview.html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' ${panel.webview.cspSource}; style-src ${panel.webview.cspSource} 'unsafe-inline'; font-src ${panel.webview.cspSource} data:; connect-src ${panel.webview.cspSource}; worker-src blob:;"><link rel="stylesheet" href="${uri('diff-view.css')}"></head><body><header><button id="wrap" type="button" aria-pressed="false">${text.diffWrapOff}</button></header><div id="error" role="alert" hidden></div><main id="diff"></main><script nonce="${nonce}">window.__DSH_DIFF__=${config};</script><script nonce="${nonce}" src="${uri('diff-locale.js')}"></script><script nonce="${nonce}" type="module" src="${uri('diff-view.js')}"></script></body></html>`;
    panel.onDidChangeViewState(event => { if (event.webviewPanel.visible) void panel.webview.postMessage({ kind: 'layout' }); });
    panel.onDidDispose(() => { this.panels.delete(hash); });
  }
  /** Dispose comparison pages when the extension deactivates. */
  dispose(): void { for (const panel of this.panels.values()) panel.dispose(); this.panels.clear(); }
}
