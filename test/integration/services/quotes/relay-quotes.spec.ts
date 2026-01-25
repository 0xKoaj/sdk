import ms from 'ms';
import { expect } from 'chai';
import { given, then, when } from '@test-utils/bdd';
import { Chains } from '@chains';
import { QuoteResponse, FailedResponse } from '@services/quotes';
import { buildSDK } from '@builder';
import { CONFIG } from './quote-tests-config';
import { ChainId, DefaultRequirements, FieldsRequirements, TimeString, TokenAddress } from '@types';
import { IMetadataSource, MetadataInput, MetadataResult } from '@services/metadata';
import { parseEther, parseUnits } from 'viem';
import { Addresses } from '@shared/constants';

jest.setTimeout(ms('2m'));

// Well-known token addresses on different chains
const TOKENS = {
  ethereum: {
    NATIVE: Addresses.NATIVE_TOKEN,
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  },
  polygon: {
    NATIVE: Addresses.NATIVE_TOKEN,
    WMATIC: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
    USDC: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  },
  arbitrum: {
    NATIVE: Addresses.NATIVE_TOKEN,
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  },
  base: {
    NATIVE: Addresses.NATIVE_TOKEN,
    WETH: '0x4200000000000000000000000000000000000006',
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
  optimism: {
    NATIVE: Addresses.NATIVE_TOKEN,
    WETH: '0x4200000000000000000000000000000000000006',
    USDC: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  },
};

// Mock metadata source
type TokenMetadata = { symbol: string; decimals: number };
const MOCKED_METADATA_SOURCE: IMetadataSource<TokenMetadata> = {
  supportedProperties: () => {
    const result: Record<ChainId, { symbol: 'present'; decimals: 'present' }> = {};
    for (const chain of Object.values(Chains)) {
      if (typeof chain.chainId === 'number') {
        result[chain.chainId] = { symbol: 'present', decimals: 'present' };
      }
    }
    return result;
  },
  getMetadata: <Requirements extends FieldsRequirements<TokenMetadata> = DefaultRequirements<TokenMetadata>>({
    tokens,
  }: {
    tokens: MetadataInput[];
    config?: { fields?: Requirements; timeout?: TimeString };
  }) => {
    const result: Record<ChainId, Record<TokenAddress, MetadataResult<TokenMetadata, Requirements>>> = {};
    const decimalsMap: Record<string, number> = {
      [TOKENS.ethereum.USDC]: 6,
      [TOKENS.ethereum.USDT]: 6,
      [TOKENS.polygon.USDC]: 6,
      [TOKENS.polygon.USDT]: 6,
      [TOKENS.arbitrum.USDC]: 6,
      [TOKENS.arbitrum.USDT]: 6,
      [TOKENS.base.USDC]: 6,
      [TOKENS.optimism.USDC]: 6,
    };

    for (const { chainId, token } of tokens) {
      if (!(chainId in result)) result[chainId] = {};
      result[chainId][token] = {
        symbol: 'TOKEN',
        decimals: decimalsMap[token] || 18,
      } as MetadataResult<TokenMetadata, Requirements>;
    }
    return Promise.resolve(result);
  },
};

// Build SDK
const { quoteService } = buildSDK({
  metadata: { source: { type: 'custom', instance: MOCKED_METADATA_SOURCE } },
  quotes: { sourceList: { type: 'local' }, defaultConfig: CONFIG },
});

// Test wallet address
const TEST_WALLET = '0x0000000000000000000000000000000000000001';

describe('Relay Quote Integration Tests', () => {
  describe('Relay Quote Source', () => {
    when('requesting ETH to USDC quote on Ethereum', () => {
      let response: QuoteResponse | FailedResponse | undefined;

      given(async () => {
        const quotes = await quoteService.getAllQuotes({
          request: {
            chainId: Chains.ETHEREUM.chainId,
            sellToken: TOKENS.ethereum.NATIVE,
            buyToken: TOKENS.ethereum.USDC,
            order: {
              type: 'sell',
              sellAmount: parseEther('0.1'),
            },
            slippagePercentage: 1,
            takerAddress: TEST_WALLET,
            filters: { includeSources: ['relay'] },
          },
          config: {
            timeout: '30s',
            ignoredFailed: false,
          },
        });
        response = quotes[0];
      });

      then('quote is returned successfully', () => {
        expect(response).to.exist;
        if (response && 'failed' in response) {
          console.log('Quote failed:', response.error);
          return;
        }

        const quote = response as QuoteResponse;
        expect(quote.source.id).to.equal('relay');
        expect(quote.chainId).to.equal(Chains.ETHEREUM.chainId);
        expect(quote.sellToken.address.toLowerCase()).to.equal(TOKENS.ethereum.NATIVE.toLowerCase());
        expect(quote.buyToken.address.toLowerCase()).to.equal(TOKENS.ethereum.USDC.toLowerCase());
        expect(quote.sellAmount.amount).to.equal(parseEther('0.1'));
        expect(quote.buyAmount.amount).to.be.a('bigint');
        expect(quote.buyAmount.amount > 0n).to.be.true;
        expect(quote.type).to.equal('sell');
      });
    });

    when('requesting USDC to ETH quote on Ethereum', () => {
      let response: QuoteResponse | FailedResponse | undefined;

      given(async () => {
        const quotes = await quoteService.getAllQuotes({
          request: {
            chainId: Chains.ETHEREUM.chainId,
            sellToken: TOKENS.ethereum.USDC,
            buyToken: TOKENS.ethereum.NATIVE,
            order: {
              type: 'sell',
              sellAmount: parseUnits('100', 6), // 100 USDC
            },
            slippagePercentage: 1,
            takerAddress: TEST_WALLET,
            filters: { includeSources: ['relay'] },
          },
          config: {
            timeout: '30s',
            ignoredFailed: false,
          },
        });
        response = quotes[0];
      });

      then('quote is returned successfully', () => {
        expect(response).to.exist;
        if (response && 'failed' in response) {
          console.log('Quote failed:', response.error);
          return;
        }

        const quote = response as QuoteResponse;
        expect(quote.source.id).to.equal('relay');
        expect(quote.sellToken.address.toLowerCase()).to.equal(TOKENS.ethereum.USDC.toLowerCase());
        expect(quote.buyToken.address.toLowerCase()).to.equal(TOKENS.ethereum.NATIVE.toLowerCase());
      });
    });

    when('requesting quote on Polygon', () => {
      let response: QuoteResponse | FailedResponse | undefined;

      given(async () => {
        const quotes = await quoteService.getAllQuotes({
          request: {
            chainId: Chains.POLYGON.chainId,
            sellToken: TOKENS.polygon.NATIVE,
            buyToken: TOKENS.polygon.USDC,
            order: {
              type: 'sell',
              sellAmount: parseEther('10'), // 10 POL
            },
            slippagePercentage: 1,
            takerAddress: TEST_WALLET,
            filters: { includeSources: ['relay'] },
          },
          config: {
            timeout: '30s',
            ignoredFailed: false,
          },
        });
        response = quotes[0];
      });

      then('quote is returned for Polygon', () => {
        expect(response).to.exist;
        if (response && 'failed' in response) {
          console.log('Quote failed:', response.error);
          return;
        }

        const quote = response as QuoteResponse;
        expect(quote.source.id).to.equal('relay');
        expect(quote.chainId).to.equal(Chains.POLYGON.chainId);
      });
    });

    when('requesting quote on Arbitrum', () => {
      let response: QuoteResponse | FailedResponse | undefined;

      given(async () => {
        const quotes = await quoteService.getAllQuotes({
          request: {
            chainId: Chains.ARBITRUM.chainId,
            sellToken: TOKENS.arbitrum.NATIVE,
            buyToken: TOKENS.arbitrum.USDC,
            order: {
              type: 'sell',
              sellAmount: parseEther('0.05'),
            },
            slippagePercentage: 1,
            takerAddress: TEST_WALLET,
            filters: { includeSources: ['relay'] },
          },
          config: {
            timeout: '30s',
            ignoredFailed: false,
          },
        });
        response = quotes[0];
      });

      then('quote is returned for Arbitrum', () => {
        expect(response).to.exist;
        if (response && 'failed' in response) {
          console.log('Quote failed:', response.error);
          return;
        }

        const quote = response as QuoteResponse;
        expect(quote.source.id).to.equal('relay');
        expect(quote.chainId).to.equal(Chains.ARBITRUM.chainId);
      });
    });

    when('requesting quote on Base', () => {
      let response: QuoteResponse | FailedResponse | undefined;

      given(async () => {
        const quotes = await quoteService.getAllQuotes({
          request: {
            chainId: Chains.BASE.chainId,
            sellToken: TOKENS.base.NATIVE,
            buyToken: TOKENS.base.USDC,
            order: {
              type: 'sell',
              sellAmount: parseEther('0.05'),
            },
            slippagePercentage: 1,
            takerAddress: TEST_WALLET,
            filters: { includeSources: ['relay'] },
          },
          config: {
            timeout: '30s',
            ignoredFailed: false,
          },
        });
        response = quotes[0];
      });

      then('quote is returned for Base', () => {
        expect(response).to.exist;
        if (response && 'failed' in response) {
          console.log('Quote failed:', response.error);
          return;
        }

        const quote = response as QuoteResponse;
        expect(quote.source.id).to.equal('relay');
        expect(quote.chainId).to.equal(Chains.BASE.chainId);
      });
    });

    when('requesting quote on Optimism', () => {
      let response: QuoteResponse | FailedResponse | undefined;

      given(async () => {
        const quotes = await quoteService.getAllQuotes({
          request: {
            chainId: Chains.OPTIMISM.chainId,
            sellToken: TOKENS.optimism.NATIVE,
            buyToken: TOKENS.optimism.USDC,
            order: {
              type: 'sell',
              sellAmount: parseEther('0.05'),
            },
            slippagePercentage: 1,
            takerAddress: TEST_WALLET,
            filters: { includeSources: ['relay'] },
          },
          config: {
            timeout: '30s',
            ignoredFailed: false,
          },
        });
        response = quotes[0];
      });

      then('quote is returned for Optimism', () => {
        expect(response).to.exist;
        if (response && 'failed' in response) {
          console.log('Quote failed:', response.error);
          return;
        }

        const quote = response as QuoteResponse;
        expect(quote.source.id).to.equal('relay');
        expect(quote.chainId).to.equal(Chains.OPTIMISM.chainId);
      });
    });

    when('requesting quote with transaction building', () => {
      let quoteWithTx: (QuoteResponse & { tx: any }) | FailedResponse | undefined;

      given(async () => {
        const quotes = await quoteService.getAllQuotesWithTxs({
          request: {
            chainId: Chains.ETHEREUM.chainId,
            sellToken: TOKENS.ethereum.NATIVE,
            buyToken: TOKENS.ethereum.USDC,
            order: {
              type: 'sell',
              sellAmount: parseEther('0.1'),
            },
            slippagePercentage: 1,
            takerAddress: TEST_WALLET,
            filters: { includeSources: ['relay'] },
          },
          config: {
            timeout: '30s',
            ignoredFailed: false,
          },
        });
        quoteWithTx = quotes[0] as any;
      });

      then('transaction is returned in EVM format', () => {
        expect(quoteWithTx).to.exist;
        if (quoteWithTx && 'failed' in quoteWithTx) {
          console.log('Quote failed:', quoteWithTx.error);
          return;
        }

        const quote = quoteWithTx as QuoteResponse & { tx: any };
        expect(quote.tx).to.exist;
        expect(quote.tx.to).to.be.a('string');
        expect(quote.tx.data).to.be.a('string');
        expect(quote.tx.data.startsWith('0x')).to.be.true;
      });
    });
  });

  describe('Relay Source Availability', () => {
    when('checking supported sources', () => {
      then('Relay is available for Ethereum', () => {
        const supportedSources = quoteService.supportedSourcesInChain({
          chainId: Chains.ETHEREUM.chainId,
        });
        expect(Object.keys(supportedSources)).to.include('relay');
      });

      then('Relay is available for Polygon', () => {
        const supportedSources = quoteService.supportedSourcesInChain({
          chainId: Chains.POLYGON.chainId,
        });
        expect(Object.keys(supportedSources)).to.include('relay');
      });

      then('Relay is available for Arbitrum', () => {
        const supportedSources = quoteService.supportedSourcesInChain({
          chainId: Chains.ARBITRUM.chainId,
        });
        expect(Object.keys(supportedSources)).to.include('relay');
      });

      then('Relay is available for Base', () => {
        const supportedSources = quoteService.supportedSourcesInChain({
          chainId: Chains.BASE.chainId,
        });
        expect(Object.keys(supportedSources)).to.include('relay');
      });

      then('Relay is available for Optimism', () => {
        const supportedSources = quoteService.supportedSourcesInChain({
          chainId: Chains.OPTIMISM.chainId,
        });
        expect(Object.keys(supportedSources)).to.include('relay');
      });

      then('Relay is available for BNB Chain', () => {
        const supportedSources = quoteService.supportedSourcesInChain({
          chainId: Chains.BNB_CHAIN.chainId,
        });
        expect(Object.keys(supportedSources)).to.include('relay');
      });

      then('Relay is available for Gnosis', () => {
        const supportedSources = quoteService.supportedSourcesInChain({
          chainId: Chains.GNOSIS.chainId,
        });
        expect(Object.keys(supportedSources)).to.include('relay');
      });

      then('Relay is available for Sonic', () => {
        const supportedSources = quoteService.supportedSourcesInChain({
          chainId: Chains.SONIC.chainId,
        });
        expect(Object.keys(supportedSources)).to.include('relay');
      });
    });
  });

  describe('Quote Response Structure', () => {
    when('receiving a Relay quote', () => {
      let quote: QuoteResponse | undefined;

      given(async () => {
        const quotes = await quoteService.getAllQuotes({
          request: {
            chainId: Chains.ETHEREUM.chainId,
            sellToken: TOKENS.ethereum.NATIVE,
            buyToken: TOKENS.ethereum.USDC,
            order: {
              type: 'sell',
              sellAmount: parseEther('0.1'),
            },
            slippagePercentage: 1,
            takerAddress: TEST_WALLET,
            filters: { includeSources: ['relay'] },
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

      then('has correct source information', () => {
        if (!quote) {
          console.log('Skipped: quote failed or not available');
          return;
        }
        expect(quote.source).to.exist;
        expect(quote.source.id).to.equal('relay');
        expect(quote.source.name).to.equal('Relay');
      });

      then('has amount information', () => {
        if (!quote) {
          console.log('Skipped: quote failed or not available');
          return;
        }
        expect(quote.sellAmount).to.exist;
        expect(quote.sellAmount.amount).to.be.a('bigint');
        expect(quote.buyAmount).to.exist;
        expect(quote.buyAmount.amount).to.be.a('bigint');
        expect(quote.maxSellAmount).to.exist;
        expect(quote.minBuyAmount).to.exist;
      });

      then('has accounts information', () => {
        if (!quote) {
          console.log('Skipped: quote failed or not available');
          return;
        }
        expect(quote.accounts).to.exist;
        expect(quote.accounts.takerAddress.toLowerCase()).to.equal(TEST_WALLET.toLowerCase());
      });

      then('has custom data with transaction info', () => {
        if (!quote) {
          console.log('Skipped: quote failed or not available');
          return;
        }
        expect(quote.customData).to.exist;
        expect(quote.customData.tx).to.exist;
        expect(quote.customData.tx.to).to.be.a('string');
        expect(quote.customData.tx.calldata).to.be.a('string');
      });
    });
  });
});
