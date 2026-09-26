import qs from 'qs';
import { Chains } from '@chains';
import { ChainId } from '@types';
import { IQuoteSource, QuoteParams, QuoteSourceMetadata, SourceQuoteResponse, SourceQuoteTransaction, BuildTxParams } from './types';
import { addQuoteSlippage, calculateAllowanceTarget, failed } from './utils';

// Native RFQ firm quotes. The Native Router pulls funds from whoever calls it and pays out to
// `from_address`, so quotes are not bound to the end user's wallet.
// Docs: https://docs.native.org/native-dev/build-with-native/swap-aggregators/firmquote-swap-apis/get-firm-quote
const NATIVE_API_URL = 'https://v2.api.native.org/swap-api-v2/v1';
// Recommended by Native to avoid quoting errors
const QUOTE_EXPIRY_SECONDS = 60;

// Standardised chain names: https://docs.native.org/native-dev/resources/networks
const CHAIN_NAMES: Record<ChainId, string> = {
  [Chains.ETHEREUM.chainId]: 'ethereum',
  [Chains.BNB_CHAIN.chainId]: 'bsc',
  [Chains.ARBITRUM.chainId]: 'arbitrum',
  [Chains.BASE.chainId]: 'base',
};

const NATIVE_METADATA: QuoteSourceMetadata<NativeSupport> = {
  name: 'Native',
  supports: {
    chains: Object.keys(CHAIN_NAMES).map(Number),
    swapAndTransfer: true,
    buyOrders: false,
  },
  logoURI: 'https://native.org/favicon.ico',
};
type NativeSupport = { buyOrders: false; swapAndTransfer: true };
type NativeConfig = { apiKey: string };
type NativeData = { tx: SourceQuoteTransaction };

export class NativeQuoteSource implements IQuoteSource<NativeSupport, NativeConfig, NativeData> {
  getMetadata() {
    return NATIVE_METADATA;
  }

  async quote({
    components: { fetchService },
    request: {
      chainId,
      sellToken,
      buyToken,
      order,
      accounts: { takeFrom, recipient },
      config: { slippagePercentage, timeout },
    },
    config,
  }: QuoteParams<NativeSupport, NativeConfig>): Promise<SourceQuoteResponse<NativeData>> {
    const chain = CHAIN_NAMES[chainId];
    const payoutAddress = recipient ?? takeFrom;
    const queryString = qs.stringify({
      src_chain: chain,
      dst_chain: chain,
      token_in: sellToken,
      token_out: buyToken,
      amount_wei: order.sellAmount.toString(),
      from_address: payoutAddress,
      beneficiary_address: payoutAddress,
      expiry_time: QUOTE_EXPIRY_SECONDS,
      slippage: slippagePercentage,
      version: 6,
      allow_multihop: true,
    });

    const response = await fetchService.fetch(`${NATIVE_API_URL}/firm-quote?${queryString}`, {
      headers: { apiKey: config.apiKey },
      timeout,
    });
    if (!response.ok) {
      failed(NATIVE_METADATA, chainId, sellToken, buyToken, await response.text());
    }
    const result = await response.json();
    // Errors (e.g. invalid key) come back as HTTP 200 with { code, message }
    if (result.success === false || !result.txRequest || !result.amountOut) {
      failed(NATIVE_METADATA, chainId, sellToken, buyToken, result.errorMessage || result.message || 'No firm quote');
    }

    const { target, calldata, value } = result.txRequest;
    const quote = {
      sellAmount: order.sellAmount,
      buyAmount: BigInt(result.amountOut),
      allowanceTarget: calculateAllowanceTarget(sellToken, target),
      customData: {
        tx: {
          to: target,
          calldata,
          value: BigInt(value ?? 0),
        },
      },
    };
    return addQuoteSlippage(quote, order.type, slippagePercentage);
  }

  async buildTx({ request }: BuildTxParams<NativeConfig, NativeData>): Promise<SourceQuoteTransaction> {
    return request.customData.tx;
  }

  isConfigAndContextValidForQuoting(config: Partial<NativeConfig> | undefined): config is NativeConfig {
    return !!config?.apiKey;
  }

  isConfigAndContextValidForTxBuilding(config: Partial<NativeConfig> | undefined): config is NativeConfig {
    return true;
  }
}
