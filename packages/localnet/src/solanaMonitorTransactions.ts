import Gateway_IDL from "./solana/idl/gateway.json";
import * as anchor from "@coral-xyz/anchor";

export const solanaMonitorTransactions = async () => {
  const gatewayProgram = new anchor.Program(Gateway_IDL as anchor.Idl);

  const connection = gatewayProgram.provider.connection;

  console.log(
    `Monitoring new transactions for program: ${gatewayProgram.programId.toBase58()}`
  );

  let lastSignature: string | undefined = undefined;

  setInterval(async () => {
    let signatures;
    try {
      signatures = await connection.getSignaturesForAddress(
        gatewayProgram.programId,
        { limit: 10 },
        "confirmed"
      );

      if (signatures.length === 0) return;

      const newSignatures = [];

      for (const signatureInfo of signatures) {
        if (signatureInfo.signature === lastSignature) {
          break;
        } else {
          newSignatures.push(signatureInfo);
        }
      }

      if (newSignatures.length === 0) return;

      for (const signatureInfo of newSignatures.reverse()) {
        try {
          const transaction = await connection.getTransaction(
            signatureInfo.signature,
            { commitment: "confirmed" }
          );

          if (transaction) {
            console.log("New Transaction Details:", transaction);

            for (const instruction of transaction.transaction.message
              .instructions) {
              const programIdIndex =
                instruction.programIdIndex || (instruction as any).programId;
              const programIdFromInstruction =
                transaction.transaction.message.accountKeys[programIdIndex];

              if (
                programIdFromInstruction &&
                programIdFromInstruction.equals(gatewayProgram.programId)
              ) {
                console.log("Instruction for program detected:", instruction);

                let coder = new anchor.BorshInstructionCoder(
                  Gateway_IDL as anchor.Idl
                );
                let decodedInstruction = coder.decode(
                  instruction.data,
                  "base58"
                );
                console.log("Decoded Instruction:", decodedInstruction);
              }
            }
          }
        } catch (transactionError) {
          console.error(
            `Error processing transaction ${signatureInfo.signature}:`,
            transactionError
          );
          // Continue to the next transaction even if an error occurs
          continue;
        }
      }
    } catch (error) {
      console.error("Error monitoring new transactions:", error);
    } finally {
      // Update lastSignature even if an error occurs
      if (signatures && signatures.length > 0) {
        lastSignature = signatures[0].signature;
      }
    }
  }, 1000);
};
