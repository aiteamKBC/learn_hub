"""Seed the platform competency library and one starter maturity framework.

Platform rows have owner_org=NULL, so every company sees them and can clone them
into an editable local copy. An org may archive what it does not use. Idempotent:
keyed on (owner_org IS NULL, code), safe to re-run.

The 8 competencies are a generic trade/operations starter set; companies are
expected to rename, renumber or replace them. No company-specific content here.
"""

from django.db import migrations

# (code, name, kind): kind ∈ K/S/B/P
COMPETENCIES = [
    ("C1", "Surface preparation & quality inspection", "S"),
    ("C2", "Safeguarding in occupied settings", "K"),
    ("C3", "Team briefing & quality follow-up", "S"),
    ("C4", "Coaching & one-to-ones", "B"),
    ("C5", "Customer communication & inclusion", "B"),
    ("C6", "Programme planning & lookaheads", "K"),
    ("C7", "Risk assessment & safe systems of work", "S"),
    ("C8", "Professional standards & integrity", "P"),
]

# One starter maturity framework: code, title, dept, dimensions.
# Each dimension: (name, target_level, weight, [criteria]).
# Each criterion: (practice, question, weight).
STARTER_MATURITY = {
    "code": "MF-ops",
    "title": "Operations maturity (starter)",
    "dept": "Operations",
    "dimensions": [
        (
            "Quality & evidence",
            4,
            34,
            [
                ("Preparation records", "Is preparation evidenced before work is covered up?", 50),
                ("Defect close-out", "Are defects recorded and verified before sign-off?", 50),
            ],
        ),
        (
            "Planning & delivery",
            4,
            33,
            [
                ("Lookaheads", "Is a multi-week lookahead maintained and used?", 50),
                ("Variation control", "Are variations recorded promptly with evidence?", 50),
            ],
        ),
        (
            "People & customers",
            4,
            33,
            [
                ("Customer communication", "Are customers told about works in advance?", 50),
                ("Coaching", "Do supervisors hold regular one-to-ones?", 50),
            ],
        ),
    ],
}


def seed(apps, schema_editor):
    db = schema_editor.connection.alias  # the owner connection running the migration
    Competency = apps.get_model("frameworks", "Competency")
    for order, (code, name, kind) in enumerate(COMPETENCIES):
        Competency.objects.using(db).get_or_create(
            owner_org=None,
            code=code,
            defaults={"name": name, "kind": kind, "sort_order": order},
        )

    MaturityFramework = apps.get_model("frameworks", "MaturityFramework")
    MaturityVersion = apps.get_model("frameworks", "MaturityVersion")
    MaturityDimension = apps.get_model("frameworks", "MaturityDimension")
    MaturityCriterion = apps.get_model("frameworks", "MaturityCriterion")

    fw, created = MaturityFramework.objects.using(db).get_or_create(
        owner_org=None,
        code=STARTER_MATURITY["code"],
        defaults={
            "kind": "maturity",
            "dept": STARTER_MATURITY["dept"],
            "title": STARTER_MATURITY["title"],
        },
    )
    if not created:
        return  # already seeded with its version tree

    version = MaturityVersion.objects.using(db).create(
        owner_org=None, framework=fw, number=1, status="published"
    )
    for d_order, (dname, target, dweight, criteria) in enumerate(STARTER_MATURITY["dimensions"]):
        dim = MaturityDimension.objects.using(db).create(
            owner_org=None,
            version=version,
            name=dname,
            target_level=target,
            weight=dweight,
            sort_order=d_order,
        )
        for c_order, (practice, question, cweight) in enumerate(criteria):
            MaturityCriterion.objects.using(db).create(
                owner_org=None,
                dimension=dim,
                practice=practice,
                question=question,
                weight=cweight,
                sort_order=c_order,
            )


def unseed(apps, schema_editor):
    db = schema_editor.connection.alias
    Competency = apps.get_model("frameworks", "Competency")
    Competency.objects.using(db).filter(
        owner_org__isnull=True, code__in=[c[0] for c in COMPETENCIES]
    ).delete()
    MaturityFramework = apps.get_model("frameworks", "MaturityFramework")
    # Cascades to versions, dimensions, criteria.
    MaturityFramework.objects.using(db).filter(
        owner_org__isnull=True, code=STARTER_MATURITY["code"]
    ).delete()


class Migration(migrations.Migration):
    dependencies = [("frameworks", "0002_security")]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
