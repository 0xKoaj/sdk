import { Chains } from '@chains';
import { Address, TokenAddress } from '@types';
import { Addresses } from '@shared/constants';
import { isSameAddress, timeToSeconds } from '@shared/utils';
import { QuoteParams, QuoteSourceMetadata, SourceQuoteResponse, SourceQuoteTransaction, BuildTxParams } from './types';
import { addQuoteSlippage, calculateAllowanceTarget, failed } from './utils';
import { AlwaysValidConfigAndContextSource } from './base/always-valid-source';
import { encodeFunctionData, parseAbi, decodeFunctionResult, type Address as ViemAddress } from 'viem';

// Aerodrome V2 Router on Base
const AERODROME_ROUTER: ViemAddress = '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43';
// Default Pool Factory
const AERODROME_FACTORY: ViemAddress = '0x420DD381b31aEf6683db6B902084cB0FFECe40Da';
// WETH on Base
const WETH_BASE: ViemAddress = '0x4200000000000000000000000000000000000006';

const AERODROME_METADATA: QuoteSourceMetadata<AerodromeSupport> = {
  name: 'Aerodrome',
  supports: {
    chains: [Chains.BASE.chainId],
    swapAndTransfer: true,
    buyOrders: false, // Aerodrome router doesn't support exact output swaps
  },
  logoURI: 'ipfs://QmYxngew4pLRn7Gf4FNEj87xPUbqFZ5r93Mzv6T2VbUC1X', // Aerodrome logo
};

type AerodromeSupport = { buyOrders: false; swapAndTransfer: true };
type AerodromeConfig = {};

// Route struct for Aerodrome
interface Route {
  from: ViemAddress;
  to: ViemAddress;
  stable: boolean;
  factory: ViemAddress;
}

type AerodromeData = {
  routes: Route[];
  amountOutMin: bigint;
  deadline: bigint;
  recipient: ViemAddress;
  isNativeIn: boolean;
  isNativeOut: boolean;
};

export class AerodromeQuoteSource extends AlwaysValidConfigAndContextSource<AerodromeSupport, AerodromeConfig, AerodromeData> {
  getMetadata() {
    return AERODROME_METADATA;
  }

  async quote({
    components: { providerService },
    request: {
      chainId,
      sellToken,
      buyToken,
      order,
      config: { slippagePercentage, timeout, txValidFor },
      accounts: { takeFrom, recipient },
    },
  }: QuoteParams<AerodromeSupport, AerodromeConfig>): Promise<SourceQuoteResponse<AerodromeData>> {
    // Aerodrome only supports Base (EVM chain with numeric chainId)
    const evmChainId = chainId as number;

    const isNativeIn = isSameAddress(sellToken, Addresses.NATIVE_TOKEN);
    const isNativeOut = isSameAddress(buyToken, Addresses.NATIVE_TOKEN);

    // Map native token to WETH for routing
    const tokenIn: ViemAddress = isNativeIn ? WETH_BASE : (sellToken as ViemAddress);
    const tokenOut: ViemAddress = isNativeOut ? WETH_BASE : (buyToken as ViemAddress);

    const sellAmount = order.sellAmount;
    const recipientAddress: ViemAddress = (recipient ?? takeFrom) as ViemAddress;

    // Try both stable and volatile pools, pick the best
    const [volatileResult, stableResult] = await Promise.allSettled([
      this.getAmountsOut(providerService, evmChainId, sellAmount, tokenIn, tokenOut, false),
      this.getAmountsOut(providerService, evmChainId, sellAmount, tokenIn, tokenOut, true),
    ]);

    let buyAmount: bigint;
    let stable: boolean;

    const volatileAmount = volatileResult.status === 'fulfilled' ? volatileResult.value : 0n;
    const stableAmount = stableResult.status === 'fulfilled' ? stableResult.value : 0n;

    if (volatileAmount === 0n && stableAmount === 0n) {
      failed(AERODROME_METADATA, chainId, sellToken, buyToken, 'No liquidity found in Aerodrome pools');
    }

    // Pick the pool with better output
    if (stableAmount > volatileAmount) {
      buyAmount = stableAmount;
      stable = true;
    } else {
      buyAmount = volatileAmount;
      stable = false;
    }

    const routes: Route[] = [
      {
        from: tokenIn,
        to: tokenOut,
        stable,
        factory: AERODROME_FACTORY,
      },
    ];

    // Calculate deadline (default 3 hours)
    const deadline = BigInt(Math.floor(Date.now() / 1000) + timeToSeconds(txValidFor ?? '3h'));

    const quote = {
      sellAmount,
      buyAmount,
      estimatedGas: isNativeIn || isNativeOut ? 180_000n : 150_000n, // Approximate gas
      allowanceTarget: calculateAllowanceTarget(sellToken, AERODROME_ROUTER),
      customData: {
        routes,
        amountOutMin: 0n, // Will be calculated with slippage in buildTx
        deadline,
        recipient: recipientAddress,
        isNativeIn,
        isNativeOut,
      },
    };

    return addQuoteSlippage(quote, 'sell', slippagePercentage);
  }

  async buildTx({
    request: {
      sellAmount,
      minBuyAmount,
      customData: { routes, deadline, recipient, isNativeIn, isNativeOut },
    },
  }: BuildTxParams<AerodromeConfig, AerodromeData>): Promise<SourceQuoteTransaction> {
    let calldata: string;
    let value: bigint | undefined;

    if (isNativeIn) {
      // swapExactETHForTokens
      calldata = encodeFunctionData({
        abi: ROUTER_ABI,
        functionName: 'swapExactETHForTokens',
        args: [minBuyAmount, routes, recipient, deadline],
      });
      value = sellAmount;
    } else if (isNativeOut) {
      // swapExactTokensForETH
      calldata = encodeFunctionData({
        abi: ROUTER_ABI,
        functionName: 'swapExactTokensForETH',
        args: [sellAmount, minBuyAmount, routes, recipient, deadline],
      });
    } else {
      // swapExactTokensForTokens
      calldata = encodeFunctionData({
        abi: ROUTER_ABI,
        functionName: 'swapExactTokensForTokens',
        args: [sellAmount, minBuyAmount, routes, recipient, deadline],
      });
    }

    return {
      to: AERODROME_ROUTER,
      calldata,
      value,
    };
  }

  private async getAmountsOut(
    providerService: QuoteParams<AerodromeSupport>['components']['providerService'],
    chainId: number,
    amountIn: bigint,
    tokenIn: ViemAddress,
    tokenOut: ViemAddress,
    stable: boolean
  ): Promise<bigint> {
    const routes: Route[] = [
      {
        from: tokenIn,
        to: tokenOut,
        stable,
        factory: AERODROME_FACTORY,
      },
    ];

    const calldata = encodeFunctionData({
      abi: ROUTER_ABI,
      functionName: 'getAmountsOut',
      args: [amountIn, routes],
    });

    try {
      const result = await providerService.getViemPublicClient({ chainId }).call({
        to: AERODROME_ROUTER,
        data: calldata,
      });

      if (!result.data) {
        return 0n;
      }

      const decoded = decodeFunctionResult({
        abi: ROUTER_ABI,
        functionName: 'getAmountsOut',
        data: result.data,
      }) as bigint[];

      // getAmountsOut returns [amountIn, amountOut] for a single hop
      return decoded[decoded.length - 1];
    } catch {
      // Pool doesn't exist or has no liquidity
      return 0n;
    }
  }
}

// Aerodrome Router ABI (relevant functions only)
const ROUTER_HUMAN_READABLE_ABI = [
  // Route struct: (address from, address to, bool stable, address factory)
  'function getAmountsOut(uint256 amountIn, tuple(address from, address to, bool stable, address factory)[] routes) view returns (uint256[] amounts)',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, tuple(address from, address to, bool stable, address factory)[] routes, address to, uint256 deadline) returns (uint256[] amounts)',
  'function swapExactETHForTokens(uint256 amountOutMin, tuple(address from, address to, bool stable, address factory)[] routes, address to, uint256 deadline) payable returns (uint256[] amounts)',
  'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, tuple(address from, address to, bool stable, address factory)[] routes, address to, uint256 deadline) returns (uint256[] amounts)',
];

const ROUTER_ABI = parseAbi(ROUTER_HUMAN_READABLE_ABI);
