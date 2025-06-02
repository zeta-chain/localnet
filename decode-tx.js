const ethers = require("ethers");

// The failing transaction data (without 0x prefix in the error)
const txData =
  "0x38e22527000000000000000000000000a513e6e4b8f2a923d98304ec87f64353c4d5c8530000000000000000000000009a676e781a523b5d0c0e43731313a708cb60750800000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000c4a8f2cb96000000000000000000000000000000000000000000000000000000000006100000000000000000000000091d18e54daf4f677cb28167158d6dd21f6ab3921000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000014a85233c63b9ee964add6f2cffe00fd84eb32338f00000000000000000000000000000000000000000000000000000000000000000000000000000000";

// Let me check what function selector this is
const selector = txData.slice(0, 10);
console.log("Function selector:", selector);

// Try Gateway execute function
const gatewayAbi = [
  "function execute(address,address,bytes)",
  "function execute(address target, bytes data)",
];

// Try decoding with different signatures
for (const sig of gatewayAbi) {
  try {
    const iface = new ethers.Interface([sig]);
    const decoded = iface.decodeFunctionData(txData);
    console.log("\nSuccessfully decoded with signature:", sig);
    console.log("Decoded:", decoded);
    break;
  } catch (e) {
    // Try next
  }
}

// Check if it's an event-related call
const eventAbi = [
  "function Called(address,address,bytes,tuple(uint256,bool))",
  "function onCall(address,bytes)",
  "function execute(address,address,bytes)",
];

console.log("\nTrying to match function by selector...");
const iface = new ethers.Interface(eventAbi);
try {
  const funcFragment = iface.getFunction(selector);
  if (funcFragment) {
    console.log("Matched function:", funcFragment.format("full"));
  }
} catch (e) {
  console.log("No match found in event ABI");
}

// Let's check what this selector corresponds to
console.log("\nChecking common function selectors...");
const commonSelectors = {
  "0x38e22527": "execute(address,address,bytes)",
  "0x631d62e4": "registerContract(uint256,string,bytes)",
  "0xa8f2cb96": "registerChain(uint256,bytes20,bytes,bool)",
};

if (commonSelectors[selector]) {
  console.log("This selector corresponds to:", commonSelectors[selector]);
}
