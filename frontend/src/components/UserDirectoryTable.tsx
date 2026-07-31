import { useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Eye, Edit, Trash2, AlertTriangle, X, Search, Users as UsersIcon, Star, ShieldAlert, UserX, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'react-hot-toast';
import api from '../libs/axiosInstance';


type EnrollmentState = 'Active' | 'Suspended' | 'Expelled' | 'Transferred';

interface DirectoryUser {
  id: number;
  name: string;
  username: string;
  email: string;
  class?: string;
  grade_name?: string;
  grade_order?: number;
  subjects?: string;
  children?: string;
  children_detail?: { id: number; name: string; class: string }[];
  is_class_teacher?: boolean;
  class_teacher_of?: string | null;
  enrollment_state?: EnrollmentState;
  relationship?: string;
  children_count?: number;
  job_title?: string;
}

const PAGE_SIZE = 20;
const STREAM_GROUP_PAGE_SIZE = 10;

const ENROLLMENT_BADGE: Record<EnrollmentState, string> = {
  Active: '',
  Suspended: 'bg-amber-50 text-amber-700',
  Expelled: 'bg-red-50 text-red-700',
  Transferred: 'bg-slate-100 text-slate-600',
};

interface UserDirectoryTableProps {
  userType: 'students' | 'teachers' | 'parents' | 'staff';
}

type GroupMode = 'none' | 'grade' | 'stream' | 'jobTitle';

// Students can be grouped by Grade (e.g. "Grade 7") or by Stream (the actual class,
// e.g. "Grade 7 East") — each a finer/coarser slice of the same roster. Staff only
// have one grouping dimension worth offering. Teachers/parents get none.
const GROUP_OPTIONS: Record<UserDirectoryTableProps['userType'], { key: GroupMode; label: string }[]> = {
  students: [
    { key: 'grade', label: 'Grade' },
    { key: 'stream', label: 'Stream' },
    { key: 'none', label: 'Flat List' },
  ],
  staff: [
    { key: 'jobTitle', label: 'Job Title' },
    { key: 'none', label: 'Flat List' },
  ],
  teachers: [],
  parents: [],
};

const defaultGroupMode = (t: UserDirectoryTableProps['userType']): GroupMode =>
  t === 'students' ? 'grade' : t === 'staff' ? 'jobTitle' : 'none';

const AVATAR_COLOR: Record<UserDirectoryTableProps['userType'], string> = {
  teachers: 'bg-purple-100 text-purple-700',
  students: 'bg-blue-100 text-blue-700',
  parents: 'bg-emerald-100 text-emerald-700',
  staff: 'bg-amber-100 text-amber-700',
};

export default function UserDirectoryTable({ userType }: UserDirectoryTableProps) {
  // --- SECURE RBAC: Pull the role from the DashboardLayout ---
  const { role } = useOutletContext<{ role: string }>();

  // --- STRICT RBAC VIEW LOGIC ---
  // Admins view everyone. Teachers ONLY view Students.
  const canViewProfile = role === 'admin' || (role === 'teacher' && userType === 'students');

  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  // Grouping: students by Grade or Stream, staff by Job Title — categories large enough
  // (and consistently populated) to make "find a specific person" meaningfully easier.
  const groupOptions = GROUP_OPTIONS[userType];
  const supportsGrouping = groupOptions.length > 0;
  const [groupMode, setGroupMode] = useState<GroupMode>(defaultGroupMode(userType));
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // Pagination is per-group when grouped (each grade/stream/job-title paginates on its
  // own), keyed by group name; PAGE_SIZE-capped like the flat-list pagination below.
  const [groupPages, setGroupPages] = useState<Record<string, number>>({});
  const getGroupPage = (key: string) => groupPages[key] ?? 1;
  const setGroupPage = (key: string, page: number) =>
    setGroupPages((prev) => ({ ...prev, [key]: page }));

  const toggleGroupCollapse = (key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<{ id: number, name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const fetchUsers = async () => {
      setLoading(true);
      try {
        const response = await api.get(`/api/approved-users/${userType}/`);
        const data = response.data;

        if (data.status === 'success') {
          setUsers(data.data);
        } else {
          setUsers([]);
        }
      } catch (error) {
        console.error("Failed to fetch users", error);
        setUsers([]);
      }
      setLoading(false);
    };

    fetchUsers();
  }, [userType, role]);

  const filteredUsers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const matches = !q ? users : users.filter((u) =>
      u.name.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q)
    );

    // Always alphabetical by name, so the list order is predictable everywhere.
    return [...matches].sort((a, b) => a.name.localeCompare(b.name));
  }, [users, searchTerm]);

  // Reset back to page 1 (and clear per-group pages) whenever the underlying result set
  // changes shape, so a stale page number never lands the user on an empty page after
  // searching/switching tabs. Adjusted during render (React's recommended pattern for
  // this) rather than an effect, since it only needs to run before paint.
  const filterKey = `${userType}|${searchTerm}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setCurrentPage(1);
    setGroupPages({});
  }

  // Reset grouping/collapse/page state when navigating to a different directory tab,
  // so e.g. leaving "students" mid-way through "Grouped by Stream" doesn't leak into staff.
  const [prevUserType, setPrevUserType] = useState(userType);
  if (userType !== prevUserType) {
    setPrevUserType(userType);
    setGroupMode(defaultGroupMode(userType));
  }

  // Reset collapse/page state on a grouping-mode switch — group names from the old mode
  // (e.g. "Grade 7") are meaningless once regrouped by a different key (e.g. "East").
  const [prevGroupMode, setPrevGroupMode] = useState(groupMode);
  if (groupMode !== prevGroupMode) {
    setPrevGroupMode(groupMode);
    setCollapsedGroups(new Set());
    setGroupPages({});
  }

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));

  const paginatedUsers = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredUsers.slice(start, start + PAGE_SIZE);
  }, [filteredUsers, currentPage]);

  // Grouped mode paginates PER GROUP (each grade/stream/job-title has its own 20-per-page
  // window) rather than paginating the flat list and letting groups fall wherever they land.
  const groupedUsers = useMemo(() => {
    if (groupMode === 'none') return null;

    const keyOf = (u: DirectoryUser) => {
      if (groupMode === 'grade') return u.grade_name || 'Not Assigned';
      if (groupMode === 'stream') return u.class || 'Not Assigned';
      return u.job_title || 'Unspecified';
    };

    const groups = new Map<string, DirectoryUser[]>();
    filteredUsers.forEach((u) => {
      const key = keyOf(u);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(u);
    });

    const entries = Array.from(groups.entries());
    if (groupMode === 'grade' || groupMode === 'stream') {
      // Stream groups (e.g. "Grade 7 East") share a grade_order with every member,
      // since a stream is scoped to one grade — sort by grade first, then name.
      entries.sort((a, b) =>
        (a[1][0]?.grade_order ?? 9999) - (b[1][0]?.grade_order ?? 9999) || a[0].localeCompare(b[0])
      );
    } else {
      entries.sort((a, b) => a[0].localeCompare(b[0]));
    }
    return entries;
  }, [filteredUsers, groupMode]);

  const classTeacherCount = useMemo(
    () => userType === 'teachers' ? users.filter((u) => u.is_class_teacher).length : 0,
    [users, userType]
  );

  const needsAttentionCount = useMemo(() => {
    if (userType === 'students') return users.filter((u) => u.enrollment_state && u.enrollment_state !== 'Active').length;
    if (userType === 'parents') return users.filter((u) => (u.children_count ?? 0) === 0).length;
    return 0;
  }, [users, userType]);

  const confirmDelete = (id: number, name: string) => {
    setUserToDelete({ id, name });
    setIsModalOpen(true);
  };

  const executeDelete = async () => {
    if (!userToDelete) return;
    setIsDeleting(true);

    try {
      const response = await api.post('/api/delete-user/', {
        user_type: userType,
        id: userToDelete.id
      });
      const data = response.data;

      if (data.status === 'success') {
        toast.success('User permanently deleted.');
        setUsers(users.filter(user => user.id !== userToDelete.id));
        setIsModalOpen(false);
      } else {
        toast.error("Deletion failed: " + data.message);
      }
    } catch (error) {
      console.error("Failed to delete user", error);
      toast.error("An error occurred while deleting the user.");
    }

    setIsDeleting(false);
    setUserToDelete(null);
  };

  const secondaryColumnLabel = userType === 'students' ? 'Class' : userType === 'teachers' ? 'Subjects Taught' : userType === 'staff' ? 'Job Title' : 'Linked Students';

  const renderUserRow = (user: DirectoryUser) => (
    <tr key={user.id} className="hover:bg-slate-50/70 transition-colors group">
      <td className="py-3 px-5">
        <div className="flex items-center gap-3">
          <div className={`relative w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${AVATAR_COLOR[userType]}`}>
            {user.name.charAt(0).toUpperCase()}
            {userType === 'teachers' && user.is_class_teacher && (
              <span
                title="Class Teacher"
                className="absolute -top-1 -right-1 w-4 h-4 bg-amber-400 border-2 border-white rounded-full flex items-center justify-center"
              >
                <Star className="w-2 h-2 fill-white text-white" />
              </span>
            )}
          </div>
          <div className="flex flex-col">
            <span className="font-semibold text-slate-800">{user.name}</span>
            {userType === 'teachers' && user.is_class_teacher && (
              <span className="text-[11px] font-semibold text-amber-600">Class Teacher &middot; {user.class_teacher_of}</span>
            )}
            {userType === 'students' && user.enrollment_state && user.enrollment_state !== 'Active' && (
              <span className={`text-[11px] font-bold w-fit px-1.5 rounded ${ENROLLMENT_BADGE[user.enrollment_state]}`}>
                {user.enrollment_state}
              </span>
            )}
            {userType === 'parents' && (
              <span className="text-[11px] font-semibold text-slate-400">
                {user.relationship}
                {(user.children_count ?? 0) === 0 && <span className="text-amber-600"> &middot; No children linked</span>}
              </span>
            )}
          </div>
        </div>
      </td>
      <td className="py-3 px-5 text-slate-500">{user.username}</td>
      <td className="py-3 px-5 text-slate-500">{user.email}</td>
      <td className="py-3 px-5">
        {userType === 'students' && (
          <span className="text-xs font-semibold bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full">{user.class}</span>
        )}
        {userType === 'teachers' && (
          <span className="text-slate-500 text-sm">{user.subjects || <span className="text-slate-300 italic">None listed</span>}</span>
        )}
        {userType === 'parents' && (
          user.children_detail && user.children_detail.length > 0 ? (
            <div className="flex flex-wrap gap-1 max-w-75">
              {user.children_detail.map((c) => (
                <span key={c.id} className="text-xs font-medium bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full whitespace-nowrap">
                  {c.name} <span className="text-emerald-500">&middot; {c.class}</span>
                </span>
              ))}
            </div>
          ) : (
            <span className="text-slate-300 italic text-sm">No children linked</span>
          )
        )}
        {userType === 'staff' && (
          <span className="text-slate-500 text-sm">{user.job_title || <span className="text-slate-300 italic">Not specified</span>}</span>
        )}
      </td>
      <td className="py-3 px-5 text-right">
        <div className="flex justify-end gap-2 opacity-80 group-hover:opacity-100 transition">

          {canViewProfile && (
            <Link
              to={`/${role}-dashboard/${userType}/view/${user.id}`}
              title="View Profile"
              className="w-8 h-8 flex items-center justify-center rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
            >
              <Eye className="w-4 h-4" />
            </Link>
          )}

          {role === 'admin' && (
            <>
              <Link
                to={`/admin-dashboard/${userType}/edit/${user.id}`}
                title="Edit"
                className="w-8 h-8 flex items-center justify-center rounded-full bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors"
              >
                <Edit className="w-4 h-4" />
              </Link>
              <button
                onClick={() => confirmDelete(user.id, user.name)}
                title="Delete"
                className="w-8 h-8 flex items-center justify-center rounded-full bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}

        </div>
      </td>
    </tr>
  );

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 animate-pulse space-y-4">
        <div className="h-8 w-48 bg-slate-200 rounded-lg"></div>
        {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-14 bg-slate-100 rounded-xl"></div>)}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">

      {/* Header: count + search */}
      <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-base font-bold text-slate-800 capitalize">Active {userType}</h2>
          <span className="bg-slate-100 text-slate-500 text-xs font-bold px-2.5 py-1 rounded-full">{users.length}</span>
          {userType === 'teachers' && classTeacherCount > 0 && (
            <span className="flex items-center gap-1 bg-amber-50 text-amber-700 text-xs font-bold px-2.5 py-1 rounded-full">
              <Star className="w-3 h-3 fill-amber-500 text-amber-500" /> {classTeacherCount} Class Teacher{classTeacherCount !== 1 ? 's' : ''}
            </span>
          )}
          {userType === 'students' && needsAttentionCount > 0 && (
            <span className="flex items-center gap-1 bg-red-50 text-red-700 text-xs font-bold px-2.5 py-1 rounded-full">
              <ShieldAlert className="w-3 h-3" /> {needsAttentionCount} Need Attention
            </span>
          )}
          {userType === 'parents' && needsAttentionCount > 0 && (
            <span className="flex items-center gap-1 bg-amber-50 text-amber-700 text-xs font-bold px-2.5 py-1 rounded-full">
              <UserX className="w-3 h-3" /> {needsAttentionCount} Unlinked
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {supportsGrouping && (
            <div className="flex items-center gap-0.5 rounded-full ring-1 ring-slate-200 bg-slate-50 p-1">
              {groupOptions.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setGroupMode(opt.key)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors whitespace-nowrap ${
                    groupMode === opt.key
                      ? 'bg-white text-blue-600 shadow-sm ring-1 ring-slate-200'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 rounded-full ring-1 ring-slate-200 px-3 py-2 bg-slate-50 focus-within:ring-2 focus-within:ring-blue-500 focus-within:bg-white transition-all w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              type="text"
              placeholder={`Search ${userType} by name, ID or email...`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-transparent outline-none text-sm text-slate-700 placeholder:text-slate-400"
            />
          </div>
        </div>
      </div>

      {filteredUsers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
          <UsersIcon className="w-12 h-12 text-slate-300" />
          <p className="text-sm font-medium">
            {users.length === 0 ? `No active ${userType} found.` : `No ${userType} match "${searchTerm}".`}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-400 uppercase text-[11px] tracking-wider">
                <th className="py-3 px-5 font-bold">Name</th>
                <th className="py-3 px-5 font-bold">Username / ID</th>
                <th className="py-3 px-5 font-bold">Email Address</th>
                <th className="py-3 px-5 font-bold">{secondaryColumnLabel}</th>
                <th className="py-3 px-5 font-bold text-right">Actions</th>
              </tr>
            </thead>
            {groupedUsers ? (
              groupedUsers.map(([groupName, groupUsers]) => {
                const isCollapsed = collapsedGroups.has(groupName);
                // Stream groups get a tighter 10-per-page window than grade/job-title groups.
                const groupPageSize = groupMode === 'stream' ? STREAM_GROUP_PAGE_SIZE : PAGE_SIZE;
                const groupPage = getGroupPage(groupName);
                const groupTotalPages = Math.max(1, Math.ceil(groupUsers.length / groupPageSize));
                const groupPageUsers = groupUsers.slice((groupPage - 1) * groupPageSize, groupPage * groupPageSize);
                return (
                  <tbody key={groupName} className="divide-y divide-slate-50">
                    <tr className="bg-slate-100/70">
                      <td colSpan={5} className="px-5 py-2">
                        <button
                          type="button"
                          onClick={() => toggleGroupCollapse(groupName)}
                          className="flex items-center gap-2 text-xs font-bold text-slate-600 uppercase tracking-wider hover:text-blue-600 transition-colors w-full"
                        >
                          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                          {groupName}
                          <span className="bg-white text-slate-400 border border-slate-200 px-2 py-0.5 rounded-full normal-case font-semibold">
                            {groupUsers.length}
                          </span>
                        </button>
                      </td>
                    </tr>
                    {!isCollapsed && groupPageUsers.map(renderUserRow)}
                    {/* Per-group pagination — each grade/stream/job-title paginates on its own */}
                    {!isCollapsed && groupTotalPages > 1 && (
                      <tr className="bg-slate-50/60">
                        <td colSpan={5} className="px-5 py-2.5">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-[11px] text-slate-400">
                              {(groupPage - 1) * groupPageSize + 1}
                              {'–'}
                              {Math.min(groupPage * groupPageSize, groupUsers.length)}
                              {' of '}
                              {groupUsers.length}
                            </p>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setGroupPage(groupName, Math.max(1, groupPage - 1))}
                                disabled={groupPage === 1}
                                aria-label={`Previous page in ${groupName}`}
                                className="w-6 h-6 flex items-center justify-center rounded-full ring-1 ring-slate-200 text-slate-500 hover:bg-white disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                              >
                                <ChevronLeft className="w-3.5 h-3.5" />
                              </button>
                              <span className="text-[11px] font-semibold text-slate-500 px-1 min-w-[46px] text-center">
                                {groupPage}/{groupTotalPages}
                              </span>
                              <button
                                type="button"
                                onClick={() => setGroupPage(groupName, Math.min(groupTotalPages, groupPage + 1))}
                                disabled={groupPage === groupTotalPages}
                                aria-label={`Next page in ${groupName}`}
                                className="w-6 h-6 flex items-center justify-center rounded-full ring-1 ring-slate-200 text-slate-500 hover:bg-white disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                              >
                                <ChevronRight className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                );
              })
            ) : (
              <tbody className="divide-y divide-slate-50">
                {paginatedUsers.map(renderUserRow)}
              </tbody>
            )}
          </table>
        </div>
      )}

      {/* Flat-list pagination — capped at PAGE_SIZE (20) people per page. Only relevant when
          ungrouped; grouped mode paginates per-group instead (see above). */}
      {groupMode === 'none' && filteredUsers.length > 0 && totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-5 py-4 border-t border-slate-100">
          <p className="text-xs text-slate-500">
            Showing <span className="font-semibold text-slate-700">{(currentPage - 1) * PAGE_SIZE + 1}</span>
            {'–'}
            <span className="font-semibold text-slate-700">{Math.min(currentPage * PAGE_SIZE, filteredUsers.length)}</span>
            {' of '}
            <span className="font-semibold text-slate-700">{filteredUsers.length}</span>
          </p>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              aria-label="Previous page"
              className="w-8 h-8 flex items-center justify-center rounded-full ring-1 ring-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-semibold text-slate-600 px-2 min-w-[70px] text-center">
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              aria-label="Next page"
              className="w-8 h-8 flex items-center justify-center rounded-full ring-1 ring-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* CUSTOM CONFIRMATION MODAL */}
      {isModalOpen && userToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-red-50 p-4 border-b border-red-100 flex items-center justify-between">
              <div className="flex items-center gap-2 text-red-600 font-bold">
                <AlertTriangle className="w-5 h-5" />
                Confirm Deletion
              </div>
              <button onClick={() => setIsModalOpen(false)} title="Close" className="text-red-400 hover:text-red-700 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 text-slate-700">
              <p className="mb-2">Are you absolutely sure you want to permanently delete <strong>{userToDelete.name}</strong>?</p>
              <p className="text-sm text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-100">
                This action will erase their account, login credentials, and all related profile data from the database. <strong>This cannot be undone.</strong>
              </p>
            </div>
            <div className="px-6 py-4 bg-slate-50 flex justify-end gap-3 border-t border-slate-100">
              <button
                onClick={() => setIsModalOpen(false)}
                disabled={isDeleting}
                className="px-4 py-2 text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={executeDelete}
                disabled={isDeleting}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium flex items-center gap-2 disabled:bg-red-300"
              >
                {isDeleting ? 'Deleting...' : 'Yes, Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
