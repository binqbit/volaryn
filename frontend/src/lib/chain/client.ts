import { createClient, createSolanaRpc } from '@solana/kit';
import { walletSigner } from '@solana/kit-plugin-wallet';
import { registerWallet } from '@wallet-standard/core';
import type { Deployment } from '../api/client';
import { createWalletConnectWallet } from '../walletconnect/wallet';

let walletConnect: ReturnType<typeof createWalletConnectWallet> | undefined;

export async function createAppClient(deployment: Deployment) {
  const rpc = createSolanaRpc(new URL('/rpc', window.location.origin).toString());
  if ((await rpc.getGenesisHash().send()) !== deployment.genesisHash)
    throw new Error('Network identity mismatch');
  const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim();
  if (import.meta.env.MODE !== 'localnet' && projectId && !walletConnect) {
    walletConnect = createWalletConnectWallet({
      projectId,
      url: window.location.origin,
      icon: new URL('/assets/volaryn.svg', window.location.origin).toString(),
    });
    registerWallet(walletConnect.wallet);
  }
  return createClient()
    .use(
      walletSigner({
        chain: import.meta.env.MODE === 'localnet' ? 'solana:localnet' : 'solana:mainnet',
        autoConnect: true,
        storageKey: `volaryn:wallet:${deployment.genesisHash}:${deployment.programId}`,
      }),
    )
    .use((client) => ({ ...client, rpc, walletConnect }));
}
export type AppClient = Awaited<ReturnType<typeof createAppClient>>;
