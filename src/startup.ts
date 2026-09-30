/** Localized setup and loading surfaces available before the official client starts. */

import { startupStyle } from './startup-style.ts';
import { SWIM_UP, SWIM_DOWN } from './startup-whale.ts';

const en = {
  install: 'Install official DSH',
  installing: 'Installing official DSH…',
  installFailed: 'Installation failed. See Output → DeepSeek Harness, then retry or select an existing DSH installation.',
  installCancelled: 'Installation cancelled. You can retry or select an existing DSH installation.',
  installHint: 'One-click installation runs npx @deepseek-ai/dsh web on this host and saves the installed path automatically. Node.js with npx and network access are required.',
  tagline: 'Into the Unknown',
  checking: 'Checking the environment…',
  loading: 'Loading Harness…',
  node: 'Node.js is unavailable or unsupported. Install Node.js 22.19+ (22.x) or 24+, add it to PATH, then restart VS Code. For SSH, install it on the remote host.',
  download: 'Download Node.js',
  bin: 'Official DSH ({project}) bin.js was not found. Select its bin.js file or an installed DSH folder.',
  binAction: 'Select bin file',
  directoryAction: 'Select DSH folder',
  binPrompt: 'Select the official DSH bin.js file',
  directoryPrompt: 'Select the installed and built DSH folder',
  project: 'Official DSH project',
  retry: 'Reload',
  invalid: 'Select a valid DSH bin.js file or installation folder.',
  saved: 'DSH path saved in VS Code user settings on this host.'
};
const zh: typeof en = {
  install: '一键安装官方 DSH',
  installing: '正在安装官方 DSH…',
  installFailed: '安装失败，请查看“输出 → DeepSeek Harness”，然后重试或选择已有 DSH 安装。',
  installCancelled: '安装已取消，可以重试或选择已有 DSH 安装。',
  installHint: '一键安装会在当前主机执行 npx @deepseek-ai/dsh web 并自动保存安装路径，需要 Node.js、npx 和网络连接。',
  tagline: '探索未至之境',
  checking: '正在检查运行环境…',
  loading: '正在加载 Harness…',
  node: 'Node.js 未找到或版本不满足要求。请安装 Node.js 22.19+（22.x）或 24+，加入 PATH 后重启 VS Code。SSH 工作区请在远程机器安装。',
  download: '前往 Node.js 官方下载',
  bin: '未找到官方 DSH ({project})的 bin.js，请选择 bin.js 文件或已安装的 DSH 目录。',
  binAction: '选择 bin 文件',
  directoryAction: '选择 DSH 目录',
  binPrompt: '选择官方 DSH 的 bin.js 文件',
  directoryPrompt: '选择已安装依赖并构建完成的 DSH 目录',
  project: 'DSH 官方项目',
  retry: '重新加载',
  invalid: '请选择有效的 DSH bin.js 文件或安装目录。',
  saved: 'DSH 路径已保存到当前运行主机的 VS Code 用户设置。'
};

/** @param language - VS Code language. @returns Setup copy for that locale. */
export function startupCopy(language: string): typeof en {
  return language.toLowerCase().startsWith('zh') ? zh : en;
}

/** Failures are independent so both missing prerequisites can be repaired. */
export interface StartupState {
  resume?: { cwd: string; sessionId?: string; title?: string };
  installError?: string;
  nodeError?: string;
  binError?: string;
  message?: string;
  retry?: boolean
}

/** @param language - VS Code language. @param nonce - Script nonce. @param whale - Trusted bundled SVG. @param state - Loading or setup status. @returns A self-contained, network-free initial page. */
export function startupHtml(language: string, nonce: string, whale: string, state: StartupState): string {
  const t = startupCopy(language);
  const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const setup = state.nodeError !== undefined || state.binError !== undefined;
  const saved = JSON.stringify(state.resume ?? {}).replace(/</g, '\\u003c');
  const button = (action: string, label: string): string => `<button data-action="${action}"><span class="button-label"><span>${escape(label)}</span><span class="decoration" aria-hidden="true"><span class="sweep"><span class="highlight" style="display:block">${escape(label)}</span></span></span></span></button>`;

  // The page is self-contained: no remote styles, scripts, or fonts.
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'"><style>
${startupStyle}
</style></head><body data-loading="${!setup && !state.retry}"><main class="page"><div class="whale" aria-hidden="true">${whale}</div><h1>${escape(t.tagline)}</h1>
${setup ? '' : `${state.retry ? '' : '<div class="spinner" aria-hidden="true"></div>'}<p role="status">${escape(state.message ?? t.loading)}</p>${state.retry ? button('retry', t.retry) : ''}`}
${state.nodeError !== undefined ? `<section><strong>Node.js</strong><p>${escape(t.node)}</p><a href="https://nodejs.org/en/download" id="node-download">${escape(t.download)}</a></section>` : ''}
${state.binError !== undefined ? `<section><p>${escape(t.bin).replace('{project}', `<a href="https://github.com/deepseek-ai/deepseek-harness" id="dsh-project">${escape(t.project)}</a>`)}${language.toLowerCase().startsWith('zh') ? `（${escape(t.installHint)}）` : ` (${escape(t.installHint)})`}</p>${button('setup-bin', t.binAction)}${button('setup-directory', t.directoryAction)}${state.nodeError === undefined ? button('setup-install', t.install) : ''}${state.installError ? `<p role="alert">${escape(state.installError)}</p>` : ''}</section>` : ''}
</main><script nonce="${nonce}">const api=acquireVsCodeApi();api.setState({...api.getState(),...${saved}});for(const b of document.querySelectorAll('[data-action]'))b.onclick=()=>api.postMessage({kind:b.dataset.action});
const whale=document.querySelector('.whale');
const path=whale.querySelector('path');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
let hovering=false;
function syncSwim(){
  const swim=!reduced.matches&&(document.body.dataset.loading==='true'||hovering);
  whale.classList.toggle('swimming',swim);
  if(!path)return;
  const existing=path.querySelector('animate');
  if(!swim){existing?.remove();return;}
  if(existing)return;
  const animation=document.createElementNS('http://www.w3.org/2000/svg','animate');
  const rest=path.getAttribute('d');
  const attrs={attributeName:'d',values:[rest,${JSON.stringify(SWIM_UP)},rest,${JSON.stringify(SWIM_DOWN)},rest].join(';'),keyTimes:'0;0.35;0.55;0.75;1',calcMode:'spline',keySplines:'0.45 0 0.55 1;0.45 0 0.55 1;0.45 0 0.55 1;0.45 0 0.55 1',dur:'1.6s',repeatCount:'indefinite'};
  for(const [key,value] of Object.entries(attrs))animation.setAttribute(key,value);
  path.append(animation);
  animation.beginElement();
}
whale.addEventListener('mouseenter',()=>{hovering=true;syncSwim();});
whale.addEventListener('mouseleave',()=>{hovering=false;syncSwim();});
reduced.addEventListener('change',syncSwim);
syncSwim();
</script></body></html>`;
}
