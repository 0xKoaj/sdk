import { ChainId, TokenAddress } from '@types';
import { SourceId } from './types';
import { getChainByKey } from '@chains';

export class SourceNotFoundError extends Error {
  constructor(sourceId: SourceId) {
    super(`Could not find a source with id '${sourceId}'`);
  }
}

export class SourceNoBuyOrdersError extends Error {
  constructor(sourceId: SourceId) {
    super(`Source with id '${sourceId}' does not support buy orders`);
  }
}

export class SourceInvalidConfigOrContextError extends Error {
  constructor(sourceId: SourceId) {
    super(`The current context or config is not valid for source with id '${sourceId}'`);
  }
}

export class FailedToGenerateQuoteError extends Error {
  constructor(sourceName: string, chainId: ChainId, sellToken: TokenAddress, buyToken: TokenAddress, error?: any, buyTokenChainId?: ChainId) {
    const context = error ? ` with error ${JSON.stringify(error)}` : '';
    const sellChain = getChainByKey(chainId)?.name ?? `chain with id ${chainId}`;
    const resolvedBuyChainId = buyTokenChainId ?? chainId;
    const chainDescription =
      resolvedBuyChainId !== chainId
        ? `from ${sellChain} to ${getChainByKey(resolvedBuyChainId)?.name ?? `chain with id ${resolvedBuyChainId}`}`
        : `on ${sellChain}`;
    super(`${sourceName}: failed to calculate a quote between ${sellToken} and ${buyToken} ${chainDescription}${context}`);
  }
}

export class FailedToGenerateAnyQuotesError extends Error {
  constructor(chainId: ChainId, sellToken: TokenAddress, buyToken: TokenAddress, buyTokenChainId?: ChainId) {
    const sellChain = getChainByKey(chainId)?.name ?? `chain with id ${chainId}`;
    const resolvedBuyChainId = buyTokenChainId ?? chainId;
    const chainDescription =
      resolvedBuyChainId !== chainId
        ? `from ${sellChain} to ${getChainByKey(resolvedBuyChainId)?.name ?? `chain with id ${resolvedBuyChainId}`}`
        : `on ${sellChain}`;
    super(`Failed to calculate a quote between ${sellToken} and ${buyToken} ${chainDescription}`);
  }
}
