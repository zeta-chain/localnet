export function tonFormatCoin(coins: bigint): string {
  const divisor = 1_000_000_000n;
  const tons = coins / divisor;
  const fractional = coins % divisor;

  if (fractional === 0n) {
    return String(tons);
  }

  // Ensure the fractional part is always 9 digits by padding with leading zeros if necessary
  let fractionalStr = fractional.toString().padStart(9, "0");
  fractionalStr = trimRight(fractionalStr, "0") || "0";

  return `${tons.toString()}.${fractionalStr}`;
}

function trimRight(str: string, cutset: string): string {
  if (str.length === 0 || cutset.length === 0) {
    return str;
  }

  let end = str.length;
  while (end > 0 && cutset.includes(str[end - 1])) {
    end--;
  }

  return str.slice(0, end);
}
