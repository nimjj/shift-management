// HAND-WRITTEN for M1 in the shape `supabase gen types typescript` produces.
// Replace with generated output once the project is linked:
//   npx supabase gen types typescript --linked > lib/database.types.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      org_settings: {
        Row: {
          id: number;
          org_name: string;
          client_tz: string;
          default_display_tz: string;
          week_start: number;
          allowed_domains: string[];
          updated_at: string;
        };
        Insert: {
          id?: number;
          org_name?: string;
          client_tz?: string;
          default_display_tz?: string;
          week_start?: number;
          allowed_domains?: string[];
          updated_at?: string;
        };
        Update: {
          id?: number;
          org_name?: string;
          client_tz?: string;
          default_display_tz?: string;
          week_start?: number;
          allowed_domains?: string[];
          updated_at?: string;
        };
        Relationships: [];
      };
      employees: {
        Row: {
          id: string;
          auth_user_id: string | null;
          full_name: string;
          email: string;
          role: Database["public"]["Enums"]["employee_role"];
          telegram_chat_id: number | null;
          active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          auth_user_id?: string | null;
          full_name: string;
          email: string;
          role?: Database["public"]["Enums"]["employee_role"];
          telegram_chat_id?: number | null;
          active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          auth_user_id?: string | null;
          full_name?: string;
          email?: string;
          role?: Database["public"]["Enums"]["employee_role"];
          telegram_chat_id?: number | null;
          active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      employee_notification_prefs: {
        Row: {
          employee_id: string;
          channels: string[];
          quiet_hours_start: string | null;
          quiet_hours_end: string | null;
          display_tz: string | null;
        };
        Insert: {
          employee_id: string;
          channels?: string[];
          quiet_hours_start?: string | null;
          quiet_hours_end?: string | null;
          display_tz?: string | null;
        };
        Update: {
          employee_id?: string;
          channels?: string[];
          quiet_hours_start?: string | null;
          quiet_hours_end?: string | null;
          display_tz?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "employee_notification_prefs_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: true;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_log: {
        Row: {
          id: number;
          actor_id: string | null;
          action: string;
          entity: string;
          entity_id: string | null;
          before: Json | null;
          after: Json | null;
          created_at: string;
        };
        Insert: {
          id?: never;
          actor_id?: string | null;
          action: string;
          entity: string;
          entity_id?: string | null;
          before?: Json | null;
          after?: Json | null;
          created_at?: string;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      current_employee_id: { Args: Record<PropertyKey, never>; Returns: string };
      is_supervisor: { Args: Record<PropertyKey, never>; Returns: boolean };
      assert_allowed_email: { Args: { p_email: string }; Returns: undefined };
      write_audit: {
        Args: { p_action: string; p_entity: string; p_entity_id: string; p_before: Json; p_after: Json };
        Returns: number;
      };
      create_employee: {
        Args: {
          p_full_name: string;
          p_email: string;
          p_role: Database["public"]["Enums"]["employee_role"];
          p_active: boolean;
          p_display_tz?: string;
        };
        Returns: Json;
      };
      update_employee: {
        Args: {
          p_id: string;
          p_full_name: string;
          p_email: string;
          p_role: Database["public"]["Enums"]["employee_role"];
          p_active: boolean;
          p_display_tz?: string;
        };
        Returns: Json;
      };
    };
    Enums: {
      employee_role: "supervisor" | "agent";
    };
    CompositeTypes: { [_ in never]: never };
  };
};

export type Employee = Database["public"]["Tables"]["employees"]["Row"];
export type OrgSettings = Database["public"]["Tables"]["org_settings"]["Row"];
export type EmployeeRole = Database["public"]["Enums"]["employee_role"];
