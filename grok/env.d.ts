// The two web globals map.ts and render.ts use (node has them); mods/ carries no @types/node or DOM lib.
declare class TextEncoder { encode(s: string): Uint8Array }
declare class TextDecoder { decode(b: Uint8Array): string }
