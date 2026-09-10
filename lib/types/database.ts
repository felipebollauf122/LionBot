import type { MediaItem, Reaction } from "@/lib/social-proof/types";

// === Enums ===
export type TransactionStatus = "pending" | "approved" | "refused" | "refunded";
export type TriggerType = "command" | "first_contact" | "callback" | "payment_event";
export type TrackingEventType = "page_view" | "bot_start" | "view_offer" | "checkout" | "purchase";
export type TrackingMode = "redirect" | "prelander";
export type NodeType = "trigger" | "text" | "image" | "video" | "audio" | "button" | "payment_button" | "delay" | "condition" | "input" | "action" | "unmapped";

// === Flow Data (JSONB structure) ===
export interface FlowNode {
  id: string;
  type: NodeType;
  data: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface FlowData {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

// === Database Row Types ===
export type UserRole = "user" | "admin";

export interface Tenant {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  is_owner: boolean;
  is_premium: boolean;
  plan: string | null;
  created_at: string;
}

export interface Bot {
  id: string;
  tenant_id: string;
  telegram_token: string;
  bot_username: string;
  webhook_url: string | null;
  is_active: boolean;
  facebook_pixel_id: string | null;
  facebook_access_token: string | null;
  facebook_pixel_id_backup: string | null;
  facebook_access_token_backup: string | null;
  facebook_backup_enabled: boolean | null;
  tiktok_pixel_id: string | null;
  tiktok_access_token: string | null;
  tiktok_test_event_code: string | null;
  utmify_api_key: string | null;
  sigilopay_public_key: string | null;
  sigilopay_secret_key: string | null;
  payment_gateway: string | null;
  enabled_gateways: string[] | null;
  evpay_api_key: string | null;
  evpay_project_id: string | null;
  zuckpay_client_id: string | null;
  zuckpay_client_secret: string | null;
  nowpayments_api_key: string | null;
  nowpayments_ipn_secret_key: string | null;
  nowpayments_pay_currency: string | null;
  collect_email_after_payment: boolean;
  email_request_message: string | null;
  tracking_mode: TrackingMode;
  prelander_headline: string | null;
  prelander_description: string | null;
  prelander_image_url: string | null;
  prelander_cta_text: string | null;
  avatar_url: string | null;
  redirect_display_name: string | null;
  tracking_page_intro: string | null;
  black_enabled: boolean;
  protect_content: boolean;
  traffic_filter_enabled: boolean;
  tf_block_spies: boolean;
  tf_block_datacenter: boolean;
  tf_block_adlibrary: boolean;
  tf_block_fb_crawler: boolean;
  tf_block_tiktok_crawler: boolean;
  slug_gate_enabled: boolean;
  slug_hash: string | null;
  slug_plain: string | null;
  created_at: string;
}

export type TrafficFilterList = "allow" | "block";
export type TrafficFilterMatchType = "ip" | "user_agent" | "referer" | "asn";
/** Classe da regra. 'fb_crawler' = seed do crawler revisor do Facebook (vem na
 *  allowlist por padrão; pode ser movida pra blocklist, mas isso é cloaking). */
export type TrafficFilterRuleKind = "fb_crawler" | "custom";

export interface TrafficFilterRule {
  id: string;
  tenant_id: string;
  list: TrafficFilterList;
  match_type: TrafficFilterMatchType;
  value: string;
  note: string | null;
  rule_kind: TrafficFilterRuleKind;
  is_active: boolean;
  created_at: string;
}

export interface Product {
  id: string;
  tenant_id: string;
  bot_id: string;
  name: string;
  price: number;
  currency: string;
  description: string;
  ghost_name: string | null;
  ghost_description: string | null;
  button_style: "danger" | "success" | "primary" | null;
  is_active: boolean;
  created_at: string;
}

export interface ProductBundle {
  id: string;
  tenant_id: string;
  bot_id: string;
  name: string;
  description: string;
  message_text: string;
  is_active: boolean;
  created_at: string;
}

export interface ProductBundleItem {
  id: string;
  bundle_id: string;
  product_id: string;
  sort_order: number;
  created_at: string;
}

export interface Flow {
  id: string;
  tenant_id: string;
  bot_id: string;
  name: string;
  trigger_type: TriggerType;
  trigger_value: string;
  flow_data: FlowData;
  is_active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  tenant_id: string;
  bot_id: string;
  telegram_user_id: number;
  first_name: string;
  last_name: string | null;
  username: string | null;
  tid: string | null;
  fbclid: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  current_flow_id: string | null;
  current_node_id: string | null;
  active_flow_name: string | null;
  state: Record<string, unknown>;
  blocked: boolean;
  created_at: string;
  updated_at: string;
}

// === Chat / Clientes ===
export type LeadMessageDirection = "in" | "out" | "event";
export type LeadMessageEventType =
  | "button_click"
  | "pix_generated"
  | "payment_approved"
  | "blocked";

export interface LeadMessage {
  id: string;
  lead_id: string;
  bot_id: string;
  tenant_id: string;
  direction: LeadMessageDirection;
  text: string | null;
  event_type: LeadMessageEventType | null;
  event_data: Record<string, unknown>;
  sent_by: string | null;
  tg_message_id: number | null;
  created_at: string;
}

export interface Transaction {
  id: string;
  tenant_id: string;
  lead_id: string;
  bot_id: string;
  flow_id: string | null;
  product_id: string;
  gateway: string;
  external_id: string;
  amount: number;
  currency: string;
  status: TransactionStatus;
  paid_at: string | null;
  created_at: string;
  remarketing_flow_id: string | null;
  remarketing_send_id: string | null;
}

export interface MediaAsset {
  id: string;
  tenant_id: string;
  bot_id: string;
  url: string;
  kind: "image" | "video";
  label: string | null;
  is_active: boolean;
  created_at: string;
}

export type RemarketingAudience = "all" | "no_purchase" | "pending_payment";

export interface RemarketingConfig {
  id: string;
  tenant_id: string;
  bot_id: string;
  is_active: boolean;
  interval_minutes: number;
  created_at: string;
  updated_at: string;
}

export interface RemarketingFlow {
  id: string;
  tenant_id: string;
  config_id: string;
  bot_id: string;
  name: string;
  sort_order: number;
  audience: RemarketingAudience;
  flow_data: FlowData;
  is_active: boolean;
  delete_after_minutes: number | null;
  created_at: string;
  updated_at: string;
}

export interface BlacklistUser {
  id: string;
  bot_id: string;
  telegram_user_id: number;
  username: string | null;
  first_name: string | null;
  note: string | null;
  created_at: string;
}

export interface TrackingEvent {
  id: string;
  tenant_id: string;
  lead_id: string | null;
  bot_id: string;
  event_type: TrackingEventType;
  fbclid: string | null;
  tid: string | null;
  utm_params: Record<string, string>;
  event_data: Record<string, unknown>;
  sent_to_facebook: boolean;
  sent_to_tiktok: boolean;
  sent_to_utmify: boolean;
  created_at: string;
}

export interface SocialProofChannel {
  id: string;
  tenant_id: string;
  bot_id: string;
  title: string;
  avatar_url: string | null;
  subscribers_label: string;
  is_verified: boolean;
  is_active: boolean;
  owner_name: string;
  owner_avatar_url: string | null;
  owner_username: string;
  pinned_message_id: string | null;
  unread_badge: number;
  created_at: string;
}

export interface SocialProofMessage {
  id: string;
  tenant_id: string;
  bot_id: string;
  channel_id: string;
  sender_name: string;
  sender_avatar_url: string | null;
  content_text: string | null;
  media_url: string | null;
  media_type: "image" | "video" | null;
  offset_seconds: number;
  views_count: number;
  position: number;
  is_active: boolean;
  sender_kind: "owner" | "member";
  kind: "text" | "photo" | "video" | "audio" | "album";
  /** jsonb: lista de MediaItem. Ver lib/social-proof/media.ts. */
  media: MediaItem[];
  /** jsonb: lista de Reaction. */
  reactions: Reaction[];
  reply_to_id: string | null;
  display_time: string | null;
  created_at: string;
}

// ─── Campanhas de postagem agendada (074/075) ────────────────────────────

export type ScheduledCampaignStatus =
  | "draft"
  | "ai_processing"
  | "ready"
  | "running"
  | "paused"
  | "completed"
  | "failed";

export type ScheduledCampaignAiStatus =
  | "idle"
  | "queued"
  | "processing"
  | "done"
  | "partial"
  | "failed";

export interface ScheduledCampaign {
  id: string;
  tenant_id: string;
  name: string;
  dest_dialog_id: string | null;
  dest_channel_id: string | null;
  dest_access_hash: string | null;
  dest_title: string | null;
  source_clone_job_id: string | null;
  status: ScheduledCampaignStatus;
  start_at: string | null;
  default_delay_seconds: number;
  ai_clean: boolean;
  ai_rewrite: boolean;
  ai_smart_delay: boolean;
  ai_status: ScheduledCampaignAiStatus;
  ai_processed_count: number;
  ai_error: string | null;
  ai_started_at: string | null;
  total_messages: number;
  sent_count: number;
  failed_count: number;
  last_error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

/**
 * `document` e `poll` existem aqui e não em social_proof_messages porque o
 * clone os produz e o bot sabe publicá-los. O MessageEditor continua
 * oferecendo só os cinco tipos editáveis — ver Plano 2.
 */
export type ScheduledMessageKind =
  | "text"
  | "photo"
  | "video"
  | "audio"
  | "album"
  | "document"
  | "poll";

export type ScheduledMessageStatus = "pending" | "sending" | "sent" | "failed" | "skipped";

export type ScheduledMessageAiAction = "none" | "cleaned" | "rewritten" | "discarded";

export interface ScheduledMessage {
  id: string;
  tenant_id: string;
  campaign_id: string;
  kind: ScheduledMessageKind;
  content_text: string | null;
  /** jsonb: lista de MediaItem. Mesmo shape de social_proof_messages.media. */
  media: MediaItem[];
  reply_to_id: string | null;
  position: number;
  delay_seconds: number;
  scheduled_at: string | null;
  silent: boolean;
  status: ScheduledMessageStatus;
  dest_msg_id: number | null;
  sent_at: string | null;
  error_message: string | null;
  attempts: number;
  claimed_at: string | null;
  source_msg_id: number | null;
  /** jsonb: Api.MessageEntity[] cruas do gramjs. Opaco fora do worker. */
  entities: unknown[] | null;
  inline_links: Array<{ label: string; url: string }> | null;
  poll: {
    question: string;
    options: string[];
    isAnonymous: boolean;
    allowsMultipleAnswers: boolean;
  } | null;
  file_name: string | null;
  is_pinned: boolean;
  content_text_original: string | null;
  ai_action: ScheduledMessageAiAction | null;
  ai_reason: string | null;
  ai_discarded: boolean;
  created_at: string;
}
