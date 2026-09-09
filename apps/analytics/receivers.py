"""Event-bus subscribers for `analytics`.

Imported once from AnalyticsConfig.ready() (see apps.py) -- must live in
this dedicated module (not services.py) so that importing it actually
happens at Django startup; services.py has no guaranteed importer yet.
"""
from shared.events.bus import bus
from shared.events.types import TermResultsCompiledEvent


@bus.subscribe(TermResultsCompiledEvent)
def handle_term_results_compiled(event: TermResultsCompiledEvent) -> None:
    """Hook for invalidating/recomputing cached aggregates after a bulk
    term-result compile, without `results` ever needing to know `analytics`
    exists. No caching layer exists yet (today's analytics views compute on
    every request) -- this is intentionally a no-op until one is added, so
    the event wiring is proven now rather than left undocumented.
    """
    pass
