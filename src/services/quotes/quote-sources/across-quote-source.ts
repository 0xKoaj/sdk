import { Chains } from '@chains';
import { IQuoteSource, QuoteParams, QuoteSourceMetadata, SourceQuoteResponse, SourceQuoteTransaction, BuildTxParams } from './types';
import { failed } from './utils';
import { IFetchService } from '@services/fetch';
import { Address, ChainId, TimeString } from '@types';
import { Addresses } from '@shared/constants';
import { isSameAddress } from '@shared/utils';
import { encodeFunctionData } from 'viem';

const ACROSS_API_URL = 'https://app.across.to/api';

// SpokePool V3 contract addresses per chain.
// Source: https://docs.across.to/concepts/contract-addresses
const SPOKE_POOL_ADDRESSES: Record<number, Address> = {
  1: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5',      // Ethereum
  10: '0x6f26Bf09B1C792e3228e5467807a900A503c0281',     // Optimism
  137: '0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096',    // Polygon
  8453: '0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64',   // Base
  42161: '0xe35e9842fceaCA96570B734083f4a58e8F7C5f2a',  // Arbitrum
  59144: '0x7E63A5f1a8F0B4d0934B2f2327DAED3F6bb2ee75', // Linea
  534352: '0x3baD7AD0728f9917d1Bf08af5782dCbD516cDd96', // Scroll
  81457: '0x2D509190Ed0172ba588407D4c2df918F955Cc6E1',  // Blast
  34443: '0x3baD7AD0728f9917d1Bf08af5782dCbD516cDd96',  // Mode
};

const DEPOSIT_V3_ABI = [
  {
    name: 'depositV3',
    type: 'function',
    inputs: [
      { name: 'depositor', type: 'address' },
      { name: 'recipient', type: 'address' },
      { name: 'inputToken', type: 'address' },
      { name: 'outputToken', type: 'address' },
      { name: 'inputAmount', type: 'uint256' },
      { name: 'outputAmount', type: 'uint256' },
      { name: 'destinationChainId', type: 'uint256' },
      { name: 'exclusiveRelayer', type: 'address' },
      { name: 'quoteTimestamp', type: 'uint32' },
      { name: 'fillDeadline', type: 'uint32' },
      { name: 'exclusivityDeadline', type: 'uint32' },
      { name: 'message', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
] as const;

// Chains supported for same-chain swaps via Across.
// Across also supports cross-chain; the SDK will pass buyTokenChainId for that.
const SAME_CHAIN_SUPPORT = [
  Chains.ETHEREUM,
  Chains.OPTIMISM,
  Chains.POLYGON,
  Chains.BASE,
  Chains.ARBITRUM,
  Chains.LINEA,
  Chains.SCROLL,
  Chains.BLAST,
  Chains.MODE,
];

const ACROSS_METADATA: QuoteSourceMetadata<AcrossSupport> = {
  name: 'Across',
  supports: {
    chains: SAME_CHAIN_SUPPORT.map(({ chainId }) => chainId),
    swapAndTransfer: true,
    buyOrders: false,
  },
  logoURI: 'ipfs://QmX7UJB8VG27X4FHuKJPN3jZZFhvyGFo7zidBaUQGjx5oP',
};

type AcrossConfig = {};
type AcrossSupport = { buyOrders: false; swapAndTransfer: true };
type AcrossData = {
  tx: SourceQuoteTransaction;
  outputAmount: bigint;
};

export class AcrossQuoteSource implements IQuoteSource<AcrossSupport, AcrossConfig, AcrossData> {
  getMetadata() {
    return ACROSS_METADATA;
  }

  async quote({ components, request }: QuoteParams<AcrossSupport, AcrossConfig>): Promise<SourceQuoteResponse<AcrossData>> {
    const {
      chainId,
      buyTokenChainId,
      sellToken,
      buyToken,
      order,
      accounts: { takeFrom, recipient },
      config: { slippagePercentage, timeout },
    } = request;

    const destinationChainId = buyTokenChainId ?? chainId;
    const spokePoolAddress = SPOKE_POOL_ADDRESSES[chainId as number];
    if (!spokePoolAddress) {
      failed(ACROSS_METADATA, chainId, sellToken, buyToken, `No SpokePool on chain ${chainId}`);
    }

    const inputToken = mapToAcrossToken(sellToken);
    const outputToken = mapToAcrossToken(buyToken);
    const inputAmount = order.sellAmount.toString();

    // Fetch suggested fees & output amount from Across API.
    const params = new URLSearchParams({
      inputToken,
      outputToken,
      originChainId: chainId.toString(),
      destinationChainId: destinationChainId.toString(),
      amount: inputAmount,
      depositor: takeFrom,
      recipient: recipient ?? takeFrom,
    });

    const url = `${ACROSS_API_URL}/suggested-fees?${params.toString()}`;
    const response = await components.fetchService.fetch(url, {
      method: 'GET',
      timeout: timeout as TimeString | undefined,
    });

    if (!response.ok) {
      failed(ACROSS_METADATA, chainId, sellToken, buyToken, await response.text());
    }

    const data = await response.json();

    if (data.isAmountTooLow) {
      failed(ACROSS_METADATA, chainId, sellToken, buyToken, 'Amount too low for Across relayers');
    }

    // Calculate output amount: inputAmount - totalRelayFee.total
    const totalFeePct = BigInt(data.totalRelayFee?.pct ?? '0');
    const pctDivisor = BigInt('1000000000000000000'); // 1e18
    const feeAmount = (order.sellAmount * totalFeePct) / pctDivisor;
    const outputAmount = order.sellAmount - feeAmount;

    // Apply slippage to minBuyAmount
    const slippageBps = BigInt(Math.round(slippagePercentage * 100));
    const minBuyAmount = (outputAmount * (10000n - slippageBps)) / 10000n;

    const fillDeadline = data.fillDeadline ?? Math.floor(Date.now() / 1000) + 21600; // 6h default
    const quoteTimestamp = data.quoteTimestamp ?? Math.floor(Date.now() / 1000);
    const exclusivityDeadline = data.exclusivityDeadline ?? 0;
    const exclusiveRelayer: Address = data.exclusiveRelayer ?? Addresses.ZERO_ADDRESS;

    // Build depositV3 calldata for the origin SpokePool.
    const calldata = encodeFunctionData({
      abi: DEPOSIT_V3_ABI,
      functionName: 'depositV3',
      args: [
        takeFrom as `0x${string}`,
        (recipient ?? takeFrom) as `0x${string}`,
        inputToken as `0x${string}`,
        outputToken as `0x${string}`,
        order.sellAmount,
        outputAmount,
        BigInt(destinationChainId),
        exclusiveRelayer as `0x${string}`,
        quoteTimestamp,
        fillDeadline,
        exclusivityDeadline,
        '0x',
      ],
    });

    const isNativeInput = isSameAddress(sellToken, Addresses.NATIVE_TOKEN);

    return {
      sellAmount: order.sellAmount,
      maxSellAmount: order.sellAmount,
      buyAmount: outputAmount,
      minBuyAmount,
      estimatedGas: 150000n, // Across deposits typically use ~100-150k gas
      allowanceTarget: isNativeInput ? Addresses.ZERO_ADDRESS : spokePoolAddress,
      type: 'sell',
      customData: {
        tx: {
          to: spokePoolAddress,
          calldata,
          value: isNativeInput ? order.sellAmount : 0n,
        },
        outputAmount,
      },
    };
  }

  async buildTx({ request }: BuildTxParams<AcrossConfig, AcrossData>): Promise<SourceQuoteTransaction> {
    return request.customData.tx;
  }

  isConfigAndContextValidForQuoting(_config: Partial<AcrossConfig> | undefined): _config is AcrossConfig {
    return true;
  }

  isConfigAndContextValidForTxBuilding(_config: Partial<AcrossConfig> | undefined): _config is AcrossConfig {
    return true;
  }
}

function mapToAcrossToken(token: Address): Address {
  if (isSameAddress(token, Addresses.NATIVE_TOKEN)) {
    return Addresses.ZERO_ADDRESS as Address;
  }
  return token;
}
