import ansis from "ansis";
import { zetachainDeposit } from "./zetachainDeposit";
import { zetachainSwapToCoverGas } from "./zetachainSwapToCoverGas";
import { suiWithdraw } from "./suiWithdraw";

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
  sender,
  client,
  keypair,
  moduleId,
  gatewayObjectId,
  withdrawCapObjectId,
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
  } catch (e) {
    const { revertGasFee } = await zetachainSwapToCoverGas({
      amount,
      asset,
      chainID,
      deployer,
      foreignCoins,
      fungibleModuleSigner,
      gasLimit: 200000,
      protocolContracts,
      provider,
    });
    const revertAmount = BigInt(amount) - revertGasFee;
    // const receiver = ethers.toUtf8String(sender);
    if (revertAmount > 0) {
      await suiWithdraw({
        recipient: sender,
        amount: revertAmount,
        client,
        keypair,
        moduleId,
        gatewayObjectId,
        withdrawCapObjectId,
      });
    } else {
      console.error("Amount is not enough to make a revert back to Sui");
    }
  }
};
