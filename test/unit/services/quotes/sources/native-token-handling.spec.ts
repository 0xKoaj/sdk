import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { PendleQuoteSource } from '@services/quotes/quote-sources/pendle-quote-source';
import { CowAMMQuoteSource } from '@services/quotes/quote-sources/cow-amm-quote-source';
import { then, when } from '@test-utils/bdd';
import { createEvmQuoteParams, createRecordingFetch } from './source-test-utils';

chai.use(chaiAsPromised);

const NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const ZERO = '0x0000000000000000000000000000000000000000';
const PT = '0xd4e6ea03d2e8bfeb5fa5c03ae9352514b1829218';
const PENDLE_ROUTER = '0x888888888889758F76e7103c6CbF23ABbF58F946';

describe('Native token handling', () => {
  describe('Pendle', () => {
    const source = new PendleQuoteSource();
    const pendleRoute = (value?: string) => ({
      routes: [{ tx: { to: PENDLE_ROUTER, data: '0xabcd', value }, outputs: [{ token: PT, amount: '81615395' }] }],
    });

    when('selling the native token', () => {
      then('it is sent as the zero address and the payable value is kept', async () => {
        const { fetchService, requests } = createRecordingFetch({ '/convert': { status: 201, body: pendleRoute('30000000000000000') } });
        const quote = await source.quote(
          createEvmQuoteParams<any, any>({
            fetchService,
            config: {},
            sellToken: NATIVE,
            buyToken: PT,
            order: { type: 'sell', sellAmount: 30000000000000000n },
          })
        );
        expect(JSON.parse(requests[0].init.body).inputs[0].token).to.equal(ZERO);
        expect((quote.customData.tx as { value?: bigint }).value).to.equal(30000000000000000n);
        expect(quote.allowanceTarget).to.equal(ZERO);
      });
    });

    when('buying the native token', () => {
      then('it is requested as the zero address so the output is not wrapped', async () => {
        const { fetchService, requests } = createRecordingFetch({ '/convert': { status: 201, body: pendleRoute() } });
        await source.quote(createEvmQuoteParams<any, any>({ fetchService, config: {}, buyToken: NATIVE }));
        expect(JSON.parse(requests[0].init.body).outputs).to.deep.equal([ZERO]);
      });
    });
  });

  describe('CoW AMM', () => {
    const source = new CowAMMQuoteSource();

    when('the pair includes the native token', () => {
      then('the quote is rejected before calling the API', async () => {
        const { fetchService, requests } = createRecordingFetch({});
        await expect(source.quote(createEvmQuoteParams<any, any>({ fetchService, config: {}, sellToken: NATIVE }))).to.be.rejectedWith(
          'Native token pairs are not supported'
        );
        await expect(source.quote(createEvmQuoteParams<any, any>({ fetchService, config: {}, buyToken: NATIVE }))).to.be.rejectedWith(
          'Native token pairs are not supported'
        );
        expect(requests).to.have.lengthOf(0);
      });
    });
  });
});
