"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";

/**
 * Hook that drives selection via the URL (?sel=<id>) so detail/drawer state is
 * deep-linkable and survives refresh — all client-side, no reload.
 */
export function useSelection(param = "sel") {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = params.get(param);

  const select = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (id) next.set(param, id);
      else next.delete(param);
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router, param],
  );

  return { selected, select, clear: () => select(null) };
}
