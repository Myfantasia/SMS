import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, UserCheck, LayoutDashboard } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';
import SearchableSelect from '../common/SearchableSelect';

interface Teacher {
  id: number;
  name: string;
}

export default function EditClass() {
  const { id } = useParams();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  
  // Form States
  const [gradeName, setGradeName] = useState('');
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState<number | string>('');
  const [classTeacherId, setClassTeacherId] = useState<string>('');

useEffect(() => {
  const initializeClassEditorData = async () => {
    try {
      // Execute sibling lookup streams concurrently via Promise.all
      const [teachersRes, classesRes] = await Promise.all([
        api.get('/api/approved-users/teachers/'),
        api.get('/api/manage-classes/')
      ]);

      if (teachersRes.data.status === 'success') {
        setTeachers(teachersRes.data.data);
      }

      if (classesRes.data.status === 'success') {
        for (const grade of classesRes.data.data) {
          const stream = grade.streams.find((s: any) => s.id === Number(id));
          if (stream) {
            setGradeName(grade.grade_name);
            setName(stream.name);
            setCapacity(stream.capacity);
            if (stream.class_teacher_id) {
              setClassTeacherId(stream.class_teacher_id.toString());
            }
            break;
          }
        }
      }
    } catch (error) {
      console.error("Initialization failed:", error);
    } finally {
      setLoading(false);
    }
  };

  initializeClassEditorData();
}, [id]);

const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setIsSubmitting(true);

  try {
    const response = await api.put(`/api/academic-hub/edit-stream/${id}/`, { 
      name, 
      capacity,
      teacher_id: classTeacherId // Updates the form teacher relational assignment
    });
    
    const data = response.data;
    
    if (data.status === 'success') {
      toast.success(data.message);
      navigate('/admin-dashboard/classes'); 
    } else {
      toast.error(data.message);
    }
  } catch (error: any) {
    console.error(error);
    const errMsg = error.response?.data?.message || 'Failed to update class configuration.';
    toast.error(errMsg);
  } finally {
    setIsSubmitting(false);
  }
};

  if (loading) return <div className="p-6 text-slate-500">Loading Configuration Engine...</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6 animate-fade-in">
      
      <button onClick={() => navigate('/admin-dashboard/classes')} className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-blue-600 transition-colors w-max">
        <ArrowLeft className="w-4 h-4" /> Back to Classes
      </button>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="bg-slate-50 border-b border-slate-100 p-6 flex items-center gap-3">
           <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center">
             <LayoutDashboard className="w-6 h-6" />
           </div>
           <div>
             <h1 className="text-2xl font-black text-slate-800">Edit {gradeName} {name}</h1>
             <p className="text-sm text-slate-500">Update physical parameters and assign a homeroom teacher.</p>
           </div>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-8">
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">Stream Name (e.g., East, Blue, A)</label>
              <input 
                type="text" 
                value={name} 
                onChange={(e) => setName(e.target.value)} 
                placeholder="e.g., East, Blue, A"
                className="w-full border border-slate-300 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"
                required 
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">Maximum Capacity</label>
              <input 
                type="number" 
                value={capacity} 
                onChange={(e) => setCapacity(e.target.value)} 
                placeholder="Enter maximum capacity"
                className="w-full border border-slate-300 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"
                required 
              />
            </div>
          </div>

          <hr className="border-slate-100" />

          {/* Teacher Assignment Section */}
          <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-6">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-2">
              <UserCheck className="w-5 h-5 text-blue-600" /> Assign Homeroom Teacher
            </h3>
            <p className="text-sm text-slate-500 mb-4">The selected teacher will be responsible for attendance, pastoral care, and report card compilation for this specific class.</p>
            
            <SearchableSelect
              value={classTeacherId}
              onChange={setClassTeacherId}
              aria-label="Assign homeroom teacher"
              placeholder="-- No Teacher Assigned --"
              searchPlaceholder="Search teachers…"
              options={teachers.map(t => ({ value: String(t.id), label: t.name }))}
            />
          </div>

          <div className="flex justify-end gap-4 pt-4">
            <button type="button" onClick={() => navigate('/admin-dashboard/classes')} className="px-6 py-2.5 border border-slate-200 text-slate-600 rounded-lg font-bold hover:bg-slate-50 transition">Cancel</button>
            <button type="submit" disabled={isSubmitting} className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition flex items-center gap-2 disabled:bg-blue-400 shadow-sm shadow-blue-600/20">
              <Save className="w-4 h-4" /> {isSubmitting ? 'Saving Configuration...' : 'Save Configuration'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}