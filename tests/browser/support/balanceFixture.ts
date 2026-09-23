import type { Page } from '@playwright/test';
import { VOLARYN_PROGRAM_ADDRESS, protocolAddresses } from '@volaryn/protocol';
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
    schemaVersion: 2,
    fixtureVersion: 1,
    mode: 'localnet',
    genesisHash: keys.authority.address,
    programId: VOLARYN_PROGRAM_ADDRESS,
    programSha256: '0'.repeat(64),
    programLength: 1,
    authority: keys.authority.address,
    holder: keys.holder.address,
    writer: keys.writer.address,
    usdcMint: keys.usdc.address,
    holderUsdc: keys.holderUsdc.address,
    writerUsdc: keys.writerUsdc.address,
    assets: assets.map(({ asset }) => asset),
  };
  const underlying = assets[0]!;
  const addresses = await protocolAddresses(underlying.mint.address, keys.writer.address, 91n);
  const now = Math.floor(Date.now() / 1000);
  const agreement: Agreement = {
    address: addresses.agreement,
    version: 1,
    writer: deployment.writer,
    holder: null,
    designatedHolder: null,
    underlyingMint: underlying.mint.address,
    underlyingDecimals: 9,
    underlyingProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
    usdcMint: deployment.usdcMint,
    quantityRaw: '1000000000',
    payout: '20000000',
    premium: '500000',
    acceptBefore: String(now + 3600),
    expiresAt: String(now + 7200),
    status: 'funded',
    policyVersion: 1,
    reserve: addresses.reserve,
    reserveAmount: '20000000',
    settlement: addresses.settlement,
    netReceived: '0',
    finalizedSlot: '42',
    observedAt: now,
  };
  const wallets: Record<string, Wallet> = {
    [deployment.writer]: { owner: deployment.writer, accounts: [] },
    [deployment.holder]: { owner: deployment.holder, accounts: [] },
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
    const request = route.request().postDataJSON() as { id: number; method: string };
    const result =
      request.method === 'getGenesisHash'
        ? deployment.genesisHash
        : request.method === 'getSlot'
          ? 42
          : request.method === 'getBlockTime'
            ? Math.floor(Date.now() / 1000)
            : undefined;
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
