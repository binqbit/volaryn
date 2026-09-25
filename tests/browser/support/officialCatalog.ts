import registry from '../../../config/assets.json' with { type: 'json' };
import type { components } from '../../../frontend/src/lib/api/schema';

export function officialCatalog(): components['schemas']['OfficialCatalog'] {
  const policy = registry.assets.find((asset) => asset.symbol === 'SPACEX')!;
  return {
    network: 'solana:mainnet',
    genesisHash: registry.genesisHash,
    source: 'https://prestocks.com/api/prestocks',
    marketSource: { status: 'fresh', receivedAt: policy.reviewedAt, error: null },
    chainSource: { status: 'fresh', receivedAt: policy.reviewedAt, error: null },
    finalizedSlot: '448898437',
    assets: registry.assets.map((policy) => ({
      mint: policy.mint,
      name: policy.name,
      symbol: policy.symbol,
      policy,
      eligibility: 'compatible',
      reason: 'Reviewed transparent transfers. Trading requires a released deployment.',
      market: {
        tokenPrice: '120.6869953806347',
        markPrice: null,
        impliedValuation: null,
        markValuation: null,
        supply: '43712.533765345',
        observedAt: null,
        unitsVerified: false,
      },
      chain: {
        tokenProgram: registry.tokenProgram,
        decimals: policy.decimals,
        supplyRaw: '43712533765345',
        extensions: registry.extensions,
        authorities: { mint: registry.issuerAuthority },
        currentFee: { basisPoints: 100, maximumRaw: '1000000', epoch: '42' },
        nextFee: { basisPoints: 75, maximumRaw: '2000000', epoch: '44' },
        displayMultiplier: '1.5',
        transparentTransferSupported: true,
        restrictions: [
          'Only transparent balances can be delivered',
          'The issuer can mint additional supply',
          ...(policy.symbol === 'SPACEX'
            ? ['The issuer can freeze token accounts and block delivery']
            : []),
        ],
      },
    })),
  };
}
