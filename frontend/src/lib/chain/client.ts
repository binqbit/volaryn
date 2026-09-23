import { createClient, createSolanaRpc } from '@solana/kit';
import { walletSigner } from '@solana/kit-plugin-wallet';
import type { Deployment } from '../api/client';

export async function createAppClient(deployment: Deployment) {
  const rpc = createSolanaRpc(new URL('/rpc', window.location.origin).toString());
  if ((await rpc.getGenesisHash().send()) !== deployment.genesisHash)
    throw new Error('Network identity mismatch');
  return createClient()
    .use(
      walletSigner({
        chain: import.meta.env.MODE === 'localnet' ? 'solana:localnet' : 'solana:mainnet',
        autoConnect: true,
        storageKey: `volaryn:wallet:${deployment.genesisHash}:${deployment.programId}`,
      }),
    )
    .use((client) => ({ ...client, rpc }));
}
export type AppClient = Awaited<ReturnType<typeof createAppClient>>;
