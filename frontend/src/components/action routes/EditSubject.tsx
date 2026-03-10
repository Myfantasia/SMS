import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, BookOpen, Users } from 'lucide-react';
import toast from 'react-hot-toast';

interface Teacher {
  id: number;
  name: string;
}

export default function EditSubject() {
  const { id } = useParams();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [allTeachers, setAllTeachers] = useState<Teacher[]>([]);
  
  // Form States
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [department, setDepartment] = useState('');
  const [isCore, setIsCore] = useState(true);
  
  // Array of Teacher IDs currently assigned to this subject
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<number[]>([]);

  useEffect(() => {
    // 1. Fetch Teachers List
    fetch('http://localhost:8000/api/approved-users/teachers/')
      .then(res => res.json())
      .then(response => {
        if (response.status === 'success') setAllTeachers(response.data);
      });

    // 2. Fetch Subject details
    fetch('http://localhost:8000/api/manage-subjects/')
      .then(res => res.json())
      .then(response => {
        if (response.status === 'success') {
          const subject = response.data.find((s: any) => s.id === Number(id));
          if (subject) {
            setCode(subject.code);
            setName(subject.name);
            setDepartment(subject.department);
            setIsCore(subject.is_core);
            // If API provides assigned teacher IDs, map them here. We'll add this to Django next.
            if (subject.assigned_teacher_ids) setSelectedTeacherIds(subject.assigned_teacher_ids);
          }
        }
        setLoading(false);
      });
  }, [id]);

  // Handle Multi-Select Checkboxes
  const handleCheckboxChange = (teacherId: number) => {
    setSelectedTeacherIds(prev => 
      prev.includes(teacherId) 
        ? prev.filter(id => id !== teacherId) // Remove if already checked
        : [...prev, teacherId] // Add if unchecked
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch(`http://localhost:8000/api/academic-hub/edit-subject/${id}/`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          code, 
          name, 
          department, 
          is_core: isCore,
          teacher_ids: selectedTeacherIds // Passing the array of IDs!
        })
      });
      const data = await response.json();
      
      if (data.status === 'success') {
        toast.success(data.message);
        navigate('/admin-dashboard/subjects');
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      toast.error('Failed to update subject configuration.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) return <div className="p-6 text-slate-500">Loading Master Curriculum...</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6 animate-fade-in">
      
      <button onClick={() => navigate('/admin-dashboard/subjects')} className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-emerald-600 transition-colors w-max">
        <ArrowLeft className="w-4 h-4" /> Back to Subjects
      </button>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="bg-slate-50 border-b border-slate-100 p-6 flex items-center gap-3">
           <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center">
             <BookOpen className="w-6 h-6" />
           </div>
           <div>
             <h1 className="text-2xl font-black text-slate-800">Edit Subject Profile</h1>
             <p className="text-sm text-slate-500">Manage syllabus metadata and allocate the teaching staff pool.</p>
           </div>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-8">
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">Subject Code</label>
              <input type="text" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g., CS101" className="w-full border border-slate-300 rounded-lg p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow font-mono" required />
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">Subject Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter subject name" className="w-full border border-slate-300 rounded-lg p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow" required />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">Department</label>
              <input type="text" value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g., Computer Science" className="w-full border border-slate-300 rounded-lg p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow" required />
            </div>

            <div className="space-y-2 flex flex-col justify-center">
              <label className="flex items-center gap-3 cursor-pointer p-3 border border-slate-200 rounded-lg hover:bg-slate-50 transition mt-6">
                <input type="checkbox" checked={isCore} onChange={(e) => setIsCore(e.target.checked)} className="w-5 h-5 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500" />
                <span className="font-bold text-slate-700">Mandatory Core Subject</span>
              </label>
            </div>
          </div>

          <hr className="border-slate-100" />

          {/* Department Staff Pool Assignment */}
          <div className="bg-emerald-50/50 border border-emerald-100 rounded-xl p-6">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-2">
              <Users className="w-5 h-5 text-emerald-600" /> Allocate Teaching Pool
            </h3>
            <p className="text-sm text-slate-500 mb-4">Select all teachers authorized to teach {name || 'this subject'} across the entire school.</p>
            
            <div className="bg-white border border-slate-200 rounded-lg p-4 max-h-64 overflow-y-auto space-y-1 shadow-inner">
              {allTeachers.length === 0 ? (
                <p className="text-sm text-slate-400 p-2">No approved teachers found in the system.</p>
              ) : (
                allTeachers.map(teacher => (
                  <label key={teacher.id} className={`flex items-center gap-3 p-3 rounded-md cursor-pointer transition ${selectedTeacherIds.includes(teacher.id) ? 'bg-emerald-50 border border-emerald-200' : 'hover:bg-slate-50 border border-transparent'}`}>
                    <input 
                      type="checkbox" 
                      checked={selectedTeacherIds.includes(teacher.id)}
                      onChange={() => handleCheckboxChange(teacher.id)}
                      className="w-5 h-5 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500" 
                    />
                    <span className={`text-sm font-bold ${selectedTeacherIds.includes(teacher.id) ? 'text-emerald-800' : 'text-slate-700'}`}>{teacher.name}</span>
                  </label>
                ))
              )}
            </div>
          </div>

          <div className="flex justify-end gap-4 pt-4">
            <button type="button" onClick={() => navigate('/admin-dashboard/subjects')} className="px-6 py-2.5 border border-slate-200 text-slate-600 rounded-lg font-bold hover:bg-slate-50 transition">Cancel</button>
            <button type="submit" disabled={isSubmitting} className="px-6 py-2.5 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700 transition flex items-center gap-2 disabled:bg-emerald-400 shadow-sm shadow-emerald-600/20">
              <Save className="w-4 h-4" /> {isSubmitting ? 'Saving Configuration...' : 'Save Configuration'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}