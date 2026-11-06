-- WineCellar 2.0 / Migration 004: three membership roles and secure invitations
-- Run once after migrations 001, 002 and the storage column change (003).
-- No invitations are emailed: prospective users receive access after confirming
-- an account using the invited email address.
begin;

-- Convert the previous 'editor' value to the user-facing 'member' role.
alter type public.cellar_role rename value 'editor' to 'member';
alter type public.cellar_role add value if not exists 'viewer';

create or replace function private.can_edit_inventory(target_cellar uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.cellar_members
    where cellar_id=target_cellar and user_id=(select auth.uid())
      and role in ('owner','member')
  )
$$;
revoke all on function private.can_edit_inventory(uuid) from public,anon;
grant execute on function private.can_edit_inventory(uuid) to authenticated;

-- The old is_member() is still correct for read permissions, including viewers.
-- Editors (now MEMBERS) may edit inventory, whereas VIEWERS are read-only.
drop policy if exists wines_insert on public.wines;
drop policy if exists wines_update on public.wines;
drop policy if exists wines_delete on public.wines;
create policy wines_insert on public.wines for insert to authenticated
  with check (private.can_edit_inventory(cellar_id));
create policy wines_update on public.wines for update to authenticated
  using (private.can_edit_inventory(cellar_id))
  with check (private.can_edit_inventory(cellar_id));
create policy wines_delete on public.wines for delete to authenticated
  using (private.can_edit_inventory(cellar_id));

drop policy if exists lots_insert on public.inventory_lots;
drop policy if exists lots_update on public.inventory_lots;
create policy lots_insert on public.inventory_lots for insert to authenticated
  with check (private.can_edit_inventory(cellar_id));
create policy lots_update on public.inventory_lots for update to authenticated
  using (private.can_edit_inventory(cellar_id))
  with check (private.can_edit_inventory(cellar_id));

drop policy if exists notes_insert on public.tasting_notes;
drop policy if exists notes_update on public.tasting_notes;
drop policy if exists notes_delete on public.tasting_notes;
create policy notes_insert on public.tasting_notes for insert to authenticated
  with check (private.can_edit_inventory(cellar_id) and author_id=(select auth.uid()));
create policy notes_update on public.tasting_notes for update to authenticated
  using (private.can_edit_inventory(cellar_id) and author_id=(select auth.uid()))
  with check (private.can_edit_inventory(cellar_id) and author_id=(select auth.uid()));
create policy notes_delete on public.tasting_notes for delete to authenticated
  using (private.can_edit_inventory(cellar_id) and author_id=(select auth.uid()));

create table public.cellar_invitations (
  id uuid primary key default gen_random_uuid(),
  cellar_id uuid not null references public.cellars(id) on delete cascade,
  email text not null check(length(btrim(email)) > 3),
  role public.cellar_role not null,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  unique(cellar_id,email),
  check(email=lower(btrim(email)))
);
create index cellar_invitations_email_idx on public.cellar_invitations(email);
alter table public.cellar_invitations enable row level security;
revoke all on public.cellar_invitations from anon;
grant select on public.cellar_invitations to authenticated;
create policy invitations_owner_read on public.cellar_invitations
  for select to authenticated using (private.is_owner(cellar_id));

-- Only owners can issue invitations. Confirmed accounts get membership
-- immediately. New accounts receive membership on email verification.
create function public.invite_cellar_user(
  target_cellar uuid, invite_email text, invite_role public.cellar_role
) returns text language plpgsql security definer set search_path = '' as $$
declare normalized_email text; matched_user uuid;
begin
  if (select auth.uid()) is null or not private.is_owner(target_cellar) then
    raise exception 'Only a Cellar Owner can invite people';
  end if;
  normalized_email := lower(btrim(invite_email));
  if normalized_email is null or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'Enter a valid email address';
  end if;
  select id into matched_user from auth.users
  where lower(email)=normalized_email and email_confirmed_at is not null;
  if matched_user is not null then
    if exists(select 1 from public.cellar_members where cellar_id=target_cellar and user_id=matched_user) then
      raise exception 'This person is already a Cellar user; role changes are not yet available';
    end if;
    insert into public.cellar_members(cellar_id,user_id,role)
    values(target_cellar,matched_user,invite_role);
    return 'added';
  end if;
  insert into public.cellar_invitations(cellar_id,email,role,invited_by)
  values(target_cellar,normalized_email,invite_role,(select auth.uid()))
  on conflict(cellar_id,email) do update
  set role=excluded.role, invited_by=excluded.invited_by,
      created_at=now(), expires_at=now()+interval '30 days';
  return 'pending';
end $$;
revoke all on function public.invite_cellar_user(uuid,text,public.cellar_role) from public,anon;
grant execute on function public.invite_cellar_user(uuid,text,public.cellar_role) to authenticated;

-- The trigger runs as a database owner and does not require an authenticated
-- browser session. Auth user email MUST already be confirmed before membership.
create function private.activate_cellar_invitations()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is not null and new.email is not null then
    insert into public.cellar_members(cellar_id,user_id,role)
    select i.cellar_id,new.id,i.role
    from public.cellar_invitations i
    where i.email=lower(new.email) and i.expires_at > now()
    on conflict (cellar_id,user_id) do nothing;
    delete from public.cellar_invitations i
    where i.email=lower(new.email)
      and (i.expires_at > now() or i.expires_at <= now());
  end if;
  return new;
end $$;
create trigger accept_confirmed_cellar_invitations
after insert or update of email_confirmed_at,email on auth.users
for each row execute function private.activate_cellar_invitations();
revoke all on function private.activate_cellar_invitations() from public,anon,authenticated;

-- One owner-only function to show member email addresses and pending invites.
create function public.list_cellar_users(target_cellar uuid)
returns table(email text,role text,status text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not private.is_owner(target_cellar) then
    raise exception 'Only a Cellar Owner can view users';
  end if;
  return query
    select u.email::text,m.role::text,'active'::text
    from public.cellar_members m join auth.users u on u.id=m.user_id
    where m.cellar_id=target_cellar
    union all
    select i.email,i.role::text,'pending'::text
    from public.cellar_invitations i
    where i.cellar_id=target_cellar and i.expires_at > now()
    order by 3,1;
end $$;
revoke all on function public.list_cellar_users(uuid) from public,anon;
grant execute on function public.list_cellar_users(uuid) to authenticated;

commit;
