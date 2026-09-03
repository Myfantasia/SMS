import { Fragment, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Plus, Trash2, X, Search, UserPlus, UserMinus, History, Pencil, Copy, Users, ChevronDown, ChevronUp } from 'lucide-react';
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
  rank: number | null;
  permissions: Permission[];
  is_system_role: boolean;
  member_count: number;
}

interface RoleMember {
  id: number;
  username: string;
  email: string;
  full_name: string;
}

interface UserSearchResult {
  id: number;
  username: string;
  email: string;
  full_name: string;
}

interface AuditLogEntry {
  id: number;
  user_name: string;
  action: string;
  details: string;
  timestamp: string;
}

export default function RolesPermissions() {
  const navigate = useNavigate();
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);

  const [roleToDelete, setRoleToDelete] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null);
  const [userRoleIds, setUserRoleIds] = useState<Set<number>>(new Set());
  const [assigning, setAssigning] = useState<number | null>(null);

  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);

  const [expandedPerms, setExpandedPerms] = useState<Set<number>>(new Set());
  const [expandedMembers, setExpandedMembers] = useState<number | null>(null);
  const [members, setMembers] = useState<RoleMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  const fetchRoles = () => {
    api.get('/api/core/rbac/roles/')
      .then((res) => setRoles(res.data))
      .catch((err) => console.error('Failed to fetch roles', err));
  };

  const fetchPermissions = () => {
    api.get('/api/core/rbac/permissions/')
      .then((res) => setPermissions(res.data))
      .finally(() => setLoading(false));
  };

  const fetchAuditLog = () => {
    setAuditLoading(true);
    api.get('/api/timetable/audit-logs/', { params: { module: 'RBAC', page_size: 10 } })
      .then((res) => setAuditLogs(res.data?.data ?? []))
      .catch((err) => console.error('Failed to fetch RBAC audit log', err))
      .finally(() => setAuditLoading(false));
  };

  useEffect(() => {
    fetchRoles();
    fetchPermissions();
    fetchAuditLog();
  }, []);

  const confirmDelete = async () => {
    if (!roleToDelete) return;
    setDeleting(true);
    try {
      await api.delete(`/api/core/rbac/roles/${roleToDelete.id}/`);
      toast.success(`${roleToDelete.name} deleted.`);
      fetchRoles();
      fetchAuditLog();
      setRoleToDelete(null);
    } catch (error) {
      console.error('Failed to delete role', error);
      toast.error('Failed to delete role.');
    } finally {
      setDeleting(false);
    }
  };

  const togglePermsExpanded = (roleId: number) => {
    setExpandedPerms((prev) => {
      const next = new Set(prev);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  };

  const toggleMembers = async (role: Role) => {
    if (expandedMembers === role.id) {
      setExpandedMembers(null);
      return;
    }
    setExpandedMembers(role.id);
    setMembersLoading(true);
    try {
      const res = await api.get(`/api/core/rbac/roles/${role.id}/members/`);
      setMembers(res.data);
    } catch (error) {
      console.error('Failed to load role members', error);
      toast.error('Failed to load role members.');
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  };

  const removeMember = async (role: Role, member: RoleMember) => {
    try {
      await api.delete('/api/core/rbac/assignments/', { data: { user_id: member.id, role_id: role.id } });
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
      toast.success(`Removed ${member.full_name} from ${role.name}.`);
      fetchRoles();
      fetchAuditLog();
    } catch (error: any) {
      console.error('Failed to remove member', error);
      toast.error(error?.response?.data?.error || 'Failed to remove member.');
    }
  };

  const duplicateRole = (role: Role) => {
    navigate('/admin-dashboard/roles-permissions/new', {
      state: {
        cloneFrom: {
          name: `${role.name} (Copy)`,
          description: role.description,
          permission_ids: role.permissions.map((p) => p.id),
        },
      },
    });
  };

  const runUserSearch = async () => {
    if (!searchTerm.trim()) return;
    try {
      const res = await api.get('/api/core/rbac/assignments/', { params: { search: searchTerm.trim() } });
      setSearchResults(res.data);
    } catch (error) {
      console.error('User search failed', error);
      toast.error('User search failed.');
    }
  };

  const selectUser = async (user: UserSearchResult) => {
    setSelectedUser(user);
    try {
      const res = await api.get('/api/core/rbac/assignments/', { params: { user_id: user.id } });
      setUserRoleIds(new Set(res.data.roles.map((r: Role) => r.id)));
    } catch (error) {
      console.error('Failed to fetch user roles', error);
    }
  };

  const toggleUserRole = async (role: Role) => {
    if (!selectedUser) return;
    setAssigning(role.id);
    const hasRole = userRoleIds.has(role.id);
    try {
      if (hasRole) {
        await api.delete('/api/core/rbac/assignments/', { data: { user_id: selectedUser.id, role_id: role.id } });
        setUserRoleIds((prev) => {
          const next = new Set(prev);
          next.delete(role.id);
          return next;
        });
        toast.success(`Removed ${role.name} from ${selectedUser.full_name}.`);
      } else {
        await api.post('/api/core/rbac/assignments/', { user_id: selectedUser.id, role_id: role.id });
        setUserRoleIds((prev) => new Set(prev).add(role.id));
        toast.success(`Assigned ${role.name} to ${selectedUser.full_name}.`);
      }
    } catch (error: any) {
      console.error('Failed to update role assignment', error);
      toast.error(error?.response?.data?.error || 'Failed to update role assignment.');
    } finally {
      setAssigning(null);
      fetchAuditLog();
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto space-y-6 animate-pulse">
        <div className="h-12 w-80 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
        <div className="h-64 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10">
            <ShieldCheck className="w-7 h-7" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">Roles & Permissions</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{roles.length} role{roles.length !== 1 ? 's' : ''} &middot; {permissions.length} permission{permissions.length !== 1 ? 's' : ''} in the catalog</p>
          </div>
        </div>
        <button onClick={() => navigate('/admin-dashboard/roles-permissions/new')} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-bold transition shadow-sm dark:shadow-none">
          <Plus className="w-4 h-4" /> Add Role
        </button>
      </div>

      {/* Roles list */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700 overflow-hidden">
        {roles.length === 0 ? (
          <div className="text-slate-400 dark:text-slate-500 p-10 text-center text-sm">No roles yet. Add one to get started.</div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-slate-400 dark:text-slate-500 text-[11px] uppercase tracking-wider border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                <th className="px-6 py-3 font-bold">Role</th>
                <th className="px-6 py-3 font-bold">Permissions</th>
                <th className="px-6 py-3 font-bold">Members</th>
                <th className="px-6 py-3 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="text-sm text-slate-700 dark:text-slate-200 divide-y divide-slate-50 dark:divide-slate-800">
              {roles.map((role) => {
                const isExpanded = expandedPerms.has(role.id);
                const modules = Array.from(new Set(role.permissions.map((p) => p.module)));
                const visiblePerms = isExpanded ? role.permissions : role.permissions.slice(0, 4);
                const membersOpen = expandedMembers === role.id;
                return (
                  <Fragment key={role.id}>
                    <tr className="hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors align-top">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-800 dark:text-slate-100">{role.name}</span>
                          {role.is_system_role && (
                            <span className="bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/40 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full">
                              System
                            </span>
                          )}
                          {role.rank !== null && role.rank !== undefined && (
                            <span className="bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full">
                              Rank {role.rank}
                            </span>
                          )}
                        </div>
                        {role.description && <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{role.description}</p>}
                      </td>
                      <td className="px-6 py-4">
                        {role.permissions.length === 0 ? (
                          <span className="text-xs text-slate-400 dark:text-slate-500 italic">No permissions</span>
                        ) : (
                          <div className="space-y-1.5 max-w-sm">
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              <span className="font-semibold text-slate-700 dark:text-slate-200">{role.permissions.length}</span> permission{role.permissions.length !== 1 ? 's' : ''} across {modules.length} module{modules.length !== 1 ? 's' : ''}
                            </p>
                            <div className="flex flex-wrap gap-1">
                              {visiblePerms.map((p) => (
                                <span key={p.id} title={p.label} className="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 px-2 py-1 rounded text-xs whitespace-nowrap font-mono">
                                  {p.code}
                                </span>
                              ))}
                            </div>
                            {role.permissions.length > 4 && (
                              <button onClick={() => togglePermsExpanded(role.id)} className="flex items-center gap-1 text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300">
                                {isExpanded ? <>Show less <ChevronUp className="w-3 h-3" /></> : <>Show all <ChevronDown className="w-3 h-3" /></>}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => toggleMembers(role)}
                          className={`flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded-full border transition ${
                            membersOpen ? 'border-blue-300 dark:border-blue-500/40 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400' : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-blue-300 dark:hover:border-blue-500/40 hover:text-blue-600 dark:hover:text-blue-400'
                          }`}
                        >
                          <Users className="w-3.5 h-3.5" />
                          {role.member_count} {role.member_count === 1 ? 'user' : 'users'}
                          {membersOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-3">
                          <button onClick={() => duplicateRole(role)} className="text-slate-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition" title="Duplicate role">
                            <Copy className="w-4 h-4" />
                          </button>
                          <button onClick={() => navigate(`/admin-dashboard/roles-permissions/${role.id}/edit`)} className="text-slate-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition" title="Edit role">
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setRoleToDelete(role)}
                            disabled={role.is_system_role}
                            className="text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 transition disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-slate-400 dark:disabled:hover:text-slate-500"
                            title={role.is_system_role ? "System roles can't be deleted" : "Delete role"}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {membersOpen && (
                      <tr className="bg-slate-50/60 dark:bg-slate-800/40">
                        <td colSpan={4} className="px-6 py-4">
                          {membersLoading ? (
                            <div className="animate-pulse flex gap-2">
                              {[1, 2, 3].map((i) => <div key={i} className="h-8 w-32 bg-slate-200 dark:bg-slate-800 rounded-full"></div>)}
                            </div>
                          ) : members.length === 0 ? (
                            <p className="text-xs text-slate-400 dark:text-slate-500 italic">No one currently holds this role.</p>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {members.map((m) => (
                                <span key={m.id} className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-full pl-3 pr-1.5 py-1 text-xs">
                                  <span className="font-semibold text-slate-700 dark:text-slate-200">{m.full_name}</span>
                                  <span className="text-slate-400 dark:text-slate-500">{m.email || m.username}</span>
                                  <button
                                    onClick={() => removeMember(role, m)}
                                    title={`Remove ${m.full_name} from ${role.name}`}
                                    className="text-slate-300 dark:text-slate-600 hover:text-red-600 dark:hover:text-red-400 transition p-0.5"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Assign roles to a user */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700 p-6 space-y-5">
        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Assign Roles to a User</h2>

        <div className="flex items-center gap-2 rounded-full ring-1 ring-slate-200 dark:ring-slate-700 px-3 py-2 bg-slate-50 dark:bg-slate-800 focus-within:ring-2 focus-within:ring-blue-500 dark:focus-within:ring-blue-400 focus-within:bg-white dark:focus-within:bg-slate-800 transition-all max-w-md">
          <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
          <input
            type="text"
            placeholder="Search by name, username or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runUserSearch()}
            className="w-full bg-transparent outline-none text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500"
          />
          <button onClick={runUserSearch} className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 shrink-0">Search</button>
        </div>

        {searchResults.length > 0 && !selectedUser && (
          <div className="border border-slate-100 dark:border-slate-700 rounded-xl divide-y divide-slate-50 dark:divide-slate-800">
            {searchResults.map((u) => (
              <button key={u.id} onClick={() => selectUser(u)} className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition flex items-center justify-between">
                <div>
                  <span className="font-semibold text-slate-800 dark:text-slate-100 text-sm">{u.full_name}</span>
                  <span className="text-xs text-slate-400 dark:text-slate-500 ml-2">{u.email || u.username}</span>
                </div>
                <UserPlus className="w-4 h-4 text-slate-300 dark:text-slate-600" />
              </button>
            ))}
          </div>
        )}

        {selectedUser && (
          <div className="bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-bold text-slate-800 dark:text-slate-100">{selectedUser.full_name}</span>
                <span className="text-xs text-slate-400 dark:text-slate-500 ml-2">{selectedUser.email || selectedUser.username}</span>
              </div>
              <button onClick={() => { setSelectedUser(null); setSearchResults([]); setSearchTerm(''); }} className="text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
                Change user
              </button>
            </div>
            <div className="space-y-2">
              {roles.map((role) => {
                const hasRole = userRoleIds.has(role.id);
                return (
                  <button
                    key={role.id}
                    onClick={() => toggleUserRole(role)}
                    disabled={assigning === role.id}
                    className={`w-full flex items-center justify-between p-3 rounded-lg border transition text-left ${
                      hasRole ? 'border-blue-300 dark:border-blue-500/40 bg-blue-50 dark:bg-blue-500/10' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-600'
                    } disabled:opacity-50`}
                  >
                    <span className="font-medium text-sm text-slate-700 dark:text-slate-200">{role.name}</span>
                    {hasRole ? (
                      <span className="flex items-center gap-1 text-xs font-bold text-blue-600 dark:text-blue-400"><UserMinus className="w-3.5 h-3.5" /> Remove</span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs font-bold text-slate-400 dark:text-slate-500"><UserPlus className="w-3.5 h-3.5" /> Assign</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Recent RBAC changes */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700 p-6 space-y-4">
        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <History className="w-5 h-5 text-slate-400 dark:text-slate-500" /> Recent Changes
        </h2>
        {auditLoading ? (
          <div className="animate-pulse space-y-2">
            {[1, 2, 3].map((i) => <div key={i} className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg"></div>)}
          </div>
        ) : auditLogs.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500 italic">No role or permission changes yet.</p>
        ) : (
          <div className="divide-y divide-slate-50 dark:divide-slate-800">
            {auditLogs.map((log) => (
              <div key={log.id} className="py-3 flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-slate-700 dark:text-slate-200">{log.details}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{log.user_name}</p>
                </div>
                <span className="text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap shrink-0">{log.timestamp}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {roleToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl dark:shadow-none w-full max-w-md overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Confirm Deletion</h3>
              <button onClick={() => setRoleToDelete(null)} title="Close modal" className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 text-center space-y-4">
              <div className="mx-auto w-12 h-12 bg-red-100 dark:bg-red-500/10 rounded-full flex items-center justify-center mb-4">
                <Trash2 className="w-6 h-6 text-red-600 dark:text-red-400" />
              </div>
              <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">Delete {roleToDelete.name}?</h3>
              <p className="text-slate-500 dark:text-slate-400 text-sm">
                Anyone currently assigned this role will immediately lose the permissions it grants.
              </p>
              <div className="flex gap-4 mt-6">
                <button onClick={() => setRoleToDelete(null)} disabled={deleting} className="flex-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 py-2 rounded-md font-medium hover:bg-slate-200 dark:hover:bg-slate-700">
                  Cancel
                </button>
                <button onClick={confirmDelete} disabled={deleting} className="flex-1 bg-red-600 text-white py-2 rounded-md font-medium hover:bg-red-700 disabled:bg-red-400 dark:disabled:bg-red-900/60">
                  {deleting ? 'Deleting...' : 'Permanently Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
