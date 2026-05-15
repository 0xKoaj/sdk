import { Chains, getChainByKey } from '@chains';
import { Address } from '@types';
import { Addresses } from '@shared/constants';
import { isSameAddress, calculateDeadline } from '@shared/utils';
import { QuoteParams, QuoteSourceMetadata, SourceQuoteResponse, SourceQuoteTransaction, BuildTxParams } from './types';
import { addQuoteSlippage, calculateAllowanceTarget, failed } from './utils';
import { AlwaysValidConfigAndContextSource } from './base/always-valid-source';
import { encodeFunctionData, keccak256, encodeAbiParameters, concat, type Address as ViemAddress, toHex, pad } from 'viem';

// Same contracts as CoW Swap
const VAULT_RELAYER: ViemAddress = '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110';
const GPV2_SETTLEMENT: ViemAddress = '0x9008D19f58AAbD9eD0D60971565AA8510560ab41';

const API_ENDPOINTS: Record<number, string> = {
  [Chains.ETHEREUM.chainId]: 'https://api.cow.fi/mainnet/api/v1',
  [Chains.GNOSIS.chainId]: 'https://api.cow.fi/xdai/api/v1',
  [Chains.ARBITRUM.chainId]: 'https://api.cow.fi/arbitrum_one/api/v1',
  [Chains.BASE.chainId]: 'https://api.cow.fi/base/api/v1',
};

const DEFAULT_APP_DATA = '0x0000000000000000000000000000000000000000000000000000000000000000';

const COW_AMM_METADATA: QuoteSourceMetadata<CowAMMSupport> = {
  name: 'CoW AMM',
  supports: {
    chains: [
      Chains.ETHEREUM.chainId,
      Chains.GNOSIS.chainId,
      Chains.ARBITRUM.chainId,
      Chains.BASE.chainId,
    ],
    swapAndTransfer: true,
    buyOrders: true,
  },
  logoURI: 'ipfs://bafkreih75uruzdjtculei5md434pvtbw66gkzwcjb53kjgj4gz7xicuw54',
};

type CowAMMSupport = { buyOrders: true; swapAndTransfer: true };
type CowAMMConfig = { appData?: string };
type CowAMMData = {
  orderUid: string;
  order: CowOrder;
  validTo: number;
};

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

// Uses priceQuality: 'verified' — triggers on-chain solver simulation,
// giving CoW AMM pools a chance to compete and surface better rates.
export class CowAMMQuoteSource extends AlwaysValidConfigAndContextSource<CowAMMSupport, CowAMMConfig, CowAMMData> {
  getMetadata() {
    return COW_AMM_METADATA;
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
  }: QuoteParams<CowAMMSupport, CowAMMConfig>): Promise<SourceQuoteResponse<CowAMMData>> {
    const evmChainId = chainId as number;
    const apiEndpoint = API_ENDPOINTS[evmChainId];

    if (!apiEndpoint) {
      failed(COW_AMM_METADATA, chainId, sellToken, buyToken, `Unsupported chain: ${chainId}`);
    }

    const chain = getChainByKey(chainId);
    if (!chain) {
      failed(COW_AMM_METADATA, chainId, sellToken, buyToken, `Unknown chain: ${chainId}`);
    }

    const sellTokenMapped = isSameAddress(sellToken, Addresses.NATIVE_TOKEN) ? chain.wToken : sellToken;
    const buyTokenMapped = isSameAddress(buyToken, Addresses.NATIVE_TOKEN) ? chain.wToken : buyToken;

    const recipientAddress = recipient ?? takeFrom;
    const validTo = calculateDeadline(txValidFor ?? '30m');
    const appData = config?.appData ?? DEFAULT_APP_DATA;

    const quoteRequest = {
      sellToken: sellTokenMapped,
      buyToken: buyTokenMapped,
      receiver: recipientAddress,
      appData,
      from: takeFrom,
      priceQuality: 'verified', // triggers on-chain simulation for CoW AMM pool competition
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
      failed(COW_AMM_METADATA, chainId, sellToken, buyToken, errorText || `Failed with status ${response.status}`);
    }

    const quoteResponse: CowQuoteResponse = await response.json();
    const cowOrder = quoteResponse.quote;

    const orderDigest = computeOrderDigest(cowOrder, evmChainId);
    const orderUid = computeOrderUid(orderDigest, takeFrom as ViemAddress, cowOrder.validTo);

    const sellAmount = BigInt(cowOrder.sellAmount);
    const buyAmount = BigInt(cowOrder.buyAmount);
    const feeAmount = BigInt(cowOrder.feeAmount);
    const totalSellAmount = sellAmount + feeAmount;

    const quote = {
      sellAmount: totalSellAmount,
      buyAmount,
      estimatedGas: 100_000n,
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

  async buildTx({ request: { customData } }: BuildTxParams<CowAMMConfig, CowAMMData>): Promise<SourceQuoteTransaction> {
    const { orderUid } = customData;

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

function computeOrderDigest(order: CowQuoteResponse['quote'], chainId: number): `0x${string}` {
  const ORDER_TYPE_HASH = keccak256(
    toHex(
      'Order(address sellToken,address buyToken,address receiver,uint256 sellAmount,uint256 buyAmount,uint32 validTo,bytes32 appData,uint256 feeAmount,string kind,bool partiallyFillable,string sellTokenBalance,string buyTokenBalance)'
    )
  );

  const DOMAIN_SEPARATOR = computeDomainSeparator(chainId);

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

  return keccak256(concat(['0x1901', DOMAIN_SEPARATOR, orderStructHash]));
}

function computeDomainSeparator(chainId: number): `0x${string}` {
  const DOMAIN_TYPE_HASH = keccak256(toHex('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'));

  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
      [DOMAIN_TYPE_HASH, keccak256(toHex('Gnosis Protocol')), keccak256(toHex('v2')), BigInt(chainId), GPV2_SETTLEMENT]
    )
  );
}

function computeOrderUid(orderDigest: `0x${string}`, owner: ViemAddress, validTo: number): `0x${string}` {
  const validToHex = pad(toHex(validTo), { size: 4 });
  return concat([orderDigest, owner, validToHex]) as `0x${string}`;
}

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
