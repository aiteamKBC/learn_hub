"""Rich text from authors (course descriptions, readings, quiz prompts, instructions,
Q&A) is cleaned with nh3 (the Rust 'ammonia' sanitiser) BEFORE it is stored, so a
stored-XSS payload can never reach a learner's browser. The React app renders only
what is stored here."""

import html

import nh3

TAGS = {
    "p", "br", "hr", "strong", "b", "em", "i", "u", "s", "sub", "sup", "mark", "h2", "h3", "h4", "ul", "ol", "li",
    "blockquote", "code", "pre", "a", "img", "table", "thead", "tbody", "tr", "th", "td", "figure", "figcaption",
}  # fmt: skip
ATTRIBUTES = {
    "a": {"href", "title"},
    "img": {"src", "alt", "title", "width", "height"},
    "th": {"colspan", "rowspan"},
    "td": {"colspan", "rowspan"},
    "code": {"class"},  # language-xxx for highlighting
}
SCHEMES = {"https", "mailto"}


def clean(html: str | None, limit: int = 100_000) -> str:
    if not html:
        return ""
    if len(html) > limit:
        from core.errors import ServiceError

        raise ServiceError("too_long", f"The text is too long (max {limit:,} characters).")
    return nh3.clean(
        html, tags=TAGS, attributes=ATTRIBUTES, url_schemes=SCHEMES, link_rel="noopener noreferrer nofollow"
    )


def plain(text: str | None, limit: int = 10_000) -> str:
    """Plain text fields: every tag removed, stored as the text itself ("Tom & Jerry",
    not "Tom &amp; Jerry"). Plain fields are shown as text (React, PDFs, plain emails),
    which escape it there; never put one into HTML unescaped."""
    return html.unescape(nh3.clean(text or "", tags=set()))[:limit]
