import { Chains, getChainByKey } from '@chains';
import { Address, TokenAddress } from '@types';
import { Addresses } from '@shared/constants';
import { isSameAddress, calculateDeadline } from '@shared/utils';
import { QuoteParams, QuoteSourceMetadata, SourceQuoteResponse, SourceQuoteTransaction, BuildTxParams } from './types';
import { addQuoteSlippage, calculateAllowanceTarget, failed } from './utils';
import { AlwaysValidConfigAndContextSource } from './base/always-valid-source';
import { encodeFunctionData, keccak256, encodeAbiParameters, concat, type Address as ViemAddress, toHex, pad } from 'viem';

// Contract addresses (same on all supported chains)
const VAULT_RELAYER: ViemAddress = '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110';
const GPV2_SETTLEMENT: ViemAddress = '0x9008D19f58AAbD9eD0D60971565AA8510560ab41';

// API endpoints by chainId
const API_ENDPOINTS: Record<number, string> = {
  [Chains.ETHEREUM.chainId]: 'https://api.cow.fi/mainnet/api/v1',
  [Chains.GNOSIS.chainId]: 'https://api.cow.fi/xdai/api/v1',
  [Chains.ARBITRUM.chainId]: 'https://api.cow.fi/arbitrum_one/api/v1',
  [Chains.BASE.chainId]: 'https://api.cow.fi/base/api/v1',
  [Chains.ETHEREUM_SEPOLIA.chainId]: 'https://api.cow.fi/sepolia/api/v1',
};

// Default appData hash (empty metadata)
const DEFAULT_APP_DATA = '0x0000000000000000000000000000000000000000000000000000000000000000';

const COW_SWAP_METADATA: QuoteSourceMetadata<CowSwapSupport> = {
  name: 'CoW Swap',
  supports: {
    chains: [
      Chains.ETHEREUM.chainId,
      Chains.GNOSIS.chainId,
      Chains.ARBITRUM.chainId,
      Chains.BASE.chainId,
      Chains.ETHEREUM_SEPOLIA.chainId,
    ],
    swapAndTransfer: true,
    buyOrders: true,
  },
  logoURI: 'ipfs://bafkreih75uruzdjtculei5md434pvtbw66gkzwcjb53kjgj4gz7xicuw54',
};

type CowSwapSupport = { buyOrders: true; swapAndTransfer: true };
type CowSwapConfig = { appData?: string };

// CoW Protocol Order struct
interface CowOrder {
  sellToken: ViemAddress;
  buyToken: ViemAddress;
  receiver: ViemAddress;
  sellAmount: string;
  buyAmount: string;
  validTo: number;
  appData: string;
  feeAmount: string;
  kind: 'sell' | 'buy';
  partiallyFillable: boolean;
  sellTokenBalance: 'erc20' | 'internal' | 'external';
  buyTokenBalance: 'erc20' | 'internal';
}

type CowSwapData = {
  orderUid: string;
  order: CowOrder;
  validTo: number;
};

// API response types
interface CowQuoteResponse {
  quote: {
    sellToken: string;
    buyToken: string;
    receiver: string;
    sellAmount: string;
    buyAmount: string;
    validTo: number;
    appData: string;
    feeAmount: string;
    kind: 'sell' | 'buy';
    partiallyFillable: boolean;
    sellTokenBalance: 'erc20' | 'internal' | 'external';
    buyTokenBalance: 'erc20' | 'internal';
  };
  from: string;
  expiration: string;
  id: number;
}

export class CowSwapQuoteSource extends AlwaysValidConfigAndContextSource<CowSwapSupport, CowSwapConfig, CowSwapData> {
  getMetadata() {
    return COW_SWAP_METADATA;
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
    config,
  }: QuoteParams<CowSwapSupport, CowSwapConfig>): Promise<SourceQuoteResponse<CowSwapData>> {
    const evmChainId = chainId as number;
    const apiEndpoint = API_ENDPOINTS[evmChainId];

    if (!apiEndpoint) {
      failed(COW_SWAP_METADATA, chainId, sellToken, buyToken, `Unsupported chain: ${chainId}`);
    }

    // Map native tokens to wrapped versions
    const chain = getChainByKey(chainId);
    if (!chain) {
      failed(COW_SWAP_METADATA, chainId, sellToken, buyToken, `Unknown chain: ${chainId}`);
    }

    const sellTokenMapped = isSameAddress(sellToken, Addresses.NATIVE_TOKEN) ? chain.wToken : sellToken;
    const buyTokenMapped = isSameAddress(buyToken, Addresses.NATIVE_TOKEN) ? chain.wToken : buyToken;

    const recipientAddress = recipient ?? takeFrom;
    const validTo = calculateDeadline(txValidFor ?? '30m');
    const appData = config?.appData ?? DEFAULT_APP_DATA;

    // Build quote request
    const quoteRequest = {
      sellToken: sellTokenMapped,
      buyToken: buyTokenMapped,
      receiver: recipientAddress,
      appData,
      from: takeFrom,
      priceQuality: 'optimal',
      signingScheme: 'presign',
      onchainOrder: false,
      ...(order.type === 'sell'
        ? { kind: 'sell', sellAmountBeforeFee: order.sellAmount.toString() }
        : { kind: 'buy', buyAmountAfterFee: order.buyAmount.toString() }),
    };

    const response = await fetchService.fetch(`${apiEndpoint}/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(quoteRequest),
      timeout,
    });

    if (!response.ok) {
      const errorText = await response.text();
      failed(COW_SWAP_METADATA, chainId, sellToken, buyToken, errorText || `Failed with status ${response.status}`);
    }

    const quoteResponse: CowQuoteResponse = await response.json();
    const cowOrder = quoteResponse.quote;

    // Calculate orderUid (56 bytes: orderDigest + owner + validTo)
    const orderDigest = computeOrderDigest(cowOrder, evmChainId);
    const orderUid = computeOrderUid(orderDigest, takeFrom as ViemAddress, cowOrder.validTo);

    // Calculate amounts accounting for fee
    const sellAmount = BigInt(cowOrder.sellAmount);
    const buyAmount = BigInt(cowOrder.buyAmount);
    const feeAmount = BigInt(cowOrder.feeAmount);

    // For sell orders: sellAmount includes the fee deducted
    // For buy orders: we need to sell enough to cover the buy + fee
    const totalSellAmount = sellAmount + feeAmount;

    const quote = {
      sellAmount: totalSellAmount,
      buyAmount,
      estimatedGas: 100_000n, // Pre-sign transaction is relatively cheap
      allowanceTarget: calculateAllowanceTarget(sellToken, VAULT_RELAYER),
      customData: {
        orderUid,
        order: {
          sellToken: cowOrder.sellToken as ViemAddress,
          buyToken: cowOrder.buyToken as ViemAddress,
          receiver: cowOrder.receiver as ViemAddress,
          sellAmount: cowOrder.sellAmount,
          buyAmount: cowOrder.buyAmount,
          validTo: cowOrder.validTo,
          appData: cowOrder.appData,
          feeAmount: cowOrder.feeAmount,
          kind: cowOrder.kind,
          partiallyFillable: cowOrder.partiallyFillable,
          sellTokenBalance: cowOrder.sellTokenBalance,
          buyTokenBalance: cowOrder.buyTokenBalance,
        },
        validTo: cowOrder.validTo,
      },
    };

    return addQuoteSlippage(quote, order.type, slippagePercentage);
  }

  async buildTx({ request: { customData } }: BuildTxParams<CowSwapConfig, CowSwapData>): Promise<SourceQuoteTransaction> {
    const { orderUid } = customData;

    // Generate calldata for setPreSignature(orderUid, true)
    const calldata = encodeFunctionData({
      abi: GPV2_SETTLEMENT_ABI,
      functionName: 'setPreSignature',
      args: [orderUid as `0x${string}`, true],
    });

    return {
      to: GPV2_SETTLEMENT,
      calldata,
    };
  }
}

// Compute the EIP-712 order digest
function computeOrderDigest(order: CowQuoteResponse['quote'], chainId: number): `0x${string}` {
  const ORDER_TYPE_HASH = keccak256(
    toHex(
      'Order(address sellToken,address buyToken,address receiver,uint256 sellAmount,uint256 buyAmount,uint32 validTo,bytes32 appData,uint256 feeAmount,string kind,bool partiallyFillable,string sellTokenBalance,string buyTokenBalance)'
    )
  );

  const DOMAIN_SEPARATOR = computeDomainSeparator(chainId);

  // Hash the order struct
  const orderStructHash = keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'address' },
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint32' },
        { type: 'bytes32' },
        { type: 'uint256' },
        { type: 'bytes32' },
        { type: 'bool' },
        { type: 'bytes32' },
        { type: 'bytes32' },
      ],
      [
        ORDER_TYPE_HASH,
        order.sellToken as ViemAddress,
        order.buyToken as ViemAddress,
        order.receiver as ViemAddress,
        BigInt(order.sellAmount),
        BigInt(order.buyAmount),
        order.validTo,
        order.appData as `0x${string}`,
        BigInt(order.feeAmount),
        keccak256(toHex(order.kind)),
        order.partiallyFillable,
        keccak256(toHex(order.sellTokenBalance)),
        keccak256(toHex(order.buyTokenBalance)),
      ]
    )
  );

  // EIP-712 typed data hash
  return keccak256(concat(['0x1901', DOMAIN_SEPARATOR, orderStructHash]));
}

// Compute the EIP-712 domain separator for GPv2Settlement
function computeDomainSeparator(chainId: number): `0x${string}` {
  const DOMAIN_TYPE_HASH = keccak256(toHex('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'));

  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
      [DOMAIN_TYPE_HASH, keccak256(toHex('Gnosis Protocol')), keccak256(toHex('v2')), BigInt(chainId), GPV2_SETTLEMENT]
    )
  );
}

// Compute orderUid: 56 bytes = orderDigest (32) + owner (20) + validTo (4)
function computeOrderUid(orderDigest: `0x${string}`, owner: ViemAddress, validTo: number): `0x${string}` {
  const validToHex = pad(toHex(validTo), { size: 4 });
  return concat([orderDigest, owner, validToHex]) as `0x${string}`;
}

// GPv2Settlement ABI (only setPreSignature function)
const GPV2_SETTLEMENT_ABI = [
  {
    inputs: [
      { name: 'orderUid', type: 'bytes' },
      { name: 'signed', type: 'bool' },
    ],
    name: 'setPreSignature',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;
