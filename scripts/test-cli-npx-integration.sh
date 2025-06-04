#!/bin/bash

# Strict mode: exit on errors, undefined variables, or pipeline failures
set -euo pipefail
IFS=$'\n\t'

# Track whether we cloned the CLI repo (for cleanup)
CLI_REPO_CLONED=false
# Track the exit code to preserve through cleanup
SCRIPT_EXIT_CODE=0

# Cleanup function to restore environment on script exit
cleanup() {
    local exit_code=$?
    # If script failed, preserve the error exit code
    if [[ $exit_code -ne 0 ]]; then
        SCRIPT_EXIT_CODE=$exit_code
    fi
    
    echo ""
    echo "🧹 Cleanup function triggered..."
    
    # Only proceed if we're in the CLI directory and have backups
    if [[ -d "${WORKSPACE_ROOT:-}/cli" ]]; then
        cd "${WORKSPACE_ROOT:-}/cli"
        
        # Remove CLI tarball if it exists
        if [[ -n "${CLI_TARBALL:-}" && -f "${CLI_TARBALL:-}" ]]; then
            echo "  🗑️  Removing CLI tarball: ${CLI_TARBALL:-}"
            rm -f "${CLI_TARBALL:-}"
        fi
        
        # Restore package.json if backup exists
        if [[ -f package.json.backup ]]; then
            echo "  📦 Restoring CLI package.json..."
            mv package.json.backup package.json
            echo "  ✅ package.json restored"
        fi
        
        # Restore yarn.lock if backup exists
        if [[ -f yarn.lock.backup ]]; then
            echo "  📦 Restoring yarn.lock..."
            mv yarn.lock.backup yarn.lock
            echo "  ✅ yarn.lock restored"
        fi
        
        # Restore tsconfig.json if backup exists (but not if we cloned the repo - it gets deleted entirely)
        if [[ "${CLI_REPO_CLONED:-false}" == "false" && -f tsconfig.json.backup ]]; then
            echo "  📦 Restoring CLI tsconfig.json..."
            mv tsconfig.json.backup tsconfig.json
            echo "  ✅ tsconfig.json restored"
        fi
        
        # Remove any temporary files
        rm -f package.json.tmp
        
        # Run yarn install to restore dependencies (suppress errors in cleanup)
        echo "  📥 Running yarn install to restore dependencies..."
        if yarn install > /dev/null 2>&1; then
            echo "  ✅ Dependencies restored successfully"
        else
            echo "  ⚠️  Yarn install had issues, but files are restored"
        fi
    fi
    
    # Remove localnet tarball if it exists
    if [[ -n "${LOCALNET_TARBALL:-}" && -d "${WORKSPACE_ROOT:-}/localnet" ]]; then
        cd "${WORKSPACE_ROOT:-}/localnet"
        if [[ -f "${LOCALNET_TARBALL:-}" ]]; then
            echo "  🗑️  Removing localnet tarball: ${LOCALNET_TARBALL:-}"
            rm -f "${LOCALNET_TARBALL:-}"
        fi
    fi
    
    # Clean localnet test files that might interfere
    if [[ -d "${WORKSPACE_ROOT:-}/localnet/test-ledger" ]]; then
        echo "  🧹 Cleaning localnet test files..."
        rm -rf "${WORKSPACE_ROOT:-}/localnet/test-ledger"
    fi
    
    # Remove CLI repo if we cloned it
    if [[ "${CLI_REPO_CLONED:-false}" == "true" && -d "${WORKSPACE_ROOT:-}/cli" ]]; then
        echo "  🗑️  Removing cloned CLI repository..."
        rm -rf "${WORKSPACE_ROOT:-}/cli"
        echo "  ✅ CLI repository cleaned up"
    fi
    
    # Clean up temporary NPX cache directory
    if [[ -n "${TEMP_NPX_CACHE:-}" && -d "${TEMP_NPX_CACHE:-}" ]]; then
        echo "  🗑️  Removing temporary NPX cache directory..."
        rm -rf "${TEMP_NPX_CACHE:-}"
        echo "  ✅ Temporary NPX cache cleaned up"
    fi
    
    # Return to original directory if it exists
    if [[ -n "${ORIGINAL_DIR:-}" && -d "${ORIGINAL_DIR:-}" ]]; then
        cd "${ORIGINAL_DIR:-}"
        echo "  📍 Returned to original directory: $(pwd)"
    fi
    
    echo "🧹 Cleanup completed!"
    
    # Exit with the preserved exit code
    if [[ ${SCRIPT_EXIT_CODE:-0} -ne 0 ]]; then
        echo "❌ Test failed with exit code: ${SCRIPT_EXIT_CODE:-0}"
        exit ${SCRIPT_EXIT_CODE:-1}
    fi
}

echo "🧪 Testing localnet changes with CLI integration..."

# Remember starting directory
ORIGINAL_DIR=$(pwd)
# Navigate to workspace root (parent of localnet/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Register cleanup function to run on script exit (after workspace variables are set)
trap cleanup EXIT SIGINT SIGTERM

cd "$WORKSPACE_ROOT"

echo "📍 Working from: $(pwd)"

# Check if CLI repo exists, clone if not
if [[ ! -d "cli" ]]; then
    echo "📥 CLI repository not found, cloning from GitHub..."
    echo "  🔗 Cloning https://github.com/zeta-chain/cli..."
    if ! git clone --depth 1 https://github.com/zeta-chain/cli.git; then
        echo "❌ Failed to clone CLI repository"
        SCRIPT_EXIT_CODE=1
        exit 1
    fi
    CLI_REPO_CLONED=true
    echo "  ✅ CLI repository cloned successfully"
else
    echo "✅ CLI repository found at: $(pwd)/cli"
fi

# Fix CLI tsconfig.json for proper module resolution
echo "🔧 Updating CLI tsconfig.json for proper module resolution..."
cd cli
# Create backup of original tsconfig.json
cp tsconfig.json tsconfig.json.backup
# Update tsconfig.json to use NodeNext with nodenext resolution (understands exports)
sed -i 's/"module": "Node16"/"module": "NodeNext"/' tsconfig.json
sed -i 's/"moduleResolution": "node16"/"moduleResolution": "nodenext"/' tsconfig.json
echo "✅ CLI configuration updated"
cd ..

# Step 1: Pack localnet (with cache clearing)
echo "1️⃣ Packing localnet..."
cd localnet
echo "  🧹 Clearing old tarballs..."
rm -f zetachain-localnet-*.tgz
echo "  🧹 Clearing build artifacts..."
rm -rf dist/
echo "  🔨 Force rebuilding..."
if ! yarn build; then
    echo "❌ Localnet build failed"
    SCRIPT_EXIT_CODE=1
    exit 1
fi

# Verify localnet build artifacts exist
echo "  🔍 Verifying localnet build artifacts..."
if [[ -d "dist/commands" ]]; then
    echo "  ✅ localnet dist/commands/ directory exists"
else
    echo "  ❌ localnet dist/commands/ directory missing!"
    echo "  📂 Contents of localnet dist/:"
    ls -la dist/ || echo "  localnet dist/ doesn't exist at all!"
    SCRIPT_EXIT_CODE=1
    exit 1
fi

if [[ -f "dist/commands/index.js" ]]; then
    echo "  ✅ localnet dist/commands/index.js exists"
else
    echo "  ❌ localnet dist/commands/index.js missing!"
    echo "  📂 Contents of localnet dist/commands/:"
    ls -la dist/commands/
    SCRIPT_EXIT_CODE=1
    exit 1
fi

# Verify package.json exports
echo "  🔍 Verifying localnet package.json exports..."
if grep -q '"./commands"' package.json; then
    echo "  ✅ ./commands export found in localnet package.json"
    echo "  📋 Localnet commands export definition:"
    grep -A 3 '"./commands"' package.json
else
    echo "  ❌ No ./commands export found in localnet package.json!"
    echo "  📋 Available exports in localnet package.json:"
    grep -A 10 '"exports"' package.json || echo "  No exports section found!"
    SCRIPT_EXIT_CODE=1
    exit 1
fi

echo "  📦 Creating fresh tarball..."
if ! npm pack; then
    echo "❌ Failed to create localnet tarball"
    SCRIPT_EXIT_CODE=1
    exit 1
fi
LOCALNET_TARBALL=$(ls zetachain-localnet-*.tgz | tail -1)
echo "✅ Created: $LOCALNET_TARBALL"

# Debug: Check what's actually in the tarball
echo "  🔍 Debugging tarball contents..."
echo "  📋 Key files in tarball:"
tar -tzf "$LOCALNET_TARBALL" | grep -E "(commands|index)" | head -10 || echo "  ⚠️  No commands/index files found in tarball!"

# Debug: Compare package.json in tarball vs source  
echo "  🔍 Checking package.json exports consistency..."
tar -xzf "$LOCALNET_TARBALL" package/package.json
if command -v jq &> /dev/null; then
    TARBALL_EXPORTS=$(jq -c '.exports."./commands"' package/package.json 2>/dev/null || echo "null")
    SOURCE_EXPORTS=$(jq -c '.exports."./commands"' package.json 2>/dev/null || echo "null")
else
    TARBALL_EXPORTS=$(grep -A 3 '"./commands"' package/package.json | tr -d '\n' | tr -s ' ')
    SOURCE_EXPORTS=$(grep -A 3 '"./commands"' package.json | tr -d '\n' | tr -s ' ')
fi
# Cleanup extracted file
rm -rf package/

if [[ "$TARBALL_EXPORTS" == "$SOURCE_EXPORTS" ]]; then
    echo "  ✅ Tarball exports match source"
else
    echo "  ⚠️  Tarball exports differ from source"
    echo "  Source: $SOURCE_EXPORTS"
    echo "  Tarball: $TARBALL_EXPORTS"
fi

# Step 2: Add new tarball as version in CLI package.json
echo "2️⃣ Updating CLI package.json..."
cd ../cli

cp package.json package.json.backup
cp yarn.lock yarn.lock.backup
echo "  🧹 Clearing yarn cache..."
yarn cache clean @zetachain/localnet 2>/dev/null || true
TARBALL_PATH="../localnet/$LOCALNET_TARBALL"
sed -i.tmp "s|\"@zetachain/localnet\": \"[^\"]*\"|\"@zetachain/localnet\": \"file:$TARBALL_PATH\"|" package.json
rm package.json.tmp
echo "✅ Updated package.json to use: $TARBALL_PATH"

# Step 3: Run yarn install (with cache clearing)
echo "3️⃣ Running yarn install..."
echo "  🧹 Removing node_modules to force fresh install..."
rm -rf node_modules/@zetachain/localnet
if ! yarn install; then
    echo "❌ CLI yarn install failed"
    SCRIPT_EXIT_CODE=1
    exit 1
fi

# Debug: Environment comparison before CLI build
echo "  🔍 Environment debugging..."
echo "  📋 Node.js version: $(node --version)"
echo "  📋 npm version: $(npm --version)"
echo "  📋 yarn version: $(yarn --version)"
echo "  📋 TypeScript version: $(npx tsc --version)"
echo "  📋 Platform: $(uname -a)"
echo "  📋 Working directory: $(pwd)"
echo "  📋 CLI tsconfig.json module settings:"
grep -A 2 -B 2 '"module"' tsconfig.json
echo "  📋 NODE_OPTIONS: ${NODE_OPTIONS:-'(none)'}"
echo "  📋 TS_NODE environment: ${TS_NODE_PROJECT:-'(none)'}"

# Step 4: Pack CLI (with cache clearing)
echo "4️⃣ Packing CLI..."
echo "  🧹 Clearing old CLI tarballs..."
rm -f zetachain-*.tgz
echo "  🔨 Building CLI..."
if ! npx tsc; then
    echo "❌ CLI TypeScript compilation failed"
    SCRIPT_EXIT_CODE=1
    exit 1
fi
echo "  📋 TypeScript compilation verbose output (preview):"
npx tsc --listFiles --listEmittedFiles | head -10 || true
if ! npm pack; then
    echo "❌ Failed to create CLI tarball"
    SCRIPT_EXIT_CODE=1
    exit 1
fi
CLI_TARBALL=$(ls zetachain-*.tgz | tail -1)
echo "✅ Created: $CLI_TARBALL"

# Step 5: Test with npx (with cache clearing)
echo "5️⃣ Testing with npx..."
echo "  🧹 Creating temporary NPX cache directory..."
TEMP_NPX_CACHE=$(mktemp -d)
echo "  📁 Using temporary NPX cache: $TEMP_NPX_CACHE"

# Debug: Let's see what the CLI actually compiled to
echo "  🔍 Checking CLI build output for import paths..."
echo "  📋 CLI dist structure:"
if [[ -d "dist" ]]; then
    find dist -name "*.js" | head -10
    echo "  📋 Checking for localnet imports in CLI dist:"
    grep -r "@zetachain/localnet" dist/ | head -5 || echo "  No localnet imports found in CLI dist"
    echo "  📋 Checking for direct dist/ imports in CLI dist:"
    grep -r "dist/commands" dist/ | head -5 || echo "  No direct dist/commands imports found"
else
    echo "  ⚠️  CLI dist directory not found"
fi

# Debug: Test localnet package directly before running CLI
echo "  🔍 Testing localnet package import directly..."
cd "$WORKSPACE_ROOT/localnet"
echo "  📋 Creating test import script..."
cat > test-import.mjs << 'EOF'
try {
  console.log("Testing import of @zetachain/localnet/commands...");
  const { localnetCommand } = await import("@zetachain/localnet/commands");
  console.log("✅ Direct import successful!");
  console.log("localnetCommand type:", typeof localnetCommand);
  process.exit(0);
} catch (error) {
  console.error("❌ Direct import failed:", error);
  process.exit(1);
}
EOF

echo "  🧪 Running direct import test..."
cd ../cli
if ! node ../localnet/test-import.mjs; then
    echo "❌ Direct localnet import test failed"
    rm -f ../localnet/test-import.mjs
    SCRIPT_EXIT_CODE=1
    exit 1
fi

# Cleanup test file
rm -f ../localnet/test-import.mjs

echo "  🧪 Running CLI test with error details..."
echo "  🔍 Running with detailed error output..."
# Cross-platform timeout implementation - works on both macOS and Linux
echo "  ⏱️  Setting 120-second timeout for npx test..."

# Run npx in background with isolated cache and capture its PID
echo "y" | npm_config_cache="$TEMP_NPX_CACHE" npx ./$CLI_TARBALL localnet start --stop-after-init &
NPX_PID=$!

# Wait for the process with timeout
TIMEOUT_SECONDS=120
ELAPSED=0
while kill -0 $NPX_PID 2>/dev/null && [ $ELAPSED -lt $TIMEOUT_SECONDS ]; do
    sleep 1
    ELAPSED=$((ELAPSED + 1))
done

# Check if process is still running (timed out)
if kill -0 $NPX_PID 2>/dev/null; then
    echo "❌ CLI npx integration test timed out after $TIMEOUT_SECONDS seconds"
    echo "🔍 This usually indicates localnet failed to start or is hanging"
    echo "💡 If running in CI, try triggering another workflow run - timeouts can be caused by transient CI environment issues"
    # Kill the hanging process
    echo "🧹 Killing hanging npx process (PID: $NPX_PID)..."
    kill -TERM $NPX_PID 2>/dev/null || true
    sleep 2
    # Force kill if still running
    kill -KILL $NPX_PID 2>/dev/null || true
    # Try to kill any hanging anvil/localnet processes
    echo "🧹 Attempting to kill any hanging anvil/localnet processes..."
    pkill -f "anvil" 2>/dev/null || true
    pkill -f "localnet" 2>/dev/null || true
    SCRIPT_EXIT_CODE=1
    exit 1
fi

# Wait for the process to complete and get its exit code
wait $NPX_PID
NPX_EXIT_CODE=$?

# Check if the npx command failed
if [[ $NPX_EXIT_CODE -ne 0 ]]; then
    echo "❌ CLI npx integration test failed with exit code: $NPX_EXIT_CODE"
    SCRIPT_EXIT_CODE=1
    exit 1
fi

echo "✅ Test completed successfully! Environment will be restored automatically." 