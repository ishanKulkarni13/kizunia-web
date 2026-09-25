/**
 * Billing — The `billing:orphan-discovery` Task
 *
 * Runs one bounded orphan-discovery pass (orphan-discovery.service.ts) inside
 * a soft wall-clock budget: no new page starts after it. Scheduler-agnostic
 * (SB-PB-06): the tick registers it LAST, at low frequency (IB-25 item 6), and
 * `GET /api/v1/internal/billing/orphan-discovery` runs it by hand. The cursor
 * is saved after every page, so a run cut short loses nothing.
 */
import { ORPHAN_CONFIG } from "../../config/billing-config";
import { OrphanDiscoveryService } from "./orphan-discovery.service";

export interface OrphanDiscoveryTaskDeps {
  readonly service?: OrphanDiscoveryService;
  readonly now?: () => Date;
}

export class OrphanDiscoveryTask {
  private readonly now: () => Date;
  private readonly service: OrphanDiscoveryService;

  constructor(deps: OrphanDiscoveryTaskDeps = {}) {
    this.now = deps.now ?? (() => new Date());
    this.service = deps.service ?? new OrphanDiscoveryService({ now: this.now });
  }

  async run(options: { readonly budgetMs?: number } = {}): Promise<Record<string, unknown>> {
    const deadline = new Date(this.now().getTime() + (options.budgetMs ?? ORPHAN_CONFIG.wallClockMs));

    return { ...(await this.service.run({ deadline })) };
  }
}
