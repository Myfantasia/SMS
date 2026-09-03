import { useState, useEffect } from 'react';
import { Megaphone, Plus, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import NoticeBoard from './NoticeBoard';
import NoticeFormModal from './NoticeFormModal';
import api from '../../libs/axiosInstance';

interface NoticesHubProps {
  role: 'admin' | 'teacher' | 'student' | 'parent';
}

// 1. Updated to match your exact Django model fields
export interface SchoolNotice {
  id: number;
  title: string;
  message: string;
  date: string;
  by: string;
  audience: string;
  attachment: string | null;
  is_urgent: boolean; // Added to support your urgency requirement
}

export default function NoticesHub({ role }: NoticesHubProps) {
  const [notices, setNotices] = useState<SchoolNotice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  // The board is paginated server-side now (see NoticeViewSet's pagination_class) since
  // it only grows over time — this tracks the "next page" URL DRF hands back so
  // "Load more" can fetch it directly, without re-deriving offsets client-side.
  const [nextPageUrl, setNextPageUrl] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // NEW: State to track which notice we are currently editing
  const [editingNotice, setEditingNotice] = useState<SchoolNotice | null>(null);

  const fetchNotices = async () => {
    setIsLoading(true);
    try {
      const response = await api.get('/api/core/notices/');
      setNotices(response.data.results);
      setNextPageUrl(response.data.next);
    } catch (error) {
      console.error("Error fetching notices:", error);
      toast.error("Failed to load the digital bulletin board.");
    } finally {
      setIsLoading(false);
    }
  };

  const loadMoreNotices = async () => {
    if (!nextPageUrl) return;
    setIsLoadingMore(true);
    try {
      const response = await api.get(nextPageUrl);
      setNotices((prev) => [...prev, ...response.data.results]);
      setNextPageUrl(response.data.next);
    } catch (error) {
      console.error("Error fetching more notices:", error);
      toast.error("Failed to load more notices.");
    } finally {
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    fetchNotices();
  }, []);

  // NEW: Function to open modal with existing data
  const handleEditNotice = (notice: SchoolNotice) => {
    setEditingNotice(notice);
    setIsModalOpen(true);
  };

  // NEW: Function to safely close modal and clear edit state
  const handleCloseModal = () => {
    setEditingNotice(null);
    setIsModalOpen(false);
  };

  // NEW: Ensure clicking "Post Notice" clears any old edit state
  const handleOpenNewModal = () => {
    setEditingNotice(null);
    setIsModalOpen(true);
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10">
            <Megaphone className="w-7 h-7" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">Digital Noticeboard</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">Broadcast announcements and attach downloadable resources.</p>
          </div>
        </div>

        {/* Only Admins can post notices; teachers, students and parents are view-only */}
        {role === 'admin' && (
          <button
            onClick={handleOpenNewModal}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-all shadow-sm dark:shadow-none"
          >
            <Plus className="w-4 h-4" /> Post Notice
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center items-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500 dark:text-blue-400" />
        </div>
      ) : (
        <>
          <NoticeBoard
            role={role}
            notices={notices}
            onRefresh={fetchNotices}
            onEdit={handleEditNotice} // Passed down to the board
          />
          {nextPageUrl && (
            <div className="flex justify-center mt-6">
              <button
                onClick={loadMoreNotices}
                disabled={isLoadingMore}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-all disabled:opacity-60"
              >
                {isLoadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
                {isLoadingMore ? 'Loading...' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}

      {/* The form modal for creating or editing notices */}
      <NoticeFormModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onSuccess={fetchNotices}
        initialData={editingNotice} // Passed down to populate the form
      />
    </div>
  );
}
