import React, { useState, useRef, useEffect } from 'react';
import { X, User, Briefcase, Quote, UploadCloud, ImageIcon, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import type { AlumniReview } from './ContentHub';
import api from '../../libs/axiosInstance';

interface AlumniReviewFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialData?: AlumniReview | null;
}

export default function AlumniReviewFormModal({ isOpen, onClose, onSuccess, initialData }: AlumniReviewFormModalProps) {
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [quote, setQuote] = useState('');
  const [displayOrder, setDisplayOrder] = useState(0);
  const [isPublished, setIsPublished] = useState(true);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialData) {
      setName(initialData.name);
      setTitle(initialData.title);
      setQuote(initialData.quote);
      setDisplayOrder(initialData.display_order);
      setIsPublished(initialData.is_published);
      setSelectedFile(null);
    } else {
      setName('');
      setTitle('');
      setQuote('');
      setDisplayOrder(0);
      setIsPublished(true);
      setSelectedFile(null);
    }
  }, [initialData, isOpen]);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (file.size > 5 * 1024 * 1024) {
        toast.error('Photo must be less than 5MB');
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const formData = new FormData();
    formData.append('name', name);
    formData.append('title', title);
    formData.append('quote', quote);
    formData.append('display_order', String(displayOrder));
    formData.append('is_published', String(isPublished));
    if (selectedFile) {
      formData.append('photo', selectedFile);
    }

    try {
      if (initialData) {
        await api.patch(`/api/core/admin/alumni-reviews/${initialData.id}/`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        toast.success('Review updated successfully!');
      } else {
        await api.post('/api/core/admin/alumni-reviews/', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        toast.success('Review added successfully!');
      }
      onSuccess();
      onClose();
    } catch (error) {
      console.error('Error saving alumni review:', error);
      toast.error('Failed to save review. Please check your connection.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl dark:shadow-none w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800">
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
            {initialData ? 'Edit Alumni Review' : 'New Alumni Review'}
          </h2>
          <button onClick={onClose} className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1 space-y-5 custom-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Alumni Name *</label>
              <div className="relative">
                <User className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <input
                  required
                  type="text"
                  placeholder="e.g., Kevin Maina"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400 outline-none text-slate-700 dark:text-slate-200"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Title / Class Year *</label>
              <div className="relative">
                <Briefcase className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <input
                  required
                  type="text"
                  placeholder="e.g., CEO, Pesaflow | Class of 2012"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400 outline-none text-slate-700 dark:text-slate-200"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Quote *</label>
            <div className="relative">
              <Quote className="w-5 h-5 absolute left-3 top-3 text-slate-400 dark:text-slate-500" />
              <textarea
                required
                rows={4}
                placeholder="What they said about their time at MyFantasia..."
                value={quote}
                onChange={(e) => setQuote(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400 outline-none resize-none text-slate-700 dark:text-slate-200"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Photo (Optional)</label>
            <div
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer transition-colors ${selectedFile ? 'border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-500/10' : 'border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-blue-400 dark:hover:border-blue-400'}`}
            >
              <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".jpg,.jpeg,.png" />
              {selectedFile ? (
                <div className="flex flex-col items-center text-blue-700 dark:text-blue-400">
                  <ImageIcon className="w-8 h-8 mb-2" />
                  <span className="font-semibold text-sm text-center">{selectedFile.name}</span>
                  <span
                    className="text-xs mt-1 text-blue-500 dark:text-blue-400 opacity-80 cursor-pointer hover:underline"
                    onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }}
                  >
                    Remove
                  </span>
                </div>
              ) : (
                <div className="flex flex-col items-center text-slate-500 dark:text-slate-400">
                  <UploadCloud className="w-8 h-8 mb-2 text-slate-400 dark:text-slate-500" />
                  <span className="font-semibold text-sm">
                    {initialData?.photo ? 'Upload a new photo to replace the existing one' : 'Click to upload a headshot'}
                  </span>
                  <span className="text-xs mt-1">JPG or PNG up to 5MB. Falls back to initials if left blank.</span>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-end">
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Display Order</label>
              <input
                type="number"
                value={displayOrder}
                onChange={(e) => setDisplayOrder(Number(e.target.value))}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400 outline-none text-slate-700 dark:text-slate-200"
              />
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Lower numbers show first on the About Us page.</p>
            </div>

            <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setIsPublished((p) => !p)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-semibold transition-colors ${isPublished ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}
              >
                {isPublished ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                {isPublished ? 'Published' : 'Draft'}
              </button>
            </div>
          </div>

          <div className="pt-4 mt-2 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-5 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting} className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-70 shadow-sm dark:shadow-none">
              {isSubmitting ? 'Saving...' : (initialData ? 'Update Review' : 'Add Review')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
