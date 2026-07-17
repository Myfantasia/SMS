import { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import api from '../../libs/axiosInstance';
import type { IParticipant } from '../../libs/chat';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  threadId: string | null;
  threadName: string;
}

const ROLE_PILL_STYLES: Record<string, string> = {
  Admin: 'bg-orange-100 text-orange-700',
  Teacher: 'bg-blue-100 text-blue-700',
  Parent: 'bg-emerald-100 text-emerald-700',
  Student: 'bg-purple-100 text-purple-700',
};

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
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col max-h-[75vh]">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between shrink-0 bg-slate-50">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Participants</h2>
            <p className="text-xs text-slate-500 truncate max-w-64">{threadName}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close modal" className="p-1 text-slate-400 hover:text-slate-600 rounded-full">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
            </div>
          ) : participants.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">No participants found.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {participants.map(p => (
                <li key={p.user_id} className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-sm font-medium text-slate-700">{p.name}</span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${ROLE_PILL_STYLES[p.role] || 'bg-slate-100 text-slate-600'}`}>
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
