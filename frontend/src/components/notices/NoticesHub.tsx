import { useState, useEffect } from 'react';
import { Megaphone, Plus, Loader2 } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import NoticeBoard from './NoticeBoard';
import NoticeFormModal from './NoticeFormModal';

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
  
  // NEW: State to track which notice we are currently editing
  const [editingNotice, setEditingNotice] = useState<SchoolNotice | null>(null);

  const fetchNotices = async () => {
    setIsLoading(true);
    try {
      const response = await axios.get('http://localhost:8000/api/core/notices/');
      setNotices(response.data);
    } catch (error) {
      console.error("Error fetching notices:", error);
      toast.error("Failed to load the digital bulletin board.");
    } finally {
      setIsLoading(false);
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
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Megaphone className="w-6 h-6 text-blue-600" /> Digital Noticeboard
          </h1>
          <p className="text-slate-500 text-sm mt-1">Broadcast announcements and attach downloadable resources.</p>
        </div>
        
        {/* Only Admins and Teachers can post notices */}
        {(role === 'admin' || role === 'teacher') && (
          <button 
            onClick={handleOpenNewModal}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-all shadow-sm"
          >
            <Plus className="w-4 h-4" /> Post Notice
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center items-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      ) : (
        <NoticeBoard 
          role={role} 
          notices={notices} 
          onRefresh={fetchNotices} 
          onEdit={handleEditNotice} // Passed down to the board
        />
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