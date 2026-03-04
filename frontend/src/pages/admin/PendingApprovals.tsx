import { useParams, Navigate } from 'react-router-dom';
import ApprovalTable from '../../components/ApprovalTable';

export default function PendingApprovals() {
  // Extract the specific user category from the browser URL
  const { userType } = useParams<{ userType: string }>();

  // Validate the URL parameter to prevent errors
  const validTypes = ['students', 'teachers', 'parents'];
  if (!userType || !validTypes.includes(userType)) {
    return <Navigate to="/admin-dashboard" replace />;
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-800">User Approvals Center</h1>
        <p className="text-gray-600 mt-1">Review and manage new account registrations.</p>
      </div>

      {/* Pass the validated URL parameter into our reusable component */}
      <ApprovalTable userType={userType as 'students' | 'teachers' | 'parents'} />
    </div>
  );
}