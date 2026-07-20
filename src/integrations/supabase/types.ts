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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      aade_delivery_reports: {
        Row: {
          created_at: string
          delivery_at: string | null
          driver_afm: string | null
          driver_payout: number | null
          dropoff_address: string | null
          error_message: string | null
          gross_amount: number | null
          id: string
          mydata_mark: string | null
          mydata_uid: string | null
          net_amount: number | null
          order_id: string | null
          order_number: string | null
          payload: Json | null
          payment_method: string | null
          pickup_address: string | null
          platform_commission: number | null
          sent_at: string | null
          status: string
          store_afm: string | null
          updated_at: string
          vat_amount: number | null
        }
        Insert: {
          created_at?: string
          delivery_at?: string | null
          driver_afm?: string | null
          driver_payout?: number | null
          dropoff_address?: string | null
          error_message?: string | null
          gross_amount?: number | null
          id?: string
          mydata_mark?: string | null
          mydata_uid?: string | null
          net_amount?: number | null
          order_id?: string | null
          order_number?: string | null
          payload?: Json | null
          payment_method?: string | null
          pickup_address?: string | null
          platform_commission?: number | null
          sent_at?: string | null
          status?: string
          store_afm?: string | null
          updated_at?: string
          vat_amount?: number | null
        }
        Update: {
          created_at?: string
          delivery_at?: string | null
          driver_afm?: string | null
          driver_payout?: number | null
          dropoff_address?: string | null
          error_message?: string | null
          gross_amount?: number | null
          id?: string
          mydata_mark?: string | null
          mydata_uid?: string | null
          net_amount?: number | null
          order_id?: string | null
          order_number?: string | null
          payload?: Json | null
          payment_method?: string | null
          pickup_address?: string | null
          platform_commission?: number | null
          sent_at?: string | null
          status?: string
          store_afm?: string | null
          updated_at?: string
          vat_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "aade_delivery_reports_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      aade_platform_config: {
        Row: {
          afm: string | null
          created_at: string
          doy: string | null
          iban: string | null
          id: string
          kad: string | null
          legal_address: string | null
          legal_city: string | null
          legal_name: string | null
          legal_postal_code: string | null
          mydata_base_url: string | null
          mydata_environment: string
          mydata_subscription_key: string | null
          mydata_user_id: string | null
          platform_registration_number: string | null
          platform_reporting_enabled: boolean
          representative_afm: string | null
          representative_name: string | null
          trade_name: string | null
          updated_at: string
        }
        Insert: {
          afm?: string | null
          created_at?: string
          doy?: string | null
          iban?: string | null
          id?: string
          kad?: string | null
          legal_address?: string | null
          legal_city?: string | null
          legal_name?: string | null
          legal_postal_code?: string | null
          mydata_base_url?: string | null
          mydata_environment?: string
          mydata_subscription_key?: string | null
          mydata_user_id?: string | null
          platform_registration_number?: string | null
          platform_reporting_enabled?: boolean
          representative_afm?: string | null
          representative_name?: string | null
          trade_name?: string | null
          updated_at?: string
        }
        Update: {
          afm?: string | null
          created_at?: string
          doy?: string | null
          iban?: string | null
          id?: string
          kad?: string | null
          legal_address?: string | null
          legal_city?: string | null
          legal_name?: string | null
          legal_postal_code?: string | null
          mydata_base_url?: string | null
          mydata_environment?: string
          mydata_subscription_key?: string | null
          mydata_user_id?: string | null
          platform_registration_number?: string | null
          platform_reporting_enabled?: boolean
          representative_afm?: string | null
          representative_name?: string | null
          trade_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      admin_audit_log: {
        Row: {
          action: string
          actor_id: string
          actor_name: string | null
          created_at: string
          description: string | null
          id: string
          metadata: Json | null
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_id: string
          actor_name?: string | null
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json | null
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_id?: string
          actor_name?: string | null
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json | null
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: []
      }
      admin_permissions: {
        Row: {
          can_manage_finances: boolean
          can_manage_orders: boolean
          can_manage_settings: boolean
          can_manage_users: boolean
          can_view_audit: boolean
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          scope: string
          updated_at: string
          user_id: string
        }
        Insert: {
          can_manage_finances?: boolean
          can_manage_orders?: boolean
          can_manage_settings?: boolean
          can_manage_users?: boolean
          can_view_audit?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          scope?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          can_manage_finances?: boolean
          can_manage_orders?: boolean
          can_manage_settings?: boolean
          can_manage_users?: boolean
          can_view_audit?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          scope?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      admin_treasury: {
        Row: {
          admin_balance: number
          id: number
          lifetime_admin_earned: number
          lifetime_driver_topup: number
          lifetime_platform_earned: number
          platform_pool: number
          updated_at: string
        }
        Insert: {
          admin_balance?: number
          id?: number
          lifetime_admin_earned?: number
          lifetime_driver_topup?: number
          lifetime_platform_earned?: number
          platform_pool?: number
          updated_at?: string
        }
        Update: {
          admin_balance?: number
          id?: number
          lifetime_admin_earned?: number
          lifetime_driver_topup?: number
          lifetime_platform_earned?: number
          platform_pool?: number
          updated_at?: string
        }
        Relationships: []
      }
      admin_treasury_ledger: {
        Row: {
          amount: number
          bag: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          order_id: string | null
          type: string
        }
        Insert: {
          amount: number
          bag: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          order_id?: string | null
          type: string
        }
        Update: {
          amount?: number
          bag?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          order_id?: string | null
          type?: string
        }
        Relationships: []
      }
      announcements: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          message: string
          target_audience: string
          title: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          message: string
          target_audience?: string
          title: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          message?: string
          target_audience?: string
          title?: string
        }
        Relationships: []
      }
      banned_devices: {
        Row: {
          banned_by: string | null
          created_at: string
          device_fingerprint: string
          id: string
          reason: string | null
          user_id: string | null
        }
        Insert: {
          banned_by?: string | null
          created_at?: string
          device_fingerprint: string
          id?: string
          reason?: string | null
          user_id?: string | null
        }
        Update: {
          banned_by?: string | null
          created_at?: string
          device_fingerprint?: string
          id?: string
          reason?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      basket_distribution_payouts: {
        Row: {
          amount: number
          created_at: string
          distribution_id: string
          driver_id: string
          id: string
          metadata: Json
          reason: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          distribution_id: string
          driver_id: string
          id?: string
          metadata?: Json
          reason?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          distribution_id?: string
          driver_id?: string
          id?: string
          metadata?: Json
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "basket_distribution_payouts_distribution_id_fkey"
            columns: ["distribution_id"]
            isOneToOne: false
            referencedRelation: "basket_distributions"
            referencedColumns: ["id"]
          },
        ]
      }
      basket_distribution_rules: {
        Row: {
          amount_mode: string
          amount_value: number
          config: Json
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          kind: string
          last_run_at: string | null
          name: string
          next_run_at: string | null
          schedule: string
          updated_at: string
        }
        Insert: {
          amount_mode?: string
          amount_value?: number
          config?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          kind: string
          last_run_at?: string | null
          name: string
          next_run_at?: string | null
          schedule?: string
          updated_at?: string
        }
        Update: {
          amount_mode?: string
          amount_value?: number
          config?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          last_run_at?: string | null
          name?: string
          next_run_at?: string | null
          schedule?: string
          updated_at?: string
        }
        Relationships: []
      }
      basket_distributions: {
        Row: {
          basket_balance_after: number | null
          basket_balance_before: number | null
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          recipient_count: number
          rule_id: string | null
          rule_name: string | null
          snapshot: Json
          total_amount: number
          triggered_by: string
        }
        Insert: {
          basket_balance_after?: number | null
          basket_balance_before?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          recipient_count?: number
          rule_id?: string | null
          rule_name?: string | null
          snapshot?: Json
          total_amount?: number
          triggered_by?: string
        }
        Update: {
          basket_balance_after?: number | null
          basket_balance_before?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          recipient_count?: number
          rule_id?: string | null
          rule_name?: string | null
          snapshot?: Json
          total_amount?: number
          triggered_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "basket_distributions_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "basket_distribution_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      canned_replies: {
        Row: {
          body: string
          category: string | null
          created_at: string
          created_by: string | null
          id: string
          label: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          body: string
          category?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          label: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          body?: string
          category?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      commission_tiers: {
        Row: {
          commission_pct: number
          created_at: string
          id: string
          is_active: boolean
          label: string | null
          max_amount: number | null
          min_amount: number
          updated_at: string
        }
        Insert: {
          commission_pct: number
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string | null
          max_amount?: number | null
          min_amount?: number
          updated_at?: string
        }
        Update: {
          commission_pct?: number
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string | null
          max_amount?: number | null
          min_amount?: number
          updated_at?: string
        }
        Relationships: []
      }
      customer_app_config: {
        Row: {
          draft_config: Json
          id: boolean
          published_at: string | null
          published_by: string | null
          published_config: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          draft_config?: Json
          id?: boolean
          published_at?: string | null
          published_by?: string | null
          published_config?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          draft_config?: Json
          id?: boolean
          published_at?: string | null
          published_by?: string | null
          published_config?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      customer_favorites: {
        Row: {
          created_at: string
          id: string
          menu_item_id: string | null
          store_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          menu_item_id?: string | null
          store_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          menu_item_id?: string | null
          store_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      customer_referrals: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          referral_code: string
          referred_id: string | null
          referrer_id: string
          reward_amount: number
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          referral_code: string
          referred_id?: string | null
          referrer_id: string
          reward_amount?: number
          status?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          referral_code?: string
          referred_id?: string | null
          referrer_id?: string
          reward_amount?: number
          status?: string
        }
        Relationships: []
      }
      customer_rewards: {
        Row: {
          created_at: string
          id: string
          lifetime_points: number
          points: number
          tier: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          lifetime_points?: number
          points?: number
          tier?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          lifetime_points?: number
          points?: number
          tier?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      customer_wallet_ledger: {
        Row: {
          amount: number
          created_at: string
          description: string | null
          id: string
          order_id: string | null
          type: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          description?: string | null
          id?: string
          order_id?: string | null
          type: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string | null
          id?: string
          order_id?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_wallet_ledger_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_wallets: {
        Row: {
          balance: number
          created_at: string
          id: string
          lifetime_credit: number
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          id?: string
          lifetime_credit?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          id?: string
          lifetime_credit?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      demand_zones: {
        Row: {
          auto_surge: boolean
          bonus_amount: number
          created_at: string
          driver_count: number
          id: string
          is_active: boolean
          latitude: number
          longitude: number
          multiplier: number
          name: string
          order_count: number
          radius_km: number
          surge_ends_at: string | null
          surge_starts_at: string | null
          updated_at: string
        }
        Insert: {
          auto_surge?: boolean
          bonus_amount?: number
          created_at?: string
          driver_count?: number
          id?: string
          is_active?: boolean
          latitude: number
          longitude: number
          multiplier?: number
          name: string
          order_count?: number
          radius_km?: number
          surge_ends_at?: string | null
          surge_starts_at?: string | null
          updated_at?: string
        }
        Update: {
          auto_surge?: boolean
          bonus_amount?: number
          created_at?: string
          driver_count?: number
          id?: string
          is_active?: boolean
          latitude?: number
          longitude?: number
          multiplier?: number
          name?: string
          order_count?: number
          radius_km?: number
          surge_ends_at?: string | null
          surge_starts_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      dispatch_runs: {
        Row: {
          details: Json | null
          dispatched: number
          duration_ms: number | null
          error: string | null
          expired: number
          finished_at: string | null
          id: string
          source: string
          started_at: string
          success: boolean
        }
        Insert: {
          details?: Json | null
          dispatched?: number
          duration_ms?: number | null
          error?: string | null
          expired?: number
          finished_at?: string | null
          id?: string
          source?: string
          started_at?: string
          success?: boolean
        }
        Update: {
          details?: Json | null
          dispatched?: number
          duration_ms?: number | null
          error?: string | null
          expired?: number
          finished_at?: string | null
          id?: string
          source?: string
          started_at?: string
          success?: boolean
        }
        Relationships: []
      }
      driver_cash_debts: {
        Row: {
          admin_share: number
          amount_owed: number
          cash_collected: number
          created_at: string
          driver_id: string
          driver_share: number
          id: string
          order_id: string | null
          platform_share: number
          settled: boolean
          settled_at: string | null
          settled_by: string | null
          store_share: number
        }
        Insert: {
          admin_share?: number
          amount_owed?: number
          cash_collected?: number
          created_at?: string
          driver_id: string
          driver_share?: number
          id?: string
          order_id?: string | null
          platform_share?: number
          settled?: boolean
          settled_at?: string | null
          settled_by?: string | null
          store_share?: number
        }
        Update: {
          admin_share?: number
          amount_owed?: number
          cash_collected?: number
          created_at?: string
          driver_id?: string
          driver_share?: number
          id?: string
          order_id?: string | null
          platform_share?: number
          settled?: boolean
          settled_at?: string | null
          settled_by?: string | null
          store_share?: number
        }
        Relationships: []
      }
      driver_guarantees: {
        Row: {
          budget_cap: number | null
          budget_spent: number
          created_at: string
          day_of_week: number[]
          end_time: string
          id: string
          is_active: boolean
          label: string
          min_acceptance_pct: number | null
          min_per_hour: number
          start_time: string
          updated_at: string
          zone_id: string | null
        }
        Insert: {
          budget_cap?: number | null
          budget_spent?: number
          created_at?: string
          day_of_week?: number[]
          end_time?: string
          id?: string
          is_active?: boolean
          label: string
          min_acceptance_pct?: number | null
          min_per_hour?: number
          start_time?: string
          updated_at?: string
          zone_id?: string | null
        }
        Update: {
          budget_cap?: number | null
          budget_spent?: number
          created_at?: string
          day_of_week?: number[]
          end_time?: string
          id?: string
          is_active?: boolean
          label?: string
          min_acceptance_pct?: number | null
          min_per_hour?: number
          start_time?: string
          updated_at?: string
          zone_id?: string | null
        }
        Relationships: []
      }
      driver_locations: {
        Row: {
          driver_id: string
          heading: number | null
          id: string
          latitude: number
          longitude: number
          speed: number | null
          updated_at: string
        }
        Insert: {
          driver_id: string
          heading?: number | null
          id?: string
          latitude: number
          longitude: number
          speed?: number | null
          updated_at?: string
        }
        Update: {
          driver_id?: string
          heading?: number | null
          id?: string
          latitude?: number
          longitude?: number
          speed?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      driver_notifications: {
        Row: {
          body: string
          created_at: string
          driver_id: string
          id: string
          read_at: string | null
          sender_id: string | null
          severity: string
          title: string
        }
        Insert: {
          body: string
          created_at?: string
          driver_id: string
          id?: string
          read_at?: string | null
          sender_id?: string | null
          severity?: string
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          driver_id?: string
          id?: string
          read_at?: string | null
          sender_id?: string | null
          severity?: string
          title?: string
        }
        Relationships: []
      }
      driver_offer_events: {
        Row: {
          action: string
          created_at: string
          driver_id: string
          id: string
          order_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          driver_id: string
          id?: string
          order_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          driver_id?: string
          id?: string
          order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_offer_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_profiles: {
        Row: {
          account_holder: string | null
          availability: Json | null
          bank_name: string | null
          created_at: string
          date_of_birth: string | null
          driver_code: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          home_address: string | null
          iban: string | null
          id: string
          id_document_url: string | null
          is_active: boolean
          languages: string[] | null
          layout: string
          license_document_url: string | null
          license_expiry: string | null
          license_number: string | null
          license_plate: string | null
          secondary_phone: string | null
          suspended_at: string | null
          suspension_reason: string | null
          updated_at: string
          user_id: string
          vehicle_color: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_type: string | null
          vehicle_year: number | null
        }
        Insert: {
          account_holder?: string | null
          availability?: Json | null
          bank_name?: string | null
          created_at?: string
          date_of_birth?: string | null
          driver_code?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          home_address?: string | null
          iban?: string | null
          id?: string
          id_document_url?: string | null
          is_active?: boolean
          languages?: string[] | null
          layout?: string
          license_document_url?: string | null
          license_expiry?: string | null
          license_number?: string | null
          license_plate?: string | null
          secondary_phone?: string | null
          suspended_at?: string | null
          suspension_reason?: string | null
          updated_at?: string
          user_id: string
          vehicle_color?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_type?: string | null
          vehicle_year?: number | null
        }
        Update: {
          account_holder?: string | null
          availability?: Json | null
          bank_name?: string | null
          created_at?: string
          date_of_birth?: string | null
          driver_code?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          home_address?: string | null
          iban?: string | null
          id?: string
          id_document_url?: string | null
          is_active?: boolean
          languages?: string[] | null
          layout?: string
          license_document_url?: string | null
          license_expiry?: string | null
          license_number?: string | null
          license_plate?: string | null
          secondary_phone?: string | null
          suspended_at?: string | null
          suspension_reason?: string | null
          updated_at?: string
          user_id?: string
          vehicle_color?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_type?: string | null
          vehicle_year?: number | null
        }
        Relationships: []
      }
      driver_quest_progress: {
        Row: {
          claimed: boolean
          claimed_at: string | null
          current_value: number
          driver_id: string
          id: string
          quest_id: string
          updated_at: string
        }
        Insert: {
          claimed?: boolean
          claimed_at?: string | null
          current_value?: number
          driver_id: string
          id?: string
          quest_id: string
          updated_at?: string
        }
        Update: {
          claimed?: boolean
          claimed_at?: string | null
          current_value?: number
          driver_id?: string
          id?: string
          quest_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_quest_progress_quest_id_fkey"
            columns: ["quest_id"]
            isOneToOne: false
            referencedRelation: "driver_quests"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_quests: {
        Row: {
          budget_cap: number | null
          budget_spent: number
          created_at: string
          created_by: string | null
          description: string | null
          ends_at: string | null
          id: string
          is_active: boolean
          min_rating: number | null
          min_tenure_days: number | null
          reward_amount: number
          starts_at: string
          target_type: string
          target_value: number
          title: string
          updated_at: string
          vehicle_types: string[] | null
          zone_id: string | null
        }
        Insert: {
          budget_cap?: number | null
          budget_spent?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string
          is_active?: boolean
          min_rating?: number | null
          min_tenure_days?: number | null
          reward_amount?: number
          starts_at?: string
          target_type?: string
          target_value?: number
          title: string
          updated_at?: string
          vehicle_types?: string[] | null
          zone_id?: string | null
        }
        Update: {
          budget_cap?: number | null
          budget_spent?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string
          is_active?: boolean
          min_rating?: number | null
          min_tenure_days?: number | null
          reward_amount?: number
          starts_at?: string
          target_type?: string
          target_value?: number
          title?: string
          updated_at?: string
          vehicle_types?: string[] | null
          zone_id?: string | null
        }
        Relationships: []
      }
      driver_referrals: {
        Row: {
          bonus_amount: number
          completed_at: string | null
          created_at: string
          id: string
          referral_code: string
          referred_id: string | null
          referrer_id: string
          status: string
        }
        Insert: {
          bonus_amount?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          referral_code: string
          referred_id?: string | null
          referrer_id: string
          status?: string
        }
        Update: {
          bonus_amount?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          referral_code?: string
          referred_id?: string | null
          referrer_id?: string
          status?: string
        }
        Relationships: []
      }
      driver_state: {
        Row: {
          break_until: string | null
          daily_goal: number
          driver_id: string
          last_cash_reset_at: string | null
          on_break: boolean
          shift_cash_balance: number
          shift_started_at: string | null
          updated_at: string
          weekly_goal: number
        }
        Insert: {
          break_until?: string | null
          daily_goal?: number
          driver_id: string
          last_cash_reset_at?: string | null
          on_break?: boolean
          shift_cash_balance?: number
          shift_started_at?: string | null
          updated_at?: string
          weekly_goal?: number
        }
        Update: {
          break_until?: string | null
          daily_goal?: number
          driver_id?: string
          last_cash_reset_at?: string | null
          on_break?: boolean
          shift_cash_balance?: number
          shift_started_at?: string | null
          updated_at?: string
          weekly_goal?: number
        }
        Relationships: []
      }
      driver_wallets: {
        Row: {
          available_balance: number
          created_at: string
          driver_id: string
          id: string
          pending_balance: number
          total_withdrawn: number
          updated_at: string
        }
        Insert: {
          available_balance?: number
          created_at?: string
          driver_id: string
          id?: string
          pending_balance?: number
          total_withdrawn?: number
          updated_at?: string
        }
        Update: {
          available_balance?: number
          created_at?: string
          driver_id?: string
          id?: string
          pending_balance?: number
          total_withdrawn?: number
          updated_at?: string
        }
        Relationships: []
      }
      earnings: {
        Row: {
          base_pay: number
          bonus: number | null
          created_at: string
          driver_id: string
          id: string
          order_id: string | null
          tip: number | null
          total: number | null
        }
        Insert: {
          base_pay?: number
          bonus?: number | null
          created_at?: string
          driver_id: string
          id?: string
          order_id?: string | null
          tip?: number | null
          total?: number | null
        }
        Update: {
          base_pay?: number
          bonus?: number | null
          created_at?: string
          driver_id?: string
          id?: string
          order_id?: string | null
          tip?: number | null
          total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "earnings_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      feature_flags: {
        Row: {
          category: string
          description: string | null
          id: string
          is_enabled: boolean
          key: string
          label: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category?: string
          description?: string | null
          id?: string
          is_enabled?: boolean
          key: string
          label: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: string
          description?: string | null
          id?: string
          is_enabled?: boolean
          key?: string
          label?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      fraud_signals: {
        Row: {
          created_at: string
          details: Json
          id: string
          resolved: boolean
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          signal_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          details?: Json
          id?: string
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          signal_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          details?: Json
          id?: string
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          signal_type?: string
          user_id?: string
        }
        Relationships: []
      }
      group_order_participants: {
        Row: {
          display_name: string | null
          group_order_id: string
          id: string
          items: Json
          joined_at: string
          paid: boolean
          subtotal: number
          user_id: string
        }
        Insert: {
          display_name?: string | null
          group_order_id: string
          id?: string
          items?: Json
          joined_at?: string
          paid?: boolean
          subtotal?: number
          user_id: string
        }
        Update: {
          display_name?: string | null
          group_order_id?: string
          id?: string
          items?: Json
          joined_at?: string
          paid?: boolean
          subtotal?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_order_participants_group_order_id_fkey"
            columns: ["group_order_id"]
            isOneToOne: false
            referencedRelation: "group_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      group_orders: {
        Row: {
          closes_at: string | null
          created_at: string
          delivery_address: string | null
          delivery_latitude: number | null
          delivery_longitude: number | null
          host_id: string
          id: string
          notes: string | null
          share_code: string
          status: string
          store_id: string
          updated_at: string
        }
        Insert: {
          closes_at?: string | null
          created_at?: string
          delivery_address?: string | null
          delivery_latitude?: number | null
          delivery_longitude?: number | null
          host_id: string
          id?: string
          notes?: string | null
          share_code: string
          status?: string
          store_id: string
          updated_at?: string
        }
        Update: {
          closes_at?: string | null
          created_at?: string
          delivery_address?: string | null
          delivery_latitude?: number | null
          delivery_longitude?: number | null
          host_id?: string
          id?: string
          notes?: string | null
          share_code?: string
          status?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      menu_item_modifiers: {
        Row: {
          created_at: string
          group_name: string
          id: string
          is_multi: boolean
          is_required: boolean
          menu_item_id: string
          option_name: string
          price_delta: number
          sort_order: number
        }
        Insert: {
          created_at?: string
          group_name: string
          id?: string
          is_multi?: boolean
          is_required?: boolean
          menu_item_id: string
          option_name: string
          price_delta?: number
          sort_order?: number
        }
        Update: {
          created_at?: string
          group_name?: string
          id?: string
          is_multi?: boolean
          is_required?: boolean
          menu_item_id?: string
          option_name?: string
          price_delta?: number
          sort_order?: number
        }
        Relationships: []
      }
      menu_items: {
        Row: {
          allergens: string[] | null
          calories: number | null
          category: string | null
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_available: boolean | null
          is_gluten_free: boolean | null
          is_snoozed: boolean | null
          is_vegan: boolean | null
          is_vegetarian: boolean | null
          low_stock_threshold: number | null
          name: string
          price: number
          spicy_level: number | null
          stock_count: number | null
          store_id: string
          track_inventory: boolean
          updated_at: string
        }
        Insert: {
          allergens?: string[] | null
          calories?: number | null
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_available?: boolean | null
          is_gluten_free?: boolean | null
          is_snoozed?: boolean | null
          is_vegan?: boolean | null
          is_vegetarian?: boolean | null
          low_stock_threshold?: number | null
          name: string
          price: number
          spicy_level?: number | null
          stock_count?: number | null
          store_id: string
          track_inventory?: boolean
          updated_at?: string
        }
        Update: {
          allergens?: string[] | null
          calories?: number | null
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_available?: boolean | null
          is_gluten_free?: boolean | null
          is_snoozed?: boolean | null
          is_vegan?: boolean | null
          is_vegetarian?: boolean | null
          low_stock_threshold?: number | null
          name?: string
          price?: number
          spicy_level?: number | null
          stock_count?: number | null
          store_id?: string
          track_inventory?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores_public"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_reports: {
        Row: {
          admin_earned: number
          closed_at: string
          closed_by: string | null
          delivered_revenue: number
          driver_topup_total: number
          id: string
          orders_count: number
          period_end: string
          period_start: string
          platform_earned: number
          snapshot: Json
        }
        Insert: {
          admin_earned?: number
          closed_at?: string
          closed_by?: string | null
          delivered_revenue?: number
          driver_topup_total?: number
          id?: string
          orders_count?: number
          period_end: string
          period_start: string
          platform_earned?: number
          snapshot?: Json
        }
        Update: {
          admin_earned?: number
          closed_at?: string
          closed_by?: string | null
          delivered_revenue?: number
          driver_topup_total?: number
          id?: string
          orders_count?: number
          period_end?: string
          period_start?: string
          platform_earned?: number
          snapshot?: Json
        }
        Relationships: []
      }
      order_item_modifiers: {
        Row: {
          group_name: string
          id: string
          option_name: string
          order_item_id: string
          price_delta: number
        }
        Insert: {
          group_name: string
          id?: string
          option_name: string
          order_item_id: string
          price_delta?: number
        }
        Update: {
          group_name?: string
          id?: string
          option_name?: string
          order_item_id?: string
          price_delta?: number
        }
        Relationships: []
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          menu_item_id: string | null
          name: string
          order_id: string
          quantity: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          menu_item_id?: string | null
          name: string
          order_id: string
          quantity?: number
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          menu_item_id?: string | null
          name?: string
          order_id?: string
          quantity?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          batch_id: string | null
          cash_received: number | null
          change_due: number | null
          commission_settled_at: string | null
          created_at: string
          customer_id: string | null
          delivery_address: string | null
          delivery_fee: number | null
          delivery_latitude: number | null
          delivery_longitude: number | null
          dispatch_at: string | null
          distance_km: number | null
          driver_id: string | null
          driver_payout: number
          driver_pool_bonus: number
          estimated_prep_time: number | null
          external_ref: string | null
          group_order_id: string | null
          id: string
          notes: string | null
          payment_method: string
          photo_verification_url: string | null
          pickup_checklist: Json | null
          platform_profit: number
          predicted_prep_minutes: number | null
          predicted_ready_at: string | null
          prep_minutes_actual: number | null
          refund_reason: string | null
          refunded_amount: number
          scheduled_for: string | null
          source: string
          stacked_with_order_id: string | null
          status: Database["public"]["Enums"]["order_status"]
          stop_sequence: number | null
          store_charge: number
          store_id: string
          store_order_number: number | null
          surge_event_id: string | null
          surge_multiplier_used: number
          tip_amount: number | null
          total_amount: number
          updated_at: string
        }
        Insert: {
          batch_id?: string | null
          cash_received?: number | null
          change_due?: number | null
          commission_settled_at?: string | null
          created_at?: string
          customer_id?: string | null
          delivery_address?: string | null
          delivery_fee?: number | null
          delivery_latitude?: number | null
          delivery_longitude?: number | null
          dispatch_at?: string | null
          distance_km?: number | null
          driver_id?: string | null
          driver_payout?: number
          driver_pool_bonus?: number
          estimated_prep_time?: number | null
          external_ref?: string | null
          group_order_id?: string | null
          id?: string
          notes?: string | null
          payment_method?: string
          photo_verification_url?: string | null
          pickup_checklist?: Json | null
          platform_profit?: number
          predicted_prep_minutes?: number | null
          predicted_ready_at?: string | null
          prep_minutes_actual?: number | null
          refund_reason?: string | null
          refunded_amount?: number
          scheduled_for?: string | null
          source?: string
          stacked_with_order_id?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          stop_sequence?: number | null
          store_charge?: number
          store_id: string
          store_order_number?: number | null
          surge_event_id?: string | null
          surge_multiplier_used?: number
          tip_amount?: number | null
          total_amount?: number
          updated_at?: string
        }
        Update: {
          batch_id?: string | null
          cash_received?: number | null
          change_due?: number | null
          commission_settled_at?: string | null
          created_at?: string
          customer_id?: string | null
          delivery_address?: string | null
          delivery_fee?: number | null
          delivery_latitude?: number | null
          delivery_longitude?: number | null
          dispatch_at?: string | null
          distance_km?: number | null
          driver_id?: string | null
          driver_payout?: number
          driver_pool_bonus?: number
          estimated_prep_time?: number | null
          external_ref?: string | null
          group_order_id?: string | null
          id?: string
          notes?: string | null
          payment_method?: string
          photo_verification_url?: string | null
          pickup_checklist?: Json | null
          platform_profit?: number
          predicted_prep_minutes?: number | null
          predicted_ready_at?: string | null
          prep_minutes_actual?: number | null
          refund_reason?: string | null
          refunded_amount?: number
          scheduled_for?: string | null
          source?: string
          stacked_with_order_id?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          stop_sequence?: number | null
          store_charge?: number
          store_id?: string
          store_order_number?: number | null
          surge_event_id?: string | null
          surge_multiplier_used?: number
          tip_amount?: number | null
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_stacked_with_order_id_fkey"
            columns: ["stacked_with_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores_public"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_driver_payouts: {
        Row: {
          amount: number
          created_at: string
          driver_id: string
          id: string
          order_id: string
          reason: string
          resolved: boolean
          resolved_at: string | null
          resolved_by: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          driver_id: string
          id?: string
          order_id: string
          reason?: string
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          driver_id?: string
          id?: string
          order_id?: string
          reason?: string
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Relationships: []
      }
      pending_offers: {
        Row: {
          created_at: string
          distance_km: number | null
          driver_id: string
          expires_at: string
          id: string
          offered_at: string
          order_id: string
          responded_at: string | null
          score: number | null
          status: string
          wave: number
        }
        Insert: {
          created_at?: string
          distance_km?: number | null
          driver_id: string
          expires_at: string
          id?: string
          offered_at?: string
          order_id: string
          responded_at?: string | null
          score?: number | null
          status?: string
          wave?: number
        }
        Update: {
          created_at?: string
          distance_km?: number | null
          driver_id?: string
          expires_at?: string
          id?: string
          offered_at?: string
          order_id?: string
          responded_at?: string | null
          score?: number | null
          status?: string
          wave?: number
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          accept_offer_requires_ready: boolean
          admin_share_pct: number
          allow_arrive_before_pickup: boolean
          allow_deliver_before_arrive: boolean
          allow_pickup_before_ready: boolean
          assignment_mode: string
          auto_balance_enabled: boolean
          auto_dispatch_enabled: boolean
          base_pay: number
          basket_max_surcharge_pct: number
          basket_target_balance: number
          bike_multiplier: number
          buffer_auto_fill_pct: number
          buffer_floor: number
          car_multiplier: number
          customer_base_fee: number
          customer_per_km_fee: number
          default_commission_pct: number
          dispatch_lead_minutes: number
          dist_bike_max_km: number
          dist_car_min_value: number
          dist_distance_weight: number
          dist_fairness_weight: number
          dist_max_waves: number
          dist_min_acceptance_rate: number
          dist_min_driver_rating: number
          dist_motorcycle_max_km: number
          dist_offer_timeout_seconds: number
          dist_rating_weight: number
          dist_search_radius_km: number
          dist_vehicle_rules_enabled: boolean
          dist_wave_size: number
          distribution_mode: string
          driver_pool_pct_of_subtotal: number
          first_km_price: number | null
          id: number
          low_pool_threshold: number
          maintenance_message: string | null
          maintenance_mode: boolean
          max_cash_cap: number
          max_pay: number
          max_stacked_orders: number
          min_pay: number
          motorcycle_multiplier: number
          pause_bonus_when_critical: boolean
          peak_end_hour: number
          peak_multiplier: number
          peak_start_hour: number
          peak_weekdays: number[]
          per_km_rate: number
          platform_service_fee: number
          pool_alert_enabled: boolean
          pool_critical_multiplier: number
          pool_critical_threshold: number
          pool_healthy_threshold: number
          pool_low_multiplier: number
          show_stores_on_driver_map: boolean
          sla_agent_scaling: boolean
          sla_breach_seconds: number
          sla_tickets_per_agent: number
          sla_urgent_seconds: number
          sla_warn_seconds: number
          stack_max_detour_minutes: number
          stacking_enabled: boolean
          subsidize_min_pay: boolean
          surge_default_multiplier: number
          surge_enabled: boolean
          surge_floor_multiplier: number
          surge_ratio_extreme_multiplier: number
          surge_ratio_high_multiplier: number
          surge_ratio_high_threshold: number
          surge_ratio_low_threshold: number
          surge_time_peak_multiplier: number
          updated_at: string
        }
        Insert: {
          accept_offer_requires_ready?: boolean
          admin_share_pct?: number
          allow_arrive_before_pickup?: boolean
          allow_deliver_before_arrive?: boolean
          allow_pickup_before_ready?: boolean
          assignment_mode?: string
          auto_balance_enabled?: boolean
          auto_dispatch_enabled?: boolean
          base_pay?: number
          basket_max_surcharge_pct?: number
          basket_target_balance?: number
          bike_multiplier?: number
          buffer_auto_fill_pct?: number
          buffer_floor?: number
          car_multiplier?: number
          customer_base_fee?: number
          customer_per_km_fee?: number
          default_commission_pct?: number
          dispatch_lead_minutes?: number
          dist_bike_max_km?: number
          dist_car_min_value?: number
          dist_distance_weight?: number
          dist_fairness_weight?: number
          dist_max_waves?: number
          dist_min_acceptance_rate?: number
          dist_min_driver_rating?: number
          dist_motorcycle_max_km?: number
          dist_offer_timeout_seconds?: number
          dist_rating_weight?: number
          dist_search_radius_km?: number
          dist_vehicle_rules_enabled?: boolean
          dist_wave_size?: number
          distribution_mode?: string
          driver_pool_pct_of_subtotal?: number
          first_km_price?: number | null
          id?: number
          low_pool_threshold?: number
          maintenance_message?: string | null
          maintenance_mode?: boolean
          max_cash_cap?: number
          max_pay?: number
          max_stacked_orders?: number
          min_pay?: number
          motorcycle_multiplier?: number
          pause_bonus_when_critical?: boolean
          peak_end_hour?: number
          peak_multiplier?: number
          peak_start_hour?: number
          peak_weekdays?: number[]
          per_km_rate?: number
          platform_service_fee?: number
          pool_alert_enabled?: boolean
          pool_critical_multiplier?: number
          pool_critical_threshold?: number
          pool_healthy_threshold?: number
          pool_low_multiplier?: number
          show_stores_on_driver_map?: boolean
          sla_agent_scaling?: boolean
          sla_breach_seconds?: number
          sla_tickets_per_agent?: number
          sla_urgent_seconds?: number
          sla_warn_seconds?: number
          stack_max_detour_minutes?: number
          stacking_enabled?: boolean
          subsidize_min_pay?: boolean
          surge_default_multiplier?: number
          surge_enabled?: boolean
          surge_floor_multiplier?: number
          surge_ratio_extreme_multiplier?: number
          surge_ratio_high_multiplier?: number
          surge_ratio_high_threshold?: number
          surge_ratio_low_threshold?: number
          surge_time_peak_multiplier?: number
          updated_at?: string
        }
        Update: {
          accept_offer_requires_ready?: boolean
          admin_share_pct?: number
          allow_arrive_before_pickup?: boolean
          allow_deliver_before_arrive?: boolean
          allow_pickup_before_ready?: boolean
          assignment_mode?: string
          auto_balance_enabled?: boolean
          auto_dispatch_enabled?: boolean
          base_pay?: number
          basket_max_surcharge_pct?: number
          basket_target_balance?: number
          bike_multiplier?: number
          buffer_auto_fill_pct?: number
          buffer_floor?: number
          car_multiplier?: number
          customer_base_fee?: number
          customer_per_km_fee?: number
          default_commission_pct?: number
          dispatch_lead_minutes?: number
          dist_bike_max_km?: number
          dist_car_min_value?: number
          dist_distance_weight?: number
          dist_fairness_weight?: number
          dist_max_waves?: number
          dist_min_acceptance_rate?: number
          dist_min_driver_rating?: number
          dist_motorcycle_max_km?: number
          dist_offer_timeout_seconds?: number
          dist_rating_weight?: number
          dist_search_radius_km?: number
          dist_vehicle_rules_enabled?: boolean
          dist_wave_size?: number
          distribution_mode?: string
          driver_pool_pct_of_subtotal?: number
          first_km_price?: number | null
          id?: number
          low_pool_threshold?: number
          maintenance_message?: string | null
          maintenance_mode?: boolean
          max_cash_cap?: number
          max_pay?: number
          max_stacked_orders?: number
          min_pay?: number
          motorcycle_multiplier?: number
          pause_bonus_when_critical?: boolean
          peak_end_hour?: number
          peak_multiplier?: number
          peak_start_hour?: number
          peak_weekdays?: number[]
          per_km_rate?: number
          platform_service_fee?: number
          pool_alert_enabled?: boolean
          pool_critical_multiplier?: number
          pool_critical_threshold?: number
          pool_healthy_threshold?: number
          pool_low_multiplier?: number
          show_stores_on_driver_map?: boolean
          sla_agent_scaling?: boolean
          sla_breach_seconds?: number
          sla_tickets_per_agent?: number
          sla_urgent_seconds?: number
          sla_warn_seconds?: number
          stack_max_detour_minutes?: number
          stacking_enabled?: boolean
          subsidize_min_pay?: boolean
          surge_default_multiplier?: number
          surge_enabled?: boolean
          surge_floor_multiplier?: number
          surge_ratio_extreme_multiplier?: number
          surge_ratio_high_multiplier?: number
          surge_ratio_high_threshold?: number
          surge_ratio_low_threshold?: number
          surge_time_peak_multiplier?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          afm: string | null
          amka: string | null
          avatar_url: string | null
          contract_type: string | null
          created_at: string
          efka_ama: string | null
          full_name: string | null
          id: string
          phone: string | null
          public_code: string | null
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          afm?: string | null
          amka?: string | null
          avatar_url?: string | null
          contract_type?: string | null
          created_at?: string
          efka_ama?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          public_code?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          afm?: string | null
          amka?: string | null
          avatar_url?: string | null
          contract_type?: string | null
          created_at?: string
          efka_ama?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          public_code?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      promo_codes: {
        Row: {
          code: string
          created_at: string
          current_uses: number
          discount_type: Database["public"]["Enums"]["discount_type"]
          discount_value: number
          expires_at: string | null
          id: string
          is_active: boolean
          max_uses: number | null
          min_order_amount: number
          store_id: string | null
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          current_uses?: number
          discount_type?: Database["public"]["Enums"]["discount_type"]
          discount_value: number
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_uses?: number | null
          min_order_amount?: number
          store_id?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          current_uses?: number
          discount_type?: Database["public"]["Enums"]["discount_type"]
          discount_value?: number
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_uses?: number | null
          min_order_amount?: number
          store_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "promo_codes_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_codes_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores_public"
            referencedColumns: ["id"]
          },
        ]
      }
      refunds: {
        Row: {
          amount: number
          created_at: string
          customer_id: string | null
          id: string
          issued_by: string
          notes: string | null
          order_id: string
          reason: string | null
          refund_type: string
        }
        Insert: {
          amount: number
          created_at?: string
          customer_id?: string | null
          id?: string
          issued_by: string
          notes?: string | null
          order_id: string
          reason?: string | null
          refund_type?: string
        }
        Update: {
          amount?: number
          created_at?: string
          customer_id?: string | null
          id?: string
          issued_by?: string
          notes?: string | null
          order_id?: string
          reason?: string | null
          refund_type?: string
        }
        Relationships: []
      }
      reviews: {
        Row: {
          comment: string | null
          created_at: string
          customer_id: string
          id: string
          order_id: string
          rating: number
          store_id: string
          updated_at: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          customer_id: string
          id?: string
          order_id: string
          rating: number
          store_id: string
          updated_at?: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          order_id?: string
          rating?: number
          store_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      reward_history: {
        Row: {
          created_at: string
          id: string
          order_id: string | null
          points_change: number
          reason: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          order_id?: string | null
          points_change: number
          reason: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string | null
          points_change?: number
          reason?: string
          user_id?: string
        }
        Relationships: []
      }
      saved_addresses: {
        Row: {
          address: string
          created_at: string
          id: string
          is_default: boolean
          label: string
          latitude: number | null
          longitude: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address: string
          created_at?: string
          id?: string
          is_default?: boolean
          label?: string
          latitude?: number | null
          longitude?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string
          created_at?: string
          id?: string
          is_default?: boolean
          label?: string
          latitude?: number | null
          longitude?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      service_zones: {
        Row: {
          center_latitude: number
          center_longitude: number
          city: string
          created_at: string
          id: string
          is_active: boolean
          radius_km: number
          updated_at: string
        }
        Insert: {
          center_latitude: number
          center_longitude: number
          city: string
          created_at?: string
          id?: string
          is_active?: boolean
          radius_km?: number
          updated_at?: string
        }
        Update: {
          center_latitude?: number
          center_longitude?: number
          city?: string
          created_at?: string
          id?: string
          is_active?: boolean
          radius_km?: number
          updated_at?: string
        }
        Relationships: []
      }
      store_auto_accept_rules: {
        Row: {
          default_prep_minutes: number
          enabled: boolean
          max_amount: number
          store_id: string
          updated_at: string
        }
        Insert: {
          default_prep_minutes?: number
          enabled?: boolean
          max_amount?: number
          store_id: string
          updated_at?: string
        }
        Update: {
          default_prep_minutes?: number
          enabled?: boolean
          max_amount?: number
          store_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      store_daily_summary_log: {
        Row: {
          id: string
          sent_at: string
          store_id: string
          summary_date: string
        }
        Insert: {
          id?: string
          sent_at?: string
          store_id: string
          summary_date: string
        }
        Update: {
          id?: string
          sent_at?: string
          store_id?: string
          summary_date?: string
        }
        Relationships: []
      }
      store_pricing_overrides: {
        Row: {
          base_pay: number | null
          commission_pct: number | null
          first_km_price: number | null
          max_pay: number | null
          min_pay: number | null
          per_km_rate: number | null
          store_id: string
          updated_at: string
        }
        Insert: {
          base_pay?: number | null
          commission_pct?: number | null
          first_km_price?: number | null
          max_pay?: number | null
          min_pay?: number | null
          per_km_rate?: number | null
          store_id: string
          updated_at?: string
        }
        Update: {
          base_pay?: number | null
          commission_pct?: number | null
          first_km_price?: number | null
          max_pay?: number | null
          min_pay?: number | null
          per_km_rate?: number | null
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_pricing_overrides_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: true
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_pricing_overrides_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: true
            referencedRelation: "stores_public"
            referencedColumns: ["id"]
          },
        ]
      }
      store_wallet_ledger: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          order_id: string | null
          store_id: string
          type: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          order_id?: string | null
          store_id: string
          type: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          order_id?: string | null
          store_id?: string
          type?: string
        }
        Relationships: []
      }
      store_wallets: {
        Row: {
          available_balance: number
          created_at: string
          id: string
          lifetime_earnings: number
          pending_balance: number
          store_id: string
          updated_at: string
        }
        Insert: {
          available_balance?: number
          created_at?: string
          id?: string
          lifetime_earnings?: number
          pending_balance?: number
          store_id: string
          updated_at?: string
        }
        Update: {
          available_balance?: number
          created_at?: string
          id?: string
          lifetime_earnings?: number
          pending_balance?: number
          store_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      stores: {
        Row: {
          address: string
          afm: string | null
          busy_mode: boolean | null
          commission_pct: number | null
          covers_delivery_fee: boolean
          created_at: string
          doy: string | null
          ext_billing_mode: string
          ext_commission_pct: number
          ext_flat_fee: number
          ext_margin_pct: number
          holiday_dates: string[] | null
          id: string
          image_url: string | null
          is_active: boolean | null
          kad: string | null
          latitude: number | null
          legal_name: string | null
          longitude: number | null
          name: string
          opening_hours: Json | null
          owner_id: string
          phone: string | null
          prep_buffer_minutes: number | null
          promotion_amount_paid: number
          promotion_approved_by: string | null
          promotion_ends_at: string | null
          promotion_requested_at: string | null
          promotion_starts_at: string | null
          promotion_status: string
          suspended_at: string | null
          suspension_reason: string | null
          updated_at: string
        }
        Insert: {
          address: string
          afm?: string | null
          busy_mode?: boolean | null
          commission_pct?: number | null
          covers_delivery_fee?: boolean
          created_at?: string
          doy?: string | null
          ext_billing_mode?: string
          ext_commission_pct?: number
          ext_flat_fee?: number
          ext_margin_pct?: number
          holiday_dates?: string[] | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          kad?: string | null
          latitude?: number | null
          legal_name?: string | null
          longitude?: number | null
          name: string
          opening_hours?: Json | null
          owner_id: string
          phone?: string | null
          prep_buffer_minutes?: number | null
          promotion_amount_paid?: number
          promotion_approved_by?: string | null
          promotion_ends_at?: string | null
          promotion_requested_at?: string | null
          promotion_starts_at?: string | null
          promotion_status?: string
          suspended_at?: string | null
          suspension_reason?: string | null
          updated_at?: string
        }
        Update: {
          address?: string
          afm?: string | null
          busy_mode?: boolean | null
          commission_pct?: number | null
          covers_delivery_fee?: boolean
          created_at?: string
          doy?: string | null
          ext_billing_mode?: string
          ext_commission_pct?: number
          ext_flat_fee?: number
          ext_margin_pct?: number
          holiday_dates?: string[] | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          kad?: string | null
          latitude?: number | null
          legal_name?: string | null
          longitude?: number | null
          name?: string
          opening_hours?: Json | null
          owner_id?: string
          phone?: string | null
          prep_buffer_minutes?: number | null
          promotion_amount_paid?: number
          promotion_approved_by?: string | null
          promotion_ends_at?: string | null
          promotion_requested_at?: string | null
          promotion_starts_at?: string | null
          promotion_status?: string
          suspended_at?: string | null
          suspension_reason?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      streak_bonuses: {
        Row: {
          budget_cap: number | null
          budget_spent: number
          consecutive_accepts: number
          created_at: string
          id: string
          is_active: boolean
          label: string
          reward_amount: number
          updated_at: string
          window_hours: number
        }
        Insert: {
          budget_cap?: number | null
          budget_spent?: number
          consecutive_accepts?: number
          created_at?: string
          id?: string
          is_active?: boolean
          label: string
          reward_amount?: number
          updated_at?: string
          window_hours?: number
        }
        Update: {
          budget_cap?: number | null
          budget_spent?: number
          consecutive_accepts?: number
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          reward_amount?: number
          updated_at?: string
          window_hours?: number
        }
        Relationships: []
      }
      support_channel_members: {
        Row: {
          channel_id: string
          id: string
          joined_at: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          channel_id: string
          id?: string
          joined_at?: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          channel_id?: string
          id?: string
          joined_at?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_channel_members_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "support_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      support_channels: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      support_team_messages: {
        Row: {
          attachment_type: string | null
          attachment_url: string | null
          channel_id: string
          created_at: string
          id: string
          message: string | null
          sender_id: string
          sender_role: string
        }
        Insert: {
          attachment_type?: string | null
          attachment_url?: string | null
          channel_id: string
          created_at?: string
          id?: string
          message?: string | null
          sender_id: string
          sender_role?: string
        }
        Update: {
          attachment_type?: string | null
          attachment_url?: string | null
          channel_id?: string
          created_at?: string
          id?: string
          message?: string | null
          sender_id?: string
          sender_role?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_team_messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "support_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          category: string
          created_at: string
          description: string | null
          driver_id: string | null
          id: string
          order_id: string | null
          photo_url: string | null
          priority: string
          requester_id: string | null
          requester_role: string
          resolution_notes: string | null
          resolved_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          description?: string | null
          driver_id?: string | null
          id?: string
          order_id?: string | null
          photo_url?: string | null
          priority?: string
          requester_id?: string | null
          requester_role?: string
          resolution_notes?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          driver_id?: string | null
          id?: string
          order_id?: string | null
          photo_url?: string | null
          priority?: string
          requester_id?: string | null
          requester_role?: string
          resolution_notes?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      surge_events: {
        Row: {
          created_at: string
          created_by: string | null
          ends_at: string | null
          id: string
          multiplier: number
          reason: string | null
          source: string
          started_at: string
          zone_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          multiplier?: number
          reason?: string | null
          source: string
          started_at?: string
          zone_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          multiplier?: number
          reason?: string | null
          source?: string
          started_at?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "surge_events_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "demand_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      surge_overrides: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          is_active: boolean
          mode: string
          multiplier: number
          reason: string | null
          updated_at: string
          zone_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          mode?: string
          multiplier?: number
          reason?: string | null
          updated_at?: string
          zone_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          mode?: string
          multiplier?: number
          reason?: string | null
          updated_at?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "surge_overrides_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "demand_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      surge_zones: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          is_active: boolean
          latitude: number
          longitude: number
          multiplier: number
          name: string
          radius_km: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          latitude: number
          longitude: number
          multiplier?: number
          name: string
          radius_km?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          latitude?: number
          longitude?: number
          multiplier?: number
          name?: string
          radius_km?: number
          updated_at?: string
        }
        Relationships: []
      }
      ticket_messages: {
        Row: {
          attachment_type: string | null
          attachment_url: string | null
          created_at: string
          id: string
          message: string | null
          sender_id: string
          sender_role: string
          ticket_id: string
        }
        Insert: {
          attachment_type?: string | null
          attachment_url?: string | null
          created_at?: string
          id?: string
          message?: string | null
          sender_id: string
          sender_role: string
          ticket_id: string
        }
        Update: {
          attachment_type?: string | null
          attachment_url?: string | null
          created_at?: string
          id?: string
          message?: string | null
          sender_id?: string
          sender_role?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number
          balance_after: number | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          metadata: Json
          order_id: string | null
          surge_event_id: string | null
          type: string
          wallet_kind: string
          wallet_owner_id: string | null
        }
        Insert: {
          amount: number
          balance_after?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          metadata?: Json
          order_id?: string | null
          surge_event_id?: string | null
          type: string
          wallet_kind: string
          wallet_owner_id?: string | null
        }
        Update: {
          amount?: number
          balance_after?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          metadata?: Json
          order_id?: string | null
          surge_event_id?: string | null
          type?: string
          wallet_kind?: string
          wallet_owner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wait_time_bonuses: {
        Row: {
          arrived_at: string
          bonus_amount: number | null
          created_at: string
          driver_id: string
          id: string
          is_applied: boolean | null
          order_id: string | null
          picked_up_at: string | null
          wait_minutes: number | null
        }
        Insert: {
          arrived_at?: string
          bonus_amount?: number | null
          created_at?: string
          driver_id: string
          id?: string
          is_applied?: boolean | null
          order_id?: string | null
          picked_up_at?: string | null
          wait_minutes?: number | null
        }
        Update: {
          arrived_at?: string
          bonus_amount?: number | null
          created_at?: string
          driver_id?: string
          id?: string
          is_applied?: boolean | null
          order_id?: string | null
          picked_up_at?: string | null
          wait_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "wait_time_bonuses_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_transactions: {
        Row: {
          amount: number
          created_at: string
          description: string | null
          driver_id: string
          id: string
          issued_by: string | null
          order_id: string | null
          status: string
          type: string
        }
        Insert: {
          amount: number
          created_at?: string
          description?: string | null
          driver_id: string
          id?: string
          issued_by?: string | null
          order_id?: string | null
          status?: string
          type: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string | null
          driver_id?: string
          id?: string
          issued_by?: string | null
          order_id?: string | null
          status?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      basket_health: {
        Row: {
          current_balance: number | null
          distributed_30d: number | null
          distributed_7d: number | null
          last_distribution_at: string | null
          lifetime_distributed: number | null
          lifetime_in: number | null
        }
        Insert: {
          current_balance?: number | null
          distributed_30d?: never
          distributed_7d?: never
          last_distribution_at?: never
          lifetime_distributed?: never
          lifetime_in?: number | null
        }
        Update: {
          current_balance?: number | null
          distributed_30d?: never
          distributed_7d?: never
          last_distribution_at?: never
          lifetime_distributed?: never
          lifetime_in?: number | null
        }
        Relationships: []
      }
      platform_settings_public: {
        Row: {
          assignment_mode: string | null
          customer_base_fee: number | null
          customer_per_km_fee: number | null
          id: number | null
          maintenance_message: string | null
          maintenance_mode: boolean | null
          max_cash_cap: number | null
          platform_service_fee: number | null
          show_stores_on_driver_map: boolean | null
        }
        Insert: {
          assignment_mode?: string | null
          customer_base_fee?: number | null
          customer_per_km_fee?: number | null
          id?: number | null
          maintenance_message?: string | null
          maintenance_mode?: boolean | null
          max_cash_cap?: number | null
          platform_service_fee?: number | null
          show_stores_on_driver_map?: boolean | null
        }
        Update: {
          assignment_mode?: string | null
          customer_base_fee?: number | null
          customer_per_km_fee?: number | null
          id?: number | null
          maintenance_message?: string | null
          maintenance_mode?: boolean | null
          max_cash_cap?: number | null
          platform_service_fee?: number | null
          show_stores_on_driver_map?: boolean | null
        }
        Relationships: []
      }
      stores_public: {
        Row: {
          address: string | null
          busy_mode: boolean | null
          covers_delivery_fee: boolean | null
          created_at: string | null
          holiday_dates: string[] | null
          id: string | null
          image_url: string | null
          is_active: boolean | null
          latitude: number | null
          longitude: number | null
          name: string | null
          opening_hours: Json | null
          owner_id: string | null
          prep_buffer_minutes: number | null
          promotion_ends_at: string | null
          promotion_starts_at: string | null
          promotion_status: string | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          busy_mode?: boolean | null
          covers_delivery_fee?: boolean | null
          created_at?: string | null
          holiday_dates?: string[] | null
          id?: string | null
          image_url?: string | null
          is_active?: boolean | null
          latitude?: number | null
          longitude?: number | null
          name?: string | null
          opening_hours?: Json | null
          owner_id?: string | null
          prep_buffer_minutes?: number | null
          promotion_ends_at?: string | null
          promotion_starts_at?: string | null
          promotion_status?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          busy_mode?: boolean | null
          covers_delivery_fee?: boolean | null
          created_at?: string | null
          holiday_dates?: string[] | null
          id?: string | null
          image_url?: string | null
          is_active?: boolean | null
          latitude?: number | null
          longitude?: number | null
          name?: string | null
          opening_hours?: Json | null
          owner_id?: string | null
          prep_buffer_minutes?: number | null
          promotion_ends_at?: string | null
          promotion_starts_at?: string | null
          promotion_status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      v_pricing_model: {
        Row: {
          admin_pct: number | null
          default_commission_pct: number | null
          default_store_keeps_pct: number | null
          driver_pool_pct: number | null
          id: number | null
        }
        Insert: {
          admin_pct?: never
          default_commission_pct?: never
          default_store_keeps_pct?: never
          driver_pool_pct?: never
          id?: number | null
        }
        Update: {
          admin_pct?: never
          default_commission_pct?: never
          default_store_keeps_pct?: never
          driver_pool_pct?: never
          id?: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_adjust_admin_buffer: {
        Args: { p_action: string; p_amount: number; p_reason?: string }
        Returns: Json
      }
      admin_adjust_basket: {
        Args: { p_amount: number; p_note: string }
        Returns: number
      }
      admin_adjust_buffer: {
        Args: { p_action: string; p_amount: number; p_reason?: string }
        Returns: Json
      }
      admin_adjust_driver_wallet: {
        Args: { p_amount: number; p_driver_id: string; p_note?: string }
        Returns: number
      }
      admin_adjust_wallet: {
        Args: { p_amount: number; p_description: string; p_driver_id: string }
        Returns: undefined
      }
      admin_auto_close_previous_month: { Args: never; Returns: string }
      admin_cancel_stuck_orders: { Args: { p_minutes?: number }; Returns: Json }
      admin_clear_driver_cash_debt: {
        Args: { p_driver_id: string }
        Returns: number
      }
      admin_close_month: { Args: { p_period_start?: string }; Returns: string }
      admin_credit_customer_wallet: {
        Args: { p_amount: number; p_customer_id: string; p_reason: string }
        Returns: undefined
      }
      admin_distribute_buffer: {
        Args: {
          p_amount: number
          p_mode?: string
          p_note?: string
          p_top_n?: number
          p_zone_id?: string
        }
        Returns: Json
      }
      admin_extend_offer: {
        Args: { p_extra_seconds: number; p_offer_id: string }
        Returns: string
      }
      admin_force_assign_order: {
        Args: { p_driver_id: string; p_order_id: string; p_reason?: string }
        Returns: undefined
      }
      admin_force_complete_order: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      admin_force_end_driver_shift: {
        Args: { p_driver_id: string }
        Returns: undefined
      }
      admin_force_order_status: {
        Args: { p_order_id: string; p_status: string }
        Returns: undefined
      }
      admin_grant_driver_bonus: {
        Args: { p_amount: number; p_driver_id: string; p_note?: string }
        Returns: undefined
      }
      admin_inject_pool: {
        Args: { p_amount: number; p_note?: string }
        Returns: Json
      }
      admin_pause_driver_offers: {
        Args: { p_driver_id: string; p_minutes: number }
        Returns: undefined
      }
      admin_payout_store: {
        Args: { p_amount: number; p_description?: string; p_store_id: string }
        Returns: undefined
      }
      admin_purge_stale: { Args: { p_kind: string }; Returns: Json }
      admin_refund_order: {
        Args: { p_amount: number; p_order_id: string; p_reason?: string }
        Returns: undefined
      }
      admin_release_pending_payout: {
        Args: { p_pending_id: string; p_source?: string }
        Returns: Json
      }
      admin_reset_admin_bag: { Args: never; Returns: number }
      admin_reset_all_driver_lifetime: { Args: never; Returns: number }
      admin_reset_all_driver_wallets: { Args: never; Returns: Json }
      admin_reset_all_store_lifetime: { Args: never; Returns: number }
      admin_reset_all_store_wallets: { Args: never; Returns: number }
      admin_reset_driver_cash: {
        Args: { p_driver_id: string }
        Returns: undefined
      }
      admin_reset_driver_lifetime: {
        Args: { p_driver_id: string }
        Returns: number
      }
      admin_reset_driver_wallet: {
        Args: { p_driver_id: string }
        Returns: undefined
      }
      admin_reset_money_to_zero: { Args: never; Returns: Json }
      admin_reset_platform_pool: { Args: never; Returns: number }
      admin_reset_store_lifetime: {
        Args: { p_store_id: string }
        Returns: number
      }
      admin_reset_store_wallet: {
        Args: { p_store_id: string }
        Returns: number
      }
      admin_send_driver_message: {
        Args: {
          p_body: string
          p_driver_id: string
          p_severity?: string
          p_title: string
        }
        Returns: string
      }
      admin_set_dispatch_enabled: {
        Args: { p_enabled: boolean }
        Returns: undefined
      }
      admin_set_store_promotion: {
        Args: { p_days?: number; p_status: string; p_store_id: string }
        Returns: undefined
      }
      admin_settle_all_driver_cash: { Args: never; Returns: Json }
      admin_settle_driver_cash: {
        Args: { p_debt_id: string }
        Returns: undefined
      }
      admin_suspend_driver: {
        Args: { p_driver_id: string; p_reason?: string }
        Returns: undefined
      }
      admin_toggle_maintenance: {
        Args: { p_message?: string; p_on: boolean }
        Returns: undefined
      }
      admin_unsuspend_driver: {
        Args: { p_driver_id: string }
        Returns: undefined
      }
      admin_wallet_adjust: {
        Args: {
          p_amount: number
          p_kind: string
          p_note: string
          p_user_id: string
        }
        Returns: undefined
      }
      admin_wipe_all_data: { Args: never; Returns: undefined }
      admin_wipe_transactions: { Args: never; Returns: Json }
      claim_quest_reward: { Args: { p_quest_id: string }; Returns: Json }
      cleanup_dispatch_runs: { Args: never; Returns: undefined }
      cleanup_stale_dispatch_artifacts: { Args: never; Returns: Json }
      commission_pct_for_amount: { Args: { p_amount: number }; Returns: number }
      compute_driver_pool_bonus: { Args: { _order_id: string }; Returns: Json }
      compute_order_split: { Args: { _order_id: string }; Returns: Json }
      count_active_support_agents: { Args: never; Returns: number }
      create_custom_order:
        | {
            Args: {
              p_customer_name?: string
              p_customer_phone?: string
              p_delivery_address: string
              p_delivery_fee_override?: number
              p_delivery_lat?: number
              p_delivery_lng?: number
              p_distance_km?: number
              p_items_summary?: string
              p_notes?: string
              p_payment_method?: string
              p_store_id: string
              p_total_amount: number
            }
            Returns: string
          }
        | {
            Args: {
              p_customer_name?: string
              p_customer_phone?: string
              p_delivery_address: string
              p_delivery_fee_override?: number
              p_delivery_lat?: number
              p_delivery_lng?: number
              p_distance_km?: number
              p_driver_payout_override?: number
              p_items_summary?: string
              p_notes?: string
              p_payment_method?: string
              p_store_charge_override?: number
              p_store_id: string
              p_total_amount: number
            }
            Returns: string
          }
      create_driver_earning: {
        Args: {
          p_base_pay: number
          p_bonus?: number
          p_driver_id: string
          p_order_id: string
          p_tip?: number
        }
        Returns: undefined
      }
      create_external_order: {
        Args: {
          p_customer_name?: string
          p_customer_phone?: string
          p_delivery_address: string
          p_delivery_lat?: number
          p_delivery_lng?: number
          p_distance_km?: number
          p_driver_payout_override?: number
          p_external_ref?: string
          p_items_summary?: string
          p_notes?: string
          p_payment_method?: string
          p_source: string
          p_store_charge_override?: number
          p_store_id: string
          p_total_amount: number
        }
        Returns: string
      }
      credit_customer_wallet: {
        Args: {
          p_amount: number
          p_description: string
          p_type: string
          p_user_id: string
        }
        Returns: undefined
      }
      current_surge_for_zone: { Args: { _zone_id: string }; Returns: Json }
      customer_has_order_at_store: {
        Args: { _store: string; _user: string }
        Returns: boolean
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      driver_has_active_order_at_store: {
        Args: { _store: string; _user: string }
        Returns: boolean
      }
      driver_release_order: { Args: { p_order_id: string }; Returns: Json }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      get_platform_settings_public: {
        Args: never
        Returns: {
          assignment_mode: string
          customer_base_fee: number
          customer_per_km_fee: number
          dist_offer_timeout_seconds: number
          maintenance_message: string
          maintenance_mode: boolean
          max_cash_cap: number
          max_stacked_orders: number
          platform_service_fee: number
          show_stores_on_driver_map: boolean
          stacking_enabled: boolean
        }[]
      }
      get_public_reviews: {
        Args: { p_store_id?: string }
        Returns: {
          comment: string
          created_at: string
          id: string
          rating: number
          store_id: string
        }[]
      }
      get_store_avg_prep_minutes: {
        Args: { p_store_id: string }
        Returns: number
      }
      get_store_contact: {
        Args: { _store_id: string }
        Returns: {
          address: string
          id: string
          latitude: number
          longitude: number
          name: string
          phone: string
        }[]
      }
      get_treasury_health: { Args: never; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      haversine_km: {
        Args: { lat1: number; lat2: number; lon1: number; lon2: number }
        Returns: number
      }
      is_point_in_any_zone: {
        Args: { p_lat: number; p_lng: number }
        Returns: boolean
      }
      is_support_or_admin: { Args: { _user_id: string }; Returns: boolean }
      log_admin_action: {
        Args: {
          p_action: string
          p_description?: string
          p_metadata?: Json
          p_target_id?: string
          p_target_type?: string
        }
        Returns: undefined
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      nearby_active_drivers:
        | {
            Args: {
              _exclude_drivers?: string[]
              _limit?: number
              _order_value?: number
              _store_lat: number
              _store_lng: number
            }
            Returns: {
              distance_km: number
              driver_id: string
              score: number
              vehicle_type: string
            }[]
          }
        | {
            Args: {
              _exclude_drivers?: string[]
              _limit?: number
              _order_value?: number
              _store_id?: string
              _store_lat: number
              _store_lng: number
            }
            Returns: {
              active_orders: number
              distance_km: number
              driver_id: string
              is_stack: boolean
              score: number
              vehicle_type: string
            }[]
          }
        | {
            Args: {
              _dropoff_lat?: number
              _dropoff_lng?: number
              _exclude_drivers?: string[]
              _limit?: number
              _order_value?: number
              _store_id?: string
              _store_lat: number
              _store_lng: number
            }
            Returns: {
              active_orders: number
              distance_km: number
              driver_id: string
              is_stack: boolean
              score: number
              vehicle_type: string
            }[]
          }
      next_stop_sequence: { Args: { _batch_id: string }; Returns: number }
      open_surge_event: {
        Args: {
          _ends_at?: string
          _multiplier: number
          _reason: string
          _source: string
          _zone_id: string
        }
        Returns: string
      }
      place_order: {
        Args: {
          p_delivery_address: string
          p_delivery_fee: number
          p_delivery_latitude: number
          p_delivery_longitude: number
          p_distance_km: number
          p_items: Json
          p_notes: string
          p_payment_method: string
          p_promo_code: string
          p_scheduled_for: string
          p_store_id: string
          p_tip_amount: number
        }
        Returns: string
      }
      predict_ready_at: {
        Args: { p_created_at?: string; p_store_id: string }
        Returns: string
      }
      prune_dispatch_runs: { Args: never; Returns: undefined }
      quote_driver_payout: {
        Args: { p_distance_km: number; p_store_id: string }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      redeem_wallet_credit: {
        Args: { p_amount: number; p_order_id: string }
        Returns: number
      }
      refund_order: {
        Args: {
          p_amount: number
          p_notes?: string
          p_order_id: string
          p_reason: string
          p_refund_type?: string
        }
        Returns: string
      }
      request_store_promotion: {
        Args: { p_amount: number; p_days: number; p_store_id: string }
        Returns: undefined
      }
      request_wallet_withdrawal: {
        Args: { p_amount: number; p_driver_id: string }
        Returns: undefined
      }
      resolve_commission_pct: {
        Args: { p_food_total: number; p_store_id: string }
        Returns: number
      }
      run_basket_distribution: { Args: { _rule_id: string }; Returns: Json }
      run_due_basket_distributions: { Args: never; Returns: number }
      set_order_dispatch: {
        Args: {
          p_dispatch_at: string
          p_order_id: string
          p_predicted_prep_minutes: number
        }
        Returns: undefined
      }
      support_cancel_order: {
        Args: { p_order_id: string; p_reason?: string }
        Returns: undefined
      }
      support_credit_wallet: {
        Args: { p_amount: number; p_driver_id: string; p_reason: string }
        Returns: undefined
      }
      support_grant_bonus: {
        Args: { p_amount: number; p_driver_id: string; p_reason: string }
        Returns: undefined
      }
      support_modify_order: {
        Args: {
          p_change_reason?: string
          p_delivery_address?: string
          p_delivery_fee?: number
          p_delivery_lat?: number
          p_delivery_lng?: number
          p_notes?: string
          p_order_id: string
          p_tip_amount?: number
          p_total_amount?: number
        }
        Returns: undefined
      }
      support_suspend_driver: {
        Args: { p_driver_id: string; p_reason: string; p_suspend: boolean }
        Returns: undefined
      }
      support_unassign_order: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      tx_append: {
        Args: {
          _amount: number
          _balance_after: number
          _description: string
          _kind: string
          _meta?: Json
          _order_id: string
          _owner: string
          _type: string
        }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "driver" | "store" | "customer" | "admin" | "support"
      discount_type: "percentage" | "fixed"
      order_status:
        | "pending"
        | "placed"
        | "accepted"
        | "preparing"
        | "ready"
        | "arrived"
        | "picked_up"
        | "delivered"
        | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["driver", "store", "customer", "admin", "support"],
      discount_type: ["percentage", "fixed"],
      order_status: [
        "pending",
        "placed",
        "accepted",
        "preparing",
        "ready",
        "arrived",
        "picked_up",
        "delivered",
        "cancelled",
      ],
    },
  },
} as const
