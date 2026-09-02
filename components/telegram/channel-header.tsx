import type { FeedChannel } from "@/lib/social-proof/types";

/**
 * Topo do canal: avatar, título, selo de verificado e a linha de inscritos.
 *
 * É a moldura que faz o feed parecer app; bolha boa dentro de moldura errada
 * continua parecendo site.
 */
export function ChannelHeader({ channel }: { channel: FeedChannel }) {
  return (
    <header
      style={{
        position: "relative",
        zIndex: 2,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        paddingTop: "calc(8px + env(safe-area-inset-top))",
        background: "var(--tgc-header-bg)",
        borderBottom: "1px solid rgba(0,0,0,0.2)",
        flexShrink: 0,
      }}
    >
      {channel.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={channel.avatarUrl}
          alt={channel.title}
          width={40}
          height={40}
          style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
        />
      ) : (
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            flexShrink: 0,
            background: "var(--tgc-button)",
            color: "var(--tgc-button-text)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 17,
            fontWeight: 500,
          }}
        >
          {channel.title.trim().charAt(0).toUpperCase() || "#"}
        </div>
      )}

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 16,
            fontWeight: 600,
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{channel.title}</span>
          {channel.isVerified && (
            <svg width="16" height="16" viewBox="0 0 24 24" aria-label="verificado" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="11" fill="#3fa9f5" />
              <path
                d="M7 12.5l3.2 3.2L17 9"
                stroke="#ffffff"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          )}
        </div>
        <div style={{ color: "var(--tgc-hint)", fontSize: 13, lineHeight: 1.2 }}>
          {channel.subscribersLabel}
        </div>
      </div>
    </header>
  );
}
