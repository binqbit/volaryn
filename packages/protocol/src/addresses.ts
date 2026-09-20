import {
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  getU64Encoder,
  type Address,
} from '@solana/kit';
import { VOLARYN_PROGRAM_ADDRESS } from './generated';

const text = new TextEncoder();
const encode = getAddressEncoder();

export async function protocolAddresses(mint: Address, writer: Address, nonce: bigint) {
  const pda = async (seeds: readonly Uint8Array[]) =>
    (
      await getProgramDerivedAddress({ programAddress: VOLARYN_PROGRAM_ADDRESS, seeds: [...seeds] })
    )[0];
  const agreement = await pda([
    text.encode('agreement'),
    new Uint8Array(encode.encode(writer)),
    new Uint8Array(getU64Encoder().encode(nonce)),
  ]);
  return {
    config: await pda([text.encode('config')]),
    policy: await pda([text.encode('policy'), new Uint8Array(encode.encode(mint))]),
    agreement,
    reserve: await pda([text.encode('reserve'), new Uint8Array(encode.encode(agreement))]),
    settlement: await pda([text.encode('settlement'), new Uint8Array(encode.encode(agreement))]),
    programData: (
      await getProgramDerivedAddress({
        programAddress: address('BPFLoaderUpgradeab1e11111111111111111111111'),
        seeds: [encode.encode(VOLARYN_PROGRAM_ADDRESS)],
      })
    )[0],
  };
}
