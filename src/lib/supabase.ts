import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL!
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseKey)

// Database types
export interface SignalingData {
  id: string
  room_id: string
  type: 'offer' | 'answer' | 'ice_candidate'
  data: any
  created_at: string
}