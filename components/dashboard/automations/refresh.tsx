"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

/** Follow worker progress without a full reload or replacing editor state. */
export function AutomationRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (!active || pending) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") startTransition(() => router.refresh());
    }, 5000);
    return () => window.clearInterval(timer);
  }, [active, pending, router]);
  return null;
}
