import random
from apps.identity.models import TeacherExtra
from apps.academics.models import Subject

# Get all subjects
all_subjects = list(Subject.objects.all())

# Get subjects with 0 teachers
subjects_with_counts = []
for sub in all_subjects:
    count = sub.qualified_teachers.count()
    subjects_with_counts.append((count, sub))

subjects_with_counts.sort(key=lambda x: x[0])

# Ensure all teachers have at least 3 subjects. Prioritize subjects with lowest counts.
all_teachers = TeacherExtra.objects.all()

for teacher in all_teachers:
    current = teacher.qualified_subjects.count()
    if current < 3:
        needed = 3 - current
        # re-sort subjects_with_counts
        subjects_with_counts.sort(key=lambda x: x[0])
        # Pick the `needed` subjects with lowest counts
        chosen = []
        for i in range(len(subjects_with_counts)):
            if len(chosen) == needed:
                break
            count, sub = subjects_with_counts[i]
            if not teacher.qualified_subjects.filter(id=sub.id).exists():
                chosen.append((i, sub))
                
        for idx, sub in chosen:
            teacher.qualified_subjects.add(sub)
            subjects_with_counts[idx] = (subjects_with_counts[idx][0] + 1, sub)
            
    # update teacher.subjects string
    qs = teacher.qualified_subjects.all()
    teacher.subjects = ", ".join(s.name for s in qs)
    teacher.save(update_fields=['subjects'])

print("Ensured all teachers have >= 3 subjects, prioritized low-coverage subjects.")
