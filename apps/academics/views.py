"""Views for the `academics` app -- Track B has not yet moved any existing view here; this is
the first real endpoint served directly from this app (see apps/academics/urls.py)."""
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.academics.services import list_departments


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def api_list_departments(request):
    """GET /api/academics/departments/?curriculum=<id>&tier=<id optional>"""
    curriculum_id = request.query_params.get('curriculum')
    if not curriculum_id:
        return Response({"error": "curriculum is required."}, status=400)
    tier_id_raw = request.query_params.get('tier') or None
    try:
        curriculum_id = int(curriculum_id)
        tier_id = int(tier_id_raw) if tier_id_raw else None
    except (TypeError, ValueError):
        return Response({"error": "curriculum and tier must be integers."}, status=400)
    departments = list_departments(
        curriculum_id=curriculum_id,
        tier_id=tier_id,
    )
    return Response({"departments": [
        {"id": d.id, "name": d.name, "code": d.code, "curriculum_id": d.curriculum_id}
        for d in departments
    ]})
