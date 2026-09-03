import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Plus, 
  Search, 
  Filter, 
  CheckCircle2, 
  Clock, 
  XCircle,
  FileEdit,
  Eye,       
  Trash2     
} from 'lucide-react';
import toast from 'react-hot-toast';
import { assignmentService } from '../../libs/assignmentService';

interface AssignmentsHubProps {
  role: 'admin' | 'teacher' | 'student' | 'parent';
}

export default function AssignmentsHub({ role }: AssignmentsHubProps) {
  const navigate = useNavigate();
  // Using any[] here strictly to allow the new dynamic 'grade' parameter without strictly enforcing the old interface
  const [assignments, setAssignments] = useState<any[]>([]); 
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  // Fetch data on mount
  useEffect(() => {
    fetchAssignments();
  }, [role]);

  const fetchAssignments = async () => {
    try {
      setLoading(true);
      const data = await assignmentService.getAssignments();
      setAssignments(data || []); 
    } catch (error) {
      console.error("Error fetching assignments:", error);
      toast.error("Failed to load assignments.");
    } finally {
      setLoading(false);
    }
  };

  // --- SAFE DELETE LOGIC WIRED TO BACKEND ---
  const handleDelete = (id: number | undefined) => {
    if (!id) return;
    
    // Trigger a custom toast that acts as our confirmation modal
    toast((t) => (
      <div className="flex flex-col gap-3 max-w-sm">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100 leading-relaxed">
          Are you sure you want to delete this assignment? This will also delete all student submissions and grades tied to it.
        </p>
        <div className="flex justify-end gap-2 mt-2">
          <button
            onClick={() => toast.dismiss(t.id)}
            className="px-3 py-1.5 text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              // 1. Dismiss the confirmation toast immediately
              toast.dismiss(t.id);
              
              try {
                // 2. Optimistic UI update
                setAssignments(prev => prev.filter(a => a.id !== id));
                
                // 3. LIVE API CALL to the Django delete endpoint
                await assignmentService.deleteAssignment(id);
                
                // 4. Success toast
                toast.success("Assignment deleted successfully.");
              } catch (error) {
                console.error("Error deleting assignment:", error);
                toast.error("Failed to delete assignment. It may have already been removed.");
                // If backend fails, refresh the list to sync with reality
                fetchAssignments(); 
              }
            }}
            className="px-4 py-1.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors shadow-sm"
          >
            Yes, Delete
          </button>
        </div>
      </div>
    ), {
      duration: Infinity, // Keeps the toast open until they click a button
      position: 'top-center',
      style: {
        minWidth: '320px',
      }
    });
  };

  // Helper function to render our reusable Status Chip
  const renderStatusChip = (status: string) => {
    switch (status) {
      case 'Published':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="w-3 h-3" /> Active
          </span>
        );
      case 'Draft':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
            <FileEdit className="w-3 h-3" /> Draft
          </span>
        );
      case 'Closed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400">
            <XCircle className="w-3 h-3" /> Closed
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400">
            <Clock className="w-3 h-3" /> {status}
          </span>
        );
    }
  };

  // Filter Logic
  const filteredAssignments = assignments.filter(assign => {
    const matchesSearch = assign.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (assign.teacher_name && assign.teacher_name.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesStatus = statusFilter === 'All' || assign.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto space-y-6 animate-pulse">
        <div className="h-16 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
        <div className="h-16 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
        <div className="h-96 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">

      {/* 1. Page Header & Action Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10">
            <FileEdit className="w-7 h-7" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">Assignments & Assessments</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Manage all academic tasks, quizzes, and homework.</p>
          </div>
        </div>
        
        {(role === 'admin' || role === 'teacher') && (
          <button 
            onClick={() => navigate('create')}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Create Assignment
          </button>
        )}
      </div>

      {/* 2. Filters & Search Bar */}
      <div className="flex flex-col sm:flex-row gap-4 bg-white dark:bg-slate-900 p-4 rounded-2xl shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
          <input
            type="text"
            placeholder="Search by title or teacher name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 dark:focus:border-blue-400 transition-all"
          />
        </div>

        <div className="flex items-center gap-2 min-w-50">
          <Filter className="w-4 h-4 text-slate-400 dark:text-slate-500" />
          <select
            aria-label="Filter assignments by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 py-2 px-3 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 dark:focus:border-blue-400 cursor-pointer"
          >
            <option value="All">All Statuses</option>
            <option value="Published">Published</option>
            <option value="Draft">Drafts</option>
            <option value="Closed">Closed</option>
          </select>
        </div>
      </div>

      {/* Status legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 -mt-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-emerald-500" /> Active — visible to students now</span>
        <span className="flex items-center gap-1.5"><FileEdit className="w-3 h-3 text-slate-400 dark:text-slate-500" /> Draft — hidden until published</span>
        <span className="flex items-center gap-1.5"><XCircle className="w-3 h-3 text-red-500" /> Closed — past due, no new submissions</span>
      </div>

      {/* 3. The Master Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-700 text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
                <th className="p-4">Title</th>
                <th className="p-4">Grade</th>   {/* <-- NEW COLUMN: GRADE */}
                <th className="p-4">Stream</th>  {/* <-- RENAMED CLASS TO STREAM */}
                <th className="p-4">Subject</th>
                {role === 'admin' && <th className="p-4">Teacher</th>}
                <th className="p-4">Due Date</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredAssignments.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-500 dark:text-slate-400">
                    No assignments found matching your criteria.
                  </td>
                </tr>
              ) : (
                filteredAssignments.map((assign) => (
                  <tr key={assign.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/60 transition-colors group">
                    <td className="p-4">
                      <div className="font-medium text-slate-800 dark:text-slate-100">{assign.title}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{assign.is_quiz ? 'Timed Quiz' : 'Standard Task'}</div>
                    </td>

                    {/* --- IMPLEMENTED GRADE AND STREAM --- */}
                    <td className="p-4 text-sm font-bold text-slate-700 dark:text-slate-200">{assign.grade || 'N/A'}</td>
                    <td className="p-4 text-sm text-slate-600 dark:text-slate-300">{assign.stream || assign.class_name || 'N/A'}</td>

                    <td className="p-4 text-sm text-slate-600 dark:text-slate-300">{assign.subject}</td>

                    {role === 'admin' && (
                      <td className="p-4 text-sm text-slate-600 dark:text-slate-300">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 flex items-center justify-center text-xs font-bold">
                            {assign.teacher_name?.charAt(0) || '?'}
                          </div>
                          {assign.teacher_name}
                        </div>
                      </td>
                    )}

                    <td className="p-4 text-sm text-slate-600 dark:text-slate-300">
                      {assign.due_date ? new Date(assign.due_date).toLocaleDateString('en-GB', { 
                        day: 'numeric', month: 'short', year: 'numeric' 
                      }) : 'N/A'}
                    </td>
                    
                    <td className="p-4">
                      {renderStatusChip(assign.status)}
                    </td>
                    
                    {/* Action Buttons */}
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 transition-opacity">

                        {/* 1. View/Grade Submissions */}
                        <button
                          onClick={() => navigate(`${assign.id}/submissions`)}
                          className="p-2 text-slate-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-lg transition-colors"
                          title="View Submissions & Grade"
                          aria-label={`View submissions for ${assign.title}`}
                        >
                          <Eye className="w-4 h-4" />
                        </button>

                        {/* 2. Edit Assignment */}
                        <button
                          onClick={() => navigate(`edit/${assign.id}`)}
                          className="p-2 text-slate-400 dark:text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded-lg transition-colors"
                          title="Edit Assignment"
                          aria-label={`Edit ${assign.title}`}
                        >
                          <FileEdit className="w-4 h-4" />
                        </button>

                        {/* 3. Delete Assignment */}
                        <button
                          onClick={() => handleDelete(assign.id)}
                          className="p-2 text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                          title="Delete Assignment"
                          aria-label={`Delete ${assign.title}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>

                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}