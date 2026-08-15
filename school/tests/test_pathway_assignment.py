import json

from django.contrib.auth.models import User
from django.test import TestCase, RequestFactory

from apps.academics.models import (
    Curriculum, Pathway, Track, PresetCombination, Tier, GradeLevel, ClassStream,
    tier_requires_pathway_choice, grade_requires_pathway_choice,
)
from apps.identity.models import Permission, Role, UserRole, StudentExtra
from apps.students.models import StudentPathwaySelection, StudentSubjectEnrollment
from school.tests.base import ExamTestDataMixin
from school.views.subject_views import (
    api_admin_pathway_options, api_admin_assign_pathway,
    api_unlock_subject_enrollment, api_unlock_pathway_selection,
    api_student_pathway_options, api_student_pathway_request,
)


class TierRequiresPathwayChoiceTests(TestCase):
    def setUp(self):
        self.curriculum = Curriculum.objects.create(code='CBC', name='Competency Based Curriculum')

    def test_senior_secondary_requires_pathway_choice(self):
        tier = Tier.objects.create(curriculum=self.curriculum, name='Senior Secondary', code='SSS')
        self.assertTrue(tier_requires_pathway_choice(tier))

    def test_junior_secondary_does_not(self):
        tier = Tier.objects.create(curriculum=self.curriculum, name='Junior Secondary', code='JSS')
        self.assertFalse(tier_requires_pathway_choice(tier))

    def test_upper_primary_does_not(self):
        tier = Tier.objects.create(curriculum=self.curriculum, name='Upper Primary', code='UP')
        self.assertFalse(tier_requires_pathway_choice(tier))

    def test_none_tier_does_not(self):
        self.assertFalse(tier_requires_pathway_choice(None))

    def test_case_insensitivity_uppercase(self):
        tier = Tier.objects.create(curriculum=self.curriculum, name='SENIOR SECONDARY', code='SSS')
        self.assertTrue(tier_requires_pathway_choice(tier))

    def test_case_insensitivity_mixed_case(self):
        tier = Tier.objects.create(curriculum=self.curriculum, name='Senior secondary', code='SSS')
        self.assertTrue(tier_requires_pathway_choice(tier))


class GradeRequiresPathwayChoiceTests(TestCase):
    """Pathway choice happens once, at the entry grade of a pathway-choice tier (Grade 10 in
    CBC's Senior Secondary) -- Grade 11/12 carry the choice forward and must not re-expose it."""

    def setUp(self):
        self.curriculum = Curriculum.objects.create(code='CBC', name='Competency Based Curriculum')
        self.sss_tier = Tier.objects.create(curriculum=self.curriculum, name='Senior Secondary', code='SSS')
        self.jss_tier = Tier.objects.create(curriculum=self.curriculum, name='Junior Secondary', code='JSS')
        self.grade10 = GradeLevel.objects.create(name='Grade 10X', numeric_order=10, curriculum=self.curriculum, tier=self.sss_tier)
        self.grade11 = GradeLevel.objects.create(name='Grade 11X', numeric_order=11, curriculum=self.curriculum, tier=self.sss_tier)
        self.grade12 = GradeLevel.objects.create(name='Grade 12X', numeric_order=12, curriculum=self.curriculum, tier=self.sss_tier)
        self.grade8 = GradeLevel.objects.create(name='Grade 8X', numeric_order=8, curriculum=self.curriculum, tier=self.jss_tier)

    def test_entry_grade_requires_choice(self):
        self.assertTrue(grade_requires_pathway_choice(self.grade10))

    def test_later_grades_do_not_require_choice(self):
        self.assertFalse(grade_requires_pathway_choice(self.grade11))
        self.assertFalse(grade_requires_pathway_choice(self.grade12))

    def test_non_pathway_tier_does_not_require_choice(self):
        self.assertFalse(grade_requires_pathway_choice(self.grade8))

    def test_none_grade_does_not_require_choice(self):
        self.assertFalse(grade_requires_pathway_choice(None))


class PathwayAssignmentTestMixin(ExamTestDataMixin):
    """Builds an SSS grade/stream + Pathway/Track/PresetCombination catalog, and grants the
    'pathway.view'/'pathway.edit'/'curriculum.edit' permission codes to the shared teacher
    and admin accounts from ExamTestDataMixin."""

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()

        cls.curriculum = Curriculum.objects.create(code='CBC2', name='CBC (SSS test)')
        cls.sss_tier = Tier.objects.create(curriculum=cls.curriculum, name='Senior Secondary', code='SSS')

        cls.grade_sss = GradeLevel.objects.create(
            name='Grade 10', numeric_order=10, curriculum=cls.curriculum, tier=cls.sss_tier)
        cls.stream_sss = ClassStream.objects.create(
            name='Gold', grade=cls.grade_sss, class_teacher=cls.teacher)

        cls.sss_student_user = User.objects.create_user(username='sss_student', password='x')
        cls.sss_student = StudentExtra.objects.create(
            user=cls.sss_student_user, roll='S010', cl=cls.stream_sss, status=True)

        # A Grade 11 student in the same tier -- past the entry grade, so pathway choice must
        # already be locked in (or absent) rather than offered again.
        cls.grade11 = GradeLevel.objects.create(
            name='Grade 11', numeric_order=11, curriculum=cls.curriculum, tier=cls.sss_tier)
        cls.stream_grade11 = ClassStream.objects.create(name='Silver', grade=cls.grade11, class_teacher=cls.teacher)
        cls.grade11_student_user = User.objects.create_user(username='grade11_student', password='x')
        cls.grade11_student = StudentExtra.objects.create(
            user=cls.grade11_student_user, roll='S011', cl=cls.stream_grade11, status=True)

        cls.pathway = Pathway.objects.create(curriculum=cls.curriculum, name='STEM')
        cls.track = Track.objects.create(pathway=cls.pathway, name='Pure Sciences')
        cls.combo = PresetCombination.objects.create(track=cls.track, name='Combo 1', code='C1')
        cls.combo.subjects.set([cls.maths, cls.french])

        for code in ('pathway.view', 'pathway.edit', 'curriculum.edit'):
            Permission.objects.get_or_create(code=code, defaults={'label': code, 'module': code.split('.')[0]})

        role = Role.objects.create(name='Pathway & Curriculum Manager')
        role.permissions.set(Permission.objects.filter(code__in=('pathway.view', 'pathway.edit', 'curriculum.edit')))
        UserRole.objects.create(user=cls.teacher_user, role=role)
        UserRole.objects.create(user=cls.admin_user, role=role)

        cls.unrelated_teacher_user = User.objects.create_user(username='unrelated_teacher', password='x')
        UserRole.objects.create(user=cls.unrelated_teacher_user, role=role)

    def setUp(self):
        self.factory = RequestFactory()

    def _get(self, view, path, user, **kwargs):
        request = self.factory.get(path)
        request.user = user
        response = view(request, **kwargs)
        return json.loads(response.content), response.status_code

    def _post(self, view, path, user, payload, **kwargs):
        request = self.factory.post(path, data=json.dumps(payload), content_type='application/json')
        request.user = user
        response = view(request, **kwargs)
        return json.loads(response.content), response.status_code


class AdminPathwayOptionsTests(PathwayAssignmentTestMixin, TestCase):
    def test_admin_sees_requires_pathway_choice_and_can_unlock(self):
        result, status = self._get(
            api_admin_pathway_options, f'/api/subjects/pathway-options/{self.sss_student.id}/',
            self.admin_user, student_id=self.sss_student.id
        )
        self.assertEqual(status, 200)
        self.assertTrue(result['data']['requires_pathway_choice'])
        self.assertTrue(result['data']['can_unlock'])
        pathway_names = [p['name'] for p in result['data']['pathways']]
        self.assertIn('STEM', pathway_names)

    def test_class_teacher_can_unlock(self):
        result, _ = self._get(
            api_admin_pathway_options, f'/api/subjects/pathway-options/{self.sss_student.id}/',
            self.teacher_user, student_id=self.sss_student.id
        )
        self.assertTrue(result['data']['can_unlock'])

    def test_unrelated_teacher_cannot_unlock(self):
        result, _ = self._get(
            api_admin_pathway_options, f'/api/subjects/pathway-options/{self.sss_student.id}/',
            self.unrelated_teacher_user, student_id=self.sss_student.id
        )
        self.assertFalse(result['data']['can_unlock'])

    def test_grade11_student_does_not_require_pathway_choice(self):
        result, status = self._get(
            api_admin_pathway_options, f'/api/subjects/pathway-options/{self.grade11_student.id}/',
            self.admin_user, student_id=self.grade11_student.id
        )
        self.assertEqual(status, 200)
        self.assertFalse(result['data']['requires_pathway_choice'])
        self.assertEqual(result['data']['pathways'], [])


class AdminAssignPathwayTests(PathwayAssignmentTestMixin, TestCase):
    def test_assigning_a_combo_locks_selection_and_approves_its_subjects(self):
        result, status = self._post(
            api_admin_assign_pathway, f'/api/subjects/pathway-options/{self.sss_student.id}/assign/',
            self.admin_user,
            {'pathway_id': self.pathway.id, 'track_id': self.track.id, 'preset_combination_id': self.combo.id},
            student_id=self.sss_student.id
        )
        self.assertEqual(status, 200)
        self.assertEqual(result['data']['status'], 'Approved')

        selection = StudentPathwaySelection.objects.get(student=self.sss_student)
        self.assertEqual(selection.status, 'Approved')
        self.assertEqual(selection.preset_combination_id, self.combo.id)

        for subject in (self.maths, self.french):
            enrollment = StudentSubjectEnrollment.objects.get(student=self.sss_student, subject=subject)
            self.assertEqual(enrollment.status, 'Approved')

    def test_mismatched_curriculum_pathway_is_rejected(self):
        other_curriculum = Curriculum.objects.create(code='OTHER', name='Other Curriculum')
        other_pathway = Pathway.objects.create(curriculum=other_curriculum, name='Arts')
        result, status = self._post(
            api_admin_assign_pathway, f'/api/subjects/pathway-options/{self.sss_student.id}/assign/',
            self.admin_user, {'pathway_id': other_pathway.id}, student_id=self.sss_student.id
        )
        self.assertEqual(status, 400)
        self.assertEqual(result['status'], 'error')

    def test_missing_track_is_rejected(self):
        result, status = self._post(
            api_admin_assign_pathway, f'/api/subjects/pathway-options/{self.sss_student.id}/assign/',
            self.admin_user, {'pathway_id': self.pathway.id}, student_id=self.sss_student.id
        )
        self.assertEqual(status, 400)
        self.assertEqual(result['status'], 'error')

    def test_unrelated_teacher_cannot_assign(self):
        result, status = self._post(
            api_admin_assign_pathway, f'/api/subjects/pathway-options/{self.sss_student.id}/assign/',
            self.unrelated_teacher_user,
            {'pathway_id': self.pathway.id, 'track_id': self.track.id, 'preset_combination_id': self.combo.id},
            student_id=self.sss_student.id
        )
        self.assertEqual(status, 403)

    def test_grade11_student_cannot_be_assigned_a_pathway(self):
        result, status = self._post(
            api_admin_assign_pathway, f'/api/subjects/pathway-options/{self.grade11_student.id}/assign/',
            self.admin_user,
            {'pathway_id': self.pathway.id, 'track_id': self.track.id, 'preset_combination_id': self.combo.id},
            student_id=self.grade11_student.id
        )
        self.assertEqual(status, 400)
        self.assertEqual(result['status'], 'error')


class StudentSelfServicePathwayGateTests(PathwayAssignmentTestMixin, TestCase):
    """The exact bug this gate exists for: a student past the entry grade (or, before this
    fix, ANY student on any grade) must not see/submit a pathway choice via self-service."""

    def test_entry_grade_student_sees_pathways(self):
        request = self.factory.get('/api/subjects/my-pathway/')
        request.user = self.sss_student_user
        response = api_student_pathway_options(request)
        result = json.loads(response.content)
        self.assertTrue(result['data']['requires_pathway_choice'])
        self.assertTrue(len(result['data']['pathways']) > 0)

    def test_grade11_student_does_not_see_pathways(self):
        request = self.factory.get('/api/subjects/my-pathway/')
        request.user = self.grade11_student_user
        response = api_student_pathway_options(request)
        result = json.loads(response.content)
        self.assertFalse(result['data']['requires_pathway_choice'])
        self.assertEqual(result['data']['pathways'], [])

    def test_grade11_student_cannot_submit_a_pathway_request(self):
        request = self.factory.post(
            '/api/subjects/my-pathway/request/',
            data=json.dumps({'pathway_id': self.pathway.id}), content_type='application/json')
        request.user = self.grade11_student_user
        response = api_student_pathway_request(request)
        self.assertEqual(response.status_code, 403)
        self.assertFalse(StudentPathwaySelection.objects.filter(student=self.grade11_student).exists())


class UnlockEndpointsTests(PathwayAssignmentTestMixin, TestCase):
    def test_unlock_subject_enrollment_reverts_approved_to_pending(self):
        StudentSubjectEnrollment.objects.create(
            student=self.sss_student, subject=self.maths, academic_year=self.year, status='Approved')

        result, status = self._post(
            api_unlock_subject_enrollment, f'/api/subjects/manage-enrollment/{self.sss_student.id}/unlock/',
            self.admin_user, {}, student_id=self.sss_student.id
        )
        self.assertEqual(status, 200)
        self.assertFalse(result['is_locked'])
        enrollment = StudentSubjectEnrollment.objects.get(student=self.sss_student, subject=self.maths)
        self.assertEqual(enrollment.status, 'Pending')

    def test_unrelated_teacher_cannot_unlock_subjects(self):
        StudentSubjectEnrollment.objects.create(
            student=self.sss_student, subject=self.maths, academic_year=self.year, status='Approved')
        result, status = self._post(
            api_unlock_subject_enrollment, f'/api/subjects/manage-enrollment/{self.sss_student.id}/unlock/',
            self.unrelated_teacher_user, {}, student_id=self.sss_student.id
        )
        self.assertEqual(status, 403)

    def test_unlock_pathway_selection_reverts_selection_and_combo_subjects(self):
        selection = StudentPathwaySelection.objects.create(
            student=self.sss_student, pathway=self.pathway, track=self.track,
            preset_combination=self.combo, academic_year=self.year, status='Approved')
        for subject in (self.maths, self.french):
            StudentSubjectEnrollment.objects.create(
                student=self.sss_student, subject=subject, academic_year=self.year, status='Approved')

        result, status = self._post(
            api_unlock_pathway_selection, f'/api/subjects/pathway-options/{self.sss_student.id}/unlock/',
            self.admin_user, {}, student_id=self.sss_student.id
        )
        self.assertEqual(status, 200)
        self.assertFalse(result['is_locked'])

        selection.refresh_from_db()
        self.assertEqual(selection.status, 'Pending')
        for subject in (self.maths, self.french):
            enrollment = StudentSubjectEnrollment.objects.get(student=self.sss_student, subject=subject)
            self.assertEqual(enrollment.status, 'Pending')

    def test_no_approved_selection_returns_error(self):
        result, status = self._post(
            api_unlock_pathway_selection, f'/api/subjects/pathway-options/{self.sss_student.id}/unlock/',
            self.admin_user, {}, student_id=self.sss_student.id
        )
        self.assertEqual(status, 400)
        self.assertEqual(result['status'], 'error')
