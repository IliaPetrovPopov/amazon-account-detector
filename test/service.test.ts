import { afterEach, beforeEach, describe as group, expect, it, vi } from 'vitest';
import { createAuthService } from '../src/service';
import { EMPTY_RECORD, type AuthRecord } from '../src/types';

const signedIn = (email: string): AuthRecord => ({ ...EMPTY_RECORD, status: 'signed_in', email, confirmedAt: 1 });
const signedOut: AuthRecord = { ...EMPTY_RECORD, status: 'signed_out', confirmedAt: 2 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function makeStore() {
  const records = new Map<string, AuthRecord>();
  return {
    records,
    get: vi.fn(async (id: string) => records.get(id) ?? EMPTY_RECORD),
    set: vi.fn(async (id: string, record: AuthRecord) => void records.set(id, record)),
  };
}

group('createAuthService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stores the result of a check', async () => {
    const store = makeStore();
    const service = createAuthService({ store, check: async () => signedIn('a@example.com') });
    await service.request('de');
    expect(store.records.get('de')?.email).toBe('a@example.com');
  });

  it('shares one check between concurrent requests for a marketplace', async () => {
    const store = makeStore();
    const answer = deferred<AuthRecord>();
    const check = vi.fn(() => answer.promise);
    const service = createAuthService({ store, check });

    const first = service.request('de');
    const second = service.request('de');
    answer.resolve(signedIn('a@example.com'));
    await Promise.all([first, second]);

    expect(check).toHaveBeenCalledTimes(1);
  });

  it('does not share checks between marketplaces', async () => {
    const check = vi.fn(async () => signedIn('a@example.com'));
    const service = createAuthService({ store: makeStore(), check });
    await Promise.all([service.request('de'), service.request('fr')]);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('skips the write when the check returns the record unchanged', async () => {
    const store = makeStore();
    const existing = signedIn('a@example.com');
    store.records.set('de', existing);
    const service = createAuthService({ store, check: async (_m, previous) => previous });
    await service.request('de');
    expect(store.set).not.toHaveBeenCalled();
  });

  it('a check finishing after a logout cannot restore the old email', async () => {
    const store = makeStore();
    const lateAnswer = deferred<AuthRecord>();
    const check = vi
      .fn<() => Promise<AuthRecord>>()
      .mockImplementationOnce(() => lateAnswer.promise)
      .mockImplementationOnce(async () => signedOut);
    const service = createAuthService({ store, check, settleMs: 1000 });

    const inProgress = service.request('de');
    await vi.advanceTimersByTimeAsync(0);
    service.onSessionSignal('de');

    lateAnswer.resolve(signedIn('old@example.com'));
    await inProgress;
    expect(store.records.has('de')).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    expect(store.records.get('de')).toEqual(signedOut);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('the recheck waits for a slow check instead of joining its discarded answer', async () => {
    const store = makeStore();
    const slowAnswer = deferred<AuthRecord>();
    const check = vi
      .fn<() => Promise<AuthRecord>>()
      .mockImplementationOnce(() => slowAnswer.promise)
      .mockImplementationOnce(async () => signedOut);
    const service = createAuthService({ store, check, settleMs: 1000 });

    const inProgress = service.request('de');
    await vi.advanceTimersByTimeAsync(0);
    service.onSessionSignal('de');
    await vi.advanceTimersByTimeAsync(1000);
    expect(check).toHaveBeenCalledTimes(1);

    slowAnswer.resolve(signedIn('old@example.com'));
    await inProgress;
    await vi.advanceTimersByTimeAsync(0);

    expect(check).toHaveBeenCalledTimes(2);
    expect(store.records.get('de')).toEqual(signedOut);
  });

  it('a burst of cookie changes causes one forced recheck, after things settle', async () => {
    const check = vi.fn(async () => signedOut);
    const service = createAuthService({ store: makeStore(), check, settleMs: 1000 });

    service.onSessionSignal('de');
    await vi.advanceTimersByTimeAsync(500);
    service.onSessionSignal('de');
    await vi.advanceTimersByTimeAsync(999);
    expect(check).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(1);
    expect(check.mock.calls[0]).toEqual([expect.objectContaining({ id: 'de' }), EMPTY_RECORD, { force: true }]);
  });

  it('runs the after-store step with the stored record and the one it replaced', async () => {
    const onStored = vi.fn(async () => undefined);
    const service = createAuthService({ store: makeStore(), check: async () => signedIn('a@example.com'), onStored });
    await service.request('de');
    expect(onStored).toHaveBeenCalledWith('de', signedIn('a@example.com'), EMPTY_RECORD);
  });

  it('skips the after-store step when nothing changed', async () => {
    const store = makeStore();
    store.records.set('de', signedIn('a@example.com'));
    const onStored = vi.fn(async () => undefined);
    const service = createAuthService({ store, check: async (_m, previous) => previous, onStored });
    await service.request('de');
    expect(onStored).not.toHaveBeenCalled();
  });

  it('a dropped late reply never reaches the after-store step', async () => {
    const lateAnswer = deferred<AuthRecord>();
    const onStored = vi.fn(async () => undefined);
    const check = vi
      .fn<() => Promise<AuthRecord>>()
      .mockImplementationOnce(() => lateAnswer.promise)
      .mockImplementationOnce(async () => signedOut);
    const service = createAuthService({ store: makeStore(), check, onStored, settleMs: 1000 });

    const inProgress = service.request('de');
    await vi.advanceTimersByTimeAsync(0);
    service.onSessionSignal('de');
    lateAnswer.resolve(signedIn('old@example.com'));
    await inProgress;
    await vi.advanceTimersByTimeAsync(1000);

    expect(onStored).toHaveBeenCalledTimes(1);
    expect(onStored).toHaveBeenCalledWith('de', signedOut, EMPTY_RECORD);
  });

  it('a failing after-store step does not break the check', async () => {
    const store = makeStore();
    const onStored = vi.fn(async () => {
      throw new Error('history full');
    });
    const service = createAuthService({ store, check: async () => signedIn('a@example.com'), onStored });
    await expect(service.request('de')).resolves.toEqual(signedIn('a@example.com'));
    expect(store.records.get('de')?.email).toBe('a@example.com');
  });
});
