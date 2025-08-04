import { createClient } from '@supabase/supabase-js'

// Get Supabase credentials from environment or use placeholder for development
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-key'

export const supabase = createClient(supabaseUrl, supabaseKey)

// Database types
export interface SignalingData {
  id: string
  room_id: string
  type: 'offer' | 'answer' | 'ice_candidate'
  data: any
  created_at: string
}