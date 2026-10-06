// The node built-ins widget.ts uses, typed here: hermes' TUI runs the bundle under node, and mods/ carries
// no @types/node.
declare module 'node:fs' {
  export type Stats = { size: number }
  export function existsSync(path: string): boolean
  export function mkdirSync(path: string, opts?: { recursive?: boolean }): void
  export function readFileSync(path: string, enc: 'utf8'): string
  export function writeFileSync(path: string, data: string): void
  export function readdirSync(path: string): string[]
  export function unlinkSync(path: string): void
  export function statSync(path: string): Stats
  export function openSync(path: string, flags: string): number
  export function readSync(fd: number, buf: Uint8Array, offset: number, length: number, position: number): number
  export function closeSync(fd: number): void
  export function watch(path: string, fn: (event: string, file: string | null) => void): { close(): void; unref?(): void }
}
declare module 'node:os' {
  export function homedir(): string
}
declare module 'node:path' {
  export function join(...parts: string[]): string
}
declare const process: {
  pid: number
  env: Record<string, string | undefined>
  cwd(): string
  kill(pid: number, signal: number): boolean
  on(event: 'exit', fn: () => void): void
  off(event: 'exit', fn: () => void): void
}
declare class TextDecoder {
  decode(buf: Uint8Array): string
}
declare function setInterval(fn: () => void, ms: number): { unref?(): void }
declare function clearInterval(id: unknown): void
