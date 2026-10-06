// The node built-ins index.ts uses, typed here: omp runs it under its bundled bun, and mods/ carries no @types/node.
declare module 'node:fs' {
  export function existsSync(path: string): boolean
  export function mkdirSync(path: string, opts?: { recursive?: boolean }): void
  export function readFileSync(path: string, enc: 'utf8'): string
  export function writeFileSync(path: string, data: string): void
}
declare module 'node:os' {
  export function homedir(): string
}
declare module 'node:path' {
  export function join(...parts: string[]): string
}
declare const process: { env: Record<string, string | undefined>; cwd(): string }
