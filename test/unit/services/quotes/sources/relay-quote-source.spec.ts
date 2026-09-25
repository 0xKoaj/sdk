import { expect } from 'chai';
import { RelayQuoteSource } from '@services/quotes/quote-sources/relay-quote-source';
import { then, when } from '@test-utils/bdd';
import { createEvmQuoteParams, createRecordingFetch } from './source-test-utils';

const RELAY_RESPONSE = {
  steps: [{ id: 'swap', items: [{ data: { to: '0x0000000000000000000000000000000000000abc', data: '0x1234', value: '0' } }] }],
  details: { currencyOut: { amount: '99960000', minimumAmount: '98960000' } },
  fees: {},
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

  when('the request is cross-chain', () => {
    then('destinationChainId is the buy token chain', async () => {
      const { fetchService, requests } = createRecordingFetch({ '/quote': { body: RELAY_RESPONSE } });
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
