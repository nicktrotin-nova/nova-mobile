-- barber_invites — tracks pending/accepted/declined invites from shop owners to barbers
CREATE TABLE IF NOT EXISTS barber_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  invited_by  uuid NOT NULL REFERENCES auth.users(id),
  name        text NOT NULL,
  email       text,
  phone       text,
  status      text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Index for common query: pending invites for a shop
CREATE INDEX idx_barber_invites_shop_status
  ON barber_invites (shop_id, status);

-- Index for duplicate check by email
CREATE INDEX idx_barber_invites_email_status
  ON barber_invites (email, status)
  WHERE email IS NOT NULL;

-- RLS: shop owners can read invites for their shop
ALTER TABLE barber_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Shop owners can view their invites"
  ON barber_invites FOR SELECT
  USING (
    shop_id IN (
      SELECT shop_id FROM user_roles
      WHERE user_id = auth.uid() AND role = 'shop_owner'
    )
  );

-- Service role (edge functions) handles inserts/updates
CREATE POLICY "Service role full access"
  ON barber_invites FOR ALL
  USING (auth.role() = 'service_role');
