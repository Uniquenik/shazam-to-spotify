export async function requestWakeLock() {
  if (!("wakeLock" in navigator) || !navigator.wakeLock) {
    return null;
  }

  try {
    return await navigator.wakeLock.request("screen");
  } catch {
    return null;
  }
}

export async function releaseWakeLock(sentinel: WakeLockSentinel | null) {
  if (!sentinel || sentinel.released) {
    return;
  }

  await sentinel.release();
}
