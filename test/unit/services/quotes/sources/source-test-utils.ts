import { IFetchService } from '@services/fetch';
import { IProviderService } from '@services/providers';
import { QuoteParams, QuoteSourceSupport } from '@services/quotes/quote-sources/types';
import { Address, ChainId } from '@types';

export type RecordedRequest = { url: string; init?: any };
export type MockResponse = { status?: number; body: unknown };

/**
 * Fetch mock that records every request and answers with the first route whose
 * matcher is contained in the URL.
 */
export function createRecordingFetch(routes: Record<string, MockResponse>) {
  const requests: RecordedRequest[] = [];
  const fetchService: IFetchService = {
    fetch: async (url: any, init?: any) => {
      requests.push({ url: String(url), init });
      const match = Object.keys(routes).find((key) => String(url).includes(key));
      if (!match) throw new Error(`Unexpected request to ${url}`);
      const { status = 200, body } = routes[match];
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
      } as any;
    },
  } as IFetchService;
  return { fetchService, requests };
}

export function createEvmQuoteParams<Support extends QuoteSourceSupport, Config extends object>(params: {
  fetchService: IFetchService;
  config: Config;
  chainId?: ChainId;
  buyTokenChainId?: ChainId;
  sellToken?: Address;
  buyToken?: Address;
  sellAmount?: bigint;
  takeFrom?: Address;
  recipient?: Address;
  slippagePercentage?: number;
}): QuoteParams<Support, Config> {
  const chainId = params.chainId ?? 1;
  return {
    components: {
      providerService: {} as IProviderService,
      fetchService: params.fetchService,
    },
    config: params.config as any,
    request: {
      chainId,
      buyTokenChainId: params.buyTokenChainId ?? chainId,
      sellToken: params.sellToken ?? '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      buyToken: params.buyToken ?? '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      order: { type: 'sell', sellAmount: params.sellAmount ?? 100_000000n },
      config: { slippagePercentage: params.slippagePercentage ?? 1, timeout: '10s' },
      accounts: { takeFrom: params.takeFrom ?? '0xED306e38BB930ec9646FF3D917B2e513a97530b1', recipient: params.recipient },
      external: { tokenData: {} as any, gasPrice: {} as any },
    } as any,
  };
}
