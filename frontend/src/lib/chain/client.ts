import { createClient, createSolanaRpc } from '@solana/kit';
import { walletSigner } from '@solana/kit-plugin-wallet';

export function createAppClient() {
  const rpc = createSolanaRpc(new URL('/rpc', window.location.origin).toString());
  return createClient()
    .use(walletSigner({ chain: 'solana:localnet', autoConnect: false }))
    .use((client) => ({ ...client, rpc }));
}
export type AppClient = ReturnType<typeof createAppClient>;
