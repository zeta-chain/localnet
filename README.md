# V2 Contracts - Local Development Environment

Important Notice: The new architecture (V2) is currently in active development. While the high-level interface presented in this document is expected to remain stable, some aspects of the architecture may change.

## Introduction

The new architecture aims to streamline the developer experience for building Universal Apps. Developers will primarily interact with two contracts: GatewayZEVM and GatewayEVM.

* `GatewayEVM`: Deployed on each connected chain to interact with ZetaChain.
* `GatewayZEVM`: Deployed on ZetaChain to interact with connected chains.

V2 contracts source code is currently located in [prototypes](/contracts/prototypes/)

## Contract Interfaces

The interface of the gateway contracts is centered around the deposit, withdraw, and call terminology:

* Deposit: Transfer of assets from a connected chain to ZetaChain.
* Withdraw: Transfer of assets from ZetaChain to a connected chain.
* Call: Smart contract call involved in cross-chain transactions.


In consequence, the interface is as follow:
* `GatewayEVM`: `deposit`, `depositAndCall`, and `call`
* `GatewayZEVM`: `withdraw`, `withdrawAndCall`, and `call`

The motivation behind this interface is intuitiveness and simplicity. We support different asset types by using function overloading.

### `GatewayEVM`

* Deposit of native tokens to addresses on ZetaChain:

```solidity
function deposit(address receiver) payable
```

* Deposit of ERC-20 tokens to addresses on ZetaChain:

```solidity
function deposit(address receiver, uint256 amount, address asset)
```

* Deposit of native tokens and smart contract call on ZetaChain:

```solidity
function depositAndCall(address receiver, bytes calldata payload) payable
```

* Deposit of ERC-20 tokens and smart contract call on ZetaChain:

```solidity
depositAndCall(address receiver, uint256 amount, address asset, bytes calldata payload)
```

* Simple Universal App contract call:

```solidity
function call(address receiver, bytes calldata payload)
```

### `GatewayZEVM`

* Withdraw of ZRC-20 tokens to its native connected chain:

```solidity
function withdraw(bytes memory receiver, uint256 amount, address zrc20)
```

* Withdraw of ZRC-20 tokens and smart contract call on connected chain:

```solidity
function withdrawAndCall(bytes memory receiver, uint256 amount, address zrc20, bytes calldata message)
```

* Simple call to a contract on a connected chain:

```solidity
function call(bytes memory receiver, bytes calldata message) external
```

## Experimenting with the New Architecture

To experiment with the new architecture, you can deploy a local network using Hardhat and test the gateways using the following commands:

Clone the repository
```
git clone https://github.com/zeta-chain/protocol-contracts.git
cd protocol-contracts
```

Start the local environment network
Note: `--hide="NODE"` is used to prevent verbose logging
```
yarn
yarn localnet --hide="NODE"
```

The `localnet` command launches two processes:

- A local Ethereum network (using Hardhat) with the two gateway contracts deployed
- A background worker that relay messages between the two gateway contracts. It simulates the cross-chain message relaying that would normally happen between live networks with the [observers/signers](https://www.zetachain.com/docs/developers/architecture/observers/) mechanism. This allows to simulate a cross-chain environment on a single local chain.

Running the command will deploy the two gateway contracts:

```
[WORKER] GatewayEVM: 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
[WORKER] GatewayZEVM: 0x0165878A594ca255338adfa4d48449f69242Eb8F
```

The developers can develop application using these addresses, the messages will automatically be relayed by the worker.

The local environment uses Hardhat localnet. Therefore, the default Hardhat localnet accounts can be used to interact with the network.

```
Account #0: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 (10000 ETH)
Private Key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

Account #1: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 (10000 ETH)
Private Key: 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d

Account #2: 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC (10000 ETH)
Private Key: 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
```

### Examples

The example contracts demonstrate how the V2 interface can be leveraged to build Universal Apps.

* [TestZContract](/contracts/prototypes/zevm/TestZContract.sol): ZetaChain contract (Universal App) that can be called from a connected chains
* [SenderZEVM](/contracts/prototypes/zevm/SenderZEVM.sol): ZetaChain contract calling a smart contract on a connected chains
* [ReceiverEVM](/contracts/prototypes/evm/ReceiverEVM.sol): contract on connected chain that can be called from ZetaChain

The following commands can be used to test interactions between these contracts:
```
npx hardhat zevm-call --network localhost
npx hardhat zevm-withdraw-and-call --network localhost
npx hardhat evm-call --network localhost
npx hardhat evm-deposit-and-call --network localhost
```