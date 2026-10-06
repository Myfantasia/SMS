import { useEffect, type ReactNode } from 'react';
import { Navigate, useOutletContext } from 'react-router-dom';
import toast from 'react-hot-toast';
import type { DashboardContextType } from '../../layouts/DashboardLayouts';
import { hasAnyPermission } from '../../libs/permissions';

interface RequirePermissionProps {
  /** The user needs at least one of these codes. */
  code: string | readonly string[];
  children: ReactNode;
}

// Wraps a route element so it is only reachable while the user holds the permission that
// unlocks it. Because the dashboard layout keeps permissions current, this also moves the user
// off a page the moment an admin removes the permission -- instead of leaving them on a screen
// whose every request now fails. (The server enforces permissions regardless; this is the
// user-facing half.) The redirect target is the user's own dashboard home, whichever they're in.
export default function RequirePermission({ code, children }: RequirePermissionProps) {
  const { role, permissions } = useOutletContext<DashboardContextType>();
  const codes = typeof code === 'string' ? [code] : code;
  const allowed = hasAnyPermission(permissions, codes);

  useEffect(() => {
    if (!allowed) toast('That page is no longer available to you.', { icon: 'ℹ️', id: 'permission-redirect' });
  }, [allowed]);

  if (!allowed) return <Navigate to={`/${role}-dashboard`} replace />;
  return <>{children}</>;
}
