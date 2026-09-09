"""Public service surface for the `staff` app.

Staff-specific business data: teacher leave, long-term relief assignment,
structural availability.

RULE: every function here takes and returns plain dataclasses -- never a
Django model instance or QuerySet.

This app may import services from:
    - apps.identity.services
    - apps.academics.services (for TimeSlot -- see the plan's
      implementation-time correction note: TimeSlot moved from `timetable`
      to `academics` because it has zero FK dependencies of its own)

Track B step 5: TeacherLeave/LongTermReliefAssignment/TeacherStructuralAvailability
physically relocated to apps/staff/models.py -- function bodies below now
import from there directly.
"""
from dataclasses import dataclass
from datetime import date
from typing import Optional, Sequence

from apps.staff.models import TeacherLeave, LongTermReliefAssignment, TeacherStructuralAvailability


@dataclass(frozen=True)
class TeacherLeaveDTO:
    id: int
    teacher_id: int
    leave_type: str
    start_date: date
    end_date: date
    status: str
    is_long_term: bool


@dataclass(frozen=True)
class ReliefAssignmentDTO:
    id: int
    absent_teacher_id: int
    relief_teacher_id: int
    start_date: date
    end_date: date


@dataclass(frozen=True)
class StructuralAvailabilityDTO:
    id: int
    teacher_id: int
    time_slot_id: int
    reason: Optional[str]


def get_teacher_leave(leave_id: int) -> Optional[TeacherLeaveDTO]:
    leave = TeacherLeave.objects.filter(id=leave_id).first()
    return _leave_to_dto(leave) if leave else None


def list_teacher_leaves(*, teacher_id: Optional[int] = None, status: Optional[str] = None) -> Sequence[TeacherLeaveDTO]:
    qs = TeacherLeave.objects.all()
    if teacher_id is not None:
        qs = qs.filter(teacher_id=teacher_id)
    if status is not None:
        qs = qs.filter(status=status)
    return tuple(_leave_to_dto(l) for l in qs)


def _leave_to_dto(leave) -> TeacherLeaveDTO:
    return TeacherLeaveDTO(
        id=leave.id, teacher_id=leave.teacher_id, leave_type=leave.leave_type,
        start_date=leave.start_date, end_date=leave.end_date, status=leave.status,
        is_long_term=leave.is_long_term,
    )


def list_active_relief_assignments(*, absent_teacher_id: Optional[int] = None) -> Sequence[ReliefAssignmentDTO]:
    qs = LongTermReliefAssignment.objects.all()
    if absent_teacher_id is not None:
        qs = qs.filter(absent_teacher_id=absent_teacher_id)
    return tuple(
        ReliefAssignmentDTO(
            id=r.id, absent_teacher_id=r.absent_teacher_id, relief_teacher_id=r.relief_teacher_id,
            start_date=r.start_date, end_date=r.end_date,
        )
        for r in qs
    )


def get_relief_teacher_for(*, absent_teacher_id: int, on_date: date) -> Optional[int]:
    """Returns the relief teacher's id currently covering for `absent_teacher_id`
    on `on_date`, or None if nobody is. Used by timetable/allocation code that
    today reaches into LongTermReliefAssignment directly."""
    r = LongTermReliefAssignment.objects.filter(
        absent_teacher_id=absent_teacher_id, start_date__lte=on_date, end_date__gte=on_date,
    ).first()
    return r.relief_teacher_id if r else None


def list_unavailable_slots(*, teacher_id: int) -> Sequence[StructuralAvailabilityDTO]:
    qs = TeacherStructuralAvailability.objects.filter(teacher_id=teacher_id)
    return tuple(
        StructuralAvailabilityDTO(id=a.id, teacher_id=a.teacher_id, time_slot_id=a.time_slot_id, reason=a.reason)
        for a in qs
    )


def is_teacher_on_leave(*, teacher_id: int, on_date: date) -> bool:
    return TeacherLeave.objects.filter(
        teacher_id=teacher_id, status='Approved', start_date__lte=on_date, end_date__gte=on_date,
    ).exists()
