// Core Entity Types
export interface Grade {
  id: number;
  name: string;
}

export interface Subject {
  id: number;
  name: string;
}

export interface Teacher {
  id: number;
  name: string;
}

export interface ClassStream {
  id: number;
  name: string;
  grade_name: string;
}

// Timetable and Scheduling Types
export interface Timetable {
  id: number;
  name: string;
  status?: string;
  is_active: boolean;
}

export interface TimeSlot {
  id: number;
  day: string;
  start_time: string;
  end_time: string;
  is_global: boolean;
  global_label: string;
  is_remedial: boolean;
}

export interface Lesson {
  id: number;
  time_slot_id: number;
  subject_name: string;
  teacher_name: string;
  is_double?: boolean;
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
}

export interface Bucket {
  subject_id: number;
  subject_name: string;
  total_required: number;
  already_scheduled: number;
  remaining: number;
  double_required: number;
}



export interface EligibleTeacher {
  id: number;
  name: string;
  current_load: number; // The workload indicator we built in Django
}

export interface MatrixRow {
  subject_id: number;
  subject_name: string;
  subject_code: string;
  block_name: string; // e.g., "Core Subject" or "G10-Humanities-Block"
  eligible_teachers: EligibleTeacher[];
  assigned_teacher_id: number | string; // number if assigned, "" if empty
  
  // Optional status field for when the Auto-Allocate algorithm returns results
  status?: "Success" | "Failed: No eligible teachers without breaking workload rules." | null;
}

export interface AllocationPayload {
  subject_id: number;
  teacher_id: number | string;
}