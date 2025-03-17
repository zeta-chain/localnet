import { z } from "zod";

export const initLocalnetAddressSchema = z.object({
  address: z.string(),
  chain: z.string(),
  type: z.string(),
});

export type InitLocalnetAddress = z.infer<typeof initLocalnetAddressSchema>;

export const initLocalnetAddressesSchema = z.array(initLocalnetAddressSchema);

export type InitLocalnetAddresses = z.infer<typeof initLocalnetAddressSchema>;
