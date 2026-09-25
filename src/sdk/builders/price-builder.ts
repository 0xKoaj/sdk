import { IFetchService } from '@services/fetch';
import { CacheConfig } from '@shared/concurrent-lru-cache';
import { IPriceService, IPriceSource } from '@services/prices';
import { DefiLlamaPriceSource } from '@services/prices/price-sources/defi-llama-price-source';
import { PriceService } from '@services/prices/price-service';
import { CachedPriceSource } from '@services/prices/price-sources/cached-price-source';
import { CoingeckoPriceSource } from '@services/prices/price-sources/coingecko-price-source';
import { PrioritizedPriceSource } from '@services/prices/price-sources/prioritized-price-source';
import { FastestPriceSource } from '@services/prices/price-sources/fastest-price-source';
import { AggregatorPriceSource, PriceAggregationMethod } from '@services/prices/price-sources/aggregator-price-source';
import { CodexPriceSource } from '@services/prices/price-sources/codex-price-source';
import { AlchemyPriceSource } from '@services/prices/price-sources/alchemy-price-source';
import { AlchemySupportedChains } from '@services/providers/provider-sources/alchemy-provider';
import { BatchConfig, BatchPriceSource } from '@services/prices/price-sources/batch-price-source';
export type PriceSourceInput =
  | { type: 'defi-llama' }
  | { type: 'codex'; apiKey: string }
  | { type: 'alchemy'; apiKey: string; onChains?: AlchemySupportedChains }
  | { type: 'coingecko' }
  | { type: 'prioritized'; sources: PriceSourceInput[] }
  | { type: 'fastest'; sources: PriceSourceInput[] }
  | { type: 'aggregate'; sources: PriceSourceInput[]; by: PriceAggregationMethod }
  | { type: 'cached'; underlyingSource: PriceSourceInput; config: CacheConfig }
  | { type: 'batch'; underlyingSource: PriceSourceInput; config: BatchConfig }
  | { type: 'custom'; instance: IPriceSource }
  | { type: 'custom-with-underlying'; underlyingSource: PriceSourceInput; build: (underlying: IPriceSource) => IPriceSource };

export type BuildPriceParams = { source: PriceSourceInput };

export function buildPriceService(params: BuildPriceParams | undefined, fetchService: IFetchService): IPriceService {
  const source = buildSource(params?.source, { fetchService });
  return new PriceService(source);
}

function buildSource(source: PriceSourceInput | undefined, { fetchService }: { fetchService: IFetchService }): IPriceSource {
  const coingecko = new CoingeckoPriceSource(fetchService);
  const defiLlama = new DefiLlamaPriceSource(fetchService);
  switch (source?.type) {
    case undefined:
      // Defi Llama is basically Coingecko with some token mappings. Defi Llama has a 5 min cache, so the priority will be Coingecko => DefiLlama
      return new PrioritizedPriceSource([coingecko, defiLlama]);
    case 'codex':
      return new CodexPriceSource(fetchService, source.apiKey);
    case 'alchemy':
      return new AlchemyPriceSource({ key: source.apiKey, onChains: source.onChains, fetch: fetchService });
    case 'defi-llama':
      return defiLlama;
    case 'coingecko':
      return coingecko;
    case 'cached': {
      const underlying = buildSource(source.underlyingSource, { fetchService });
      return new CachedPriceSource(underlying, source.config);
    }
    case 'batch': {
      const underlying = buildSource(source.underlyingSource, { fetchService });
      return new BatchPriceSource(underlying, source.config);
    }
    case 'prioritized':
      return new PrioritizedPriceSource(source.sources.map((source) => buildSource(source, { fetchService })));
    case 'fastest':
      return new FastestPriceSource(source.sources.map((source) => buildSource(source, { fetchService })));
    case 'aggregate':
      return new AggregatorPriceSource(
        source.sources.map((source) => buildSource(source, { fetchService })),
        source.by
      );
    case 'custom':
      return source.instance;
    case 'custom-with-underlying': {
      const underlying = buildSource(source.underlyingSource, { fetchService });
      return source.build(underlying);
    }
  }
}
