"""PDF generation for formal finance documents. No school-name/logo branding
config exists anywhere in this codebase yet, so these templates stay
deliberately minimal (number, student, line items, total) rather than inventing
a fake school name or logo -- add real branding once a real config source for it
exists.

Each document is built in two steps: `build_*_html` (pure Django templating,
runs anywhere) and `render_*_pdf` (WeasyPrint). WeasyPrint is imported lazily,
inside `_html_to_pdf`, because `apps.finance.views` is loaded by the root
urlconf: a top-level import would stop the whole site starting on any machine
without WeasyPrint or its native pango/cairo libraries. Callers must expect
ImportError/OSError from the render step."""
from django.contrib.contenttypes.models import ContentType
from django.template.loader import render_to_string

from apps.finance.models_fees import Payment, StudentFeeLedgerEntry


def build_invoice_html(invoice):
    credit_applied = sum(application.amount for application in invoice.credit_applications.all())
    return render_to_string('finance/invoice_pdf.html', {
        'invoice': invoice,
        'student': invoice.student,
        'line_items': invoice.line_items.select_related('category').order_by('id'),
        'credit_applied': credit_applied,
    })


def build_receipt_html(receipt):
    payment = receipt.payment
    # The credit left immediately AFTER this specific payment was posted --
    # not the student's current balance, which may have moved since. Found via
    # the ledger entry this payment posted (its GenericForeignKey reference).
    # amount__lt=0 disambiguates that original posting from a later void's
    # positive correcting entry, which shares the same content_type/object_id/
    # entry_type (see void_payment's own identical lookup in services_fees.py).
    entry = StudentFeeLedgerEntry.objects.filter(
        content_type=ContentType.objects.get_for_model(Payment), object_id=payment.pk,
        entry_type='payment', amount__lt=0,
    ).order_by('-id').first()
    credit_carried_forward = max(0, -entry.running_balance) if entry is not None else 0
    return render_to_string('finance/receipt_pdf.html', {
        'receipt': receipt, 'payment': payment, 'student': payment.student, 'invoice': payment.invoice,
        'credit_carried_forward': credit_carried_forward,
    })


def _html_to_pdf(html_string):
    from weasyprint import HTML
    return HTML(string=html_string).write_pdf()


def render_invoice_pdf(invoice):
    return _html_to_pdf(build_invoice_html(invoice))


def render_receipt_pdf(receipt):
    return _html_to_pdf(build_receipt_html(receipt))
