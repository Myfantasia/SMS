from rest_framework import serializers

from apps.academics.models import (
    Curriculum, CurriculumPreset, Pathway, PresetCombination, Subject, SubjectCurriculumProfile,
    SubjectPool, Tier, Track,
)
from apps.identity.services import get_current_school_id


class CurriculumSerializer(serializers.ModelSerializer):
    class Meta:
        model = Curriculum
        fields = ['id', 'code', 'name', 'is_active_for_new_grades', 'is_archived']
        read_only_fields = ['is_archived']


class PathwaySerializer(serializers.ModelSerializer):
    class Meta:
        model = Pathway
        fields = ['id', 'curriculum', 'name', 'description']

    def validate_curriculum(self, curriculum):
        if curriculum.code != 'CBC':
            raise serializers.ValidationError("Pathways are only meaningful for the CBC curriculum.")
        return curriculum


class TrackSerializer(serializers.ModelSerializer):
    class Meta:
        model = Track
        fields = ['id', 'pathway', 'name', 'description', 'display_order']


class TierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tier
        fields = ['id', 'curriculum', 'name', 'code', 'display_order', 'exit_exam_code', 'exit_is_terminal']


class SubjectCurriculumProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = SubjectCurriculumProfile
        fields = [
            'id', 'subject', 'curriculum', 'tier', 'is_core', 'department', 'total_lessons',
            'double_lessons_required', 'remedial_lessons_required',
        ]

    def validate(self, data):
        tier = data.get('tier', getattr(self.instance, 'tier', None))
        curriculum = data.get('curriculum', getattr(self.instance, 'curriculum', None))
        if tier and curriculum and tier.curriculum_id != curriculum.id:
            raise serializers.ValidationError({'tier': "This tier doesn't belong to the selected curriculum."})
        return data


class SubjectPoolSerializer(serializers.ModelSerializer):
    subjects = serializers.PrimaryKeyRelatedField(queryset=Subject.objects.all(), many=True, required=False)

    combinations = serializers.PrimaryKeyRelatedField(queryset=PresetCombination.objects.all(), many=True, required=False)

    class Meta:
        model = SubjectPool
        fields = ['id', 'preset', 'pool_type', 'min_subjects', 'max_subjects', 'subjects', 'pathway', 'track', 'combinations']
        extra_kwargs = {
            'preset': {'required': False},
            # Only meaningful on a PATHWAY_CORE pool -- CurriculumPresetSerializer.validate()
            # rejects these being set on any other pool_type.
            'pathway': {'required': False, 'allow_null': True},
            'track': {'required': False, 'allow_null': True},
        }
        # 'preset' isn't in the payload -- CurriculumPresetSerializer.create()/update()
        # supplies it -- but DRF still auto-generates a UniqueTogetherValidator from the
        # model's (preset, pool_type) unique_together, and that validator's
        # enforce_required_fields() demands every field in the set be present in the
        # submitted data regardless of required=False above. Result: any preset submitted
        # with at least one pool was rejected with "preset: This field is required."
        # Dropped here since preset+pool_type uniqueness is still enforced at the DB level
        # by the model's own unique_together when the parent serializer saves each pool.
        validators = []


class CurriculumPresetSerializer(serializers.ModelSerializer):
    pools = SubjectPoolSerializer(many=True, required=False)

    class Meta:
        model = CurriculumPreset
        fields = [
            'id', 'name', 'min_subjects', 'max_subjects', 'display_order',
            'curriculum', 'tier', 'pathway', 'track', 'pools',
        ]

    def validate(self, data):
        pathway = data.get('pathway', getattr(self.instance, 'pathway', None))
        track = data.get('track', getattr(self.instance, 'track', None))
        if track and track.pathway_id != (pathway.id if pathway else None):
            raise serializers.ValidationError({'track': "This track doesn't belong to the selected pathway."})

        # 'school' isn't a serializer field -- it's server-derived, never client-supplied
        # (see get_current_school_id()) -- so DRF can't auto-build a UniqueTogetherValidator
        # for the model's (school, name) unique_together the way it would for an ordinary
        # field pair. Check it by hand instead, same gotcha SubjectPoolSerializer's
        # (preset, pool_type) pair already works around above.
        name = data.get('name', getattr(self.instance, 'name', None))
        request = self.context.get('request')
        if name and request is not None:
            qs = CurriculumPreset.objects.filter(school_id=get_current_school_id(request), name=name)
            if self.instance is not None:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError({'name': "A preset with this name already exists for your school."})

        # Pool-level pathway/track: only meaningful on a PATHWAY_CORE pool, one pathway/track
        # combo per pool_type. The widened (preset, pool_type, pathway, track) unique_together
        # can't fully cover this at the DB level -- Postgres treats NULL <> NULL, so two
        # CORE_COMPULSORY pools (both pathway=NULL, track=NULL) wouldn't collide there -- so
        # the duplicate check below is what actually enforces it, same reasoning as the
        # (school, name) check just above.
        pools_data = data.get('pools', None)
        if pools_data is not None:
            seen = set()
            for pool_data in pools_data:
                pool_type = pool_data.get('pool_type')
                pool_pathway = pool_data.get('pathway')
                pool_track = pool_data.get('track')
                pool_combinations = pool_data.get('combinations') or []
                if pool_type != 'PATHWAY_CORE' and (pool_pathway is not None or pool_track is not None or pool_combinations):
                    raise serializers.ValidationError(
                        {'pools': "Pathway/track/combinations can only be set on a Pathway Core pool."})
                if pool_track and pool_pathway and pool_track.pathway_id != pool_pathway.id:
                    raise serializers.ValidationError(
                        {'pools': "A pool's track must belong to its pathway."})
                key = (pool_type, pool_pathway.id if pool_pathway else None, pool_track.id if pool_track else None)
                if key in seen:
                    raise serializers.ValidationError(
                        {'pools': "Two pools can't share the same type/pathway/track combination."})
                seen.add(key)

        return data

    def create(self, validated_data):
        pools_data = validated_data.pop('pools', [])
        preset = CurriculumPreset.objects.create(**validated_data)
        for pool_data in pools_data:
            pool_data.pop('preset', None)
            subjects = pool_data.pop('subjects', [])
            combinations = pool_data.pop('combinations', [])
            pool = SubjectPool.objects.create(preset=preset, **pool_data)
            pool.subjects.set(subjects)
            pool.combinations.set(combinations)
        return preset

    def update(self, instance, validated_data):
        pools_data = validated_data.pop('pools', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        if pools_data is not None:
            instance.pools.all().delete()
            for pool_data in pools_data:
                # GET serializes each pool's own 'preset' FK back to the client, and the
                # edit form round-trips the full pool object on save -- pop it back out
                # here or SubjectPool.objects.create() gets 'preset' twice.
                pool_data.pop('preset', None)
                subjects = pool_data.pop('subjects', [])
                combinations = pool_data.pop('combinations', [])
                pool = SubjectPool.objects.create(preset=instance, **pool_data)
                pool.subjects.set(subjects)
                pool.combinations.set(combinations)
        return instance


class PresetCombinationSerializer(serializers.ModelSerializer):
    subjects = serializers.PrimaryKeyRelatedField(queryset=Subject.objects.all(), many=True)
    display_name = serializers.CharField(read_only=True)
    pathway = serializers.IntegerField(source='track.pathway_id', read_only=True)
    pathway_name = serializers.CharField(source='track.pathway.name', read_only=True)

    class Meta:
        model = PresetCombination
        fields = ['id', 'track', 'pathway', 'pathway_name', 'name', 'display_name', 'code', 'subjects', 'is_active']

    def validate_subjects(self, subjects):
        # The one hard rule from the official catalog: a combination is EXACTLY 3 subjects.
        # Deliberately not cross-checked against any SubjectPool — see PresetCombination's
        # docstring on why this stays decoupled from the school's own preset-building tool.
        if len(subjects) != 3:
            raise serializers.ValidationError("A preset combination must have exactly 3 subjects.")
        if len({s.id for s in subjects}) != 3:
            raise serializers.ValidationError("A preset combination's 3 subjects must be distinct.")
        return subjects
