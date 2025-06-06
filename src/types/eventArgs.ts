import { z } from "zod";

// Common revert options structure used across different event handlers
export const RevertOptionsSchema = z.tuple([
  z.string(), // revertAddress
  z.boolean(), // callOnRevert
  z.string(), // abortAddress
  z.string(), // revertMessage
  z.union([z.string(), z.number(), z.bigint()]), // onRevertGasLimit
]);

export const CallOptionsSchema = z.tuple([
  z.union([z.string(), z.number(), z.bigint()]), // gasLimit
  z.boolean(), // isArbitraryCall
]);

// Schema for execute event args: [sender, receiver, message, revertOptions]
export const ExecuteArgsSchema = z.tuple([
  z.string(), // sender
  z.string(), // receiver
  z.string(), // message
  RevertOptionsSchema, // revertOptions
]);

// Schema for call event args: [sender, zrc20, receiver, message, callOptions, revertOptions]
export const CallArgsSchema = z.tuple([
  z.string(), // sender
  z.string(), // zrc20
  z.string(), // receiver
  z.string(), // message
  z.object({
    gasLimit: z.union([z.string(), z.number(), z.bigint()]),
    isArbitraryCall: z.boolean(),
  }), // callOptions
  RevertOptionsSchema, // revertOptions
]);

// Schema for deposit event args: [sender, unknown, amount, asset, unknown, revertOptions]
export const DepositArgsSchema = z.tuple([
  z.string(), // sender
  z.unknown(), // placeholder
  z.union([z.string(), z.number(), z.bigint()]), // amount
  z.string(), // asset
  z.unknown(), // placeholder
  RevertOptionsSchema, // revertOptions
]);

// Schema for withdraw event args: [sender, unknown, receiver, zrc20, amount, ..., revertOptions]
export const WithdrawArgsSchema = z.tuple([
  z.string(), // sender
  z.unknown(), // placeholder
  z.string(), // receiver
  z.string(), // zrc20
  z.union([z.string(), z.number(), z.bigint()]), // amount
  z.unknown(), // placeholder
  z.unknown(), // placeholder
  z.unknown(), // placeholder
  z.unknown(), // placeholder
  RevertOptionsSchema, // revertOptions
]);

// Schema for depositAndCall event args: [sender, receiver, amount, asset, message, revertOptions]
export const DepositAndCallArgsSchema = z.tuple([
  z.string(), // sender
  z.string(), // receiver
  z.union([z.string(), z.number(), z.bigint()]), // amount
  z.string(), // asset
  z.string(), // message
  RevertOptionsSchema, // revertOptions
]);

// Schema for withdrawAndCall event args: [sender, unknown, receiver, zrc20, amount, unknown, unknown, message, callOptions]
export const WithdrawAndCallArgsSchema = z.tuple([
  z.string(), // sender
  z.unknown(), // placeholder
  z.string(), // receiver
  z.string(), // zrc20
  z.union([z.string(), z.number(), z.bigint()]), // amount
  z.unknown(), // placeholder
  z.unknown(), // placeholder
  z.string(), // message
  z.tuple([
    z.union([z.string(), z.number(), z.bigint()]), // gasLimit
    z.boolean(), // isArbitraryCall
  ]), // callOptions
]);

// Schema for TSS transfer event args: [sender, ?, receiver, zrc20, amount, ?, ?, ?, ?, revertOptions]
export const TSSTransferArgsSchema = z.tuple([
  z.string(), // sender
  z.unknown(), // unused index 1
  z.string(), // receiver
  z.string(), // zrc20
  z.union([z.string(), z.number(), z.bigint()]), // amount
  z.unknown(), // unused index 5
  z.unknown(), // unused index 6
  z.unknown(), // unused index 7
  z.unknown(), // unused index 8
  RevertOptionsSchema, // revertOptions
]);

// Export types
export type RevertOptions = z.infer<typeof RevertOptionsSchema>;
export type CallOptions = z.infer<typeof CallOptionsSchema>;
export type ExecuteArgs = z.infer<typeof ExecuteArgsSchema>;
export type CallArgs = z.infer<typeof CallArgsSchema>;
export type DepositArgs = z.infer<typeof DepositArgsSchema>;
export type WithdrawArgs = z.infer<typeof WithdrawArgsSchema>;
export type DepositAndCallArgs = z.infer<typeof DepositAndCallArgsSchema>;
export type WithdrawAndCallArgs = z.infer<typeof WithdrawAndCallArgsSchema>;
export type TSSTransferArgs = z.infer<typeof TSSTransferArgsSchema>;
