import { expect } from 'chai';
import { DefiLlamaClient, toChainId } from '@shared/defi-llama';
import { EVMChains } from '@chains';
import { then, when } from '@test-utils/bdd';

describe('DefiLlamaClient', () => {
  describe('supportedChains', () => {
    const mockFetch = { fetch: jest.fn() } as any;
    const client = new DefiLlamaClient(mockFetch);

    when('getting supported chains', () => {
      then('should include EVM chains', () => {
        const chains = client.supportedChains();
        expect(chains).to.include(EVMChains.ETHEREUM.chainId);
        expect(chains).to.include(EVMChains.POLYGON.chainId);
        expect(chains).to.include(EVMChains.ARBITRUM.chainId);
      });

      then('should include Solana', () => {
        const chains = client.supportedChains();
        expect(chains).to.include('solana');
      });

      then('should return correct types for chainIds', () => {
        const chains = client.supportedChains();
        const evmChains = chains.filter((c) => typeof c === 'number');
        const solanaChains = chains.filter((c) => typeof c === 'string');

        expect(evmChains.length).to.be.greaterThan(0);
        expect(solanaChains.length).to.be.greaterThan(0);
        expect(solanaChains).to.include('solana');
      });
    });
  });

  describe('toChainId', () => {
    when('converting DeFi Llama key to chainId', () => {
      then('should convert ethereum to chainId 1', () => {
        expect(toChainId('ethereum')).to.equal(1);
      });

      then('should convert polygon to chainId 137', () => {
        expect(toChainId('polygon')).to.equal(137);
      });

      then('should convert solana to chainId "solana"', () => {
        expect(toChainId('solana')).to.equal('solana');
      });

      then('should handle uppercase keys', () => {
        expect(toChainId('ETHEREUM')).to.equal(1);
        expect(toChainId('SOLANA')).to.equal('solana');
      });
    });
  });
});
