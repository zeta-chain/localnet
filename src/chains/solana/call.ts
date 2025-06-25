import { ethers, hexlify } from "ethers";

import { NetworkID } from "../../constants";
import { logger } from "../../logger";
import { zetachainExecute } from "../zetachain/execute";
import { zetachainOnAbort } from "../zetachain/onAbort";

export const solanaCall = async ({
  provider,
  zetachainContracts,
  args,
  deployer,
  foreignCoins,
}: any) => {
  const chainID = NetworkID.Solana;
  const [sender, receiver, message, revertOptions] = args;
  try {
    logger.info("Gateway Call executed", {
      chain: NetworkID.Solana,
    });
    console.log(args);
    await zetachainExecute({
      args: [sender, receiver, message, revertOptions],
      chainID,
      deployer,
      foreignCoins,
      provider,
      zetachainContracts,
    });
  } catch (e) {
    logger.error(`Error during call: ${e}`, {
      chain: NetworkID.ZetaChain,
    });
    const abortAddress = hexlify(new Uint8Array(revertOptions[2]));
    const revertMessage = revertOptions[3];
    return await zetachainOnAbort({
      abortAddress: abortAddress,
      amount: 0,
      asset: ethers.ZeroAddress,
      chainID,
      fungibleModuleSigner: zetachainContracts.fungibleModuleSigner,
      gatewayZEVM: zetachainContracts.gatewayZEVM,
      outgoing: false,
      provider,
      revertMessage: revertMessage,
      sender,
    });
  }
};
