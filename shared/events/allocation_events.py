"""Events about teacher-allocation publishing. Kept in its own module (rather than types.py) so it
can be added without touching a file other work is editing. Same rules as types.py: frozen
dataclasses, IDs only, no model instances."""
from dataclasses import dataclass
from datetime import datetime
from typing import Optional


@dataclass(frozen=True)
class AllocationsPublishedEvent:
    """Published (after commit) when an admin publishes teacher allocations for one or more classes.

    `teacher_user_ids` are auth-user ids of every teacher with a contract in the published scope
    (duplicates allowed; receivers de-duplicate). `timetable_synced` is False when there was no
    draft timetable to apply the change to (none active, or the active one is live)."""
    term_id: int
    year_id: int
    class_ids: tuple
    teacher_user_ids: tuple
    published_by_id: Optional[int]
    timetable_synced: bool
    occurred_at: datetime
