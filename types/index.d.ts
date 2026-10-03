// memo: facts recalled from this project's history (round 16), drawn after the headline on a desktop.
export type LastTurn = { title: string; headline: string; tone: 'ok' | 'fail' | 'plain'; owed: { t: string; color?: string }[]; memo?: string[] }

declare module 'claude-code' {
  interface PluginState {
    xray: { last: LastTurn | null; prev: string | null }
  }
}
