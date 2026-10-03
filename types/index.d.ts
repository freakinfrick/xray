// memo: facts recalled from this project's history (round 16), drawn after the headline on a desktop.
export type LastTurn = { title: string; headline: string; tone: 'ok' | 'fail' | 'plain'; owed: { t: string; color?: string }[]; memo?: string[]; name?: string; moment?: { kind: 'celebrate' | 'record' | 'milestone' | 'landmark'; text: string; fact?: string } }

// round 18: the cache countdown (hooks/cache.ts `Cache`, kept structurally equal)
export type XrayCache = { ttl: '5m' | '1h' | null; anchor: number; size: number; model: string; rows: { read: number; wrote: number; fresh: number; why?: string }[]; turns: number; toastedAt: number }

declare module 'claude-code' {
  interface PluginState {
    xray: { last: LastTurn | null; prev: string | null; cache: XrayCache | null }
  }
}
