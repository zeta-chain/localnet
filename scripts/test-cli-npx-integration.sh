#!/bin/bash

# Strict mode: exit on errors, undefined variables, or pipeline failures
set -euo pipefail
IFS=$'\n\t'

# Cleanup function to restore environment on script exit
cleanup() {
    echo ""
    echo "🧹 Cleanup function triggered..."
    
    # Only proceed if we're in the CLI directory and have backups
    if [[ -d "$WORKSPACE_ROOT/cli" ]]; then
        cd "$WORKSPACE_ROOT/cli"
        
        # Remove CLI tarball if it exists
        if [[ -n "${CLI_TARBALL:-}" && -f "$CLI_TARBALL" ]]; then
            echo "  🗑️  Removing CLI tarball: $CLI_TARBALL"
            rm -f "$CLI_TARBALL"
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
        
        # Remove any temporary files
        rm -f package.json.tmp
        
        # Run yarn install to restore dependencies
        echo "  📥 Running yarn install to restore dependencies..."
        if yarn install > /dev/null 2>&1; then
            echo "  ✅ Dependencies restored successfully"
        else
            echo "  ⚠️  Yarn install had issues, but files are restored"
        fi
    fi
    
    # Remove localnet tarball if it exists
    if [[ -n "${LOCALNET_TARBALL:-}" && -d "$WORKSPACE_ROOT/localnet" ]]; then
        cd "$WORKSPACE_ROOT/localnet"
        if [[ -f "$LOCALNET_TARBALL" ]]; then
            echo "  🗑️  Removing localnet tarball: $LOCALNET_TARBALL"
            rm -f "$LOCALNET_TARBALL"
        fi
    fi
    
    # Clean localnet test files that might interfere
    if [[ -d "$WORKSPACE_ROOT/localnet/test-ledger" ]]; then
        echo "  🧹 Cleaning localnet test files..."
        rm -rf "$WORKSPACE_ROOT/localnet/test-ledger"
    fi
    
    # Return to original directory if it exists
    if [[ -n "${ORIGINAL_DIR:-}" && -d "$ORIGINAL_DIR" ]]; then
        cd "$ORIGINAL_DIR"
        echo "  📍 Returned to original directory: $(pwd)"
    fi
    
    echo "🧹 Cleanup completed!"
}

# Register cleanup function to run on script exit
trap cleanup EXIT

echo "🧪 Testing localnet changes with CLI integration..."

# Remember starting directory
ORIGINAL_DIR=$(pwd)
# Navigate to workspace root (parent of localnet/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$WORKSPACE_ROOT"

echo "📍 Working from: $(pwd)"

# Step 1: Pack localnet (with cache clearing)
echo "1️⃣ Packing localnet..."
cd localnet
echo "  🧹 Clearing old tarballs..."
rm -f zetachain-localnet-*.tgz
echo "  🧹 Clearing build artifacts..."
rm -rf dist/
echo "  🔨 Force rebuilding..."
yarn build
echo "  📦 Creating fresh tarball..."
npm pack
LOCALNET_TARBALL=$(ls zetachain-localnet-*.tgz | tail -1)
echo "✅ Created: $LOCALNET_TARBALL"

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
yarn install

# Step 4: Pack CLI (with cache clearing)
echo "4️⃣ Packing CLI..."
echo "  🧹 Clearing old CLI tarballs..."
rm -f zetachain-*.tgz
npm pack
CLI_TARBALL=$(ls zetachain-*.tgz | tail -1)
echo "✅ Created: $CLI_TARBALL"

# Step 5: Test with npx (with cache clearing)
echo "5️⃣ Testing with npx..."
echo "  🧹 Clearing npx cache..."
rm -rf ~/.npm/_npx 2>/dev/null || true
echo "  🧪 Running test..."
echo "y" | npx ./$CLI_TARBALL localnet start --stop-after-init

echo "✅ Test completed successfully! Environment will be restored automatically." 