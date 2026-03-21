import { useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';

interface AddSubjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void; // Used to trigger a refresh of the table data
}

export default function AddSubjectModal({ isOpen, onClose, onSuccess }: AddSubjectModalProps) {
  const [formData, setFormData] = useState({
    code: '', name: '', department: 'None', is_core: true
  });
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const toastId = toast.loading('Adding subject...');

    try {
      const response = await fetch('http://localhost:8000/api/academic-hub/add-subject/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      const data = await response.json();
      
      if (data.status === 'success') {
        toast.success(`${formData.name} added to curriculum!`, { id: toastId });
        onSuccess(); 
        onClose();   
      } else {
        toast.error(data.message || 'Failed to add subject.', { id: toastId });
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
        
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h2 className="font-semibold text-slate-800">Add New Subject</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" title="Close modal">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-1">
              <label className="block text-slate-600 font-medium mb-1">Subject Code</label>
              <input required type="text" placeholder="e.g. MAT101" className="w-full border border-slate-200 rounded-md p-2 focus:ring-2 focus:ring-emerald-500 outline-none" 
                onChange={(e) => setFormData({...formData, code: e.target.value})} />
            </div>
            <div className="col-span-1">
              <label htmlFor="department" className="block text-slate-600 font-medium mb-1">Department</label>
              <select id="department" className="w-full border border-slate-200 rounded-md p-2 outline-none focus:ring-2 focus:ring-emerald-500"
                onChange={(e) => setFormData({...formData, department: e.target.value})} defaultValue="None">
                <option value="None">None / Unassigned</option>
                <option value="Languages">Languages</option>
                <option value="Mathematics">Mathematics</option>
                <option value="Sciences">Sciences</option>
                <option value="Humanities">Humanities</option>
                <option value="Technical">Technical</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-slate-600 font-medium mb-1">Subject Name</label>
            <input required type="text" placeholder="e.g. Mathematics" className="w-full border border-slate-200 rounded-md p-2 focus:ring-2 focus:ring-emerald-500 outline-none"
               onChange={(e) => setFormData({...formData, name: e.target.value})} />
          </div>

          <div className="flex items-center gap-2 mt-2">
            <input type="checkbox" id="is_core" defaultChecked className="w-4 h-4 text-emerald-600 border-slate-300 rounded"
              onChange={(e) => setFormData({...formData, is_core: e.target.checked})} />
            <label htmlFor="is_core" className="text-slate-600 cursor-pointer">This is a core/mandatory subject</label>
          </div>

          {/* Actions */}
          <div className="pt-4 flex justify-end gap-3 border-t border-slate-100 mt-6">
            <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-md font-medium">Cancel</button>
            <button type="submit" disabled={loading} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md font-medium disabled:opacity-50">
              {loading ? 'Saving...' : 'Save Subject'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}