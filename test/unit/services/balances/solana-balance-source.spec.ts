import { expect } from 'chai';
import { SolanaBalanceSource } from '@services/balances/balance-sources/solana-balance-source';
import { SolanaChains } from '@chains';
import { SolanaAddresses } from '@shared/constants';
import { then, when } from '@test-utils/bdd';

describe('SolanaBalanceSource', () => {
  const mockLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const mockLogs = {
    getLogger: jest.fn(() => mockLogger),
  } as any;

  describe('supportedChains', () => {
    when('getting supported chains', () => {
      then('should only return Solana chain', () => {
        const source = new SolanaBalanceSource(mockLogs);
        const chains = source.supportedChains();

        expect(chains).to.have.lengthOf(1);
        expect(chains).to.include('solana');
        expect(chains).to.include(SolanaChains.SOLANA.chainId);
      });
    });
  });

  describe('getBalances', () => {
    when('called with empty tokens array', () => {
      then('should return empty result', async () => {
        const source = new SolanaBalanceSource(mockLogs);
        const result = await source.getBalances({ tokens: [] });

        expect(result).to.deep.equal({});
      });
    });

    when('called with non-Solana chain', () => {
      then('should return empty result for that chain', async () => {
        const source = new SolanaBalanceSource(mockLogs);
        const result = await source.getBalances({
          tokens: [
            {
              chainId: 1, // Ethereum
              account: '0x1234567890123456789012345678901234567890',
              token: '0x1234567890123456789012345678901234567890',
            },
          ],
        });

        expect(result[1]).to.deep.equal({});
      });
    });
  });

  describe('token addresses', () => {
    it('should recognize native SOL token address', () => {
      expect(SolanaAddresses.NATIVE_SOL).to.equal('So11111111111111111111111111111111111111112');
    });

    it('should have common SPL token addresses defined', () => {
      expect(SolanaAddresses.USDC).to.equal('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      expect(SolanaAddresses.USDT).to.equal('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
    });
  });
});
