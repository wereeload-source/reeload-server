-- Local development seed: one user per role plus a few reelmakers and jobs.
-- Every password is "reelops123". Never run this against production.

do $$
declare
  v_pw text := crypt('reelops123', gen_salt('bf'));
  u record;
begin
  for u in select * from (values
    ('00000000-0000-0000-0000-000000000001'::uuid, 'kavya@reelops.local',  'Kavya Rao',      'admin'::public.app_role,     '9820011024'),
    ('00000000-0000-0000-0000-000000000002'::uuid, 'rohan@reelops.local',  'Rohan Mehta',    'sales'::public.app_role,     '9820155870'),
    ('00000000-0000-0000-0000-000000000003'::uuid, 'neha@reelops.local',   'Neha Iyer',      'ops'::public.app_role,       '9819066342'),
    ('00000000-0000-0000-0000-000000000004'::uuid, 'sanjay@reelops.local', 'Sanjay Pillai',  'accounts'::public.app_role,  '9833017609'),
    ('00000000-0000-0000-0000-000000000011'::uuid, 'arjun@reelops.local',  'Arjun Nair',     'reelmaker'::public.app_role, '9820133417'),
    ('00000000-0000-0000-0000-000000000012'::uuid, 'priya@reelops.local',  'Priya Desai',    'reelmaker'::public.app_role, '9730018852'),
    ('00000000-0000-0000-0000-000000000013'::uuid, 'vikram@reelops.local', 'Vikram Singh',   'reelmaker'::public.app_role, '9900145230')
  ) as t(id, email, name, role, phone)
  loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    values (u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u.email, v_pw, now(), now(), now(),
            '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', u.name))
    on conflict (id) do nothing;
    insert into public.profiles (id, full_name, phone, email, role) values (u.id, u.name, u.phone, u.email, u.role)
    on conflict (id) do nothing;
  end loop;
end $$;

insert into public.reelmakers (profile_id, kind, base_city) values
  ('00000000-0000-0000-0000-000000000011', 'full_time', 'Mumbai'),
  ('00000000-0000-0000-0000-000000000012', 'full_time', 'Pune'),
  ('00000000-0000-0000-0000-000000000013', 'freelance', 'Bengaluru')
on conflict do nothing;

insert into public.clients (id, name, phone, whatsapp, city) values
  ('10000000-0000-0000-0000-000000000001', 'Café Mocha Bandra',   '9820044410', '9820044410', 'Mumbai'),
  ('10000000-0000-0000-0000-000000000002', 'Glow Skin Clinic',    '9820077100', '9820077100', 'Mumbai'),
  ('10000000-0000-0000-0000-000000000003', 'Chai Point Indiranagar', '9845012210', '9845012210', 'Bengaluru')
on conflict do nothing;

insert into public.jobs (id, client_id, status, city, address, maps_url, starts_at, duration_minutes, onsite_contact_name, onsite_contact_phone, brief, consent, created_by) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'draft', 'Mumbai', 'Shop 4, Hill Road, Bandra West',
   'https://maps.google.com/?q=Hill+Road+Bandra+West', date_trunc('day', now()) + interval '4 hours 30 minutes', 180, 'Fatima', '9820044410',
   'Morning menu launch. 3 reels, latte art close-ups.', true, '00000000-0000-0000-0000-000000000002'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'draft', 'Mumbai', 'Linking Road, Khar West',
   null, date_trunc('day', now()) + interval '2 days 6 hours 30 minutes', 120, 'Dr. Mehra', '9820077100',
   'Before-after treatment reels, consent forms signed.', true, '00000000-0000-0000-0000-000000000002'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'lead', 'Bengaluru', null,
   null, null, 120, null, null, 'Asked for 3 reels, call back Monday.', false, '00000000-0000-0000-0000-000000000002')
on conflict do nothing;

insert into public.job_money (job_id, agreed_amount) values
  ('20000000-0000-0000-0000-000000000001', 17500),
  ('20000000-0000-0000-0000-000000000002', 14000)
on conflict do nothing;

insert into public.payments (job_id, amount, method, reference, is_advance, recorded_by) values
  ('20000000-0000-0000-0000-000000000001', 6000, 'upi', 'UPI 4472 9981 0032', true, '00000000-0000-0000-0000-000000000002'),
  ('20000000-0000-0000-0000-000000000002', 5000, 'upi', 'UPI 5531 0042 7781', true, '00000000-0000-0000-0000-000000000002');

-- Confirm both drafts the proper way (as Sales), so the advance rule runs.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
select public.confirm_job('20000000-0000-0000-0000-000000000001');
select public.confirm_job('20000000-0000-0000-0000-000000000002');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
select public.assign_job('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011');

insert into public.contact_log (salesperson_id, client_id, client_name, phone, outcome, note) values
  ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', 'Chai Point Indiranagar', '9845012210', 'follow_up', 'Wants 3 reels, call Monday'),
  ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Glow Skin Clinic', '9820077100', 'approved', 'Advance ₹5,000 by UPI');
select set_config('request.jwt.claim.sub', '', false);
