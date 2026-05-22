// src/types/assignments.ts

export interface QuestionOption {
  id?: number;
  option_text: string;
  is_correct: boolean;
}

export interface Question {
  id?: number;
  question_text: string;
  question_type: 'MCQ' | 'SHORT_ANSWER' | 'ESSAY' | 'FILE_UPLOAD' | 'CHECKBOX';
  is_auto_graded: boolean;
  max_score: number;
  exact_match_answer?: string | null;
  options?: QuestionOption[];
  required_answers?: number;
}

export interface Assignment {
  id?: number;
  title: string;
  assignment_type: 'Holiday' | 'In-Term';
  teacher_id: number | string;
  teacher_name?: string; // Appended by backend for Admin view
  subject_id: number | string;
  subject?: string;
  class_stream_id: number | string;
  class_name?: string;
  term_id?: number | null;
  curriculum_type: 'CBC' | '8-4-4';
  strand_name?: string | null;
  sub_strand_id?: number | null;
  publish_date: string; // ISO String
  due_date: string;     // ISO String
  cutoff_date: string;  // ISO String
  is_quiz: boolean;
  duration_minutes?: number | null;
  status: 'Draft' | 'Published' | 'Closed';
  total_max_score?: number;
  teacher_attachment?: File | null; // For the file upload feature
  teacher_attachment_url?: string | null; // URL from backend
}