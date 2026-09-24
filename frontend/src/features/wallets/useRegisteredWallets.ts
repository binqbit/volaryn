import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { getWallets } from '@wallet-standard/core';

/** Discovery includes incompatible wallets so the chooser can explain network restrictions. */
export function useRegisteredWallets() {
  const registry = useMemo(() => getWallets(), []);
  const subscribe = useCallback(
    (changed: () => void) => {
      const registered = registry.on('register', changed);
      const unregistered = registry.on('unregister', changed);
      return () => {
        registered();
        unregistered();
      };
    },
    [registry],
  );
  return useSyncExternalStore(subscribe, registry.get, registry.get);
}
