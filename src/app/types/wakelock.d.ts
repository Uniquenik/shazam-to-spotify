declare global {
  interface WakeLockSentinel extends EventTarget {
    readonly released: boolean;
    release(): Promise<void>;
    onrelease: ((this: WakeLockSentinel, ev: Event) => unknown) | null;
  }

  interface WakeLock {
    request(type: "screen"): Promise<WakeLockSentinel>;
  }

  interface Navigator {
    wakeLock?: WakeLock;
  }
}

export {};
