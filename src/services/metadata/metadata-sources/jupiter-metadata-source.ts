import { ChainId, FieldsRequirements, SupportInChain, TimeString, TokenAddress } from '@types';
import { IFetchService } from '@services/fetch/types';
import { BaseTokenMetadata, IMetadataSource, MetadataInput, MetadataResult } from '../types';
import { SolanaChains } from '@chains';

const JUPITER_TOKEN_LIST_URL = 'https://token.jup.ag/all';
const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour

export type SolanaTokenMetadata = BaseTokenMetadata & {
  name?: string;
  logoURI?: string;
};

type JupiterToken = {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  tags?: string[];
};

type CachedTokenList = {
  tokens: Map<string, JupiterToken>;
  timestamp: number;
};

export class JupiterMetadataSource implements IMetadataSource<SolanaTokenMetadata> {
  private cachedTokenList: CachedTokenList | null = null;

  constructor(private readonly fetch: IFetchService) {}

  async getMetadata<Requirements extends FieldsRequirements<SolanaTokenMetadata>>(params: {
    tokens: MetadataInput[];
    config?: { timeout?: TimeString };
  }) {
    const result: Record<ChainId, Record<TokenAddress, SolanaTokenMetadata>> = {};

    const solanaTokens = params.tokens.filter((t) => t.chainId === SolanaChains.SOLANA.chainId);
    if (solanaTokens.length === 0) {
      return result as Record<ChainId, Record<TokenAddress, MetadataResult<SolanaTokenMetadata, Requirements>>>;
    }

    const tokenMap = await this.getTokenList();
    result[SolanaChains.SOLANA.chainId] = {};

    for (const { token } of solanaTokens) {
      const jupiterToken = tokenMap.get(token);
      if (jupiterToken) {
        result[SolanaChains.SOLANA.chainId][token] = {
          symbol: jupiterToken.symbol,
          decimals: jupiterToken.decimals,
          name: jupiterToken.name,
          logoURI: jupiterToken.logoURI,
        };
      }
    }

    return result as Record<ChainId, Record<TokenAddress, MetadataResult<SolanaTokenMetadata, Requirements>>>;
  }

  supportedProperties() {
    const properties: SupportInChain<SolanaTokenMetadata> = {
      symbol: 'present',
      decimals: 'present',
      name: 'optional',
      logoURI: 'optional',
    };
    return { [SolanaChains.SOLANA.chainId]: properties };
  }

  private async getTokenList(): Promise<Map<string, JupiterToken>> {
    if (this.cachedTokenList && Date.now() - this.cachedTokenList.timestamp < CACHE_DURATION_MS) {
      return this.cachedTokenList.tokens;
    }

    const tokens = await this.fetchTokenList();
    this.cachedTokenList = { tokens, timestamp: Date.now() };
    return tokens;
  }

  private async fetchTokenList(): Promise<Map<string, JupiterToken>> {
    try {
      const response = await this.fetch.fetch(JUPITER_TOKEN_LIST_URL, { timeout: '30s' });
      if (!response.ok) {
        throw new Error(`Failed to fetch Jupiter token list: ${response.status}`);
      }

      const tokens: JupiterToken[] = await response.json();
      const tokenMap = new Map<string, JupiterToken>();
      for (const token of tokens) {
        tokenMap.set(token.address, token);
      }
      return tokenMap;
    } catch {
      if (this.cachedTokenList) {
        return this.cachedTokenList.tokens;
      }
      return new Map();
    }
  }
}
