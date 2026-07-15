import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ShieldCheck, Save, Search, ChevronRight, ChevronLeft, CheckSquare, Square } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';

interface Permission {
  id: number;
  code: string;
  label: string;
  module: string;
}

interface Role {
  id: number;
  name: string;
  description: string;
  permissions: Permission[];
  is_system_role: boolean;
}

// Common school-system role names to speed up "Add Role" — selecting one fills in the
// name/description and, where the system actually has a matching module, pre-checks sensible
// permissions. Roles like Librarian/Nurse/Transport have no matching module yet, so they only
// suggest the name/description and leave permissions for the admin to pick manually — nothing
// here should imply functionality that doesn't actually exist behind a permission code yet.
const ROLE_TEMPLATES: { name: string; description: string; permissions: string[] }[] = [
  { name: 'Secretary', description: 'Front-office administrative support', permissions: ['classes.view', 'attendance.view', 'notices.edit', 'events.edit'] },
  { name: 'Finance Officer', description: 'Fees, salaries, and financial oversight', permissions: ['finance.view'] },
  { name: 'Accountant', description: 'Fees, salaries, and financial oversight', permissions: ['finance.view'] },
  { name: 'Exam Officer', description: 'Coordinates exam scheduling and results processing', permissions: ['exams.view', 'exams.edit', 'results.view', 'results.edit'] },
  { name: 'Registrar', description: 'Manages class, stream, and enrollment records', permissions: ['classes.view', 'classes.edit'] },
  { name: 'HR Officer', description: 'Manages staff leave and personnel records', permissions: ['leave.view', 'leave.edit'] },
  { name: 'Front Office Coordinator', description: 'Handles notices, events, and visitor coordination', permissions: ['notices.edit', 'events.edit', 'classes.view'] },
  { name: 'Timetable Coordinator', description: 'Builds and maintains the school timetable', permissions: ['timetable.view', 'timetable.edit'] },
  { name: 'Subject Allocation Coordinator', description: 'Manages teacher-subject allocations', permissions: ['allocations.view', 'allocations.edit'] },
  { name: 'Deputy Principal', description: 'Senior leadership with broad academic oversight', permissions: ['classes.view', 'classes.edit', 'attendance.view', 'attendance.edit', 'results.view', 'results.edit', 'exams.view', 'exams.edit', 'timetable.view'] },
  { name: 'Head of Department', description: 'Departmental academic oversight', permissions: ['results.view', 'exams.view', 'timetable.view'] },
  { name: 'Chat Moderator', description: 'Oversees school messaging and communications', permissions: ['chat.manage'] },
  { name: 'Librarian', description: 'Manages library resources', permissions: [] },
  { name: 'School Nurse', description: 'Monitors student health and wellbeing', permissions: ['attendance.view'] },
  { name: 'Counselor', description: 'Supports student wellbeing and academic progress', permissions: ['attendance.view', 'results.view'] },
  { name: 'Transport Coordinator', description: 'Manages school transport logistics', permissions: [] },
  { name: 'IT Support', description: 'Manages system access and technical support', permissions: [] },
  { name: 'Receptionist', description: 'Front-desk visitor and enquiry management', permissions: ['classes.view'] },
];

export default function RoleEditor() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);

  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);

  const [roleName, setRoleName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [templateSearch, setTemplateSearch] = useState('');
  const [isSystemRole, setIsSystemRole] = useState(false);

  useEffect(() => {
    api.get('/api/core/rbac/permissions/').then((res) => setPermissions(res.data));
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.get(`/api/core/rbac/roles/${id}/`)
      .then((res) => {
        const role: Role = res.data;
        setRoleName(role.name);
        setDescription(role.description || '');
        setSelectedIds(new Set(role.permissions.map((p) => p.id)));
        setIsSystemRole(role.is_system_role);
      })
      .catch((err) => {
        console.error('Failed to load role', err);
        toast.error('Could not load that role.');
        navigate('/admin-dashboard/roles-permissions');
      })
      .finally(() => setLoading(false));
  }, [id, navigate]);

  const permissionsByModule = useMemo(() => {
    const byModule = new Map<string, Permission[]>();
    permissions.forEach((p) => {
      if (!byModule.has(p.module)) byModule.set(p.module, []);
      byModule.get(p.module)!.push(p);
    });
    return Array.from(byModule.entries());
  }, [permissions]);

  const permissionByCode = useMemo(() => {
    const map = new Map<string, Permission>();
    permissions.forEach((p) => map.set(p.code, p));
    return map;
  }, [permissions]);

  const filteredTemplates = useMemo(() => {
    const q = templateSearch.trim().toLowerCase();
    if (!q) return ROLE_TEMPLATES;
    return ROLE_TEMPLATES.filter((t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q));
  }, [templateSearch]);

  const applyTemplate = (template: typeof ROLE_TEMPLATES[number]) => {
    setRoleName(template.name);
    setDescription(template.description);
    const ids = template.permissions
      .map((code) => permissionByCode.get(code)?.id)
      .filter((id): id is number => id !== undefined);
    setSelectedIds(new Set(ids));
  };

  const togglePermission = (permId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(permId)) next.delete(permId);
      else next.add(permId);
      return next;
    });
  };

  const toggleModule = (perms: Permission[]) => {
    const allSelected = perms.every((p) => selectedIds.has(p.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      perms.forEach((p) => (allSelected ? next.delete(p.id) : next.add(p.id)));
      return next;
    });
  };

  const handleSave = async () => {
    if (!roleName.trim()) {
      toast.error('Role name is required.');
      return;
    }
    setSaving(true);
    const payload = { name: roleName.trim(), description, permission_ids: Array.from(selectedIds) };
    try {
      if (isEditing) {
        await api.patch(`/api/core/rbac/roles/${id}/`, payload);
        toast.success(`${roleName} updated.`);
      } else {
        await api.post('/api/core/rbac/roles/', payload);
        toast.success(`${roleName} created.`);
      }
      navigate('/admin-dashboard/roles-permissions');
    } catch (error: any) {
      console.error('Failed to save role', error);
      toast.error(error?.response?.data?.name?.[0] || error?.response?.data?.detail || 'Failed to save role.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto space-y-6 animate-pulse">
        <div className="h-8 w-64 bg-slate-200 rounded-lg"></div>
        <div className="h-40 bg-slate-200 rounded-2xl"></div>
        <div className="h-96 bg-slate-200 rounded-2xl"></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-16">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-slate-500">
        <Link to="/admin-dashboard/roles-permissions" className="hover:text-blue-600 transition font-medium flex items-center gap-1">
          <ChevronLeft className="w-4 h-4" /> Roles & Permissions
        </Link>
        <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
        <span className="text-slate-700 font-semibold">{isEditing ? `Editing role '${roleName}'` : 'Add new role'}</span>
      </div>

      {/* Sticky header: title + save/cancel, mirroring the "top of page" save bar pattern */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-slate-800 flex items-center gap-2">
              {isEditing ? `Editing role '${roleName}'` : 'Add new role'}
              {isSystemRole && (
                <span className="bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full">
                  System
                </span>
              )}
            </h1>
            <p className="text-xs text-slate-500">{selectedIds.size} permission{selectedIds.size !== 1 ? 's' : ''} selected</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={() => navigate('/admin-dashboard/roles-permissions')} disabled={saving}
            className="px-5 py-2.5 border border-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-50 transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all disabled:opacity-70">
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>

      {/* Quick Templates — only meaningful for a brand-new role */}
      {!isEditing && (
        <div className="bg-blue-50/60 border border-blue-100 rounded-2xl p-5 space-y-3">
          <label className="text-xs font-bold text-slate-600 uppercase tracking-wider block">Quick Templates</label>
          <div className="flex items-center gap-2 rounded-full ring-1 ring-slate-200 px-3 py-2 bg-white focus-within:ring-2 focus-within:ring-blue-500 transition-all max-w-lg">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              type="text"
              placeholder="Search common roles: secretary, finance, librarian..."
              value={templateSearch}
              onChange={(e) => setTemplateSearch(e.target.value)}
              className="w-full bg-transparent outline-none text-sm text-slate-700 placeholder:text-slate-400"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {filteredTemplates.length === 0 ? (
              <p className="text-xs text-slate-400 italic px-1">No matching template — just type a custom name below.</p>
            ) : (
              filteredTemplates.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => applyTemplate(t)}
                  title={t.description}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                    roleName === t.name
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-blue-300 hover:text-blue-700'
                  }`}
                >
                  {t.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Role details */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-600 uppercase tracking-wider block">
            Role Name <span className="text-red-500">*</span>
          </label>
          <input required type="text" placeholder="e.g. Curriculum Coordinator" value={roleName}
            disabled={isSystemRole}
            className="w-full border border-slate-300 rounded-xl p-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 bg-white text-slate-800 transition-all disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
            onChange={(e) => setRoleName(e.target.value)} />
          {isSystemRole && (
            <p className="text-xs text-slate-400">System roles can't be renamed — permissions are still fully editable.</p>
          )}
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-600 uppercase tracking-wider block">Description</label>
          <input type="text" placeholder="Optional — what this role is for" value={description}
            className="w-full border border-slate-300 rounded-xl p-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 bg-white text-slate-800 transition-all"
            onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>

      {/* Permissions — a full-width, module-by-module grid instead of a cramped modal list */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold text-slate-600 uppercase tracking-wider">Permissions</h2>
        {permissionsByModule.length === 0 ? (
          <p className="text-sm text-slate-400 italic">No permissions in the catalog yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {permissionsByModule.map(([module, perms]) => {
              const allSelected = perms.every((p) => selectedIds.has(p.id));
              const someSelected = perms.some((p) => selectedIds.has(p.id));
              return (
                <div key={module} className="bg-white border border-slate-100 rounded-2xl shadow-sm p-5 space-y-3">
                  <button
                    type="button"
                    onClick={() => toggleModule(perms)}
                    className="w-full flex items-center justify-between gap-2 text-left group"
                  >
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-widest group-hover:text-blue-600 transition">
                      {module}
                    </span>
                    {allSelected ? (
                      <CheckSquare className="w-4 h-4 text-blue-600 shrink-0" />
                    ) : (
                      <Square className={`w-4 h-4 shrink-0 ${someSelected ? 'text-blue-300' : 'text-slate-300'}`} />
                    )}
                  </button>
                  <div className="space-y-2.5">
                    {perms.map((perm) => (
                      <label key={perm.id} className="flex items-start gap-3 cursor-pointer">
                        <input type="checkbox" checked={selectedIds.has(perm.id)}
                          onChange={() => togglePermission(perm.id)}
                          className="w-4 h-4 mt-0.5 text-blue-600 border-slate-300 rounded focus:ring-blue-500 shrink-0" />
                        <span className="flex flex-col">
                          <span className="text-slate-700 text-sm font-medium leading-snug">{perm.label}</span>
                          <span className="text-xs text-slate-400 font-mono">{perm.code}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom save bar too, so it's reachable without scrolling back up on a long permission grid */}
      <div className="flex justify-end gap-3 sticky bottom-4 bg-white/90 backdrop-blur-sm border border-slate-100 shadow-lg rounded-2xl p-4">
        <button onClick={() => navigate('/admin-dashboard/roles-permissions')} disabled={saving}
          className="px-5 py-2.5 border border-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-50 transition-colors">
          Cancel
        </button>
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all disabled:opacity-70">
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
