import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Sem `test.globals: true` no vitest.config.mts, a limpeza automática do
// Testing Library (que depende de `afterEach` global) não se registra sozinha.
// Primeiro teste com render() do repo: registra explicitamente, senão a
// árvore de um teste vaza pro DOM do próximo dentro do mesmo arquivo.
afterEach(cleanup);
