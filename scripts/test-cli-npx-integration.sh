#!/bin/bash

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

# Step 6: Cleanup
echo "6️⃣ Cleaning up..."
echo "  🗑️  Removing CLI tarball..."
rm -f $CLI_TARBALL

echo "  🗑️  Removing localnet tarball..."
rm -f ../localnet/$LOCALNET_TARBALL

echo "  📦 Restoring CLI package.json..."
if [[ -f package.json.backup ]]; then
    mv package.json.backup package.json
    echo "  ✅ package.json restored"
else
    echo "  ❌ package.json.backup not found!"
    ls -la package.json*
fi

echo "  📦 Restoring yarn.lock..."
if [[ -f yarn.lock.backup ]]; then
    mv yarn.lock.backup yarn.lock
    echo "  ✅ yarn.lock restored"
else
    echo "  ❌ yarn.lock.backup not found!"
    ls -la yarn.lock*
fi

echo "  🧹 Removing any leftovers..."
rm -f package.json.tmp

echo "  🧹 Cleaning localnet test files that might interfere..."
rm -rf ../localnet/test-ledger/ 2>/dev/null || true

echo "  📥 Running yarn install to restore dependencies..."
if yarn install > /dev/null 2>&1; then
    echo "  ✅ Dependencies restored successfully"
else
    echo "  ⚠️  Yarn install had issues, but files are restored"
fi

echo "✅ Cleanup completed!"

# Verify restoration
echo "🔍 Verifying restoration..."
echo "  Current directory: $(pwd)"
if grep -q "11.0.3-rc1" package.json 2>/dev/null; then
    echo "  ✅ package.json appears to be restored (contains 11.0.3-rc1)"
else
    echo "  ⚠️  package.json might not be properly restored"
    echo "  Current localnet version in package.json:"
    grep "@zetachain/localnet" package.json || echo "  No localnet dependency found"
fi

# Return to original directory
cd "$ORIGINAL_DIR"

echo ""
echo "✅ Test completed and environment restored!"
echo "📍 Current directory: $(pwd)" 