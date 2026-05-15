import { Chains, getChainByKey } from '@chains';
import { IQuoteSource, QuoteParams, QuoteSourceMetadata, SourceQuoteResponse, SourceQuoteTransaction, BuildTxParams } from './types';
import { calculateAllowanceTarget, failed } from './utils';
import { Addresses } from '@shared/constants';
import { isSameAddress } from '@shared/utils';

const PENDLE_API_URL = 'https://api-v2.pendle.finance/core';

const PENDLE_METADATA: QuoteSourceMetadata<PendleSupport> = {
  name: 'Pendle',
  supports: {
    chains: [
      Chains.ETHEREUM.chainId,
      Chains.ARBITRUM.chainId,
      Chains.BNB_CHAIN.chainId,
      Chains.OPTIMISM.chainId,
      Chains.BASE.chainId,
      Chains.MANTLE.chainId,
      Chains.SONIC.chainId,
    ],
    swapAndTransfer: true,
    buyOrders: false,
  },
  logoURI: 'ipfs://QmXhFJmjkBqBKb4YXpDHAGS2YKwW7uZiZtpATcWmjVnPV8',
};

type PendleConfig = {};
type PendleSupport = { buyOrders: false; swapAndTransfer: true };
type PendleData = { tx: SourceQuoteTransaction };

export class PendleQuoteSource implements IQuoteSource<PendleSupport, PendleConfig, PendleData> {
  getMetadata() {
    return PENDLE_METADATA;
  }

  async quote({ components: { fetchService }, request }: QuoteParams<PendleSupport, PendleConfig>): Promise<SourceQuoteResponse<PendleData>> {
    const {
      chainId,
      sellToken,
      buyToken,
      order,
      accounts: { takeFrom, recipient },
      config: { slippagePercentage, timeout },
    } = request;

    const chain = getChainByKey(chainId);
    if (!chain) {
      failed(PENDLE_METADATA, chainId, sellToken, buyToken, `Unknown chain: ${chainId}`);
    }

    // Pendle doesn't handle raw native tokens — map to wrapped native
    const tokenIn = isSameAddress(sellToken, Addresses.NATIVE_TOKEN) ? chain.wToken : sellToken;
    const tokenOut = isSameAddress(buyToken, Addresses.NATIVE_TOKEN) ? chain.wToken : buyToken;

    // Pendle slippage is 0-1 (e.g. 0.005 = 0.5%)
    const slippage = slippagePercentage / 100;

    const body = {
      receiver: recipient ?? takeFrom,
      slippage,
      enableAggregator: true,
      inputs: [{ token: tokenIn, amount: order.sellAmount.toString() }],
      outputs: [tokenOut],
    };

    const response = await fetchService.fetch(`${PENDLE_API_URL}/v3/${chainId}/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeout,
    });

    if (!response.ok) {
      failed(PENDLE_METADATA, chainId, sellToken, buyToken, await response.text());
    }

    const data = await response.json();
    const route = data.routes?.[0];

    if (!route?.tx || !route.outputs?.[0]) {
      failed(PENDLE_METADATA, chainId, sellToken, buyToken, 'No route found');
    }

    const buyAmount = BigInt(route.outputs[0].amount);
    // Pendle enforces min amount on-chain based on slippage; mirror it here
    const slippageBps = BigInt(Math.round(slippagePercentage * 100));
    const minBuyAmount = (buyAmount * (10000n - slippageBps)) / 10000n;

    return {
      sellAmount: order.sellAmount,
      maxSellAmount: order.sellAmount,
      buyAmount,
      minBuyAmount,
      estimatedGas: 350000n,
      allowanceTarget: calculateAllowanceTarget(sellToken, route.tx.to),
      type: 'sell',
      customData: {
        tx: {
          to: route.tx.to,
          calldata: route.tx.data,
          value: BigInt(route.tx.value ?? '0'),
        },
      },
    };
  }

  async buildTx({ request }: BuildTxParams<PendleConfig, PendleData>): Promise<SourceQuoteTransaction> {
    return request.customData.tx;
  }

  isConfigAndContextValidForQuoting(_config: Partial<PendleConfig> | undefined): _config is PendleConfig {
    return true;
  }

  isConfigAndContextValidForTxBuilding(_config: Partial<PendleConfig> | undefined): _config is PendleConfig {
    return true;
  }
}
