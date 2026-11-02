import { useEffect, useState } from 'react';
import { getSyncState, subscribeSync, type SyncState } from './sync';

export function useSyncState(): SyncState {
  const [s, set] = useState(getSyncState);
  useEffect(() => subscribeSync(set), []);
  return s;
}

/** Run `fn` after queued offline changes have been sent to the server. */
export function useOnSynced(fn: () => void) {
  useEffect(() => {
    const h = () => fn();
    window.addEventListener('mineplan:synced', h);
    return () => window.removeEventListener('mineplan:synced', h);
  });
}
