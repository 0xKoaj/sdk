import qs from 'qs';
import { Chains } from '@chains';
import { calculateDeadline } from '@shared/utils';
import { AlwaysValidConfigAndContextSource } from './base/always-valid-source';
import { BuildTxParams, QuoteParams, QuoteSourceMetadata, SourceQuoteResponse, SourceQuoteTransaction } from './types';
import { addQuoteSlippage, calculateAllowanceTarget, failed } from './utils';

// ParaSwap rebranded to Velora; api.paraswap.io is deprecated in favour of api.velora.xyz
// Docs: https://www.velora.xyz/docs/api-reference/market/prices
const VELORA_API_URL = 'https://api.velora.xyz';
// Without a partner string Velora falls back to 'anon', which charges 1 bps on every swap
const DEFAULT_PARTNER = 'onlyswaps';

const PARASWAP_METADATA: QuoteSourceMetadata<ParaswapSupport> = {
  name: 'Velora',
  supports: {
    chains: [
      Chains.ETHEREUM.chainId,
      Chains.OPTIMISM.chainId,
      Chains.BNB_CHAIN.chainId,
      Chains.GNOSIS.chainId,
      Chains.UNICHAIN.chainId,
      Chains.POLYGON.chainId,
      Chains.SONIC.chainId,
      Chains.BASE.chainId,
      Chains.ARBITRUM.chainId,
      Chains.AVALANCHE.chainId,
    ],
    swapAndTransfer: true,
    buyOrders: true,
  },
  logoURI: 'ipfs://QmVtj4RwZ5MMfKpbfv8qXksb5WYBJsQXkaZXLq7ipvMNW5',
};
type ParaswapSupport = { buyOrders: true; swapAndTransfer: true };
type ParaswapConfig = { sourceAllowlist?: string[]; sourceDenylist?: string[]; partner?: string };
type ParaswapData = { tx: SourceQuoteTransaction };
export class ParaswapQuoteSource extends AlwaysValidConfigAndContextSource<ParaswapSupport, ParaswapConfig, ParaswapData> {
  getMetadata(): QuoteSourceMetadata<ParaswapSupport> {
    return PARASWAP_METADATA;
  }

  async quote({
    components: { fetchService },
    request: {
      chainId,
      sellToken,
      buyToken,
      order,
      accounts: { takeFrom, recipient },
      config: { timeout, slippagePercentage, txValidFor },
      external,
    },
    config,
  }: QuoteParams<ParaswapSupport, ParaswapConfig>): Promise<SourceQuoteResponse<ParaswapData>> {
    const {
      sellToken: { decimals: srcDecimals },
      buyToken: { decimals: destDecimals },
    } = await external.tokenData.request();
    const partner = config.partner ?? config.referrer?.name ?? DEFAULT_PARTNER;
    const receiver = recipient && recipient.toLowerCase() !== takeFrom.toLowerCase() ? recipient : undefined;

    const pricesQuery = qs.stringify(
      {
        network: chainId,
        srcToken: sellToken,
        destToken: buyToken,
        amount: order.type === 'sell' ? order.sellAmount : order.buyAmount,
        side: order.type.toUpperCase(),
        srcDecimals,
        destDecimals,
        includeDEXS: config.sourceAllowlist,
        excludeDEXS: config.sourceDenylist,
        userAddress: takeFrom,
        receiver,
        partner,
        version: '6.2',
      },
      { skipNulls: true, arrayFormat: 'comma' }
    );
    const pricesResponse = await fetchService.fetch(`${VELORA_API_URL}/prices?${pricesQuery}`, { timeout });
    if (!pricesResponse.ok) {
      failed(PARASWAP_METADATA, chainId, sellToken, buyToken, await pricesResponse.text());
    }
    const { priceRoute } = await pricesResponse.json();

    // ignoreChecks: the taker (e.g. a Permit2 adapter) holds no balance or allowance at quote time
    const transactionResponse = await fetchService.fetch(`${VELORA_API_URL}/transactions/${chainId}?ignoreChecks=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        priceRoute,
        srcToken: sellToken,
        srcDecimals,
        destToken: buyToken,
        destDecimals,
        ...(order.type === 'sell' ? { srcAmount: priceRoute.srcAmount } : { destAmount: priceRoute.destAmount }),
        slippage: Math.round(slippagePercentage * 100),
        userAddress: takeFrom,
        receiver,
        partner,
        partnerAddress: config.referrer?.address,
        deadline: calculateDeadline(txValidFor),
      }),
      timeout,
    });
    if (!transactionResponse.ok) {
      failed(PARASWAP_METADATA, chainId, sellToken, buyToken, await transactionResponse.text());
    }
    const { to, data, value } = await transactionResponse.json();

    const quote = {
      sellAmount: BigInt(priceRoute.srcAmount),
      buyAmount: BigInt(priceRoute.destAmount),
      estimatedGas: priceRoute.gasCost ? BigInt(priceRoute.gasCost) : undefined,
      allowanceTarget: calculateAllowanceTarget(sellToken, priceRoute.tokenTransferProxy),
      customData: {
        tx: {
          to,
          calldata: data,
          value: BigInt(value ?? 0),
        },
      },
    };
    return addQuoteSlippage(quote, order.type, slippagePercentage);
  }

  async buildTx({ request }: BuildTxParams<ParaswapConfig, ParaswapData>): Promise<SourceQuoteTransaction> {
    return request.customData.tx;
  }
}
