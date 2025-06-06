import { ContractTransactionResponse, ethers } from "ethers";

import { ForeignCoin } from "./foreignCoins";

export interface TxOptions {
  gasLimit?: ethers.BigNumberish;
  gasPrice?: ethers.BigNumberish;
  value?: ethers.BigNumberish;
}

export type ZRC20Contract = ethers.Contract & {
  COIN_TYPE: () => Promise<number>;
  PROTOCOL_FLAT_FEE: () => Promise<ethers.BigNumberish>;
  approve: (
    spender: string,
    value: ethers.BigNumberish,
    txOptions?: TxOptions
  ) => Promise<ContractTransactionResponse>;
  decimals: () => Promise<number>;
  // Overloaded deposit method to support both ZRC20 and WETH9 patterns
  deposit: {
    (
      to: string,
      amount: ethers.BigNumberish,
      txOptions?: TxOptions
    ): Promise<ContractTransactionResponse>;
    (
      txOptions?: TxOptions & { value: ethers.BigNumberish }
    ): Promise<ContractTransactionResponse>;
  };
  transfer: (
    to: string,
    amount: ethers.BigNumberish,
    txOptions?: TxOptions
  ) => Promise<ContractTransactionResponse>;
  withdrawGasFee: () => Promise<[string, ethers.BigNumberish]>;
  withdrawGasFeeWithGasLimit: (
    gasLimit: ethers.BigNumberish
  ) => Promise<[string, ethers.BigNumberish]>;
};

export type SystemContract = ethers.Contract & {
  setGasCoinZRC20: (
    chainID: string,
    zrc20Address: string | ethers.Addressable,
    txOptions?: TxOptions
  ) => Promise<ContractTransactionResponse>;
  setGasPrice: (
    chainID: string,
    gasPrice: ethers.BigNumberish,
    txOptions?: TxOptions
  ) => Promise<ContractTransactionResponse>;
};

type DeployedContract = ethers.BaseContract & {
  deploymentTransaction(): ethers.ContractTransactionResponse;
};

export interface ZetachainContracts {
  coreRegistry: ethers.Contract;
  fungibleModuleSigner: ethers.JsonRpcSigner;
  gatewayZEVM: GatewayZEVMContract;
  systemContract: SystemContract;
  tss: ethers.Signer;
  uniswapFactoryInstance: UniswapV2FactoryContract;
  uniswapRouterInstance: UniswapV2RouterContract;
  wzeta: ZRC20Contract;
}

export interface EVMContracts {
  custody: ethers.Contract;
  gatewayEVM: ethers.Contract;
  registry: ethers.Contract;
  testEVMZeta: DeployedContract;
  zetaConnector: ethers.Contract;
}

export interface SolanaContracts {
  addresses: Array<{
    address: string;
    chain: string;
    type: string;
  }>;
  env: {
    defaultSolanaUser: unknown; // Solana Keypair type
    gatewayProgram: unknown; // Anchor Program type
  };
}

export interface SuiContracts {
  addresses: Array<{
    address: string;
    chain: string;
    type: string;
  }>;
}

export interface TonContracts {
  addresses: Array<{
    address: string;
    chain: string;
    type: string;
  }>;
}

export interface LocalnetContracts {
  bnbContracts: EVMContracts;
  deployer: ethers.NonceManager;
  ethereumContracts: EVMContracts;
  foreignCoins: ForeignCoin[];
  provider: ethers.JsonRpcProvider;
  solanaContracts?: SolanaContracts;
  suiContracts?: SuiContracts;
  tonContracts?: TonContracts;
  tss: ethers.NonceManager;
  zetachainContracts: ZetachainContracts;
}

export type UniswapV2Router02Contract = ethers.Contract & {
  getAmountsIn: (
    amountOut: ethers.BigNumberish,
    path: string[]
  ) => Promise<[bigint, bigint]>;
  getAmountsOut: (
    amountIn: ethers.BigNumberish,
    path: string[]
  ) => Promise<[bigint, bigint]>;
  swapTokensForExactTokens: (
    amountOut: ethers.BigNumberish,
    amountInMax: ethers.BigNumberish,
    path: string[],
    to: string,
    deadline: number
  ) => Promise<ContractTransactionResponse>;
};

export type GatewayZEVMContract = ethers.Contract & {
  depositAndCall: (
    context: {
      chainID: string;
      sender: string;
      senderEVM: string;
    },
    zrc20: string,
    amount: ethers.BigNumberish,
    receiver: string,
    message: string,
    options?: TxOptions
  ) => Promise<ContractTransactionResponse>;
};

export type UniswapV3FactoryContract = ethers.Contract & {
  createPool: (
    tokenA: string,
    tokenB: string,
    fee: number
  ) => Promise<ContractTransactionResponse>;
  getPool: (tokenA: string, tokenB: string, fee: number) => Promise<string>;
};

export type UniswapV3PositionManagerContract = ethers.Contract & {
  getAddress: () => Promise<string>;
  mint: (params: {
    amount0Desired: ethers.BigNumberish;
    amount0Min: ethers.BigNumberish;
    amount1Desired: ethers.BigNumberish;
    amount1Min: ethers.BigNumberish;
    deadline: number;
    fee: number;
    recipient: string;
    tickLower: number;
    tickUpper: number;
    token0: string;
    token1: string;
  }) => Promise<ContractTransactionResponse>;
  ownerOf: (tokenId: ethers.BigNumberish) => Promise<string>;
  positions: (tokenId: ethers.BigNumberish) => Promise<unknown[]>;
};

export type UniswapV3PoolContract = ethers.Contract & {
  getAddress: () => Promise<string>;
  initialize: (
    sqrtPriceX96: ethers.BigNumberish
  ) => Promise<ContractTransactionResponse>;
  liquidity: () => Promise<bigint>;
  slot0: () => Promise<unknown[]>;
  token0: () => Promise<string>;
  token1: () => Promise<string>;
};

export type UniswapV2FactoryContract = ethers.Contract & {
  createPair: (
    tokenA: string | ethers.Addressable,
    tokenB: string | ethers.Addressable,
    options?: TxOptions
  ) => Promise<ContractTransactionResponse>;
  getPair: (tokenA: string, tokenB: string) => Promise<string>;
};

export type UniswapV2RouterContract = ethers.Contract & {
  addLiquidity: (
    tokenA: string | ethers.Addressable,
    tokenB: string | ethers.Addressable,
    amountADesired: ethers.BigNumberish,
    amountBDesired: ethers.BigNumberish,
    amountAMin: ethers.BigNumberish,
    amountBMin: ethers.BigNumberish,
    to: string,
    deadline: number,
    options?: TxOptions
  ) => Promise<ContractTransactionResponse>;
  getAddress: () => Promise<string>;
};
