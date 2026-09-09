import axios from 'axios';
import api from '../../libs/axiosInstance';

// Every POST endpoint under /api/public/ accepts multipart/form-data (via FormData) --
// several need file uploads anyway (student/teacher signup photos), so all of them use
// the same body format for consistency rather than splitting JSON vs. multipart per
// endpoint. Matches request.POST/request.FILES on the Django side exactly.
function toFormData(fields: Record<string, unknown>): FormData {
  const data = new FormData();
  Object.entries(fields).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item) => data.append(key, item as string | Blob));
    } else if (value instanceof File) {
      data.append(key, value);
    } else {
      data.append(key, String(value));
    }
  });
  return data;
}

export interface ApiErrorShape {
  status: 'error';
  message?: string;
  field_errors?: Record<string, string[]>;
  needs_verification?: boolean;
  verification_email?: string;
  // Only ever present (and false) on api_password_reset_confirm's error response --
  // signals the reset link itself is invalid/expired, distinct from a validation error.
  valid?: boolean;
}

export type PostLoginDestination =
  | { destination: 'dashboard'; path: string }
  | { destination: 'wait-for-approval'; role: string; visual_icon: string; wait_note: string }
  | { destination: 'external'; url: string }
  | { destination: 'portal' };

// Every form page below catches a failed submit the same way -- this is the one place
// that knows how to safely pull the JSON error body back out of an unknown catch-clause
// value (axios throws on any non-2xx response) without resorting to `any`.
export function parseApiError(err: unknown): ApiErrorShape | undefined {
  return axios.isAxiosError<ApiErrorShape>(err) ? err.response?.data : undefined;
}

// --- Bootstrap / navigation -------------------------------------------------------

export const fetchCsrfCookie = () => api.get('/api/public/csrf/');

export const fetchHome = () => api.get('/api/public/home/');

export const fetchAfterLoginDestination = () =>
  api.get<{ status: string } & PostLoginDestination>('/api/public/afterlogin/');

export const fetchSystemStatus = () => api.get('/api/public/system-status/');

export const fetchBlogPosts = () => api.get('/api/public/blog/');

export const fetchBlogPost = (slug: string) => api.get(`/api/public/blog/${slug}/`);

export const fetchAlumniReviews = () => api.get('/api/public/alumni-reviews/');

export const submitContact = (fields: { Name: string; Email: string; Message: string }) =>
  api.post('/api/public/contact/', toFormData(fields));

// --- Signup ------------------------------------------------------------------------

export const signupAdmin = (fields: Record<string, unknown>) =>
  api.post('/api/public/signup/admin/', toFormData(fields));

export const signupStudent = (fields: Record<string, unknown>) =>
  api.post('/api/public/signup/student/', toFormData(fields));

export const fetchStudentSignupClassStreams = () =>
  api.get('/api/public/signup/student/class-streams/');

export const fetchTeacherSignupSubjects = () => api.get('/api/public/signup/teacher/subjects/');

export const signupTeacher = (fields: Record<string, unknown>) =>
  api.post('/api/public/signup/teacher/', toFormData(fields));

export const fetchStaffSignupRoles = () => api.get('/api/public/signup/staff/roles/');

export const signupStaff = (fields: Record<string, unknown>) =>
  api.post('/api/public/signup/staff/', toFormData(fields));

export const signupParent = (fields: Record<string, unknown>) =>
  api.post('/api/public/signup/parent/', toFormData(fields));

export const searchStudentsForParentSignup = (query: string) =>
  api.get('/api/parentsignup/search-students/', { params: { q: query } });

// --- Login ---------------------------------------------------------------------

export const loginAdmin = (fields: Record<string, unknown>) =>
  api.post('/api/public/login/admin/', toFormData(fields));

export const loginStudent = (fields: { username: string; password: string }) =>
  api.post('/api/public/login/student/', toFormData(fields));

export const loginTeacher = (fields: { email: string; password: string }) =>
  api.post('/api/public/login/teacher/', toFormData(fields));

export const loginParent = (fields: { email: string; password: string }) =>
  api.post('/api/public/login/parent/', toFormData(fields));

export const loginStaff = (fields: { email: string; password: string }) =>
  api.post('/api/public/login/staff/', toFormData(fields));

// --- Password reset ------------------------------------------------------------

export const requestPasswordReset = (email: string) =>
  api.post('/api/public/password-reset/request/', toFormData({ email }));

export const checkPasswordResetToken = (uidb64: string, token: string) =>
  api.get(`/api/public/password-reset/confirm/${uidb64}/${token}/`);

export const submitPasswordReset = (
  uidb64: string,
  token: string,
  fields: { new_password1: string; new_password2: string },
) => api.post(`/api/public/password-reset/confirm/${uidb64}/${token}/`, toFormData(fields));
