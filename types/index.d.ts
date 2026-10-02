export type LastTurn = { headline: string; tone: 'ok' | 'fail' | 'plain'; owed: string[] }

declare module 'claude-code' {
  interface PluginState {
    xray: { last: LastTurn | null }
  }
}
