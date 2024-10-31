import { ethers, NonceManager } from "ethers";
import { handleOnRevertEVM } from "./handleOnRevertEVM";
import { log, logErr } from "./log";
import { deployOpts } from "./deployOpts";
import * as ZRC20 from "@zetachain/protocol-contracts/abi/ZRC20.sol/ZRC20.json";
import * as UniswapV2Router02 from "@uniswap/v2-periphery/build/UniswapV2Router02.json";

export const handleOnEVMDeposited = async ({
  tss,
  provider,
  protocolContracts,
  args,
  deployer,
  fungibleModuleSigner,
  foreignCoins,
  exitOnError = false,
  chainID,
  chain,
  gatewayEVM,
  custody,
}: {
  tss: any;
  provider: ethers.JsonRpcProvider;
  protocolContracts: any;
  args: any;
  deployer: any;
  fungibleModuleSigner: any;
  foreignCoins: any[];
  exitOnError: boolean;
  chainID: string;
  chain: string;
  gatewayEVM: any;
  custody: any;
}) => {
  log(chain, "Gateway: 'Deposited' event emitted");
  const sender = args[0];
  const receiver = args[1];
  const amount = args[2];
  const asset = args[3];
  const message = args[4];
  let foreignCoin;
  if (asset === ethers.ZeroAddress) {
    foreignCoin = foreignCoins.find((coin) => coin.coin_type === "Gas");
  } else {
    foreignCoin = foreignCoins.find((coin) => coin.asset === asset);
  }

  if (!foreignCoin) {
    logErr("ZetaChain", `Foreign coin not found for asset: ${asset}`);
    return;
  }

  const zrc20 = foreignCoin.zrc20_contract_address;
  try {
    const context = {
      origin: protocolContracts.gatewayZEVM.target,
      sender: await fungibleModuleSigner.getAddress(),
      chainID: chainID,
    };

    // If message is not empty, execute depositAndCall
    if (message !== "0x") {
      log(
        "ZetaChain",
        `Universal contract ${receiver} executing onCall (context: ${JSON.stringify(
          context
        )}), zrc20: ${zrc20}, amount: ${amount}, message: ${message})`
      );

      const tx = await protocolContracts.gatewayZEVM
        .connect(fungibleModuleSigner)
        .depositAndCall(context, zrc20, amount, receiver, message, deployOpts);

      await tx.wait();
      const logs = await provider.getLogs({
        address: receiver,
        fromBlock: "latest",
      });

      logs.forEach((data) => {
        log("ZetaChain", `Event from onCall: ${JSON.stringify(data)}`);
      });
    } else {
      const tx = await protocolContracts.gatewayZEVM
        .connect(fungibleModuleSigner)
        .deposit(zrc20, amount, receiver, deployOpts);
      await tx.wait();
      log("ZetaChain", `Deposited ${amount} of ${zrc20} tokens to ${receiver}`);
    }
  } catch (err) {
    logErr("ZetaChain", `Error depositing: ${err}`);
    const revertOptions = args[5];
    const zrc20Contract = new ethers.Contract(zrc20, ZRC20.abi, deployer);
    const [gasZRC20, gasFee] = await zrc20Contract.withdrawGasFeeWithGasLimit(
      revertOptions[4]
    );
    let revertAmount;
    let revertGasFee = gasFee;
    let isGas = true;
    let token = null;
    if (zrc20 !== gasZRC20) {
      token = foreignCoins.find(
        (coin) => coin.zrc20_contract_address === zrc20
      )?.asset;
      isGas = false;
      revertGasFee = await swapToCoverGas(
        deployer,
        zrc20,
        gasZRC20,
        gasFee,
        amount,
        await fungibleModuleSigner.getAddress(),
        zrc20Contract,
        provider,
        protocolContracts.wzeta.target,
        protocolContracts.uniswapRouterInstance.target
      );
    }
    revertAmount = amount - revertGasFee;
    return await handleOnRevertEVM({
      revertOptions,
      asset,
      amount: revertAmount,
      err,
      tss,
      isGas,
      token,
      provider,
      exitOnError,
      chain,
      gatewayEVM,
      custody,
      sender,
    });
  }
};

const swapToCoverGas = async (
  deployer: any,
  zrc20: string,
  gasZRC20: string,
  gasFee: any,
  amount: any,
  fungibleModule: any,
  zrc20Contract: any,
  provider: any,
  wzeta: string,
  router: string
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
    provider: any,
    amount: any,
    tokenA: string,
    tokenB: string,
    routerAddress: any,
    routerABI: any
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

    const amounts =
      direction === "in"
        ? await uniswapRouter.getAmountsIn(amount, path)
        : await uniswapRouter.getAmountsOut(amount, path);
    return amounts;
  };

  const uniswapV2Router = new ethers.Contract(
    router,
    UniswapV2Router02.abi,
    deployer
  );
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
    logErr("ZetaChain", `Error performing swap on Uniswap: ${swapError}`);
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
