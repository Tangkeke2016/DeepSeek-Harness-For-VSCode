/** Responsive recorded diffs, with lazy file sections for a turn's review. */
import * as monaco from 'monaco-editor/editor/editor.api.js';
import '../node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css';
import './diff-view.css';
import 'monaco-editor/languages/definitions/javascript/register.js';
import 'monaco-editor/languages/definitions/typescript/register.js';
import 'monaco-editor/languages/definitions/python/register.js';
import 'monaco-editor/languages/definitions/markdown/register.js';
import type { DiffFile } from './change-diff.ts';
import { autoHideScrollbars } from './scrollbars.ts';
import { diffLanguage } from './diff-language.ts';

declare const acquireVsCodeApi: () => { getState(): { wrap?: boolean } | undefined; setState(value: { wrap: boolean }): void };
interface DiffText { before: string; after: string; beforeLines: (number | null)[]; afterLines: (number | null)[] }
declare global {
  interface Window {
    __DSH_DIFF__: DiffText & {
      files?: DiffFile[]; path: string; filesTitle: string; unavailable: string;
      language: string; locale: string; copyLine: string; copyDeletedBlock: string; copyChangedBlock: string;
      breakpoint: number; wrap: boolean; wrapOn: string; wrapOff: string; worker: string; failed: string;
    };
    MonacoEnvironment?: monaco.Environment;
  }
}
interface DiffView {
  host: HTMLElement; editor: monaco.editor.IStandaloneDiffEditor;
  original: monaco.editor.ITextModel; modified: monaco.editor.ITextModel;
  originalDigits: number; modifiedDigits: number;
}
const config = window.__DSH_DIFF__, api = acquireVsCodeApi();
let wrap = api.getState()?.wrap ?? config.wrap, frame = 0;
const button = document.getElementById('wrap') as HTMLButtonElement, host = document.getElementById('diff')!;
const views: DiffView[] = [];
const input = new AbortController();
const stopScrollbars = autoHideScrollbars();
const resize = new ResizeObserver(schedule);
resize.observe(host);
let workerUrl: Promise<string> | undefined;
window.MonacoEnvironment = {
  getWorker: async () => {
    workerUrl ??= fetch(config.worker).then(async response => {
      if (!response.ok) throw new Error(`Diff worker HTTP ${response.status}`);
      return URL.createObjectURL(new Blob([await response.text()], { type: 'text/javascript' }));
    });
    return new Worker(await workerUrl);
  },
};
function mount(target: HTMLElement, text: DiffText, language: string): void {
  const digits = (lines: (number | null)[]) => lines.reduce<number>((count, line) => Math.max(count, String(line ?? '').length), 1);
  const originalDigits = digits(text.beforeLines), modifiedDigits = digits(text.afterLines);
  const original = monaco.editor.createModel(text.before, language);
  const modified = monaco.editor.createModel(text.after, language);
  const editor = monaco.editor.createDiffEditor(target, {
    readOnly: true, originalEditable: false, automaticLayout: false,
    useInlineViewWhenSpaceIsLimited: false, minimap: { enabled: false },
    scrollBeyondLastLine: false, renderOverviewRuler: false, renderIndicators: false,
    glyphMargin: false, splitViewDefaultRatio: .5, enableSplitViewResizing: false,
    scrollbar: { vertical: 'hidden', horizontalScrollbarSize: 10, verticalScrollbarSize: 16, verticalSliderSize: 6 },
  });
  editor.setModel({ original, modified });
  target.addEventListener('wheel', event => {
    if (event.ctrlKey || event.shiftKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    const distance = event.deltaY * (event.deltaMode === 1 ? editor.getModifiedEditor().getOption(monaco.editor.EditorOption.lineHeight)
      : event.deltaMode === 2 ? host.clientHeight : 1);
    event.preventDefault(); event.stopImmediatePropagation();
    if (config.files) host.scrollTop += distance;
    else editor.getModifiedEditor().setScrollTop(editor.getModifiedEditor().getScrollTop() + distance);
  }, { capture: true, passive: false, signal: input.signal });
  for (const side of [editor.getOriginalEditor(), editor.getModifiedEditor()]) {
    const scroll = side.getDomNode()?.querySelector<HTMLElement>('.monaco-scrollable-element');
    if (!scroll) continue;
    scroll.setAttribute('data-conversation-scroll', '');
    scroll.setAttribute('data-vscode-scrollbar-horizontal', '');
    const overflow = () => scroll.toggleAttribute('data-vscode-scrollbar-overflow', side.getScrollWidth() > side.getLayoutInfo().contentWidth);
    side.onDidScrollChange(overflow); side.onDidLayoutChange(overflow); overflow();
  }
  if (!config.files) {
    const scroll = document.createElement('div'); scroll.className = 'page-scroll';
    const extent = document.createElement('div'); scroll.append(extent); host.append(scroll);
    const thumb = document.createElement('div'); thumb.className = 'page-scroll-thumb'; host.append(thumb);
    const side = editor.getModifiedEditor();
    let previousHeight = 0, previousViewport = 0;
    let drag: { y: number; top: number } | undefined;
    let travel = 0, maximum = 0;
    const sync = () => {
      const height = side.getScrollHeight(), viewport = scroll.clientHeight;
      extent.style.height = height + 'px';
      scroll.scrollTop = side.getScrollTop();
      const thumbHeight = Math.min(viewport, Math.max(20, viewport * viewport / Math.max(height, 1)));
      travel = viewport - thumbHeight; maximum = Math.max(0, height - viewport);
      thumb.hidden = maximum === 0;
      thumb.style.height = thumbHeight + 'px';
      thumb.style.top = (maximum ? side.getScrollTop() / maximum * travel : 0) + 'px';
      if (height > viewport && (height > previousHeight || viewport < previousViewport)) stopScrollbars.reveal(host);
      previousHeight = height; previousViewport = viewport;
    };
    side.onDidScrollChange(sync);
    side.onDidContentSizeChange(sync);
    scroll.addEventListener('scroll', () => {
      if (Math.abs(side.getScrollTop() - scroll.scrollTop) > 1) side.setScrollTop(scroll.scrollTop);
    });
    thumb.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); thumb.setPointerCapture(event.pointerId);
      drag = { y: event.clientY, top: side.getScrollTop() };
    }, { signal: input.signal });
    thumb.addEventListener('pointermove', event => {
      if (drag && travel > 0) side.setScrollTop(drag.top + (event.clientY - drag.y) / travel * maximum);
    }, { signal: input.signal });
    thumb.addEventListener('pointerup', () => { drag = undefined; }, { signal: input.signal });
    thumb.addEventListener('lostpointercapture', () => { drag = undefined; }, { signal: input.signal });
    sync();
  }
  for (const [side, lines] of [[editor.getOriginalEditor(), text.beforeLines], [editor.getModifiedEditor(), text.afterLines]] as const) {
    side.updateOptions({
      lineNumbers: line => lines[line - 1] === null ? '⋯' : lines[line - 1]?.toString() ?? '',
      lineNumbersMinChars: digits(lines),
    });
    side.createDecorationsCollection(lines.flatMap((line, index) => line === null ? [{
      range: new monaco.Range(index + 1, 1, index + 1, 1),
      options: { isWholeLine: true, className: 'dsh-diff-gap', lineNumberClassName: 'dsh-diff-gap-number' },
    }] : []));
  }
  views.push({ host: target, editor, original, modified, originalDigits, modifiedDigits });
  if (config.files) {
    const fit = () => {
      const bottom = Math.max(...[editor.getOriginalEditor(), editor.getModifiedEditor()]
        .map(side => side.getBottomForLineNumber(side.getModel()!.getLineCount())));
      const height = Math.max(60, bottom + 24) + 'px';
      if (target.style.height !== height) target.style.height = height;
    };
    editor.getOriginalEditor().onDidContentSizeChange(fit);
    editor.getModifiedEditor().onDidContentSizeChange(fit);
    fit();
  }
  resize.observe(target);
  schedule();
}
function span(className: string, text: string): HTMLSpanElement {
  const node = document.createElement('span'); node.className = className; node.textContent = text; return node;
}
if (config.files) {
  document.body.classList.add('diff-collection');
  host.setAttribute('data-conversation-scroll', '');
  const total = document.createElement('div'); total.className = 'review-total';
  total.append(span('', config.filesTitle),
    span('added', '+' + config.files.reduce((sum, file) => sum + file.added, 0)),
    span('deleted', '-' + config.files.reduce((sum, file) => sum + file.deleted, 0)));
  button.parentElement!.prepend(total);
  if (!config.files.length) host.append(span('file-unavailable', config.unavailable));
  for (const file of config.files) {
    const section = document.createElement('details'); section.className = 'diff-file';
    const summary = document.createElement('summary');
    summary.append(span('file-path', file.display), span('added', '+' + file.added), span('deleted', '-' + file.deleted), span('chevron', '›'));
    const target = document.createElement('div');
    target.className = file.unavailable ? 'file-unavailable' : 'file-diff';
    if (file.unavailable) target.textContent = config.unavailable;
    section.append(summary, target); host.append(section);
    let mounted = false;
    section.addEventListener('toggle', () => {
      if (section.open && !mounted && !file.unavailable) {
        mounted = true;
        mount(target, file, diffLanguage(file.path));
      }
      schedule();
    });
    section.open = true;
  }
} else {
  host.setAttribute('data-conversation-scroll', '');
  const title = document.createElement('div'); title.className = 'review-total';
  title.append(span('', config.path)); button.parentElement!.prepend(title);
  const target = document.createElement('div'); target.className = 'single-diff'; target.style.height = '100%'; host.append(target);
  mount(target, config, config.language);
}
function layout(): void {
  frame = 0;
  const wordWrap = wrap ? 'on' : 'off';
  for (const view of views) {
    const { host: target, editor } = view;
    const width = target.clientWidth, height = target.clientHeight;
    if (!width || !height) continue;
    const split = width > config.breakpoint;
    editor.updateOptions({ renderSideBySide: split, useInlineViewWhenSpaceIsLimited: false, diffWordWrap: wordWrap });
    for (const side of [editor.getOriginalEditor(), editor.getModifiedEditor()]) {
      // Inline alignment requires the collapsed original to remain unwrapped.
      const sideWrap = !split && side === editor.getOriginalEditor() ? 'off' : wordWrap;
      side.updateOptions({ glyphMargin: false, lineDecorationsWidth: 10,
        lineNumbersMinChars: side === editor.getOriginalEditor() ? view.originalDigits : view.modifiedDigits + (split ? 0 : 1),
        wordWrap: sideWrap, wordWrapOverride1: sideWrap, wordWrapOverride2: sideWrap });
    }
    editor.layout({ width, height });
    target.dataset.layout = split ? 'split' : 'inline';
    target.dataset.wrap = wordWrap;
    if (!config.files) { host.dataset.layout = target.dataset.layout; host.dataset.wrap = wordWrap; }
  }
  button.textContent = wrap ? config.wrapOn : config.wrapOff;
  button.setAttribute('aria-pressed', String(wrap));
}
function schedule(): void { if (!frame) frame = requestAnimationFrame(layout); }
button.onclick = () => { wrap = !wrap; api.setState({ wrap }); schedule(); };
window.addEventListener('resize', schedule);
window.addEventListener('message', event => { if (event.data?.kind === 'layout') schedule(); });
document.addEventListener('visibilitychange', schedule);

function theme(): void {
  const classes = document.body.classList;
  const base = classes.contains('vscode-high-contrast-light') ? 'hc-light'
    : classes.contains('vscode-high-contrast') ? 'hc-black' : classes.contains('vscode-light') ? 'vs' : 'vs-dark';
  const vars = getComputedStyle(document.documentElement), colors: Record<string, string> = {};
  for (const key of ['editor.background', 'editor.foreground', 'diffEditor.insertedTextBackground', 'diffEditor.removedTextBackground']) {
    const value = vars.getPropertyValue(`--vscode-${key.replace('.', '-')}`).trim();
    if (/^#[\da-f]{3,8}$/i.test(value)) colors[key] = value;
  }
  monaco.editor.defineTheme('dsh-vscode', { base, inherit: true, rules: [], colors });
  monaco.editor.setTheme('dsh-vscode'); schedule();
}
const themes = new MutationObserver(theme);
themes.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
themes.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
window.addEventListener('unhandledrejection', () => {
  const notice = document.getElementById('error')!; notice.hidden = false; notice.textContent = config.failed;
});
window.addEventListener('pagehide', () => {
  input.abort();
  stopScrollbars();
  resize.disconnect(); themes.disconnect(); cancelAnimationFrame(frame);
  for (const view of views) { view.editor.dispose(); view.original.dispose(); view.modified.dispose(); }
  void workerUrl?.then(url => URL.revokeObjectURL(url));
}, { once: true });
theme(); schedule();
