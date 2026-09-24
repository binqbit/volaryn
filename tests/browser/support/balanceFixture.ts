import type { Page } from '@playwright/test';
import { address, getBase64Decoder } from '@solana/kit';
import { TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import {
  findPolicyPda,
  getAssetPolicyEncoder,
  VOLARYN_PROGRAM_ADDRESS,
  protocolAddresses,
} from '@volaryn/protocol';
import type {
  Agreement,
  Deployment,
  TokenAccount,
  Wallet,
} from '../../../frontend/src/lib/api/client';
import { fixtureSigners } from '../../../tools/localnet/identity';
import { fixtureAssets } from '../../../tools/localnet/assets';

/** Presentation fixtures only: no validator, signing, or external API requests. */
export async function balanceFixture(page: Page) {
  const keys = await fixtureSigners();
  const assets = await fixtureAssets();
  const deployment: Deployment = {
    schemaVersion: 3,
    mode: 'localnet',
    genesisHash: keys.authority.address,
    programId: VOLARYN_PROGRAM_ADDRESS,
    programSha256: '0'.repeat(64),
    programLength: 1,
    authority: keys.authority.address,
    upgradeAuthority: keys.authority.address,
    usdcMint: keys.usdc.address,
    localnet: {
      fixtureVersion: 1,
      holder: keys.holder.address,
      writer: keys.writer.address,
      holderUsdc: keys.holderUsdc.address,
      writerUsdc: keys.writerUsdc.address,
    },
    assets: assets.map(({ asset }) => asset),
  };
  const underlying = assets[0]!;
  const addresses = await protocolAddresses(underlying.mint.address, keys.writer.address, 91n);
  const now = Math.floor(Date.now() / 1000);
  const policies = new Map(
    await Promise.all(
      deployment.assets.map(async (asset) => {
        const mint = address(asset.mint);
        const [policyAddress] = await findPolicyPda({ mint });
        const encoded = getBase64Decoder().decode(
          getAssetPolicyEncoder().encode({
            mint,
            tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
            decimals: asset.decimals,
            version: 1,
            enabled: true,
            reviewedUntil: 9_223_372_036_854_775_807n,
            maxExpiry: 9_223_372_036_854_775_807n,
          }),
        );
        return [policyAddress as string, encoded] as const;
      }),
    ),
  );
  const agreement: Agreement = {
    address: addresses.agreement,
    version: 2,
    creator: deployment.localnet!.writer,
    side: 'writer',
    writer: deployment.localnet!.writer,
    holder: null,
    designatedCounterparty: null,
    underlyingMint: underlying.mint.address,
    underlyingDecimals: 9,
    underlyingProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
    usdcMint: deployment.usdcMint,
    quantityRaw: '1000000000',
    payout: '20000000',
    premium: '500000',
    acceptBefore: String(now + 3600),
    expiresAt: String(now + 7200),
    status: 'open',
    policyVersion: 1,
    reserve: addresses.reserve,
    reserveAmount: '20000000',
    settlement: addresses.settlement,
    netReceived: '0',
    finalizedSlot: '42',
    observedAt: now,
  };
  const wallets: Record<string, Wallet> = {
    [deployment.localnet!.writer]: { owner: deployment.localnet!.writer, accounts: [] },
    [deployment.localnet!.holder]: { owner: deployment.localnet!.holder, accounts: [] },
  };
  const state = {
    deployment,
    agreement,
    wallets,
    walletUnavailable: false,
    walletDelay: Promise.resolve(),
    offers: [] as Agreement[],
    portfolioDelay: Promise.resolve(),
    unexpected: [] as string[],
  };
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/config') return route.fulfill({ json: deployment });
    if (url.pathname === '/api/activity')
      return route.fulfill({ json: { items: [], pending: [], indexedAgreements: [], next: null } });
    if (url.pathname === '/api/wallet') {
      await state.walletDelay;
      if (state.walletUnavailable)
        return route.fulfill({ status: 503, json: { error: 'unavailable' } });
      return route.fulfill({ json: wallets[url.searchParams.get('owner')!] });
    }
    if (url.pathname.startsWith('/api/agreements/'))
      return route.fulfill({ json: state.agreement });
    if (url.pathname === '/api/offers' || url.pathname === '/api/agreements') {
      await state.portfolioDelay;
      return route.fulfill({ json: state.offers });
    }
    state.unexpected.push(url.pathname);
    await route.fulfill({ status: 404 });
  });
  await page.route('**/rpc', async (route) => {
    const request = route.request().postDataJSON() as {
      id: number;
      method: string;
      params?: unknown[];
    };
    const result = (() => {
      switch (request.method) {
        case 'getGenesisHash':
          return deployment.genesisHash;
        case 'getSlot':
          return 42;
        case 'getBlockTime':
          return Math.floor(Date.now() / 1000);
        case 'getAccountInfo': {
          const encoded = policies.get(String(request.params?.[0]));
          if (!encoded) return undefined;
          return {
            context: { slot: 42 },
            value: {
              data: [encoded, 'base64'],
              executable: false,
              lamports: 1,
              owner: VOLARYN_PROGRAM_ADDRESS,
              rentEpoch: 0,
              space: 94,
            },
          };
        }
        default:
          return undefined;
      }
    })();
    if (result === undefined) state.unexpected.push(request.method);
    await route.fulfill({
      json: {
        jsonrpc: '2.0',
        id: request.id,
        ...(result === undefined
          ? { error: { code: -32601, message: 'Signing is forbidden in a presentation test' } }
          : { result }),
      },
    });
  });
  function account(mint: string, address: string, raw: string, frozen = false): TokenAccount {
    const decimals =
      mint === deployment.usdcMint
        ? 6
        : deployment.assets.find((asset) => asset.mint === mint)!.decimals;
    return {
      address,
      mint,
      amountRaw: raw,
      frozen,
      decimals,
      finalizedSlot: '42',
      tokenProgram:
        mint === deployment.usdcMint
          ? 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
          : agreement.underlyingProgram,
    };
  }
  return { state, account };
}
