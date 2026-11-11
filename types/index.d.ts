/** Số liệu context của phiên; chưa có tokens/percent trước phản hồi đầu. */
export type ContextUsage = {
  tokens?: number
  window: number
  percent?: number
}

declare module 'claude-code' {
  interface PluginState {
    'context-bar': { context: ContextUsage }
  }
}
