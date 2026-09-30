/** Self-contained startup styles; blue tokens and motion follow official DSH. */
export const startupStyle = `
html,body{margin:0;min-height:100%;background:var(--vscode-editor-background);color:var(--startup-whale)}
body{--startup-whale:#fff;--startup-ink:color-mix(in srgb,#5686fe 55%,#adb2b8);--startup-shimmer:color-mix(in srgb,#93c5fd 65%,#7aaaff);font:13px var(--vscode-font-family);display:grid;place-items:center;min-height:100vh}
body.vscode-light,body.vscode-high-contrast-light{--startup-whale:#000;--startup-ink:color-mix(in srgb,#4176e6 70%,#172554);--startup-shimmer:color-mix(in srgb,#4176e6 30%,#172554)}
.page{width:min(440px,calc(100% - 40px));text-align:center;padding:32px 0}
.whale{width:76px;height:60px;margin:auto;display:grid;place-items:center}
.whale svg{width:58px;height:44px;color:var(--startup-whale);overflow:visible;transform-origin:50% 60%}
.whale.swimming svg{animation:swim 1.6s ease-in-out infinite}
@keyframes swim{0%,100%{transform:none}35%{transform:rotate(-4deg) translate(-0.4px,-0.9px)}70%{transform:rotate(1.6deg) translate(0.3px,0.2px)}}
h1{font-size:22px;font-weight:500;margin:20px 0 10px}
.spinner{width:22px;height:22px;border:2px solid var(--vscode-widget-border,#8884);border-top-color:var(--startup-whale);border-radius:50%;animation:spin 1s linear infinite;margin:24px auto 12px}
@keyframes spin{to{transform:rotate(360deg)}}
section{text-align:left;padding:16px;margin-top:20px;border:1px solid var(--vscode-widget-border,#8884);border-radius:10px}
p{line-height:1.7;overflow-wrap:anywhere}
button{font:inherit;max-width:calc(100% - 8px);overflow-wrap:anywhere;padding:8px 12px;margin:4px;border:1px solid color-mix(in srgb,var(--startup-ink) 35%,transparent);border-radius:5px;cursor:pointer;color:var(--startup-ink);background:color-mix(in srgb,var(--startup-ink) 10%,transparent)}
button:hover,button:focus-visible{background:color-mix(in srgb,var(--startup-ink) 16%,transparent)}
button:active{background:color-mix(in srgb,var(--startup-ink) 24%,transparent)}
button:focus-visible,a:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}
body.vscode-high-contrast button,body.vscode-high-contrast-light button{border-color:var(--startup-ink)}
a{color:var(--vscode-textLink-foreground)}
.button-label{position:relative;display:inline-grid;max-width:100%}
.decoration{position:absolute;inset:0;overflow:clip;pointer-events:none;user-select:none;display:none}
button:hover .decoration,button:focus-visible .decoration{display:block}
.sweep{position:absolute;inset:0;overflow:hidden;color:var(--startup-shimmer);mask-image:linear-gradient(105deg,transparent 0%,black 40% 60%,transparent 100%);transform:translateX(-100%);animation-name:sweep}
.highlight{width:100%;height:100%;transform:translateX(100%);animation-name:highlight}
.sweep,.highlight{animation-duration:1.5s;animation-delay:.3s;animation-timing-function:steps(48,end);animation-iteration-count:infinite}
@keyframes sweep{0%{transform:translateX(-100%)}66.6667%,100%{transform:translateX(100%)}}
@keyframes highlight{0%{transform:translateX(100%)}66.6667%,100%{transform:translateX(-100%)}}
@media(prefers-reduced-motion:reduce){.whale.swimming svg,.spinner,.sweep,.highlight{animation:none}button .decoration,button:hover .decoration,button:focus-visible .decoration{display:none}}
`;
