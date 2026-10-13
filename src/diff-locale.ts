/** Load Monaco's locale before its editor modules initialize. */
import '../node_modules/monaco-editor/esm/vs/nls/lang/zh-cn.js';

declare global {
  var _VSCODE_NLS_MESSAGES: string[];
  var _VSCODE_NLS_LANGUAGE: string;
}

const language = window.__DSH_DIFF__.locale;
if (!language.startsWith('zh')) globalThis._VSCODE_NLS_MESSAGES = [];
globalThis._VSCODE_NLS_LANGUAGE = language.startsWith('zh') ? 'zh-cn' : 'en';
if (language.startsWith('zh')) {
  for (const index of [128, 129]) globalThis._VSCODE_NLS_MESSAGES[index] = window.__DSH_DIFF__.copyDeletedBlock;
  for (const index of [130, 131]) globalThis._VSCODE_NLS_MESSAGES[index] = window.__DSH_DIFF__.copyChangedBlock;
}
// Monaco 0.57.0: the single-line copy actions in the inline diff menu.
for (const index of [132, 133]) globalThis._VSCODE_NLS_MESSAGES[index] = window.__DSH_DIFF__.copyLine;
