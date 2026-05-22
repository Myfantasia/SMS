import React, { useState, useRef, useEffect } from 'react';
import { X, Type, AlignLeft, UploadCloud, FileText, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import type { SchoolNotice } from './NoticesHub';
import api from '../../libs/axiosInstance';


interface NoticeFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void; // Triggers the hub to refresh the feed
  initialData?: SchoolNotice | null; // Added to accept edit data
}

export default function NoticeFormModal({ isOpen, onClose, onSuccess, initialData }: NoticeFormModalProps) {
  // State matches your Django model exactly
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [audience, setAudience] = useState('All');
  const [isUrgent, setIsUrgent] = useState(false); // Added Urgent state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Automatically populate the form if we are editing an existing notice
  useEffect(() => {
    if (initialData) {
      setTitle(initialData.title);
      setMessage(initialData.message);
      setAudience(initialData.audience);
      setIsUrgent(initialData.is_urgent || false);
      setSelectedFile(null); // Clear any pending file uploads when opening an edit
    } else {
      // Reset if it's a new post
      setTitle(''); 
      setMessage(''); 
      setAudience('All'); 
      setIsUrgent(false); 
      setSelectedFile(null);
    }
  }, [initialData, isOpen]);

  if (!isOpen) return null;

  // Handles file selection and enforces a 5MB size limit
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (file.size > 5 * 1024 * 1024) {
        toast.error("File size must be less than 5MB");
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    // CRITICAL: We must use FormData to send Files over HTTP
    const formData = new FormData();
    formData.append('title', title);
    formData.append('message', message);
    formData.append('audience', audience);
    formData.append('is_urgent', String(isUrgent)); // Append urgent status
    
    // In edit mode, we don't change the author. In create mode, we set it.
    if (!initialData) {
      formData.append('by', 'School Admin'); 
    }

    if (selectedFile) {
      formData.append('attachment', selectedFile);
    }

    try {
      if (initialData) {
        // UPDATE Existing Notice
        await api.put(`/api/core/notices/${initialData.id}/`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        toast.success('Notice updated successfully!');
      } else {
        // CREATE New Notice
        await api.post('/api/core/notices/', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        toast.success('Notice published successfully!');
      }
      
      onSuccess(); // Refresh the parent feed
      onClose(); // Close Modal
      
    } catch (error) {
      console.error("Error saving notice:", error);
      toast.error("Failed to save notice. Please check your connection.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
          <h2 className="text-lg font-bold text-slate-800">
            {initialData ? 'Edit Announcement' : 'Create New Notice'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1 space-y-5 custom-scrollbar">
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Title Input */}
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold text-slate-700 mb-1">Notice Headline / Title *</label>
              <div className="relative">
                <Type className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                  required 
                  type="text" 
                  placeholder="e.g., Updated Fee Structure for Term 2"
                  value={title} 
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-slate-700"
                />
              </div>
            </div>

            {/* Target Audience Dropdown */}
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold text-slate-700 mb-1">Target Audience</label>
              <div className="relative">
                <Users className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <select 
                  value={audience} 
                  onChange={(e) => setAudience(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white text-slate-700 appearance-none"
                >
                  <option value="All">All (Public, Staff & Students)</option>
                  <option value="Teachers">Teachers Only</option>
                  <option value="Parents">Parents Only</option>
                  <option value="Students">Students Only</option>
                </select>
              </div>
              <p className="text-xs text-slate-500 mt-1">Determines who will see this on their specific dashboard.</p>
            </div>

            {/* Message Area */}
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold text-slate-700 mb-1">Announcement Details *</label>
              <div className="relative">
                <AlignLeft className="w-5 h-5 absolute left-3 top-3 text-slate-400" />
                <textarea 
                  required 
                  rows={5} 
                  placeholder="Type your full announcement here..."
                  value={message} 
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none text-slate-700"
                />
              </div>
            </div>

            {/* File Upload Area */}
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold text-slate-700 mb-1">Attach Resource (Optional)</label>
              
              <div 
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer transition-colors ${selectedFile ? 'border-blue-500 bg-blue-50' : 'border-slate-300 hover:bg-slate-50 hover:border-blue-400'}`}
              >
                {/* Hidden File Input */}
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileChange} 
                  className="hidden"
                  accept=".pdf,.doc,.docx,.jpg,.png" 
                />
                
                {selectedFile ? (
                  <div className="flex flex-col items-center text-blue-700">
                    <FileText className="w-8 h-8 mb-2" />
                    <span className="font-semibold text-sm text-center">{selectedFile.name}</span>
                    <span 
                      className="text-xs mt-1 text-blue-500 opacity-80 cursor-pointer hover:underline" 
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        setSelectedFile(null); 
                      }}
                    >
                      Remove Attachment
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center text-slate-500">
                    <UploadCloud className="w-8 h-8 mb-2 text-slate-400" />
                    <span className="font-semibold text-sm">
                      {initialData?.attachment ? 'Upload a new file to replace the existing one' : 'Click to upload a document'}
                    </span>
                    <span className="text-xs mt-1">PDF, Word, or Images up to 5MB</span>
                  </div>
                )}
              </div>
            </div>
            
            {/* The Urgent Toggle */}
            <div className="md:col-span-2 flex items-center gap-3 bg-red-50 p-3 rounded-lg border border-red-100">
              <input 
                type="checkbox" 
                id="is_urgent" 
                checked={isUrgent}
                onChange={(e) => setIsUrgent(e.target.checked)}
                className="w-5 h-5 text-red-600 rounded cursor-pointer border-red-300 focus:ring-red-500"
              />
              <div>
                <label htmlFor="is_urgent" className="font-bold text-red-800 cursor-pointer">Mark as Urgent Priority</label>
                <p className="text-xs text-red-600">This will highlight the notice in red to grab immediate attention.</p>
              </div>
            </div>
            
          </div>

          {/* Footer Actions */}
          <div className="pt-4 mt-2 border-t border-slate-200 flex justify-end gap-3">
            <button 
              type="button" 
              onClick={onClose} 
              className="px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button 
              type="submit" 
              disabled={isSubmitting} 
              className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-70 shadow-sm"
            >
              {isSubmitting ? 'Saving...' : (initialData ? 'Update Notice' : 'Broadcast Notice')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}