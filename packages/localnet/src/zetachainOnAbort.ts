import { ethers } from "ethers";

import { log } from "./log";

export const zetachainOnAbort = async ({
  fungibleModuleSigner,
  provider,
  sender,
  asset,
  amount,
  chainID,
  revertMessage,
  abortAddress,
  outgoing,
}: any) => {
  const context = [
    ethers.toUtf8Bytes(sender),
    asset,
    amount,
    outgoing,
    chainID,
    revertMessage,
  ];

  const abortableContract = new ethers.Contract(
    abortAddress,
    [
      "function onAbort((bytes, address, uint256, bool, uint256, bytes) calldata abortContext) external",
    ],
    fungibleModuleSigner
  );

  log(
    "7001",
    `Contract ${abortAddress} executing onAbort, context: ${JSON.stringify(
      context
    )}`
  );
  const abortTx = await abortableContract.onAbort(context);
  await abortTx.wait();
  const logs = await provider.getLogs({
    address: abortAddress,
    fromBlock: "latest",
  });
  logs.forEach((data: any) => {
    log("7001", `Event from onAbort: ${JSON.stringify(data)}`);
  });
};
