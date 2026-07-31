import { useState, useEffect } from 'react';
import { Search, X, Loader2, Check, Users } from 'lucide-react';
import { useChat } from './ChatProvider';
import toast from 'react-hot-toast';
import type { IUserSearchResult } from '../../libs/chat';
import api from '../../libs/axiosInstance';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  mode: 'Group' | 'Broadcast';
}

export default function AdminGroupModal({ isOpen, onClose, mode }: Props) {
  const { setActiveThread, refreshInbox } = useChat();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<IUserSearchResult[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<IUserSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // --- NEW: COHORT SELECTION STATE ---
  const [filterMode, setFilterMode] = useState<'name' | 'class'>('name');
  const [academicData, setAcademicData] = useState<any[]>([]);
  const [isFetchingCohort, setIsFetchingCohort] = useState(false);

  // 1. Debounced Text Search (Existing)
  useEffect(() => {
    if (query.trim().length < 2 || filterMode !== 'name') { setResults([]); return; }
    const delay = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await api.get(`/api/chat/search/?q=${query}`);
        setResults(res.data.results);
      } catch (e) {} finally { setIsSearching(false); }
    }, 300);
    return () => clearTimeout(delay);
  }, [query, filterMode]);

  // 2. Fetch Classes for Dropdown (New)
  useEffect(() => {
    if (filterMode === 'class' && academicData.length === 0) {
      api.get('/api/academic-hub/').then(res => {
        if (res.data.status === 'success') {
          setAcademicData(res.data.data.classes);
        }
      }).catch(err => console.error("Failed to load classes", err));
    }
  }, [filterMode, academicData.length]);

  const toggleUserSelection = (user: IUserSearchResult) => {
    const isSelected = selectedUsers.some(u => u.user_id === user.user_id);
    if (isSelected) {
      setSelectedUsers(prev => prev.filter(u => u.user_id !== user.user_id));
    } else {
      setSelectedUsers(prev => [...prev, user]);
    }
  };

  // 3. Bulk Add Parents (New)
  const handleSelectClass = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const streamId = e.target.value;
    if (!streamId) return;

    setIsFetchingCohort(true);
    try {
      const res = await api.get(`/api/chat/class-parents/${streamId}/`);
      const parents = res.data.results;
      
      // Bulk add parents, safely avoiding duplicates
      setSelectedUsers(prev => {
        const newUsers = [...prev];
        parents.forEach((parent: IUserSearchResult) => {
          if (!newUsers.some(u => u.user_id === parent.user_id)) {
            newUsers.push(parent);
          }
        });
        return newUsers;
      });
      
      toast.success(`Added ${res.data.parent_count} parents from ${res.data.stream_name}`);
      e.target.value = ''; // Reset dropdown so they can pick another class
    } catch (error) {
      console.error("Failed to fetch parents for class:", error);
      toast.error("Failed to load parents for this class.");
    } finally {
      setIsFetchingCohort(false);
    }
  };

  const handleCreateMultiUserThread = async () => {
    if (selectedUsers.length === 0) return;
    setIsCreating(true);
    
    try {
      const response = await api.post('/api/chat/admin/group/', {
        thread_type: mode,
        target_user_ids: selectedUsers.map(u => u.user_id)
      });
      
      await refreshInbox();
      setActiveThread(response.data.thread_id);
      toast.success(`${mode} created with ${response.data.participant_count} members!`);
      
      setSelectedUsers([]);
      setQuery('');
      onClose();
    } catch (error) {
      console.error(`Failed to create ${mode}:`, error);
      toast.error(`Failed to create ${mode}.`);
    } finally {
      setIsCreating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
        
        {/* Header */}
        <div className={`p-4 border-b border-slate-100 flex items-center justify-between shrink-0 ${mode === 'Broadcast' ? 'bg-orange-50' : 'bg-slate-50'}`}>
          <div>
            <h2 className="text-lg font-bold text-slate-800">New {mode}</h2>
            <p className="text-xs text-slate-500">
              {mode === 'Broadcast' ? 'Members cannot reply to this message.' : 'All members can chat with each other.'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close modal" className="p-1 text-slate-400 hover:text-slate-600 rounded-full">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Selected Users "Pills" */}
        {selectedUsers.length > 0 && (
          <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap gap-2 max-h-32 overflow-y-auto shrink-0">
            {selectedUsers.map(user => (
              <span key={user.user_id} className="inline-flex items-center gap-1 px-2 py-1 bg-white border border-slate-300 rounded-full text-xs font-medium text-slate-700">
                {user.name}
                <button type="button" onClick={() => toggleUserSelection(user)} className="text-slate-400 hover:text-red-500" aria-label={`Remove ${user.name}`}>
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* --- NEW: MODE TOGGLE --- */}
        <div className="px-4 pt-4 shrink-0">
          <div className="flex bg-slate-100 p-1 rounded-lg">
            <button 
              className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-all flex items-center justify-center gap-2 ${filterMode === 'name' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
              onClick={() => { setFilterMode('name'); setResults([]); }}
            >
              <Search className="w-3.5 h-3.5" /> By Name
            </button>
            <button 
              className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-all flex items-center justify-center gap-2 ${filterMode === 'class' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
              onClick={() => { setFilterMode('class'); setQuery(''); setResults([]); }}
            >
              <Users className="w-3.5 h-3.5" /> By Class Parents
            </button>
          </div>
        </div>

        {/* Search / Select Input */}
        <div className="p-4 border-b border-slate-100 shrink-0">
          {filterMode === 'name' ? (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search users to add..." 
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 bg-slate-100 border-none rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          ) : (
            <div className="relative">
              <select 
                onChange={handleSelectClass}
                disabled={isFetchingCohort}
                className="w-full px-4 py-2.5 bg-slate-100 border-none rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none disabled:opacity-50 font-medium text-slate-700"
                defaultValue=""
              >
                <option value="" disabled>Select a class to instantly add all parents...</option>
                {academicData.map((grade: any) => (
                  <optgroup key={grade.id} label={grade.grade_name}>
                    {grade.streams.map((stream: any) => (
                      <option key={stream.id} value={stream.id}>
                        {stream.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {isFetchingCohort && <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-600 animate-spin" />}
            </div>
          )}
        </div>

        {/* Results Area (Only shows when in 'name' mode and searching) */}
        <div className="flex-1 overflow-y-auto p-2 min-h-50">
          {filterMode === 'class' && selectedUsers.length === 0 && !isFetchingCohort && (
            <div className="flex items-center justify-center h-full text-sm text-slate-400 text-center px-8">
              Select a class above to instantly gather all associated parents.
            </div>
          )}

          {results.map((user) => {
            const isSelected = selectedUsers.some(u => u.user_id === user.user_id);
            return (
              <button 
                key={user.user_id}
                onClick={() => toggleUserSelection(user)}
                className="w-full flex items-center justify-between p-3 hover:bg-slate-50 rounded-lg transition-colors text-left"
                aria-label={`Toggle selection for ${user.name}`}
              >
                <div>
                  <p className="font-semibold text-slate-700 text-sm">{user.name}</p>
                  <p className="text-xs text-slate-500 capitalize">{user.role}</p>
                </div>
                <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${isSelected ? 'bg-blue-600 border-blue-600' : 'border-slate-300'}`}>
                  {isSelected && <Check className="w-3 h-3 text-white" />}
                </div>
              </button>
            )
          })}
        </div>

        {/* Footer Action Button */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end shrink-0">
          <button
            disabled={selectedUsers.length === 0 || isCreating}
            onClick={handleCreateMultiUserThread}
            className={`px-6 py-2 rounded-lg font-bold text-white transition-all shadow-sm flex items-center gap-2 active:scale-95
              ${selectedUsers.length === 0 ? 'bg-slate-300 cursor-not-allowed' : mode === 'Broadcast' ? 'bg-orange-600 hover:bg-orange-700' : 'bg-blue-600 hover:bg-blue-700'}
            `}
          >
            {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Create {mode} ({selectedUsers.length})
          </button>
        </div>
      </div>
    </div>
  );
}