create table if not exists events (
  id             serial primary key,
  title          text not null,
  start_date     text,            -- YYYY-MM-DD (null while waiting for a date)
  end_date       text,            -- YYYY-MM-DD, for multi-day events
  start_time     text,            -- HH:MM, 24h
  end_time       text,
  venue          text,
  area           text,
  price          text,
  description    text,
  file_id        text not null,   -- Telegram file_id of the full poster
  thumb_file_id  text,            -- smaller Telegram size for cards
  file_unique_id text,
  chat_id        bigint,
  bot_msg_id     bigint,          -- the bot's confirmation message, for replies
  status         text not null default 'active',  -- active | pending
  dedupe_key     text,
  created_at     timestamptz not null default now()
);
create unique index if not exists events_dedupe_key on events (dedupe_key);
create index if not exists events_start_date on events (start_date);
create index if not exists events_file_unique_id on events (file_unique_id);
create index if not exists events_bot_msg on events (chat_id, bot_msg_id);
