import React, { useState, useEffect } from 'react';
import { X, Plus, Save, Settings, AlertCircle, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';

interface GradingRulesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Map this to your Django GradingRule model
interface GradingRule {
  id: string | number;
  grade_label: string;
  min_score: number | string;
  max_score: number | string;
  remarks: string;
}

const GradingRulesModal: React.FC<GradingRulesModalProps> = ({ isOpen, onClose }) => {
  // Toggle between curriculums
  const [activeCurriculum, setActiveCurriculum] = useState<'8-4-4' | 'CBC'>('8-4-4');
  
  // Live Data States
  const [rules, setRules] = useState<GradingRule[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // --- FETCH DATA FROM DJANGO ---
  const fetchRules = async () => {
    setIsLoading(true);
    try {
      const response = await api.get('/api/exams/grading-rules/', {
        params: { curriculum: activeCurriculum }
      });
      setRules(response.data || []);
    } catch (error) {
      console.error("Failed to fetch grading rules", error);
      toast.error(`Failed to load ${activeCurriculum} rules.`);
      setRules([]); // Fallback to empty if error
    } finally {
      setIsLoading(false);
    }
  };

  // Re-fetch whenever the modal opens or the curriculum toggle changes
  useEffect(() => {
    if (isOpen) {
      fetchRules();
    }
  }, [isOpen, activeCurriculum]);

  // --- UI STATE HANDLERS ---
  const handleAddRule = () => {
    const newRule: GradingRule = {
      id: `temp-${Date.now()}`, // Temporary ID until saved to DB
      grade_label: '',
      min_score: '',
      max_score: '',
      remarks: ''
    };
    setRules([...rules, newRule]);
  };

  const handleDeleteRule = (id: string | number) => {
    setRules(rules.filter(rule => rule.id !== id));
  };

  const handleInputChange = (id: string | number, field: keyof GradingRule, value: string | number) => {
    setRules(rules.map(rule => 
      rule.id === id ? { ...rule, [field]: value } : rule
    ));
  };

  // --- SAVE TO DJANGO ---
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // Package the data to send to Django
      const payload = {
        curriculum: activeCurriculum,
        rules: rules.map(r => ({
          grade_label: r.grade_label,
          min_score: Number(r.min_score),
          max_score: Number(r.max_score),
          remarks: r.remarks
        }))
      };

      await api.post('/api/exams/grading-rules/', payload);
      toast.success(`${activeCurriculum} Grading Rules saved successfully.`);
      fetchRules(); // Refresh to convert 'temp' IDs to real database IDs
    } catch (error) {
      console.error("Error saving rules:", error);
      toast.error('Failed to save configuration.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="bg-blue-100 p-2 rounded-lg">
              <Settings className="w-5 h-5 text-blue-700" />
            </div>
            <div>
              <h2 className="font-bold text-slate-800 text-lg">Grading Rules Configuration</h2>
              <p className="text-xs text-slate-500">Define the score ranges for your calculation engine.</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition p-1">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto bg-slate-50/50 flex-1">
          
          {/* Curriculum Toggle */}
          <div className="flex bg-slate-200 p-1 rounded-lg w-fit mb-6">
            <button
              onClick={() => setActiveCurriculum('8-4-4')}
              className={`px-6 py-2 rounded-md text-sm font-bold transition-all ${
                activeCurriculum === '8-4-4' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              8-4-4 System
            </button>
            <button
              onClick={() => setActiveCurriculum('CBC')}
              className={`px-6 py-2 rounded-md text-sm font-bold transition-all ${
                activeCurriculum === 'CBC' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              CBC System
            </button>
          </div>

          <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg flex items-start gap-3 mb-6">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800">
              Ensure there are no gaps between the minimum and maximum scores. The calculation engine will assign a grade of "-" if a student's score falls into an undefined gap.
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center">
              <h3 className="font-semibold text-slate-700">Active {activeCurriculum} Boundaries</h3>
              <button 
                onClick={handleAddRule}
                className="text-sm bg-slate-100 text-slate-700 px-3 py-1.5 rounded-md hover:bg-slate-200 flex items-center gap-1 transition font-medium"
              >
                <Plus className="w-4 h-4" /> Add Rule
              </button>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 border-b border-slate-100">
                    <th className="px-4 py-3 font-semibold w-1/4">Grade / Expectation</th>
                    <th className="px-4 py-3 font-semibold w-1/6">Min Score</th>
                    <th className="px-4 py-3 font-semibold w-1/6">Max Score</th>
                    <th className="px-4 py-3 font-semibold w-1/3">Remarks</th>
                    <th className="px-4 py-3 font-semibold w-12 text-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400">Loading rules...</td>
                    </tr>
                  ) : rules.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400">No grading rules configured. Click "Add Rule" to start.</td>
                    </tr>
                  ) : (
                    rules.map((rule) => (
                      <tr key={rule.id} className="border-b last:border-0 border-slate-50 hover:bg-slate-50 transition-colors group">
                        <td className="p-2">
                          <input 
                            type="text" 
                            className="w-full p-2 border border-slate-200 rounded-md focus:ring-2 focus:ring-blue-500 outline-none transition"
                            placeholder="e.g. A, EE"
                            value={rule.grade_label} 
                            onChange={(e) => handleInputChange(rule.id, 'grade_label', e.target.value)}
                          />
                        </td>
                        <td className="p-2">
                          <input 
                            type="number" 
                            step="0.01"
                            className="w-full p-2 border border-slate-200 rounded-md focus:ring-2 focus:ring-blue-500 outline-none transition"
                            placeholder="0"
                            value={rule.min_score} 
                            onChange={(e) => handleInputChange(rule.id, 'min_score', e.target.value)}
                          />
                        </td>
                        <td className="p-2">
                          <input 
                            type="number" 
                            step="0.01"
                            className="w-full p-2 border border-slate-200 rounded-md focus:ring-2 focus:ring-blue-500 outline-none transition"
                            placeholder="100"
                            value={rule.max_score} 
                            onChange={(e) => handleInputChange(rule.id, 'max_score', e.target.value)}
                          />
                        </td>
                        <td className="p-2">
                          <input 
                            type="text" 
                            className="w-full p-2 border border-slate-200 rounded-md focus:ring-2 focus:ring-blue-500 outline-none transition"
                            placeholder="e.g. Excellent"
                            value={rule.remarks} 
                            onChange={(e) => handleInputChange(rule.id, 'remarks', e.target.value)}
                          />
                        </td>
                        <td className="p-2 text-center">
                          <button 
                            onClick={() => handleDeleteRule(rule.id)}
                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition"
                            title="Delete Rule"
                          >
                            <Trash2 className="w-4 h-4 mx-auto" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-white flex justify-end gap-3">
          <button onClick={onClose} disabled={isSubmitting} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-md font-medium transition disabled:opacity-50">
            Cancel
          </button>
          <button 
            onClick={handleSave} 
            disabled={isSubmitting || isLoading}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium flex items-center gap-2 disabled:opacity-70 transition"
          >
            {isSubmitting ? 'Saving...' : <><Save className="w-4 h-4" /> Save Configuration</>}
          </button>
        </div>

      </div>
    </div>
  );
};

export default GradingRulesModal;