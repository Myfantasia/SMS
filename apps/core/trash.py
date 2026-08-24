"""
Shared plumbing for the Trash/soft-delete system. Every trashable entity
(ClassStream, Subject, User accounts, TeacherLeave, Role, Event, Notice,
Assignment) registers itself in TRASH_REGISTRY so the Trash list/restore/purge
views (school/views/trash_views.py) and the auto-purge sweep
(apps.core.trash.purge_expired_trash) don't need per-model branches.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Callable, Optional

from django.contrib.auth.models import User
from django.utils import timezone

from apps.core.services import write_audit_log

AUTO_PURGE_AFTER = timedelta(days=20)


@dataclass(frozen=True)
class TrashEntityConfig:
    model: type
    flag_field: str          # e.g. 'is_deleted' or 'user__is_active' style lookup base
    flag_true: Any            # value meaning "trashed" (True, or False for is_active)
    flag_false: Any           # value meaning "live"
    auto_purge: bool          # False for ClassStream, Subject
    label_fn: Callable[[Any], str]
    purge_fn: Optional[Callable[[Any], None]] = None  # None => instance.delete()


TRASH_REGISTRY: dict[str, TrashEntityConfig] = {}


def register_trash_entity(entity_type: str, config: TrashEntityConfig) -> None:
    TRASH_REGISTRY[entity_type] = config


def soft_delete(instance, *, operator: Optional[User], flag_field: str = 'is_deleted',
                 flag_true: Any = True, module: str, description: str) -> None:
    setattr(instance, flag_field, flag_true)
    instance.deleted_at = timezone.now()
    instance.deleted_by = operator
    instance.save()
    write_audit_log(
        operator_id=operator.id if operator else None,
        action_type='DELETE', module=module, description=description,
    )


def restore(instance, *, operator: Optional[User], flag_field: str = 'is_deleted',
            flag_false: Any = False, module: str, description: str) -> None:
    if '__' in flag_field:
        obj, attr = flag_field.split('__', 1)
        setattr(getattr(instance, obj), attr, flag_false)
        getattr(instance, obj).save(update_fields=[attr])
    else:
        setattr(instance, flag_field, flag_false)
    instance.deleted_at = None
    instance.deleted_by = None
    instance.save()
    write_audit_log(
        operator_id=operator.id if operator else None,
        action_type='RESTORE', module=module, description=description,
    )


def purge_expired_trash(entity_type: Optional[str] = None) -> int:
    """
    Permanently deletes every auto-purgeable row whose deleted_at is more than
    AUTO_PURGE_AFTER in the past. Class Stream and Subject are registered with
    auto_purge=False and are never touched here — they only leave Trash via the
    manual purge endpoint (school/views/trash_views.py:api_purge_trash_item).
    Safe to call repeatedly (idempotent — nothing left to purge is a no-op).
    """
    cutoff = timezone.now() - AUTO_PURGE_AFTER
    entity_types = [entity_type] if entity_type else list(TRASH_REGISTRY.keys())
    purged_count = 0

    for et in entity_types:
        config = TRASH_REGISTRY.get(et)
        if config is None or not config.auto_purge:
            continue

        lookup = {config.flag_field: config.flag_true, 'deleted_at__lte': cutoff}
        expired = list(config.model.objects.filter(**lookup))
        for instance in expired:
            label = config.label_fn(instance)
            if config.purge_fn:
                config.purge_fn(instance)
            else:
                instance.delete()
            write_audit_log(
                operator_id=None, action_type='DELETE', module=et,
                description=f"Auto-purged {label} from Trash after 20 days.",
            )
            purged_count += 1

    return purged_count
