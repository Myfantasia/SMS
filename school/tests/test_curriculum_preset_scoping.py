"""
CurriculumPreset/SubjectPool multi-tenancy rollout, entity 1 of N (see
/home/jordan/.claude/plans/floofy-churning-mango.md). Covers the interim
get_current_school_id() shim's failure boundary, the (school, name) DB
constraint, the serializer's hand-rolled scoped-uniqueness check (DRF can't
auto-build one since `school` isn't a serializer field), and the two places
that were fixed to stop cross-school leakage: CurriculumPresetViewSet and
_resolve_curriculum_preset.

Isolation tests below need two School rows to exist at once, which makes the
real get_current_school_id() shim raise (by design — see its docstring). To
exercise "current school" behavior anyway, those tests patch the shim at each
call site's imported name rather than at apps.identity.services (each module
did `from apps.identity.services import get_current_school_id`, binding its
own local reference that a patch on the source module wouldn't reach).
"""
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core.exceptions import ImproperlyConfigured
from django.db import IntegrityError, transaction
from django.test import RequestFactory, TestCase
from django.urls import reverse
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.academics.models import (
    Curriculum, CurriculumPreset, GradeLevel, Pathway, PresetCombination, Subject, SubjectPool, Tier, Track,
)
from apps.identity.models import Permission, School
from apps.identity.services import get_current_school_id
from school.serializers.curriculum_serializers import CurriculumPresetSerializer
from school.views.curriculum_view import CurriculumPresetViewSet
from school.views.subject_views import _pool_subjects_for_student, _pools_for_pathway, _resolve_curriculum_preset


class GetCurrentSchoolIdShimTests(TestCase):
    """Documents the shim's failure boundary: it only knows how to guess
    "the current school" while exactly one School row exists."""

    def test_raises_when_no_school_exists(self):
        self.assertEqual(School.objects.count(), 0)
        with self.assertRaises(ImproperlyConfigured):
            get_current_school_id(None)

    def test_raises_when_multiple_schools_exist(self):
        School.objects.create(name='School A', level='COMBINED')
        School.objects.create(name='School B', level='COMBINED')
        with self.assertRaises(ImproperlyConfigured):
            get_current_school_id(None)

    def test_returns_the_only_school_id_when_exactly_one_exists(self):
        school = School.objects.create(name='Only School', level='COMBINED')
        self.assertEqual(get_current_school_id(None), school.id)


class CurriculumPresetModelUniquenessTests(TestCase):
    """DB-level (school, name) unique_together — exercised directly via the
    ORM, no shim involved, since these rows are built with an explicit
    `school=` the way a real multi-school deployment eventually will."""

    def setUp(self):
        self.school_a = School.objects.create(name='School A', level='COMBINED')
        self.school_b = School.objects.create(name='School B', level='COMBINED')

    def test_same_name_allowed_across_two_schools(self):
        CurriculumPreset.objects.create(school=self.school_a, name='Standard 8-4-4')
        CurriculumPreset.objects.create(school=self.school_b, name='Standard 8-4-4')
        self.assertEqual(CurriculumPreset.objects.filter(name='Standard 8-4-4').count(), 2)

    def test_same_name_rejected_within_one_school(self):
        CurriculumPreset.objects.create(school=self.school_a, name='Standard 8-4-4')
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                CurriculumPreset.objects.create(school=self.school_a, name='Standard 8-4-4')


class CurriculumPresetSerializerScopedUniquenessTests(TestCase):
    """Only one School row here, so the real get_current_school_id() shim
    runs unpatched — this is the serializer's manual validate() check
    (curriculum_serializers.py) exercised end-to-end, mirroring the existing
    SubjectPoolSerializer (preset, pool_type) gotcha it's modeled on."""

    def setUp(self):
        self.factory = RequestFactory()
        self.school = School.objects.create(name='Only School', level='COMBINED')
        self.user = User.objects.create_user(username='preset_admin', password='x', is_superuser=True)
        CurriculumPreset.objects.create(school=self.school, name='Standard 8-4-4')

    def _request(self):
        request = self.factory.get('/')
        request.user = self.user
        return request

    def test_rejects_duplicate_name_within_the_same_school(self):
        serializer = CurriculumPresetSerializer(
            data={'name': 'Standard 8-4-4'}, context={'request': self._request()})
        self.assertFalse(serializer.is_valid())
        self.assertIn('name', serializer.errors)

    def test_accepts_a_new_name_within_the_same_school(self):
        serializer = CurriculumPresetSerializer(
            data={'name': 'CBC Junior Sec'}, context={'request': self._request()})
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_update_accepts_a_round_tripped_pools_payload_including_preset_field(self):
        # Regression test: GET serializes each pool's own 'preset' FK back to the client, and
        # the edit form round-trips the whole pool object (including 'preset') on save. Before
        # the fix, update()'s SubjectPool.objects.create(preset=instance, **pool_data) received
        # 'preset' twice and raised TypeError instead of saving.
        preset = CurriculumPreset.objects.create(school=self.school, name='Round Trip Preset')
        SubjectPool.objects.create(preset=preset, pool_type='CORE_COMPULSORY', min_subjects=1, max_subjects=1)

        get_data = CurriculumPresetSerializer(preset, context={'request': self._request()}).data
        self.assertIn('preset', get_data['pools'][0])  # sanity: this is the exact shape that broke

        serializer = CurriculumPresetSerializer(preset, data=dict(get_data), context={'request': self._request()})
        self.assertTrue(serializer.is_valid(), serializer.errors)
        updated = serializer.save()
        self.assertEqual(updated.pools.count(), 1)


class CurriculumPresetViewSetIsolationTests(TestCase):
    """CurriculumPresetViewSet.get_queryset/perform_create only ever touch
    the current school's rows, proven with two School rows + presets created
    directly in setup (bypassing the shim) so isolation can't be an accident
    of only one school existing."""

    def setUp(self):
        for code in ('curriculum.view', 'curriculum.edit'):
            Permission.objects.get_or_create(code=code, defaults={'label': code, 'module': 'curriculum'})

        self.school_a = School.objects.create(name='School A', level='COMBINED')
        self.school_b = School.objects.create(name='School B', level='COMBINED')
        self.preset_a = CurriculumPreset.objects.create(school=self.school_a, name='A Preset')
        self.preset_b = CurriculumPreset.objects.create(school=self.school_b, name='B Preset')

        self.admin_user = User.objects.create_user(
            username='viewset_admin', password='x', is_superuser=True, is_staff=True)
        self.factory = APIRequestFactory()

    def test_list_only_returns_current_schools_presets(self):
        request = self.factory.get(reverse('curriculum-preset-list'))
        force_authenticate(request, user=self.admin_user)
        view = CurriculumPresetViewSet.as_view({'get': 'list'})

        with patch('school.views.curriculum_view.get_current_school_id', return_value=self.school_a.id):
            response = view(request)

        self.assertEqual(response.status_code, 200)
        returned_ids = {row['id'] for row in response.data}
        self.assertIn(self.preset_a.id, returned_ids)
        self.assertNotIn(self.preset_b.id, returned_ids)

    def test_create_attaches_the_current_school_even_when_a_second_school_exists(self):
        request = self.factory.post(reverse('curriculum-preset-list'), {'name': 'New Preset'}, format='json')
        force_authenticate(request, user=self.admin_user)
        view = CurriculumPresetViewSet.as_view({'post': 'create'})

        with patch('school.views.curriculum_view.get_current_school_id', return_value=self.school_a.id), \
                patch('school.serializers.curriculum_serializers.get_current_school_id', return_value=self.school_a.id):
            response = view(request)

        self.assertEqual(response.status_code, 201, response.data)
        created = CurriculumPreset.objects.get(id=response.data['id'])
        self.assertEqual(created.school_id, self.school_a.id)


class ResolveCurriculumPresetCrossTenantTests(TestCase):
    """The actual security-relevant fix in this pass: two schools sharing an
    identical curriculum/tier/pathway/track combo must not resolve to each
    other's CurriculumPreset."""

    def setUp(self):
        self.factory = RequestFactory()
        self.school_a = School.objects.create(name='School A', level='COMBINED')
        self.school_b = School.objects.create(name='School B', level='COMBINED')

        curriculum = Curriculum.objects.create(code='CBC-SCOPE', name='CBC (scoping test)')
        tier = Tier.objects.create(curriculum=curriculum, name='Senior Secondary', code='SSS')
        self.pathway = Pathway.objects.create(curriculum=curriculum, name='STEM')
        self.track = Track.objects.create(pathway=self.pathway, name='Pure Sciences')

        self.grade = GradeLevel.objects.create(
            name='Grade 10 (scoping test)', numeric_order=10, curriculum=curriculum, tier=tier)

        self.preset_a = CurriculumPreset.objects.create(
            school=self.school_a, name='A Preset', curriculum=curriculum, tier=tier,
            pathway=self.pathway, track=self.track)
        self.preset_b = CurriculumPreset.objects.create(
            school=self.school_b, name='B Preset', curriculum=curriculum, tier=tier,
            pathway=self.pathway, track=self.track)

    def test_resolves_only_the_current_schools_preset(self):
        request = self.factory.get('/')
        with patch('school.views.subject_views.get_current_school_id', return_value=self.school_a.id):
            resolved = _resolve_curriculum_preset(request, self.grade, self.pathway, self.track)

        self.assertIsNotNone(resolved)
        self.assertEqual(resolved.id, self.preset_a.id)
        self.assertEqual(resolved.school_id, self.school_a.id)


class UniversalPresetFallbackTests(TestCase):
    """A preset with pathway=None, track=None can serve every pathway via its own
    pathway-tagged SubjectPools, instead of needing one preset per pathway. The exact-match
    preset (if one exists) must still win over the universal fallback."""

    def setUp(self):
        self.factory = RequestFactory()
        self.school = School.objects.create(name='Only School', level='COMBINED')
        curriculum = Curriculum.objects.create(code='CBC-UNIV', name='CBC (universal fallback test)')
        self.tier = Tier.objects.create(curriculum=curriculum, name='Senior Secondary', code='SSS')
        self.stem = Pathway.objects.create(curriculum=curriculum, name='STEM')
        self.arts = Pathway.objects.create(curriculum=curriculum, name='Arts & Sports Science')
        self.grade = GradeLevel.objects.create(
            name='Grade 10 (universal fallback test)', numeric_order=10, curriculum=curriculum, tier=self.tier)

    def _resolve(self, pathway, track=None):
        request = self.factory.get('/')
        with patch('school.views.subject_views.get_current_school_id', return_value=self.school.id):
            return _resolve_curriculum_preset(request, self.grade, pathway, track)

    def test_falls_back_to_universal_preset_when_no_exact_match_exists(self):
        universal = CurriculumPreset.objects.create(
            school=self.school, name='SSS Preset', curriculum=self.grade.curriculum, tier=self.tier)
        self.assertEqual(self._resolve(self.stem).id, universal.id)
        self.assertEqual(self._resolve(self.arts).id, universal.id)

    def test_exact_pathway_preset_wins_over_the_universal_fallback(self):
        CurriculumPreset.objects.create(
            school=self.school, name='SSS Preset', curriculum=self.grade.curriculum, tier=self.tier)
        stem_only = CurriculumPreset.objects.create(
            school=self.school, name='STEM Preset', curriculum=self.grade.curriculum, tier=self.tier, pathway=self.stem)
        self.assertEqual(self._resolve(self.stem).id, stem_only.id)

    def test_no_preset_found_when_none_exist(self):
        self.assertIsNone(self._resolve(self.stem))


class PoolsForPathwayFilterTests(TestCase):
    """_pools_for_pathway() keeps a preset's pathway-agnostic pools plus only the
    PATHWAY_CORE pool(s) tagged to the requested pathway/track."""

    def setUp(self):
        self.school = School.objects.create(name='Only School', level='COMBINED')
        curriculum = Curriculum.objects.create(code='CBC-PF', name='CBC (pool filter test)')
        tier = Tier.objects.create(curriculum=curriculum, name='Senior Secondary', code='SSS')
        self.stem = Pathway.objects.create(curriculum=curriculum, name='STEM')
        self.arts = Pathway.objects.create(curriculum=curriculum, name='Arts & Sports Science')
        self.stem_track = Track.objects.create(pathway=self.stem, name='Pure Sciences')

        self.preset = CurriculumPreset.objects.create(
            school=self.school, name='SSS Preset', curriculum=curriculum, tier=tier)
        self.core_pool = SubjectPool.objects.create(preset=self.preset, pool_type='CORE_COMPULSORY', min_subjects=5, max_subjects=6)
        self.stem_pool = SubjectPool.objects.create(
            preset=self.preset, pool_type='PATHWAY_CORE', min_subjects=1, max_subjects=1, pathway=self.stem, track=self.stem_track)
        self.arts_pool = SubjectPool.objects.create(
            preset=self.preset, pool_type='PATHWAY_CORE', min_subjects=1, max_subjects=1, pathway=self.arts)

    def test_stem_student_only_sees_core_and_stem_pools(self):
        pools = _pools_for_pathway(self.preset, self.stem, self.stem_track)
        self.assertEqual({p.id for p in pools}, {self.core_pool.id, self.stem_pool.id})

    def test_arts_student_only_sees_core_and_arts_pools(self):
        pools = _pools_for_pathway(self.preset, self.arts, None)
        self.assertEqual({p.id for p in pools}, {self.core_pool.id, self.arts_pool.id})


class SubjectPoolPathwayValidationTests(TestCase):
    """CurriculumPresetSerializer.validate()'s pool-level checks: pathway/track are rejected
    outside a PATHWAY_CORE pool, a pool's track must belong to its pathway, and two pools
    can't share the same (pool_type, pathway, track) -- the DB constraint alone can't catch
    the last one since Postgres treats NULL <> NULL."""

    def setUp(self):
        self.factory = RequestFactory()
        self.school = School.objects.create(name='Only School', level='COMBINED')
        self.user = User.objects.create_user(username='pool_admin', password='x', is_superuser=True)
        curriculum = Curriculum.objects.create(code='CBC-PV', name='CBC (pool validation test)')
        self.pathway = Pathway.objects.create(curriculum=curriculum, name='STEM')
        self.other_pathway = Pathway.objects.create(curriculum=curriculum, name='Arts & Sports Science')
        self.track = Track.objects.create(pathway=self.pathway, name='Pure Sciences')

    def _request(self):
        request = self.factory.get('/')
        request.user = self.user
        return request

    def test_rejects_pathway_on_a_non_pathway_core_pool(self):
        serializer = CurriculumPresetSerializer(data={
            'name': 'Bad Preset',
            'pools': [{'pool_type': 'CORE_COMPULSORY', 'min_subjects': 1, 'max_subjects': 1, 'pathway': self.pathway.id}],
        }, context={'request': self._request()})
        self.assertFalse(serializer.is_valid())
        self.assertIn('pools', serializer.errors)

    def test_rejects_a_track_that_does_not_belong_to_the_pools_pathway(self):
        mismatched_track = Track.objects.create(pathway=self.other_pathway, name='Performing Arts')
        serializer = CurriculumPresetSerializer(data={
            'name': 'Bad Preset',
            'pools': [{
                'pool_type': 'PATHWAY_CORE', 'min_subjects': 1, 'max_subjects': 1,
                'pathway': self.pathway.id, 'track': mismatched_track.id,
            }],
        }, context={'request': self._request()})
        self.assertFalse(serializer.is_valid())
        self.assertIn('pools', serializer.errors)

    def test_rejects_duplicate_pool_type_pathway_track_combination(self):
        serializer = CurriculumPresetSerializer(data={
            'name': 'Bad Preset',
            'pools': [
                {'pool_type': 'PATHWAY_CORE', 'min_subjects': 1, 'max_subjects': 1, 'pathway': self.pathway.id},
                {'pool_type': 'PATHWAY_CORE', 'min_subjects': 1, 'max_subjects': 1, 'pathway': self.pathway.id},
            ],
        }, context={'request': self._request()})
        self.assertFalse(serializer.is_valid())
        self.assertIn('pools', serializer.errors)

    def test_accepts_distinct_pathway_tagged_pools(self):
        serializer = CurriculumPresetSerializer(data={
            'name': 'Good Preset',
            'pools': [
                {'pool_type': 'CORE_COMPULSORY', 'min_subjects': 5, 'max_subjects': 6},
                {'pool_type': 'PATHWAY_CORE', 'min_subjects': 1, 'max_subjects': 1, 'pathway': self.pathway.id, 'track': self.track.id},
                {'pool_type': 'PATHWAY_CORE', 'min_subjects': 1, 'max_subjects': 1, 'pathway': self.other_pathway.id},
            ],
        }, context={'request': self._request()})
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_rejects_combinations_on_a_non_pathway_core_pool(self):
        combo = PresetCombination.objects.create(track=self.track, name='PCM')
        serializer = CurriculumPresetSerializer(data={
            'name': 'Bad Preset',
            'pools': [{'pool_type': 'CORE_COMPULSORY', 'min_subjects': 1, 'max_subjects': 1, 'combinations': [combo.id]}],
        }, context={'request': self._request()})
        self.assertFalse(serializer.is_valid())
        self.assertIn('pools', serializer.errors)

    def test_saves_and_round_trips_combinations_on_a_single_universal_pathway_core_pool(self):
        # A single pool can hold combinations from more than one pathway/track at once —
        # the whole point of this design (no more one-pool-per-pathway/track).
        combo = PresetCombination.objects.create(track=self.track, name='PCM')
        other_track = Track.objects.create(pathway=self.other_pathway, name='Performing Arts')
        other_combo = PresetCombination.objects.create(track=other_track, name='MAD')

        serializer = CurriculumPresetSerializer(data={
            'name': 'Good Preset',
            'pools': [{
                'pool_type': 'PATHWAY_CORE', 'min_subjects': 3, 'max_subjects': 3,
                'combinations': [combo.id, other_combo.id],
            }],
        }, context={'request': self._request()})
        self.assertTrue(serializer.is_valid(), serializer.errors)
        preset = serializer.save(school=self.school)
        pool = preset.pools.get()
        self.assertEqual(set(pool.combinations.values_list('id', flat=True)), {combo.id, other_combo.id})


class PoolSubjectsForStudentTests(TestCase):
    """_pool_subjects_for_student() narrows a combinations-tagged pool's subjects to just the
    combo matching the student's own track, even though pool.subjects (the raw M2M cache
    kept in sync by the editor) holds every ticked combo's subjects across every
    pathway/track at once -- this is what lets one PATHWAY_CORE pool cover a whole SSS tier
    instead of needing one pool per pathway/track."""

    def setUp(self):
        curriculum = Curriculum.objects.create(code='CBC-PSFS', name='CBC (pool subjects test)')
        self.stem = Pathway.objects.create(curriculum=curriculum, name='STEM')
        self.arts = Pathway.objects.create(curriculum=curriculum, name='Arts & Sports Science')
        self.stem_track = Track.objects.create(pathway=self.stem, name='Pure Sciences')
        self.arts_track = Track.objects.create(pathway=self.arts, name='Performing Arts')

        self.maths = Subject.objects.create(name='Advanced Mathematics', code='MATH-PSFS')
        self.physics = Subject.objects.create(name='Physics', code='PHY-PSFS')
        self.chem = Subject.objects.create(name='Chemistry', code='CHEM-PSFS')
        self.music = Subject.objects.create(name='Music', code='MUS-PSFS')
        self.art = Subject.objects.create(name='Art', code='ART-PSFS')
        self.drama = Subject.objects.create(name='Drama', code='DRA-PSFS')

        self.stem_combo = PresetCombination.objects.create(track=self.stem_track, name='PCM')
        self.stem_combo.subjects.set([self.maths, self.physics, self.chem])
        self.arts_combo = PresetCombination.objects.create(track=self.arts_track, name='MAD')
        self.arts_combo.subjects.set([self.music, self.art, self.drama])

        school = School.objects.create(name='Only School', level='COMBINED')
        preset = CurriculumPreset.objects.create(school=school, name='SSS Preset', curriculum=curriculum)
        self.pool = SubjectPool.objects.create(preset=preset, pool_type='PATHWAY_CORE', min_subjects=3, max_subjects=3)
        self.pool.combinations.set([self.stem_combo, self.arts_combo])
        self.pool.subjects.set([self.maths, self.physics, self.chem, self.music, self.art, self.drama])

    def test_narrows_to_the_matching_tracks_combo_subjects(self):
        subjects = _pool_subjects_for_student(self.pool, self.stem, self.stem_track)
        self.assertEqual({s.id for s in subjects}, {self.maths.id, self.physics.id, self.chem.id})

    def test_a_different_track_only_sees_its_own_combo_subjects(self):
        subjects = _pool_subjects_for_student(self.pool, self.arts, self.arts_track)
        self.assertEqual({s.id for s in subjects}, {self.music.id, self.art.id, self.drama.id})

    def test_falls_back_to_pathway_when_track_not_chosen_yet(self):
        subjects = _pool_subjects_for_student(self.pool, self.stem, None)
        self.assertEqual({s.id for s in subjects}, {self.maths.id, self.physics.id, self.chem.id})

    def test_pool_without_combinations_returns_every_subject_unfiltered(self):
        plain_pool = SubjectPool.objects.create(
            preset=self.pool.preset, pool_type='CORE_COMPULSORY', min_subjects=1, max_subjects=1)
        plain_pool.subjects.set([self.maths, self.music])
        subjects = _pool_subjects_for_student(plain_pool, self.stem, self.stem_track)
        self.assertEqual({s.id for s in subjects}, {self.maths.id, self.music.id})
