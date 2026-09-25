import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { UniswapQuoteSource } from '@services/quotes/quote-sources/uniswap-quote-source';
import { then, when } from '@test-utils/bdd';
import { createEvmQuoteParams, createRecordingFetch } from './source-test-utils';

chai.use(chaiAsPromised);

const PROXY = '0x02E5be68D46DAc0B524905bfF209cf47EE6dB2a9';
const CLASSIC_QUOTE = {
  routing: 'CLASSIC',
  quote: { input: { amount: '100000000' }, output: { amount: '37000000000000000' }, gasUseEstimate: '160000' },
};
const SWAP = { swap: { to: PROXY, data: '0xdeadbeef', value: '0x00' } };

function setup(quoteBody: object = CLASSIC_QUOTE) {
  const { fetchService, requests } = createRecordingFetch({ '/v1/quote': { body: quoteBody }, '/v1/swap': { body: SWAP } });
  return { params: createEvmQuoteParams<any, any>({ fetchService, config: { apiKey: 'key' } }), requests };
}

describe('Uniswap (Trading API) Quote Source', () => {
  const source = new UniswapQuoteSource();

  when('no api key is configured', () => {
    then('the source is not valid for quoting', () => {
      expect(source.isConfigAndContextValidForQuoting(undefined)).to.be.false;
      expect(source.isConfigAndContextValidForQuoting({})).to.be.false;
      expect(source.isConfigAndContextValidForQuoting({ apiKey: 'key' })).to.be.true;
    });
  });

  then('requests an on-chain classic quote without Permit2 and builds the swap', async () => {
    const { params, requests } = setup();
    const quote = await source.quote(params);

    const [quoteRequest, swapRequest] = requests;
    expect(quoteRequest.url).to.equal('https://trade-api.gateway.uniswap.org/v1/quote');
    expect(quoteRequest.init.headers).to.include({ 'x-api-key': 'key', 'x-permit2-disabled': 'true', 'x-universal-router-version': '2.1.2' });
    const body = JSON.parse(quoteRequest.init.body);
    expect(body).to.include({
      type: 'EXACT_INPUT',
      amount: '100000000',
      tokenInChainId: 1,
      tokenOutChainId: 1,
      routingPreference: 'BEST_PRICE',
    });
    expect(body.protocols).to.deep.equal(['V2', 'V3', 'V4']);
    expect(body.swapper).to.equal('0xED306e38BB930ec9646FF3D917B2e513a97530b1');

    expect(swapRequest.url).to.equal('https://trade-api.gateway.uniswap.org/v1/swap');
    expect(JSON.parse(swapRequest.init.body).quote).to.deep.equal(CLASSIC_QUOTE.quote);

    expect(quote.buyAmount).to.equal(37000000000000000n);
    expect(quote.allowanceTarget).to.equal(PROXY);
    expect(quote.customData.tx).to.deep.equal({ to: PROXY, calldata: '0xdeadbeef', value: 0n });
  });

  when('the sell token is native', () => {
    then('it is sent as the zero address', async () => {
      const { fetchService, requests } = createRecordingFetch({ '/v1/quote': { body: CLASSIC_QUOTE }, '/v1/swap': { body: SWAP } });
      await source.quote(
        createEvmQuoteParams<any, any>({ fetchService, config: { apiKey: 'key' }, sellToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' })
      );
      expect(JSON.parse(requests[0].init.body).tokenIn).to.equal('0x0000000000000000000000000000000000000000');
    });
  });

  when('the order is a buy order', () => {
    then('requests an EXACT_OUTPUT quote for the buy amount', async () => {
      const { fetchService, requests } = createRecordingFetch({ '/v1/quote': { body: CLASSIC_QUOTE }, '/v1/swap': { body: SWAP } });
      await source.quote(
        createEvmQuoteParams<any, any>({ fetchService, config: { apiKey: 'key' }, order: { type: 'buy', buyAmount: 10_000000000000000n } })
      );
      expect(JSON.parse(requests[0].init.body)).to.include({ type: 'EXACT_OUTPUT', amount: '10000000000000000' });
    });
  });

  when('the quote request fails', () => {
    then('the quote fails with the API error and no swap is requested', async () => {
      const { fetchService, requests } = createRecordingFetch({ '/v1/quote': { status: 401, body: { detail: 'Unauthenticated' } } });
      await expect(source.quote(createEvmQuoteParams<any, any>({ fetchService, config: { apiKey: 'bad' } }))).to.be.rejectedWith(
        'Unauthenticated'
      );
      expect(requests).to.have.lengthOf(1);
    });
  });

  then('always sends a swap deadline', async () => {
    const { params, requests } = setup();
    await source.quote(params);
    expect(JSON.parse(requests[1].init.body).deadline).to.be.a('number');
  });

  when('the API answers with a UniswapX routing', () => {
    then('the quote fails because it would need a user signature', async () => {
      const { params } = setup({ ...CLASSIC_QUOTE, routing: 'DUTCH_V2' });
      await expect(source.quote(params)).to.be.rejectedWith('Unsupported routing DUTCH_V2');
    });
  });
});
