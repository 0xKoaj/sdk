import { expect } from 'chai';
import { ParaswapQuoteSource } from '@services/quotes/quote-sources/paraswap-quote-source';
import { then, when } from '@test-utils/bdd';
import { createEvmQuoteParams, createRecordingFetch } from './source-test-utils';

const AUGUSTUS = '0x6A000F20005980200259B80c5102003040001068';
const PRICE_ROUTE = { srcAmount: '100000000', destAmount: '37089013587592648', gasCost: '150000', tokenTransferProxy: AUGUSTUS };
const ROUTES = {
  '/prices': { body: { priceRoute: PRICE_ROUTE } },
  '/transactions/1': { body: { to: AUGUSTUS, data: '0xabcdef', value: '0' } },
};
const TOKEN_DATA = { request: async () => ({ sellToken: { decimals: 6 }, buyToken: { decimals: 18 } }) };

function params(overrides: Partial<Parameters<typeof createEvmQuoteParams>[0]> = {}, config: object = {}) {
  const { fetchService, requests } = createRecordingFetch(ROUTES);
  const quoteParams = createEvmQuoteParams<any, any>({ fetchService, config, ...overrides });
  (quoteParams.request as any).external.tokenData = TOKEN_DATA;
  return { quoteParams, requests };
}

describe('Paraswap (Velora) Quote Source', () => {
  const source = new ParaswapQuoteSource();

  then('queries api.velora.xyz prices then transactions with ignoreChecks', async () => {
    const { quoteParams, requests } = params();
    const quote = await source.quote(quoteParams);
    expect(requests[0].url).to.contain('https://api.velora.xyz/prices?');
    expect(requests[0].url).to.contain('version=6.2');
    expect(requests[1].url).to.equal('https://api.velora.xyz/transactions/1?ignoreChecks=true');
    expect(quote.buyAmount).to.equal(37089013587592648n);
    expect(quote.allowanceTarget).to.equal(AUGUSTUS);
    expect(quote.customData.tx).to.deep.equal({ to: AUGUSTUS, calldata: '0xabcdef', value: 0n });
  });

  then('sends slippage in bps and the priceRoute srcAmount for sell orders', async () => {
    const { quoteParams, requests } = params({ slippagePercentage: 0.5 });
    await source.quote(quoteParams);
    const body = JSON.parse(requests[1].init.body);
    expect(body.slippage).to.equal(50);
    expect(body.srcAmount).to.equal('100000000');
    expect(body.priceRoute).to.deep.equal(PRICE_ROUTE);
  });

  when('the order is a buy order', () => {
    then('prices with side=BUY and builds the transaction with destAmount', async () => {
      const { quoteParams, requests } = params({ order: { type: 'buy', buyAmount: 10_000000000000000n } });
      await source.quote(quoteParams);
      const prices = new URL(requests[0].url).searchParams;
      expect(prices.get('side')).to.equal('BUY');
      expect(prices.get('amount')).to.equal('10000000000000000');
      const body = JSON.parse(requests[1].init.body);
      expect(body.destAmount).to.equal(PRICE_ROUTE.destAmount);
      expect(body.srcAmount).to.be.undefined;
    });
  });

  when('no partner is configured', () => {
    then('uses the default partner instead of the fee-charging anon partner', async () => {
      const { quoteParams, requests } = params();
      await source.quote(quoteParams);
      expect(requests[0].url).to.contain('partner=onlyswaps');
      expect(JSON.parse(requests[1].init.body).partner).to.equal('onlyswaps');
    });
  });

  when('recipient equals the taker', () => {
    then('does not send a receiver', async () => {
      const taker = '0xED306e38BB930ec9646FF3D917B2e513a97530b1';
      const { quoteParams, requests } = params({ takeFrom: taker, recipient: taker.toLowerCase() });
      await source.quote(quoteParams);
      expect(requests[0].url).not.to.contain('receiver=');
      expect(JSON.parse(requests[1].init.body).receiver).to.be.undefined;
    });
  });

  when('recipient differs from the taker', () => {
    then('sends it as receiver', async () => {
      const recipient = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
      const { quoteParams, requests } = params({ recipient });
      await source.quote(quoteParams);
      expect(JSON.parse(requests[1].init.body).receiver).to.equal(recipient);
    });
  });
});
