export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      allowed_emails: {
        Row: {
          created_at: string;
          email: string;
        };
        Insert: {
          created_at?: string;
          email: string;
        };
        Update: {
          created_at?: string;
          email?: string;
        };
        Relationships: [];
      };
      families: {
        Row: {
          created_by: string | null;
          id: string;
          lock_token: string | null;
          lock_until: string | null;
          lock_user_id: string | null;
          name: string;
          payload: Json;
          updated_at: string;
        };
        Insert: {
          created_by?: string | null;
          id?: string;
          lock_token?: string | null;
          lock_until?: string | null;
          lock_user_id?: string | null;
          name: string;
          payload?: Json;
          updated_at?: string;
        };
        Update: {
          created_by?: string | null;
          id?: string;
          lock_token?: string | null;
          lock_until?: string | null;
          lock_user_id?: string | null;
          name?: string;
          payload?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      family_members: {
        Row: {
          can_edit_card_size: boolean;
          can_edit_colors: boolean;
          can_edit_gap: boolean;
          created_at: string;
          family_id: string;
          role: string;
          tree_ids: string[];
          user_id: string;
        };
        Insert: {
          can_edit_card_size?: boolean;
          can_edit_colors?: boolean;
          can_edit_gap?: boolean;
          created_at?: string;
          family_id: string;
          role: string;
          tree_ids?: string[];
          user_id: string;
        };
        Update: {
          can_edit_card_size?: boolean;
          can_edit_colors?: boolean;
          can_edit_gap?: boolean;
          created_at?: string;
          family_id?: string;
          role?: string;
          tree_ids?: string[];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "family_members_family_id_fkey";
            columns: ["family_id"];
            isOneToOne: false;
            referencedRelation: "families";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      acquire_family_lock: { Args: { p_id: string }; Returns: Json };
      heartbeat_family_lock: {
        Args: { p_id: string; p_token: string };
        Returns: Json;
      };
      hook_restrict_signup: { Args: { event: Json }; Returns: Json };
      invite_to_family: {
        Args: {
          p_family_id: string;
          p_tree_ids?: string[];
          p_username: string;
          p_can_edit_display?: boolean;
          p_can_edit_colors?: boolean;
        };
        Returns: Json;
      };
      list_family_shares: { Args: { p_family_id: string }; Returns: Json };
      list_my_families: {
        Args: Record<PropertyKey, never>;
        Returns: {
          created_by: string;
          id: string;
          name: string;
          owner_plan: string;
          payload: Json;
          updated_at: string;
        }[];
      };
      patch_family: {
        Args: {
          p_delta: Json;
          p_expected_updated_at?: string;
          p_id: string;
          p_lock_token?: string;
          p_name: string;
        };
        Returns: Json;
      };
      publish_family: {
        Args: { p_name: string; p_payload: Json };
        Returns: string;
      };
      release_family_lock: {
        Args: { p_id: string; p_token: string };
        Returns: Json;
      };
      revoke_family_share: {
        Args: { p_family_id: string; p_username: string };
        Returns: Json;
      };
      save_family: {
        Args: {
          p_expected_updated_at?: string;
          p_id: string;
          p_lock_token?: string;
          p_name: string;
          p_payload: Json;
        };
        Returns: Json;
      };
      set_member_trees: {
        Args: {
          p_can_edit_card_size: boolean;
          p_can_edit_colors: boolean;
          p_can_edit_gap: boolean;
          p_family_id: string;
          p_tree_ids: string[];
          p_username: string;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
