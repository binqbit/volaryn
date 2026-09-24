import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { VOLARYN_PROGRAM_ADDRESS } from '@volaryn/protocol';
import { fixtureSigners } from '../../../tools/localnet/identity';
import registry from '../../../config/assets.json';
import { validateDeployment, type Deployment, type Wallet } from '../lib/api/client';
import { PositionPanel } from './PositionPanel';
import { AssetIdentity } from './AssetIdentity';
import { AssetSelect } from './AssetSelect';
import { HomePage } from '../pages/HomePage';

let deployment: Deployment;
let wallet: Wallet;
beforeAll(async () => {
  const keys = await fixtureSigners();
  const reference = registry.assets.find((asset) => asset.symbol === 'OPENAI')!;
  deployment = {
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
    assets: [
      {
        mint: keys.underlying.address,
        referenceMint: reference.mint,
        symbol: reference.symbol,
        name: reference.name,
        decimals: 9,
        source: reference.source,
      },
    ],
  };
  wallet = {
    owner: deployment.localnet!.holder,
    accounts: [
      {
        address: deployment.localnet!.holderUsdc,
        mint: deployment.usdcMint,
        amountRaw: '18500001',
        decimals: 6,
        frozen: false,
        finalizedSlot: '42',
        tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      },
      {
        address: keys.holderUnderlying.address,
        mint: keys.underlying.address,
        amountRaw: '3125000000',
        decimals: 9,
        frozen: false,
        finalizedSlot: '42',
        tokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
      },
    ],
  };
});
afterEach(() => vi.unstubAllEnvs());

function productMarkup(connected: boolean) {
  return renderToStaticMarkup(
    h(
      MemoryRouter,
      {},
      h(HomePage),
      h(PositionPanel, {
        deployment,
        owner: connected ? wallet.owner : undefined,
        walletName: 'External wallet',
        wallet: connected ? wallet : undefined,
        status: 'success',
        children: null,
      }),
      h(AssetIdentity, { assets: deployment.assets, mint: deployment.assets[0]!.mint }),
      h(AssetSelect, {
        assets: deployment.assets,
        value: deployment.assets[0]!.mint,
        onChange: () => {},
      }),
    ),
  );
}

describe('local-only presentation', () => {
  it.each([false, true])('production renders neutral product copy (connected: %s)', (connected) => {
    vi.stubEnv('MODE', 'production');
    const html = productMarkup(connected);
    expect(html).not.toMatch(
      /local demo|local test|local replicas|provided test wallet|test wallet [12]|two test wallets|PreStocks demo|test USDC|disposable replica/i,
    );
    expect(html).toContain('OpenAI PreStocks');
    if (connected) {
      expect(html).toContain('Available USDC');
      expect(html).toContain('18.500001');
      expect(html).toContain('Your PreStocks');
      expect(html).toContain('3.125');
    }
  });
  it('localnet identifies test funds and the supplied wallet explicitly', () => {
    vi.stubEnv('MODE', 'localnet');
    const html = productMarkup(true);
    expect(html).toContain('provided test wallet');
    expect(html).toContain('18.500001');
    expect(html).toContain('Available test USDC');
    expect(html).toContain('3.125');
    expect(html).toContain('Local demo');
    expect(productMarkup(false)).toContain('Use two test wallets');
  });
});

describe('deployment and build identity', () => {
  it('only the localnet build accepts fixture deployments', () => {
    expect(validateDeployment(deployment, 'localnet')).toBe(deployment);
    for (const mode of ['production', 'development']) {
      expect(() => validateDeployment(deployment, mode)).toThrow('cannot open this deployment');
    }
  });
  it('does not treat an undeclared external deployment as ready for trading', () => {
    expect(() => validateDeployment({ ...deployment, mode: 'mainnet' }, 'production')).toThrow(
      'cannot open this deployment',
    );
  });
});

it('accepts verified mainnet identities without disposable participants', () => {
  const live: Deployment = {
    ...deployment,
    mode: 'mainnet',
    genesisHash: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
    usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    localnet: undefined,
    assets: deployment.assets.map((asset) => ({ ...asset, mint: asset.referenceMint })),
  };
  expect(validateDeployment(live, 'production')).toBe(live);
  expect(() => validateDeployment(live, 'localnet')).toThrow();
  expect(() =>
    validateDeployment({ ...live, genesisHash: deployment.genesisHash }, 'production'),
  ).toThrow();
  expect(() =>
    validateDeployment({ ...live, usdcMint: deployment.usdcMint }, 'production'),
  ).toThrow();
  expect(() => validateDeployment({ ...live, assets: deployment.assets }, 'production')).toThrow();
});
