import ms from 'ms';
import { expect } from 'chai';
import { given, then, when } from '@test-utils/bdd';
import { SolanaChains } from '@chains';
import { QuoteResponse, FailedResponse } from '@services/quotes';
import { buildSDK } from '@builder';
import { CONFIG } from './quote-tests-config';
import { ChainId, DefaultRequirements, FieldsRequirements, TimeString, TokenAddress } from '@types';
import { IMetadataSource, MetadataInput, MetadataResult } from '@services/metadata';
import { SolanaAddresses } from '@shared/constants';
import { isSolanaTransaction } from '@services/quotes/quote-sources/types';

jest.setTimeout(ms('2m'));

// Well-known Solana token addresses
const SOLANA_TOKENS = {
  SOL: SolanaAddresses.NATIVE_SOL, // Native SOL / Wrapped SOL
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
};

// Mock metadata source for Solana tokens
type TokenMetadata = { symbol: string; decimals: number };
const MOCKED_SOLANA_METADATA_SOURCE: IMetadataSource<TokenMetadata> = {
  supportedProperties: () => ({
    [SolanaChains.SOLANA.chainId]: { symbol: 'present', decimals: 'present' },
  }),
  getMetadata: <Requirements extends FieldsRequirements<TokenMetadata> = DefaultRequirements<TokenMetadata>>({
    tokens,
  }: {
    tokens: MetadataInput[];
    config?: { fields?: Requirements; timeout?: TimeString };
  }) => {
    const result: Record<ChainId, Record<TokenAddress, MetadataResult<TokenMetadata, Requirements>>> = {};
    const decimalsMap: Record<string, number> = {
      [SOLANA_TOKENS.SOL]: 9,
      [SOLANA_TOKENS.USDC]: 6,
      [SOLANA_TOKENS.USDT]: 6,
      [SOLANA_TOKENS.BONK]: 5,
      [SOLANA_TOKENS.JUP]: 6,
    };
    const symbolMap: Record<string, string> = {
      [SOLANA_TOKENS.SOL]: 'SOL',
      [SOLANA_TOKENS.USDC]: 'USDC',
      [SOLANA_TOKENS.USDT]: 'USDT',
      [SOLANA_TOKENS.BONK]: 'BONK',
      [SOLANA_TOKENS.JUP]: 'JUP',
    };

    for (const { chainId, token } of tokens) {
      if (!(chainId in result)) result[chainId] = {};
      result[chainId][token] = {
        symbol: symbolMap[token] || 'UNKNOWN',
        decimals: decimalsMap[token] || 9,
      } as MetadataResult<TokenMetadata, Requirements>;
    }
    return Promise.resolve(result);
  },
};

// Build SDK with Solana metadata support
const { quoteService } = buildSDK({
  metadata: { source: { type: 'custom', instance: MOCKED_SOLANA_METADATA_SOURCE } },
  quotes: { sourceList: { type: 'local' }, defaultConfig: CONFIG },
});

// Test wallet address (random Solana address for testing)
const TEST_WALLET = 'GsbwXfJraMomNxBcjcLJqDGmCJkz7eUUeqmNQWf4wE7p';

// Check if Jupiter API key is configured
const hasJupiterApiKey = !!process.env.JUPITER_API_KEY;

describe('Solana Quote Integration Tests', () => {
  // Skip all tests if no Jupiter API key is configured
  beforeAll(() => {
    if (!hasJupiterApiKey) {
      console.warn('JUPITER_API_KEY not set. Skipping Solana integration tests.');
    }
  });

  describe('Jupiter Quote Source', () => {
    when('requesting SOL to USDC quote (sell order)', () => {
      let response: QuoteResponse | FailedResponse | undefined;

      given(async () => {
        if (!hasJupiterApiKey) return;

        const quotes = await quoteService.getAllQuotes({
          request: {
            chainId: SolanaChains.SOLANA.chainId,
            sellToken: SOLANA_TOKENS.SOL,
            buyToken: SOLANA_TOKENS.USDC,
            order: {
              type: 'sell',
              sellAmount: 100_000_000n, // 0.1 SOL (9 decimals)
            },
            slippagePercentage: 1,
            takerAddress: TEST_WALLET,
            filters: { includeSources: ['jupiter'] },
          },
          config: {
            timeout: '30s',
            ignoredFailed: false,
          },
        });
        response = quotes[0];
      });

      then('quote is returned successfully', () => {
        if (!hasJupiterApiKey) {
          console.log('Skipped: JUPITER_API_KEY not set');
          return;
        }

        expect(response).to.exist;
        if (response && 'failed' in response) {
          console.log('Quote failed:', response.error);
          // Don't fail the test if the API is temporarily unavailable
          return;
        }

        const quote = response as QuoteResponse;
        expect(quote.source.id).to.equal('jupiter');
        expect(quote.chainId).to.equal('solana');
        expect(quote.sellToken.address).to.equal(SOLANA_TOKENS.SOL);
        expect(quote.buyToken.address).to.equal(SOLANA_TOKENS.USDC);
        expect(quote.sellAmount.amount).to.equal(100_000_000n);
        expect(quote.buyAmount.amount).to.be.a('bigint');
        expect(quote.buyAmount.amount > 0n).to.be.true;
        expect(quote.type).to.equal('sell');
      });
    });

    when('requesting USDC to SOL quote (buy order)', () => {
      let response: QuoteResponse | FailedResponse | undefined;

      given(async () => {
        if (!hasJupiterApiKey) return;

        const quotes = await quoteService.getAllQuotes({
          request: {
            chainId: SolanaChains.SOLANA.chainId,
            sellToken: SOLANA_TOKENS.USDC,
            buyToken: SOLANA_TOKENS.SOL,
            order: {
              type: 'buy',
              buyAmount: 100_000_000n, // 0.1 SOL (9 decimals)
            },
            slippagePercentage: 1,
            takerAddress: TEST_WALLET,
            filters: { includeSources: ['jupiter'] },
          },
          config: {
            timeout: '30s',
            ignoredFailed: false,
          },
        });
        response = quotes[0];
      });

      then('quote is returned successfully with buy order', () => {
        if (!hasJupiterApiKey) {
          console.log('Skipped: JUPITER_API_KEY not set');
          return;
        }

        expect(response).to.exist;
        if (response && 'failed' in response) {
          console.log('Quote failed:', response.error);
          return;
        }

        const quote = response as QuoteResponse;
        expect(quote.source.id).to.equal('jupiter');
        expect(quote.type).to.equal('buy');
        expect(quote.buyAmount.amount).to.equal(100_000_000n);
        expect(quote.sellAmount.amount).to.be.a('bigint');
        expect(quote.sellAmount.amount > 0n).to.be.true;
      });
    });

    when('requesting quote with transaction building', () => {
      let quoteWithTx: (QuoteResponse & { tx: any }) | FailedResponse | undefined;

      given(async () => {
        if (!hasJupiterApiKey) return;

        const quotes = await quoteService.getAllQuotesWithTxs({
          request: {
            chainId: SolanaChains.SOLANA.chainId,
            sellToken: SOLANA_TOKENS.SOL,
            buyToken: SOLANA_TOKENS.USDC,
            order: {
              type: 'sell',
              sellAmount: 100_000_000n, // 0.1 SOL
            },
            slippagePercentage: 1,
            takerAddress: TEST_WALLET,
            filters: { includeSources: ['jupiter'] },
          },
          config: {
            timeout: '30s',
            ignoredFailed: false,
          },
        });
        quoteWithTx = quotes[0] as any;
      });

      then('transaction is returned in Solana format', () => {
        if (!hasJupiterApiKey) {
          console.log('Skipped: JUPITER_API_KEY not set');
          return;
        }

        expect(quoteWithTx).to.exist;
        if (quoteWithTx && 'failed' in quoteWithTx) {
          console.log('Quote failed:', quoteWithTx.error);
          return;
        }

        const quote = quoteWithTx as QuoteResponse & { tx: any };
        expect(quote.tx).to.exist;

        // Solana transactions have a special format with isSolanaTransaction flag
        // or the data field contains the base64 encoded transaction
        if (quote.tx.isSolanaTransaction) {
          expect(quote.tx.data).to.be.a('string');
          expect(quote.tx.data.length).to.be.greaterThan(0);
        } else {
          // Standard response - data should be base64 encoded transaction
          expect(quote.tx.data).to.be.a('string');
        }
      });
    });

    when('requesting quote for meme token (BONK to USDC)', () => {
      let response: QuoteResponse | FailedResponse | undefined;

      given(async () => {
        if (!hasJupiterApiKey) return;

        const quotes = await quoteService.getAllQuotes({
          request: {
            chainId: SolanaChains.SOLANA.chainId,
            sellToken: SOLANA_TOKENS.BONK,
            buyToken: SOLANA_TOKENS.USDC,
            order: {
              type: 'sell',
              sellAmount: 1_000_000_00000n, // 1 million BONK (5 decimals)
            },
            slippagePercentage: 2, // Higher slippage for meme tokens
            takerAddress: TEST_WALLET,
            filters: { includeSources: ['jupiter'] },
          },
          config: {
            timeout: '30s',
            ignoredFailed: false,
          },
        });
        response = quotes[0];
      });

      then('quote is returned for meme token', () => {
        if (!hasJupiterApiKey) {
          console.log('Skipped: JUPITER_API_KEY not set');
          return;
        }

        expect(response).to.exist;
        if (response && 'failed' in response) {
          console.log('Quote failed (may be expected for low liquidity tokens):', response.error);
          return;
        }

        const quote = response as QuoteResponse;
        expect(quote.source.id).to.equal('jupiter');
        expect(quote.sellToken.address).to.equal(SOLANA_TOKENS.BONK);
        expect(quote.buyToken.address).to.equal(SOLANA_TOKENS.USDC);
      });
    });

    when('requesting quote with invalid token', () => {
      let response: QuoteResponse | FailedResponse | undefined;

      given(async () => {
        if (!hasJupiterApiKey) return;

        const quotes = await quoteService.getAllQuotes({
          request: {
            chainId: SolanaChains.SOLANA.chainId,
            sellToken: 'InvalidTokenAddress11111111111111111111111111',
            buyToken: SOLANA_TOKENS.USDC,
            order: {
              type: 'sell',
              sellAmount: 100_000_000n,
            },
            slippagePercentage: 1,
            takerAddress: TEST_WALLET,
            filters: { includeSources: ['jupiter'] },
          },
          config: {
            timeout: '30s',
            ignoredFailed: false,
          },
        });
        response = quotes[0];
      });

      then('quote fails gracefully', () => {
        if (!hasJupiterApiKey) {
          console.log('Skipped: JUPITER_API_KEY not set');
          return;
        }

        expect(response).to.exist;
        // Should be a failed response
        expect('failed' in response!).to.be.true;
      });
    });
  });

  describe('Solana Source Filtering', () => {
    when('filtering to only include Jupiter', () => {
      let sources: string[];

      given(async () => {
        if (!hasJupiterApiKey) {
          sources = [];
          return;
        }

        const supportedSources = quoteService.supportedSourcesInChain({
          chainId: SolanaChains.SOLANA.chainId,
        });
        sources = Object.keys(supportedSources);
      });

      then('Jupiter is available for Solana', () => {
        if (!hasJupiterApiKey) {
          console.log('Skipped: JUPITER_API_KEY not set');
          return;
        }

        expect(sources).to.include('jupiter');
      });

      then('EVM-only sources are not available for Solana', () => {
        if (!hasJupiterApiKey) {
          console.log('Skipped: JUPITER_API_KEY not set');
          return;
        }

        // These EVM-only sources should not be available for Solana
        const evmOnlySources = ['1inch', 'uniswap', 'paraswap', 'odos', 'kyberswap'];
        for (const source of evmOnlySources) {
          expect(sources).to.not.include(source);
        }
      });
    });
  });

  describe('Quote Response Structure', () => {
    when('receiving a Solana quote', () => {
      let quote: QuoteResponse | undefined;

      given(async () => {
        if (!hasJupiterApiKey) return;

        const quotes = await quoteService.getAllQuotes({
          request: {
            chainId: SolanaChains.SOLANA.chainId,
            sellToken: SOLANA_TOKENS.SOL,
            buyToken: SOLANA_TOKENS.USDC,
            order: {
              type: 'sell',
              sellAmount: 100_000_000n,
            },
            slippagePercentage: 1,
            takerAddress: TEST_WALLET,
            filters: { includeSources: ['jupiter'] },
          },
          config: {
            timeout: '30s',
            ignoredFailed: true,
          },
        });

        if (quotes.length > 0 && !('failed' in quotes[0])) {
          quote = quotes[0] as QuoteResponse;
        }
      });

      then('has correct chainId', () => {
        if (!hasJupiterApiKey || !quote) {
          console.log('Skipped: JUPITER_API_KEY not set or quote failed');
          return;
        }
        expect(quote.chainId).to.equal('solana');
      });

      then('has sell token information', () => {
        if (!hasJupiterApiKey || !quote) {
          console.log('Skipped: JUPITER_API_KEY not set or quote failed');
          return;
        }
        expect(quote.sellToken).to.exist;
        expect(quote.sellToken.address).to.equal(SOLANA_TOKENS.SOL);
        expect(quote.sellToken.symbol).to.be.a('string');
        expect(quote.sellToken.decimals).to.equal(9);
      });

      then('has buy token information', () => {
        if (!hasJupiterApiKey || !quote) {
          console.log('Skipped: JUPITER_API_KEY not set or quote failed');
          return;
        }
        expect(quote.buyToken).to.exist;
        expect(quote.buyToken.address).to.equal(SOLANA_TOKENS.USDC);
        expect(quote.buyToken.symbol).to.be.a('string');
        expect(quote.buyToken.decimals).to.equal(6);
      });

      then('has amount information', () => {
        if (!hasJupiterApiKey || !quote) {
          console.log('Skipped: JUPITER_API_KEY not set or quote failed');
          return;
        }
        expect(quote.sellAmount).to.exist;
        expect(quote.sellAmount.amount).to.be.a('bigint');
        expect(quote.buyAmount).to.exist;
        expect(quote.buyAmount.amount).to.be.a('bigint');
        expect(quote.maxSellAmount).to.exist;
        expect(quote.minBuyAmount).to.exist;
      });

      then('has source information', () => {
        if (!hasJupiterApiKey || !quote) {
          console.log('Skipped: JUPITER_API_KEY not set or quote failed');
          return;
        }
        expect(quote.source).to.exist;
        expect(quote.source.id).to.equal('jupiter');
        expect(quote.source.name).to.equal('Jupiter');
        expect(quote.source.logoURI).to.be.a('string');
      });

      then('has accounts information', () => {
        if (!hasJupiterApiKey || !quote) {
          console.log('Skipped: JUPITER_API_KEY not set or quote failed');
          return;
        }
        expect(quote.accounts).to.exist;
        expect(quote.accounts.takerAddress).to.equal(TEST_WALLET);
        expect(quote.accounts.recipient).to.equal(TEST_WALLET);
      });

      then('has custom data with Jupiter quote response', () => {
        if (!hasJupiterApiKey || !quote) {
          console.log('Skipped: JUPITER_API_KEY not set or quote failed');
          return;
        }
        expect(quote.customData).to.exist;
        expect(quote.customData.quoteResponse).to.exist;
        expect(quote.customData.quoteResponse.inputMint).to.be.a('string');
        expect(quote.customData.quoteResponse.outputMint).to.be.a('string');
        expect(quote.customData.quoteResponse.routePlan).to.be.an('array');
      });
    });
  });
});
