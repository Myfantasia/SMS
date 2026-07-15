export interface QuestionOption {
  id?: number;
  option_text: string;
  is_correct: boolean;
}

export interface RubricCriterion {
  id?: number;
  criterion_text: string;
  max_points: number;
  score?: number; // populated when returned as part of a graded answer
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
  rubric_criteria?: RubricCriterion[];
}

export interface ReferenceLink {
  label: string;
  url: string;
}

export interface AssignmentGroup {
  id?: number;
  name: string;
  member_ids: number[];
}

export interface AssignmentAttachment {
  id: number;
  label: string;
  url: string;
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
  grade?: string;        // <-- NEW: Accommodates backend data tracking for your dashboard column
  stream?: string;
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

  // --- Submission rules ---
  allow_resubmission?: boolean;
  max_attempts?: number;
  late_penalty_percent?: number;
  is_group_assignment?: boolean;
  groups?: AssignmentGroup[];

  // --- Targeting & visibility ---
  assigned_student_ids?: number[];
  additional_class_stream_ids?: number[];

  // --- Richer content ---
  reference_links?: ReferenceLink[];
  reference_notes?: string | null;
  additional_attachments?: File[]; // new files staged for upload
  attachments?: AssignmentAttachment[]; // already-uploaded, from backend
  removed_attachment_ids?: number[];
}

export interface SubmissionRosterRow {
  id: number | null;
  student_id: number;
  student_name: string;
  student_roll: string;
  status: string;
  submitted_at: string | null;
  is_late: boolean;
  attempt_number: number;
  score: number;
  max_score: number;
  attachment_url: string | null;
  teacher_feedback: string;
  group_name: string | null;
}

export interface SubmissionRoster {
  assignment_title: string;
  is_group_assignment: boolean;
  submissions: SubmissionRosterRow[];
}

export interface CriterionScorePayload {
  criterion_id: number;
  score: number;
}

export interface ZippedQuestion {
  question_id: number;
  question_text: string;
  question_type: Question['question_type'];
  is_auto_graded: boolean;
  max_score: number;
  correct_answer: string | null;
  answer_id: number | null;
  student_text_answer: string;
  student_selected_options: number[];
  awarded_score: number;
  teacher_comment: string;
  teacher_corrected_text: string;
  rubric_criteria: RubricCriterion[];
}

export interface SubmissionDetail {
  submission_id: number;
  student_name: string;
  status: string;
  is_late: boolean;
  attempt_number: number;
  submitted_at: string | null;
  overall_feedback: string;
  total_awarded_score: number;
  total_max_score: number;
  student_attachment: string | null;
  teacher_returned_file: string | null;
  is_group_assignment: boolean;
  group_name: string | null;
  questions_zipped: ZippedQuestion[];
}

export interface BoardItem {
  id: number;
  title: string;
  subject: string;
  due_date: string | null;
  is_quiz: boolean;
  duration_minutes: number | null;
  is_locked: boolean;
  student_status: string;
  awarded_score: number;
  total_score: number;
  teacher_attachment: string | null;
  allow_resubmission: boolean;
  max_attempts: number;
  attempt_number: number;
  is_submitted: boolean;
  is_group_assignment: boolean;
  reference_notes: string | null;
  reference_links: ReferenceLink[];
}

export interface ReviewAnswer {
  question_text: string;
  question_type: Question['question_type'];
  max_score: number;
  awarded_score: number;
  student_text_answer: string | null;
  student_selected_options: string[];
  correct_answer: string | null;
  teacher_comment: string | null;
  teacher_corrected_text: string | null;
  criterion_scores: { criterion_text: string; max_points: number; score: number }[];
}

export interface ReviewData {
  assignment_title: string;
  total_awarded_score: number;
  total_max_score: number;
  overall_feedback: string | null;
  is_late: boolean;
  submitted_at: string | null;
  teacher_attachment: string | null;
  student_attachment: string | null;
  teacher_returned_file: string | null;
  detailed_answers: ReviewAnswer[];
}

export interface TakerOption {
  id: number;
  option_text: string;
}

export interface TakerQuestion {
  id: number;
  question_text: string;
  question_type: Question['question_type'];
  max_score: number;
  required_answers: number | null;
  options: TakerOption[];
}

export interface ExistingAnswer {
  question_id: number;
  text_answer: string | null;
  selected_options: number[];
}

export interface TakerAssignment {
  id: number;
  title: string;
  subject: string;
  teacher_attachment: string | null;
  reference_notes: string | null;
  reference_links: ReferenceLink[];
  is_quiz: boolean;
  duration_minutes: number | null;
  due_date: string | null;
  cutoff_date: string | null;
  allow_resubmission: boolean;
  max_attempts: number;
  attempt_number: number;
  already_submitted: boolean;
  grading_status: string | null;
  started_at: string | null;
  student_attachment: string | null;
  is_group_assignment: boolean;
  group_name: string | null;
  questions: TakerQuestion[];
  existing_answers: ExistingAnswer[];
}

export interface ParentAlert {
  student_id: number;
  student_name: string;
  assignment_id: number;
  assignment_title: string;
  subject: string;
  alert_type: string;
  score: number | null;
  submitted_at: string;
}
