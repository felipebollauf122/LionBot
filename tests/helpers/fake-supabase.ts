/**
 * Cliente Supabase encadeável de mentira, pros testes de Server Action.
 *
 * Não é um teste — mora em `tests/helpers/` de propósito, fora do
 * `include` do vitest.config.mts (`tests/**\/*.test.ts(x)`).
 *
 * Por que um fake genérico e não `vi.fn()` aninhado à mão (o estilo de
 * tests/lib/ai-assist-ownership.test.ts): as actions da campanha encadeiam
 * combinações diferentes de `.eq`/`.in`/`.order`/`.select`, e o que estes
 * testes precisam provar é justamente QUAIS filtros cada escrita carrega —
 * uma escrita de ciclo de vida presa só ao id foi a origem de dois
 * bloqueadores desta revisão. Registrando tabela, operação, payload e
 * filtros, a asserção fica sobre o SQL pretendido, não sobre a forma da
 * cadeia. Mesmo espírito do fake de server/tests/services/scheduled-send.test.ts.
 */

export interface ChamadaFake {
  table: string;
  op: "select" | "update" | "insert" | "delete";
  payload?: Record<string, unknown>;
  /** Coluna -> valor de `.eq()`/`.in()`. `.in()` guarda o array inteiro. */
  filtros: Record<string, unknown>;
}

export interface RespostaFake {
  data?: unknown;
  error?: unknown;
  count?: number;
}

export function criarSupabaseFake<T>(responder: (ch: ChamadaFake) => RespostaFake): {
  client: T;
  chamadas: ChamadaFake[];
} {
  const chamadas: ChamadaFake[] = [];

  function from(table: string) {
    const ch: ChamadaFake = { table, op: "select", filtros: {} };
    const resolver = (): Promise<RespostaFake> => {
      chamadas.push(ch);
      return Promise.resolve(responder(ch));
    };
    const q: Record<string, unknown> = {
      select: () => q,
      update: (payload: Record<string, unknown>) => {
        ch.op = "update";
        ch.payload = payload;
        return q;
      },
      insert: (payload: Record<string, unknown>) => {
        ch.op = "insert";
        ch.payload = payload;
        return q;
      },
      delete: () => {
        ch.op = "delete";
        return q;
      },
      eq: (coluna: string, valor: unknown) => {
        ch.filtros[coluna] = valor;
        return q;
      },
      in: (coluna: string, valor: unknown) => {
        ch.filtros[coluna] = valor;
        return q;
      },
      not: () => q,
      order: () => q,
      limit: () => q,
      single: resolver,
      maybeSingle: resolver,
      // Thenable: `await supabase.from(...).update(...).eq(...)` resolve sem
      // `.single()`, como o supabase-js de verdade.
      then: (ok: (r: RespostaFake) => unknown, falha?: (e: unknown) => unknown) =>
        resolver().then(ok, falha),
    };
    return q;
  }

  return { client: { from } as unknown as T, chamadas };
}
