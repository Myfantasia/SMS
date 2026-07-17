import { createElement } from 'react';
import type { ReactElement } from 'react';
import { Users, Megaphone, User } from 'lucide-react';

export type ThreadType = 'Direct' | 'Group' | 'Broadcast';

// Shared with ChatSidebar (avatar) and ChatWindow (header badge) so both surfaces
// agree on how a thread type looks, rather than duplicating the icon/color mapping.
export function getThreadIcon(type: string): ReactElement {
  switch (type) {
    case 'Group':
      return createElement(Users, { className: 'w-4 h-4 text-slate-500' });
    case 'Broadcast':
      return createElement(Megaphone, { className: 'w-4 h-4 text-orange-500' });
    default:
      return createElement(User, { className: 'w-4 h-4 text-blue-500' });
  }
}

export function getThreadColor(type: string): string {
  switch (type) {
    case 'Group':
      return 'bg-slate-200';
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
