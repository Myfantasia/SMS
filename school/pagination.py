from rest_framework.pagination import PageNumberPagination


class StandardResultsPagination(PageNumberPagination):
    """Applied only to endpoints that are genuinely unbounded and keep growing with
    usage (Notice/Notification boards, audit logs) — deliberately NOT set as the
    project-wide DEFAULT_PAGINATION_CLASS, since every other list endpoint in this app
    returns a flat array and every frontend consumer expects that shape."""
    page_size = 25
    page_size_query_param = 'page_size'
    max_page_size = 100
