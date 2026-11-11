-- Email open + click tracking for outbound Team Inbox emails

CREATE TABLE IF NOT EXISTS email_tracking (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inbox_id UUID REFERENCES inboxes(id) ON DELETE CASCADE,
  gmail_message_id TEXT UNIQUE,
  recipients TEXT[] DEFAULT '{}',
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  open_count INTEGER NOT NULL DEFAULT 0,
  click_count INTEGER NOT NULL DEFAULT 0,
  first_opened_at TIMESTAMP WITH TIME ZONE,
  last_opened_at TIMESTAMP WITH TIME ZONE,
  last_clicked_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_tracking_links (
  tracking_id UUID REFERENCES email_tracking(id) ON DELETE CASCADE NOT NULL,
  idx INTEGER NOT NULL,
  url TEXT NOT NULL,
  click_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tracking_id, idx)
);

CREATE TABLE IF NOT EXISTS email_tracking_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tracking_id UUID REFERENCES email_tracking(id) ON DELETE CASCADE NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('open', 'click')),
  link_idx INTEGER,
  user_agent TEXT,
  ip TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_tracking_events_tracking_id ON email_tracking_events(tracking_id, created_at);

-- Server-only tables (accessed with the service role)
ALTER TABLE email_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_tracking_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_tracking_events ENABLE ROW LEVEL SECURITY;

-- Records one open or click and bumps the counters atomically.
-- Opens from the same email within 30 seconds count once (image proxies re-fetch).
CREATE OR REPLACE FUNCTION record_tracking_event(
  p_tracking_id UUID,
  p_type TEXT,
  p_link_idx INTEGER,
  p_user_agent TEXT,
  p_ip TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_type = 'open' AND EXISTS (
    SELECT 1 FROM email_tracking_events
    WHERE tracking_id = p_tracking_id AND event_type = 'open'
      AND created_at > NOW() - INTERVAL '30 seconds'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO email_tracking_events (tracking_id, event_type, link_idx, user_agent, ip)
  VALUES (p_tracking_id, p_type, p_link_idx, p_user_agent, p_ip);

  IF p_type = 'open' THEN
    UPDATE email_tracking
    SET open_count = open_count + 1,
        first_opened_at = COALESCE(first_opened_at, NOW()),
        last_opened_at = NOW()
    WHERE id = p_tracking_id;
  ELSE
    UPDATE email_tracking
    SET click_count = click_count + 1,
        last_clicked_at = NOW()
    WHERE id = p_tracking_id;
    UPDATE email_tracking_links
    SET click_count = click_count + 1
    WHERE tracking_id = p_tracking_id AND idx = p_link_idx;
  END IF;
END;
$$;
