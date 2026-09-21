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
from django.template.loader import render_to_string


def build_invoice_html(invoice):
    return render_to_string('finance/invoice_pdf.html', {
        'invoice': invoice,
        'student': invoice.student,
        'line_items': invoice.line_items.select_related('category').order_by('id'),
    })


def build_receipt_html(receipt):
    payment = receipt.payment
    return render_to_string('finance/receipt_pdf.html', {
        'receipt': receipt, 'payment': payment, 'student': payment.student, 'invoice': payment.invoice,
    })


def _html_to_pdf(html_string):
    from weasyprint import HTML
    return HTML(string=html_string).write_pdf()


def render_invoice_pdf(invoice):
    return _html_to_pdf(build_invoice_html(invoice))


def render_receipt_pdf(receipt):
    return _html_to_pdf(build_receipt_html(receipt))
