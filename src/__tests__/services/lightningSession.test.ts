import { LightningLifecycle, SingleFlight, withDeadline } from '../../services/lightningSession';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(yes => { resolve = yes; });
    return { promise, resolve };
}
afterEach(() => jest.useRealTimers());

it('keeps native requests deduplicated after the UI deadline', async () => {
    jest.useFakeTimers();
    const work = deferred<number>();
    const operation = jest.fn(() => work.promise);
    const flights = new SingleFlight();
    const native = flights.run('balance', operation);
    const ui = withDeadline(native, 'Balance', 10);
    const rejection = expect(ui).rejects.toThrow('timed out');
    await jest.advanceTimersByTimeAsync(11);
    await rejection;
    expect(flights.run('balance', operation)).toBe(native);
    expect(operation).toHaveBeenCalledTimes(1);
    work.resolve(12);
    await expect(native).resolves.toBe(12);
});

it('independent balance and history requests do not block each other', async () => {
    const flights = new SingleFlight();
    const history = deferred<void>();
    void flights.run('history', () => history.promise);
    await expect(flights.run('balance', async () => 9)).resolves.toBe(9);
    history.resolve();
});

it('disconnects a late obsolete connection before connecting another wallet', async () => {
    const lifecycle = new LightningLifecycle<{ disconnect(): Promise<void> }>();
    const connection = deferred<{ disconnect(): Promise<void> }>();
    const teardown = deferred<void>();
    const old = { disconnect: jest.fn(() => teardown.promise) };
    const next = { disconnect: jest.fn(async () => {}) };
    let current = true;
    const first = lifecycle.replace(() => connection.promise, () => current);
    await Promise.resolve(); await Promise.resolve();
    current = false;
    const connectNext = jest.fn(async () => next);
    const second = lifecycle.replace(connectNext, () => true);
    connection.resolve(old);
    await Promise.resolve(); await Promise.resolve();
    expect(connectNext).not.toHaveBeenCalled();
    teardown.resolve();
    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toBe(next);
    expect(old.disconnect).toHaveBeenCalledTimes(1);
});

it('does not disconnect a new session when cleanup targets an old one', async () => {
    const lifecycle = new LightningLifecycle<{ disconnect(): Promise<void> }>();
    const old = { disconnect: jest.fn(async () => {}) };
    const next = { disconnect: jest.fn(async () => {}) };
    await lifecycle.replace(async () => old, () => true);
    await lifecycle.replace(async () => next, () => true);
    await lifecycle.dispose(old);
    expect(next.disconnect).not.toHaveBeenCalled();
});

it('does not connect a replacement when native teardown fails', async () => {
    const lifecycle = new LightningLifecycle<{ disconnect(): Promise<void> }>();
    const old = { disconnect: jest.fn().mockRejectedValueOnce(new Error('Busy')).mockResolvedValue(undefined) };
    await lifecycle.replace(async () => old, () => true);
    const connectNext = jest.fn(async () => ({ disconnect: async () => {} }));
    await expect(lifecycle.replace(connectNext, () => true)).rejects.toThrow('Busy');
    expect(connectNext).not.toHaveBeenCalled();
    await lifecycle.replace(connectNext, () => true);
    expect(old.disconnect).toHaveBeenCalledTimes(2);
});
