"""Events about the timetable's own publish lifecycle. Own module for the same reason
allocation_events.py is its own module: added without touching files other work may be editing."""
from dataclasses import dataclass
from datetime import datetime
from typing import Optional


@dataclass(frozen=True)
class TimetablePublishedEvent:
    """Published (after commit) when a timetable goes live. teacher_user_ids are auth-user ids of
    every teacher with a lesson on the published timetable (duplicates allowed; receivers
    de-duplicate)."""
    timetable_id: int
    timetable_name: str
    term_id: int
    year_id: int
    teacher_user_ids: tuple
    published_by_id: Optional[int]
    occurred_at: datetime
