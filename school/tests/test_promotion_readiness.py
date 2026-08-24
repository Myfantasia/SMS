from django.test import TestCase

from apps.academics.models import Curriculum, Tier
from school.serializers.curriculum_serializers import TierSerializer


class TierSerializerExitFieldsTests(TestCase):
    def test_serializer_exposes_exit_exam_fields(self):
        curriculum = Curriculum.objects.create(code='TSER1', name='Serializer Test Curriculum')
        tier = Tier.objects.create(
            curriculum=curriculum, name='Senior Secondary', code='SSTS1',
            exit_exam_code='KCSE', exit_is_terminal=True,
        )
        data = TierSerializer(tier).data
        self.assertEqual(data['exit_exam_code'], 'KCSE')
        self.assertTrue(data['exit_is_terminal'])

    def test_serializer_accepts_exit_fields_on_write(self):
        curriculum = Curriculum.objects.create(code='TSER2', name='Serializer Test Curriculum 2')
        serializer = TierSerializer(data={
            'curriculum': curriculum.id, 'name': 'Upper Primary', 'code': 'UPTS2',
            'exit_exam_code': 'KPSEA', 'exit_is_terminal': False,
        })
        self.assertTrue(serializer.is_valid(), serializer.errors)
        tier = serializer.save()
        self.assertEqual(tier.exit_exam_code, 'KPSEA')
        self.assertFalse(tier.exit_is_terminal)
