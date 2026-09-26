import { Chains } from '@chains';
import { Address, TokenAddress } from '@types';
import { Addresses } from '@shared/constants';
import { calculateDeadline, isSameAddress } from '@shared/utils';
import { IQuoteSource, QuoteParams, QuoteSourceMetadata, SourceQuoteResponse, SourceQuoteTransaction, BuildTxParams } from './types';
import { addQuoteSlippage, calculateAllowanceTarget, failed } from './utils';

// Uniswap Trading API — the supported integration path for third parties.
// The web app's routing API (api.uniswap.org) rejects non-Uniswap origins.
// Docs: https://developers.uniswap.org/docs/trading/swapping-api
const TRADING_API_URL = 'https://trade-api.gateway.uniswap.org/v1';
// Versions 2.0 and 2.1.1 stop being supported on 2026-10-21
const UNIVERSAL_ROUTER_VERSION = '2.1.2';
// Same default validity window the previous Uniswap integration used
const DEFAULT_TX_VALID_FOR = '3h';
// UniswapX routings need an off-chain user signature, so only on-chain routings are accepted
const EXECUTABLE_ROUTINGS = ['CLASSIC', 'WRAP', 'UNWRAP'];

const UNISWAP_METADATA: QuoteSourceMetadata<UniswapSupport> = {
  name: 'Uniswap',
  supports: {
    chains: [
      Chains.ETHEREUM.chainId,
      Chains.OPTIMISM.chainId,
      Chains.BNB_CHAIN.chainId,
      Chains.UNICHAIN.chainId,
      Chains.POLYGON.chainId,
      Chains.ZK_SYNC_ERA.chainId,
      Chains.BASE.chainId,
      Chains.ARBITRUM.chainId,
      Chains.CELO.chainId,
      Chains.AVALANCHE.chainId,
      Chains.INK.chainId,
      Chains.LINEA.chainId,
      Chains.BLAST.chainId,
    ],
    swapAndTransfer: true,
    buyOrders: true,
  },
  logoURI: 'ipfs://QmNa3YBYAYS5qSCLuXataV5XCbtxP9ZB4rHUfomRxrpRhJ',
};
type UniswapSupport = { buyOrders: true; swapAndTransfer: true };
type UniswapConfig = { apiKey: string };
type UniswapData = { tx: SourceQuoteTransaction };

export class UniswapQuoteSource implements IQuoteSource<UniswapSupport, UniswapConfig, UniswapData> {
  getMetadata() {
    return UNISWAP_METADATA;
  }

  async quote({
    components: { fetchService },
    request: {
      chainId,
      sellToken,
      buyToken,
      order,
      config: { slippagePercentage, timeout, txValidFor },
      accounts: { takeFrom, recipient },
    },
    config,
  }: QuoteParams<UniswapSupport, UniswapConfig>): Promise<SourceQuoteResponse<UniswapData>> {
    // Permit2 disabled: the swapper may be a contract (e.g. a Permit2 adapter) that cannot sign
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'x-permit2-disabled': 'true',
      'x-universal-router-version': UNIVERSAL_ROUTER_VERSION,
    };

    const quoteResponse = await fetchService.fetch(`${TRADING_API_URL}/quote`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: order.type === 'sell' ? 'EXACT_INPUT' : 'EXACT_OUTPUT',
        amount: (order.type === 'sell' ? order.sellAmount : order.buyAmount).toString(),
        tokenInChainId: chainId,
        tokenOutChainId: chainId,
        tokenIn: mapToTradingApiToken(sellToken),
        tokenOut: mapToTradingApiToken(buyToken),
        swapper: takeFrom,
        recipient: recipient ?? takeFrom,
        slippageTolerance: slippagePercentage,
        routingPreference: 'BEST_PRICE',
        protocols: ['V2', 'V3', 'V4'],
      }),
      timeout,
    });
    if (!quoteResponse.ok) {
      failed(UNISWAP_METADATA, chainId, sellToken, buyToken, await quoteResponse.text());
    }
    const quoteResult = await quoteResponse.json();
    if (!EXECUTABLE_ROUTINGS.includes(quoteResult.routing)) {
      failed(UNISWAP_METADATA, chainId, sellToken, buyToken, `Unsupported routing ${quoteResult.routing}`);
    }

    const swapResponse = await fetchService.fetch(`${TRADING_API_URL}/swap`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ quote: quoteResult.quote, deadline: calculateDeadline(txValidFor ?? DEFAULT_TX_VALID_FOR) }),
      timeout,
    });
    if (!swapResponse.ok) {
      failed(UNISWAP_METADATA, chainId, sellToken, buyToken, await swapResponse.text());
    }
    const { swap } = await swapResponse.json();

    const { input, output, gasUseEstimate } = quoteResult.quote;
    const quote = {
      sellAmount: BigInt(input.amount),
      buyAmount: BigInt(output.amount),
      estimatedGas: gasUseEstimate ? BigInt(gasUseEstimate) : undefined,
      allowanceTarget: calculateAllowanceTarget(sellToken, swap.to as Address),
      customData: {
        tx: {
          to: swap.to,
          calldata: swap.data,
          value: BigInt(swap.value ?? 0),
        },
      },
    };
    return addQuoteSlippage(quote, order.type, slippagePercentage);
  }

  async buildTx({ request }: BuildTxParams<UniswapConfig, UniswapData>): Promise<SourceQuoteTransaction> {
    return request.customData.tx;
  }

  isConfigAndContextValidForQuoting(config: Partial<UniswapConfig> | undefined): config is UniswapConfig {
    return !!config?.apiKey;
  }

  isConfigAndContextValidForTxBuilding(config: Partial<UniswapConfig> | undefined): config is UniswapConfig {
    return true;
  }
}

// The Trading API uses the zero address for the chain's native token
function mapToTradingApiToken(token: TokenAddress): TokenAddress {
  return isSameAddress(token, Addresses.NATIVE_TOKEN) ? Addresses.ZERO_ADDRESS : token;
}
