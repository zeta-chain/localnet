# CLI Integration Test Script

Tests that localnet changes work correctly when consumed by the `cli` via **npx execution context**.

## ⚠️ Critical Requirements

1. **Both `localnet/` and `cli/` repositories must be in the same parent directory**
2. **Only committed changes will be included in the test** - uncommitted changes are ignored by `npm pack`

## Usage

```bash
# From the localnet directory
./scripts/test-cli-npx-integration.sh
```

## What it does

1. 🔨 Builds and packs your committed localnet changes  
2. 📦 Temporarily updates `cli` to use the local package
3. 🧪 **Tests integration via npx** with `npx zetachain localnet start --stop-after-init`
4. 🧹 Cleans up and restores everything

## Prerequisites

- Node.js, npm, and yarn installed
- Both repos cloned in the same parent directory
- Localnet changes committed to git (uncommitted changes won't be tested)

## Expected workspace structure

```text
your-workspace/
├── localnet/         # This repo
└── cli/              # CLI repo  
```

## Development Workflow

1. Make changes to localnet code and **commit them**
2. Run `./scripts/test-cli-npx-integration.sh` to verify npx `cli` compatibility
3. Push changes if tests pass