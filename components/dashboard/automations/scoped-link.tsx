"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ComponentProps } from "react";
import { automationHref } from "@/lib/automations/navigation";

export function AutomationLink({ href, ...props }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const params = useSearchParams();
  return <Link {...props} href={automationHref(href, params.get("view"))} />;
}
