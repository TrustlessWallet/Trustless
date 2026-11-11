/** Bounded, resumable SDK history reads. This stores cursors, never payment outcomes. */
export class TerminalPaymentScan<T> {
  private scans = new Map<string, { offset: number; flight?: Promise<T | null> }>();

  async find(key: string, read: (offset: number, limit: number) => Promise<readonly T[]>,
    matches: (payment: T) => boolean, assertCurrent: () => void): Promise<T | null> {
    assertCurrent();
    let state = this.scans.get(key);
    if (!state) {
      // Bound memory when many different invoices are inspected in one session.
      if (this.scans.size >= 128) {
        const idle = [...this.scans].find(([, value]) => !value.flight);
        if (idle) this.scans.delete(idle[0]);
      }
      state = { offset: 0 };
      this.scans.set(key, state);
    }
    const cursor = state;
    if (!cursor.flight) {
      cursor.flight = (async () => {
        for (let page = 0; page < 5; page++) {
          assertCurrent();
          const rows = await read(cursor.offset, 50);
          assertCurrent();
          const match = rows.find(matches);
          if (match) { cursor.offset = 0; return match; }
          // Advance only after a successful, current read. Offline retries resume
          // the failed page. Exhaustion starts a fresh pass on the next check.
          if (rows.length < 50) { cursor.offset = 0; return null; }
          cursor.offset += rows.length;
        }
        return null;
      })();
    }
    const flight = cursor.flight;
    try {
      const result = await flight;
      assertCurrent();
      return result;
    } finally {
      if (cursor.flight === flight) cursor.flight = undefined;
    }
  }
}
