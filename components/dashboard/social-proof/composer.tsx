"use client";

import type { SocialProofChannel, SocialProofMessage } from "@/lib/types/database";
import { ComposerShell } from "@/components/dashboard/social-proof/composer-shell";

/**
 * Mantido como ponto de entrada para a página da aba não precisar mudar.
 * Toda a lógica vive em ComposerShell.
 */
export function SocialProofComposer(props: {
  botId: string;
  channel: SocialProofChannel | null;
  messages: SocialProofMessage[];
}) {
  return <ComposerShell {...props} />;
}
