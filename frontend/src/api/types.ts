export type StayType = "booking" | "extension" | "alumni";
export type PaymentStatus = "paid" | "partial" | "unpaid";
export type RoomStatus = "free" | "occupied" | "cleaning" | "maintenance" | "booked";

export interface User {
  id: number;
  username: string;
  full_name: string;
  role: "owner" | "admin";
  role_label: string;
  created_at: string;
}

export interface Client {
  id: number;
  full_name: string;
  phone: string | null;
  iin: string | null;
  bin: string | null;
  client_type: "individual" | "organization";
  age: number | null;
  date_of_birth: string | null;
  document_number: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by_user_id: number | null;
  created_by_name: string | null;
  updated_by_user_id: number | null;
  updated_by_name: string | null;
}

export interface ClientDetail extends Client {
  stays: StaySummary[];
}

export interface StaySummary {
  id: number;
  record_date: string;
  stay_type: StayType;
  payment_amount: string;
  payment_status: PaymentStatus;
  payment_method: string | null;
  room_number: string;
}

export interface Stay {
  id: number;
  client_id: number;
  room_id: number;
  record_date: string;
  stay_type: StayType;
  check_in: string | null;
  planned_check_out: string | null;
  check_out: string | null;
  people_count: number;
  payment_amount: string;
  prepayment: string;
  payment_status: PaymentStatus;
  payment_method: string | null;
  payment_date: string | null;
  group_id: string | null;
  extra_bedding: boolean;
  notes: string | null;
  checked_in_at: string | null;
  in_room: boolean;
  created_at: string;
  updated_at: string;
  client_name: string;
  client_phone: string | null;
  client_iin: string | null;
  room_number: string;
  created_by_user_id: number | null;
  created_by_name: string | null;
  updated_by_user_id: number | null;
  updated_by_name: string | null;
}

export interface Room {
  id: number;
  number: string;
  floor: number | null;
  room_type: string | null;
  price_per_night: string | null;
  status: RoomStatus;
  notes: string | null;
  current_guest: string | null;
  status_updated_at: string | null;
  stay_id: number | null;
  guest_phone: string | null;
  check_in: string | null;
  planned_check_out: string | null;
  check_out: string | null;
  stay_updated_at: string | null;
  payment_status: PaymentStatus | null;
  payment_amount: string | null;
}

export interface Banquet {
  id: number;
  cloud_id?: string | null;
  event_date: string;
  event_time: string | null;
  guest_name: string;
  phone: string | null;
  venue: string | null;
  people_count: number;
  event_type: string | null;
  payment_amount: string;
  prepayment: string;
  payment_status: PaymentStatus;
  payment_method: string | null;
  payment_date: string | null;
  dishes: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by_user_id: number | null;
  created_by_name: string | null;
  updated_by_user_id: number | null;
  updated_by_name: string | null;
}

export interface TakeawayOrder {
  id: number;
  cloud_id?: string | null;
  order_date: string;
  order_time: string | null;
  guest_name: string;
  phone: string | null;
  prepayment: string;
  payment_method: string | null;
  payment_date: string | null;
  dishes: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by_user_id: number | null;
  created_by_name: string | null;
  updated_by_user_id: number | null;
  updated_by_name: string | null;
}

export type GuestServiceType = "laundry_hotel" | "laundry_own";

export interface GuestService {
  id: number;
  service_date: string;
  service_type: GuestServiceType;
  item_count: number;
  unit_price: string;
  amount: string;
  stay_id: number | null;
  client_id: number | null;
  room_id: number | null;
  guest_name: string;
  room_number: string | null;
  payment_status: PaymentStatus;
  payment_method: string | null;
  payment_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by_user_id: number | null;
  created_by_name: string | null;
  updated_by_user_id: number | null;
  updated_by_name: string | null;
}

export interface RegistrySummary {
  today_checkins: number;
  today_payments_kzt: string;
  today_checkouts: number;
  occupied_rooms: number;
  total_rooms: number;
  total_records: number;
  payments_by_method: {
    cash: string;
    kaspi: string;
    halyk: string;
    other: string;
  };
}

export interface AnalyticsDailyPoint {
  date: string;
  revenue: string;
  salary_expense: string;
  checkins: number;
  checkouts: number;
  stays_count: number;
}

export interface AnalyticsRoomStat {
  room_number: string;
  revenue: string;
  stays_count: number;
}

export interface AnalyticsClientStat {
  client_name: string;
  visits: number;
  revenue: string;
}

export interface AnalyticsEmployeeSalaryStat {
  employee_name: string;
  position: string;
  hours_worked: string;
  earnings: string;
  shifts_count: number;
}

export interface AnalyticsData {
  summary: {
    period_days: number;
    date_from: string;
    date_to: string;
    total_revenue: string;
    total_checkins: number;
    total_checkouts: number;
    avg_daily_revenue: string;
    total_salary_expense: string;
    avg_daily_salary: string;
    occupancy_rate: number;
    unpaid_amount: string;
    unpaid_count: number;
    payments_by_method: {
      cash: string;
      kaspi: string;
      halyk: string;
      other: string;
    };
    hotel_revenue: string;
    banquet_revenue: string;
    takeaway_revenue: string;
    spa_revenue: string;
    bookings_count: number;
    extensions_count: number;
    alumni_count: number;
  };
  daily: AnalyticsDailyPoint[];
  top_rooms: AnalyticsRoomStat[];
  top_clients: AnalyticsClientStat[];
  salary_by_employee: AnalyticsEmployeeSalaryStat[];
}

export interface AppSettings {
  hotel_name: string;
  hotel_city: string;
  hotel_legal_name: string | null;
  hotel_bin: string | null;
  hotel_address: string | null;
  hotel_director: string | null;
  timezone: string;
  currency: string;
  last_backup_at: string | null;
  auto_lock_minutes: number;
  auto_backup_on_exit: boolean;
  database_path: string;
}

export interface ActLookupResult {
  found: boolean;
  client_id: number | null;
  full_name: string | null;
  iin: string | null;
  bin: string | null;
  client_type: string | null;
  phone: string | null;
}

export interface ActLineItem {
  line_no: number;
  description: string;
  service_date: string;
  unit: string;
  quantity: string;
  unit_price: string;
  amount: string;
  vat_amount: string;
  stay_id?: number | null;
}

export interface ActLineItemInput {
  description: string;
  service_date: string;
  unit: string;
  quantity: string;
  unit_price: string;
  amount?: string;
  vat_amount: string;
}

export interface ActParty {
  name: string;
  identifier_label: string;
  identifier: string;
  address: string | null;
  iban?: string | null;
}

export interface ActDocument {
  act_number: string;
  act_date: string;
  executor: ActParty;
  customer: ActParty;
  contract_number: string | null;
  line_items: ActLineItem[];
  total_quantity: string;
  total_amount: string;
  total_vat: string;
  total_amount_words: string;
  currency: string;
}

export interface SetupInitPayload {
  username: string;
  password: string;
  hotel_name: string;
  hotel_city: string;
  room_numbers: string[];
}

export type Workplace = "letnik" | "bar" | "banquet";

export interface Employee {
  id: number;
  full_name: string;
  position: string;
  hourly_rate: string;
  created_at: string;
  updated_at: string;
}

export interface TimesheetShift {
  id: number;
  employee_id: number;
  employee_name: string;
  position: string;
  work_date: string;
  start_time: string;
  end_time: string;
  workplace: Workplace;
  hourly_rate: string;
  hours_worked: string;
  earnings: string;
  created_at: string;
  updated_at: string;
}

export interface TimesheetDaySummary {
  work_date: string;
  total_hours: string;
  total_salary: string;
  shifts: TimesheetShift[];
}

export interface EmployeeWeekStat {
  employee_id: number;
  employee_name: string;
  position: string;
  shifts_count: number;
  total_hours: string;
  total_salary: string;
}

export interface TimesheetWeekSummary {
  date_from: string;
  date_to: string;
  total_hours: string;
  total_salary: string;
  shifts: TimesheetShift[];
  by_employee: EmployeeWeekStat[];
}
