import api from './axiosInstance';
import { getCSRFToken } from './assignmentService';
import type { BoardItem, ReviewData, TakerAssignment } from './assignments';

const API_URL = '/api/assignments';

export interface AnswerPayload {
  question_id: number;
  text_answer?: string;
  selected_options?: number[];
}

export const studentAssignmentService = {
  // The logged-in student's own profile is resolved server-side, so no student_id is needed here.
  getBoard: async (): Promise<BoardItem[]> => {
    const response = await api.get(`${API_URL}/student/board/`);
    return response.data.board;
  },

  getAssignmentDetail: async (assignmentId: number | string): Promise<TakerAssignment> => {
    const response = await api.get(`${API_URL}/student/${assignmentId}/`);
    return response.data.assignment;
  },

  startQuiz: async (assignmentId: number | string) => {
    const response = await api.post(`${API_URL}/student/quiz/start/`, { assignment_id: assignmentId }, {
      headers: { 'X-CSRFToken': getCSRFToken() },
    });
    return response.data;
  },

  submitAssignment: async (assignmentId: number | string, answers: AnswerPayload[], file?: File | null) => {
    const formData = new FormData();
    formData.append('assignment_id', assignmentId.toString());
    formData.append('answers', JSON.stringify(answers));
    if (file) formData.append('student_attachment', file);

    const response = await api.post(`${API_URL}/student/submit/`, formData, {
      headers: { 'Content-Type': 'multipart/form-data', 'X-CSRFToken': getCSRFToken() },
    });
    return response.data;
  },

  getReview: async (assignmentId: number | string): Promise<ReviewData> => {
    const response = await api.get(`${API_URL}/student/review/`, {
      params: { assignment_id: assignmentId },
    });
    return response.data.review;
  },
};
