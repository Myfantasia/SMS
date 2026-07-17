import { GraduationCap, Users, UserSquare2, Briefcase } from 'lucide-react';
import UserDirectoryTable from '../../components/UserDirectoryTable';

interface UserDirectoryProps {
  userType: 'students' | 'teachers' | 'parents' | 'staff';
}

const DIRECTORY_META = {
  teachers: { icon: GraduationCap, color: 'text-purple-600 bg-purple-50', label: 'Faculty' },
  students: { icon: Users, color: 'text-blue-600 bg-blue-50', label: 'Learners' },
  parents: { icon: UserSquare2, color: 'text-emerald-600 bg-emerald-50', label: 'Guardians' },
  staff: { icon: Briefcase, color: 'text-amber-600 bg-amber-50', label: 'Support Staff' },
} as const;

export default function UserDirectory({ userType }: UserDirectoryProps) {
  const meta = DIRECTORY_META[userType];
  const Icon = meta.icon;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className={`p-3 rounded-2xl ${meta.color}`}>
          <Icon className="w-7 h-7" strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800 capitalize">{userType} Directory</h1>
          <p className="text-slate-500 text-sm mt-0.5">{meta.label} &middot; manage, edit, and view active profiles.</p>
        </div>
      </div>

      <UserDirectoryTable userType={userType} />
    </div>
  );
}
