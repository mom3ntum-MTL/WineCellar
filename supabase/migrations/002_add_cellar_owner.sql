-- WineCellar 2.0 — migration 002
-- Run this in Supabase SQL Editor before using "Grant Owner access" in the app.
-- The first migration already allows multiple owners in cellar_members.
-- This function only lets an existing owner add or promote another CONFIRMED user.
begin;
create or replace function public.add_cellar_owner(target_cellar uuid,member_email text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare target_user uuid;
begin
  if (select auth.uid()) is null or not private.is_owner(target_cellar) then
    raise exception 'Only a current cellar owner can add an owner';
  end if;
  if member_email is null or length(btrim(member_email)) = 0 then
    raise exception 'Email is required';
  end if;
  select id into target_user from auth.users
    where lower(email)=lower(btrim(member_email)) and email_confirmed_at is not null;
  if target_user is null then
    raise exception 'No confirmed WineCellar account found for that email';
  end if;
  insert into public.cellar_members(cellar_id,user_id,role)
  values(target_cellar,target_user,'owner')
  on conflict(cellar_id,user_id) do update set role='owner';
end;
$$;
revoke all on function public.add_cellar_owner(uuid,text) from public,anon;
grant execute on function public.add_cellar_owner(uuid,text) to authenticated;
commit;
