from django.contrib.auth.models import User
from django.test import TestCase

from apps.academics.models import (
    AcademicYear, ClassStream, Curriculum, ExamTerm, GradeLevel, Pathway, PresetCombination,
    Subject, Tier, Track,
)
from apps.identity.models import StudentExtra
from apps.students.models import StudentPathwaySelection, StudentSubjectEnrollment
from school.views.promotion_views import _promote_student


class RealWorldYearSemanticsProbe(TestCase):
    """Mimics the real end-of-year flow: the ACTIVE year is N, its terms are finalized,
    and the admin runs promotion passing year N (the only year for which results can
    actually be finalized). Does the SSS carry-forward + core-math guarantee run?"""

    def setUp(self):
        self.curriculum = Curriculum.objects.create(code='PRB', name='Probe')
        self.tier = Tier.objects.create(curriculum=self.curriculum, name='Senior Secondary', code='SSSP')
        self.g10 = GradeLevel.objects.create(name='Grade 10P', numeric_order=10, curriculum=self.curriculum, tier=self.tier)
        self.g11 = GradeLevel.objects.create(name='Grade 11P', numeric_order=11, curriculum=self.curriculum, tier=self.tier)
        self.g12 = GradeLevel.objects.create(name='Grade 12P', numeric_order=12, curriculum=self.curriculum, tier=self.tier)
        self.s10 = ClassStream.objects.create(name='Gold', grade=self.g10)
        self.s11 = ClassStream.objects.create(name='Gold', grade=self.g11)

        self.pathway = Pathway.objects.create(curriculum=self.curriculum, name='STEM')
        self.track = Track.objects.create(pathway=self.pathway, name='Pure Sciences')
        self.phy = Subject.objects.create(code='PHYP', name='Physics P')
        self.che = Subject.objects.create(code='CHEP', name='Chemistry P')
        self.bio = Subject.objects.create(code='BIOP', name='Biology P')
        self.emat = Subject.objects.create(code='EMAT', name='Essential Mathematics')
        self.combo = PresetCombination.objects.create(track=self.track, name='Sci', code='SCP')
        self.combo.subjects.set([self.phy, self.che, self.bio])

        self.alt = PresetCombination.objects.create(track=self.track, name='Alt', code='ALTP')
        self.alt.subjects.set([self.phy, self.che])

        # Year N is the active year; its terms are finalized (the only realistic state).
        self.yearN = AcademicYear.objects.create(year='PRB-N', is_active=True)
        ExamTerm.objects.create(name='T1', academic_year=self.yearN, start_date='2030-01-01', end_date='2030-04-01', results_finalized=True)

    def test_case_a_grade10_to_11_first_sss_year(self):
        u = User.objects.create_user(username='probeA', password='x')
        st = StudentExtra.objects.create(user=u, roll='PA', cl=self.s10, status=True)
        StudentPathwaySelection.objects.create(
            student=st, pathway=self.pathway, track=self.track,
            preset_combination=self.combo, academic_year=self.yearN, status='Approved')

        result = _promote_student(st, self.yearN)
        st.refresh_from_db()
        print('\n[CASE A] outcome=', result['outcome'], 'new grade=', st.cl.grade.name)
        print('[CASE A] selections:', list(StudentPathwaySelection.objects.filter(student=st).values_list('academic_year__year', 'preset_combination__code')))
        print('[CASE A] subject enrollments:', list(StudentSubjectEnrollment.objects.filter(student=st).values_list('academic_year__year', 'subject__code', 'status')))

    def test_case_b_grade11_to_12_with_prior_year_selection(self):
        yearPrev = AcademicYear.objects.create(year='PRB-N-1', is_active=False)
        u = User.objects.create_user(username='probeB', password='x')
        st = StudentExtra.objects.create(user=u, roll='PB', cl=self.s11, status=True)
        # Last year (Grade 10) the student was on the 'alt' combo; this year they switched to 'combo'.
        StudentPathwaySelection.objects.create(
            student=st, pathway=self.pathway, track=self.track,
            preset_combination=self.alt, academic_year=yearPrev, status='Approved')
        StudentPathwaySelection.objects.create(
            student=st, pathway=self.pathway, track=self.track,
            preset_combination=self.combo, academic_year=self.yearN, status='Approved')

        result = _promote_student(st, self.yearN)
        st.refresh_from_db()
        print('\n[CASE B] outcome=', result['outcome'], 'new grade=', st.cl.grade.name)
        print('[CASE B] selections:', list(StudentPathwaySelection.objects.filter(student=st).values_list('academic_year__year', 'preset_combination__code')))
        print('[CASE B] subject enrollments:', list(StudentSubjectEnrollment.objects.filter(student=st).values_list('academic_year__year', 'subject__code', 'status')))
