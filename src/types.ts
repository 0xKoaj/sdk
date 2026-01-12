import { ArrayOneOrMoreReadonly, If, KeysWithValue } from '@utility-types';
import { StringValue } from 'ms';

export type Address = string;
export type TokenAddress = Address;
export type ChainId = number | string; // number for EVM, string for non-EVM (e.g., 'solana')
export type TimeString = StringValue;
export type Timestamp = number;
export type BigIntish = string | number | bigint;

// EVM Chain (original type)
export type EVMChain = Readonly<{
  chainId: number;
  name: string;
  ids: ArrayOneOrMoreReadonly<string>;
  nativeCurrency: { symbol: string; name: string };
  wToken: Lowercase<Address>;
  publicRPCs: Readonly<string[]>;
  explorer: string;
  testnet?: boolean;
}>;

// Solana Chain
export type SolanaChain = Readonly<{
  chainId: 'solana';
  name: string;
  ids: ArrayOneOrMoreReadonly<string>;
  nativeCurrency: { symbol: string; name: string; mint: string };
  wToken: string; // Wrapped SOL mint address (base58)
  publicRPCs: Readonly<string[]>;
  explorer: string;
  testnet?: boolean;
}>;

// Union type for all chains
export type Chain = EVMChain | SolanaChain;

// Type guards
export function isEVMChain(chain: Chain): chain is EVMChain {
  return typeof chain.chainId === 'number';
}

export function isSolanaChain(chain: Chain): chain is SolanaChain {
  return chain.chainId === 'solana';
}
export type InputTransaction = {
  from: Address;
  to: Address;
  data?: string;
  value?: bigint;
  nonce?: number;
  maxPriorityFeePerGas?: bigint;
  maxFeePerGas?: bigint;
  gasPrice?: bigint;
  gasLimit?: bigint;
  type?: number;
};
export type AmountsOfToken = {
  amount: bigint;
  amountInUnits: string;
  amountInUSD?: string;
};
export type BuiltTransaction = {
  to: string;
  data: string;
  value?: bigint;
  nonce?: number;
  maxPriorityFeePerGas?: bigint;
  maxFeePerGas?: bigint;
  gasPrice?: bigint;
  gasLimit?: bigint;
  type?: number;
};
export type ContractCall = {
  address: Address;
  abi: { humanReadable: string[] } | { json: readonly any[] };
  functionName: string;
  args?: any[];
};

export type SupportRecord<Values extends object> = { [K in keyof Values]-?: undefined extends Values[K] ? 'optional' : 'present' };
export type SupportInChain<Values extends object> = {
  [K in keyof SupportRecord<Values>]: SupportRecord<Values>[K] extends 'present' ? 'present' : 'optional' | 'present';
};
export type FieldRequirementOptions = 'required' | 'best effort' | 'can ignore';
export type FieldsRequirements<Values extends object> = {
  requirements?: Partial<Record<keyof Values, FieldRequirementOptions>>;
  default?: FieldRequirementOptions;
};
export type DefaultRequirements<Values extends object> = {
  requirements: { [K in keyof Values]: SupportRecord<Values>[K] extends 'present' ? 'required' : 'best effort' };
};

export type BasedOnRequirements<Values extends object, Requirements extends FieldsRequirements<Values>> = Partial<Values> &
  Required<Pick<Values, PresentKeys<Values, Requirements>>>;

type PresentKeys<Values extends object, Requirements extends FieldsRequirements<Values>> = Exclude<
  KeysWithValue<SupportRecord<Values>, 'present'> | RequiredKeys<Values, Requirements>,
  CanIgnoreKeys<Values, Requirements>
> &
  keyof Values;
type UnspecifiedKeys<Values extends object, Requirements extends FieldsRequirements<Values>> = Exclude<
  keyof Values,
  undefined extends Requirements['requirements'] ? never : keyof NonNullable<Requirements['requirements']>
>;
type RequiredKeys<Values extends object, Requirements extends FieldsRequirements<Values>> =
  | (undefined extends Requirements['requirements'] ? never : KeysWithValue<NonNullable<Requirements['requirements']>, 'required'>)
  | If<IsDefault<Requirements, 'required'>, UnspecifiedKeys<Values, Requirements>>;

type CanIgnoreKeys<Values extends object, Requirements extends FieldsRequirements<Values>> =
  | (undefined extends Requirements['requirements'] ? never : KeysWithValue<NonNullable<Requirements['requirements']>, 'can ignore'>)
  | If<IsDefault<Requirements, 'can ignore'>, UnspecifiedKeys<Values, Requirements>>;
type IsDefault<Requirements extends FieldsRequirements<object>, Check extends FieldRequirementOptions> = Requirements['default'] extends Check
  ? true
  : false;
