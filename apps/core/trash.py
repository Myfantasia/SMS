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
    setattr(instance, flag_field, flag_false)
    instance.deleted_at = None
    instance.deleted_by = None
    instance.save()
    write_audit_log(
        operator_id=operator.id if operator else None,
        action_type='RESTORE', module=module, description=description,
    )
