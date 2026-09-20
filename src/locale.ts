/** Copy owned by the VS Code surface; official client plugins retain their dictionaries. */

const en = {
  legacyBackend: 'An older user-wide backend is still running. Finish its tasks, run DeepSeek Harness: Stop All Backends, then retry to enable workspace backends.',
  restartBackend: 'Restart backend and retry',
  restartWarning: 'The session preset could not load. If DSH was updated, restart the backend to load the new dependencies. Restarting stops all tasks on this workspace backend.',
  second: 'sec',
  seconds: 'secs',
  minute: 'min',
  minutes: 'mins',
  hour: 'hour',
  hours: 'hours',
  timeSeparator: ' ',
  loadTimeout: 'Webview initialization timed out. Retry or use Reload Current View.',
  sessionUnavailable: 'Session unavailable; reopen history and retry.',
  cancelled: 'File selection cancelled.',
  absoluteSettings: 'settingsPath must be an absolute file path.',
  deleteSession: 'Delete session',
  deleteDetail: 'Stop pending and active work, then archive the session.',
  followTheme: 'Follow VS Code',
  searchHistory: 'Search sessions',
  noMatches: 'No matching sessions',
  history: 'Session history',
  fresh: 'New session',
  settings: 'Settings',
  empty: 'No sessions in this workspace',
  remove: 'Remove context',
  loading: 'Loading the official Web interface…',
  workspace: 'Open a trusted VS Code workspace first.',
  retry: 'Retry',
  failed: 'Unable to open DeepSeek Harness',
  close: 'Close settings',
  connectPrompt: 'Official dsh Web launch URL (including token)',
  stopped: 'Backend disconnected. Open chat or retry to reconnect.'
};

const zh: typeof en = {
  legacyBackend: '旧版全用户共享后台仍在运行。请先完成其中的任务，执行“DeepSeek Harness：关闭所有后台”，再重试以启用工作区后台。',
  restartBackend: '重启后台并重试',
  restartWarning: '会话预设未能加载。如果刚更新了 DSH，请重启后台加载新依赖。重启会停止此工作区后台上的所有任务。',
  second: '秒',
  seconds: '秒',
  minute: '分钟',
  minutes: '分钟',
  hour: '小时',
  hours: '小时',
  timeSeparator: '',
  loadTimeout: '界面初始化超时，请重试或使用重新加载当前页面。',
  sessionUnavailable: '会话不可用，请重新打开历史后重试。',
  cancelled: '已取消选择文件。',
  absoluteSettings: 'settingsPath 必须是文件的绝对路径。',
  deleteSession: '删除会话',
  deleteDetail: '停止待执行和正在运行的任务，然后归档会话。',
  followTheme: '跟随 VS Code',
  searchHistory: '搜索会话',
  noMatches: '没有匹配的会话',
  history: '历史会话',
  fresh: '新会话',
  settings: '设置',
  empty: '此工作区暂无会话',
  remove: '移除上下文',
  loading: '正在加载官方 Web 界面…',
  workspace: '请先打开并信任一个 VS Code 工作区。',
  retry: '重试',
  failed: '无法打开 DeepSeek Harness',
  close: '关闭设置',
  connectPrompt: '官方 dsh Web 启动 URL（包含 token）',
  stopped: '后台已断开。打开聊天或点击重试可重新连接。'
};

/** @param language - VS Code or client language. @returns Local surface dictionary. */
export function copy(language: string): typeof en {
  return language.startsWith('zh') ? zh : en;
}
