import { useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'react-hot-toast';

interface AddGradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AddGradeModal({ isOpen, onClose, onSuccess }: AddGradeModalProps) {
  const [formData, setFormData] = useState({
    grade_name: '', numeric_order: '', streams: '', capacity: 40
  });
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const toastId = toast.loading('Creating grade...');

    try {
      const response = await fetch('http://localhost:8000/api/academic-hub/add-grade/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      const data = await response.json();

      if (data.status === 'success') {
        toast.success('Grade and Streams successfully created!', { id: toastId });
        onSuccess();
        onClose();
      } else {
        toast.error(data.message || 'Failed to create grade.', { id: toastId });
      }
    } catch (error) {
      console.error(error);
      toast.error('Network error occurred.', { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
        
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h2 className="font-semibold text-slate-800">Add Grade & Streams</h2>
          <button onClick={onClose} title="Close" className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-sm">
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="block text-slate-600 font-medium mb-1">Grade Name</label>
              <input required type="text" placeholder="e.g. Grade 8" aria-label="Grade Name" className="w-full border border-slate-200 rounded-md p-2 focus:ring-2 focus:ring-blue-500 outline-none" 
                onChange={(e) => setFormData({...formData, grade_name: e.target.value})} />
            </div>
            <div className="col-span-1">
              <label className="block text-slate-600 font-medium mb-1">Sort Order</label>
              <input required type="number" placeholder="e.g. 8" aria-label="Sort Order" className="w-full border border-slate-200 rounded-md p-2 focus:ring-2 focus:ring-blue-500 outline-none" 
                onChange={(e) => setFormData({...formData, numeric_order: e.target.value})} />
            </div>
          </div>

          <div>
            <label className="block text-slate-600 font-medium mb-1">Class Streams (Comma Separated)</label>
            <input required type="text" placeholder="e.g. A, B, C, East, West" aria-label="Class Streams" className="w-full border border-slate-200 rounded-md p-2 focus:ring-2 focus:ring-blue-500 outline-none"
               onChange={(e) => setFormData({...formData, streams: e.target.value})} />
            <p className="text-xs text-slate-400 mt-1">This will auto-generate all physical classrooms for this grade.</p>
          </div>

          <div>
            <label className="block text-slate-600 font-medium mb-1">Default Capacity Per Stream</label>
            <input required type="number" defaultValue={40} aria-label="Default Capacity Per Stream" className="w-full border border-slate-200 rounded-md p-2 focus:ring-2 focus:ring-blue-500 outline-none"
               onChange={(e) => setFormData({...formData, capacity: parseInt(e.target.value)})} />
          </div>

          <div className="pt-4 flex justify-end gap-3 border-t border-slate-100 mt-6">
            <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-md font-medium">Cancel</button>
            <button type="submit" disabled={loading} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium disabled:opacity-50">
              {loading ? 'Saving...' : 'Save Structure'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}