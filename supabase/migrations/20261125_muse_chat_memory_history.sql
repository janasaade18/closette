-- Muse chat persistence: threads, messages, durable per-user memory
-- Applied to project ntrfbndjtdlghnbbxxtz via MCP; keep this file for team/history.

create table if not exists public.muse_user_memory (
  user_id uuid primary key references auth.users (id) on delete cascade,
  summary text not null default '',
  facts text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.muse_chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'Muse chat',
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists muse_chat_threads_user_updated_idx
  on public.muse_chat_threads (user_id, updated_at desc);

create table if not exists public.muse_chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.muse_chat_threads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'muse', 'assistant')),
  content text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists muse_chat_messages_thread_created_idx
  on public.muse_chat_messages (thread_id, created_at asc);

alter table public.muse_user_memory enable row level security;
alter table public.muse_chat_threads enable row level security;
alter table public.muse_chat_messages enable row level security;

grant select, insert, update, delete on public.muse_user_memory to authenticated;
grant select, insert, update, delete on public.muse_chat_threads to authenticated;
grant select, insert, update, delete on public.muse_chat_messages to authenticated;

drop policy if exists muse_memory_select_own on public.muse_user_memory;
create policy muse_memory_select_own
  on public.muse_user_memory for select
  to authenticated
  using ( (select auth.uid()) = user_id );

drop policy if exists muse_memory_insert_own on public.muse_user_memory;
create policy muse_memory_insert_own
  on public.muse_user_memory for insert
  to authenticated
  with check ( (select auth.uid()) = user_id );

drop policy if exists muse_memory_update_own on public.muse_user_memory;
create policy muse_memory_update_own
  on public.muse_user_memory for update
  to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

drop policy if exists muse_threads_select_own on public.muse_chat_threads;
create policy muse_threads_select_own
  on public.muse_chat_threads for select
  to authenticated
  using ( (select auth.uid()) = user_id );

drop policy if exists muse_threads_insert_own on public.muse_chat_threads;
create policy muse_threads_insert_own
  on public.muse_chat_threads for insert
  to authenticated
  with check ( (select auth.uid()) = user_id );

drop policy if exists muse_threads_update_own on public.muse_chat_threads;
create policy muse_threads_update_own
  on public.muse_chat_threads for update
  to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

drop policy if exists muse_threads_delete_own on public.muse_chat_threads;
create policy muse_threads_delete_own
  on public.muse_chat_threads for delete
  to authenticated
  using ( (select auth.uid()) = user_id );

drop policy if exists muse_messages_select_own on public.muse_chat_messages;
create policy muse_messages_select_own
  on public.muse_chat_messages for select
  to authenticated
  using ( (select auth.uid()) = user_id );

drop policy if exists muse_messages_insert_own on public.muse_chat_messages;
create policy muse_messages_insert_own
  on public.muse_chat_messages for insert
  to authenticated
  with check ( (select auth.uid()) = user_id );

drop policy if exists muse_messages_delete_own on public.muse_chat_messages;
create policy muse_messages_delete_own
  on public.muse_chat_messages for delete
  to authenticated
  using ( (select auth.uid()) = user_id );
