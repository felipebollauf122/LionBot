// === Enums ===
export type TransactionStatus = "pending" | "approved" | "refused" | "refunded";
export type TriggerType = "command" | "first_contact" | "callback" | "payment_event";
export type TrackingEventType = "page_view" | "bot_start" | "view_offer" | "checkout" | "purchase";
export type TrackingMode = "redirect" | "prelander";
export type NodeType = "trigger" | "text" | "image" | "video" | "button" | "payment_button" | "delay" | "condition" | "input" | "action";

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
  utmify_api_key: string | null;
  sigilopay_public_key: string | null;
  sigilopay_secret_key: string | null;
  payment_gateway: string | null;
  evpay_api_key: string | null;
  evpay_project_id: string | null;
  collect_email_after_payment: boolean;
  email_request_message: string | null;
  tracking_mode: TrackingMode;
  prelander_headline: string | null;
  prelander_description: string | null;
  prelander_image_url: string | null;
  prelander_cta_text: string | null;
  avatar_url: string | null;
  redirect_display_name: string | null;
  black_enabled: boolean;
  protect_content: boolean;
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
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  tenant_id: string;
  lead_id: string;
  bot_id: string;
  flow_id: string;
  product_id: string;
  gateway: string;
  external_id: string;
  amount: number;
  currency: string;
  status: TransactionStatus;
  paid_at: string | null;
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
  sent_to_utmify: boolean;
  created_at: string;
}
