-- Needed to reply in-thread over SMTP: the RFC822 Message-ID of the inbound
-- email, so an outbound reply can carry the right In-Reply-To/References
-- headers instead of starting a new thread in the customer's inbox.
ALTER TABLE messages ADD COLUMN message_id TEXT;
