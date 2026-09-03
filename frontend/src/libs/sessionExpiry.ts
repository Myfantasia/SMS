// Mirrors the backend's sliding SESSION_COOKIE_AGE (schoolmanagement/settings.py,
// SESSION_SAVE_EVERY_REQUEST=True) so the SPA can proactively sign an idle tab out
// instead of waiting for the next API call to fail with a 401. The clock resets on
// every recorded activity — it's an idle timeout, not a fixed time-since-login.
const LAST_ACTIVITY_KEY = 'sms_last_activity_at';
const IDLE_LIMIT_MS = 3 * 60 * 60 * 1000; // 3 hours
export const SIGN_IN_URL = 'http://localhost:5173/portal';

// Idle expiry must go through the real logout endpoint, not straight to the portal: the
// Django session (SESSION_SAVE_EVERY_REQUEST=True) only renews on requests, so a stray
// background request (chat polling, etc.) unrelated to genuine user activity can keep it
// alive server-side even after the client's own activity-based clock calls it idle. Hitting
// /portal directly in that case would just bounce back to the dashboard, since the server
// still considers the session valid. /logout unconditionally terminates it either way.
const IDLE_SIGN_OUT_URL = 'http://localhost:8000/logout';

export function recordActivity() {
  localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
}

export function clearActivity() {
  localStorage.removeItem(LAST_ACTIVITY_KEY);
}

export function isSessionExpired(): boolean {
  const lastActivity = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
  return !!lastActivity && Date.now() - lastActivity >= IDLE_LIMIT_MS;
}

// Signs the user out once 3 hours have passed with no recorded activity.
export function redirectToSignInIfSessionExpired(): boolean {
  if (isSessionExpired()) {
    clearActivity();
    window.location.href = IDLE_SIGN_OUT_URL;
    return true;
  }
  return false;
}
