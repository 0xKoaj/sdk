import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, AccountLayout } from '@solana/spl-token';
import { Address, ChainId, TimeString, TokenAddress } from '@types';
import { BalanceInput, IBalanceSource } from '../types';
import { SolanaChains } from '@chains';
import { SolanaAddresses } from '@shared/constants';
import { filterRejectedResults, groupByChain } from '@shared/utils';
import { timeoutPromise } from '@shared/timeouts';
import { ILogger, ILogsService } from '@services/logs';

export type SolanaBalanceSourceConfig = {
  rpcUrl?: string;
};

export class SolanaBalanceSource implements IBalanceSource {
  private readonly logger: ILogger;
  private readonly connection: Connection;

  constructor(logs: ILogsService, private readonly config?: SolanaBalanceSourceConfig) {
    this.logger = logs.getLogger({ name: 'SolanaBalanceSource' });
    const rpcUrl = config?.rpcUrl ?? SolanaChains.SOLANA.publicRPCs[0];
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  supportedChains(): ChainId[] {
    return [SolanaChains.SOLANA.chainId];
  }

  async getBalances({
    tokens,
    config,
  }: {
    tokens: BalanceInput[];
    config?: { timeout?: TimeString };
  }): Promise<Record<ChainId, Record<Address, Record<TokenAddress, bigint>>>> {
    const groupedByChain = groupByChain(tokens);
    const promises = Object.entries(groupedByChain).map<Promise<[ChainId, Record<Address, Record<TokenAddress, bigint>>]>>(
      async ([chainId, chainTokens]) => {
        // Only process Solana chain
        if (chainId !== 'solana') {
          return [chainId, {}];
        }
        return [
          chainId,
          await timeoutPromise(this.fetchBalancesInChain(chainTokens), config?.timeout, {
            reduceBy: '100',
            onTimeout: (timeout) => this.logger.debug(`Fetch Solana balances timed out after ${timeout}`),
          }),
        ];
      }
    );
    return Object.fromEntries(await filterRejectedResults(promises));
  }

  private async fetchBalancesInChain(tokens: Omit<BalanceInput, 'chainId'>[]): Promise<Record<Address, Record<TokenAddress, bigint>>> {
    if (tokens.length === 0) return {};

    const result: Record<Address, Record<TokenAddress, bigint>> = {};

    // Group by account to batch requests
    const byAccount = new Map<Address, TokenAddress[]>();
    for (const { account, token } of tokens) {
      if (!byAccount.has(account)) byAccount.set(account, []);
      byAccount.get(account)!.push(token);
    }

    // Process each account
    const accountPromises = Array.from(byAccount.entries()).map(async ([account, accountTokens]) => {
      try {
        const balances = await this.fetchAccountBalances(account, accountTokens);
        result[account] = balances;
      } catch (error) {
        this.logger.debug(`Failed to fetch balances for account ${account}: ${error}`);
      }
    });

    await Promise.all(accountPromises);
    return result;
  }

  private async fetchAccountBalances(account: Address, tokens: TokenAddress[]): Promise<Record<TokenAddress, bigint>> {
    const balances: Record<TokenAddress, bigint> = {};
    const owner = new PublicKey(account);

    // Separate native SOL from SPL tokens
    const nativeToken = tokens.find((t) => t === SolanaAddresses.NATIVE_SOL);
    const splTokens = tokens.filter((t) => t !== SolanaAddresses.NATIVE_SOL);

    // Fetch native SOL balance
    if (nativeToken) {
      try {
        const lamports = await this.connection.getBalance(owner);
        balances[nativeToken] = BigInt(lamports);
      } catch (error) {
        this.logger.debug(`Failed to fetch SOL balance for ${account}: ${error}`);
        balances[nativeToken] = 0n;
      }
    }

    // Fetch SPL token balances
    if (splTokens.length > 0) {
      try {
        // Get all token accounts for this owner
        const tokenAccounts = await this.connection.getTokenAccountsByOwner(owner, {
          programId: TOKEN_PROGRAM_ID,
        });

        // Parse token accounts and map to balances
        const mintToBalance = new Map<string, bigint>();
        for (const { account: tokenAccount } of tokenAccounts.value) {
          const data = AccountLayout.decode(tokenAccount.data);
          const mint = new PublicKey(data.mint).toString();
          const amount = BigInt(data.amount.toString());
          mintToBalance.set(mint, amount);
        }

        // Map requested tokens to their balances
        for (const token of splTokens) {
          balances[token] = mintToBalance.get(token) ?? 0n;
        }
      } catch (error) {
        this.logger.debug(`Failed to fetch SPL token balances for ${account}: ${error}`);
        // Set all SPL tokens to 0
        for (const token of splTokens) {
          balances[token] = 0n;
        }
      }
    }

    return balances;
  }
}
