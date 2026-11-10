"""Certificate PDF (A4 landscape) with a QR code to the public verification page.

Generated on request (about 20 ms) instead of stored: the data is immutable and a
template change then applies everywhere. The TEMPLATE drives the drawing: its layout
(style, colours, wording, what to show), signatory and signature image, and whether the
QR code is printed (catalog.certificates.LAYOUT_DEFAULTS lists the layout keys). Text is
drawn as plain strings, so a course title or name can never inject markup.
"""

import io
import logging

from django.conf import settings
from django.core.cache import cache
from reportlab.graphics import renderPDF
from reportlab.graphics.barcode import qr
from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

log = logging.getLogger(__name__)
INK = colors.HexColor("#111827")
MUTED = colors.HexColor("#6B7280")


def _fit(c: canvas.Canvas, text: str, font: str, size: float, max_width: float) -> float:
    while size > 10 and c.stringWidth(text, font, size) > max_width:
        size -= 1
    return size


def _signature_image(url: str) -> ImageReader | None:
    """The signature image from our own storage (never any other host), cached an hour.
    A storage problem prints the signatory's name instead of failing the certificate."""
    from core import storage

    if not url or not storage.configured():
        return None
    prefix = f"{storage.account_url()}/{settings.AZURE_STORAGE['CONTAINER']}/"
    if not url.startswith(prefix):
        return None
    key = f"cert-sig:{url}"
    data = cache.get(key)
    if data is None:
        from urllib.parse import unquote

        try:
            import httpx

            r = httpx.get(storage.download_url(unquote(url[len(prefix) :])), timeout=3)
            r.raise_for_status()
            data = r.content if len(r.content) <= 1_000_000 else b""
        except Exception:  # noqa: BLE001 - a missing image must never break the certificate
            log.warning("certificate signature image could not be loaded")
            data = b""
        cache.set(key, data, 3600)
    return ImageReader(io.BytesIO(data)) if data else None


def _border(c: canvas.Canvas, style: str, width: float, height: float, primary, accent) -> None:
    if style == "minimal":
        c.setStrokeColor(primary)
        c.setLineWidth(1)
        c.line(30 * mm, height - 22 * mm, width - 30 * mm, height - 22 * mm)
        c.line(30 * mm, 22 * mm, width - 30 * mm, 22 * mm)
        return
    if style == "modern":  # bold corner bands
        c.setFillColor(primary)
        p = c.beginPath()
        p.moveTo(0, height)
        p.lineTo(70 * mm, height)
        p.lineTo(0, height - 45 * mm)
        p.close()
        c.drawPath(p, fill=1, stroke=0)
        p = c.beginPath()
        p.moveTo(width, 0)
        p.lineTo(width - 70 * mm, 0)
        p.lineTo(width, 45 * mm)
        p.close()
        c.drawPath(p, fill=1, stroke=0)
        c.setStrokeColor(accent)
        c.setLineWidth(1.2)
        c.rect(12 * mm, 12 * mm, width - 24 * mm, height - 24 * mm)
        return
    c.setStrokeColor(primary)  # classic: double frame
    c.setLineWidth(3)
    c.rect(12 * mm, 12 * mm, width - 24 * mm, height - 24 * mm)
    c.setStrokeColor(accent)
    c.setLineWidth(0.6)
    c.rect(16 * mm, 16 * mm, width - 32 * mm, height - 32 * mm)


def _seal(c: canvas.Canvas, x: float, y: float, accent, primary) -> None:
    c.setFillColor(accent)
    c.circle(x, y, 13 * mm, stroke=0, fill=1)
    c.setStrokeColor(colors.white)
    c.setLineWidth(1)
    c.circle(x, y, 10.5 * mm, stroke=1, fill=0)
    c.setFillColor(primary)
    c.circle(x, y, 7 * mm, stroke=0, fill=1)


def render(cert, template=None) -> bytes:
    """`cert` needs verification_code, recipient_name, course_title, issued_at, cpd_hours,
    instructor_names (a real Certificate, or sample values for the console preview)."""
    from apps.catalog.certificates import clean_layout
    from apps.platform.services import get_setting

    layout = clean_layout(getattr(template, "layout", None) or {})
    primary, accent = colors.HexColor(layout["primary"]), colors.HexColor(layout["accent"])
    platform = str(get_setting("general.platform_name") or "LearnHub")

    buf = io.BytesIO()
    width, height = landscape(A4)
    c = canvas.Canvas(buf, pagesize=(width, height))
    c.setTitle(f"Certificate {cert.verification_code}")
    c.setAuthor(platform)
    _border(c, layout["style"], width, height, primary, accent)

    cx = width / 2
    if layout["show_platform"]:
        c.setFillColor(primary)
        c.setFont("Helvetica-Bold", 14)
        c.drawCentredString(cx, height - 40 * mm, platform.upper()[:60])
    if layout["show_seal"]:
        _seal(c, width - 45 * mm, height - 45 * mm, accent, primary)
    heading = layout["heading"]
    c.setFillColor(INK if layout["style"] != "modern" else primary)
    c.setFont("Helvetica-Bold", _fit(c, heading, "Helvetica-Bold", 34, width - 110 * mm))
    c.drawCentredString(cx, height - 62 * mm, heading)
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 14)
    c.drawCentredString(cx, height - 78 * mm, layout["intro"])

    name = cert.recipient_name or "Learner"
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", _fit(c, name, "Helvetica-Bold", 30, width - 80 * mm))
    c.drawCentredString(cx, height - 96 * mm, name)

    c.setFillColor(MUTED)
    c.setFont("Helvetica", 14)
    c.drawCentredString(cx, height - 110 * mm, layout["completion"])
    title = cert.course_title
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", _fit(c, title, "Helvetica-Bold", 22, width - 80 * mm))
    c.drawCentredString(cx, height - 124 * mm, title)

    details = [f"Issued {cert.issued_at:%d %B %Y} (UTC)"]
    if layout["show_cpd"] and cert.cpd_hours:
        details.append(f"{cert.cpd_hours} CPD hours")
    if layout["show_instructor"] and cert.instructor_names:
        details.append(f"Instructor: {cert.instructor_names[:120]}")
    if getattr(cert, "expires_at", None):
        details.append(f"Valid until {cert.expires_at:%d %B %Y}")
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 11)
    c.drawCentredString(cx, height - 138 * mm, "   ·   ".join(details))

    if template is not None and template.signatory_name:
        image = _signature_image(template.signature_image_url)
        if image is not None:
            c.drawImage(
                image, 40 * mm, 44 * mm, width=60 * mm, height=18 * mm, preserveAspectRatio=True, mask="auto"
            )
        else:  # the name in a script-like face stands in for the signature
            c.setFillColor(primary)
            c.setFont("Times-Italic", 20)
            c.drawString(42 * mm, 46 * mm, template.signatory_name[:40])
        c.setStrokeColor(MUTED)
        c.line(40 * mm, 42 * mm, 110 * mm, 42 * mm)
        c.setFillColor(INK)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(40 * mm, 36 * mm, template.signatory_name[:60])
        c.setFillColor(MUTED)
        c.setFont("Helvetica", 10)
        c.drawString(40 * mm, 31 * mm, template.signatory_title[:60])

    if template is None or template.show_qr_code:
        url = f"{settings.FRONTEND_URL}/verify/{cert.verification_code}"
        widget = qr.QrCodeWidget(url)
        x0, y0, x1, y1 = widget.getBounds()
        box = 30 * mm
        d = Drawing(box, box, transform=[box / (x1 - x0), 0, 0, box / (y1 - y0), 0, 0])
        d.add(widget)
        renderPDF.draw(d, c, width - 58 * mm, 26 * mm)
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 8)
    c.drawRightString(width - 22 * mm, 22 * mm, f"Verify: {cert.verification_code}")

    c.showPage()
    c.save()
    return buf.getvalue()
