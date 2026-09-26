import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { RelayQuoteSource } from '@services/quotes/quote-sources/relay-quote-source';
import { then, when } from '@test-utils/bdd';
import { createEvmQuoteParams, createRecordingFetch } from './source-test-utils';

chai.use(chaiAsPromised);

const RELAY_RESPONSE = {
  steps: [
    { id: 'swap', kind: 'transaction', items: [{ data: { to: '0x0000000000000000000000000000000000000abc', data: '0x1234', value: '0' } }] },
  ],
  details: { currencyOut: { amount: '99960000', minimumAmount: '98960000' } },
  fees: {},
};

// Cross-chain quotes come back as approve + deposit
const BRIDGE_RESPONSE = {
  ...RELAY_RESPONSE,
  steps: [
    { id: 'deposit', kind: 'transaction', items: [{ data: { to: '0x0000000000000000000000000000000000000abc', data: '0x1234', value: '0' } }] },
  ],
};

describe('Relay Quote Source', () => {
  const source = new RelayQuoteSource();

  when('the request is same-chain', () => {
    then('destinationChainId equals the origin chain', async () => {
      const { fetchService, requests } = createRecordingFetch({ '/quote': { body: RELAY_RESPONSE } });
      await source.quote(createEvmQuoteParams({ fetchService, config: {}, chainId: 1 }));
      const body = JSON.parse(requests[0].init.body);
      expect(body.originChainId).to.equal(1);
      expect(body.destinationChainId).to.equal(1);
    });
  });

  when('a cross-chain quote comes back as an approve + deposit', () => {
    then('the deposit step is used as the transaction', async () => {
      const bridgeResponse = {
        ...RELAY_RESPONSE,
        steps: [
          { id: 'approve', kind: 'transaction', items: [{ data: { to: '0x00000000000000000000000000000000000000aa', data: '0x095ea7b3' } }] },
          {
            id: 'deposit',
            kind: 'transaction',
            items: [{ data: { to: '0x00000000000000000000000000000000000000dd', data: '0xdeadbeef', value: '0' } }],
          },
        ],
      };
      const { fetchService } = createRecordingFetch({ '/quote': { body: bridgeResponse } });
      const quote = await source.quote(createEvmQuoteParams({ fetchService, config: {}, chainId: 1, buyTokenChainId: 8453 }));
      expect(quote.customData.tx).to.deep.equal({ to: '0x00000000000000000000000000000000000000dd', calldata: '0xdeadbeef', value: 0n });
    });
  });

  when('a cross-chain response also contains a swap step', () => {
    then('the quote fails instead of executing the origin swap without bridging', async () => {
      const multiStepResponse = {
        ...RELAY_RESPONSE,
        steps: [
          { id: 'swap', kind: 'transaction', items: [{ data: { to: '0x00000000000000000000000000000000000000cc', data: '0x01' } }] },
          { id: 'deposit', kind: 'transaction', items: [{ data: { to: '0x00000000000000000000000000000000000000dd', data: '0x02' } }] },
        ],
      };
      const { fetchService } = createRecordingFetch({ '/quote': { body: multiStepResponse } });
      await expect(source.quote(createEvmQuoteParams({ fetchService, config: {}, chainId: 1, buyTokenChainId: 8453 }))).to.be.rejectedWith(
        "Expected a single 'deposit' transaction"
      );
    });
  });

  when('a same-chain response comes back as a deposit', () => {
    then('the quote fails', async () => {
      const depositResponse = {
        ...RELAY_RESPONSE,
        steps: [{ id: 'deposit', kind: 'transaction', items: [{ data: { to: '0x00000000000000000000000000000000000000dd', data: '0x02' } }] }],
      };
      const { fetchService } = createRecordingFetch({ '/quote': { body: depositResponse } });
      await expect(source.quote(createEvmQuoteParams({ fetchService, config: {}, chainId: 1 }))).to.be.rejectedWith(
        "Expected a single 'swap' transaction"
      );
    });
  });

  when('a cross-chain quote fails', () => {
    then('the error names both chains', async () => {
      const { fetchService } = createRecordingFetch({ '/quote': { status: 400, body: { message: 'no routes found' } } });
      await expect(source.quote(createEvmQuoteParams({ fetchService, config: {}, chainId: 1, buyTokenChainId: 8453 }))).to.be.rejectedWith(
        /to Base/
      );
    });
  });

  when('the request is cross-chain', () => {
    then('destinationChainId is the buy token chain', async () => {
      const { fetchService, requests } = createRecordingFetch({ '/quote': { body: BRIDGE_RESPONSE } });
      const quote = await source.quote(
        createEvmQuoteParams({
          fetchService,
          config: {},
          chainId: 1,
          buyTokenChainId: 8453,
          buyToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        })
      );
      const body = JSON.parse(requests[0].init.body);
      expect(body.originChainId).to.equal(1);
      expect(body.destinationChainId).to.equal(8453);
      expect(quote.buyAmount).to.equal(99960000n);
    });
  });
});
