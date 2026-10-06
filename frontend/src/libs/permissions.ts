import { useOutletContext } from 'react-router-dom';
import type { DashboardContextType } from '../layouts/DashboardLayouts';

// The one place a page asks "may this user do X?". Every dashboard's layout fetches the
// logged-in user's RBAC permission codes (Roles & Permissions -> /api/my-profile/), keeps
// them current (see DashboardLayouts.tsx: pushed on change, re-read on focus and on a timer),
// and hands them down through the router's outlet context. So a page inside ANY dashboard gets
// the same answer from the same source, and it updates when an admin changes the user's roles.
//
// Prefer this over checking a `role` prop or sniffing the URL: those only say which dashboard
// you are in, not what the user's assigned roles actually allow -- and they drift from what
// the backend enforces. Student and parent accounts don't hold RBAC roles; their access is
// ownership-based (own data / linked children) and enforced server-side, so don't gate their
// pages with this.

export function hasPermission(permissions: string[], code: string): boolean {
  return permissions.includes(code);
}

export function hasAnyPermission(permissions: string[], codes: readonly string[]): boolean {
  return codes.some((code) => permissions.includes(code));
}

export function useAccess() {
  const { role, permissions } = useOutletContext<DashboardContextType>();
  return {
    role,
    permissions,
    can: (code: string) => hasPermission(permissions, code),
    canAny: (...codes: string[]) => hasAnyPermission(permissions, codes),
  };
}
