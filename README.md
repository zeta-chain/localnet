# Localnet

Localnet is a local development environment that simplifies the development of
universal apps.

Localnet:

- Starts an [Anvil](https://book.getfoundry.sh/anvil/) local testnet node
- Deploys [protocol
  contracts](https://github.com/zeta-chain/protocol-contracts/tree/main/v2) on
  the local testnet node. Both EVM gateway and ZetaChain gateway are deployed
  and running on the same local blockchain
- Simulates the real-world testnet environment of ZetaChain by observing events
  and relaying the contract calls between EVM gateway and ZetaChain gateway

Install dependencies:

```
yarn
```

Start localnet:

```
yarn hardhat localnet
```

```
EVM Contract Addresses
=======================
┌─────────────────┬──────────────────────────────────────────────┐
│   Gateway EVM   │ '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0' │
│ ERC-20 Custody  │ '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9' │
│       TSS       │ '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' │
│      ZETA       │ '0x5FbDB2315678afecb367f032d93F642f64180aa3' │
│ ERC-20 USDC.ETH │ '0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82' │
└─────────────────┴──────────────────────────────────────────────┘

ZetaChain Contract Addresses
=============================
┌───────────────────┬──────────────────────────────────────────────┐
│ Gateway ZetaChain │ '0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0' │
│       ZETA        │ '0xa513E6E4b8f2a923D98304ec87F64353C4D5C853' │
│  Fungible Module  │ '0x735b14BB79463307AAcBED86DAf3322B1e6226aB' │
│  System Contract  │ '0x610178dA211FEF7D417bC0e6FeD39F05609AD788' │
│  ZRC-20 USDC.ETH  │ '0x9fd96203f7b22bCF72d9DCb40ff98302376cE09c' │
│  ZRC-20 ETH.ETH   │ '0x91d18e54DAf4F677cB28167158d6dd21F6aB3921' │
└───────────────────┴──────────────────────────────────────────────┘
```

You can also start localnet with custom Anvil parameters and using a different
port:

```
yarn hardhat localnet --anvil "--block-time 1" --port 2000
```
