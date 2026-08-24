"""
Trash API — list/restore/permanently-purge soft-deleted rows across every
entity type registered in apps.core.trash.TRASH_REGISTRY. One generic set of
views instead of one per entity, since every entity follows the same
flag/restore/purge shape (see apps/core/trash.py for the registry contract).
"""
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_http_methods

from apps.core.trash import TRASH_REGISTRY, restore
from school.decorators import require_permission


def _entity_config_or_404(entity_type):
    config = TRASH_REGISTRY.get(entity_type)
    if config is None:
        return None
    return config


@require_permission('trash.view')
def api_list_trash(request, entity_type):
    config = _entity_config_or_404(entity_type)
    if config is None:
        return JsonResponse({'status': 'error', 'message': f"Unknown trash entity type '{entity_type}'."}, status=404)

    from apps.core.trash import purge_expired_trash
    if config.auto_purge:
        purge_expired_trash(entity_type=entity_type)

    lookup = {config.flag_field: config.flag_true}
    rows = config.model.objects.filter(**lookup).order_by('-deleted_at')

    data = []
    for row in rows:
        purge_at = None
        if config.auto_purge and row.deleted_at:
            from apps.core.trash import AUTO_PURGE_AFTER
            purge_at = (row.deleted_at + AUTO_PURGE_AFTER).isoformat()
        data.append({
            'id': row.id,
            'label': config.label_fn(row),
            'deleted_at': row.deleted_at.isoformat() if row.deleted_at else None,
            'deleted_by': row.deleted_by.get_full_name() or row.deleted_by.username if row.deleted_by else None,
            'auto_purge': config.auto_purge,
            'purge_at': purge_at,
        })
    return JsonResponse({'status': 'success', 'entity_type': entity_type, 'data': data})


@require_http_methods(['POST'])
@require_permission('trash.manage')
def api_restore_trash_item(request, entity_type, pk):
    config = _entity_config_or_404(entity_type)
    if config is None:
        return JsonResponse({'status': 'error', 'message': f"Unknown trash entity type '{entity_type}'."}, status=404)

    instance = get_object_or_404(config.model, pk=pk)
    restore(
        instance, operator=request.user, flag_field=config.flag_field, flag_false=config.flag_false,
        module=entity_type, description=f"Restored {config.label_fn(instance)} from Trash.",
    )
    return JsonResponse({'status': 'success'})


@require_http_methods(['POST'])
@require_permission('trash.manage')
def api_purge_trash_item(request, entity_type, pk):
    config = _entity_config_or_404(entity_type)
    if config is None:
        return JsonResponse({'status': 'error', 'message': f"Unknown trash entity type '{entity_type}'."}, status=404)

    instance = get_object_or_404(config.model, pk=pk)
    label = config.label_fn(instance)

    from apps.core.services import write_audit_log
    if config.purge_fn:
        config.purge_fn(instance)
    else:
        instance.delete()
    write_audit_log(
        operator_id=request.user.id, action_type='DELETE', module=entity_type,
        description=f"Permanently purged {label} from Trash.",
    )
    return JsonResponse({'status': 'success'})
