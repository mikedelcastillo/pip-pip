import js from "@eslint/js"
import tseslint from "typescript-eslint"
import globals from "globals"

// Shared flat config for the workspace. ESLint 10 dropped .eslintrc support, so
// every package re-exports this from its own eslint.config.mjs. Mirrors the rules
// the packages used under the old eslintrc setup. tseslint.configs.recommended
// also disables core rules that conflict with TS (no-undef, no-redeclare, etc.).
export function config({ jsx = false } = {}){
    return tseslint.config(
        // Only lint TS sources, matching the old `eslint . --ext .ts[,.tsx]` scope.
        // Stray compiled .js artifacts and plain Node build scripts were never linted.
        { ignores: ["**/dist/**", "**/*.js", "**/*.cjs", "**/*.mjs"] },
        js.configs.recommended,
        ...tseslint.configs.recommended,
        {
            files: jsx ? ["**/*.ts", "**/*.tsx"] : ["**/*.ts"],
            languageOptions: {
                parserOptions: {
                    ecmaVersion: "latest",
                    sourceType: "module",
                    ...(jsx ? { ecmaFeatures: { jsx: true } } : {}),
                },
                globals: { ...globals.browser, ...globals.node },
            },
            rules: {
                "indent": ["error", 4],
                "linebreak-style": ["error", "unix"],
                "quotes": ["error", "double"],
                "semi": ["error", "never"],
                "@typescript-eslint/no-explicit-any": "warn",
                "@typescript-eslint/no-unused-vars": "warn",
                "@typescript-eslint/no-unsafe-declaration-merging": "warn",
                // New in ESLint 10's recommended set; only fires on benign
                // always-overwritten initializers here, not part of this repo's standards.
                "no-useless-assignment": "off",
            },
        },
    )
}
