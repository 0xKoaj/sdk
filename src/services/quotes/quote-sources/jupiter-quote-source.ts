import qs from 'qs';
import { SolanaChains } from '@chains';
import {
  QuoteParams,
  QuoteSourceMetadata,
  SourceQuoteResponse,
  IQuoteSource,
  SourceQuoteTransaction,
  BuildTxParams,
  SolanaSourceQuoteTransaction,
} from './types';
import { addQuoteSlippage, failed } from './utils';
import { SolanaAddresses } from '@shared/constants';

// Jupiter API Documentation: https://dev.jup.ag/docs/apis/swap-api
const JUPITER_API_URL = 'https://api.jup.ag/swap/v1';

export const JUPITER_METADATA: QuoteSourceMetadata<JupiterSupport> = {
  name: 'Jupiter',
  supports: {
    chains: [SolanaChains.SOLANA.chainId],
    swapAndTransfer: false, // Jupiter supports it but we'll keep it simple for now
    buyOrders: true, // Jupiter supports ExactOut mode
  },
  logoURI: 'ipfs://QmQvfFbLKLxthGKbMihaJCT6cXPrAuYwDgUh3Gf4Mbj9sE',
};

type JupiterSupport = { buyOrders: true; swapAndTransfer: false };
type JupiterConfig = {
  apiKey: string;
  slippageBps?: number;
  onlyDirectRoutes?: boolean;
  maxAccounts?: number;
};

// Jupiter quote response
type JupiterQuoteResponse = {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: 'ExactIn' | 'ExactOut';
  slippageBps: number;
  priceImpactPct: string;
  routePlan: Array<{
    swapInfo: {
      ammKey: string;
      label: string;
      inputMint: string;
      outputMint: string;
      inAmount: string;
      outAmount: string;
      feeAmount: string;
      feeMint: string;
    };
    percent: number;
  }>;
  contextSlot?: number;
  timeTaken?: number;
};

// Jupiter swap response
type JupiterSwapResponse = {
  swapTransaction: string; // Base64 encoded transaction
  lastValidBlockHeight: number;
  prioritizationFeeLamports?: number;
};

type JupiterData = {
  quoteResponse: JupiterQuoteResponse;
  swapTransaction?: string;
  lastValidBlockHeight?: number;
};

export class JupiterQuoteSource implements IQuoteSource<JupiterSupport, JupiterConfig, JupiterData> {
  getMetadata() {
    return JUPITER_METADATA;
  }

  async quote(params: QuoteParams<JupiterSupport, JupiterConfig>): Promise<SourceQuoteResponse<JupiterData>> {
    const {
      components: { fetchService },
      request: {
        chainId,
        sellToken,
        buyToken,
        order,
        config: { slippagePercentage, timeout },
      },
      config,
    } = params;

    // Build query parameters
    const queryParams: Record<string, any> = {
      inputMint: sellToken,
      outputMint: buyToken,
      slippageBps: config.slippageBps ?? Math.round(slippagePercentage * 100), // Convert percentage to basis points
      onlyDirectRoutes: config.onlyDirectRoutes ?? false,
      maxAccounts: config.maxAccounts ?? 64,
    };

    // Handle sell vs buy orders
    if (order.type === 'sell') {
      queryParams.amount = order.sellAmount.toString();
      queryParams.swapMode = 'ExactIn';
    } else {
      queryParams.amount = order.buyAmount.toString();
      queryParams.swapMode = 'ExactOut';
    }

    const queryString = qs.stringify(queryParams, { skipNulls: true });
    const url = `${JUPITER_API_URL}/quote?${queryString}`;

    const response = await fetchService.fetch(url, {
      timeout,
      headers: {
        accept: 'application/json',
        'x-api-key': config.apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      failed(JUPITER_METADATA, chainId, sellToken, buyToken, errorText || `Failed with status ${response.status}`);
    }

    const quoteResponse: JupiterQuoteResponse = await response.json();

    const sellAmount = BigInt(quoteResponse.inAmount);
    const buyAmount = BigInt(quoteResponse.outAmount);

    const quote = {
      sellAmount,
      buyAmount,
      estimatedGas: undefined, // Solana uses compute units, not gas
      allowanceTarget: SolanaAddresses.NATIVE_SOL, // No approval needed on Solana for native swaps
      customData: {
        quoteResponse,
      },
    };

    return addQuoteSlippage(quote, order.type, slippagePercentage);
  }

  async buildTx(params: BuildTxParams<JupiterConfig, JupiterData>): Promise<SourceQuoteTransaction> {
    const {
      components: { fetchService },
      request: {
        chainId,
        sellToken,
        buyToken,
        accounts: { takeFrom },
        customData: { quoteResponse },
        config: { timeout },
      },
      config,
    } = params;

    // Call Jupiter's swap endpoint to get the serialized transaction
    const url = `${JUPITER_API_URL}/swap`;

    const response = await fetchService.fetch(url, {
      method: 'POST',
      timeout,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-api-key': config.apiKey,
      },
      body: JSON.stringify({
        userPublicKey: takeFrom,
        quoteResponse,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      failed(JUPITER_METADATA, chainId, sellToken, buyToken, errorText || `Failed to build swap transaction: ${response.status}`);
    }

    const swapResponse: JupiterSwapResponse = await response.json();

    const tx: SolanaSourceQuoteTransaction = {
      type: 'solana',
      swapTransaction: swapResponse.swapTransaction,
      lastValidBlockHeight: swapResponse.lastValidBlockHeight,
    };

    return tx;
  }

  isConfigAndContextValidForQuoting(config: Partial<JupiterConfig> | undefined): config is JupiterConfig {
    return !!config && !!config.apiKey;
  }

  isConfigAndContextValidForTxBuilding(config: Partial<JupiterConfig> | undefined): config is JupiterConfig {
    return !!config && !!config.apiKey;
  }
}
