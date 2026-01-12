import { expect } from 'chai';
import { Chains, EVMChains, SolanaChains, getAllChains, getAllEVMChains, getAllSolanaChains, getChainByKey, getChainByKeyOrFail } from '@chains';
import { isEVMChain, isSolanaChain, EVMChain, SolanaChain } from '@types';
import { then, when } from '@test-utils/bdd';

describe('Solana Chains', () => {
  describe('Chain Definitions', () => {
    describe('SOLANA mainnet', () => {
      it('should have chainId "solana"', () => {
        expect(SolanaChains.SOLANA.chainId).to.equal('solana');
      });

      it('should have correct name', () => {
        expect(SolanaChains.SOLANA.name).to.equal('Solana');
      });

      it('should have correct ids', () => {
        expect(SolanaChains.SOLANA.ids).to.include('solana');
        expect(SolanaChains.SOLANA.ids).to.include('sol');
      });

      it('should have SOL as native currency', () => {
        expect(SolanaChains.SOLANA.nativeCurrency.symbol).to.equal('SOL');
        expect(SolanaChains.SOLANA.nativeCurrency.name).to.equal('Solana');
        expect(SolanaChains.SOLANA.nativeCurrency.mint).to.equal('So11111111111111111111111111111111111111112');
      });

      it('should have wrapped SOL token', () => {
        expect(SolanaChains.SOLANA.wToken).to.equal('So11111111111111111111111111111111111111112');
      });

      it('should have public RPCs', () => {
        expect(SolanaChains.SOLANA.publicRPCs).to.be.an('array').with.length.greaterThan(0);
        expect(SolanaChains.SOLANA.publicRPCs).to.include('https://api.mainnet-beta.solana.com');
      });

      it('should have explorer URL', () => {
        expect(SolanaChains.SOLANA.explorer).to.equal('https://solscan.io/');
      });

      it('should not be a testnet', () => {
        expect((SolanaChains.SOLANA as any).testnet).to.be.undefined;
      });
    });

    describe('SOLANA_DEVNET', () => {
      it('should have chainId "solana"', () => {
        expect(SolanaChains.SOLANA_DEVNET.chainId).to.equal('solana');
      });

      it('should be a testnet', () => {
        expect(SolanaChains.SOLANA_DEVNET.testnet).to.be.true;
      });

      it('should have devnet RPC', () => {
        expect(SolanaChains.SOLANA_DEVNET.publicRPCs).to.include('https://api.devnet.solana.com');
      });
    });
  });

  describe('Type Guards', () => {
    when('chain is Solana', () => {
      then('isSolanaChain returns true', () => {
        expect(isSolanaChain(SolanaChains.SOLANA)).to.be.true;
        expect(isSolanaChain(SolanaChains.SOLANA_DEVNET)).to.be.true;
      });

      then('isEVMChain returns false', () => {
        expect(isEVMChain(SolanaChains.SOLANA)).to.be.false;
        expect(isEVMChain(SolanaChains.SOLANA_DEVNET)).to.be.false;
      });
    });

    when('chain is EVM', () => {
      then('isSolanaChain returns false', () => {
        expect(isSolanaChain(EVMChains.ETHEREUM)).to.be.false;
        expect(isSolanaChain(EVMChains.POLYGON)).to.be.false;
      });

      then('isEVMChain returns true', () => {
        expect(isEVMChain(EVMChains.ETHEREUM)).to.be.true;
        expect(isEVMChain(EVMChains.POLYGON)).to.be.true;
      });
    });
  });

  describe('Chain Lookup Functions', () => {
    describe('getAllChains', () => {
      it('should return all chains including Solana', () => {
        const allChains = getAllChains();
        const solanaChain = allChains.find((c) => c.chainId === 'solana' && c.name === 'Solana');
        expect(solanaChain).to.exist;
      });

      it('should include both EVM and Solana chains', () => {
        const allChains = getAllChains();
        const evmChains = allChains.filter(isEVMChain);
        const solanaChains = allChains.filter(isSolanaChain);

        expect(evmChains.length).to.be.greaterThan(0);
        expect(solanaChains.length).to.be.greaterThan(0);
      });
    });

    describe('getAllEVMChains', () => {
      it('should return only EVM chains', () => {
        const evmChains = getAllEVMChains();
        evmChains.forEach((chain) => {
          expect(typeof chain.chainId).to.equal('number');
        });
      });

      it('should not include Solana', () => {
        const evmChains = getAllEVMChains();
        const hasSolana = evmChains.some((c) => c.name === 'Solana');
        expect(hasSolana).to.be.false;
      });
    });

    describe('getAllSolanaChains', () => {
      it('should return only Solana chains', () => {
        const solanaChains = getAllSolanaChains();
        solanaChains.forEach((chain) => {
          expect(chain.chainId).to.equal('solana');
        });
      });

      it('should include mainnet and devnet', () => {
        const solanaChains = getAllSolanaChains();
        expect(solanaChains.length).to.be.at.least(2);

        const hasMainnet = solanaChains.some((c) => c.name === 'Solana' && !c.testnet);
        const hasDevnet = solanaChains.some((c) => c.name === 'Solana Devnet' && c.testnet);

        expect(hasMainnet).to.be.true;
        expect(hasDevnet).to.be.true;
      });
    });

    describe('getChainByKey', () => {
      it('should find Solana by chainId string', () => {
        const chain = getChainByKey('solana');
        expect(chain).to.exist;
        expect(chain?.name).to.equal('Solana');
      });

      it('should find Solana by id "sol"', () => {
        const chain = getChainByKey('sol');
        expect(chain).to.exist;
        expect(chain?.chainId).to.equal('solana');
      });

      it('should find Ethereum by numeric chainId', () => {
        const chain = getChainByKey(1);
        expect(chain).to.exist;
        expect(chain?.name).to.equal('Ethereum');
      });

      it('should return undefined for unknown chain', () => {
        const chain = getChainByKey('unknown-chain');
        expect(chain).to.be.undefined;
      });
    });

    describe('getChainByKeyOrFail', () => {
      it('should find Solana by key', () => {
        const chain = getChainByKeyOrFail('solana');
        expect(chain.chainId).to.equal('solana');
      });

      it('should throw for unknown chain', () => {
        expect(() => getChainByKeyOrFail('unknown-chain')).to.throw("Failed to find a chain with key 'unknown-chain'");
      });
    });
  });

  describe('Combined Chains Object', () => {
    it('should contain all EVM chains', () => {
      const evmKeys = Object.keys(EVMChains);
      evmKeys.forEach((key) => {
        expect(Chains).to.have.property(key);
      });
    });

    it('should contain all Solana chains', () => {
      const solanaKeys = Object.keys(SolanaChains);
      solanaKeys.forEach((key) => {
        expect(Chains).to.have.property(key);
      });
    });

    it('should have SOLANA property', () => {
      expect(Chains.SOLANA).to.exist;
      expect(Chains.SOLANA.chainId).to.equal('solana');
    });
  });
});
