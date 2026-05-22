import { useState, useEffect } from 'react';
import { Search, X, Loader2, User as UserIcon, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import type { IUserSearchResult } from '../../libs/chat';
import { useChat } from './ChatProvider';
import api from '../../libs/axiosInstance';


interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function SearchDirectoryModal({ isOpen, onClose }: Props) {
  const { setActiveThread, refreshInbox } = useChat();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<IUserSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // Debounced Search Effect
  useEffect(() => {
    // We wait for 2 characters before searching to prevent database spam
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }

    const delayDebounceFn = setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await api.get(`/api/chat/search/?q=${query}`);
        setResults(response.data.results);
      } catch (error) {
        console.error("Failed to search directory:", error);
        toast.error("Failed to search directory.");
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [query]);

  const handleStartChat = async (targetUserId: number) => {
    setIsCreating(true);
    try {
      const response = await api.post('/api/chat/direct/', {
        target_user_id: targetUserId
      });
      
      await refreshInbox();
      setActiveThread(response.data.thread_id);
      
      if (response.data.is_new) {
        toast.success(`Chat started with ${response.data.target_name}`);
      }
      
      onClose();
    } catch (error) {
      console.error("Failed to start chat:", error);
      toast.error("Could not start conversation.");
    } finally {
      setIsCreating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[80vh]">
        
        {/* Header */}
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Secure Directory Search</h2>
            {/* Reassuring the user about our strict backend rules */}
            <p className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
              <ShieldCheck className="w-3 h-3 text-emerald-500" />
              Results securely filtered by your role permissions.
            </p>
          </div>
          <button onClick={onClose} title="Close" aria-label="Close search modal" className="p-1 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Input */}
        <div className="p-4 border-b border-slate-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              autoFocus
              // Updated Placeholder to guide the user
              placeholder="Search by name, admission ID, or email..." 
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 bg-slate-100 border-none rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700"
            />
          </div>
        </div>

        {/* Results Area */}
        <div className="flex-1 overflow-y-auto p-2">
          {isSearching ? (
            <div className="flex flex-col items-center justify-center py-8 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin mb-2" />
              <p className="text-sm">Scanning secure directory...</p>
            </div>
          ) : results.length > 0 ? (
            <ul className="space-y-1">
              {results.map((user) => (
                <li key={user.user_id}>
                  <button 
                    onClick={() => handleStartChat(user.user_id)}
                    disabled={isCreating}
                    className="w-full flex items-center gap-3 p-3 hover:bg-blue-50 rounded-lg transition-colors text-left"
                  >
                    <div className="w-10 h-10 shrink-0 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                      <UserIcon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-700 text-sm truncate">{user.name}</p>
                      {/* Showing the email/ID under the name so they know they clicked the right person */}
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] font-bold text-white bg-slate-400 px-1.5 py-0.5 rounded uppercase">
                          {user.role}
                        </span>
                        <span className="text-xs text-slate-500 truncate">{user.email}</span>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : query.length >= 2 ? (
            <div className="text-center py-8 text-slate-500 text-sm">
              No authorized users found matching "{query}".
            </div>
          ) : (
            <div className="text-center py-8 text-slate-400 text-sm">
              Enter a name, staff ID, or admission number to begin.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}