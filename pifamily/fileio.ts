// The pi family's genome file, the one node-only piece of the adapter (xray.ts stays pure, so the plugin's
// test runner loads it): <host agent dir>/xray/genomes.json. Both omp and pi move the agent dir with
// PI_CODING_AGENT_DIR (isolated runs, profiles).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { StoreIO } from '../hooks/genome'

export const home = () => homedir()

// A failed write leaves the genome as it was on disk: the card still draws from memory.
export function hostIO(hostDir: string): StoreIO {
  const dir = join(process.env.PI_CODING_AGENT_DIR || join(homedir(), hostDir, 'agent'), 'xray')
  const file = join(dir, 'genomes.json')
  return {
    read() {
      try {
        return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
      } catch {
        return {}
      }
    },
    write(all) {
      try {
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
        writeFileSync(file, JSON.stringify(all))
      } catch {}
    },
  }
}
