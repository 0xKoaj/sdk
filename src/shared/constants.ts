// EVM Addresses
export enum Addresses {
  NATIVE_TOKEN = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  ZERO_ADDRESS = '0x0000000000000000000000000000000000000000',
}

// Solana Addresses
export enum SolanaAddresses {
  NATIVE_SOL = 'So11111111111111111111111111111111111111112', // Wrapped SOL mint (also represents native SOL)
  USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
}

export const Uint = {
  MAX_256: 2n ** 256n - 1n,
};
