import type { CheckOptions } from './check';
import { MARKETPLACES, type Marketplace, type MarketplaceId } from './marketplaces';
import type { AuthRecord } from './types';

export interface AuthServiceDeps {
  store: {
    get(id: MarketplaceId): Promise<AuthRecord>;
    set(id: MarketplaceId, record: AuthRecord): Promise<void>;
  };
  check(m: Marketplace, previous: AuthRecord, options: CheckOptions): Promise<AuthRecord>;
  /** Called after a new record is stored, with the one it replaced, for example to extend the session history. */
  onStored?(id: MarketplaceId, record: AuthRecord, previous: AuthRecord): Promise<void>;
  /** Amazon can change auth cookies several times within a moment, so wait for them to settle. */
  settleMs?: number;
}

/** State here lives in memory, so it dies with the service worker. So do any checks in progress. */
export function createAuthService({ store, check, onStored, settleMs = 1500 }: AuthServiceDeps) {
  const inFlight = new Map<MarketplaceId, Promise<AuthRecord>>();
  const generations = new Map<MarketplaceId, number>();
  const pendingRechecks = new Map<MarketplaceId, ReturnType<typeof setTimeout>>();

  const generationOf = (id: MarketplaceId) => generations.get(id) ?? 0;

  async function perform(id: MarketplaceId, options: CheckOptions): Promise<AuthRecord> {
    const startedIn = generationOf(id);
    const previous = await store.get(id);
    const next = await check(MARKETPLACES[id], previous, options);
    // The session changed while this check ran, so its answer may describe the old session.
    // Dropping it stops a late reply restoring an email after logout. The recheck reports the new state.
    if (generationOf(id) !== startedIn) return previous;
    if (next !== previous) {
      await store.set(id, next);
      await onStored?.(id, next, previous).catch((error) => console.warn('After-store step failed', id, error));
    }
    return next;
  }

  function request(id: MarketplaceId, options: CheckOptions = {}): Promise<AuthRecord> {
    const running = inFlight.get(id);
    if (running) return running;
    const run = perform(id, options).finally(() => inFlight.delete(id));
    inFlight.set(id, run);
    return run;
  }

  function onSessionSignal(id: MarketplaceId): void {
    generations.set(id, generationOf(id) + 1);
    const pending = pendingRechecks.get(id);
    if (pending) clearTimeout(pending);
    pendingRechecks.set(
      id,
      setTimeout(async () => {
        pendingRechecks.delete(id);
        // Joining a check from before this signal would return its discarded answer.
        await inFlight.get(id)?.catch(() => undefined);
        await request(id, { force: true }).catch((error) => console.warn('Recheck failed', id, error));
      }, settleMs),
    );
  }

  return { request, onSessionSignal };
}
