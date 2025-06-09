import * as UniswapV2Router02 from "@uniswap/v2-periphery/build/UniswapV2Router02.json";
import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import { ethers } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import {
  CustodyContract,
  UniswapV2Router02Contract,
  ZetachainContracts,
  ZRC20Contract,
} from "../../types/contracts";
import { DepositArgs } from "../../types/eventArgs";
import { ForeignCoin } from "../../types/foreignCoins";
import { isRegisteringGatewaysActive } from "../../utils/registryUtils";
import { zetachainDeposit } from "../zetachain/deposit";
import { zetachainOnAbort } from "../zetachain/onAbort";
import { evmOnRevert } from "./onRevert";

export const evmDeposit = async ({
  args,
  deployer,
  foreignCoins,
  provider,
  custody,
  tss,
  zetachainContracts,
  chainID,
  gatewayEVM,
  exitOnError = false,
}: {
  args: DepositArgs;
  chainID: string;
  custody: CustodyContract;
  deployer: ethers.NonceManager;
  exitOnError?: boolean;
  foreignCoins: ForeignCoin[];
  gatewayEVM: ethers.Contract;
  provider: ethers.Provider;
  tss: ethers.NonceManager;
  zetachainContracts: ZetachainContracts;
}) => {
  logger.info("Gateway: 'Deposited' event emitted", { chain: chainID });

  // Skip processing events during gateway registration
  if (isRegisteringGatewaysActive()) {
    logger.debug("Skipping event during gateway registration", {
      chain: chainID,
    });
    return;
  }

  const [sender, , amount, asset, , revertOptions] = args;
  let foreignCoin;
  if (asset === ethers.ZeroAddress) {
    foreignCoin = foreignCoins.find((coin) => coin.coin_type === "Gas");
  } else {
    foreignCoin = foreignCoins.find((coin) => coin.asset === asset);
  }

  if (!foreignCoin) {
    logger.error(`Foreign coin not found for asset: ${asset}`, {
      chain: NetworkID.ZetaChain,
    });
    return;
  }

  const zrc20 = foreignCoin.zrc20_contract_address;
  try {
    await zetachainDeposit({
      args,
      chainID,
      foreignCoins,
      zetachainContracts,
    });
  } catch (err: unknown) {
    if (exitOnError) {
      throw new Error(String(err));
    }
    logger.error(`Error depositing: ${String(err)}`, {
      chain: NetworkID.ZetaChain,
    });
    const zrc20Contract = new ethers.Contract(
      zrc20,
      ZRC20.abi,
      deployer
    ) as ZRC20Contract;
    const [gasZRC20, gasFee] = await zrc20Contract.withdrawGasFeeWithGasLimit(
      revertOptions[4]
    );
    let revertGasFee = gasFee;
    let isGas = true;
    let token: string | null = null;
    if (zrc20 !== gasZRC20) {
      token =
        foreignCoins.find((coin) => coin.zrc20_contract_address === zrc20)
          ?.asset ?? null;
      isGas = false;
      revertGasFee = await swapToCoverGas(
        amount,
        deployer,
        await zetachainContracts.fungibleModuleSigner.getAddress(),
        gasFee,
        gasZRC20,
        provider,
        String(zetachainContracts.uniswapRouterInstance.target),
        String(zetachainContracts.wzeta.target),
        zrc20,
        zrc20Contract
      );
    }
    const revertAmount = Number(amount) - Number(revertGasFee);
    if (revertAmount > 0) {
      return await evmOnRevert({
        amount: revertAmount.toString(),
        asset,
        chainID,
        custody,
        gatewayEVM,
        isGas,
        provider,
        revertOptions,
        sender,
        token,
        tss,
      });
    } else {
      // If the deposited amount is not enough to cover withdrawal fee, run onAbort
      const abortAddress = revertOptions[2];
      const revertMessage = revertOptions[3];
      return await zetachainOnAbort({
        abortAddress,
        amount: BigInt(amount),
        asset: zrc20,
        chainID,
        fungibleModuleSigner: zetachainContracts.fungibleModuleSigner,
        gatewayZEVM: zetachainContracts.gatewayZEVM,
        outgoing: false,
        provider,
        revertMessage,
        sender,
      });
    }
  }
};

const swapToCoverGas = async (
  amount: ethers.BigNumberish,
  deployer: ethers.NonceManager,
  fungibleModule: string,
  gasFee: ethers.BigNumberish,
  gasZRC20: string,
  provider: ethers.Provider,
  router: string,
  wzeta: string,
  zrc20: string,
  zrc20Contract: ZRC20Contract
) => {
  /**
   * Retrieves the amounts for swapping tokens using UniswapV2.
   * @param {"in" | "out"} direction - The direction of the swap ("in" or "out").
   * @param {any} provider - The ethers provider.
   * @param {any} amount - The amount to swap.
   * @param {string} tokenA - The address of token A.
   * @param {string} tokenB - The address of token B.
   * @returns {Promise<any>} - The amounts for the swap.
   * @throws Will throw an error if the UniswapV2 router address cannot be retrieved.
   */
  const getAmounts = async (
    direction: "in" | "out",
    provider: ethers.Provider,
    amount: ethers.BigNumberish,
    tokenA: string,
    tokenB: string,
    routerAddress: string,
    routerABI: { abi: ethers.InterfaceAbi }
  ) => {
    if (!routerAddress) {
      throw new Error("Cannot get uniswapV2Router02 address");
    }

    const uniswapRouter = new ethers.Contract(
      routerAddress,
      routerABI.abi,
      provider
    );

    const path = [tokenA, tokenB];

    const amounts = (
      direction === "in"
        ? await uniswapRouter.getAmountsIn(amount, path)
        : await uniswapRouter.getAmountsOut(amount, path)
    ) as ethers.BigNumberish[];
    return amounts;
  };

  const uniswapV2Router = new ethers.Contract(
    router,
    UniswapV2Router02.abi,
    deployer
  ) as UniswapV2Router02Contract;
  deployer.reset();
  const approvalTx = await zrc20Contract.approve(router, amount);
  await approvalTx.wait();

  const path = [zrc20, wzeta, gasZRC20];

  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
  const maxZRC20ToSpend = amount;

  try {
    const swapTx = await uniswapV2Router.swapTokensForExactTokens(
      gasFee,
      maxZRC20ToSpend,
      path,
      fungibleModule,
      deadline
    );

    await swapTx.wait();
  } catch (swapError) {
    logger.error(`Error performing swap on Uniswap: ${String(swapError)}`, {
      chain: NetworkID.ZetaChain,
    });
  }

  const amountInZeta = await getAmounts(
    "in",
    provider,
    gasFee,
    wzeta,
    gasZRC20,
    router,
    UniswapV2Router02
  );

  const amountInZRC20 = await getAmounts(
    "in",
    provider,
    amountInZeta[0],
    zrc20,
    wzeta,
    router,
    UniswapV2Router02
  );

  return amountInZRC20[0];
};
