-- Optional short video on the wisher's bio.
-- Files live in Supabase Storage bucket "bio-videos" at <user_id>/<random>.<ext>.
-- Caps: 25 MB per file (enforced by the bucket), 60 seconds (checked in the browser before upload).
-- Moderation: admins can hide a video; hidden videos never reach the public view.
-- Deliberately does NOT touch public_wishes, so it can't collide with ranking/funding changes.

alter table public.profiles
  add column if not exists bio_video_path text
    check (bio_video_path is null or bio_video_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]+\.(mp4|webm|mov)$'),
  add column if not exists bio_video_hidden boolean not null default false,
  add column if not exists bio_video_updated_at timestamptz;

-- Owners can set/clear their own path. bio_video_hidden stays admin-only (service role).
grant update (bio_video_path, bio_video_updated_at) on public.profiles to authenticated;

-- Once an admin hides a user's video, later uploads stay hidden until an admin clears the flag.
-- Path must sit in the owner's own folder.
create or replace function public.check_bio_video_owner()
returns trigger language plpgsql as $$
begin
  if new.bio_video_path is not null and split_part(new.bio_video_path, '/', 1) <> new.user_id::text then
    raise exception 'BIO_VIDEO_NOT_OWNER';
  end if;
  return new;
end $$;

drop trigger if exists profiles_bio_video_owner on public.profiles;
create trigger profiles_bio_video_owner
  before insert or update of bio_video_path on public.profiles
  for each row execute function public.check_bio_video_owner();

-- Public lookup: wish id -> video path, only for public, non-anonymous wishes with a visible video.
create or replace view public.wish_bio_videos as
  select w.id as wish_id, p.bio_video_path
  from wishes w join profiles p on p.user_id = w.user_id
  where w.status in ('open', 'funded')
    and not w.is_anonymous
    and p.bio_video_path is not null
    and not p.bio_video_hidden;

grant select on public.wish_bio_videos to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage bucket (public read, so playback needs no signed URLs)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bio-videos', 'bio-videos', true, 26214400, array['video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Signed-in users write only inside their own folder.
drop policy if exists "bio video insert own" on storage.objects;
create policy "bio video insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'bio-videos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "bio video update own" on storage.objects;
create policy "bio video update own" on storage.objects for update to authenticated
  using (bucket_id = 'bio-videos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "bio video delete own" on storage.objects;
create policy "bio video delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'bio-videos' and (storage.foldername(name))[1] = auth.uid()::text);
