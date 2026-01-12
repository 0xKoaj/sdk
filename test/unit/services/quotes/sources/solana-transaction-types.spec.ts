import { expect } from 'chai';
import {
  SourceQuoteTransaction,
  EVMSourceQuoteTransaction,
  SolanaSourceQuoteTransaction,
  isEVMTransaction,
  isSolanaTransaction,
} from '@services/quotes/quote-sources/types';
import { then, when } from '@test-utils/bdd';

describe('Solana Transaction Types', () => {
  describe('Type Guards', () => {
    describe('isEVMTransaction', () => {
      when('transaction has no type field', () => {
        then('returns true (backwards compatible)', () => {
          const tx: SourceQuoteTransaction = {
            to: '0x1234567890123456789012345678901234567890',
            calldata: '0xabcdef',
            value: 1000n,
          };
          expect(isEVMTransaction(tx)).to.be.true;
        });
      });

      when('transaction has type: "evm"', () => {
        then('returns true', () => {
          const tx: EVMSourceQuoteTransaction = {
            type: 'evm',
            to: '0x1234567890123456789012345678901234567890',
            calldata: '0xabcdef',
            value: 1000n,
          };
          expect(isEVMTransaction(tx)).to.be.true;
        });
      });

      when('transaction has type: "solana"', () => {
        then('returns false', () => {
          const tx: SolanaSourceQuoteTransaction = {
            type: 'solana',
            swapTransaction: 'base64EncodedTransaction==',
            lastValidBlockHeight: 12345678,
          };
          expect(isEVMTransaction(tx)).to.be.false;
        });
      });
    });

    describe('isSolanaTransaction', () => {
      when('transaction has type: "solana"', () => {
        then('returns true', () => {
          const tx: SolanaSourceQuoteTransaction = {
            type: 'solana',
            swapTransaction: 'base64EncodedTransaction==',
            lastValidBlockHeight: 12345678,
          };
          expect(isSolanaTransaction(tx)).to.be.true;
        });
      });

      when('transaction has no type field (EVM)', () => {
        then('returns false', () => {
          const tx: SourceQuoteTransaction = {
            to: '0x1234567890123456789012345678901234567890',
            calldata: '0xabcdef',
          };
          expect(isSolanaTransaction(tx)).to.be.false;
        });
      });

      when('transaction has type: "evm"', () => {
        then('returns false', () => {
          const tx: EVMSourceQuoteTransaction = {
            type: 'evm',
            to: '0x1234567890123456789012345678901234567890',
            calldata: '0xabcdef',
          };
          expect(isSolanaTransaction(tx)).to.be.false;
        });
      });
    });
  });

  describe('Transaction Structures', () => {
    describe('EVM Transaction', () => {
      it('should allow optional type field', () => {
        const txWithType: EVMSourceQuoteTransaction = {
          type: 'evm',
          to: '0x1234567890123456789012345678901234567890',
          calldata: '0xabcdef',
        };
        const txWithoutType: EVMSourceQuoteTransaction = {
          to: '0x1234567890123456789012345678901234567890',
          calldata: '0xabcdef',
        };

        expect(txWithType.to).to.equal(txWithoutType.to);
        expect(txWithType.calldata).to.equal(txWithoutType.calldata);
      });

      it('should allow optional value field', () => {
        const txWithValue: EVMSourceQuoteTransaction = {
          to: '0x1234567890123456789012345678901234567890',
          calldata: '0xabcdef',
          value: 1000n,
        };
        const txWithoutValue: EVMSourceQuoteTransaction = {
          to: '0x1234567890123456789012345678901234567890',
          calldata: '0xabcdef',
        };

        expect(txWithValue.value).to.equal(1000n);
        expect(txWithoutValue.value).to.be.undefined;
      });
    });

    describe('Solana Transaction', () => {
      it('should require type field', () => {
        const tx: SolanaSourceQuoteTransaction = {
          type: 'solana',
          swapTransaction: 'base64EncodedTransaction==',
        };
        expect(tx.type).to.equal('solana');
      });

      it('should require swapTransaction field', () => {
        const tx: SolanaSourceQuoteTransaction = {
          type: 'solana',
          swapTransaction: 'base64EncodedTransaction==',
        };
        expect(tx.swapTransaction).to.equal('base64EncodedTransaction==');
      });

      it('should allow optional lastValidBlockHeight', () => {
        const txWithHeight: SolanaSourceQuoteTransaction = {
          type: 'solana',
          swapTransaction: 'base64EncodedTransaction==',
          lastValidBlockHeight: 12345678,
        };
        const txWithoutHeight: SolanaSourceQuoteTransaction = {
          type: 'solana',
          swapTransaction: 'base64EncodedTransaction==',
        };

        expect(txWithHeight.lastValidBlockHeight).to.equal(12345678);
        expect(txWithoutHeight.lastValidBlockHeight).to.be.undefined;
      });
    });
  });

  describe('Union Type Discrimination', () => {
    it('should correctly narrow types using type guards', () => {
      const transactions: SourceQuoteTransaction[] = [
        {
          to: '0x1234567890123456789012345678901234567890',
          calldata: '0xabcdef',
        },
        {
          type: 'evm',
          to: '0x1234567890123456789012345678901234567890',
          calldata: '0xabcdef',
        },
        {
          type: 'solana',
          swapTransaction: 'base64EncodedTransaction==',
          lastValidBlockHeight: 12345678,
        },
      ];

      const evmTxs = transactions.filter(isEVMTransaction);
      const solanaTxs = transactions.filter(isSolanaTransaction);

      expect(evmTxs).to.have.lengthOf(2);
      expect(solanaTxs).to.have.lengthOf(1);

      // Type narrowing should work
      evmTxs.forEach((tx) => {
        expect(tx.to).to.be.a('string');
        expect(tx.calldata).to.be.a('string');
      });

      solanaTxs.forEach((tx) => {
        expect(tx.swapTransaction).to.be.a('string');
      });
    });
  });
});
