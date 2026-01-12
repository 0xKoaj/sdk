import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { JupiterQuoteSource, JUPITER_METADATA } from '@services/quotes/quote-sources/jupiter-quote-source';
import { SolanaChains } from '@chains';
import { IFetchService } from '@services/fetch';
import { IProviderService } from '@services/providers';
import { QuoteParams, BuildTxParams, isSolanaTransaction } from '@services/quotes/quote-sources/types';
import { then, when } from '@test-utils/bdd';
import { SolanaAddresses } from '@shared/constants';

chai.use(chaiAsPromised);

describe('Jupiter Quote Source', () => {
  const jupiterSource = new JupiterQuoteSource();

  describe('Metadata', () => {
    it('should have correct name', () => {
      const metadata = jupiterSource.getMetadata();
      expect(metadata.name).to.equal('Jupiter');
    });

    it('should support Solana chain', () => {
      const metadata = jupiterSource.getMetadata();
      expect(metadata.supports.chains).to.include(SolanaChains.SOLANA.chainId);
    });

    it('should support buy orders', () => {
      const metadata = jupiterSource.getMetadata();
      expect(metadata.supports.buyOrders).to.be.true;
    });

    it('should not support swap and transfer', () => {
      const metadata = jupiterSource.getMetadata();
      expect(metadata.supports.swapAndTransfer).to.be.false;
    });

    it('should have a logo URI', () => {
      const metadata = jupiterSource.getMetadata();
      expect(metadata.logoURI).to.be.a('string').and.not.be.empty;
    });
  });

  describe('Config Validation', () => {
    when('config is undefined', () => {
      then('isConfigAndContextValidForQuoting returns false', () => {
        expect(jupiterSource.isConfigAndContextValidForQuoting(undefined)).to.be.false;
      });

      then('isConfigAndContextValidForTxBuilding returns false', () => {
        expect(jupiterSource.isConfigAndContextValidForTxBuilding(undefined)).to.be.false;
      });
    });

    when('config is empty object', () => {
      then('isConfigAndContextValidForQuoting returns false', () => {
        expect(jupiterSource.isConfigAndContextValidForQuoting({})).to.be.false;
      });
    });

    when('config has apiKey', () => {
      then('isConfigAndContextValidForQuoting returns true', () => {
        expect(jupiterSource.isConfigAndContextValidForQuoting({ apiKey: 'test-api-key' })).to.be.true;
      });

      then('isConfigAndContextValidForTxBuilding returns true', () => {
        expect(jupiterSource.isConfigAndContextValidForTxBuilding({ apiKey: 'test-api-key' })).to.be.true;
      });
    });
  });

  describe('Quote', () => {
    when('API returns successful response for sell order', () => {
      then('returns correct quote response', async () => {
        const mockFetchService = createMockFetchService({
          inputMint: 'So11111111111111111111111111111111111111112',
          inAmount: '1000000000',
          outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          outAmount: '50000000',
          otherAmountThreshold: '49500000',
          swapMode: 'ExactIn',
          slippageBps: 50,
          priceImpactPct: '0.01',
          routePlan: [],
        });

        const params = createQuoteParams({
          fetchService: mockFetchService,
          order: { type: 'sell', sellAmount: 1000000000n },
        });

        const quote = await jupiterSource.quote(params);

        expect(quote.sellAmount).to.equal(1000000000n);
        expect(quote.buyAmount).to.equal(50000000n);
        expect(quote.type).to.equal('sell');
        expect(quote.allowanceTarget).to.equal(SolanaAddresses.NATIVE_SOL);
        expect(quote.customData.quoteResponse).to.exist;
      });
    });

    when('API returns successful response for buy order', () => {
      then('returns correct quote response', async () => {
        const mockFetchService = createMockFetchService({
          inputMint: 'So11111111111111111111111111111111111111112',
          inAmount: '1000000000',
          outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          outAmount: '50000000',
          otherAmountThreshold: '1050000000',
          swapMode: 'ExactOut',
          slippageBps: 50,
          priceImpactPct: '0.01',
          routePlan: [],
        });

        const params = createQuoteParams({
          fetchService: mockFetchService,
          order: { type: 'buy', buyAmount: 50000000n },
        });

        const quote = await jupiterSource.quote(params);

        expect(quote.sellAmount).to.equal(1000000000n);
        expect(quote.buyAmount).to.equal(50000000n);
        expect(quote.type).to.equal('buy');
      });
    });

    when('API returns error', () => {
      then('throws FailedToGenerateQuoteError', async () => {
        const mockFetchService = createMockFetchService(null, { ok: false, status: 400, errorText: 'Bad Request' });

        const params = createQuoteParams({
          fetchService: mockFetchService,
          order: { type: 'sell', sellAmount: 1000000000n },
        });

        await expect(jupiterSource.quote(params)).to.be.rejectedWith(/Bad Request/);
      });
    });
  });

  describe('Build Transaction', () => {
    when('API returns successful swap response', () => {
      then('returns Solana transaction', async () => {
        const mockSwapTransaction = 'base64EncodedTransaction==';
        const mockFetchService = createMockFetchService({
          swapTransaction: mockSwapTransaction,
          lastValidBlockHeight: 12345678,
          prioritizationFeeLamports: 5000,
        });

        const params = createBuildTxParams({
          fetchService: mockFetchService,
        });

        const tx = await jupiterSource.buildTx(params);

        expect(isSolanaTransaction(tx)).to.be.true;
        if (isSolanaTransaction(tx)) {
          expect(tx.type).to.equal('solana');
          expect(tx.swapTransaction).to.equal(mockSwapTransaction);
          expect(tx.lastValidBlockHeight).to.equal(12345678);
        }
      });
    });

    when('API returns error', () => {
      then('throws error', async () => {
        const mockFetchService = createMockFetchService(null, { ok: false, status: 500, errorText: 'Internal Server Error' });

        const params = createBuildTxParams({
          fetchService: mockFetchService,
        });

        await expect(jupiterSource.buildTx(params)).to.be.rejectedWith(/Internal Server Error/);
      });
    });
  });
});

// Helper functions
function createMockFetchService(responseData: any, options: { ok?: boolean; status?: number; errorText?: string } = {}): IFetchService {
  const { ok = true, status = 200, errorText = '' } = options;
  return {
    fetch: async () => ({
      ok,
      status,
      text: async () => errorText,
      json: async () => responseData,
    }),
  } as any;
}

function createQuoteParams(overrides: {
  fetchService: IFetchService;
  order: { type: 'sell'; sellAmount: bigint } | { type: 'buy'; buyAmount: bigint };
}): QuoteParams<{ buyOrders: true; swapAndTransfer: false }, { apiKey: string }> {
  return {
    components: {
      providerService: {} as IProviderService,
      fetchService: overrides.fetchService,
    },
    config: {
      apiKey: 'test-api-key',
    },
    request: {
      chainId: 'solana',
      sellToken: 'So11111111111111111111111111111111111111112',
      buyToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      order: overrides.order,
      config: {
        slippagePercentage: 0.5,
        timeout: '30s',
      },
      accounts: {
        takeFrom: 'GsbwXfJraMomNxBcjcLJqDGmCJkz7eUUeqmNQWf4wE7p',
      },
      external: {
        tokenData: {} as any,
        gasPrice: {} as any,
      },
    },
  };
}

function createBuildTxParams(overrides: { fetchService: IFetchService }): BuildTxParams<{ apiKey: string }, { quoteResponse: any }> {
  return {
    components: {
      providerService: {} as IProviderService,
      fetchService: overrides.fetchService,
    },
    config: {
      apiKey: 'test-api-key',
    },
    request: {
      chainId: 'solana',
      sellToken: 'So11111111111111111111111111111111111111112',
      buyToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      type: 'sell',
      sellAmount: 1000000000n,
      maxSellAmount: 1000000000n,
      buyAmount: 50000000n,
      minBuyAmount: 49500000n,
      accounts: {
        takeFrom: 'GsbwXfJraMomNxBcjcLJqDGmCJkz7eUUeqmNQWf4wE7p',
        recipient: 'GsbwXfJraMomNxBcjcLJqDGmCJkz7eUUeqmNQWf4wE7p',
      },
      customData: {
        quoteResponse: {
          inputMint: 'So11111111111111111111111111111111111111112',
          outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          inAmount: '1000000000',
          outAmount: '50000000',
          routePlan: [],
        },
      },
      config: {
        timeout: '30s',
      },
    },
  };
}
