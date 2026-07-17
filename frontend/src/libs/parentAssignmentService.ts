import api from './axiosInstance';
import type { BoardItem, ReviewData, ParentAlert } from './assignments';

const API_URL = '/api/assignments';

export const parentAssignmentService = {
  getMonitoring: async (): Promise<ParentAlert[]> => {
    const response = await api.get(`${API_URL}/parent/monitoring/`);
    return response.data.parent_alerts;
  },

  // Reuses the student board endpoint - its permission logic already allows a parent
  // to view a specific one of their own children via the student_id param.
  getBoard: async (childId: number | string): Promise<BoardItem[]> => {
    const response = await api.get(`${API_URL}/student/board/`, {
      params: { student_id: childId },
    });
    return response.data.board;
  },

  getReview: async (childId: number | string, assignmentId: number | string): Promise<ReviewData> => {
    const response = await api.get(`${API_URL}/parent/review/`, {
      params: { student_id: childId, assignment_id: assignmentId },
    });
    return response.data.review;
  },
};
