/** A deadline releases the UI, not the native operation. Always guard late results. */
export function withDeadline<T>(operation: Promise<T>, label: string, timeoutMs = 20000): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timed out. Please try again.`)), timeoutMs);
        operation.then(value => { clearTimeout(timer); resolve(value); }, error => {
            clearTimeout(timer);
            reject(error);
        });
    });
}

/** Deduplicate native work even after a caller's deadline expires. */
export class SingleFlight {
    private pending = new Map<string, Promise<unknown>>();

    isRunning(key: string): boolean {
        return this.pending.has(key);
    }

    run<T>(key: string, operation: () => Promise<T>): Promise<T> {
        const existing = this.pending.get(key);
        if (existing) return existing as Promise<T>;
        const task = Promise.resolve().then(operation);
        this.pending.set(key, task);
        const clear = () => { if (this.pending.get(key) === task) this.pending.delete(key); };
        void task.then(clear, clear);
        return task;
    }
}

/** Never overlap connect/disconnect, including a connect which outlives its UI deadline. */
export class LightningLifecycle<T extends { disconnect(): Promise<unknown> }> {
    private queue: Promise<unknown> = Promise.resolve();
    private current: T | null = null;
    private enqueue<R>(operation: () => Promise<R>): Promise<R> {
        const task = this.queue.catch(() => {}).then(operation);
        this.queue = task;
        return task;
    }

    replace(connect: () => Promise<T>, isCurrent: () => boolean): Promise<T | null> {
        return this.enqueue(async () => {
            if (!isCurrent()) return null;
            if (this.current) {
                // Retain ownership if disconnect fails: a retry must finish teardown first.
                await this.current.disconnect();
                this.current = null;
            }
            if (!isCurrent()) return null;
            const sdk = await connect();
            this.current = sdk;
            if (!isCurrent()) {
                await sdk.disconnect();
                this.current = null;
                return null;
            }
            return sdk;
        });
    }

    dispose(expected?: T): Promise<void> {
        return this.enqueue(async () => {
            if (!this.current || (expected && this.current !== expected)) return;
            await this.current.disconnect();
            this.current = null;
        });
    }
}
