import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // TypeScript rules
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",
    
    // React rules
    "react-hooks/exhaustive-deps": "off",
    "react-hooks/purity": "off",
    "react-hooks/set-state-in-effect": "off",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",
    
    // Next.js rules
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",
    
    // General JavaScript rules
    "prefer-const": "off",
    "no-unused-vars": "off",
    "no-console": "off",
    "no-debugger": "off",
    "no-empty": "off",
    "no-irregular-whitespace": "off",
    "no-case-declarations": "off",
    "no-fallthrough": "off",
    "no-mixed-spaces-and-tabs": "off",
    "no-redeclare": "off",
    "no-undef": "off",
    "no-unreachable": "off",
    "no-useless-escape": "off",
    // 🔒 V26 Phase 6 §1.2 + Phase 4a: no off-scale text-[Npx], and nothing
    // below the 12px floor. text-2xs/text-3xs (11/10px) were removed in 4a.
    "no-restricted-syntax": ["error", {
      "selector": "Literal[value=/text-\\[\\d+px\\]|\\btext-[23]xs\\b/]",
      "message": "Use the type scale: text-xs (12px) is the floor. Arbitrary pixel sizes and the removed 10/11px steps are not allowed."
    }],
  },
}, {
  // Playwright fixtures take a `use` callback. The React Hooks rule reads that
  // as a misplaced `use()` hook — it is not one, and there is no React here.
  files: ["e2e/**/*.ts", "e2e/**/*.tsx"],
  rules: { "react-hooks/rules-of-hooks": "off" },
}, {
  // Node CJS config files, where require() is the correct call.
  files: ["*.config.js", "*.config.cjs"],
  rules: { "@typescript-eslint/no-require-imports": "off" },
}, {
  // scripts/** are standalone Node dev scripts run with `node scripts/x.js`,
  // where require() is the correct call and not a lint violation. They were
  // the only 17 errors in the tree; application source is clean. Excluding
  // them is what lets CI treat a lint error as a real failure again.
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills", "bahikhata-admin/**", "scripts/**"]
}];

export default eslintConfig;
