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
import RequirePermission from './components/common/RequirePermission';
import { NoticesRoute, EventsRoute, AttendanceRoute, ExamsRoute, AssignmentsRoute, ResultsRoute } from './components/common/PermissionRoutes';


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

          {/* TEACHER ROUTE GROUP — permission-driven: a teacher gets the default Teacher role's
              permissions plus whatever extra roles an admin assigns, and every route below is
              only reachable while the matching code is held (RequirePermission), so the page set
              follows the user's own permissions and updates live when an admin changes them.
              The sidebar/home cards come from libs/navCatalog.ts. */}
          <Route path="/teacher-dashboard/*" element={<DashboardLayout role="teacher" />}>
            <Route index element={<TeacherDashboard />} />
            <Route path="messages" element={<ChatDashboard />} />
            <Route path="profile" element={<TeacherProfile />} />
            <Route path="search" element={<SearchResults />} />

            <Route path="teachers" element={<UserDirectory userType="teachers" />} />
            <Route path="students" element={<UserDirectory userType="students" />} />
            <Route path="parents" element={<UserDirectory userType="parents" />} />

            {/* CLASSES MATRIX ROUTES FOR THE TEACHER PORTAL */}
            <Route path="classes" element={<RequirePermission code="classes.view"><ClassesPage /></RequirePermission>} />
            <Route path="curriculum" element={<RequirePermission code="curriculum.view"><CurriculumHub /></RequirePermission>} />
            <Route path="classes/view/:id" element={<RequirePermission code="classes.view"><ViewClass /></RequirePermission>} />
            <Route path="classes/assign-subjects/:gradeId/:studentId" element={<AssignSubjectsPage />} />

            <Route path="timetable" element={<RequirePermission code="timetable.view"><TimetableManager /></RequirePermission>} />
            <Route path=":userType/view/:id" element={<ViewProfile />} />

            <Route path="subjects" element={<RequirePermission code="curriculum.view"><SubjectsPage /></RequirePermission>} />
            <Route path="subjects/view/:id" element={<RequirePermission code="curriculum.view"><ViewSubject /></RequirePermission>} />

            {/* Routes a teacher only reaches when an extra role grants the matching permission. */}
            <Route path="classes/edit/:id" element={<RequirePermission code="classes.edit"><EditClass /></RequirePermission>} />
            <Route path="subjects/edit/:id" element={<RequirePermission code="curriculum.edit"><EditSubject /></RequirePermission>} />
            <Route path=":userType/edit/:id" element={<RequirePermission code="users.edit"><EditProfile /></RequirePermission>} />
            <Route path="allocations" element={<RequirePermission code="allocations.view"><AllocationDashboard /></RequirePermission>} />
            <Route path="finance" element={<RequirePermission code="finance.view"><FinanceHub /></RequirePermission>} />

            <Route path="attendance" element={<RequirePermission code="attendance.view"><AttendanceHub role='teacher' /></RequirePermission>} />

            <Route path="assignments" element={<RequirePermission code="assignments.view"><AssignmentsHub role="teacher" /></RequirePermission>} />
            <Route path="assignments/create" element={<RequirePermission code="assignments.edit"><AssignmentCreator role="teacher" /></RequirePermission>} />
            <Route path="assignments/edit/:id" element={<RequirePermission code="assignments.edit"><EditAssignment role="teacher" /></RequirePermission>} />
            <Route path="assignments/:id/submissions" element={<RequirePermission code="assignments.edit"><SubmissionManager role="teacher" /></RequirePermission>} />

            <Route path="results" element={<RequirePermission code="results.view"><ResultsHub role="teacher" /></RequirePermission>} />

            <Route path="exams" element={<RequirePermission code="exams.view"><ExamsHub role="teacher" /></RequirePermission>} />

            <Route path="events" element={<EventsRoute />} />

            <Route path="notices" element={<NoticesRoute />} />

            {/* LEAVE MANAGEMENT: APPLY & TRACK your own; review others' only if granted leave.approve */}
            <Route path="leave-requests" element={<LeaveRequestsHub role="teacher" />} />
            <Route path="leave-requests/review" element={<RequirePermission code="leave.approve"><ApproveLeaves /></RequirePermission>} />

            {/* PATHWAY REQUESTS: class teachers decide requests from their own classes */}
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

          {/* STAFF ROUTE GROUP — non-teaching staff (librarian, finance officer, secretary, etc).
              Staff have no fixed capability set: an admin assigns roles (Roles & Permissions) and
              every route below is reachable only while the matching permission code is held
              (RequirePermission) — so two staff members see different pages, and a page
              disappears (and the user is moved home) the moment its permission is removed. The
              sidebar and home cards come from libs/navCatalog.ts, and every API call is also gated
              server-side by the same code. A page that has an admin/manage variant derives it from
              the *edit* code, not from which dashboard it is in. */}
          <Route path="/staff-dashboard/*" element={<DashboardLayout role="staff" />}>
            <Route index element={<StaffDashboard />} />
            <Route path="messages" element={<ChatDashboard />} />
            <Route path="profile" element={<TeacherProfile />} />
            <Route path="search" element={<SearchResults />} />

            <Route path="finance" element={<RequirePermission code="finance.view"><FinanceHub /></RequirePermission>} />
            <Route path="notices" element={<RequirePermission code="notices.edit"><NoticesRoute /></RequirePermission>} />
            <Route path="events" element={<RequirePermission code="events.edit"><EventsRoute /></RequirePermission>} />
            {/* Every staff member can apply for their own leave (no permission); reviewing others' is granted. */}
            <Route path="leave-requests" element={<LeaveRequestsHub role="staff" />} />
            <Route path="leave-requests/review" element={<RequirePermission code={['leave.view', 'leave.approve']}><ApproveLeaves /></RequirePermission>} />
            <Route path="classes" element={<RequirePermission code="classes.view"><ClassesPage /></RequirePermission>} />
            <Route path="classes/view/:id" element={<RequirePermission code="classes.view"><ViewClass /></RequirePermission>} />
            <Route path="classes/edit/:id" element={<RequirePermission code="classes.edit"><EditClass /></RequirePermission>} />
            <Route path="subjects" element={<RequirePermission code="curriculum.view"><SubjectsPage /></RequirePermission>} />
            <Route path="subjects/view/:id" element={<RequirePermission code="curriculum.view"><ViewSubject /></RequirePermission>} />
            <Route path="subjects/edit/:id" element={<RequirePermission code="curriculum.edit"><EditSubject /></RequirePermission>} />
            <Route path="curriculum" element={<RequirePermission code="curriculum.view"><CurriculumHub /></RequirePermission>} />
            <Route path="timetable" element={<RequirePermission code="timetable.view"><TimetableManager /></RequirePermission>} />
            {/* Each hub derives its own admin-vs-teacher variant from the matching *.edit code
                (see PermissionRoutes.tsx), so a staff member with only *.view never sees manage
                controls the server would reject. */}
            <Route path="attendance" element={<RequirePermission code="attendance.view"><AttendanceRoute /></RequirePermission>} />
            <Route path="exams" element={<RequirePermission code="exams.view"><ExamsRoute /></RequirePermission>} />
            <Route path="results" element={<RequirePermission code="results.view"><ResultsRoute /></RequirePermission>} />
            <Route path="assignments" element={<RequirePermission code="assignments.view"><AssignmentsRoute /></RequirePermission>} />
            <Route path="allocations" element={<RequirePermission code="allocations.view"><AllocationDashboard /></RequirePermission>} />

            <Route path=":userType/view/:id" element={<RequirePermission code="users.view"><ViewProfile /></RequirePermission>} />
            <Route path=":userType/edit/:id" element={<RequirePermission code="users.edit"><EditProfile /></RequirePermission>} />
          </Route>

          {/* Catch-all route to prevent 404 errors */}
          <Route path="*" element={<Navigate to="/admin-dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}