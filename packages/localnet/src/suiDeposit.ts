import ansis from "ansis";
import { ethers } from "ethers";

import { logErr } from "./log";
import { solanaWithdraw } from "./solanaWithdraw";
import { zetachainDeposit } from "./zetachainDeposit";
import { zetachainSwapToCoverGas } from "./zetachainSwapToCoverGas";

export const suiDeposit = async ({
  protocolContracts,
  provider,
  fungibleModuleSigner,
  foreignCoins,
  chainID,
  deployer,
  amount,
  receiver,
  asset,
}: any) => {
  try {
    console.log(
      ansis.blue(
        `[${ansis.bold(
          "Sui"
        )}]: Gateway Deposit executed, ${amount} ${receiver}`
      )
    );
    await zetachainDeposit({
      args: [null, receiver, amount, asset],
      chainID,
      foreignCoins,
      fungibleModuleSigner,
      protocolContracts,
    });
  } catch (e) {}
};
