import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL as string, SUPABASE_KEY as string)
  : null;

export type RequestStage = "received" | "assigned" | "in_progress" | "done";

export interface GuestRequest {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  room: string | null;
  guest_name: string | null;
  type: string;
  title: string | null;
  description: string | null;
  stage: RequestStage;
  language: string | null;
  photo_url: string | null;
  priority: string | null;
  rating: number | null;
  source: string | null;
  created_by_name: string | null;
  updated_by_name: string | null;
  confirmed_by_name: string | null;
}

export type SpaService = "sauna" | "banya";
export type SpaBookingStatus = "pending" | "confirmed" | "cancelled" | "done";
export type SpaBookingSource = "concierge" | "crm" | "walk_in";

export interface SpaBooking {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  booking_date: string;
  slot_time: string;
  service: SpaService;
  guest_name: string;
  guest_phone: string | null;
  room: string | null;
  is_hotel_guest: boolean;
  people_count: number;
  status: SpaBookingStatus;
  source: SpaBookingSource;
  request_id: string | null;
  notes: string | null;
  price: number | null;
  created_by_name: string | null;
  updated_by_name: string | null;
}

export interface SpaBookingCreate {
  booking_date: string;
  slot_time: string;
  service: SpaService;
  guest_name: string;
  guest_phone?: string | null;
  room?: string | null;
  is_hotel_guest: boolean;
  people_count?: number;
  status?: SpaBookingStatus;
  source?: SpaBookingSource;
  notes?: string | null;
  price?: number | null;
}

