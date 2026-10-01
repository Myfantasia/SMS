"""Event for a confirmed teacher-allocation rebalance. Own module, same reasoning as
allocation_events.py — added without touching shared/events/types.py, which other work may still
have uncommitted edits in."""
from dataclasses import dataclass
from datetime import datetime
from typing import Optional


@dataclass(frozen=True)
class AllocationRebalancedEvent:
    term_id: int
    year_id: int
    class_ids: tuple
    moves_applied: int
    teacher_user_ids: tuple
    operator_id: Optional[int]
    occurred_at: datetime
