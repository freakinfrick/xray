// The node built-ins xray.ts uses, typed here: omp runs it under its bundled bun, pi under node (jiti), and mods/
// carries no @types/node.
declare module 'node:fs' {
  export function existsSync(path: string): boolean
  export function mkdirSync(path: string, opts?: { recursive?: boolean }): void
  export function readFileSync(path: string, enc: 'utf8'): string
  export function writeFileSync(path: string, data: string): void
  export function realpathSync(path: string): string
}
declare module 'node:os' {
  export function homedir(): string
}
declare module 'node:path' {
  export function join(...parts: string[]): string
  export function dirname(path: string): string
}
declare module 'node:url' {
  export function fileURLToPath(url: string): string
}
declare const process: { env: Record<string, string | undefined>; cwd(): string; stdout: { rows?: number } }
// pi has no ctx.setInterval: a plain timer there (es2023 lib carries no timer types).
declare function setInterval(fn: () => void, ms: number): unknown
declare function clearInterval(handle: unknown): void
interface ImportMeta {
  url: string
}
