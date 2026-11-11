// Mirrors the database schema (supabase/migrations). The Supabase connector's
// generate_typescript_types output is the reference; the aliases at the bottom are hand-written.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      alerts: {
        Row: {
          assignment_id: string | null
          channel: string
          error: string | null
          id: number
          is_test: boolean
          payload: Json | null
          recipient: string
          recipient_employee_id: string | null
          rule_id: string | null
          rule_name: string
          sent_at: string
          shift_id: string | null
          status: string
          success: boolean
        }
        Insert: {
          assignment_id?: string | null
          channel: string
          error?: string | null
          id?: number
          is_test?: boolean
          payload?: Json | null
          recipient: string
          recipient_employee_id?: string | null
          rule_id?: string | null
          rule_name: string
          sent_at?: string
          shift_id?: string | null
          status: string
          success: boolean
        }
        Update: {
          assignment_id?: string | null
          channel?: string
          error?: string | null
          id?: number
          is_test?: boolean
          payload?: Json | null
          recipient?: string
          recipient_employee_id?: string | null
          rule_id?: string | null
          rule_name?: string
          sent_at?: string
          shift_id?: string | null
          status?: string
          success?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "alerts_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_recipient_employee_id_fkey"
            columns: ["recipient_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "notification_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      assignments: {
        Row: {
          calendar_attempts: number
          calendar_error: string | null
          calendar_event_id: string | null
          calendar_status: string
          checked_in_at: string | null
          checkin_token: string
          created_at: string
          created_by: string | null
          employee_id: string
          id: string
          role: Database["public"]["Enums"]["assignment_role"]
          shift_id: string
        }
        Insert: {
          calendar_attempts?: number
          calendar_error?: string | null
          calendar_event_id?: string | null
          calendar_status?: string
          checked_in_at?: string | null
          checkin_token?: string
          created_at?: string
          created_by?: string | null
          employee_id: string
          id?: string
          role?: Database["public"]["Enums"]["assignment_role"]
          shift_id: string
        }
        Update: {
          calendar_attempts?: number
          calendar_error?: string | null
          calendar_event_id?: string | null
          calendar_status?: string
          checked_in_at?: string | null
          checkin_token?: string
          created_at?: string
          created_by?: string | null
          employee_id?: string
          id?: string
          role?: Database["public"]["Enums"]["assignment_role"]
          shift_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          entity: string
          entity_id: string | null
          id: number
        }
        Insert: {
          action: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: never
        }
        Update: {
          action?: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: never
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_cancellations: {
        Row: {
          attempts: number
          created_at: string
          event_id: string
          last_error: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          event_id: string
          last_error?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          event_id?: string
          last_error?: string | null
        }
        Relationships: []
      }
      employee_notification_prefs: {
        Row: {
          channels: string[]
          display_tz: string | null
          employee_id: string
          quiet_hours_end: string | null
          quiet_hours_start: string | null
        }
        Insert: {
          channels?: string[]
          display_tz?: string | null
          employee_id: string
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
        }
        Update: {
          channels?: string[]
          display_tz?: string | null
          employee_id?: string
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_notification_prefs_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: true
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          active: boolean
          auth_user_id: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          role: Database["public"]["Enums"]["employee_role"]
          telegram_chat_id: number | null
        }
        Insert: {
          active?: boolean
          auth_user_id?: string | null
          created_at?: string
          email: string
          full_name: string
          id?: string
          role?: Database["public"]["Enums"]["employee_role"]
          telegram_chat_id?: number | null
        }
        Update: {
          active?: boolean
          auth_user_id?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          role?: Database["public"]["Enums"]["employee_role"]
          telegram_chat_id?: number | null
        }
        Relationships: []
      }
      notification_group_members: {
        Row: {
          employee_id: string
          group_id: string
        }
        Insert: {
          employee_id: string
          group_id: string
        }
        Update: {
          employee_id?: string
          group_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_group_members_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "notification_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_groups: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      notification_rules: {
        Row: {
          channels: string[]
          condition: string
          condition_n: number | null
          created_at: string
          critical: boolean
          enabled: boolean
          id: string
          message_tpl: string
          name: string
          position: number
          recipient_ids: string[]
          recipient_role: Database["public"]["Enums"]["employee_role"] | null
          recipient_type: string
          template_scope: string[] | null
          trigger_minutes: number
          updated_at: string
        }
        Insert: {
          channels?: string[]
          condition: string
          condition_n?: number | null
          created_at?: string
          critical?: boolean
          enabled?: boolean
          id?: string
          message_tpl: string
          name: string
          position: number
          recipient_ids?: string[]
          recipient_role?: Database["public"]["Enums"]["employee_role"] | null
          recipient_type: string
          template_scope?: string[] | null
          trigger_minutes: number
          updated_at?: string
        }
        Update: {
          channels?: string[]
          condition?: string
          condition_n?: number | null
          created_at?: string
          critical?: boolean
          enabled?: boolean
          id?: string
          message_tpl?: string
          name?: string
          position?: number
          recipient_ids?: string[]
          recipient_role?: Database["public"]["Enums"]["employee_role"] | null
          recipient_type?: string
          template_scope?: string[] | null
          trigger_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      org_settings: {
        Row: {
          allowed_domains: string[]
          calendar_desc_tpl: string
          calendar_enabled: boolean
          calendar_id: string | null
          calendar_reminders_min: number[]
          calendar_title_tpl: string
          checkin_close_after_min: number
          checkin_close_rule: string
          checkin_open_before_min: number
          covered_min: number
          covered_rule: string
          late_after_min: number
          client_tz: string
          default_display_tz: string
          id: number
          org_name: string
          updated_at: string
          week_start: number
        }
        Insert: {
          allowed_domains?: string[]
          calendar_desc_tpl?: string
          calendar_enabled?: boolean
          calendar_id?: string | null
          calendar_reminders_min?: number[]
          calendar_title_tpl?: string
          checkin_close_after_min?: number
          checkin_close_rule?: string
          checkin_open_before_min?: number
          covered_min?: number
          covered_rule?: string
          late_after_min?: number
          client_tz?: string
          default_display_tz?: string
          id?: number
          org_name?: string
          updated_at?: string
          week_start?: number
        }
        Update: {
          allowed_domains?: string[]
          calendar_desc_tpl?: string
          calendar_enabled?: boolean
          calendar_id?: string | null
          calendar_reminders_min?: number[]
          calendar_title_tpl?: string
          checkin_close_after_min?: number
          checkin_close_rule?: string
          checkin_open_before_min?: number
          covered_min?: number
          covered_rule?: string
          late_after_min?: number
          client_tz?: string
          default_display_tz?: string
          id?: number
          org_name?: string
          updated_at?: string
          week_start?: number
        }
        Relationships: []
      }
      rule_firings: {
        Row: {
          assignment_id: string | null
          fired_at: string
          id: number
          rule_id: string
          shift_id: string
        }
        Insert: {
          assignment_id?: string | null
          fired_at?: string
          id?: number
          rule_id: string
          shift_id: string
        }
        Update: {
          assignment_id?: string | null
          fired_at?: string
          id?: number
          rule_id?: string
          shift_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rule_firings_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rule_firings_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "notification_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rule_firings_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_templates: {
        Row: {
          active: boolean
          code: string
          colour: string
          created_at: string
          end_local_time: string
          end_weekday: number
          id: string
          name: string
          required_headcount: number
          start_local_time: string
          start_weekday: number
          timezone: string | null
        }
        Insert: {
          active?: boolean
          code: string
          colour?: string
          created_at?: string
          end_local_time: string
          end_weekday: number
          id?: string
          name: string
          required_headcount?: number
          start_local_time: string
          start_weekday: number
          timezone?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          colour?: string
          created_at?: string
          end_local_time?: string
          end_weekday?: number
          id?: string
          name?: string
          required_headcount?: number
          start_local_time?: string
          start_weekday?: number
          timezone?: string | null
        }
        Relationships: []
      }
      shifts: {
        Row: {
          created_at: string
          ends_at: string
          id: string
          is_test: boolean
          notes: string | null
          occurrence_date: string | null
          starts_at: string
          status_override: string | null
          template_id: string | null
        }
        Insert: {
          created_at?: string
          ends_at: string
          id?: string
          is_test?: boolean
          notes?: string | null
          occurrence_date?: string | null
          starts_at: string
          status_override?: string | null
          template_id?: string | null
        }
        Update: {
          created_at?: string
          ends_at?: string
          id?: string
          is_test?: boolean
          notes?: string | null
          occurrence_date?: string | null
          starts_at?: string
          status_override?: string | null
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shifts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "shift_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_link_tokens: {
        Row: {
          created_at: string
          employee_id: string
          expires_at: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          employee_id: string
          expires_at: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          employee_id?: string
          expires_at?: string
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "telegram_link_tokens_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      template_overrides: {
        Row: {
          checkin_close_after_min: number | null
          checkin_close_rule: string | null
          checkin_open_before_min: number | null
          covered_min: number | null
          covered_rule: string | null
          late_after_min: number | null
          template_id: string
          updated_at: string
        }
        Insert: {
          checkin_close_after_min?: number | null
          checkin_close_rule?: string | null
          checkin_open_before_min?: number | null
          covered_min?: number | null
          covered_rule?: string | null
          late_after_min?: number | null
          template_id: string
          updated_at?: string
        }
        Update: {
          checkin_close_after_min?: number | null
          checkin_close_rule?: string | null
          checkin_open_before_min?: number | null
          covered_min?: number | null
          covered_rule?: string | null
          late_after_min?: number | null
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_overrides_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: true
            referencedRelation: "shift_templates"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      assert_valid_prefs: {
        Args: { p_channels: string[]; p_quiet_end: string | null; p_quiet_start: string | null }
        Returns: undefined
      }
      check_in: { Args: { p_token: string }; Returns: Json }
      claim_rule_firings: {
        Args: { p_rows: Json }
        Returns: Database["public"]["Tables"]["rule_firings"]["Row"][]
      }
      create_telegram_link_token: { Args: never; Returns: string }
      create_test_shift: {
        Args: { p_assignees: Json; p_duration_min: number; p_notes?: string; p_starts_in_min: number }
        Returns: Json
      }
      delete_notification_group: { Args: { p_id: string }; Returns: Json }
      delete_notification_rule: { Args: { p_id: string }; Returns: Json }
      delete_test_shift: { Args: { p_shift_id: string }; Returns: Json }
      disconnect_my_telegram: { Args: never; Returns: Json }
      invoke_check_shifts: { Args: never; Returns: undefined }
      link_telegram: { Args: { p_chat_id: number; p_token: string }; Returns: string | null }
      reorder_notification_rules: { Args: { p_ids: string[] }; Returns: Json }
      retry_calendar_invite: { Args: { p_assignment_id: string }; Returns: Json }
      save_notification_group: {
        Args: { p_id: string | null; p_member_ids: string[]; p_name: string }
        Returns: Json
      }
      save_notification_rule: { Args: { p_id: string | null; p_rule: Json }; Returns: Json }
      set_my_group_subscription: { Args: { p_group_id: string; p_subscribed: boolean }; Returns: Json }
      set_template_override: {
        Args: {
          p_close_after_min?: number | null
          p_close_rule?: string | null
          p_covered_min?: number | null
          p_covered_rule?: string | null
          p_late_after_min?: number | null
          p_open_before_min?: number | null
          p_template_id: string
        }
        Returns: Json
      }
      update_calendar_settings: {
        Args: {
          p_calendar_id: string | null
          p_desc_tpl: string
          p_enabled: boolean
          p_reminders_min: number[]
          p_title_tpl: string
        }
        Returns: Json
      }
      update_checkin_rules: {
        Args: {
          p_close_after_min: number
          p_close_rule: string
          p_covered_min: number
          p_covered_rule: string
          p_late_after_min: number
          p_open_before_min: number
        }
        Returns: Json
      }
      update_employee_prefs: {
        Args: {
          p_channels: string[]
          p_employee_id: string
          p_quiet_end: string | null
          p_quiet_start: string | null
        }
        Returns: Json
      }
      update_my_prefs: {
        Args: {
          p_channels: string[]
          p_display_tz: string | null
          p_quiet_end: string | null
          p_quiet_start: string | null
        }
        Returns: Json
      }
      apply_shift_regeneration: { Args: { p_changes: Json }; Returns: Json }
      assert_allowed_email: { Args: { p_email: string }; Returns: undefined }
      assert_valid_timezone: { Args: { p_tz: string }; Returns: undefined }
      create_employee: {
        Args: {
          p_active: boolean
          p_display_tz?: string
          p_email: string
          p_full_name: string
          p_role: Database["public"]["Enums"]["employee_role"]
        }
        Returns: Json
      }
      create_shift_template: {
        Args: {
          p_active?: boolean
          p_code: string
          p_colour?: string
          p_end_time: string
          p_end_weekday: number
          p_name: string
          p_required_headcount?: number
          p_start_time: string
          p_start_weekday: number
          p_timezone?: string
        }
        Returns: Json
      }
      copy_week_assignments: { Args: { p_pairs: Json }; Returns: Json }
      current_employee_id: { Args: never; Returns: string }
      generate_shifts: { Args: { p_rows: Json }; Returns: Json }
      hook_before_user_created: { Args: { event: Json }; Returns: Json }
      is_supervisor: { Args: never; Returns: boolean }
      new_checkin_token: { Args: never; Returns: string }
      set_shift_assignments: {
        Args: { p_assignees: Json; p_shift_id: string }
        Returns: Json
      }
      update_employee: {
        Args: {
          p_active: boolean
          p_display_tz?: string
          p_email: string
          p_full_name: string
          p_id: string
          p_role: Database["public"]["Enums"]["employee_role"]
        }
        Returns: Json
      }
      update_org_settings: {
        Args: {
          p_allowed_domains: string[]
          p_client_tz: string
          p_default_display_tz: string
          p_org_name: string
          p_week_start: number
        }
        Returns: Json
      }
      update_shift_template: {
        Args: {
          p_active?: boolean
          p_code: string
          p_colour?: string
          p_end_time: string
          p_end_weekday: number
          p_id: string
          p_name: string
          p_required_headcount?: number
          p_start_time: string
          p_start_weekday: number
          p_timezone?: string
        }
        Returns: Json
      }
      validate_shift_template_input: {
        Args: {
          p_code: string
          p_colour: string
          p_end_time: string
          p_end_weekday: number
          p_headcount: number
          p_name: string
          p_start_time: string
          p_start_weekday: number
          p_timezone: string
        }
        Returns: undefined
      }
      write_audit: {
        Args: {
          p_action: string
          p_after: Json
          p_before: Json
          p_entity: string
          p_entity_id: string
        }
        Returns: number
      }
    }
    Enums: {
      assignment_role: "primary" | "backup"
      employee_role: "supervisor" | "agent"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// ---------------------------------------------------------------------------
// Hand-written aliases (keep when regenerating)
// ---------------------------------------------------------------------------
export type Employee = Database["public"]["Tables"]["employees"]["Row"]
export type OrgSettings = Database["public"]["Tables"]["org_settings"]["Row"]
export type EmployeeRole = Database["public"]["Enums"]["employee_role"]
export type ShiftTemplate = Database["public"]["Tables"]["shift_templates"]["Row"]
export type Shift = Database["public"]["Tables"]["shifts"]["Row"]
export type Assignment = Database["public"]["Tables"]["assignments"]["Row"]
export type NotificationRule = Database["public"]["Tables"]["notification_rules"]["Row"]
export type NotificationGroup = Database["public"]["Tables"]["notification_groups"]["Row"]
export type TemplateOverrideRow = Database["public"]["Tables"]["template_overrides"]["Row"]
export type AlertLog = Database["public"]["Tables"]["alerts"]["Row"]
export type AuditEntry = Database["public"]["Tables"]["audit_log"]["Row"]
