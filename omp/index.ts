// xray for omp (oh-my-pi v18.3.5). Spec: ./SPEC.md. The adapter is shared with pi: ../pifamily/xray.ts.
import { xray, type Host } from '../pifamily/xray'

// omp's agent_end says willContinue when a retry follows, so it closes the turn; timers are ctx.setInterval.
const OMP: Host = { dir: '.omp', closeOn: 'agent_end' }

export default (pi: Parameters<typeof xray>[0]) => xray(pi, OMP)
