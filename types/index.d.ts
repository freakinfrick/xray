export type LastTurn = { title: string; headline: string; tone: 'ok' | 'fail' | 'plain'; owed: { t: string; color?: string }[] }

declare module 'claude-code' {
  interface PluginState {
    xray: { last: LastTurn | null; prev: string | null }
  }
}
