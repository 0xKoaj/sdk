import { Chains } from '@chains';
import { ChainId, TokenAddress } from '@types';
import { Addresses } from '@shared/constants';
import { isSameAddress, subtractPercentage, timeToSeconds } from '@shared/utils';
import { QuoteParams, QuoteSourceMetadata, SourceQuoteResponse, SourceQuoteTransaction, BuildTxParams } from './types';
import { addQuoteSlippage, calculateAllowanceTarget, failed } from './utils';
import { AlwaysValidConfigAndContextSource } from './base/always-valid-source';
import { getChainByKey } from '@chains';

const UNISWAP_V4_CHAINS: ChainId[] = [
  Chains.ETHEREUM.chainId,
  Chains.OPTIMISM.chainId,
  Chains.POLYGON.chainId,
  Chains.ARBITRUM.chainId,
  Chains.BASE.chainId,
  Chains.BNB_CHAIN.chainId,
  Chains.AVALANCHE.chainId,
  Chains.UNICHAIN.chainId,
];

const UNISWAP_V4_METADATA: QuoteSourceMetadata<UniswapV4Support> = {
  name: 'Uniswap v4',
  supports: {
    chains: UNISWAP_V4_CHAINS,
    swapAndTransfer: true,
    buyOrders: true,
  },
  logoURI: 'ipfs://QmNa3YBYAYS5qSCLuXataV5XCbtxP9ZB4rHUfomRxrpRhJ',
};

type UniswapV4Support = { buyOrders: true; swapAndTransfer: true };
type UniswapV4Config = {};
type UniswapV4Data = { tx: SourceQuoteTransaction };

export class UniswapV4QuoteSource extends AlwaysValidConfigAndContextSource<UniswapV4Support, UniswapV4Config, UniswapV4Data> {
  getMetadata() {
    return UNISWAP_V4_METADATA;
  }

  async quote({
    components: { fetchService },
    request: {
      chainId,
      sellToken,
      buyToken,
      order,
      config: { slippagePercentage, timeout, txValidFor },
      accounts: { takeFrom, recipient },
    },
  }: QuoteParams<UniswapV4Support>): Promise<SourceQuoteResponse<UniswapV4Data>> {
    const isSellTokenNative = isSameAddress(sellToken, Addresses.NATIVE_TOKEN);
    const isBuyTokenNative = isSameAddress(buyToken, Addresses.NATIVE_TOKEN);

    const chain = getChainByKey(chainId);
    const tokenIn = isSellTokenNative && chain ? chain.wToken : sellToken;
    const tokenOut = isBuyTokenNative && chain ? chain.wToken : buyToken;

    const amount = order.type === 'sell' ? order.sellAmount : order.buyAmount;
    const deadline = Math.floor(Date.now() / 1000) + timeToSeconds(txValidFor ?? '3h');

    recipient = recipient ?? takeFrom;

    const body = {
      tokenInChainId: chainId,
      tokenOutChainId: chainId,
      tokenIn,
      tokenOut,
      amount: amount.toString(),
      sendPortionEnabled: false,
      type: order.type === 'sell' ? 'EXACT_INPUT' : 'EXACT_OUTPUT',
      intent: 'quote',
      configs: [
        {
          protocols: ['V4'],
          routingType: 'CLASSIC',
          recipient,
          slippageTolerance: slippagePercentage.toString(),
          deadline,
          enableUniversalRouter: true,
        },
      ],
    };

    const headers = {
      'content-type': 'application/json',
      origin: 'https://app.uniswap.org',
      referer: 'https://app.uniswap.org/',
    };

    const response = await fetchService.fetch('https://api.uniswap.org/v2/quote', {
      method: 'POST',
      body: JSON.stringify(body),
      headers,
      timeout,
    });

    if (!response.ok) {
      failed(UNISWAP_V4_METADATA, chainId, sellToken, buyToken, await response.text());
    }

    const data = await response.json();
    const quoteData = data.quote;

    if (!quoteData?.methodParameters) {
      failed(UNISWAP_V4_METADATA, chainId, sellToken, buyToken, 'No v4 route found for this pair');
    }

    const { calldata, to: routerAddress, value: rawValue } = quoteData.methodParameters;

    const quotedAmount =
      order.type === 'sell'
        ? quoteData.output?.amount ?? quoteData.quoteDecimals
        : quoteData.input?.amount ?? quoteData.quoteDecimals;

    const sellAmount = order.type === 'sell' ? order.sellAmount : BigInt(quotedAmount);
    const buyAmount = order.type === 'sell' ? BigInt(quotedAmount) : order.buyAmount;
    const value = isSellTokenNative ? sellAmount : undefined;

    const gasUseEstimate = BigInt(quoteData.gasUseEstimate ?? quoteData.gasEstimate ?? 200_000);

    const quote = {
      sellAmount,
      buyAmount,
      estimatedGas: gasUseEstimate,
      allowanceTarget: calculateAllowanceTarget(sellToken, routerAddress),
      customData: {
        tx: {
          to: routerAddress as `0x${string}`,
          calldata: calldata as `0x${string}`,
          value,
        },
      },
    };

    return addQuoteSlippage(quote, order.type, slippagePercentage);
  }

  async buildTx({ request }: BuildTxParams<UniswapV4Config, UniswapV4Data>): Promise<SourceQuoteTransaction> {
    return request.customData.tx;
  }
}
