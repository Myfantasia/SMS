from django.db.models import ProtectedError
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from rest_framework import viewsets
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response

from school.decorators import require_permission
from school.models.classSubjects_models import (
    Curriculum, CurriculumPreset, Pathway, PresetCombination, SubjectCurriculumProfile, SystemAuditLog, Tier, Track,
)
from school.rbac import HasModulePermission, assert_curriculum_editable, user_has_permission
from school.serializers.curriculum_serializers import (
    CurriculumPresetSerializer, CurriculumSerializer, PathwaySerializer, PresetCombinationSerializer,
    SubjectCurriculumProfileSerializer, TierSerializer, TrackSerializer,
)


@csrf_exempt
@require_permission('curriculum.view')
def api_curriculum_presets(request):
    """
    API: CURRICULUM PRESETS
    Fetches the global list of curriculum templates (e.g., 8-4-4, CBC)
    to populate the Quick Presets sidebar in the React frontend.

    Kept as a plain read-only endpoint (rather than folded into CurriculumPresetViewSet)
    since ManageCurriculum.tsx's sidebar already depends on this exact shape.
    """
    if request.method == 'GET':
        try:
            presets = CurriculumPreset.objects.all()

            data = []
            for preset in presets:
                data.append({
                    'id': preset.id,
                    'name': preset.name,
                    'min_subjects': preset.min_subjects,
                    'max_subjects': preset.max_subjects
                })

            return JsonResponse({
                'status': 'success',
                'data': data
            })

        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})

    return JsonResponse({'status': 'error', 'message': 'Invalid request method. Expected GET.'})


class _RequireCurriculumArchive(BasePermission):
    """Used only for CurriculumViewSet's sunset/archive actions — a bigger blast radius
    than routine curriculum.edit, see CurriculumViewSet.get_permissions()."""

    def has_permission(self, request, view):
        return bool(
            request.user and request.user.is_authenticated
            and user_has_permission(request.user, 'curriculum.archive')
        )


class CurriculumViewSet(viewsets.ModelViewSet):
    """
    Curricula are the top-level entity everything else (presets, pathways, subject pools,
    and grade-level rules via GradeLevel.curriculum) hangs off of. Never deleted — see
    perform_destroy — retiring one goes through sunset (stop new grades) and/or archive
    (freeze all its config), both gated behind curriculum.archive instead of curriculum.edit.
    """
    queryset = Curriculum.objects.all()
    serializer_class = CurriculumSerializer
    authentication_classes = [SessionAuthentication]
    rbac_view_permission = 'curriculum.view'
    rbac_edit_permission = 'curriculum.edit'

    def get_permissions(self):
        if self.action in ('sunset', 'archive'):
            return [IsAuthenticated(), _RequireCurriculumArchive()]
        return [IsAuthenticated(), HasModulePermission()]

    def perform_create(self, serializer):
        curriculum = serializer.save()
        SystemAuditLog.objects.create(
            operator=self.request.user, action_type='CREATE', module='Curriculum',
            description=f"Created curriculum '{curriculum.name}' ({curriculum.code})."
        )

    def perform_update(self, serializer):
        curriculum = serializer.save()
        SystemAuditLog.objects.create(
            operator=self.request.user, action_type='UPDATE', module='Curriculum',
            description=f"Updated curriculum '{curriculum.name}' ({curriculum.code})."
        )

    def perform_destroy(self, instance):
        raise ValidationError(
            "Curricula are never deleted — use 'sunset' to stop it being selectable for new "
            "grades, or 'archive' to freeze all of its presets/pathways/pools."
        )

    @action(detail=True, methods=['post'])
    def sunset(self, request, pk=None):
        curriculum = self.get_object()
        curriculum.is_active_for_new_grades = False
        curriculum.save(update_fields=['is_active_for_new_grades'])
        SystemAuditLog.objects.create(
            operator=request.user, action_type='UPDATE', module='Curriculum',
            description=f"Sunset curriculum '{curriculum.name}' — no longer selectable for new grades."
        )
        return Response(CurriculumSerializer(curriculum).data)

    @action(detail=True, methods=['post'])
    def archive(self, request, pk=None):
        curriculum = self.get_object()
        curriculum.is_archived = True
        curriculum.save(update_fields=['is_archived'])
        SystemAuditLog.objects.create(
            operator=request.user, action_type='UPDATE', module='Curriculum',
            description=f"Archived curriculum '{curriculum.name}' — its presets/pathways/pools are now frozen."
        )
        return Response(CurriculumSerializer(curriculum).data)


class PathwayViewSet(viewsets.ModelViewSet):
    queryset = Pathway.objects.select_related('curriculum').all()
    serializer_class = PathwaySerializer
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'curriculum.view'
    rbac_edit_permission = 'curriculum.edit'

    def get_queryset(self):
        qs = super().get_queryset()
        curriculum_id = self.request.query_params.get('curriculum')
        if curriculum_id:
            qs = qs.filter(curriculum_id=curriculum_id)
        return qs

    def perform_create(self, serializer):
        curriculum = serializer.validated_data.get('curriculum')
        assert_curriculum_editable(curriculum, self.request.user)
        pathway = serializer.save()
        SystemAuditLog.objects.create(
            operator=self.request.user, action_type='CREATE', module='Curriculum',
            description=f"Created pathway '{pathway.name}' under {pathway.curriculum.code}."
        )

    def perform_update(self, serializer):
        assert_curriculum_editable(serializer.instance.curriculum, self.request.user)
        pathway = serializer.save()
        SystemAuditLog.objects.create(
            operator=self.request.user, action_type='UPDATE', module='Curriculum',
            description=f"Updated pathway '{pathway.name}' ({pathway.curriculum.code})."
        )

    def perform_destroy(self, instance):
        assert_curriculum_editable(instance.curriculum, self.request.user)
        name, code = instance.name, instance.curriculum.code
        instance.delete()
        SystemAuditLog.objects.create(
            operator=self.request.user, action_type='DELETE', module='Curriculum',
            description=f"Deleted pathway '{name}' ({code})."
        )


class TrackViewSet(viewsets.ModelViewSet):
    """
    Pathway-scoped specializations (e.g. STEM's Pure Sciences / Applied Sciences / Technical
    Studies). Mirrors PathwayViewSet exactly, except editability is gated through the Track's
    Pathway's Curriculum (there's no direct curriculum FK on Track itself), and ProtectedError
    handling matches TierViewSet since StudentPathwaySelection.track can reference one.
    """
    queryset = Track.objects.select_related('pathway__curriculum').all()
    serializer_class = TrackSerializer
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'curriculum.view'
    rbac_edit_permission = 'curriculum.edit'

    def get_queryset(self):
        qs = super().get_queryset()
        pathway_id = self.request.query_params.get('pathway')
        if pathway_id:
            qs = qs.filter(pathway_id=pathway_id)
        return qs

    def perform_create(self, serializer):
        pathway = serializer.validated_data.get('pathway')
        assert_curriculum_editable(pathway.curriculum, self.request.user)
        track = serializer.save()
        SystemAuditLog.objects.create(
            operator=self.request.user, action_type='CREATE', module='Curriculum',
            description=f"Created track '{track.name}' under pathway '{track.pathway.name}'."
        )

    def perform_update(self, serializer):
        assert_curriculum_editable(serializer.instance.pathway.curriculum, self.request.user)
        track = serializer.save()
        SystemAuditLog.objects.create(
            operator=self.request.user, action_type='UPDATE', module='Curriculum',
            description=f"Updated track '{track.name}' ({track.pathway.name})."
        )

    def perform_destroy(self, instance):
        assert_curriculum_editable(instance.pathway.curriculum, self.request.user)
        name, pathway_name = instance.name, instance.pathway.name
        # Presets/student selections referencing this track use on_delete=SET_NULL (unlike
        # Tier's PROTECT), since losing a track is a much smaller structural event than
        # losing a whole pathway — they just fall back to "no track" rather than blocking.
        instance.delete()
        SystemAuditLog.objects.create(
            operator=self.request.user, action_type='DELETE', module='Curriculum',
            description=f"Deleted track '{name}' ({pathway_name})."
        )


class TierViewSet(viewsets.ModelViewSet):
    """
    Curriculum-defined stage splits (e.g. CBC's JSS/SSS). Deliberately generic — see Tier's
    docstring — so this mirrors PathwayViewSet exactly except for the ProtectedError handling,
    since GradeLevel.tier uses on_delete=PROTECT (unlike Pathway, nothing blocks its deletion).
    """
    queryset = Tier.objects.select_related('curriculum').all()
    serializer_class = TierSerializer
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'curriculum.view'
    rbac_edit_permission = 'curriculum.edit'

    def get_queryset(self):
        qs = super().get_queryset()
        curriculum_id = self.request.query_params.get('curriculum')
        if curriculum_id:
            qs = qs.filter(curriculum_id=curriculum_id)
        return qs

    def perform_create(self, serializer):
        curriculum = serializer.validated_data.get('curriculum')
        assert_curriculum_editable(curriculum, self.request.user)
        tier = serializer.save()
        SystemAuditLog.objects.create(
            operator=self.request.user, action_type='CREATE', module='Curriculum',
            description=f"Created tier '{tier.name}' under {tier.curriculum.code}."
        )

    def perform_update(self, serializer):
        assert_curriculum_editable(serializer.instance.curriculum, self.request.user)
        tier = serializer.save()
        SystemAuditLog.objects.create(
            operator=self.request.user, action_type='UPDATE', module='Curriculum',
            description=f"Updated tier '{tier.name}' ({tier.curriculum.code})."
        )

    def perform_destroy(self, instance):
        assert_curriculum_editable(instance.curriculum, self.request.user)
        name, code = instance.name, instance.curriculum.code
        try:
            instance.delete()
        except ProtectedError:
            raise ValidationError(
                f"Cannot delete tier '{name}' — it's still assigned to one or more grades. "
                "Reassign those grades first."
            )
        SystemAuditLog.objects.create(
            operator=self.request.user, action_type='DELETE', module='Curriculum',
            description=f"Deleted tier '{name}' ({code})."
        )


class CurriculumPresetViewSet(viewsets.ModelViewSet):
    queryset = CurriculumPreset.objects.select_related('curriculum', 'pathway').prefetch_related('pools__subjects')
    serializer_class = CurriculumPresetSerializer
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'curriculum.view'
    rbac_edit_permission = 'curriculum.edit'

    def get_queryset(self):
        qs = super().get_queryset()
        curriculum_id = self.request.query_params.get('curriculum')
        if curriculum_id:
            qs = qs.filter(curriculum_id=curriculum_id)
        return qs

    def perform_create(self, serializer):
        curriculum = serializer.validated_data.get('curriculum')
        assert_curriculum_editable(curriculum, self.request.user)
        preset = serializer.save()
        SystemAuditLog.objects.create(
            operator=self.request.user, action_type='CREATE', module='Curriculum',
            description=f"Created curriculum preset '{preset.name}'."
        )

    def perform_update(self, serializer):
        assert_curriculum_editable(serializer.instance.curriculum, self.request.user)
        preset = serializer.save()
        SystemAuditLog.objects.create(
            operator=self.request.user, action_type='UPDATE', module='Curriculum',
            description=f"Updated curriculum preset '{preset.name}'."
        )

    def perform_destroy(self, instance):
        assert_curriculum_editable(instance.curriculum, self.request.user)
        name = instance.name
        instance.delete()
        SystemAuditLog.objects.create(
            operator=self.request.user, action_type='DELETE', module='Curriculum',
            description=f"Deleted curriculum preset '{name}'."
        )


class PresetCombinationViewSet(viewsets.ModelViewSet):
    """
    The official KNEC 3-subject combination catalog, scoped to a Track (mirrors TrackViewSet's
    editability gating — through the Track's Pathway's Curriculum, since there's no direct
    curriculum FK here either). Independent of CurriculumPresetViewSet/SubjectPool on purpose —
    see PresetCombination's model docstring.
    """
    queryset = PresetCombination.objects.select_related('track__pathway__curriculum').prefetch_related('subjects')
    serializer_class = PresetCombinationSerializer
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'curriculum.view'
    rbac_edit_permission = 'curriculum.edit'

    def get_queryset(self):
        qs = super().get_queryset()
        track_id = self.request.query_params.get('track')
        pathway_id = self.request.query_params.get('pathway')
        if track_id:
            qs = qs.filter(track_id=track_id)
        if pathway_id:
            qs = qs.filter(track__pathway_id=pathway_id)
        return qs

    def perform_create(self, serializer):
        track = serializer.validated_data.get('track')
        assert_curriculum_editable(track.pathway.curriculum, self.request.user)
        combo = serializer.save()
        SystemAuditLog.objects.create(
            operator=self.request.user, action_type='CREATE', module='Curriculum',
            description=f"Created preset combination '{combo.display_name()}' under track '{combo.track.name}'."
        )

    def perform_update(self, serializer):
        assert_curriculum_editable(serializer.instance.track.pathway.curriculum, self.request.user)
        combo = serializer.save()
        SystemAuditLog.objects.create(
            operator=self.request.user, action_type='UPDATE', module='Curriculum',
            description=f"Updated preset combination '{combo.display_name()}' ({combo.track.name})."
        )

    def perform_destroy(self, instance):
        assert_curriculum_editable(instance.track.pathway.curriculum, self.request.user)
        name, track_name = instance.display_name(), instance.track.name
        instance.delete()
        SystemAuditLog.objects.create(
            operator=self.request.user, action_type='DELETE', module='Curriculum',
            description=f"Deleted preset combination '{name}' ({track_name})."
        )


class SubjectCurriculumProfileViewSet(viewsets.ModelViewSet):
    """
    Assigns a Subject to a Curriculum (optionally scoped to one Tier), mirroring TierViewSet's
    shape exactly. Used by CurriculumHub's Tier/Curriculum detail views to build up which
    subjects apply where, the same "assign, don't just list" pattern used for Grade <-> Tier.
    """
    queryset = SubjectCurriculumProfile.objects.select_related('subject', 'curriculum', 'tier', 'department')
    serializer_class = SubjectCurriculumProfileSerializer
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'curriculum.view'
    rbac_edit_permission = 'curriculum.edit'

    def get_queryset(self):
        qs = super().get_queryset()
        subject_id = self.request.query_params.get('subject')
        curriculum_id = self.request.query_params.get('curriculum')
        tier_id = self.request.query_params.get('tier')
        if subject_id:
            qs = qs.filter(subject_id=subject_id)
        if curriculum_id:
            qs = qs.filter(curriculum_id=curriculum_id)
        if tier_id:
            qs = qs.filter(tier_id=tier_id)
        return qs

    def perform_create(self, serializer):
        curriculum = serializer.validated_data.get('curriculum')
        assert_curriculum_editable(curriculum, self.request.user)
        profile = serializer.save()
        SystemAuditLog.objects.create(
            operator=self.request.user, action_type='CREATE', module='Curriculum',
            description=f"Assigned subject '{profile.subject.code}' to {profile.curriculum.code}"
                        + (f"/{profile.tier.code}" if profile.tier else "") + "."
        )

    def perform_update(self, serializer):
        assert_curriculum_editable(serializer.instance.curriculum, self.request.user)
        profile = serializer.save()
        SystemAuditLog.objects.create(
            operator=self.request.user, action_type='UPDATE', module='Curriculum',
            description=f"Updated subject profile for '{profile.subject.code}' ({profile.curriculum.code})."
        )

    def perform_destroy(self, instance):
        assert_curriculum_editable(instance.curriculum, self.request.user)
        subject_code, scope = instance.subject.code, instance.curriculum.code
        instance.delete()
        SystemAuditLog.objects.create(
            operator=self.request.user, action_type='DELETE', module='Curriculum',
            description=f"Removed subject '{subject_code}' from {scope}."
        )
