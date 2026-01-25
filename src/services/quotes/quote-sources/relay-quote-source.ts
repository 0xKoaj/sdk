import { Chains } from '@chains';
import { IQuoteSource, QuoteParams, QuoteSourceMetadata, SourceQuoteResponse, SourceQuoteTransaction, BuildTxParams } from './types';
import { failed } from './utils';
import { IFetchService } from '@services/fetch';
import { Address, ChainId, TimeString } from '@types';
import { Addresses } from '@shared/constants';
import { isSameAddress } from '@shared/utils';

const RELAY_API_URL = 'https://api.relay.link';

// Chains supported by Relay that exist in the SDK
// Reference: https://api.relay.link/chains
const SUPPORTED_CHAINS = [
  Chains.ETHEREUM,
  Chains.OPTIMISM,
  Chains.CRONOS,
  Chains.BNB_CHAIN,
  Chains.GNOSIS,
  Chains.UNICHAIN,
  Chains.POLYGON,
  Chains.SONIC,
  Chains.BOBA,
  Chains.ZK_SYNC_ERA,
  Chains.METIS_ANDROMEDA,
  Chains.POLYGON_ZKEVM,
  Chains.MANTLE,
  Chains.BASE,
  Chains.ARBITRUM,
  Chains.LINEA,
  Chains.SCROLL,
  Chains.BLAST,
  Chains.MODE,
];

const RELAY_METADATA: QuoteSourceMetadata<RelaySupport> = {
  name: 'Relay',
  supports: {
    chains: SUPPORTED_CHAINS.map(({ chainId }) => chainId),
    swapAndTransfer: true,
    buyOrders: false,
  },
  logoURI: 'ipfs://QmUvZnMTfdK3fzrZdLfMn47UKdKTkVkBD3PqLwDzKKgK2e',
};

type RelayConfig = { apiKey?: string };
type RelaySupport = { buyOrders: false; swapAndTransfer: true };
type RelayData = { tx: SourceQuoteTransaction };

export class RelayQuoteSource implements IQuoteSource<RelaySupport, RelayConfig, RelayData> {
  getMetadata() {
    return RELAY_METADATA;
  }

  async quote({ components, request, config }: QuoteParams<RelaySupport, RelayConfig>): Promise<SourceQuoteResponse<RelayData>> {
    const {
      chainId,
      sellToken,
      buyToken,
      order,
      accounts: { takeFrom, recipient },
      config: { slippagePercentage, timeout },
    } = request;

    const originCurrency = mapToRelayCurrency(sellToken);
    const destinationCurrency = mapToRelayCurrency(buyToken);

    const body = {
      user: takeFrom,
      originChainId: chainId,
      destinationChainId: chainId,
      originCurrency,
      destinationCurrency,
      amount: order.sellAmount.toString(),
      tradeType: 'EXACT_INPUT',
      recipient: recipient ?? takeFrom,
      slippageTolerance: Math.round(slippagePercentage * 100).toString(), // Convert to basis points
    };

    const response = await fetchFromRelay({
      path: '/quote',
      body,
      config,
      fetchService: components.fetchService,
      timeout,
    });

    if (!response.ok) {
      failed(RELAY_METADATA, chainId, sellToken, buyToken, await response.text());
    }

    const data = await response.json();

    // Extract quote details from response
    const { steps, details, fees } = data;

    // Find the transaction step
    const txStep = steps?.find((step: any) => step.kind === 'transaction');
    if (!txStep?.items?.[0]?.data) {
      failed(RELAY_METADATA, chainId, sellToken, buyToken, 'No transaction data in response');
    }

    const txData = txStep.items[0].data;
    const buyAmount = BigInt(details?.currencyOut?.amount ?? '0');

    // Calculate min buy amount with slippage
    const slippageMultiplier = 10000n - BigInt(Math.round(slippagePercentage * 100));
    const minBuyAmount = (buyAmount * slippageMultiplier) / 10000n;

    // Determine allowance target - for native token no approval needed
    const allowanceTarget = isSameAddress(sellToken, Addresses.NATIVE_TOKEN) ? Addresses.ZERO_ADDRESS : (txData.to as Address);

    // Estimate gas from fees if available
    const estimatedGas = fees?.gas?.amount ? BigInt(fees.gas.amount) : undefined;

    return {
      sellAmount: order.sellAmount,
      maxSellAmount: order.sellAmount,
      buyAmount,
      minBuyAmount,
      estimatedGas,
      allowanceTarget,
      type: 'sell',
      customData: {
        tx: {
          to: txData.to,
          calldata: txData.data,
          value: BigInt(txData.value ?? 0),
        },
      },
    };
  }

  async buildTx({ request }: BuildTxParams<RelayConfig, RelayData>): Promise<SourceQuoteTransaction> {
    return request.customData.tx;
  }

  isConfigAndContextValidForQuoting(_config: Partial<RelayConfig> | undefined): _config is RelayConfig {
    // API key is optional
    return true;
  }

  isConfigAndContextValidForTxBuilding(_config: Partial<RelayConfig> | undefined): _config is RelayConfig {
    return true;
  }
}

function mapToRelayCurrency(token: Address): string {
  // Relay uses 0x0000000000000000000000000000000000000000 for native token
  if (isSameAddress(token, Addresses.NATIVE_TOKEN)) {
    return Addresses.ZERO_ADDRESS;
  }
  return token;
}

async function fetchFromRelay({
  path,
  body,
  config,
  fetchService,
  timeout,
}: {
  path: string;
  body: object;
  config: RelayConfig;
  fetchService: IFetchService;
  timeout?: TimeString;
}) {
  const url = `${RELAY_API_URL}${path}`;

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  // Add API key if provided
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  return fetchService.fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    timeout,
  });
}
