import api from './axiosInstance';
import type { Assignment, Question } from './assignments';
import { auth } from '../firebaseConfig'; // <-- Import Firebase auth

const API_URL = '/api/assignments'; 

// --- UPDATED HELPER FUNCTION ---
const getAuthHeaders = async () => {
  // 1. Wait for Firebase to finish checking the local session
  await new Promise((resolve) => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      unsubscribe(); // Stop listening once we get the initial state
      resolve(user);
    });
  });

  // 2. Now we can safely grab the user
  const user = auth.currentUser;
  
  if (user) {
    const token = await user.getIdToken();
    return { Authorization: `Bearer ${token}` };
  }
  
  // 3. Fallback for your local development (just in case)
  const devToken = localStorage.getItem('firebase_dev_token');
  if (devToken) {
    return { Authorization: `Bearer ${devToken}` };
  }
  
  return {};
};

export const assignmentService = {

  // Fetch Assignments
  getAssignments: async (teacherId?: number) => {
    const headers = await getAuthHeaders(); // <-- Waits for token securely
    
    const url = teacherId
      ? `${API_URL}/teacher/?teacher_id=${teacherId}`
      : `${API_URL}/teacher/`;
      
    const response = await api.get(url, { headers }); 
    return response.data.assignments;
  },

  // Create an Assignment
  createAssignment: async (assignment: Assignment, questions: Question[]) => {
    const authHeaders = await getAuthHeaders(); // <-- Waits for token securely
    const formData = new FormData();

    Object.keys(assignment).forEach(key => {
      const value = assignment[key as keyof Assignment];
      if (value !== undefined && value !== null) {
        if (key === 'teacher_attachment' && value instanceof File) {
          formData.append(key, value);
        } else {
          formData.append(key, value.toString());
        }
      }
    });

    formData.append('questions', JSON.stringify(questions));

    const response = await api.post(`${API_URL}/teacher/`, formData, {
      headers: {
        ...authHeaders, 
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  // --- NEW: Fetch a Single Assignment by ID ---
  getAssignmentById: async (id: string | number) => {
    const headers = await getAuthHeaders();
    const response = await api.get(`${API_URL}/teacher/${id}/`, { headers });
    return response.data.data; // Navigates through the {"status": "success", "data": {...}} wrapper
  },

  // --- NEW: Update an Existing Assignment ---
  updateAssignment: async (id: string | number, assignment: Partial<Assignment>, questions: Question[]) => {
    const authHeaders = await getAuthHeaders();
    const formData = new FormData();

    Object.keys(assignment).forEach(key => {
      const value = assignment[key as keyof Assignment];
      // Skip appending if undefined to let the backend fallback logic handle it
      if (value !== undefined && value !== null) {
        if (key === 'teacher_attachment' && value instanceof File) {
          formData.append(key, value);
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
      headers: {
        ...authHeaders, 
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  }
};