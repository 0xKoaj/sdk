import { expect } from 'chai';
import { JupiterMetadataSource } from '@services/metadata/metadata-sources/jupiter-metadata-source';
import { SolanaChains, EVMChains } from '@chains';
import { SolanaAddresses } from '@shared/constants';
import { then, when } from '@test-utils/bdd';

describe('JupiterMetadataSource', () => {
  const mockFetch = {
    fetch: jest.fn(),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('supportedProperties', () => {
    when('getting supported properties', () => {
      then('should only support Solana chain', () => {
        const source = new JupiterMetadataSource(mockFetch);
        const properties = source.supportedProperties();

        expect(Object.keys(properties)).to.have.lengthOf(1);
        expect(properties[SolanaChains.SOLANA.chainId]).to.exist;
      });

      then('should support symbol, decimals, name, and logoURI', () => {
        const source = new JupiterMetadataSource(mockFetch);
        const properties = source.supportedProperties();
        const solanaProps = properties[SolanaChains.SOLANA.chainId];

        expect(solanaProps.symbol).to.equal('present');
        expect(solanaProps.decimals).to.equal('present');
        expect(solanaProps.name).to.equal('optional');
        expect(solanaProps.logoURI).to.equal('optional');
      });
    });
  });

  describe('getMetadata', () => {
    when('called with empty tokens array', () => {
      then('should return empty result', async () => {
        const source = new JupiterMetadataSource(mockFetch);
        const result = await source.getMetadata({ tokens: [] });

        expect(result).to.deep.equal({});
        expect(mockFetch.fetch.mock.calls.length).to.equal(0);
      });
    });

    when('called with non-Solana tokens only', () => {
      then('should return empty result without fetching', async () => {
        const source = new JupiterMetadataSource(mockFetch);
        const result = await source.getMetadata({
          tokens: [
            { chainId: EVMChains.ETHEREUM.chainId, token: '0x123' },
            { chainId: EVMChains.POLYGON.chainId, token: '0x456' },
          ],
        });

        expect(result).to.deep.equal({});
        expect(mockFetch.fetch.mock.calls.length).to.equal(0);
      });
    });

    when('called with Solana tokens', () => {
      then('should fetch and return metadata', async () => {
        const mockTokenList = [
          {
            address: SolanaAddresses.USDC,
            symbol: 'USDC',
            name: 'USD Coin',
            decimals: 6,
            logoURI: 'https://example.com/usdc.png',
          },
          {
            address: SolanaAddresses.NATIVE_SOL,
            symbol: 'SOL',
            name: 'Wrapped SOL',
            decimals: 9,
            logoURI: 'https://example.com/sol.png',
          },
        ];

        mockFetch.fetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockTokenList),
        });

        const source = new JupiterMetadataSource(mockFetch);
        const result = await source.getMetadata({
          tokens: [
            { chainId: SolanaChains.SOLANA.chainId, token: SolanaAddresses.USDC },
            { chainId: SolanaChains.SOLANA.chainId, token: SolanaAddresses.NATIVE_SOL },
          ],
        });

        expect(result[SolanaChains.SOLANA.chainId]).to.exist;
        expect(result[SolanaChains.SOLANA.chainId][SolanaAddresses.USDC]).to.deep.equal({
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
          logoURI: 'https://example.com/usdc.png',
        });
      });
    });

    when('caching', () => {
      then('should only call API once within cache duration', async () => {
        mockFetch.fetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve([{ address: SolanaAddresses.USDC, symbol: 'USDC', name: 'USD Coin', decimals: 6 }]),
        });

        const source = new JupiterMetadataSource(mockFetch);

        await source.getMetadata({
          tokens: [{ chainId: SolanaChains.SOLANA.chainId, token: SolanaAddresses.USDC }],
        });

        await source.getMetadata({
          tokens: [{ chainId: SolanaChains.SOLANA.chainId, token: SolanaAddresses.USDC }],
        });

        expect(mockFetch.fetch.mock.calls.length).to.equal(1);
      });
    });
  });
});
