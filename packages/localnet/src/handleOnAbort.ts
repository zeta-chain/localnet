import { ethers } from "ethers";
import { log } from "./log";

export const handleOnAbort = async ({
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
  const abortContext = [
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

  log("ZetaChain", "Attempting to call onAbort...");
  const abortTx = await abortableContract.onAbort(abortContext);
  await abortTx.wait();

  log("ZetaChain", "Gateway: successfully called onAbort");
  const logs = await provider.getLogs({
    address: abortAddress,
    fromBlock: "latest",
  });
  logs.forEach((data: any) => {
    log("ZetaChain", `Event from onAbort: ${JSON.stringify(data)}`);
  });
};
