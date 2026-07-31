import os
import uuid

from rest_framework.authentication import SessionAuthentication
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.throttling import ScopedRateThrottle
from rest_framework import status
from django.conf import settings
from django.contrib.auth.models import User
from django.core.files.storage import default_storage
from django.db.models import Q
from django.utils import timezone

from school.models.classSubjects_models import ClassStream
from school.models.models import ParentExtra, StudentExtra
from school.models.chat_models import ChatThread, ThreadParticipant, MessageAudit
from school.rbac import HasModulePermission, user_has_permission, get_user_role_label

class CsrfExemptSessionAuthentication(SessionAuthentication):
    """
    Custom session layer that authenticates users via active cookies
    but bypasses the explicit frontend CSRF token header check.
    """
    def enforce_csrf(self, request):
        return


# ---> NEW HELPER: UNIFIED ADMIN AUTHORIZATION <---
def check_is_admin(user):
    """
    Ensures a bulletproof, consistent admin check across all API endpoints.
    Catches Superusers, Staff, Profile-based admins, and Group-based admins.
    """
    return (
            user.is_superuser or
            user.is_staff or
            hasattr(user, 'adminextra') or
            user.groups.filter(name='ADMIN').exists()
    )


def serialize_message_audit(msg):
    """
    Shared wire-format for a MessageAudit row, used by both the REST history
    endpoint below and ChatConsumer (school/consumers/chat_consumer.py) so the
    two delivery paths (backfill vs live) always agree on shape.
    """
    sender = msg.sender
    return {
        "id": msg.id,
        "thread_id": str(msg.thread_id),
        "sender_id": sender.id if sender else None,
        "sender_name": (
            (f"{sender.first_name} {sender.last_name}".strip() or sender.username)
            if sender else "Deleted User"
        ),
        "sender_role": get_user_role_label(sender) if sender else None,
        "message_body": msg.message_body,
        "attachment_url": msg.attachment_url,
        "attachment_name": msg.attachment_name,
        "is_actionable": msg.is_actionable,
        "is_urgent": msg.is_urgent,
        "is_edited": msg.is_edited,
        "is_deleted": msg.is_deleted,
        "sent_at": msg.sent_at.isoformat(),
        "updated_at": msg.updated_at.isoformat(),
    }


# ==========================================
# API 1: THE DIRECTORY SEARCH (Strict Option A)
# ==========================================
class UserSearchAPI(APIView):
    """
    Finds allowed users to message based on strict school roles.
    React calls this as the user types in the search bar.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        query = request.GET.get('q', '').strip()

        if len(query) < 2:
            return Response({"results": []})

        user = request.user
        allowed_users = User.objects.none()  # Start with an empty list

        # ---> SECURITY FIX: Using the unified admin check <---
        # 1. ADMIN SEARCH LOGIC (Sees Everyone except students)
        if check_is_admin(user):
            allowed_users = User.objects.filter(
                Q(teacherextra__isnull=False) | Q(parentextra__isnull=False) | Q(adminextra__isnull=False)
            )

        # 2. TEACHER SEARCH LOGIC (Sees Admins, other Teachers, and Parents of THEIR students)
        elif hasattr(user, 'teacherextra'):
            teacher = user.teacherextra

            # Find classes they manage (either as Class Teacher or Subject Teacher)
            class_teacher_classes = teacher.assigned_classes.all()
            subject_teacher_classes = ClassStream.objects.filter(allocations__teacher=teacher)

            # Find students in those classes
            students = StudentExtra.objects.filter(
                Q(cl__in=class_teacher_classes) | Q(cl__in=subject_teacher_classes)
            )

            # Allow Admins, all Teachers, and strictly those specific Parents
            allowed_users = User.objects.filter(
                Q(adminextra__isnull=False) |
                Q(teacherextra__isnull=False) |
                Q(parentextra__students__in=students)
            )

        # 3. PARENT SEARCH LOGIC (Sees Admins, and strictly Teachers of THEIR children)
        elif hasattr(user, 'parentextra'):
            parent = user.parentextra
            children = parent.students.all()

            # Find the classes their children are in
            children_classes = ClassStream.objects.filter(studentextra__in=children)

            # Allow Admins, Class Teachers of their children, and Subject Teachers of their children
            allowed_users = User.objects.filter(
                Q(adminextra__isnull=False) |
                Q(teacherextra__assigned_classes__in=children_classes) |
                Q(teacherextra__subject_allocations__classroom__in=children_classes)
            )

        # 4. STUDENT SEARCH LOGIC (Blocked)
        elif hasattr(user, 'studentextra'):
            return Response({"error": "Students are not permitted to use the directory."}, status=403)

        # Apply the actual name search to the safely filtered list, exclude themselves
        query_terms = query.split()

        final_results = allowed_users

        # For every word typed, narrow down the list.
        for term in query_terms:
            final_results = final_results.filter(
                Q(first_name__icontains=term) |
                Q(last_name__icontains=term) |
                Q(email__icontains=term) |
                Q(username__icontains=term)
            )

        # Finally, exclude the person searching and limit to 15 results
        final_results = final_results.exclude(id=user.id).distinct()[:15]

        # Format the data for the React frontend
        results_data = []
        for u in final_results:
            role = "Admin"
            if hasattr(u, 'teacherextra'):
                role = "Teacher"
            elif hasattr(u, 'parentextra'):
                role = "Parent"

            # Check for empty first/last names to ensure something always displays
            display_name = f"{u.first_name} {u.last_name}".strip()
            if not display_name:
                display_name = u.username

            results_data.append({
                "user_id": u.id,
                "name": display_name,
                "role": role,
                "email": u.email
            })

        return Response({"results": results_data}, status=status.HTTP_200_OK)


# ==========================================
# API 2: THE ROOM GENERATOR (Find or Create)
# ==========================================
class GetOrCreateDirectThreadAPI(APIView):
    """
    React sends a target_user_id. Django returns an existing Chat UUID or makes a new one.
    """
    permission_classes = [IsAuthenticated]
    authentication_classes = [CsrfExemptSessionAuthentication]

    def post(self, request):
        target_user_id = request.data.get('target_user_id')
        student_context_id = request.data.get('student_id', None)

        if not target_user_id:
            return Response({"error": "Target user ID is required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            target_user = User.objects.get(id=target_user_id)
        except User.DoesNotExist:
            return Response({"error": "User not found."}, status=status.HTTP_404_NOT_FOUND)

        user1 = request.user
        user2 = target_user

        # ---> NEW: Prevent self-messaging <---
        if user1.id == user2.id:
            return Response({"error": "You cannot start a direct chat with yourself."},
                            status=status.HTTP_400_BAD_REQUEST)

        # ---> SECURITY FIX: IDOR BACKDOOR PREVENTION <---
        # Ensures that even if someone bypasses the UI search bar, the backend verifies they have the right to talk.
        if not check_is_admin(user1):
            if hasattr(user1, 'studentextra'):
                return Response({"error": "Students are not permitted to start chat threads."},
                                status=status.HTTP_403_FORBIDDEN)

            elif hasattr(user1, 'teacherextra'):
                teacher = user1.teacherextra
                managed_classes = ClassStream.objects.filter(Q(class_teacher=teacher) | Q(allocations__teacher=teacher))

                is_valid_parent = User.objects.filter(
                    parentextra__students__cl__in=managed_classes,
                    id=user2.id
                ).exists()

                is_valid_staff = User.objects.filter(
                    Q(is_superuser=True) |
                    Q(is_staff=True) |
                    Q(groups__name='ADMIN') |
                    Q(adminextra__isnull=False) |
                    Q(teacherextra__isnull=False),
                    id=user2.id
                ).exists()


                if not (is_valid_parent or is_valid_staff):
                    return Response({"error": "Permission denied: Unauthorized recipient."},
                                    status=status.HTTP_403_FORBIDDEN)

            elif hasattr(user1, 'parentextra'):
                parent = user1.parentextra
                children_classes = ClassStream.objects.filter(studentextra__in=parent.students.all())
                is_valid_teacher = User.objects.filter(
                    Q(teacherextra__assigned_classes__in=children_classes) |
                    Q(teacherextra__subject_allocations__classroom__in=children_classes),
                    id=user2.id
                ).exists()
                is_valid_admin = User.objects.filter(adminextra__isnull=False, id=user2.id).exists()
                if not (is_valid_teacher or is_valid_admin):
                    return Response({"error": "Permission denied: Unauthorized recipient."},
                                    status=status.HTTP_403_FORBIDDEN)

        # 1. CHECK FOR EXISTING ROOM
        existing_threads = ChatThread.objects.filter(
            thread_type='Direct',
            participants__user=user1
        ).filter(
            participants__user=user2
        )

        if student_context_id:
            existing_threads = existing_threads.filter(related_student__id=student_context_id)

        if existing_threads.exists():
            thread = existing_threads.first()
            return Response({
                "thread_id": str(thread.id),
                "is_new": False,
                "target_name": f"{target_user.first_name} {target_user.last_name}".strip() or target_user.username
            }, status=status.HTTP_200_OK)

        # 2. CREATE A BRAND-NEW ROOM
        student_obj = None
        if student_context_id:
            try:
                student_obj = StudentExtra.objects.get(id=student_context_id)
            except StudentExtra.DoesNotExist:
                pass

        new_thread = ChatThread.objects.create(
            thread_type='Direct',
            related_student=student_obj
        )

        # Give both users VIP access to the room
        ThreadParticipant.objects.create(thread=new_thread, user=user1)
        ThreadParticipant.objects.create(thread=new_thread, user=user2)

        return Response({
            "thread_id": str(new_thread.id),
            "is_new": True,
            "target_name": f"{target_user.first_name} {target_user.last_name}".strip() or target_user.username
        }, status=status.HTTP_201_CREATED)


def _build_last_message_preview(thread, user):
    """Short preview text for a thread's most recent message, for the sidebar row."""
    last_msg = thread.messages.order_by('-id').first()
    if not last_msg:
        return None

    if last_msg.sender_id == user.id:
        prefix = 'You: '
    elif thread.thread_type in ('Group', 'Broadcast') and last_msg.sender:
        prefix = f"{last_msg.sender.first_name or last_msg.sender.username}: "
    else:
        prefix = ''

    preview_text = last_msg.message_body
    if len(preview_text) > 60:
        preview_text = preview_text[:57] + '...'
    return f"{prefix}{preview_text}"


# ==========================================
# API 3: THE INBOX FETCHER
# ==========================================
class UserInboxAPI(APIView):
    """
    Loads all active chat rooms for the logged-in user to display on the left side of the screen.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user

        # ---> PERFORMANCE FIX: PREFETCHING <---
        # Added .prefetch_related to prevent the N+1 database bottleneck when looping through chats.
        my_participations = ThreadParticipant.objects.filter(user=user).select_related('thread').prefetch_related(
            'thread__participants__user')

        inbox_data = []

        for participation in my_participations:
            thread = participation.thread

            if not thread.is_active:
                continue

            if thread.thread_type in ['Group', 'Broadcast']:
                participant_count = thread.participants.count()
                name_display = f"{thread.thread_type} ({participant_count} members)"
            else:
                # ---> PERFORMANCE FIX: Uses prefetched data in memory instead of hitting the DB again
                other_participant = next((p for p in thread.participants.all() if p.user_id != user.id), None)
                if other_participant:
                    other_user = other_participant.user
                    name_display = f"{other_user.first_name} {other_user.last_name}".strip() or other_user.username
                    if thread.related_student:
                        name_display += f" (re: {thread.related_student.user.first_name})"
                else:
                    name_display = "Empty Chat"

            has_unread = False
            if participation.last_read_timestamp is None or thread.updated_at > participation.last_read_timestamp:
                has_unread = True

            inbox_data.append({
                "thread_id": str(thread.id),
                "chat_name": name_display,
                "type": thread.thread_type,
                "updated_at": thread.updated_at,
                "has_unread": has_unread,
                "last_message": _build_last_message_preview(thread, user),
            })

        inbox_data = sorted(inbox_data, key=lambda x: x['updated_at'], reverse=True)

        return Response({"inbox": inbox_data}, status=status.HTTP_200_OK)


# ==========================================
# API 4: MARK THREAD AS READ
# ==========================================
class MarkThreadReadAPI(APIView):
    """
    When a user clicks on a chat room in React, React silently pings this endpoint.
    It updates their specific 'last_read_timestamp'.
    """
    permission_classes = [IsAuthenticated]
    authentication_classes = [CsrfExemptSessionAuthentication]

    def post(self, request, thread_id):
        try:
            participation = ThreadParticipant.objects.get(
                thread_id=thread_id,
                user=request.user
            )
            participation.last_read_timestamp = timezone.now()
            participation.save()

            return Response({"status": "success"}, status=status.HTTP_200_OK)

        except ThreadParticipant.DoesNotExist:
            return Response({"error": "Not a participant in this thread."}, status=status.HTTP_403_FORBIDDEN)


# ==========================================
# API 5: CREATE GROUP / BROADCAST
# ==========================================
class CreateAdminGroupThreadAPI(APIView):
    """
    Allows Admins and Teachers to create multi-user Group Chats.
    Restricts 1-way Broadcasts strictly to Administrators.
    """
    permission_classes = [IsAuthenticated]
    authentication_classes = [CsrfExemptSessionAuthentication]

    def post(self, request):
        user = request.user
        thread_type = request.data.get('thread_type', 'Group')

        # ---> FUNCTIONAL FIX: TEACHER GROUP CREATION ALLOWED <---
        is_admin = check_is_admin(user)
        is_teacher = hasattr(user, 'teacherextra')

        # chat.manage (full toolkit) or chat.broadcast (narrower — just this action) is the
        # real authority here, not ADMIN-group membership — a Staff account whose assigned
        # Role grants either can broadcast too, same as an admin. Neither is held by anyone
        # outside Admin by default (see seed_rbac.py), so this only widens access when
        # someone was deliberately granted one of the two.
        if thread_type == 'Broadcast' and not (
            user_has_permission(user, 'chat.manage') or user_has_permission(user, 'chat.broadcast')
        ):
            return Response({"error": "Access Denied: Broadcasts are strictly reserved for Administrators."},
                            status=status.HTTP_403_FORBIDDEN)

        if thread_type == 'Group' and not (is_admin or is_teacher):
            return Response({"error": "Access Denied: You do not have permissions to establish a group room."},
                            status=status.HTTP_403_FORBIDDEN)

        if thread_type not in ['Group', 'Broadcast']:
            return Response({"error": "Invalid thread type."}, status=status.HTTP_400_BAD_REQUEST)

        target_user_ids = request.data.get('target_user_ids', [])
        if not target_user_ids or not isinstance(target_user_ids, list):
            return Response({"error": "A list of target user IDs is required."}, status=status.HTTP_400_BAD_REQUEST)

        new_thread = ChatThread.objects.create(thread_type=thread_type)
        ThreadParticipant.objects.create(thread=new_thread, user=user)

        valid_users = User.objects.filter(id__in=target_user_ids)
        for target in valid_users:
            if target.id != user.id:
                ThreadParticipant.objects.create(thread=new_thread, user=target)

        return Response({
            "thread_id": str(new_thread.id),
            "thread_type": thread_type,
            "participant_count": valid_users.count() + 1
        }, status=status.HTTP_201_CREATED)


# ==========================================
# API 6: ADMIN AUDIT VIEWER (COMPLIANCE LOGS)
# ==========================================
class AdminAuditLogAPI(APIView):
    """
    Allows Admins to pull the immutable, undeletable PostgreSQL message history
    for compliance and dispute resolution, directly from the MessageAudit table.
    """
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'chat.manage'

    def get(self, request, thread_id):
        user = request.user

        # ---> SECURITY FIX: CONSISTENT ADMIN GUARDS <---
        # Replaced hasattr(user, 'adminextra') to ensure Superusers are not locked out.
        # HasModulePermission already required chat.manage to reach here; also accept that
        # permission directly (not just legacy admin-group membership) so a Staff account
        # granted it via Roles & Permissions isn't blocked by this extra check.
        if not (check_is_admin(user) or user_has_permission(user, 'chat.manage')):
            return Response({"error": "Access denied. Admin clearance required."}, status=status.HTTP_403_FORBIDDEN)

        try:
            thread = ChatThread.objects.get(id=thread_id)
        except ChatThread.DoesNotExist:
            return Response({"error": "Thread not found."}, status=status.HTTP_404_NOT_FOUND)

        # No frontend consumer currently calls this endpoint (confirmed via grep), so
        # adding pagination here doesn't require any client-side coordination — but a
        # long-lived thread's full history was still an unbounded single response, so
        # cap it the same way ThreadMessageHistoryAPI already does for live chat.
        try:
            limit = min(int(request.GET.get('limit', 100)), 200)
        except (TypeError, ValueError):
            limit = 100
        try:
            offset = max(int(request.GET.get('offset', 0)), 0)
        except (TypeError, ValueError):
            offset = 0

        all_audits = MessageAudit.objects.filter(thread=thread).order_by('sent_at')
        total_count = all_audits.count()
        audits = all_audits[offset:offset + limit]

        audit_data = []
        for msg in audits:
            audit_data.append({
                "audit_id": msg.id,
                "sender_email": msg.sender.email if msg.sender else "Deleted User",
                "sender_name": f"{msg.sender.first_name} {msg.sender.last_name}".strip() if msg.sender else "Unknown",
                "message_body": msg.message_body,
                "attachment_url": getattr(msg, 'attachment_url', None),
                "is_urgent": msg.is_urgent,
                "sent_at": msg.sent_at,
                "synced_at": msg.synced_at
            })

        return Response({
            "thread_id": str(thread.id),
            "thread_type": thread.thread_type,
            "audit_logs": audit_data,
            "total_count": total_count,
            "has_more": offset + limit < total_count,
        }, status=status.HTTP_200_OK)


# ==========================================
# API 6b: MESSAGE HISTORY (CURSOR PAGINATION)
# ==========================================
class ThreadMessageHistoryAPI(APIView):
    """
    Cursor-paginated message history for a thread. React uses this to load the
    initial window on open and to backfill anything missed while the WebSocket
    was disconnected/reconnecting.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, thread_id):
        if not ThreadParticipant.objects.filter(thread_id=thread_id, user=request.user).exists():
            return Response({"error": "Not a participant in this thread."}, status=status.HTTP_403_FORBIDDEN)

        try:
            limit = min(int(request.GET.get('limit', 50)), 100)
        except (TypeError, ValueError):
            limit = 50

        messages_qs = MessageAudit.objects.filter(thread_id=thread_id).select_related('sender').order_by('-id')

        before = request.GET.get('before')
        if before:
            try:
                messages_qs = messages_qs.filter(id__lt=int(before))
            except (TypeError, ValueError):
                pass

        page = list(messages_qs[:limit])
        page.reverse()  # oldest-first, matching how ChatWindow renders

        return Response({
            "thread_id": str(thread_id),
            "messages": [serialize_message_audit(m) for m in page],
            "has_more": len(page) == limit,
        }, status=status.HTTP_200_OK)


# ==========================================
# API 6c: ATTACHMENT UPLOAD
# ==========================================
ALLOWED_ATTACHMENT_EXTENSIONS = {
    '.png', '.jpg', '.jpeg', '.gif', '.webp',
    '.mp4', '.mov', '.webm',
    '.pdf', '.doc', '.docx', '.txt', '.csv', '.xlsx',
}
MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024  # 25MB — matches the client-side cap in ChatWindow.tsx


class ChatAttachmentUploadAPI(APIView):
    """
    Stores a chat attachment under MEDIA_ROOT/chat_attachments/<thread_id>/ and hands
    back the URL/name the client then references in a WebSocket 'send'. Validates size
    and extension server-side — the old Firebase Storage path had no validation at all.
    """
    permission_classes = [IsAuthenticated]
    authentication_classes = [CsrfExemptSessionAuthentication]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'uploads'

    def post(self, request, thread_id):
        if not ThreadParticipant.objects.filter(thread_id=thread_id, user=request.user).exists():
            return Response({"error": "Not a participant in this thread."}, status=status.HTTP_403_FORBIDDEN)

        uploaded_file = request.FILES.get('file')
        if not uploaded_file:
            return Response({"error": "No file provided."}, status=status.HTTP_400_BAD_REQUEST)

        if uploaded_file.size > MAX_ATTACHMENT_SIZE:
            return Response({"error": "File is too large (Max 25MB)."}, status=status.HTTP_400_BAD_REQUEST)

        original_name = uploaded_file.name
        ext = os.path.splitext(original_name)[1].lower()
        if ext not in ALLOWED_ATTACHMENT_EXTENSIONS:
            return Response({"error": f"File type '{ext}' is not allowed."}, status=status.HTTP_400_BAD_REQUEST)

        safe_name = f"{uuid.uuid4()}_{os.path.basename(original_name)}"
        relative_path = os.path.join('chat_attachments', str(thread_id), safe_name)
        saved_path = default_storage.save(relative_path, uploaded_file)
        absolute_url = request.build_absolute_uri(settings.MEDIA_URL + saved_path.replace(os.sep, '/'))

        return Response({
            "attachment_url": absolute_url,
            "attachment_name": original_name,
        }, status=status.HTTP_201_CREATED)



# ==========================================
# API 7: COHORT SELECTION (BULK PARENT FETCH)
# ==========================================
class ClassParentsAPI(APIView):
    """
    Given a ClassStream ID, returns all active parents associated
    with the students in that specific class.
    """
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'chat.manage'

    def get(self, request, stream_id):
        user = request.user

        # ---> SECURITY FIX: CONSISTENT ADMIN GUARDS <---
        if not (check_is_admin(user) or user_has_permission(user, 'chat.manage')):
            return Response({"error": "Admin clearance required to bulk-select parents."},
                            status=status.HTTP_403_FORBIDDEN)

        try:
            stream = ClassStream.objects.get(id=stream_id)
        except ClassStream.DoesNotExist:
            return Response({"error": "Class stream not found."}, status=status.HTTP_404_NOT_FOUND)

        # 1. Django ORM Magic: Find all active parents who have at least one child in this specific stream.
        # We use .distinct() so if a parent has twins in the same class, they only get added to the group once!
        parents = ParentExtra.objects.filter(
            status=True,
            students__cl=stream
        ).distinct()

        results_data = []
        for p in parents:
            # Ensure we have a display name
            display_name = f"{p.user.first_name} {p.user.last_name}".strip()
            if not display_name:
                display_name = p.user.username

            # 2. Helpful Context: Grab the names of their children in this class for the UI
            children_in_class = p.students.filter(cl=stream)
            children_names = ", ".join([child.user.first_name for child in children_in_class])

            results_data.append({
                "user_id": p.user.id,
                "name": display_name,
                "role": "Parent",
                "email": p.user.email,
                "context": f"Parent of: {children_names}"  # Helps the admin verify in the UI
            })

        return Response({
            "stream_name": f"{stream.grade.name} {stream.name}",
            "parent_count": len(results_data),
            "results": results_data
        }, status=status.HTTP_200_OK)


# ==========================================
# API 8: LEAVE / DELETE A CONVERSATION
# ==========================================
class LeaveConversationAPI(APIView):
    """
    Removes the caller from a thread. Serves three UI-level actions off the same
    backend behaviour — "Delete Conversation" (Direct), "Leave Group", and
    "Leave Broadcast" — the frontend only differs in copy/confirmation wording by
    thread.type. Never deletes MessageAudit rows (immutable audit trail); once the
    last participant leaves, the thread is soft-archived via is_active=False.
    """
    permission_classes = [IsAuthenticated]
    authentication_classes = [CsrfExemptSessionAuthentication]

    def post(self, request, thread_id):
        user = request.user

        try:
            participation = ThreadParticipant.objects.select_related('thread').get(
                thread_id=thread_id, user=user
            )
        except ThreadParticipant.DoesNotExist:
            return Response({"error": "You are not a participant in this conversation."},
                            status=status.HTTP_403_FORBIDDEN)

        thread = participation.thread
        participation.delete()

        remaining = ThreadParticipant.objects.filter(thread=thread).exists()
        if not remaining:
            thread.is_active = False
            thread.save()

        return Response({"status": "left", "thread_id": str(thread_id)}, status=status.HTTP_200_OK)


# ==========================================
# API 9: LIST PARTICIPANTS
# ==========================================
class ThreadParticipantsAPI(APIView):
    """
    Returns the roster for a Group/Broadcast thread (name + role per participant),
    for the frontend's "View Participants" panel. Participant-gated like the rest
    of the chat surface — you must be in the thread to see who else is in it.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, thread_id):
        user = request.user

        is_participant = ThreadParticipant.objects.filter(thread_id=thread_id, user=user).exists()
        if not is_participant:
            return Response({"error": "You are not a participant in this conversation."},
                            status=status.HTTP_403_FORBIDDEN)

        participants = ThreadParticipant.objects.filter(thread_id=thread_id).select_related('user')

        results = []
        for p in participants:
            display_name = f"{p.user.first_name} {p.user.last_name}".strip() or p.user.username
            results.append({
                "user_id": p.user.id,
                "name": display_name,
                "role": get_user_role_label(p.user),
            })

        return Response({"participants": results}, status=status.HTTP_200_OK)