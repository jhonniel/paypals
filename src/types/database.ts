export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type GroupRole = "owner" | "admin" | "member";
export type FriendshipStatus = "pending" | "accepted" | "blocked";
export type ReceiptStatus =
  | "draft"
  | "uploaded"
  | "ocr_complete"
  | "edited"
  | "members_assigned"
  | "finalized"
  | "archived";
export type SplitMethod =
  | "equal"
  | "percentage"
  | "quantity"
  | "custom"
  | "weighted";
export type ThemePreference = "light" | "dark" | "system";
export type NotificationType =
  | "invitation"
  | "reminder"
  | "receipt_updated"
  | "member_joined"
  | "split_completed"
  | "payment_reminder";

export type PaymentMethodType = "gcash" | "maya" | "bank" | "other";

export interface PaymentMethod {
  id: string;
  type: PaymentMethodType;
  bank_name: string;
  account_name: string;
  account_number: string;
  qr_code_url: string | null;
  show_account?: boolean;
  show_account_name?: boolean;
  show_account_number?: boolean;
  show_qr?: boolean;
}

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  is_admin: boolean;
  invite_verified?: boolean;
  payment_methods?: PaymentMethod[];
  created_at: string;
  updated_at: string;
}

export interface UserSettings {
  user_id: string;
  theme: ThemePreference;
  currency: string;
  timezone: string;
  language: string;
  ocr_provider: string | null;
  notification_email: boolean;
  notification_push: boolean;
  created_at: string;
  updated_at: string;
}

export interface Group {
  id: string;
  name: string;
  description: string | null;
  photo_url: string | null;
  invite_code: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface GroupMember {
  id: string;
  group_id: string;
  user_id: string | null;
  role: GroupRole;
  guest_email: string | null;
  guest_name: string | null;
  invite_token: string | null;
  invited_by: string | null;
  claimed_at: string | null;
  joined_at: string;
}

export interface Receipt {
  id: string;
  group_id: string | null;
  created_by: string;
  merchant: string | null;
  receipt_date: string | null;
  receipt_time: string | null;
  currency: string;
  subtotal: number;
  tax: number;
  discount: number;
  service_charge: number;
  tip: number;
  total: number;
  status: ReceiptStatus;
  notes: string | null;
  settlement_note?: string | null;
  paid_by_member_id?: string | null;
  ocr_confidence: number | null;
  created_at: string;
  updated_at: string;
  finalized_at: string | null;
}

export interface ReceiptDiscount {
  id: string;
  receipt_id: string;
  label: string;
  amount: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ReceiptItem {
  id: string;
  receipt_id: string;
  name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ReceiptItemAssignment {
  id: string;
  receipt_item_id: string;
  member_id: string;
  split_method: SplitMethod;
  share_percentage: number | null;
  share_quantity: number | null;
  share_amount: number | null;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface Activity {
  id: string;
  user_id: string | null;
  group_id: string | null;
  receipt_id: string | null;
  action: string;
  metadata: Json;
  created_at: string;
}

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  description: string | null;
  metadata: Json;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Loosely typed for Phase 1 — regenerate with supabase gen types after schema apply. */
export type Database = {
  public: {
    Tables: Record<string, {
      Row: Record<string, unknown>;
      Insert: Record<string, unknown>;
      Update: Record<string, unknown>;
      Relationships: [];
    }>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      group_role: GroupRole;
      friendship_status: FriendshipStatus;
      receipt_status: ReceiptStatus;
      split_method: SplitMethod;
      theme_preference: ThemePreference;
      notification_type: NotificationType;
    };
    CompositeTypes: Record<string, never>;
  };
};
