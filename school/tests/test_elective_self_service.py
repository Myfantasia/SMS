import json

from django.contrib.auth.models import User
from django.test import TestCase, RequestFactory

from apps.academics.models import ClassStream, Curriculum, CurriculumPreset, GradeLevel, Subject, SubjectPool, Tier
from apps.allocations.models import SubjectQuota
from apps.identity.models import School, StudentExtra
from apps.students.models import StudentSubjectEnrollment
from school.tests.base import ExamTestDataMixin
from school.views.subject_views import api_student_elective_options, api_student_elective_request


class StudentElectiveSelfServiceTests(ExamTestDataMixin, TestCase):
    """
    Covers the new student self-service elective request flow: students can see which
    electives apply to their own grade, submit a Pending request, and withdraw it — but the
    request must feed the SAME StudentSubjectEnrollment table the existing admin Batch
    Approvals queue (ManageCurriculum.tsx / api_bulk_approve_subjects) already consumes.
    """

    def setUp(self):
        self.factory = RequestFactory()
        SubjectQuota.objects.create(grade=self.grade_cbc, subject=self.french, total_lessons=4)

    def _get_options(self, user):
        request = self.factory.get('/api/subjects/my-electives/')
        request.user = user
        return json.loads(api_student_elective_options(request).content)

    def _post_request(self, user, subject_id):
        request = self.factory.post(
            '/api/subjects/my-electives/request/',
            data=json.dumps({'subject_id': subject_id}), content_type='application/json')
        request.user = user
        return json.loads(api_student_elective_request(request).content)

    def _delete_request(self, user, enrollment_id):
        request = self.factory.delete(
            '/api/subjects/my-electives/request/',
            data=json.dumps({'enrollment_id': enrollment_id}), content_type='application/json')
        request.user = user
        return json.loads(api_student_elective_request(request).content)

    def test_lists_grade_scoped_electives_with_no_status_by_default(self):
        result = self._get_options(self.student_user)
        self.assertEqual(result['status'], 'success')
        french_option = next(e for e in result['data']['electives'] if e['subject_name'] == 'French')
        self.assertIsNone(french_option['status'])

    def test_submitting_a_request_creates_a_pending_enrollment(self):
        result = self._post_request(self.student_user, self.french.id)
        self.assertEqual(result['status'], 'success')

        enrollment = StudentSubjectEnrollment.objects.get(student=self.student, subject=self.french)
        self.assertEqual(enrollment.status, 'Pending')

    def test_core_subject_cannot_be_requested(self):
        result = self._post_request(self.student_user, self.maths.id)
        self.assertEqual(result['status'], 'error')
        self.assertFalse(StudentSubjectEnrollment.objects.filter(student=self.student, subject=self.maths).exists())

    def test_subject_not_in_own_grade_is_rejected(self):
        # French has no SubjectQuota row for the 8-4-4 grade in this test setup.
        other_elective_result = self._post_request(self.student_user, self.french.id)
        self.assertEqual(other_elective_result['status'], 'success')  # sanity: valid for CBC grade

        SubjectQuota.objects.filter(grade=self.grade_cbc, subject=self.french).delete()
        result = self._post_request(self.student_user, self.french.id)
        self.assertEqual(result['status'], 'error')

    def test_already_approved_subject_cannot_be_re_requested(self):
        StudentSubjectEnrollment.objects.create(
            student=self.student, subject=self.french, academic_year=self.year, status='Approved')
        result = self._post_request(self.student_user, self.french.id)
        self.assertEqual(result['status'], 'error')

    def test_withdraw_removes_a_pending_request(self):
        submit_result = self._post_request(self.student_user, self.french.id)
        enrollment_id = submit_result['data']['enrollment_id']

        result = self._delete_request(self.student_user, enrollment_id)
        self.assertEqual(result['status'], 'success')
        self.assertFalse(StudentSubjectEnrollment.objects.filter(id=enrollment_id).exists())

    def test_cannot_withdraw_an_approved_request(self):
        enrollment = StudentSubjectEnrollment.objects.create(
            student=self.student, subject=self.french, academic_year=self.year, status='Approved')
        result = self._delete_request(self.student_user, enrollment.id)
        self.assertEqual(result['status'], 'error')
        self.assertTrue(StudentSubjectEnrollment.objects.filter(id=enrollment.id).exists())

    def test_student_cannot_withdraw_another_students_request(self):
        enrollment = StudentSubjectEnrollment.objects.create(
            student=self.other_student, subject=self.french, academic_year=self.year, status='Pending')
        result = self._delete_request(self.student_user, enrollment.id)
        self.assertEqual(result['status'], 'error')
        self.assertTrue(StudentSubjectEnrollment.objects.filter(id=enrollment.id).exists())


class PoolDrivenElectiveSelfServiceTests(ExamTestDataMixin, TestCase):
    """
    Covers self-service requests for CurriculumPreset/SubjectPool-driven electives (the newer
    system api_student_elective_options already reads from — see its 'preset' branch), as
    opposed to the legacy flat SubjectQuota electives covered above. Reproduces a real bug: a
    grade with a resolved preset has pool subjects that carry no SubjectQuota row at all (they
    were never meant to need one), but api_student_elective_request's validity check looked at
    SubjectQuota exclusively, 400ing on every pool-driven request no matter how valid.

    Pool shape modeled on the real seeded "Senior Secondary Preset" CORE_COMPULSORY pool: 4
    always-auto-assigned core subjects (English, Kiswahili, PE, Community Service), the two
    system-managed maths (Core/Essential Mathematics — assigned automatically based on pathway
    by _ensure_core_mathematics, never student-picked here; see SYSTEM_MANAGED_MATH_CODES),
    plus one real student-pickable alternative (French) to exercise the positive request path.
    """

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()

        cls.school = School.objects.create(name='Pool Test School', level='COMBINED')
        cls.curriculum = Curriculum.objects.create(code='CBC-POOL', name='CBC (pool test)')
        cls.tier = Tier.objects.create(curriculum=cls.curriculum, name='Senior Secondary', code='SSS')
        cls.grade_sss = GradeLevel.objects.create(
            name='Grade 10 (pool test)', numeric_order=10, curriculum=cls.curriculum, tier=cls.tier)
        cls.stream_sss = ClassStream.objects.create(name='Pool Stream', grade=cls.grade_sss)

        cls.sss_student_user = User.objects.create_user(username='pool_student', password='x')
        cls.sss_student = StudentExtra.objects.create(
            user=cls.sss_student_user, roll='SP01', cl=cls.stream_sss, status=True)

        cls.preset = CurriculumPreset.objects.create(
            school=cls.school, name='Senior Secondary Preset (pool test)',
            curriculum=cls.curriculum, tier=cls.tier)
        cls.pool = SubjectPool.objects.create(
            preset=cls.preset, pool_type='CORE_COMPULSORY', min_subjects=5, max_subjects=6)

        cls.core_math = Subject.objects.create(code='CMAT', name='Core Mathematics', is_core=False)
        cls.essential_math = Subject.objects.create(code='EMAT', name='Essential Mathematics', is_core=False)
        cls.french = Subject.objects.create(code='FRE201', name='French', is_core=False)
        always_core = [
            Subject.objects.create(code=c, name=n, is_core=True)
            for c, n in [('ENG', 'English'), ('KIS', 'Kiswahili'), ('PE', 'Physical Education'), ('CSL', 'Community Service')]
        ]
        cls.pool.subjects.set([cls.core_math, cls.essential_math, cls.french, *always_core])

    def setUp(self):
        self.factory = RequestFactory()

    def _get_options(self, user):
        request = self.factory.get('/api/subjects/my-electives/')
        request.user = user
        return json.loads(api_student_elective_options(request).content)

    def _post_request(self, user, subject_id):
        request = self.factory.post(
            '/api/subjects/my-electives/request/',
            data=json.dumps({'subject_id': subject_id}), content_type='application/json')
        request.user = user
        return json.loads(api_student_elective_request(request).content)

    def test_pool_driven_alternative_subject_can_be_requested(self):
        result = self._post_request(self.sss_student_user, self.french.id)
        self.assertEqual(result['status'], 'success', result)
        self.assertTrue(
            StudentSubjectEnrollment.objects.filter(
                student=self.sss_student, subject=self.french, status='Pending').exists()
        )

    def test_system_managed_math_subjects_are_not_offered_via_the_pool(self):
        result = self._get_options(self.sss_student_user)
        self.assertEqual(result['status'], 'success', result)
        pool_data = next(p for p in result['data']['pools'] if p['pool_type'] == 'CORE_COMPULSORY')

        shown_subject_names = {s['subject_name'] for s in pool_data['subjects']}
        self.assertEqual(shown_subject_names, {'French'})

    def test_math_subjects_cannot_be_requested_directly(self):
        for subject in (self.core_math, self.essential_math):
            result = self._post_request(self.sss_student_user, subject.id)
            self.assertEqual(result['status'], 'error', result)
            self.assertFalse(
                StudentSubjectEnrollment.objects.filter(student=self.sss_student, subject=subject).exists()
            )

    def test_pool_min_max_excludes_always_core_and_system_managed_math_subjects(self):
        result = self._get_options(self.sss_student_user)
        pool_data = next(p for p in result['data']['pools'] if p['pool_type'] == 'CORE_COMPULSORY')

        # Pool is configured for 5-6 of its 7 total subjects; 4 always-core + 2
        # system-managed maths (6 total) are excluded from the shown pick range, leaving
        # room only for French.
        self.assertEqual(pool_data['min_subjects'], 0)
        self.assertEqual(pool_data['max_subjects'], 0)
