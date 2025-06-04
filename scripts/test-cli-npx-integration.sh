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

# Verify build artifacts exist
echo "  🔍 Verifying localnet build artifacts..."
if [[ -d "dist/commands" ]]; then
    echo "  ✅ localnet dist/commands/ directory exists"
else
    echo "  ❌ localnet dist/commands/ directory missing!"
    echo "  📂 Contents of localnet dist/:"
    ls -la dist/ || echo "  localnet dist/ doesn't exist at all!"
    exit 1
fi

if [[ -f "dist/commands/index.js" ]]; then
    echo "  ✅ localnet dist/commands/index.js exists"
else
    echo "  ❌ localnet dist/commands/index.js missing!"
    echo "  📂 Contents of localnet dist/commands/:"
    ls -la dist/commands/
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
    exit 1
fi

echo "  📦 Creating fresh tarball..."
npm pack
LOCALNET_TARBALL=$(ls zetachain-localnet-*.tgz | tail -1)
echo "✅ Created: $LOCALNET_TARBALL"

# Debug: Check what's actually in the tarball
echo "  🔍 Debugging tarball contents..."
echo "  📋 Files in tarball:"
tar -tzf "$LOCALNET_TARBALL" | grep -E "(commands|index)" || echo "  ⚠️  No commands/index files found in tarball!"
echo "  📋 Complete tarball structure:"
tar -tzf "$LOCALNET_TARBALL" | head -20

# Debug: Compare package.json in tarball vs source
echo "  🔍 Checking package.json in tarball vs source..."
echo "  📋 Extracting package.json from tarball..."
tar -xzf "$LOCALNET_TARBALL" package/package.json
echo "  📋 Tarball exports:"
if command -v jq &> /dev/null; then
    jq '.exports' package/package.json || grep -A 15 '"exports"' package/package.json
else
    grep -A 15 '"exports"' package/package.json
fi
echo "  📋 Source exports:"
if command -v jq &> /dev/null; then
    jq '.exports' package.json || grep -A 15 '"exports"' package.json
else
    grep -A 15 '"exports"' package.json
fi
# Cleanup extracted file
rm -rf package/

# Debug: Show the exact exports from package.json
echo "  🔍 Current exports in package.json:"
if command -v jq &> /dev/null; then
    jq '.exports' package.json || grep -A 15 '"exports"' package.json
else
    grep -A 15 '"exports"' package.json
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
yarn install

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
echo "  🔨 Building CLI with verbose TypeScript output..."
npx tsc --listFiles --listEmittedFiles | head -10
npm pack
CLI_TARBALL=$(ls zetachain-*.tgz | tail -1)
echo "✅ Created: $CLI_TARBALL"

# Step 5: Test with npx (with cache clearing)
echo "5️⃣ Testing with npx..."
echo "  🧹 Clearing npx cache..."
rm -rf ~/.npm/_npx 2>/dev/null || true

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
} catch (error) {
  console.log("❌ Direct import failed:");
  console.log(error.message);
  console.log("Stack:", error.stack);
}
EOF

echo "  🧪 Running direct import test..."
cd ../cli
node ../localnet/test-import.mjs

# Cleanup test file
rm -f ../localnet/test-import.mjs

echo "  🧪 Running CLI test with error details..."
echo "  🔍 Running with detailed error output..."
# Run with better error handling
echo "y" | npx ./$CLI_TARBALL localnet start --stop-after-init

echo "✅ Test completed successfully! Environment will be restored automatically." 