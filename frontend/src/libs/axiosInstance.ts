import axios from 'axios';
import { clearActivity, SIGN_IN_URL } from './sessionExpiry';

const api = axios.create({
  baseURL: 'http://localhost:8000', // Points to your Django backend
  withCredentials: true,            // This is the magic key for Django Auth!
  xsrfCookieName: 'csrftoken',      // The name of the cookie Django sets
  xsrfHeaderName: 'X-CSRFToken',
});

// A 401 means the Django session has gone idle (or was otherwise invalidated) — send the
// user back to sign in instead of leaving them stuck on a broken dashboard. Note: success
// responses deliberately do NOT count as activity here — background/mount-time fetches
// (chat token exchange, notification polling, etc.) aren't real user activity, and would
// otherwise silently keep an idle session alive. Only genuine interaction (tracked in
// DashboardLayouts.tsx) resets the idle clock.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      clearActivity();
      window.location.href = SIGN_IN_URL;
    }
    return Promise.reject(error);
  }
);

export default api;
