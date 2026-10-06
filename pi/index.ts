// xray for pi (pi-coding-agent 0.87.1). Spec: ./SPEC.md. The adapter is shared with omp: ../pifamily/xray.ts.
import { realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Host, Pi } from '../pifamily/xray'

// pi's agent_end can be followed by a retry, a compaction or queued work; agent_settled is the real end.
// Its dark theme's mdLinkUrl is dim grey: read cells take mdLink, the blue.
const PI: Host = { dir: '.pi', closeOn: 'agent_settled', tokens: { mdLinkUrl: 'mdLink' } }

// pi's loader (jiti) resolves imports from the symlinked path (~/.pi/agent/extensions/xray), where
// ../pifamily does not exist: load the adapter from this folder's real place instead.
export default async function (pi: Pi) {
  const here = dirname(realpathSync(fileURLToPath(import.meta.url)))
  const { xray } = (await import(join(here, '..', 'pifamily', 'xray.ts'))) as typeof import('../pifamily/xray')
  xray(pi, PI)
}
