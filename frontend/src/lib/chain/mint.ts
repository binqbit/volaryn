import { isSome, unwrapOption } from '@solana/kit';
import { extension, getTokenSize, type ExtensionArgs, type Mint } from '@solana-program/token-2022';

export function transferFee(amount: bigint, basisPoints: number, maximum: bigint) {
  const fee = (amount * BigInt(basisPoints) + 9999n) / 10000n;
  return fee < maximum ? fee : maximum;
}

/** Mirror the contract's admitted extensions; settlement remains authoritative on chain. */
export function mintTerms(mint: Mint, quantity: bigint, epoch: bigint) {
  const extensions = unwrapOption(mint.extensions) ?? [];
  const allowed = [
    'TransferFeeConfig',
    'ScaledUiAmountConfig',
    'PausableConfig',
    'PermanentDelegate',
  ];
  if (extensions.some((item) => !allowed.includes(item.__kind)))
    throw new Error('This mint has unsupported transfer extensions');
  if (!mint.isInitialized || mint.decimals !== 6)
    throw new Error('Unsupported asset precision or mint state');
  const restrictions: string[] = [];
  if (isSome(mint.freezeAuthority))
    restrictions.push('The issuer can freeze token accounts and block delivery.');
  const pause = extensions.find((item) => item.__kind === 'PausableConfig');
  if (pause) {
    restrictions.push('The issuer can pause transfers.');
    if (pause.paused) throw new Error('Issuer transfers are paused');
  }
  if (extensions.some((item) => item.__kind === 'PermanentDelegate'))
    restrictions.push('The issuer has a permanent delegate that can transfer or burn holdings.');
  if (extensions.some((item) => item.__kind === 'ScaledUiAmountConfig'))
    restrictions.push('Display scaling does not change the raw-token quantity owed.');
  const config = extensions.find((item) => item.__kind === 'TransferFeeConfig');
  const fee =
    config &&
    (epoch >= config.newerTransferFee.epoch ? config.newerTransferFee : config.olderTransferFee);
  const withheld = fee ? transferFee(quantity, fee.transferFeeBasisPoints, fee.maximumFee) : 0n;
  const required: ExtensionArgs[] = [];
  if (config) {
    required.push(extension('TransferFeeAmount', { withheldAmount: 0n }));
    restrictions.push(
      'Issuer fees can change before exercise; the gross obligation and USDC payout stay fixed.',
    );
  }
  if (pause) required.push(extension('PausableAccount', {}));
  return {
    issuerFee: withheld,
    netReceipt: quantity - withheld,
    accountSize: getTokenSize(required),
    restrictions,
  };
}
