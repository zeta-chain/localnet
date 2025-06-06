const path = require("path");

/**
 * @type {import("eslint").Linter.Config}
 */
module.exports = {
  env: {
    browser: false,
    es2021: true,
    mocha: true,
    node: true,
  },
  extends: ["plugin:prettier/recommended"],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 12,
  },
  plugins: [
    "@typescript-eslint",
    "prettier",
    "simple-import-sort",
    "sort-keys-fix",
    "typescript-sort-keys",
    "prefer-arrow",
    "import",
  ],
  rules: {
    "@typescript-eslint/sort-type-union-intersection-members": "error",
    camelcase: "off",
    // "func-style": ["error", "expression", { allowArrowFunctions: true }],
    "func-style": "off",
    "import/no-cycle": ["error", { maxDepth: 10 }],
    "simple-import-sort/exports": "error",
    "simple-import-sort/imports": "error",
    "sort-keys-fix/sort-keys-fix": "error",
    "typescript-sort-keys/interface": "error",
    "typescript-sort-keys/string-enum": "error",
  },
  settings: {
    "import/parsers": {
      "@typescript-eslint/parser": [".js", ".jsx", ".ts", ".tsx", ".d.ts"],
    },
    "import/resolver": {
      node: {
        extensions: [".js", ".jsx", ".ts", ".tsx", ".d.ts"],
      },
      typescript: {
        project: path.join(__dirname, "tsconfig.json"),
      },
    },
  },
};
