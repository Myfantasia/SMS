import UserDirectoryTable from '../../components/UserDirectoryTable';

interface UserDirectoryProps {
  userType: 'students' | 'teachers' | 'parents';
}

export default function UserDirectory({ userType }: UserDirectoryProps) {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-800 capitalize">{userType} Directory</h1>
        <p className="text-gray-600 mt-1">Manage, edit, and view active {userType} profiles.</p>
      </div>

      <UserDirectoryTable userType={userType} />
    </div>
  );
}