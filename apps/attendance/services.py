"""Public service surface for the `attendance` app.

Attendance sessions and records.

RULE: every function here takes and returns plain dataclasses -- never a
Django model instance or QuerySet.

This app may import services from:
    - apps.identity.services
    - apps.academics.services

Track B step 4: AttendanceSession/AttendanceRecord physically relocated to
apps/attendance/models.py -- function bodies below now import from there
directly.

Note: `results`'s dependency on this app (StudentTermResult.days_present/
days_absent) is currently DORMANT -- those two fields are defined but never
read or written anywhere in the codebase today (verified by grep). Don't
wire a get_attendance_summary-style call from `results` until something
actually needs it; adding one speculatively would be exactly the kind of
premature abstraction to avoid.
"""
from dataclasses import dataclass
from datetime import date
from typing import Optional, Sequence

from apps.attendance.models import AttendanceSession, AttendanceRecord


@dataclass(frozen=True)
class AttendanceSessionDTO:
    id: int
    class_stream_id: int
    date: date
    submitted_by_id: Optional[int]


@dataclass(frozen=True)
class AttendanceRecordDTO:
    id: int
    session_id: int
    student_id: int
    status: str
    remarks: Optional[str]


def get_session(*, class_stream_id: int, on_date: date) -> Optional[AttendanceSessionDTO]:
    s = AttendanceSession.objects.filter(class_stream_id=class_stream_id, date=on_date).first()
    if not s:
        return None
    return AttendanceSessionDTO(id=s.id, class_stream_id=s.class_stream_id, date=s.date, submitted_by_id=s.submitted_by_id)


def submit_attendance(*, class_stream_id: int, on_date: date, submitted_by_id: Optional[int], records: Sequence[dict]) -> AttendanceSessionDTO:
    """`records` is a sequence of {"student_id": int, "status": str, "remarks": str | None}."""
    session, _ = AttendanceSession.objects.update_or_create(
        class_stream_id=class_stream_id, date=on_date,
        defaults={'submitted_by_id': submitted_by_id},
    )
    for r in records:
        AttendanceRecord.objects.update_or_create(
            session=session, student_id=r['student_id'],
            defaults={'status': r['status'], 'remarks': r.get('remarks')},
        )
    return AttendanceSessionDTO(
        id=session.id, class_stream_id=session.class_stream_id, date=session.date,
        submitted_by_id=session.submitted_by_id,
    )


def list_records(*, session_id: int) -> Sequence[AttendanceRecordDTO]:
    return tuple(
        AttendanceRecordDTO(id=r.id, session_id=r.session_id, student_id=r.student_id, status=r.status, remarks=r.remarks)
        for r in AttendanceRecord.objects.filter(session_id=session_id)
    )


def get_student_attendance_counts(*, student_id: int, start: date, end: date) -> dict:
    """Returns {"Present": n, "Absent": n, "Late": n, "Excused": n} for a date
    range -- the aggregation `results` would call if/when
    StudentTermResult.days_present/days_absent are ever actually wired up
    (see the dormant-dependency note above)."""
    from django.db.models import Count
    rows = (
        AttendanceRecord.objects.filter(
            student_id=student_id, session__date__gte=start, session__date__lte=end,
        )
        .values('status').annotate(n=Count('id'))
    )
    counts = {'Present': 0, 'Absent': 0, 'Late': 0, 'Excused': 0}
    counts.update({r['status']: r['n'] for r in rows})
    return counts
