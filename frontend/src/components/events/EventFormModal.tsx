import React, { useState, useEffect } from 'react';
import { X, Calendar as CalendarIcon, Clock, Type, AlignLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import type { SchoolEvent } from './EventsHub';
import api from '../../libs/axiosInstance';


interface EventFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialData?: SchoolEvent | null; // Added to support editing
}

export default function EventFormModal({ isOpen, onClose, onSuccess, initialData }: EventFormModalProps) {
  // Matches Django Event Model exactly
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    start_time: '',
    end_time: '',
    event_type: 'General',
    is_active: true,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sync form data when initialData changes (for editing)
  useEffect(() => {
    if (initialData) {
      setFormData({
        title: initialData.title,
        description: initialData.description,
        start_time: initialData.start_time.slice(0, 16), // Format for datetime-local input
        end_time: initialData.end_time.slice(0, 16),
        event_type: initialData.event_type,
        is_active: initialData.is_active,
      });
    } else {
      // Reset to default for new events
      setFormData({
        title: '',
        description: '',
        start_time: '',
        end_time: '',
        event_type: 'General',
        is_active: true,
      });
    }
  }, [initialData, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      if (initialData) {
        // UPDATE Existing Event
        await api.put(`/api/core/events/${initialData.id}/`, formData);
        toast.success('Event successfully updated!');
      } else {
        // CREATE New Event
        await api.post('/api/core/events/', formData);
        toast.success('Event successfully published to the public website!');
      }

      onSuccess(); // Refresh the list in the background
      onClose(); // Close the modal

    } catch (error) {
      console.error("Error saving event:", error);
      toast.error("Failed to save event. Please check your connection.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl dark:shadow-none w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">

        {/* Header - Dynamic Title */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800/40">
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
            {initialData ? 'Edit Event Details' : 'Publish New Event'}
          </h2>
          <button onClick={onClose} className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1 space-y-5">

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Title */}
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Event Title *</label>
              <div className="relative">
                <Type className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <input
                  required
                  type="text"
                  placeholder="e.g., Inter-School Athletics Championship"
                  value={formData.title}
                  onChange={(e) => setFormData({...formData, title: e.target.value})}
                  className="w-full pl-10 pr-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400 outline-none bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                />
              </div>
            </div>

            {/* Start Time */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Start Date & Time *</label>
              <div className="relative">
                <CalendarIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <input
                  required
                  type="datetime-local"
                  value={formData.start_time}
                  onChange={(e) => setFormData({...formData, start_time: e.target.value})}
                  className="w-full pl-10 pr-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400 outline-none text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800"
                />
              </div>
            </div>

            {/* End Time */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">End Date & Time *</label>
              <div className="relative">
                <Clock className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <input
                  required
                  type="datetime-local"
                  value={formData.end_time}
                  onChange={(e) => setFormData({...formData, end_time: e.target.value})}
                  className="w-full pl-10 pr-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400 outline-none text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800"
                />
              </div>
            </div>

            {/* Event Type */}
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Event Category</label>
              <select
                value={formData.event_type}
                onChange={(e) => setFormData({...formData, event_type: e.target.value})}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400 outline-none bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
              >
                <option value="General">General School Event</option>
                <option value="Holiday">Holiday / Mid-Term Break</option>
                <option value="Exam">Examinations</option>
                <option value="Meeting">Parent-Teacher Meeting</option>
                <option value="Sports">Sports & Extracurricular</option>
              </select>
            </div>

            {/* Description */}
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Detailed Description</label>
              <div className="relative">
                <AlignLeft className="w-5 h-5 absolute left-3 top-3 text-slate-400 dark:text-slate-500" />
                <textarea
                  rows={4}
                  placeholder="Provide full details. This will be displayed on the public website..."
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                  className="w-full pl-10 pr-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400 outline-none resize-none bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                />
              </div>
            </div>

            {/* Visibility Toggle */}
            <div className="md:col-span-2 flex items-center gap-3 bg-blue-50 dark:bg-blue-500/10 p-3 rounded-lg border border-blue-100 dark:border-blue-500/20">
              <input
                type="checkbox"
                id="is_active"
                checked={formData.is_active}
                onChange={(e) => setFormData({...formData, is_active: e.target.checked})}
                className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500 dark:focus:ring-blue-400 cursor-pointer"
              />
              <div>
                <label htmlFor="is_active" className="font-semibold text-slate-800 dark:text-slate-100 cursor-pointer select-none">
                  {initialData ? 'Keep Published' : 'Publish Immediately'}
                </label>
                <p className="text-xs text-slate-500 dark:text-slate-400">If unchecked, this event is saved as a draft and hidden from the public website.</p>
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="pt-4 mt-2 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm dark:shadow-none disabled:opacity-70 flex items-center gap-2"
            >
              {isSubmitting ? 'Saving...' : (initialData ? 'Update Event' : 'Save & Publish Event')}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
