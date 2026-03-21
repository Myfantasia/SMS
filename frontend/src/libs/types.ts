export interface TimeSlot { id: number; day: string; start_time: string; end_time: string; is_global: boolean; global_label: string; is_remedial: boolean; }
export interface Bucket { subject_id: number; subject_name: string; total_required: number; already_scheduled: number; remaining: number; double_required: number; }
export interface Lesson { id: number; time_slot_id: number; subject_name: string; teacher_name: string; is_double?: boolean; }
export interface Teacher { id: number; name: string; }
export interface Timetable { id: number; name: string; status?: string; is_active: boolean; }
export interface ClassStream { id: number; name: string; grade_name: string; }
export interface Grade { id: number; name: string; }
export interface Subject { id: number; name: string; }
export interface Quota { id: number; grade_id: number; grade__name: string; subject_id: number; subject__name: string; total_lessons: number; double_lessons_required: number; remedial_lessons_required: number; }