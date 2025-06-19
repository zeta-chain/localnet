import { ethers } from "ethers";

import { NetworkID } from "../../constants";
import { deployOpts } from "../../deployOpts";
import { logger } from "../../logger";
import { ZetachainContracts } from "../../types/contracts";
import { DepositZetaArgs } from "../../types/eventArgs";
import { contractCall } from "../../utils/contracts";

export const zetachainDepositZeta = async ({
  zetachainContracts,
  args,
}: {
  args: DepositZetaArgs;
  zetachainContracts: ZetachainContracts;
}): Promise<void> => {
  const [, receiver, amount] = args;
  const tx = (await contractCall(
    zetachainContracts.gatewayZEVM.connect(
      zetachainContracts.fungibleModuleSigner
    ),
    "deposit"
  )(amount, receiver, deployOpts)) as ethers.ContractTransactionResponse;
  await tx.wait();
  logger.info(
    `Deposited ${String(amount)} of WZETA tokens to ${String(receiver)}`,
    {
      chain: NetworkID.ZetaChain,
    }
  );
};
