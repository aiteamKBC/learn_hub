"""M5 console (additive): the public certificate check also reports the expiry date, so
/verify can say "expired". A NEW function next to the old one (nothing is replaced or
dropped); the app calls the new one."""

from django.db import migrations

VERIFY_V2 = """
-- Public certificate verification: anyone with the code sees ONLY these fields. Runs as
-- the owner so it can read past RLS, and exposes nothing else.
CREATE OR REPLACE FUNCTION learning.verify_certificate_v2(p_code text)
RETURNS TABLE (verification_code text, recipient_name text, course_title text,
               cpd_hours numeric, issued_at timestamptz, is_revoked boolean,
               expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = learning, pg_temp AS $$
  SELECT c.verification_code, c.recipient_name, c.course_title, c.cpd_hours, c.issued_at,
         c.revoked_at IS NOT NULL, c.expires_at
  FROM learning.certificates c
  WHERE c.verification_code = upper(trim(p_code))
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION learning.verify_certificate_v2(text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lms_app') THEN
    GRANT EXECUTE ON FUNCTION learning.verify_certificate_v2(text) TO lms_app;
  END IF;
END $$;
"""


class Migration(migrations.Migration):
    dependencies = [("learning", "0004_console")]

    operations = [
        migrations.RunSQL(VERIFY_V2, "DROP FUNCTION IF EXISTS learning.verify_certificate_v2(text);"),
    ]
