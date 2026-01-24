import { Chains } from '@chains';
import { Addresses } from '@shared/constants';
import { isSameAddress } from '@shared/utils';
import { Address, ChainId } from '@types';
import { AlwaysValidConfigAndContextSource } from './base/always-valid-source';
import { BuildTxParams, QuoteParams, QuoteSourceMetadata, SourceQuoteResponse, SourceQuoteTransaction } from './types';
import { addQuoteSlippage, calculateAllowanceTarget, failed } from './utils';

// Nordstern supports 140+ EVM chains. We include all EVM chains available in the SDK.
const SUPPORTED_CHAINS: ChainId[] = [
  Chains.ETHEREUM.chainId,
  Chains.OPTIMISM.chainId,
  Chains.ARBITRUM.chainId,
  Chains.ARBITRUM_NOVA.chainId,
  Chains.POLYGON.chainId,
  Chains.BNB_CHAIN.chainId,
  Chains.BASE.chainId,
  Chains.FANTOM.chainId,
  Chains.CELO.chainId,
  Chains.METIS_ANDROMEDA.chainId,
  Chains.AVALANCHE.chainId,
  Chains.HECO.chainId,
  Chains.OKC.chainId,
  Chains.MOONRIVER.chainId,
  Chains.MOONBEAM.chainId,
  Chains.FUSE.chainId,
  Chains.VELAS.chainId,
  Chains.GNOSIS.chainId,
  Chains.CRONOS.chainId,
  Chains.BOBA.chainId,
  Chains.ONTOLOGY.chainId,
  Chains.KAIA.chainId,
  Chains.AURORA.chainId,
  Chains.ASTAR.chainId,
  Chains.HARMONY_SHARD_0.chainId,
  Chains.BIT_TORRENT.chainId,
  Chains.OASIS_EMERALD.chainId,
  Chains.opBNB.chainId,
  Chains.CANTO.chainId,
  Chains.EVMOS.chainId,
  Chains.ROOTSTOCK.chainId,
  Chains.POLYGON_ZKEVM.chainId,
  Chains.KAVA.chainId,
  Chains.LINEA.chainId,
  Chains.MODE.chainId,
  Chains.BLAST.chainId,
  Chains.SCROLL.chainId,
  Chains.MANTLE.chainId,
  Chains.SONIC.chainId,
  Chains.ZK_SYNC_ERA.chainId,
  Chains.PLASMA.chainId,
  Chains.UNICHAIN.chainId,
];

const NORDSTERN_METADATA: QuoteSourceMetadata<NordsternSupport> = {
  name: 'Nordstern',
  supports: {
    chains: SUPPORTED_CHAINS,
    swapAndTransfer: false,
    buyOrders: false,
  },
  logoURI: 'ipfs://bafkreigxqxccuhlipozzz2h66xftkfl2dvkyfq53bszw3lfg34weuoa3dq', // TODO: Update with actual Nordstern logo
};

type NordsternSupport = { buyOrders: false; swapAndTransfer: false };
type NordsternConfig = {};
type NordsternData = {
  tx: NordsternTx;
};

export class NordsternQuoteSource extends AlwaysValidConfigAndContextSource<NordsternSupport, NordsternConfig, NordsternData> {
  getMetadata() {
    return NORDSTERN_METADATA;
  }

  async quote({
    components: { fetchService },
    request: {
      chainId,
      sellToken,
      buyToken,
      order,
      accounts: { takeFrom },
      config: { slippagePercentage, timeout },
    },
    config,
  }: QuoteParams<NordsternSupport>): Promise<SourceQuoteResponse<NordsternData>> {
    const queryParams = new URLSearchParams({
      src: sellToken,
      dst: buyToken,
      amount: order.sellAmount.toString(),
      from: takeFrom,
      slippage: (slippagePercentage * 100).toString(), // Convert to basis points
    });

    // Add referrer fee if configured
    if (config.referrer?.address) {
      queryParams.set('convenienceFeeRecipient', config.referrer.address);
    }

    const url = `https://api.nordstern.finance/aggregator/${chainId}?${queryParams.toString()}`;

    const response = await fetchService.fetch(url, { timeout });
    if (!response.ok) {
      failed(NORDSTERN_METADATA, chainId, sellToken, buyToken, await response.text());
    }

    const data: NordsternResponse = await response.json();

    if (!data.tx || !data.toAmount) {
      failed(NORDSTERN_METADATA, chainId, sellToken, buyToken, 'Invalid response from Nordstern API');
    }

    const quote = {
      sellAmount: order.sellAmount,
      buyAmount: BigInt(data.toAmount),
      estimatedGas: data.tx.gas ? BigInt(data.tx.gas) : undefined,
      allowanceTarget: calculateAllowanceTarget(sellToken, data.tx.to),
      customData: { tx: data.tx },
    };

    return addQuoteSlippage(quote, order.type, slippagePercentage);
  }

  async buildTx({
    request: {
      sellToken,
      sellAmount,
      customData: { tx },
    },
  }: BuildTxParams<NordsternConfig, NordsternData>): Promise<SourceQuoteTransaction> {
    const value = isSameAddress(sellToken, Addresses.NATIVE_TOKEN) ? sellAmount : 0n;

    return {
      to: tx.to,
      calldata: tx.data,
      value: tx.value ? BigInt(tx.value) : value,
    };
  }
}

type NordsternTx = {
  data: string;
  from: Address;
  to: Address;
  value?: string;
  gas?: string;
};

type NordsternResponse = {
  src: Address;
  dst: Address;
  fromAmount: string;
  toAmount: string;
  swaps: unknown[];
  tx: NordsternTx;
};
