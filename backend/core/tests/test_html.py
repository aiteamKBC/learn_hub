"""The two sanitisers: rich text keeps safe HTML; plain text is stored as the text itself."""

from django.test import SimpleTestCase

from core import html


class HtmlTest(SimpleTestCase):
    def test_plain_text_drops_tags_but_is_not_html_escaped(self):
        # shown as text (React, PDF, plain email), so "&" must stay "&" and not become "&amp;"
        self.assertEqual(
            html.plain("Tom & Jerry <b>bold</b> 3 < 5 <script>alert(1)</script>"), "Tom & Jerry bold 3 < 5 "
        )
        self.assertEqual(html.plain("x" * 50, 10), "x" * 10)

    def test_rich_text_keeps_safe_tags_only(self):
        out = html.clean('<p onclick="x()">Hi <strong>there</strong><script>alert(1)</script></p>')
        self.assertEqual(out, "<p>Hi <strong>there</strong></p>")
