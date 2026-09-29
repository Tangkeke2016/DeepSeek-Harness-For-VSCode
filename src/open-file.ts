/** Open chat file references in native editors, reusing an existing editor group. */
import * as vscode from 'vscode';
import { extname, isAbsolute, resolve } from 'node:path';
import { FILE_OPENING_EXCLUSIONS, isWebPage } from './file-opening-rules.ts';
import { copy } from './locale.ts';

/** @param message - File navigation received from the Webview. @param workspace - This view's workspace fallback. */
export async function openChatFile(message: Record<string, unknown>, workspace: string): Promise<void> {
  if (typeof message.path !== 'string' || !message.path || message.path.includes('\0')) throw new Error('Invalid file path');
  if (isWebPage(message.path)) {
    if (!await vscode.env.openExternal(vscode.Uri.parse(message.path))) throw new Error(copy(vscode.env.language).browserOpenFailed);
    return;
  }
  const cwd = typeof message.cwd === 'string' && isAbsolute(message.cwd) ? message.cwd : workspace;
  const uri = vscode.Uri.file(resolve(cwd, message.path));
  const info = await vscode.workspace.fs.stat(uri);
  if (info.type & vscode.FileType.Directory) {
    if (vscode.env.remoteName) throw new Error(copy(vscode.env.language).remoteFolder);
    await vscode.commands.executeCommand('revealFileInOS', uri);
    return;
  }
  if (FILE_OPENING_EXCLUSIONS[extname(uri.fsPath).toLowerCase()] === 'browser') {
    // A remote filesystem path is not a file on the machine running the browser.
    if (vscode.env.remoteName) throw new Error(copy(vscode.env.language).remoteWebFile);
    if (!await vscode.env.openExternal(uri)) throw new Error(copy(vscode.env.language).browserOpenFailed);
    return;
  }
  const sameFile = (candidate: vscode.Uri): boolean => process.platform === 'win32'
    ? candidate.fsPath.toLowerCase() === uri.fsPath.toLowerCase() : candidate.fsPath === uri.fsPath;
  const groups = vscode.window.tabGroups.all;
  const ordered = [vscode.window.tabGroups.activeTabGroup, ...groups.filter(group => !group.isActive)];
  const existing = ordered.find(group => group.tabs.some(tab => {
    const input = tab.input;
    return (input instanceof vscode.TabInputText || input instanceof vscode.TabInputNotebook
      || input instanceof vscode.TabInputCustom) && sameFile(input.uri);
  }));
  const line = typeof message.line === 'number' && Number.isSafeInteger(message.line) && message.line > 0 ? message.line - 1 : undefined;
  await vscode.commands.executeCommand('vscode.open', uri, {
    preview: false, viewColumn: existing?.viewColumn ?? vscode.ViewColumn.Active,
    ...(line === undefined ? {} : { selection: new vscode.Range(line, 0, line, 0) }),
  });
}
