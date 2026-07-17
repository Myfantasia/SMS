import api from './axiosInstance';
import type { Assignment, Question } from './assignments';

const API_URL = '/api/assignments';

// --- NEW UTILITY HELPER: Extracts CSRF tokens from cookies ---
export const getCSRFToken = (): string => {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; csrftoken=`);
  if (parts.length === 2) return parts.pop()?.split(';').shift() || '';
  return '';
};

// Keys whose values are arrays/objects and must be JSON-stringified rather than .toString()'d
const JSON_FIELDS = new Set([
  'groups', 'reference_links', 'assigned_student_ids', 'additional_class_stream_ids', 'removed_attachment_ids'
]);

// Keys that are backend-computed/read-only and should never be sent back up
const SKIP_FIELDS = new Set(['attachments', 'teacher_attachment_url']);

const appendAssignmentFormData = (formData: FormData, assignment: Partial<Assignment>) => {
  Object.keys(assignment).forEach(key => {
    if (SKIP_FIELDS.has(key)) return;
    const value = assignment[key as keyof Assignment];
    if (value === undefined || value === null) return;

    if (key === 'teacher_attachment' && value instanceof File) {
      formData.append(key, value);
    } else if (key === 'additional_attachments' && Array.isArray(value)) {
      (value as File[]).forEach(file => formData.append('additional_attachments', file));
    } else if (JSON_FIELDS.has(key)) {
      formData.append(key, JSON.stringify(value));
    } else {
      formData.append(key, value.toString());
    }
  });
};

export const assignmentService = {

  // Fetch Assignments
  getAssignments: async (teacherId?: number) => {
    const url = teacherId
      ? `${API_URL}/teacher/?teacher_id=${teacherId}`
      : `${API_URL}/teacher/`;

    const response = await api.get(url);
    return response.data.assignments;
  },

  // Delete an Assignment
  deleteAssignment: async (id: string | number) => {
    const response = await api.delete(`${API_URL}/teacher/${id}/`, {
      headers: { 'X-CSRFToken': getCSRFToken() },
    });
    return response.data;
  },

  // Create an Assignment
  createAssignment: async (assignment: Assignment, questions: Question[]) => {
    const formData = new FormData();

    appendAssignmentFormData(formData, assignment);
    formData.append('questions', JSON.stringify(questions));

    const response = await api.post(`${API_URL}/teacher/`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
        'X-CSRFToken': getCSRFToken(),
      },
    });
    return response.data;
  },

  // --- NEW: Fetch a Single Assignment by ID ---
  getAssignmentById: async (id: string | number) => {
    const response = await api.get(`${API_URL}/teacher/${id}/`);
    return response.data.data; // Navigates through the {"status": "success", "data": {...}} wrapper
  },

  // Lightweight roster for the "specific students" / "group member" pickers
  getStudentsForStream: async (classStreamId: number | string): Promise<{ id: number; name: string; roll: string }[]> => {
    const response = await api.get(`${API_URL}/class-stream/${classStreamId}/students/`);
    return response.data.students;
  },

  // --- NEW: Update an Existing Assignment ---
  updateAssignment: async (id: string | number, assignment: Partial<Assignment>, questions: Question[]) => {
    const formData = new FormData();

    Object.keys(assignment).forEach(key => {
      if (SKIP_FIELDS.has(key)) return;
      const value = assignment[key as keyof Assignment];
      // Skip appending if undefined to let the backend fallback logic handle it
      if (value !== undefined && value !== null) {
        if (key === 'teacher_attachment' && value instanceof File) {
          formData.append(key, value);
        } else if (key === 'additional_attachments' && Array.isArray(value)) {
          (value as File[]).forEach(file => formData.append('additional_attachments', file));
        } else if (JSON_FIELDS.has(key)) {
          formData.append(key, JSON.stringify(value));
        } else {
          formData.append(key, value.toString());
        }
      } else if (value === null) {
         // Explicitly send an empty string so Django knows to clear the field (turned into None by our safe_db_val)
         formData.append(key, '');
      }
    });

    formData.append('questions', JSON.stringify(questions));

    const response = await api.put(`${API_URL}/teacher/${id}/`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  }
};