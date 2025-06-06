import { ContractTransactionResponse, ethers } from "ethers";

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
  withdrawGasFee: () => Promise<[string, ethers.BigNumberish]>;
  withdrawGasFeeWithGasLimit: (
    gasLimit: ethers.BigNumberish
  ) => Promise<[string, ethers.BigNumberish]>;
};

type DeployedContract = ethers.BaseContract & {
  deploymentTransaction(): ethers.ContractTransactionResponse;
};

export interface ZetachainContracts {
  coreRegistry: ethers.Contract;
  fungibleModuleSigner: ethers.JsonRpcSigner;
  gatewayZEVM: GatewayZEVMContract;
  systemContract: DeployedContract;
  tss: ethers.Signer;
  uniswapFactoryInstance: DeployedContract;
  uniswapRouterInstance: DeployedContract;
  wzeta: DeployedContract;
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
