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
      ads: {
        Row: {
          brand_id: string
          created_at: string
          height: number | null
          id: string
          normalized_path: string | null
          original_path: string
          owner_id: string
          sha256: string | null
          status: string
          width: number | null
        }
        Insert: {
          brand_id: string
          created_at?: string
          height?: number | null
          id?: string
          normalized_path?: string | null
          original_path: string
          owner_id?: string
          sha256?: string | null
          status?: string
          width?: number | null
        }
        Update: {
          brand_id?: string
          created_at?: string
          height?: number | null
          id?: string
          normalized_path?: string | null
          original_path?: string
          owner_id?: string
          sha256?: string | null
          status?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ads_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_cache: {
        Row: {
          created_at: string
          hits: number
          key: string
          model: string
          prompt_version: string
          response: Json
          task: string
        }
        Insert: {
          created_at?: string
          hits?: number
          key: string
          model: string
          prompt_version: string
          response: Json
          task: string
        }
        Update: {
          created_at?: string
          hits?: number
          key?: string
          model?: string
          prompt_version?: string
          response?: Json
          task?: string
        }
        Relationships: []
      }
      ai_calls: {
        Row: {
          analysis_id: string | null
          attempt: number
          cache_hit: boolean
          created_at: string
          error: string | null
          http_status: number | null
          id: string
          input_tokens: number | null
          latency_ms: number | null
          model: string
          output_tokens: number | null
          prompt_version: string
          status: string
          task: string
        }
        Insert: {
          analysis_id?: string | null
          attempt?: number
          cache_hit?: boolean
          created_at?: string
          error?: string | null
          http_status?: number | null
          id?: string
          input_tokens?: number | null
          latency_ms?: number | null
          model: string
          output_tokens?: number | null
          prompt_version: string
          status: string
          task: string
        }
        Update: {
          analysis_id?: string | null
          attempt?: number
          cache_hit?: boolean
          created_at?: string
          error?: string | null
          http_status?: number | null
          id?: string
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string
          output_tokens?: number | null
          prompt_version?: string
          status?: string
          task?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_calls_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_quota: {
        Row: {
          day: string
          last_429_at: string | null
          model: string
          requests: number
        }
        Insert: {
          day: string
          last_429_at?: string | null
          model: string
          requests?: number
        }
        Update: {
          day?: string
          last_429_at?: string | null
          model?: string
          requests?: number
        }
        Relationships: []
      }
      analyses: {
        Row: {
          category: string
          config: Json
          created_at: string
          error: string | null
          id: string
          owner_id: string
          pending_batches: number
          preset: string
          seed: number
          status: Database["public"]["Enums"]["analysis_status"]
          target_ad_id: string
          target_brand_id: string
          updated_at: string
        }
        Insert: {
          category: string
          config?: Json
          created_at?: string
          error?: string | null
          id?: string
          owner_id?: string
          pending_batches?: number
          preset?: string
          seed?: number
          status?: Database["public"]["Enums"]["analysis_status"]
          target_ad_id: string
          target_brand_id: string
          updated_at?: string
        }
        Update: {
          category?: string
          config?: Json
          created_at?: string
          error?: string | null
          id?: string
          owner_id?: string
          pending_batches?: number
          preset?: string
          seed?: number
          status?: Database["public"]["Enums"]["analysis_status"]
          target_ad_id?: string
          target_brand_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "analyses_target_ad_id_fkey"
            columns: ["target_ad_id"]
            isOneToOne: false
            referencedRelation: "ads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analyses_target_brand_id_fkey"
            columns: ["target_brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_ads: {
        Row: {
          ad_id: string
          analysis_id: string
          role: Database["public"]["Enums"]["ad_role"]
        }
        Insert: {
          ad_id: string
          analysis_id: string
          role: Database["public"]["Enums"]["ad_role"]
        }
        Update: {
          ad_id?: string
          analysis_id?: string
          role?: Database["public"]["Enums"]["ad_role"]
        }
        Relationships: [
          {
            foreignKeyName: "analysis_ads_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "ads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analysis_ads_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_brands: {
        Row: {
          analysis_id: string
          brand_id: string
          candidate_label: string
          is_target: boolean
        }
        Insert: {
          analysis_id: string
          brand_id: string
          candidate_label: string
          is_target?: boolean
        }
        Update: {
          analysis_id?: string
          brand_id?: string
          candidate_label?: string
          is_target?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "analysis_brands_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analysis_brands_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_events: {
        Row: {
          analysis_id: string
          created_at: string
          id: number
          owner_id: string
          payload: Json
          type: string
        }
        Insert: {
          analysis_id: string
          created_at?: string
          id?: never
          owner_id: string
          payload?: Json
          type: string
        }
        Update: {
          analysis_id?: string
          created_at?: string
          id?: never
          owner_id?: string
          payload?: Json
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_events_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          category: string
          created_at: string
          id: string
          name: string
          owner_id: string
          slug: string
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          name: string
          owner_id?: string
          slug: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          slug?: string
        }
        Relationships: []
      }
      condition_metrics: {
        Row: {
          analysis_id: string
          attribution: number
          attribution_ci: number[]
          computed_at: string
          condition_id: string
          cue_freq: Json
          n_batches: number
          n_votes: number
          pull: Json
          pull_ci: Json
        }
        Insert: {
          analysis_id: string
          attribution: number
          attribution_ci: number[]
          computed_at?: string
          condition_id: string
          cue_freq: Json
          n_batches: number
          n_votes: number
          pull: Json
          pull_ci: Json
        }
        Update: {
          analysis_id?: string
          attribution?: number
          attribution_ci?: number[]
          computed_at?: string
          condition_id?: string
          cue_freq?: Json
          n_batches?: number
          n_votes?: number
          pull?: Json
          pull_ci?: Json
        }
        Relationships: [
          {
            foreignKeyName: "condition_metrics_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "condition_metrics_condition_id_fkey"
            columns: ["condition_id"]
            isOneToOne: true
            referencedRelation: "conditions"
            referencedColumns: ["id"]
          },
        ]
      }
      conditions: {
        Row: {
          analysis_id: string
          created_at: string
          element: Database["public"]["Enums"]["element_kind"] | null
          guard: Json
          id: string
          image_path: string
          image_sha256: string
          kind: Database["public"]["Enums"]["condition_kind"]
          transform: Json
          variant_id: string | null
        }
        Insert: {
          analysis_id: string
          created_at?: string
          element?: Database["public"]["Enums"]["element_kind"] | null
          guard?: Json
          id?: string
          image_path: string
          image_sha256: string
          kind: Database["public"]["Enums"]["condition_kind"]
          transform?: Json
          variant_id?: string | null
        }
        Update: {
          analysis_id?: string
          created_at?: string
          element?: Database["public"]["Enums"]["element_kind"] | null
          guard?: Json
          id?: string
          image_path?: string
          image_sha256?: string
          kind?: Database["public"]["Enums"]["condition_kind"]
          transform?: Json
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conditions_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conditions_variant_fk"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "variants"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_briefs: {
        Row: {
          analysis_id: string
          brief: Json
          brief_hash: string
          created_at: string
          id: string
          session_id: string
          version: number
        }
        Insert: {
          analysis_id: string
          brief: Json
          brief_hash: string
          created_at?: string
          id?: string
          session_id: string
          version: number
        }
        Update: {
          analysis_id?: string
          brief?: Json
          brief_hash?: string
          created_at?: string
          id?: string
          session_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "creative_briefs_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_briefs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "quiz_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      directions: {
        Row: {
          comparisons: number
          description: string
          elo: number
          id: string
          session_id: string
          tags: string[]
          title: string
        }
        Insert: {
          comparisons?: number
          description: string
          elo?: number
          id?: string
          session_id: string
          tags: string[]
          title: string
        }
        Update: {
          comparisons?: number
          description?: string
          elo?: number
          id?: string
          session_id?: string
          tags?: string[]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "directions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "quiz_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      element_impacts: {
        Row: {
          analysis_id: string
          delta: number
          delta_ci: number[]
          element: Database["public"]["Enums"]["element_kind"]
          label: Database["public"]["Enums"]["diagnosis_label"]
          pull_shift: Json
          pull_shift_ci: Json
        }
        Insert: {
          analysis_id: string
          delta: number
          delta_ci: number[]
          element: Database["public"]["Enums"]["element_kind"]
          label: Database["public"]["Enums"]["diagnosis_label"]
          pull_shift: Json
          pull_shift_ci: Json
        }
        Update: {
          analysis_id?: string
          delta?: number
          delta_ci?: number[]
          element?: Database["public"]["Enums"]["element_kind"]
          label?: Database["public"]["Enums"]["diagnosis_label"]
          pull_shift?: Json
          pull_shift_ci?: Json
        }
        Relationships: [
          {
            foreignKeyName: "element_impacts_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      embeddings: {
        Row: {
          created_at: string
          dims: number
          embedding: string
          id: string
          image_sha256: string
          model: string
          subject_id: string
          subject_type: string
        }
        Insert: {
          created_at?: string
          dims: number
          embedding: string
          id?: string
          image_sha256: string
          model: string
          subject_id: string
          subject_type: string
        }
        Update: {
          created_at?: string
          dims?: number
          embedding?: string
          id?: string
          image_sha256?: string
          model?: string
          subject_id?: string
          subject_type?: string
        }
        Relationships: []
      }
      findings: {
        Row: {
          analysis_id: string
          brand_id: string | null
          element: Database["public"]["Enums"]["element_kind"] | null
          evidence: Json
          finding_key: string
          id: string
          rule: string
          severity: number
        }
        Insert: {
          analysis_id: string
          brand_id?: string | null
          element?: Database["public"]["Enums"]["element_kind"] | null
          evidence: Json
          finding_key: string
          id?: string
          rule: string
          severity: number
        }
        Update: {
          analysis_id?: string
          brand_id?: string | null
          element?: Database["public"]["Enums"]["element_kind"] | null
          evidence?: Json
          finding_key?: string
          id?: string
          rule?: string
          severity?: number
        }
        Relationships: [
          {
            foreignKeyName: "findings_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "findings_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      pairwise_rounds: {
        Row: {
          a_id: string
          answered_at: string | null
          b_id: string
          choice: string | null
          created_at: string
          id: string
          round_index: number
          session_id: string
        }
        Insert: {
          a_id: string
          answered_at?: string | null
          b_id: string
          choice?: string | null
          created_at?: string
          id?: string
          round_index: number
          session_id: string
        }
        Update: {
          a_id?: string
          answered_at?: string | null
          b_id?: string
          choice?: string | null
          created_at?: string
          id?: string
          round_index?: number
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pairwise_rounds_a_id_fkey"
            columns: ["a_id"]
            isOneToOne: false
            referencedRelation: "directions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pairwise_rounds_b_id_fkey"
            columns: ["b_id"]
            isOneToOne: false
            referencedRelation: "directions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pairwise_rounds_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "quiz_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      panel_batches: {
        Row: {
          analysis_id: string
          attempts: number
          batch_index: number
          candidate_order: string[]
          condition_id: string
          created_at: string
          error: string | null
          exposure_ad_ids: string[]
          finished_at: string | null
          id: string
          leak_flags: number
          model: string
          persona_ids: string[]
          raw_response: Json | null
          request_key: string | null
          status: Database["public"]["Enums"]["batch_status"]
        }
        Insert: {
          analysis_id: string
          attempts?: number
          batch_index: number
          candidate_order: string[]
          condition_id: string
          created_at?: string
          error?: string | null
          exposure_ad_ids: string[]
          finished_at?: string | null
          id?: string
          leak_flags?: number
          model: string
          persona_ids: string[]
          raw_response?: Json | null
          request_key?: string | null
          status?: Database["public"]["Enums"]["batch_status"]
        }
        Update: {
          analysis_id?: string
          attempts?: number
          batch_index?: number
          candidate_order?: string[]
          condition_id?: string
          created_at?: string
          error?: string | null
          exposure_ad_ids?: string[]
          finished_at?: string | null
          id?: string
          leak_flags?: number
          model?: string
          persona_ids?: string[]
          raw_response?: Json | null
          request_key?: string | null
          status?: Database["public"]["Enums"]["batch_status"]
        }
        Relationships: [
          {
            foreignKeyName: "panel_batches_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "panel_batches_condition_id_fkey"
            columns: ["condition_id"]
            isOneToOne: false
            referencedRelation: "conditions"
            referencedColumns: ["id"]
          },
        ]
      }
      panel_votes: {
        Row: {
          batch_id: string
          condition_id: string
          cues: Json
          id: string
          persona_id: string
          probabilities: Json
          raw_probabilities: Json
          saw_identifier: boolean
        }
        Insert: {
          batch_id: string
          condition_id: string
          cues: Json
          id?: string
          persona_id: string
          probabilities: Json
          raw_probabilities: Json
          saw_identifier?: boolean
        }
        Update: {
          batch_id?: string
          condition_id?: string
          cues?: Json
          id?: string
          persona_id?: string
          probabilities?: Json
          raw_probabilities?: Json
          saw_identifier?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "panel_votes_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "panel_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "panel_votes_condition_id_fkey"
            columns: ["condition_id"]
            isOneToOne: false
            referencedRelation: "conditions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "panel_votes_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
        ]
      }
      personas: {
        Row: {
          category_familiarity: string
          description: string
          id: string
          viewing_mode: string
        }
        Insert: {
          category_familiarity: string
          description: string
          id: string
          viewing_mode: string
        }
        Update: {
          category_familiarity?: string
          description?: string
          id?: string
          viewing_mode?: string
        }
        Relationships: []
      }
      quiz_answers: {
        Row: {
          answered_at: string
          question_id: string
          session_id: string
          value: Json
        }
        Insert: {
          answered_at?: string
          question_id: string
          session_id: string
          value: Json
        }
        Update: {
          answered_at?: string
          question_id?: string
          session_id?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "quiz_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: true
            referencedRelation: "quiz_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_answers_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "quiz_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_questions: {
        Row: {
          asked_at: string | null
          constraints: Json
          depends_on: Json | null
          fills_slots: string[]
          finding_key: string | null
          help: string | null
          id: string
          key: string
          options: Json
          position: number | null
          priority: number
          prompt: string
          required: boolean
          session_id: string
          source: Database["public"]["Enums"]["question_source"]
          type: Database["public"]["Enums"]["question_type"]
        }
        Insert: {
          asked_at?: string | null
          constraints?: Json
          depends_on?: Json | null
          fills_slots: string[]
          finding_key?: string | null
          help?: string | null
          id?: string
          key: string
          options?: Json
          position?: number | null
          priority?: number
          prompt: string
          required?: boolean
          session_id: string
          source: Database["public"]["Enums"]["question_source"]
          type: Database["public"]["Enums"]["question_type"]
        }
        Update: {
          asked_at?: string | null
          constraints?: Json
          depends_on?: Json | null
          fills_slots?: string[]
          finding_key?: string | null
          help?: string | null
          id?: string
          key?: string
          options?: Json
          position?: number | null
          priority?: number
          prompt?: string
          required?: boolean
          session_id?: string
          source?: Database["public"]["Enums"]["question_source"]
          type?: Database["public"]["Enums"]["question_type"]
        }
        Relationships: [
          {
            foreignKeyName: "quiz_questions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "quiz_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_sessions: {
        Row: {
          analysis_id: string
          asked_count: number
          brief_draft: Json
          created_at: string
          finished_at: string | null
          id: string
          owner_id: string
          status: string
        }
        Insert: {
          analysis_id: string
          asked_count?: number
          brief_draft?: Json
          created_at?: string
          finished_at?: string | null
          id?: string
          owner_id?: string
          status?: string
        }
        Update: {
          analysis_id?: string
          asked_count?: number
          brief_draft?: Json
          created_at?: string
          finished_at?: string | null
          id?: string
          owner_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "quiz_sessions_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: true
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      regions: {
        Row: {
          ad_id: string
          analysis_id: string | null
          approved: boolean
          box: number[]
          confidence: number | null
          created_at: string
          id: string
          is_identifier: boolean | null
          kind: Database["public"]["Enums"]["region_kind"]
          label: string | null
          source: Database["public"]["Enums"]["region_source"]
        }
        Insert: {
          ad_id: string
          analysis_id?: string | null
          approved?: boolean
          box: number[]
          confidence?: number | null
          created_at?: string
          id?: string
          is_identifier?: boolean | null
          kind: Database["public"]["Enums"]["region_kind"]
          label?: string | null
          source: Database["public"]["Enums"]["region_source"]
        }
        Update: {
          ad_id?: string
          analysis_id?: string | null
          approved?: boolean
          box?: number[]
          confidence?: number | null
          created_at?: string
          id?: string
          is_identifier?: boolean | null
          kind?: Database["public"]["Enums"]["region_kind"]
          label?: string | null
          source?: Database["public"]["Enums"]["region_source"]
        }
        Relationships: [
          {
            foreignKeyName: "regions_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "ads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "regions_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          analysis_id: string
          created_at: string
          data: Json
          markdown: string
          model: string
          number_check: Json
          version: number
        }
        Insert: {
          analysis_id: string
          created_at?: string
          data: Json
          markdown: string
          model: string
          number_check: Json
          version: number
        }
        Update: {
          analysis_id?: string
          created_at?: string
          data?: Json
          markdown?: string
          model?: string
          number_check?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "reports_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      similarity: {
        Row: {
          analysis_id: string
          centroid_percentile: number
          centroid_sim: number
          details: Json
          nearest_brand_id: string | null
          nearest_sim: number
        }
        Insert: {
          analysis_id: string
          centroid_percentile: number
          centroid_sim: number
          details: Json
          nearest_brand_id?: string | null
          nearest_sim: number
        }
        Update: {
          analysis_id?: string
          centroid_percentile?: number
          centroid_sim?: number
          details?: Json
          nearest_brand_id?: string | null
          nearest_sim?: number
        }
        Relationships: [
          {
            foreignKeyName: "similarity_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: true
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "similarity_nearest_brand_id_fkey"
            columns: ["nearest_brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      variants: {
        Row: {
          analysis_id: string
          brand_fit: Json | null
          brief_id: string
          change_ratio: number | null
          hypothesis: string
          id: string
          idx: number
          metrics: Json | null
          original_render_path: string | null
          plan: Json
          rejection_reasons: Json | null
          status: string
          target_element: Database["public"]["Enums"]["element_kind"] | null
        }
        Insert: {
          analysis_id: string
          brand_fit?: Json | null
          brief_id: string
          change_ratio?: number | null
          hypothesis: string
          id?: string
          idx: number
          metrics?: Json | null
          original_render_path?: string | null
          plan: Json
          rejection_reasons?: Json | null
          status?: string
          target_element?: Database["public"]["Enums"]["element_kind"] | null
        }
        Update: {
          analysis_id?: string
          brand_fit?: Json | null
          brief_id?: string
          change_ratio?: number | null
          hypothesis?: string
          id?: string
          idx?: number
          metrics?: Json | null
          original_render_path?: string | null
          plan?: Json
          rejection_reasons?: Json | null
          status?: string
          target_element?: Database["public"]["Enums"]["element_kind"] | null
        }
        Relationships: [
          {
            foreignKeyName: "variants_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variants_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "creative_briefs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bump_quota: {
        Args: { p_day: string; p_limit: number; p_model: string }
        Returns: boolean
      }
      config_append: {
        Args: { p_id: string; p_key: string; p_value: string }
        Returns: undefined
      }
      config_merge: {
        Args: { p_id: string; p_patch: Json }
        Returns: undefined
      }
      emit_event: {
        Args: { p_analysis_id: string; p_payload?: Json; p_type: string }
        Returns: undefined
      }
      fail_analysis: {
        Args: { p_error: string; p_id: string }
        Returns: undefined
      }
      finish_batch: { Args: { p_batch_id: string }; Returns: number }
      nearest_category_ads: {
        Args: { p_analysis_id: string; p_embedding: string; p_k: number }
        Returns: {
          ad_id: string
          brand_id: string
          similarity: number
        }[]
      }
      note_429: { Args: { p_day: string; p_model: string }; Returns: undefined }
      owns_ad: { Args: { p_ad_id: string }; Returns: boolean }
      owns_analysis: { Args: { p_analysis_id: string }; Returns: boolean }
      owns_session: { Args: { p_session_id: string }; Returns: boolean }
      queue_archive: { Args: { id: number; q: string }; Returns: boolean }
      queue_delete: { Args: { id: number; q: string }; Returns: boolean }
      queue_read: {
        Args: { q: string; qty: number; vt_s: number }
        Returns: {
          enqueued_at: string
          message: Json
          msg_id: number
          read_ct: number
          vt: string
        }[]
      }
      queue_send: {
        Args: { delay_s?: number; msg: Json; q: string }
        Returns: number
      }
      quota_used: { Args: { p_day: string; p_model: string }; Returns: number }
      register_batches: {
        Args: { p_analysis_id: string; p_batches: Json }
        Returns: {
          batch_index: number
          condition_id: string
          id: string
        }[]
      }
      set_analysis_status: {
        Args: {
          p_from: Database["public"]["Enums"]["analysis_status"][]
          p_id: string
          p_to: Database["public"]["Enums"]["analysis_status"]
        }
        Returns: boolean
      }
    }
    Enums: {
      ad_role: "target" | "competitor" | "exposure"
      analysis_status:
        | "created"
        | "ingesting"
        | "detecting"
        | "needs_review"
        | "masking"
        | "testing"
        | "aggregating"
        | "diagnosed"
        | "quiz_ready"
        | "quiz_in_progress"
        | "planning"
        | "rendering"
        | "retesting"
        | "reporting"
        | "done"
        | "failed"
      batch_status: "planned" | "running" | "done" | "failed"
      condition_kind: "baseline" | "ablation" | "control_no_memory" | "variant"
      diagnosis_label: "strong_asset" | "decoration" | "traitor" | "neutral"
      element_kind:
        | "color"
        | "mascot_character"
        | "product"
        | "other_text"
        | "layout"
      question_source: "core" | "dynamic" | "clarify"
      question_type:
        | "single_choice"
        | "multi_choice"
        | "rank"
        | "slider"
        | "semantic_pair"
        | "palette"
        | "short_text"
        | "yes_no"
      region_kind:
        | "logo"
        | "brand_name"
        | "packaging_text"
        | "url_or_handle"
        | "mascot_character"
        | "product"
        | "other_text"
        | "person"
        | "graphic_element"
      region_source: "model" | "manual"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      ad_role: ["target", "competitor", "exposure"],
      analysis_status: [
        "created",
        "ingesting",
        "detecting",
        "needs_review",
        "masking",
        "testing",
        "aggregating",
        "diagnosed",
        "quiz_ready",
        "quiz_in_progress",
        "planning",
        "rendering",
        "retesting",
        "reporting",
        "done",
        "failed",
      ],
      batch_status: ["planned", "running", "done", "failed"],
      condition_kind: ["baseline", "ablation", "control_no_memory", "variant"],
      diagnosis_label: ["strong_asset", "decoration", "traitor", "neutral"],
      element_kind: [
        "color",
        "mascot_character",
        "product",
        "other_text",
        "layout",
      ],
      question_source: ["core", "dynamic", "clarify"],
      question_type: [
        "single_choice",
        "multi_choice",
        "rank",
        "slider",
        "semantic_pair",
        "palette",
        "short_text",
        "yes_no",
      ],
      region_kind: [
        "logo",
        "brand_name",
        "packaging_text",
        "url_or_handle",
        "mascot_character",
        "product",
        "other_text",
        "person",
        "graphic_element",
      ],
      region_source: ["model", "manual"],
    },
  },
} as const
