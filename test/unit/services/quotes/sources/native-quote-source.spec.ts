import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { NativeQuoteSource } from '@services/quotes/quote-sources/native-quote-source';
import { then, when } from '@test-utils/bdd';
import { createEvmQuoteParams, createRecordingFetch } from './source-test-utils';

chai.use(chaiAsPromised);

const ROUTER = '0xb2d1F342D2049684Fb2f8c4eF320633415598333';
const FIRM_QUOTE = {
  success: true,
  amountIn: '100000000',
  amountOut: '37100000000000000',
  txRequest: { target: ROUTER, calldata: '0xaf706539', value: '0' },
};

describe('Native Quote Source', () => {
  const source = new NativeQuoteSource();

  when('no api key is configured', () => {
    then('the source is not valid for quoting', () => {
      expect(source.isConfigAndContextValidForQuoting(undefined)).to.be.false;
      expect(source.isConfigAndContextValidForQuoting({ apiKey: 'key' })).to.be.true;
    });
  });

  then('requests a firm quote paid out to the recipient and returns the router calldata', async () => {
    const { fetchService, requests } = createRecordingFetch({ '/firm-quote': { body: FIRM_QUOTE } });
    const quote = await source.quote(createEvmQuoteParams<any, any>({ fetchService, config: { apiKey: 'key' }, chainId: 8453 }));

    const url = new URL(requests[0].url);
    expect(url.origin + url.pathname).to.equal('https://v2.api.native.org/swap-api-v2/v1/firm-quote');
    expect(Object.fromEntries(url.searchParams)).to.include({
      src_chain: 'base',
      dst_chain: 'base',
      amount_wei: '100000000',
      from_address: '0xED306e38BB930ec9646FF3D917B2e513a97530b1',
      expiry_time: '60',
      version: '6',
    });
    expect(requests[0].init.headers).to.deep.equal({ apiKey: 'key' });
    expect(quote.buyAmount).to.equal(37100000000000000n);
    expect(quote.allowanceTarget).to.equal(ROUTER);
    expect(quote.customData.tx).to.deep.equal({ to: ROUTER, calldata: '0xaf706539', value: 0n });
  });

  when('Native cannot quote the pair', () => {
    then('the quote fails with Native error message', async () => {
      const { fetchService } = createRecordingFetch({ '/firm-quote': { body: { success: false, errorMessage: 'Pair not supported' } } });
      await expect(source.quote(createEvmQuoteParams<any, any>({ fetchService, config: { apiKey: 'key' } }))).to.be.rejectedWith(
        'Pair not supported'
      );
    });
  });
});
