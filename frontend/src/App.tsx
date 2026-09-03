import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import DashboardLayout from './layouts/DashboardLayouts';
import PublicShell from './public/PublicShell';
import Home from './public/pages/Home';
import PortalSelection from './public/pages/PortalSelection';
import AboutUs from './public/pages/AboutUs';
import ContactUs from './public/pages/ContactUs';
import Events from './public/pages/Events';
import BlogList from './public/pages/blog/BlogList';
import BlogDetail from './public/pages/blog/BlogDetail';
import PrivacyPolicy from './public/pages/PrivacyPolicy';
import TermsOfService from './public/pages/TermsOfService';
import SystemStatus from './public/pages/SystemStatus';
import AdminClick from './public/pages/admin/AdminClick';
import AdminLogin from './public/pages/admin/AdminLogin';
import AdminSignup from './public/pages/admin/AdminSignup';
import StudentClick from './public/pages/student/StudentClick';
import StudentLogin from './public/pages/student/StudentLogin';
import StudentSignup from './public/pages/student/StudentSignup';
import TeacherClick from './public/pages/teacher/TeacherClick';
import TeacherLogin from './public/pages/teacher/TeacherLogin';
import TeacherSignup from './public/pages/teacher/TeacherSignup';
import ParentClick from './public/pages/parent/ParentClick';
import ParentLogin from './public/pages/parent/ParentLogin';
import ParentSignup from './public/pages/parent/ParentSignup';
import StaffClick from './public/pages/staff/StaffClick';
import StaffLogin from './public/pages/staff/StaffLogin';
import StaffSignup from './public/pages/staff/StaffSignup';
import WaitForApproval from './public/pages/WaitForApproval';
import RequestReset from './public/pages/password-reset/RequestReset';
import ResetDone from './public/pages/password-reset/ResetDone';
import ResetConfirm from './public/pages/password-reset/ResetConfirm';
import ResetComplete from './public/pages/password-reset/ResetComplete';
import AdminDashboard from './pages/admin/AdminDashboard';
import PendingApprovals from './pages/admin/PendingApprovals';
import UserDirectory from './pages/admin/UserDirectory';
import ViewProfile from './pages/admin/ViewProfile';
import EditProfile from './pages/admin/EditProfile';
import AdminProfile from './pages/admin/AdminProfile';
import RolesPermissions from './pages/admin/RolesPermissions';
import RoleEditor from './pages/admin/RoleEditor';
import CurriculumHub from './pages/admin/CurriculumHub';
import PathwayRequestsHub from './components/curriculum/PathwayRequestsHub';
import StudentPathwayChoice from './pages/student/StudentPathwayChoice';
import SearchResults from './components/SearchResults';
import AcademicHub from './components/academics/AcademicHub';
import SubjectsPage from './components/lists pages/SubjectsPage';
import ClassesPage from './components/lists pages/ClassesPage';
import ViewSubject from './components/action routes/ViewSubject';
import ViewClass from './components/action routes/ViewClass';
import EditSubject from './components/action routes/EditSubject';
import EditClass from './components/action routes/EditClass';
import TimetableManager from './components/timetable/TimetableManager';
import AttendanceHub from './components/attendaces/AttendanceHub';
import EventsHub from './components/events/EventsHub';
import NoticesHub from './components/notices/NoticesHub';
import ExamsHub from './components/exams/ExamsHub';
import ResultsHub from './components/results/ResultsHub';
import AllocationDashboard from './components/subjectAllocations/AllocationDashboard';
import AssignmentsHub from './components/assignments/AssignmentsHub';
import AssignmentCreator from './components/assignments/AssignmentCreator';
import SubmissionManager from './components/assignments/SubmissionManager';
import EditAssignment from './components/assignments/EditAssignments';
import AssignmentTaker from './components/assignments/AssignmentTaker';
import AssignmentReview from './components/assignments/AssignmentReview';
import TeacherDashboard from './pages/teacher/TeacherDashboard';
import TeacherProfile from './pages/teacher/TeacherProfile';
import StudentDashboard from './pages/student/StudentDashboard';
import StudentProfile from './pages/student/StudentProfile';
import StudentTasks from './pages/student/StudentTasks';
import StudentAssignments from './pages/student/StudentAssignments';
import StudentSubjects from './pages/student/StudentSubjects';
import ParentDashboard from './pages/parent/ParentDashboard';
import ParentProfile from './pages/parent/ParentProfile';
import ParentAssignments from './pages/parent/ParentAssignments';
import StaffDashboard from './pages/staff/StaffDashboard';
import ChatDashboard from './components/chats/ChatDashboard';
import AssignSubjectsPage from './components/action routes/AssignSubjectsPage';
import LeaveRequestsHub from './components/leave/LeaveRequestsHub';
import ApproveLeaves from './components/leave/ApproveLeaves';
import FinanceHub from './components/Finance/FinanceHub';
import ContentHub from './components/content/ContentHub';
import Trash from './pages/admin/Trash';


export default function App() {
  return (
    <BrowserRouter>
      <Toaster 
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#334155', // Slate-700 background for a pro look
            color: '#fff',
          },
          success: {
            style: { background: '#059669' }, // Emerald-600 for success
          },
          error: {
            style: { background: '#dc2626' }, // Red-600 for errors
          },
        }}
      />
      {/* Chat data (inbox + WS) is only wired up per-dashboard, inside DashboardLayout,
          once a real session is confirmed -- see layouts/DashboardLayouts.tsx. Wrapping it
          here too used to open the /ws/inbox/ socket on the public (pre-login) pages,
          where the backend rejects the unauthenticated handshake on a loop. */}
      <Routes>
          {/* Public (pre-login) pages -- see /home/jordan/.claude/plans/scalable-kindling-lampson.md */}
          <Route path="/" element={<PublicShell />}>
            <Route index element={<Home />} />
            <Route path="portal" element={<PortalSelection />} />
            <Route path="aboutus" element={<AboutUs />} />
            <Route path="contactus" element={<ContactUs />} />
            <Route path="events" element={<Events />} />
            <Route path="blog" element={<BlogList />} />
            <Route path="blog/:slug" element={<BlogDetail />} />
            <Route path="privacy-policy" element={<PrivacyPolicy />} />
            <Route path="terms-of-service" element={<TermsOfService />} />
            <Route path="system-status" element={<SystemStatus />} />

            <Route path="adminclick" element={<AdminClick />} />
            <Route path="adminlogin" element={<AdminLogin />} />
            <Route path="adminsignup" element={<AdminSignup />} />

            <Route path="studentclick" element={<StudentClick />} />
            <Route path="studentlogin" element={<StudentLogin />} />
            <Route path="studentsignup" element={<StudentSignup />} />

            <Route path="teacherclick" element={<TeacherClick />} />
            <Route path="teacherlogin" element={<TeacherLogin />} />
            <Route path="teachersignup" element={<TeacherSignup />} />

            <Route path="parentclick" element={<ParentClick />} />
            <Route path="parentlogin" element={<ParentLogin />} />
            <Route path="parentsignup" element={<ParentSignup />} />

            <Route path="staffclick" element={<StaffClick />} />
            <Route path="stafflogin" element={<StaffLogin />} />
            <Route path="staffsignup" element={<StaffSignup />} />

            <Route path="wait-for-approval" element={<WaitForApproval />} />

            <Route path="password-reset" element={<RequestReset />} />
            <Route path="password-reset/done" element={<ResetDone />} />
            <Route path="password-reset-confirm/:uidb64/:token" element={<ResetConfirm />} />
            <Route path="password-reset-complete" element={<ResetComplete />} />
          </Route>

          {/* Admin Route Group wrapped in the Layout */}
          <Route path="/admin-dashboard/*" element={<DashboardLayout role="admin" />}>
            <Route index element={<AdminDashboard />} />

            <Route path="search" element={<SearchResults />} />

            {/* Existing Approvals Route */}
            <Route path="approvals/:userType" element={<PendingApprovals />} />

            {/* User Directory Routes */}
            <Route path="teachers" element={<UserDirectory userType="teachers" />} />
            <Route path="students" element={<UserDirectory userType="students" />} />
            <Route path="parents" element={<UserDirectory userType="parents" />} />
            <Route path="staff" element={<UserDirectory userType="staff" />} />

            <Route path="academics" element={<AcademicHub />} />
            <Route path="curriculum" element={<CurriculumHub />} />
            <Route path="classes" element={<ClassesPage />} />
            <Route path="subjects" element={<SubjectsPage />} />

            {/* Admin Profile Route */}
            <Route path="profile" element={<AdminProfile />} />

            {/* RBAC Management */}
            <Route path="roles-permissions" element={<RolesPermissions />} />
            <Route path="roles-permissions/new" element={<RoleEditor />} />
            <Route path="roles-permissions/:id/edit" element={<RoleEditor />} />

            {/* action routes for user*/}

            <Route path=":userType/view/:id" element={<ViewProfile />} />
            <Route path=":userType/edit/:id" element={<EditProfile />} />


            <Route path="classes/view/:id" element={<ViewClass />} />
            <Route path="subjects/view/:id" element={<ViewSubject />} />

            <Route path="classes/edit/:id" element={<EditClass />} />
            <Route path="subjects/edit/:id" element={<EditSubject />} />

            <Route path="allocations" element={<AllocationDashboard />} />

            {/* ADD THE TIMETABLE ROUTE */}
            <Route path="timetable" element={<TimetableManager />} />

            {/* --- ADD THE ATTENDANCE ROUTE HERE --- */}
            <Route path="attendance" element={<AttendanceHub  role='admin'/>} />

            <Route path="events" element={<EventsHub role="admin" />} />

            <Route path="notices" element={<NoticesHub role="admin" />} />

            <Route path="exams" element={<ExamsHub role="admin" />} />

            <Route path="results" element={<ResultsHub role="admin" />} />

            {/* --- LEAVE MANAGEMENT ROUTES --- */}
            <Route path="leave-requests" element={<LeaveRequestsHub role="admin" />} />
            <Route path="approvals/leave" element={<ApproveLeaves />} />

            {/* --- PATHWAY REQUESTS: admin sees & decides every request --- */}
            <Route path="pathway-requests" element={<PathwayRequestsHub role="admin" />} />

            <Route path="classes/assign-subjects/:gradeId/:studentId"
              element={<AssignSubjectsPage />} 
            />

            <Route path="assignments" element={<AssignmentsHub role="admin" />} />
            <Route path="assignments/create" element={<AssignmentCreator role="admin" />} />
            <Route path="assignments/:id/submissions" element={<SubmissionManager role="admin" />} />
            <Route path="assignments/edit/:id" element={<EditAssignment role="admin" />} />

            {/* --- FINANCE: FEES & SALARY OVERVIEW --- */}
            <Route path="finance" element={<FinanceHub />} />

            {/* --- NEW: MESSAGING ROUTE --- */}
            <Route path="messages" element={<ChatDashboard />} />

            {/* --- PUBLIC-SITE CONTENT: BLOG & ALUMNI REVIEWS --- */}
            <Route path="content" element={<ContentHub />} />

            {/* --- TRASH: SOFT-DELETED ITEMS --- */}
            <Route path="trash" element={<Trash />} />
          </Route>

          {/* TEACHER ROUTE GROUP */}
          <Route path="/teacher-dashboard/*" element={<DashboardLayout role="teacher" />}>
            <Route index element={<TeacherDashboard />} />
            <Route path="messages" element={<ChatDashboard />} />
            <Route path="profile" element={<TeacherProfile />} />
            <Route path="search" element={<SearchResults />} />

            <Route path="teachers" element={<UserDirectory userType="teachers" />} />
            <Route path="students" element={<UserDirectory userType="students" />} />
            <Route path="parents" element={<UserDirectory userType="parents" />} />
            
            {/* ✅ CLASSES MATRIX ROUTES ADDED FOR THE TEACHER Portal */}
            <Route path="classes" element={<ClassesPage />} />
            <Route path="curriculum" element={<CurriculumHub />} />
            <Route path="classes/view/:id" element={<ViewClass />} />
            <Route path="classes/assign-subjects/:gradeId/:studentId" element={<AssignSubjectsPage />} />
            
            <Route path="timetable" element={<TimetableManager />} />
            <Route path=":userType/view/:id" element={<ViewProfile />} />

            <Route path="subjects" element={<SubjectsPage />} />
            <Route path="subjects/view/:id" element={<ViewSubject />} />

            {/* --- ADD THE ATTENDANCE ROUTE HERE --- */}
            <Route path="attendance" element={<AttendanceHub role='teacher' />} />

            <Route path="assignments" element={<AssignmentsHub role="teacher" />} />
            <Route path="assignments/create" element={<AssignmentCreator role="teacher" />} />
            <Route path="assignments/edit/:id" element={<EditAssignment role="teacher" />} />
            <Route path="assignments/:id/submissions" element={<SubmissionManager role="teacher" />} />

            <Route path="results" element={<ResultsHub role="teacher" />} />

            <Route path="exams" element={<ExamsHub role="teacher" />} />

            <Route path="events" element={<EventsHub role="teacher" />} />

            <Route path="notices" element={<NoticesHub role="teacher" />} />

            {/* --- LEAVE MANAGEMENT: APPLY & TRACK --- */}
            <Route path="leave-requests" element={<LeaveRequestsHub role="teacher" />} />

            {/* --- PATHWAY REQUESTS: class teachers decide requests from their own classes --- */}
            <Route path="pathway-requests" element={<PathwayRequestsHub role="teacher" />} />
          </Route>

          {/* STUDENT ROUTE GROUP */}
          <Route path="/student-dashboard/*" element={<DashboardLayout role="student" />}>
            <Route index element={<StudentDashboard />} />
            <Route path="messages" element={<ChatDashboard />} />
            <Route path="profile" element={<StudentProfile />} />
            <Route path="search" element={<SearchResults />} />

            <Route path="subjects" element={<StudentSubjects />} />
            <Route path="my-pathway" element={<StudentPathwayChoice />} />

            <Route path="exams" element={<ExamsHub role="student" />} />
            <Route path="results" element={<ResultsHub role="student" />} />

            <Route path="events" element={<EventsHub role="student" />} />
            <Route path="notices" element={<NoticesHub role="student" />} />
            <Route path="tasks" element={<StudentTasks />} />

            <Route path="assignments" element={<StudentAssignments />} />
            <Route path="assignments/:id/take" element={<AssignmentTaker />} />
            <Route path="assignments/:id/review" element={<AssignmentReview role="student" />} />
          </Route>

          {/* PARENT ROUTE GROUP */}
          <Route path="/parent-dashboard/*" element={<DashboardLayout role="parent" />}>
            <Route index element={<ParentDashboard />} />
            <Route path="messages" element={<ChatDashboard />} />
            <Route path="profile" element={<ParentProfile />} />
            <Route path="search" element={<SearchResults />} />

            <Route path="exams" element={<ExamsHub role="parent" />} />
            <Route path="results" element={<ResultsHub role="parent" />} />

            <Route path="events" element={<EventsHub role="parent" />} />
            <Route path="notices" element={<NoticesHub role="parent" />} />

            <Route path="assignments" element={<ParentAssignments />} />
            <Route path="assignments/:id/review" element={<AssignmentReview role="parent" />} />
          </Route>

          {/* STAFF ROUTE GROUP — non-teaching staff (librarian, finance officer, secretary,
              etc). Unlike the other four groups, Staff has no fixed capability set: every
              route below is reachable only if the sidebar (permission-driven, see Menu.tsx)
              actually links to it, and every underlying API call is gated server-side by the
              RBAC permission code the admin assigned via Roles & Permissions — the "admin"
              role prop passed to these shared components just selects the fuller manage-UI
              variant where one exists; it does not grant access on its own. */}
          <Route path="/staff-dashboard/*" element={<DashboardLayout role="staff" />}>
            <Route index element={<StaffDashboard />} />
            <Route path="messages" element={<ChatDashboard />} />
            <Route path="profile" element={<TeacherProfile />} />
            <Route path="search" element={<SearchResults />} />

            <Route path="finance" element={<FinanceHub />} />
            <Route path="notices" element={<NoticesHub role="admin" />} />
            <Route path="events" element={<EventsHub role="admin" />} />
            <Route path="leave-requests" element={<LeaveRequestsHub role="admin" />} />
            <Route path="classes" element={<ClassesPage />} />
            <Route path="classes/view/:id" element={<ViewClass />} />
            <Route path="curriculum" element={<CurriculumHub />} />
            <Route path="timetable" element={<TimetableManager />} />
            <Route path="attendance" element={<AttendanceHub role="admin" />} />
            <Route path="exams" element={<ExamsHub role="admin" />} />
            <Route path="results" element={<ResultsHub role="admin" />} />
            <Route path="assignments" element={<AssignmentsHub role="admin" />} />
            <Route path="allocations" element={<AllocationDashboard />} />

            <Route path=":userType/view/:id" element={<ViewProfile />} />
          </Route>

          {/* Catch-all route to prevent 404 errors */}
          <Route path="*" element={<Navigate to="/admin-dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}