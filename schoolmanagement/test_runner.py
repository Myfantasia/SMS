"""Custom test runner used only to work around a temporary gap in apps/finance's
migration history — see the comment above TEST_RUNNER in settings.py for the
full explanation. Remove this file and the TEST_RUNNER setting once real
migrations for `finance` are generated and committed by the user."""
from django.apps import apps
from django.db import connection
from django.test.runner import DiscoverRunner


class FinanceAwareTestRunner(DiscoverRunner):
    """Runs the normal migration-based test-database setup unchanged, then
    explicitly creates apps.finance's current tables via the schema editor —
    by which point every table its models' FKs reference (academics,
    identity, ...) already exists, since the real migration plan for those
    apps has already run."""

    def setup_databases(self, **kwargs):
        old_config = super().setup_databases(**kwargs)
        # When every discovered test fails to import, Django decides no test needs a
        # database at all ("Skipping setup of unused database(s)") and super() never
        # points any connection at a test database — old_config comes back empty. If
        # we ran _create_finance_tables() anyway in that case, it would execute
        # against whatever the connection currently points at, which is the REAL
        # database, not a test one. Only proceed when a test database was actually
        # set up.
        if old_config:
            self._create_finance_tables()
        return old_config

    def _create_finance_tables(self):
        finance_config = apps.get_app_config('finance')
        with connection.schema_editor() as schema_editor:
            for model in finance_config.get_models():
                schema_editor.create_model(model)
