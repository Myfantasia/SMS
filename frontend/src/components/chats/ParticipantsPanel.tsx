import { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import api from '../../libs/axiosInstance';
import type { IParticipant } from '../../libs/chat';
import { getInitials, getRolePillClasses } from '../../libs/chatDisplay';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  threadId: string | null;
  threadName: string;
}

export default function ParticipantsPanel({ isOpen, onClose, threadId, threadName }: Props) {
  const [participants, setParticipants] = useState<IParticipant[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !threadId) return;

    setIsLoading(true);
    api.get(`/api/chat/participants/${threadId}/`)
      .then(res => setParticipants(res.data.participants))
      .catch(err => console.error('Failed to load participants', err))
      .finally(() => setIsLoading(false));
  }, [isOpen, threadId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl dark:shadow-none w-full max-w-sm overflow-hidden flex flex-col max-h-[75vh]">
        <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between shrink-0 bg-slate-50 dark:bg-slate-800">
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Participants</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-64">{threadName}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close modal" className="p-1 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 rounded-full">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-spin" />
            </div>
          ) : participants.length === 0 ? (
            <div className="p-8 text-center text-slate-400 dark:text-slate-500 text-sm">No participants found.</div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-700">
              {participants.map(p => (
                <li key={p.user_id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="shrink-0 w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center text-[11px] font-semibold">
                    {getInitials(p.name)}
                  </div>
                  <span className="flex-1 text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{p.name}</span>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${getRolePillClasses(p.role)}`}>
                    {p.role}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
