# Web3 SDK

A comprehensive TypeScript SDK for interacting with the different contracts and accounts across multiple networks. Supports both **EVM chains** (Ethereum, Optimism, Arbitrum, etc.) and **Solana**.

## 🧪 Installation

### Yarn

```bash
yarn add @nchamo/sdk
```

### NPM

```bash
npm install @nchamo/sdk
```

## Quick Start

### 👷🏽‍♀️ Building the SDK

```typescript
import { buildSDK } from "@nchamo/sdk";

const sdk = buildSDK(config);
```

### ⚖️ Getting Balance for Multiple Tokens

```typescript
const accountBalances = await sdk.balanceService.getBalancesForTokens({
  account: "0x000000000000000000000000000000000000dead",
  tokens: {
    [Chains.ETHEREUM.chainId]: [
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC
      "0x6b175474e89094c44da98b954eedeac495271d0f", // DAI
    ],
    [Chains.OPTIMISM.chainId]: [
      "0x7f5c764cbc14f9669b88837ca1490cca17c31607", // USDC
      "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1", // DAI
    ],
  },
  config: {
    timeout: "30s",
  },
});
```

### 💸 Getting Allowances

```typescript
const accountAllowances = await sdk.allowanceService.getAllowances({
  chainId: Chains.ETHEREUM.chainId,
  token: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC
  owner: "0x000000000000000000000000000000000000dead",
  spenders: ["0x6666666600000000000000000000000000009999"],
});
```

### 🔄 Getting Trade Quotes (EVM)

```typescript
const allQuotes = await sdk.quoteService.getAllQuotesWithTxs({
  request: {
    chainId: Chains.ETHEREUM.chainId,
    sellToken: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    buyToken: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    order: {
      type: "sell",
      sellAmount: utils.parseUnits("1000", 6), // 1000 USDC
    },
    slippagePercentage: 1,
    takerAddress: signer.address,
    gasSpeed: {
      speed: "instant",
    },
  },
  config: {
    sort: {
      by: "most-swapped-accounting-for-gas",
    },
  },
});
```

### 🌞 Getting Trade Quotes (Solana)

```typescript
import { SolanaChains, SolanaAddresses } from "@nchamo/sdk";

const solanaQuotes = await sdk.quoteService.getAllQuotesWithTxs({
  request: {
    chainId: SolanaChains.SOLANA.chainId, // 'solana'
    sellToken: SolanaAddresses.NATIVE_SOL, // SOL
    buyToken: SolanaAddresses.USDC, // USDC on Solana
    order: {
      type: "sell",
      sellAmount: BigInt(1_000_000_000), // 1 SOL (9 decimals)
    },
    slippagePercentage: 1,
    takerAddress: "YourSolanaPublicKey...", // Solana wallet public key (base58)
  },
  config: {
    sourceConfig: {
      jupiter: {
        apiKey: process.env.JUPITER_API_KEY, // Required for Jupiter
      },
    },
  },
});
```

## Overview

The Web3 SDK provides efficient tools to manage token balances, retrieve trade quotes from DEX aggregators, and check token holdings across multiple chains. It's designed to be modular, with each functionality organized into specialized services that handle specific aspects of blockchain interaction.

### Multi-Chain Support

The SDK supports two types of blockchain networks:

- **EVM Chains**: Ethereum, Optimism, Arbitrum, Polygon, Base, BNB Chain, and 40+ other EVM-compatible networks
- **Solana**: Full support for Solana mainnet with Jupiter DEX aggregator integration

### Available Services

The SDK is divided into the following services:

- **[Allowances Service](#allowances-service)**: Manage token approvals and permissions across EVM chains
- **[Balances Service](#balances-service)**: Query token balances across multiple chains and tokens
- **[Quotes Service](#quotes-service)**: Get optimized swap quotes from various DEX aggregators (EVM and Solana)
- **[Gas Service](#gas-service)**: Optimize transaction costs and estimate gas prices (EVM only)
- **[Prices Service](#prices-service)**: Retrieve token price information across multiple chains
- **[Metadata Service](#metadata-service)**: Access token metadata and information

Each service provides a focused set of functionality while maintaining a consistent interface and error handling approach. This modular design allows developers to use only the services they need while ensuring a cohesive experience across the entire SDK.

## Multi-Chain Architecture

The SDK uses a unified type system to support both EVM and Solana chains.

### Chain Types

```typescript
import {
  Chains, // All chains (EVM + Solana)
  EVMChains, // Only EVM chains
  SolanaChains, // Only Solana chains
  isEVMChain, // Type guard for EVM chains
  isSolanaChain, // Type guard for Solana chains
} from "@nchamo/sdk";

// Access EVM chains
const ethereum = EVMChains.ETHEREUM; // chainId: 1 (number)
const optimism = EVMChains.OPTIMISM; // chainId: 10 (number)

// Access Solana chains
const solana = SolanaChains.SOLANA; // chainId: 'solana' (string)
const devnet = SolanaChains.SOLANA_DEVNET; // chainId: 'solana' (testnet)

// Combined access
const anyChain = Chains.ETHEREUM; // Works for both
const solanaChain = Chains.SOLANA; // Works for both
```

### ChainId Type

The `ChainId` type is a union that supports both EVM (numeric) and Solana (string) identifiers:

```typescript
type ChainId = number | string;

// EVM chainIds are numbers
const ethChainId: ChainId = 1;
const arbitrumChainId: ChainId = 42161;

// Solana chainId is a string
const solanaChainId: ChainId = "solana";
```

### Type Guards

Use type guards to handle chain-specific logic:

```typescript
import { isEVMChain, isSolanaChain, getChainByKey } from "@nchamo/sdk";

const chain = getChainByKey(chainId);

if (isEVMChain(chain)) {
  // TypeScript knows this is EVMChain
  console.log(chain.wToken); // 0x... (EVM address)
}

if (isSolanaChain(chain)) {
  // TypeScript knows this is SolanaChain
  console.log(chain.nativeCurrency.mint); // So111... (Solana mint address)
}
```

### Token Addresses

Token addresses differ between chains:

| Chain Type | Address Format | Example                                               |
| ---------- | -------------- | ----------------------------------------------------- |
| EVM        | Hex (0x...)    | `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48` (USDC)   |
| Solana     | Base58         | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (USDC) |

### Common Addresses

```typescript
import { Addresses, SolanaAddresses } from "@nchamo/sdk";

// EVM native token representation
Addresses.NATIVE_TOKEN; // '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
Addresses.ZERO_ADDRESS; // '0x0000000000000000000000000000000000000000'

// Solana common tokens
SolanaAddresses.NATIVE_SOL; // 'So11111111111111111111111111111111111111112' (Wrapped SOL)
SolanaAddresses.USDC; // 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
SolanaAddresses.USDT; // 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
```

## Services

### Allowances Service

The Allowances Service provides functionality to check and manage token allowances across different chains.

> **Note**: The Allowances Service is only applicable to **EVM chains**. Solana uses a different authorization model where token approvals are not required for swaps through Jupiter.

#### Objective and Potential

- **Objective**: Enable efficient management of token approvals across multiple chains and protocols
- **Potential Use Cases**:
  - Batch checking multiple token approvals in a single call
  - Optimizing gas costs by checking approvals before transactions
  - Managing permissions for DeFi protocols and dApps
  - Cross-chain allowance monitoring and management

#### Methods

##### `supportedChains()`

Returns an array of chain IDs that are supported by the service.

```typescript
const chains = sdk.allowanceService.supportedChains();
```

##### `getAllowanceInChain(params)`

Gets the allowance for a specific token and spender on a given chain.

```typescript
const allowance = await sdk.allowanceService.getAllowanceInChain({
  chainId: Chains.ETHEREUM.chainId,
  token: "0x...", // Token address
  owner: "0x...", // Owner address
  spender: "0x...", // Spender address
  config: { timeout: TimeString },
});
```

##### `getAllowancesInChain(params)`

Gets multiple allowances in a single call for a specific chain.

```typescript
const allowances = await sdk.allowanceService.getAllowancesInChain({
  chainId: Chains.ETHEREUM.chainId,
  allowances: [
    { token: "0x...", owner: "0x...", spender: "0x..." },
    { token: "0x...", owner: "0x...", spender: "0x..." },
  ],
  config: { timeout: TimeString },
});
```

##### `getAllowances(params)`

Gets allowances across multiple chains in a single call.

```typescript
const allowances = await sdk.allowanceService.getAllowances({
  allowances: [
    {
      chainId: Chains.ETHEREUM.chainId,
      token: "0x...",
      owner: "0x...",
      spender: "0x...",
    },
    {
      chainId: Chains.OPTIMISM.chainId,
      token: "0x...",
      owner: "0x...",
      spender: "0x...",
    },
  ],
  config: { timeout: TimeString },
});
```

### Balances Service

The Balances Service allows querying token balances across multiple chains and tokens.

#### Objective and Potential

- **Objective**: Provide a unified interface for retrieving token balances across multiple chains
- **Potential Use Cases**:
  - Portfolio tracking across multiple chains
  - Balance monitoring for DeFi positions
  - Multi-chain wallet integration
  - Automated balance checks for trading strategies

#### Methods

##### `supportedChains()`

Returns an array of chain IDs that are supported by the service.

```typescript
const chains = sdk.balanceService.supportedChains();
```

##### `getBalancesForAccountInChain(params)`

Gets balances for a specific account in a single chain.

```typescript
const balances = await sdk.balanceService.getBalancesForAccountInChain({
  chainId: Chains.ETHEREUM.chainId,
  account: "0x...",
  tokens: ["0x...", "0x..."],
  config: { timeout: "30s" },
});
```

##### `getBalancesForAccount(params)`

Gets balances for a specific account across multiple chains.

```typescript
const balances = await sdk.balanceService.getBalancesForAccount({
  account: "0x...",
  tokens: [
    { chainId: Chains.ETHEREUM.chainId, token: "0x..." },
    { chainId: Chains.OPTIMISM.chainId, token: "0x..." },
  ],
  config: { timeout: "30s" },
});
```

##### `getBalancesInChain(params)`

Gets balances for multiple accounts in a single chain.

```typescript
const balances = await sdk.balanceService.getBalancesInChain({
  chainId: Chains.ETHEREUM.chainId,
  tokens: [
    { account: "0x...", token: "0x..." },
    { account: "0x...", token: "0x..." },
  ],
  config: { timeout: "30s" },
});
```

##### `getBalances(params)`

Gets balances for multiple accounts across multiple chains.

```typescript
const balances = await sdk.balanceService.getBalances({
  tokens: [
    { chainId: Chains.ETHEREUM.chainId, account: "0x...", token: "0x..." },
    { chainId: Chains.OPTIMISM.chainId, account: "0x...", token: "0x..." },
  ],
  config: { timeout: "30s" },
});
```

### Quotes Service

The Quotes Service provides comprehensive functionality for getting trade quotes from various DEX aggregators.

#### Objective and Potential

- **Objective**: Aggregate and optimize trade quotes from multiple DEX sources
- **Potential Use Cases**:
  - Finding the best trade routes across multiple DEXs
  - Gas-optimized trading strategies
  - Cross-chain arbitrage opportunities
  - Automated trading systems
  - Price impact analysis

#### Supported Quote Sources

##### EVM Quote Sources

The SDK supports multiple DEX aggregators for EVM chains including:

- 1inch, 0x, Paraswap, Kyber, OpenOcean, and more

##### Solana Quote Sources

For Solana, the SDK integrates with **Jupiter**, the leading DEX aggregator on Solana:

| Source  | Chain  | Buy Orders | Swap & Transfer | API Key Required |
| ------- | ------ | ---------- | --------------- | ---------------- |
| Jupiter | Solana | ✅ Yes     | ❌ No           | ✅ Yes           |

**Jupiter Configuration:**

```typescript
const quotes = await sdk.quoteService.getAllQuotesWithTxs({
  request: {
    chainId: SolanaChains.SOLANA.chainId,
    sellToken: SolanaAddresses.NATIVE_SOL,
    buyToken: SolanaAddresses.USDC,
    order: { type: "sell", sellAmount: BigInt(1_000_000_000) },
    slippagePercentage: 1,
    takerAddress: "YourSolanaPublicKey...",
  },
  config: {
    sourceConfig: {
      jupiter: {
        apiKey: "your-jupiter-api-key", // Required
        slippageBps: 100, // Optional: override slippage in basis points
        onlyDirectRoutes: false, // Optional: only use direct routes
        maxAccounts: 64, // Optional: max accounts in transaction
      },
    },
  },
});
```

> **Note**: To obtain a Jupiter API key, visit [Jupiter's Developer Portal](https://dev.jup.ag/).

#### Transaction Types

The SDK returns different transaction formats for EVM and Solana:

##### EVM Transactions

```typescript
type EVMTransaction = {
  type?: "evm"; // Optional, defaults to 'evm'
  to: string; // Contract address
  calldata: string; // Encoded function call
  value?: bigint; // Native token amount (ETH, etc.)
};
```

##### Solana Transactions

```typescript
type SolanaTransaction = {
  type: "solana";
  swapTransaction: string; // Base64 encoded transaction
  lastValidBlockHeight?: number; // Transaction validity window
};
```

##### Handling Both Transaction Types

```typescript
import { isEVMTransaction, isSolanaTransaction } from "@nchamo/sdk";

const quote = await sdk.quoteService.getBestQuote({ ... });

if (isEVMTransaction(quote.tx)) {
  // Send EVM transaction
  const txResponse = await signer.sendTransaction({
    to: quote.tx.to,
    data: quote.tx.calldata,
    value: quote.tx.value,
  });
}

if (isSolanaTransaction(quote.tx)) {
  // Decode and send Solana transaction
  const transaction = VersionedTransaction.deserialize(
    Buffer.from(quote.tx.swapTransaction, 'base64')
  );
  const signature = await connection.sendTransaction(transaction);
}
```

#### Methods

##### `supportedSources()`

Returns metadata about all supported quote sources.

```typescript
const sources = sdk.quoteService.supportedSources();
```

##### `supportedChains()`

Returns an array of chain IDs that are supported by the service.

```typescript
const chains = sdk.quoteService.supportedChains();
```

##### `supportedSourcesInChain(params)`

Returns metadata about quote sources supported in a specific chain.

```typescript
const sources = sdk.quoteService.supportedSourcesInChain({
  chainId: Chains.ETHEREUM.chainId,
});
```

##### `supportedGasSpeeds()`

Returns supported gas speeds for each chain.

```typescript
const gasSpeeds = sdk.quoteService.supportedGasSpeeds();
```

##### `estimateQuotes(params)`

Gets estimated quotes from all sources without transaction details.

```typescript
const quotes = sdk.quoteService.estimateQuotes({
  request: {
    chainId: Chains.ETHEREUM.chainId,
    sellToken: "0x...",
    buyToken: "0x...",
    order: { type: "sell", sellAmount: BigInt("1000000") },
    slippagePercentage: 1,
  },
  config: { timeout: TimeString },
});
```

##### `estimateAllQuotes(params)`

Gets estimated quotes from all sources and returns them in a sorted array.

```typescript
const quotes = await sdk.quoteService.estimateAllQuotes({
  request: {
    chainId: Chains.ETHEREUM.chainId,
    sellToken: "0x...",
    buyToken: "0x...",
    order: { type: "sell", sellAmount: BigInt("1000000") },
    slippagePercentage: 1,
  },
  config: {
    ignoredFailed: boolean,
    sort: { by: "most-swapped-accounting-for-gas", using: "gas-price" },
    timeout: TimeString,
  },
});
```

##### `getQuotes(params)`

Gets quotes from all sources with transaction details.

```typescript
const quotes = sdk.quoteService.getQuotes({
  request: {
    chainId: Chains.ETHEREUM.chainId,
    sellToken: "0x...",
    buyToken: "0x...",
    order: { type: "sell", sellAmount: BigInt("1000000") },
    slippagePercentage: 1,
    takerAddress: "0x...",
  },
  config: { timeout: TimeString },
});
```

##### `getAllQuotes(params)`

Gets quotes from all sources and returns them in a sorted array.

```typescript
const quotes = await sdk.quoteService.getAllQuotes({
  request: {
    chainId: Chains.ETHEREUM.chainId,
    sellToken: "0x...",
    buyToken: "0x...",
    order: { type: "sell", sellAmount: BigInt("1000000") },
    slippagePercentage: 1,
    takerAddress: "0x...",
  },
  config: {
    ignoredFailed: boolean,
    sort: { by: "most-swapped-accounting-for-gas", using: "gas-price" },
    timeout: TimeString,
  },
});
```

##### `getBestQuote(params)`

Gets the best quote according to specified criteria.

```typescript
const bestQuote = await sdk.quoteService.getBestQuote({
  request: {
    chainId: Chains.ETHEREUM.chainId,
    sellToken: "0x...",
    buyToken: "0x...",
    order: { type: "sell", sellAmount: BigInt("1000000") },
    slippagePercentage: 1,
    takerAddress: "0x...",
  },
  config: {
    choose: { by: "most-swapped-accounting-for-gas", using: "gas-price" },
    timeout: TimeString,
  },
});
```

##### `getAllQuotesWithTxs(params)`

Gets quotes with built transactions from all sources.

```typescript
const quotesWithTxs = await sdk.quoteService.getAllQuotesWithTxs({
  request: {
    chainId: Chains.ETHEREUM.chainId,
    sellToken: "0x...",
    buyToken: "0x...",
    order: { type: "sell", sellAmount: BigInt("1000000") },
    slippagePercentage: 1,
    takerAddress: "0x...",
  },
  config: {
    ignoredFailed: boolean,
    sort: { by: "most-swapped-accounting-for-gas", using: "gas-price" },
    timeout: TimeString,
  },
});
```

##### `buildTxs(params)`

Builds transactions for given quotes.

```typescript
const txs = sdk.quoteService.buildTxs({
  quotes: quotes,
  sourceConfig: SourceConfig,
  config: { timeout: TimeString },
});
```

##### `buildAllTxs(params)`

Builds transactions for all quotes and returns them in a sorted array.

```typescript
const allTxs = await sdk.quoteService.buildAllTxs({
  quotes: quotes,
  sourceConfig: SourceConfig,
  config: {
    timeout: TimeString,
    ignoredFailed: boolean,
  },
});
```

### Gas Service

The Gas Service provides gas price estimation and optimization across different chains.

> **Note**: The Gas Service is only applicable to **EVM chains**. Solana uses a different fee model based on **compute units** and **prioritization fees**, which are handled automatically by quote sources like Jupiter.

#### Objective and Potential

- **Objective**: Optimize transaction costs across different chains and networks
- **Potential Use Cases**:
  - Gas price monitoring and optimization
  - Transaction cost estimation
  - Gas-aware trading strategies
  - Multi-chain gas price comparison
  - Automated gas price optimization

#### Methods

##### `supportedChains()`

Returns an array of chain IDs that are supported by the service.

```typescript
const chains = sdk.gasService.supportedChains();
```

##### `supportedSpeeds()`

Returns supported gas speeds for each chain.

```typescript
const speeds = sdk.gasService.supportedSpeeds();
```

##### `estimateGas(params)`

Estimates gas usage for a transaction.

```typescript
const gasEstimation = await sdk.gasService.estimateGas({
  chainId: Chains.ETHEREUM.chainId,
  tx: {
    from: "0x...",
    to: "0x...",
    data: "0x...",
  },
  config: { timeout: TimeString },
});
```

##### `getGasPrice(params)`

Gets gas prices for different speeds on a chain.

```typescript
const gasPrices = await sdk.gasService.getGasPrice({
  chainId: Chains.ETHEREUM.chainId,
  config: {
    timeout: TimeString,
    fields: {
      standard: "required" | "best effort" | "can ignore",
      fast: "required" | "best effort" | "can ignore",
      instant: "required" | "best effort" | "can ignore",
    },
  },
});
```

##### `calculateGasCost(params)`

Calculates gas cost for a transaction.

```typescript
const gasCost = await sdk.gasService.calculateGasCost({
  chainId: Chains.ETHEREUM.chainId,
  gasEstimation: BigInt("21000"),
  tx: {
    from: "0x...",
    to: "0x...",
    data: "0x...",
  },
  config: {
    timeout: TimeString,
    fields: {
      standard: "required" | "best effort" | "can ignore",
      fast: "required" | "best effort" | "can ignore",
      instant: "required" | "best effort" | "can ignore",
    },
  },
});
```

##### `getQuickGasCalculator(params)`

Gets a quick gas calculator for a specific chain.

```typescript
const calculator = await sdk.gasService.getQuickGasCalculator({
  chainId: Chains.ETHEREUM.chainId,
  config: {
    timeout: TimeString,
    fields: {
      standard: "required" | "best effort" | "can ignore",
      fast: "required" | "best effort" | "can ignore",
      instant: "required" | "best effort" | "can ignore",
    },
  },
});

// Use the calculator
const gasPrices = calculator.getGasPrice();
const gasCost = calculator.calculateGasCost({
  gasEstimation: BigInt("21000"),
  tx: {
    from: "0x...",
    to: "0x...",
    data: "0x...",
  },
});
```

### Prices Service

The Prices Service provides token price information across multiple chains.

#### Objective and Potential

- **Objective**: Provide a unified interface for retrieving token prices across multiple chains
- **Potential Use Cases**:
  - Price feeds for DeFi applications
  - Token value calculations
  - Historical price analysis
  - Price chart generation
  - Multi-chain price aggregation

#### Methods

##### `supportedChains()`

Returns an array of chain IDs that are supported by the service.

```typescript
const chains = sdk.pricesService.supportedChains();
```

##### `supportedQueries()`

Returns the supported price queries for each chain.

```typescript
const queries = sdk.pricesService.supportedQueries();
```

##### `getCurrentPricesInChain(params)`

Gets current prices for tokens in a specific chain.

```typescript
const prices = await sdk.pricesService.getCurrentPricesInChain({
  chainId: Chains.ETHEREUM.chainId,
  tokens: ["0x...", "0x..."],
  config: { timeout: "30s" },
});
```

##### `getCurrentPrices(params)`

Gets current prices for tokens across multiple chains.

```typescript
const prices = await sdk.pricesService.getCurrentPrices({
  tokens: [
    { chainId: Chains.ETHEREUM.chainId, token: "0x..." },
    { chainId: Chains.OPTIMISM.chainId, token: "0x..." },
  ],
  config: { timeout: "30s" },
});
```

##### `getHistoricalPricesInChain(params)`

Gets historical prices for tokens in a specific chain at a given timestamp.

```typescript
const prices = await sdk.pricesService.getHistoricalPricesInChain({
  chainId: Chains.ETHEREUM.chainId,
  tokens: ["0x...", "0x..."],
  timestamp: 1234567890,
  searchWidth: "1h",
  config: { timeout: "30s" },
});
```

##### `getHistoricalPrices(params)`

Gets historical prices for tokens across multiple chains at a given timestamp.

```typescript
const prices = await sdk.pricesService.getHistoricalPrices({
  tokens: [
    { chainId: Chains.ETHEREUM.chainId, token: "0x..." },
    { chainId: Chains.OPTIMISM.chainId, token: "0x..." },
  ],
  timestamp: 1234567890,
  searchWidth: "1h",
  config: { timeout: "30s" },
});
```

##### `getBulkHistoricalPrices(params)`

Gets historical prices for multiple tokens at different timestamps.

```typescript
const prices = await sdk.pricesService.getBulkHistoricalPrices({
  tokens: [
    { chainId: Chains.ETHEREUM.chainId, token: "0x...", timestamp: 1234567890 },
    { chainId: Chains.OPTIMISM.chainId, token: "0x...", timestamp: 1234567890 },
  ],
  searchWidth: "1h",
  config: { timeout: "30s" },
});
```

##### `getChart(params)`

Gets price chart data for tokens over a specified time period.

```typescript
const chart = await sdk.pricesService.getChart({
  tokens: [
    { chainId: Chains.ETHEREUM.chainId, token: "0x..." },
    { chainId: Chains.OPTIMISM.chainId, token: "0x..." },
  ],
  span: 100,
  period: "1d",
  bound: { from: 1234567890 },
  searchWidth: "1h",
});
```

### Metadata Service

The Metadata Service provides token metadata information across multiple chains.

#### Objective and Potential

- **Objective**: Provide a unified interface for retrieving token metadata across multiple chains
- **Potential Use Cases**:
  - Token information display in UIs
  - Token validation and verification
  - Multi-chain token management
  - Token data aggregation

#### Methods

##### `supportedChains()`

Returns an array of chain IDs that are supported by the service.

```typescript
const chains = sdk.metadataService.supportedChains();
```

##### `supportedProperties()`

Returns the supported metadata properties for each chain.

```typescript
const properties = sdk.metadataService.supportedProperties();
```

##### `getMetadataInChain(params)`

Gets metadata for tokens in a specific chain.

```typescript
const metadata = await sdk.metadataService.getMetadataInChain({
  chainId: Chains.ETHEREUM.chainId,
  tokens: ["0x...", "0x..."],
  config: {
    fields: { symbol: "required", decimals: "required" },
    timeout: "30s",
  },
});
```

##### `getMetadata(params)`

Gets metadata for tokens across multiple chains.

```typescript
const metadata = await sdk.metadataService.getMetadata({
  tokens: [
    { chainId: Chains.ETHEREUM.chainId, token: "0x..." },
    { chainId: Chains.OPTIMISM.chainId, token: "0x..." },
  ],
  config: {
    fields: { symbol: "required", decimals: "required" },
    timeout: "30s",
  },
});
```

## Advanced Usage

### Error Handling

The SDK provides comprehensive error handling for all services:

```typescript
try {
  const quotes = await sdk.quoteService.getAllQuotes({...});
} catch (error) {
  if (error instanceof FailedToGenerateAnyQuotesError) {
    // Handle quote generation failure
  }
}
```

### Configuration

Each service can be configured with custom timeouts and other parameters:

```typescript
const quotes = await sdk.quoteService.getAllQuotes({
  request: {...},
  config: {
    timeout: "30s",
    ignoredFailed: true,
    sort: {
      by: "most-swapped-accounting-for-gas",
      using: "gas-price"
    }
  }
});
```

### Solana Configuration

For Solana quotes, you need to configure the Jupiter quote source:

```typescript
const sdk = buildSDK({
  // ... other config
  quotes: {
    sourceConfig: {
      jupiter: {
        apiKey: process.env.JUPITER_API_KEY,
      },
    },
  },
});

// Or configure per-request:
const quotes = await sdk.quoteService.getAllQuotesWithTxs({
  request: {
    chainId: SolanaChains.SOLANA.chainId,
    sellToken: SolanaAddresses.NATIVE_SOL,
    buyToken: "TokenMintAddress...",
    order: { type: "sell", sellAmount: BigInt(1_000_000_000) },
    slippagePercentage: 0.5,
    takerAddress: "YourSolanaPublicKey...",
  },
  config: {
    sourceConfig: {
      jupiter: {
        apiKey: process.env.JUPITER_API_KEY,
        slippageBps: 50, // 0.5% slippage
        onlyDirectRoutes: true, // Only direct swaps, no multi-hop
        maxAccounts: 32, // Limit transaction complexity
      },
    },
  },
});
```

#### Environment Variables

```bash
# Required for Solana quotes
JUPITER_API_KEY=your-jupiter-api-key

# Optional: RPC endpoints
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

### Multi-chain Support

All services support operations across multiple chains:

```typescript
const balances = await sdk.balanceService.getBalancesForTokens({
  account: "0x...",
  tokens: {
    [Chains.ETHEREUM.chainId]: ["0x..."],
    [Chains.OPTIMISM.chainId]: ["0x..."],
    [Chains.ARBITRUM.chainId]: ["0x..."],
  },
});
```

## 👨‍💻 Development

### Environment Setup

```bash
yarn install
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
