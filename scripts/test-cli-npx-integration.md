# CLI Integration Test Script

Tests that localnet changes work correctly when consumed by the `cli` via **npx execution context**.

## ⚠️ Critical Requirements

1. **Only committed changes will be included in the test** - uncommitted changes are ignored by `npm pack`
2. **For local development**: Both `localnet/` and `cli/` repositories should be in the same parent directory
3. **For CI**: Script automatically clones CLI repo from GitHub and cleans up afterward

## Usage

```bash
# From the localnet directory
./scripts/test-cli-npx-integration.sh
```

## What it does

1. 🔍 **Auto-detects environment**: Uses existing CLI repo locally, clones from GitHub in CI
2. 🔧 **Fixes TypeScript configuration**: Automatically updates CLI tsconfig.json for proper module resolution
3. 🔨 **Builds and packs** your committed localnet changes  
4. 📦 **Temporarily updates** CLI to use the local package
5. 🧪 **Tests integration via npx** with `npx zetachain localnet start --stop-after-init`
6. ⏱️ **120-second timeout protection** prevents hanging in CI environments
7. 🧹 **Comprehensive cleanup** restores everything automatically (even on failures)

## Key Features

### 🤖 CI/CD Integration
- **GitHub Actions compatible**: Works in automated CI environments
- **Auto-clones CLI repo**: No manual setup required in CI
- **Shallow clone optimization**: Uses `--depth 1` for faster CI performance
- **Automatic cleanup**: Removes cloned repo and temporary files

### 🔧 Smart Configuration Management
- **TypeScript fixes**: Automatically updates CLI module resolution from `"node16"` to `"nodenext"`
- **Cache management**: Clears yarn/npm caches to ensure fresh installs
- **Environment debugging**: Provides detailed system information for troubleshooting

### 🛡️ Robust Error Handling
- **Strict mode**: `set -euo pipefail` catches all errors
- **Timeout protection**: Kills hanging processes after 120 seconds
- **Comprehensive cleanup**: Restores state even when script fails or is interrupted
- **Exit code preservation**: Proper CI failure detection

### 🔍 Validation & Testing
- **Build artifact verification**: Ensures all required files exist
- **Package export validation**: Verifies localnet exports are correctly defined
- **Direct import testing**: Tests package imports before running CLI
- **Comprehensive logging**: Detailed output for debugging issues

## Prerequisites

- Node.js, npm, and yarn installed
- Git access to https://github.com/zeta-chain/cli (for auto-cloning)
- Localnet changes committed to git (uncommitted changes won't be tested)
- `jq` (optional, recommended for better JSON parsing - falls back to `grep` if not available)

## Supported Environments

### Local Development
```text
your-workspace/
├── localnet/         # This repo
└── cli/              # CLI repo (existing or will be cloned)
```

### CI/GitHub Actions
- Script automatically clones CLI repo
- No manual workspace setup required
- Automatic cleanup after testing

## Development Workflow

1. Make changes to localnet code and **commit them**
2. Run `./scripts/test-cli-npx-integration.sh` to verify npx CLI compatibility
3. Script handles all setup, testing, and cleanup automatically
4. Push changes if tests pass

## Debug Information
The script provides comprehensive debugging output including:
- Node.js, npm, yarn, and TypeScript versions
- Platform and environment details
- CLI configuration settings
- Build artifact verification
- Import resolution testing

## CI Integration

This script is designed to work seamlessly in GitHub Actions workflows. See the repository's `.github/workflows/` directory for example CI configurations that use this script.