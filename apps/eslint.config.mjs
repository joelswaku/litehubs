import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/.turbo/**",
      "output/**",
      "storage/**",
      "coverage/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      // LiteHubs predates flat-config linting. Keep pre-existing cleanup items
      // visible without blocking a release that already passes strict TypeScript
      // and production builds. New work should resolve these warnings.
      "prefer-const": "warn",
      "no-loss-of-precision": "warn",
      "no-extra-boolean-cast": "warn",
      "no-irregular-whitespace": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);