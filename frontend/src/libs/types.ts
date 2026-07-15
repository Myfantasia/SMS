// Core Entity Types
export interface Grade {
  id: number;
  name: string;
}

export interface Subject {
  id: number;
  name: string;
  code?: string;
  department?: string;
  allow_double_periods?: boolean;
  earliest_allowed_time?: string | null;
}

export interface Teacher {
  id: number;
  name: string;
  department?: string;
  current_load: number;
  max_weekly_lessons: number;
  status: boolean;
}

export interface ClassStream {
  id: number;
  name: string;
  grade_name: string;
}

// Timetable and Scheduling Containers
export interface Timetable {
  id: number;
  name: string;
  status: 'Draft' | 'Published';
  is_active: boolean;
  academic_year_id?: number;
  term_id?: number;
}

export interface TimeSlot {
  id: number;
  day: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';
  start_time: string; // HH:MM
  end_time: string;   // HH:MM
  is_global: boolean;
  global_label: string | null;
  is_remedial: boolean;
}

export interface Lesson {
  id: number;
  time_slot_id: number;
  subject_name: string;
  teacher_name: string;
  is_double: boolean;
  subject_block_id: number | null;     // Replaces frontend string hacking
  subject_block_name: number | string | null;
}

export interface DailyCoverEntry {
  id: number;
  date: string;
  target_lesson_id: number;
  time_slot_id: number;
  class_stream_id: number;
  class_stream_name: string;
  subject_name: string;
  absent_teacher_id: number;
  absent_teacher_name: string;
  covering_teacher_id: number;
  covering_teacher_name: string;
  notes: string;
}

// Quota and Scheduling Requirements
export interface Quota {
  id: number;
  grade_id: number;
  grade__name: string;
  subject_id: number;
  subject__name: string;
  total_lessons: number;
  double_lessons_required: number;
  remedial_lessons_required: number;
  // Grade-scoped: the same subject can sit in a different block per grade,
  // so this is resolved per (grade_id, subject_id), not off the subject alone.
  subject_block_id?: number | null;
}

export interface Bucket {
  subject_id: number;
  subject_name: string;
  total_required: number;
  already_scheduled: number;
  remaining: number;
  double_required: number;
}

// Interactive Matrix and Load Tracking Types
export interface EligibleTeacher {
  id: number;
  name: string;
  current_load: number;
  max_weekly_lessons: number; // Linked directly to GlobalAllocationPolicy validation
}

export interface MatrixRow {
  subject_id: number;
  subject_name: string;
  subject_code: string;
  block_name: string; // e.g., "Core Subject" or "G10-Humanities-Block"
  eligible_teachers: EligibleTeacher[];
  assigned_teacher_id: number | string;
  status?: "Success" | "Failed: No eligible teachers without breaking workload rules." | null;
}

export interface AllocationPayload {
  timetable_id: number;
  class_stream_id: number;
  subject_id: number | string;
  teacher_id: number | string;
  time_slot_id: number;
  is_double_period: boolean;
}

// --- NEW: BACKEND PARITY EXTENSIONS ---

// Dynamic Engine API Response Telemetry
export interface AutoGenerateResponse {
  status: 'success' | 'error';
  message: string;
  unscheduled_basket: string[]; // Feeds the interactive warning tray
  warnings?: string[];         // Catches soft cognitive fatigue flags
}

// Ad-Hoc Substitution Console Tracker
export interface DailyCover {
  id?: number;
  date: string; // YYYY-MM-DD
  target_lesson_id: number;
  absent_teacher_id: number;
  covering_teacher_id: number;
  notes?: string;
}

// Immutable Configuration Audit Trail
export interface SystemAuditLog {
  id: number;
  operator_name: string | null;
  action_type: 'CREATE' | 'UPDATE' | 'EXECUTION' | 'DELETE';
  module: 'ManualGridAllocation' | 'SubjectBlock' | 'RolloverEngine' | 'QuotaEngine';
  description: string;
  timestamp: string;
}

// Advanced Admin Policy Toggles
export interface TimetablePedagogyPolicy {
  max_consecutive_periods: number;
  max_daily_subject_frequency: number;
  min_subject_spacing_periods: number;
  allow_remedial_double_periods: boolean;
  heavy_day_threshold: number;
  prevent_consecutive_heavy_days: boolean;
}

// Attendance
export interface ClassOption {
  id: number;
  name: string;
  is_current_user_class_teacher?: boolean;
}

export interface AttendanceRosterStudent {
  id: number;
  name: string;
  roll: string;
  status: 'Present' | 'Absent' | 'Late' | 'Excused';
  remarks: string;
}

export interface AttendanceRosterData {
  class_stream: { id: number; name: string };
  date: string;
  already_submitted: boolean;
  submitted_by: string | null;
  submitted_at: string | null;
  students: AttendanceRosterStudent[];
}

export interface AttendanceRegisterSummary {
  id: number;
  name: string;
  teacher: string;
  time?: string;
}

export interface AttendanceException {
  id: number;
  student: string;
  class: string;
  status: string;
  remarks: string;
  time: string;
}

export interface AttendanceOverviewData {
  date: string;
  kpis: {
    total_students: number;
    present: number;
    absent: number;
    late: number;
    excused: number;
    total_classes: number;
    submitted_classes: number;
  };
  pending_registers: AttendanceRegisterSummary[];
  submitted_registers: AttendanceRegisterSummary[];
  exceptions: AttendanceException[];
}

export interface GlobalAllocationPolicy {
  enforcement_mode: 'STRICT' | 'SOFT';
  max_weekly_lessons: number;
  max_subjects_per_class: number;
  max_classes_per_subject: number;
  min_classes_per_subject: number;
  enforce_prep_consolidation: boolean;
  allow_cross_grade_teaching: boolean;
  max_total_class_groups: number;
}

// Leave Management
export type LeaveStatus = 'Pending' | 'Approved' | 'Rejected';
export type LeaveType = 'Casual' | 'Sick' | 'Maternity' | 'Seminar' | 'Compassionate';

export interface TeacherLeaveRequest {
  id: number;
  teacher: number;
  teacher_name: string;
  leave_type: LeaveType;
  leave_type_display: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
  status: LeaveStatus;
  status_display: string;
  reason: string | null;
  created_at: string;
  duration_days: number;
  is_long_term: boolean;
  relief_teacher_name: string | null;
}

export interface LeaveStats {
  pending: number;
  approved: number;
  rejected: number;
  total: number;
}

export interface EligibleReliefTeacher {
  id: number;
  name: string;
}