import { createElement } from 'react';
import type { ReactElement } from 'react';
import { Users, Megaphone, User } from 'lucide-react';

export type ThreadType = 'Direct' | 'Group' | 'Broadcast';

// Shared with ChatSidebar (avatar) and ChatWindow (header badge) so both surfaces
// agree on how a thread type looks, rather than duplicating the icon/color mapping.
export function getThreadIcon(type: string): ReactElement {
  switch (type) {
    case 'Group':
      return createElement(Users, { className: 'w-4 h-4 text-indigo-500' });
    case 'Broadcast':
      return createElement(Megaphone, { className: 'w-4 h-4 text-orange-500' });
    default:
      return createElement(User, { className: 'w-4 h-4 text-blue-500' });
  }
}

export function getThreadColor(type: string): string {
  switch (type) {
    case 'Group':
      return 'bg-indigo-100';
    case 'Broadcast':
      return 'bg-orange-100';
    default:
      return 'bg-blue-100';
  }
}

export function getThreadSubtitle(type: string): string {
  switch (type) {
    case 'Group':
      return 'Group Collaboration';
    case 'Broadcast':
      return 'Official Notice';
    default:
      return 'Direct Message';
  }
}

// Direct threads have one real identity to show (the other participant), so their
// avatar renders initials instead of the generic type icon — Group/Broadcast keep
// the icon above since there's no single person to represent.
export function getInitials(name: string): string {
  const cleanName = name.replace(/\s*\(.*?\)\s*/g, ' ').trim(); // strip "(re: X)"-style suffixes
  const parts = cleanName.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Shared with ParticipantsPanel (roster rows) and ChatWindow (message sender tag) so
// a given role always reads as the same color everywhere in the chat UI.
const ROLE_PILL_STYLES: Record<string, string> = {
  Admin: 'bg-orange-100 text-orange-700',
  Teacher: 'bg-blue-100 text-blue-700',
  Parent: 'bg-emerald-100 text-emerald-700',
  Student: 'bg-purple-100 text-purple-700',
};

export function getRolePillClasses(role: string | null | undefined): string {
  return (role && ROLE_PILL_STYLES[role]) || 'bg-slate-100 text-slate-600';
}
