"""B2C-03 (M8/M13) extra constraints that `makemigrations` cannot express.

Additive-only. Safe to apply to production. No existing rows modified.

Adds:
* `uq_trate_one_open` — partial unique index guaranteeing at most ONE TokenRate row has
  `effective_to IS NULL` at any time (the live rate).
* `uq_topup_active_cur` — partial unique index guaranteeing at most ONE TopUpPolicy row
  is active per currency.
"""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("commerce", "0005_tokenrate_pricesnapshot_topuppolicy_bonuscampaign_and_more"),
    ]

    operations = [
        migrations.RunSQL(
            sql=(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_trate_one_open "
                "ON commerce.token_rates ((TRUE)) WHERE effective_to IS NULL;"
            ),
            reverse_sql="DROP INDEX IF EXISTS commerce.uq_trate_one_open;",
        ),
        migrations.RunSQL(
            sql=(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_topup_active_cur "
                "ON commerce.topup_policies (currency) WHERE is_active = TRUE;"
            ),
            reverse_sql="DROP INDEX IF EXISTS commerce.uq_topup_active_cur;",
        ),
    ]
