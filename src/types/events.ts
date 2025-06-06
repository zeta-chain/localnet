import { z } from "zod";

// Schema for revertOptions array based on usage across different chains
// revertOptions[2] = abortAddress, revertOptions[3] = revertMessage, revertOptions[4] = gasLimit
export const revertOptionsSchema = z.tuple([
  z.unknown(), // position 0
  z.unknown(), // position 1
  z.string(), // position 2: abortAddress
  z.string(), // position 3: revertMessage
  z.union([z.string(), z.number(), z.bigint()]), // position 4: gasLimit
]);

// DepositAndCall args schema: [sender, receiver, amount, asset, message, revertOptions]
export const depositAndCallArgsSchema = z.tuple([
  z.string(), // position 0: sender (address)
  z.string(), // position 1: receiver (contract address)
  z.bigint(), // position 2: amount (used in arithmetic operations)
  z.string(), // position 3: asset (address, compared to ethers.ZeroAddress)
  z.string(), // position 4: message (call data),
  revertOptionsSchema, // position 5: revertOptions
]);

export type DepositAndCallArgs = z.infer<typeof depositAndCallArgsSchema>;
export type RevertOptions = z.infer<typeof revertOptionsSchema>;
