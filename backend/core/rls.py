"""Row-Level Security policy SQL, used from migrations via migrations.RunSQL.

Three request keys are set per transaction by core.tenancy (never per session,
because Neon's pooler reuses connections between clients):

    app.user_id         every authenticated request
    app.org_id          only after the membership check passes
    app.platform_staff  'on' only for staff on /api/v1/console/ routes

Table types (Architecture decision 2):
    company_only   org_id NOT NULL; visible inside that company
    mixed          org_id NULL (personal) or set (company); visible to the company
                   and always to the row's own user
    global         no RLS (public catalog, categories, plans)

Values are read through (SELECT ...) so Postgres evaluates them once per query
(an InitPlan), not once per row. NULLIF guards the '' a custom setting reverts to
after a transaction-local set_config, which would otherwise fail the ::uuid cast.
"""

import re

_IDENT = re.compile(r"[a-z_][a-z0-9_]{0,62}")


def _ident(*names: str) -> None:
    """Policies are built from table names in our own migrations, never user input;
    this makes that a guarantee: anything but a plain identifier is rejected."""
    for name in names:
        if not _IDENT.fullmatch(name):
            raise ValueError(f"Unsafe SQL identifier: {name!r}")


ORG = "(SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)"
USER = "(SELECT NULLIF(current_setting('app.user_id', true), '')::uuid)"
STAFF = "(SELECT COALESCE(current_setting('app.platform_staff', true), '') = 'on')"
# Set only while a catalog authoring service runs (apps.catalog.services.authoring)
AUTHOR = "(SELECT COALESCE(current_setting('app.author', true), '') = 'on')"


def _qualified(schema: str, table: str) -> str:
    _ident(schema, table)
    return f'"{schema}"."{table}"'


def _enable(qualified: str) -> str:
    return (
        f"ALTER TABLE {qualified} ENABLE ROW LEVEL SECURITY;\n"
        f"ALTER TABLE {qualified} FORCE ROW LEVEL SECURITY;\n"
    )


def _disable(qualified: str, policy: str) -> str:
    return (
        f"DROP POLICY IF EXISTS {policy} ON {qualified};\n"
        f"ALTER TABLE {qualified} NO FORCE ROW LEVEL SECURITY;\n"
        f"ALTER TABLE {qualified} DISABLE ROW LEVEL SECURITY;\n"
    )


def company_only(schema: str, table: str, column: str = "org_id") -> tuple[str, str]:
    q = _qualified(schema, table)
    _ident(column)
    rule = f"({column} = {ORG} OR {STAFF})"
    forward = _enable(q) + f"CREATE POLICY tenant_company ON {q} USING {rule} WITH CHECK {rule};"
    return forward, _disable(q, "tenant_company")


def mixed(schema: str, table: str) -> tuple[str, str]:
    """Company rows (org_id set) or personal rows (org_id NULL), always owned by user_id.

    Read: the current company's rows, plus every row of the current user.
    Write: personal rows of the current user; the current company's rows; or the
    user's own row in a company they actively belong to (e.g. progress on an
    assigned course while in their personal workspace). Never another company.
    """
    q = _qualified(schema, table)
    using = f"(org_id = {ORG} OR user_id = {USER} OR {STAFF})"
    check = (
        f"((org_id IS NULL AND user_id = {USER})"  # noqa: S608 - identifiers validated by _ident
        f" OR org_id = {ORG}"
        f' OR (user_id = {USER} AND EXISTS (SELECT 1 FROM "org"."org_members" m'
        f" WHERE m.org_id = {table}.org_id AND m.user_id = {USER} AND m.removed_at IS NULL))"
        f" OR {STAFF})"
    )
    forward = _enable(q) + f"CREATE POLICY tenant_mixed ON {q} USING {using} WITH CHECK {check};"
    return forward, _disable(q, "tenant_mixed")


def membership(schema: str, table: str) -> tuple[str, str]:
    """org_members: a user can always see their own memberships (needed for the
    membership check that runs BEFORE app.org_id is set). Only the company context
    or staff can create or change memberships."""
    q = _qualified(schema, table)
    using = f"(org_id = {ORG} OR user_id = {USER} OR {STAFF})"
    check = f"(org_id = {ORG} OR {STAFF})"
    forward = _enable(q) + f"CREATE POLICY tenant_membership ON {q} USING {using} WITH CHECK {check};"
    return forward, _disable(q, "tenant_membership")


def organizations(schema: str, table: str) -> tuple[str, str]:
    """organizations: visible to its active members, the current company and staff."""
    q = _qualified(schema, table)
    using = (
        f'(id = {ORG} OR {STAFF} OR EXISTS (SELECT 1 FROM "org"."org_members" m'  # noqa: S608
        f" WHERE m.org_id = {table}.id AND m.user_id = {USER} AND m.removed_at IS NULL))"
    )
    check = f"(id = {ORG} OR {STAFF})"
    forward = _enable(q) + f"CREATE POLICY tenant_organization ON {q} USING {using} WITH CHECK {check};"
    return forward, _disable(q, "tenant_organization")


def composite_fk(
    schema: str,
    table: str,
    columns: tuple[str, ...],
    ref_schema: str,
    ref_table: str,
    ref_columns: tuple[str, ...],
    name: str,
    on_delete: str = "RESTRICT",
) -> tuple[str, str]:
    """FOREIGN KEY (org_id, x_id) -> (org_id, id): the database itself refuses a link
    between two different companies' rows. The referenced table needs UNIQUE (org_id, id)."""
    q, rq = _qualified(schema, table), _qualified(ref_schema, ref_table)
    _ident(*columns, *ref_columns, name)
    cols, rcols = ", ".join(columns), ", ".join(ref_columns)
    forward = (
        f"ALTER TABLE {q} ADD CONSTRAINT {name} FOREIGN KEY ({cols}) "
        f"REFERENCES {rq} ({rcols}) ON DELETE {on_delete} DEFERRABLE INITIALLY IMMEDIATE;"
    )
    return forward, f"ALTER TABLE {q} DROP CONSTRAINT IF EXISTS {name};"


def scoped_content(schema: str, table: str, column: str = "owner_org_id") -> tuple[str, str]:
    """Content that is public (owner NULL: marketplace, platform library) or private
    to one company (owner set: e.g. Acme's own induction course). Private rows are
    visible and writable only inside that company, or by platform staff."""
    q = _qualified(schema, table)
    _ident(column)
    rule = f"({column} IS NULL OR {column} = {ORG} OR {STAFF})"
    forward = _enable(q) + f"CREATE POLICY tenant_content ON {q} USING {rule} WITH CHECK {rule};"
    return forward, _disable(q, "tenant_content")


INHERIT_OWNER_FUNCTION = """
CREATE OR REPLACE FUNCTION catalog.inherit_owner_org() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE parent_owner uuid; found_rows int;
BEGIN
  -- TG_ARGV[0] = parent table, TG_ARGV[1] = this row's FK column to the parent
  EXECUTE format('SELECT owner_org_id FROM %s WHERE id = $1', TG_ARGV[0])
    INTO parent_owner USING (to_jsonb(NEW) ->> TG_ARGV[1])::uuid;
  GET DIAGNOSTICS found_rows = ROW_COUNT;
  -- An invisible parent (another company's private course) must not silently become "public"
  IF found_rows = 0 THEN
    RAISE EXCEPTION 'parent row not found or not visible: %', TG_ARGV[0] USING ERRCODE = '42501';
  END IF;
  NEW.owner_org_id := parent_owner;
  RETURN NEW;
END $$;
"""


def inherit_owner(schema: str, table: str, parent_table: str, fk_column: str) -> tuple[str, str]:
    """BEFORE INSERT/UPDATE trigger: a child row (version, section, lecture, quiz...)
    always gets its owner_org_id from its parent, so the denormalised column used by
    RLS can never disagree with the course it belongs to."""
    q = _qualified(schema, table)
    _ident(fk_column, parent_table.split(".")[-1])
    name = f"trg_{table}_owner"
    forward = (
        f"CREATE TRIGGER {name} BEFORE INSERT OR UPDATE OF {fk_column}, owner_org_id ON {q} "
        f"FOR EACH ROW EXECUTE FUNCTION catalog.inherit_owner_org('{parent_table}', '{fk_column}');"
    )
    return forward, f"DROP TRIGGER IF EXISTS {name} ON {q};"


def personal(schema: str, table: str, column: str = "user_id") -> tuple[str, str]:
    """Rows that belong to one user and no company (cart, wishlist): only that user, or staff."""
    q = _qualified(schema, table)
    _ident(column)
    rule = f"({column} = {USER} OR {STAFF})"
    forward = _enable(q) + f"CREATE POLICY tenant_personal ON {q} USING {rule} WITH CHECK {rule};"
    return forward, _disable(q, "tenant_personal")


def enable_user_rls_sql(schema: str, table: str, user_column: str = "user_id") -> tuple[str, str]:
    """User-owned personal rows (B2C entitlements, access audit log): the owning user
    SELECTs their own rows; staff see all; only staff or background jobs may write.

    Separate policies for SELECT and modify-ALL so the learner request can read its
    own entitlement rows but no learner endpoint can forge one.
    """
    q = _qualified(schema, table)
    _ident(user_column)
    forward = _enable(q) + (
        f"CREATE POLICY user_rls_select ON {q} FOR SELECT"
        f" USING ({user_column} = {USER} OR {STAFF});\n"
        f"CREATE POLICY user_rls_modify ON {q} FOR ALL USING ({STAFF}) WITH CHECK ({STAFF});"
    )
    reverse = (
        f"DROP POLICY IF EXISTS user_rls_select ON {q};\n"
        f"DROP POLICY IF EXISTS user_rls_modify ON {q};\n"
        f"ALTER TABLE {q} NO FORCE ROW LEVEL SECURITY;\n"
        f"ALTER TABLE {q} DISABLE ROW LEVEL SECURITY;\n"
    )
    return forward, reverse


def staff_only(schema: str, table: str) -> tuple[str, str]:
    """Internal tables (raw provider webhooks): invisible to every request but staff jobs."""
    q = _qualified(schema, table)
    forward = _enable(q) + f"CREATE POLICY staff_only ON {q} USING ({STAFF}) WITH CHECK ({STAFF});"
    return forward, _disable(q, "staff_only")


INHERIT_PARENT = "learning.inherit_enrollment"  # generic: copies org_id + user_id from any parent row


def inherit_parent(schema: str, table: str, parent_table: str, fk_column: str) -> tuple[str, str]:
    """BEFORE INSERT/UPDATE trigger: org_id and user_id always come from the parent row
    (e.g. an order item from its order), so RLS columns can never disagree with it."""
    q = _qualified(schema, table)
    _ident(fk_column, parent_table.split(".")[-1])
    name = f"trg_{table}_parent"
    forward = (
        f"CREATE TRIGGER {name} BEFORE INSERT OR UPDATE OF {fk_column}, org_id, user_id ON {q} "
        f"FOR EACH ROW EXECUTE FUNCTION {INHERIT_PARENT}('{parent_table}', '{fk_column}');"
    )
    return forward, f"DROP TRIGGER IF EXISTS {name} ON {q};"


def reference(schema: str, table: str) -> tuple[str, str]:
    """Reference data everyone reads (currencies, rates, tiers, plans) but only staff
    and platform jobs write: a bug in a learner endpoint can never change a price."""
    q = _qualified(schema, table)
    forward = _enable(q) + (
        f"CREATE POLICY reference_read ON {q} FOR SELECT USING (true);\n"
        f"CREATE POLICY reference_write ON {q} FOR ALL USING ({STAFF}) WITH CHECK ({STAFF});"
    )
    return forward, f"DROP POLICY IF EXISTS reference_read ON {q};\n" + _disable(q, "reference_write")


def personal_readonly(schema: str, table: str, column: str = "user_id") -> tuple[str, str]:
    """A user's own money records (earnings, payouts): they READ their rows; only staff
    and platform jobs write them."""
    q = _qualified(schema, table)
    _ident(column)
    forward = _enable(q) + (
        f"CREATE POLICY own_read ON {q} FOR SELECT USING ({column} = {USER} OR {STAFF});\n"
        f"CREATE POLICY staff_write ON {q} FOR ALL USING ({STAFF}) WITH CHECK ({STAFF});"
    )
    return forward, f"DROP POLICY IF EXISTS own_read ON {q};\n" + _disable(q, "staff_write")


def scoped_content_authored(schema: str, table: str, column: str = "owner_org_id") -> tuple[str, str]:
    """Course content: anyone may READ public rows (and their company's private rows), but
    rows are WRITTEN only while a catalog authoring service runs (app.author) or by staff.
    The service checks who may edit which course; this makes sure no other code path
    (a learner endpoint, a bug) can ever change course content."""
    q = _qualified(schema, table)
    _ident(column)
    visible = f"({column} IS NULL OR {column} = {ORG} OR {STAFF})"
    write = f"((({column} IS NULL OR {column} = {ORG}) AND {AUTHOR}) OR {STAFF})"
    forward = (
        f"DROP POLICY IF EXISTS tenant_content ON {q};\n"
        f"CREATE POLICY content_read ON {q} FOR SELECT USING {visible};\n"
        f"CREATE POLICY content_insert ON {q} FOR INSERT WITH CHECK {write};\n"
        f"CREATE POLICY content_update ON {q} FOR UPDATE USING {write} WITH CHECK {write};\n"
        f"CREATE POLICY content_delete ON {q} FOR DELETE USING {write};"
    )
    reverse = (
        "".join(f"DROP POLICY IF EXISTS {n} ON {q};\n" for n in ("content_read", "content_insert", "content_update",
                                                                  "content_delete"))
        + f"CREATE POLICY tenant_content ON {q} USING {visible} WITH CHECK {visible};"
    )  # fmt: skip
    return forward, reverse
