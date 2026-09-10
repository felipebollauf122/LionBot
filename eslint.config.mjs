import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Diretórios de trabalho de agente e artefatos de build: não é código do
    // projeto, e lintar isso afogava os problemas reais em ~20 mil ruídos.
    ".claude/**",
    ".superpowers/**",
    "server/dist/**",
  ]),
]);

export default eslintConfig;
