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
  and and relaying the contract calls between EVM gateway and ZetaChain gateway

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
======================

Gateway EVM: 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
ZETA:        0x5FbDB2315678afecb367f032d93F642f64180aa3


ZetaChain Contract Addresses
============================

Gateway ZetaChain: 0x610178dA211FEF7D417bC0e6FeD39F05609AD788
ZETA:              0xa513E6E4b8f2a923D98304ec87F64353C4D5C853
ZRC-20 ETH:        0x9fd96203f7b22bCF72d9DCb40ff98302376cE09c
```

You can also start localnet with custom Anvil parameters and using a different
port:

```
yarn hardhat localnet --anvil "--block-time 1" --port 2000
```
