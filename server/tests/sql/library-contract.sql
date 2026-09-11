\set ON_ERROR_STOP on
-- Run after bootstrap + migration 077 in an empty, disposable PostgreSQL.
begin;
create function pg_temp.assert_true(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
insert into tenants values ('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002');
insert into mtproto_accounts values
('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','active'),
('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','active');
insert into mtproto_dialogs values
('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','channel','11','channel_owner'),
('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','channel','22','channel_subscriber'),
('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002','channel','33','channel_owner');
insert into automation_libraries(id,tenant_id,name,dest_dialog_id,enabled,rules) values
('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Test','30000000-0000-0000-0000-000000000001',true,'{"delivery_mode":"review"}');
insert into automation_library_sources(id,tenant_id,library_id,source_dialog_id,status,watch) values
('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','watching',true);
insert into automation_library_items(id,tenant_id,library_id,source_id,source_message_id,original,status,processing_started_at)
select ('60000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',n,'{"content_text":"original"}','processing','2026-01-01Z' from generate_series(1,4)n;

select pg_temp.assert_true(automation_library_finish_processing('60000000-0000-0000-0000-000000000001','2026-01-01Z','{"content_text":"review","discard":false,"delaySeconds":30}','{"delivery_mode":"review"}'),'review treatment');
select pg_temp.assert_true((select delivery_status='draft' and scheduled_at is null and original->>'content_text'='original' from automation_library_items where source_message_id=1),'review never autoqueues or changes original');
select pg_temp.assert_true(not automation_library_finish_processing('60000000-0000-0000-0000-000000000001','2026-01-01Z','{}','{"delivery_mode":"review"}'),'processing CAS rejects duplicate');

update automation_libraries set rules='{"delivery_mode":"interval","interval_seconds":60}';
select pg_temp.assert_true(automation_library_finish_processing('60000000-0000-0000-0000-000000000002','2026-01-01Z','{"content_text":"post","discard":false,"delaySeconds":0}','{"delivery_mode":"interval","interval_seconds":60}'),'first interval');
select pg_temp.assert_true(automation_library_finish_processing('60000000-0000-0000-0000-000000000003','2026-01-01Z','{"content_text":"post","discard":false,"delaySeconds":0}','{"delivery_mode":"interval","interval_seconds":60}'),'second interval');
select pg_temp.assert_true((select max(scheduled_at)-min(scheduled_at)=interval '60 seconds' from automation_library_items where source_message_id in(2,3)),'atomic cadence');

update automation_libraries set enabled=false;
select pg_temp.assert_true(not automation_library_finish_processing('60000000-0000-0000-0000-000000000004','2026-01-01Z','{}','{"delivery_mode":"interval","interval_seconds":60}'),'paused processing invalidated');
select pg_temp.assert_true((select status='pending' from automation_library_items where source_message_id=4),'paused original remains eligible');
select pg_temp.assert_true((select count(*)=0 from automation_library_claim_due('40000000-0000-0000-0000-000000000001')),'paused cannot claim');
update automation_libraries set enabled=true;
update automation_library_sources set status='paused';
select pg_temp.assert_true((select count(*)=0 from automation_library_claim_due('40000000-0000-0000-0000-000000000001')),'paused source cannot claim');
update automation_library_sources set status='watching';
-- Loss of source access must not prevent publishing already archived media.
update automation_library_sources set status='failed',source_dialog_id=null;
select pg_temp.assert_true((select count(*)=1 from automation_library_claim_due('40000000-0000-0000-0000-000000000001')),'one due item claimed');
select pg_temp.assert_true((select count(*)=0 from automation_library_claim_due('40000000-0000-0000-0000-000000000001')),'ambiguous sending not reclaimed');
select pg_temp.assert_true(automation_library_defer_flood(id,delivery_claimed_at,30),'flood defers claim') from automation_library_items where delivery_status='sending';
select pg_temp.assert_true((select bool_and(scheduled_at>clock_timestamp()+interval '29 seconds') from automation_library_items where delivery_status='pending'),'flood shifts all pending');

do $$ begin
  begin
    update automation_library_items set original='{}' where source_message_id=1;
    raise exception 'FAIL: mutable original';
  exception when raise_exception then if sqlerrm='FAIL: mutable original' then raise; end if; end;
  begin
    update automation_libraries set dest_dialog_id='30000000-0000-0000-0000-000000000003';
    raise exception 'FAIL: foreign destination';
  exception when raise_exception then if sqlerrm='FAIL: foreign destination' then raise; end if; end;
end $$;
grant usage on schema public,auth to authenticated;
grant select on automation_libraries,automation_library_sources,automation_library_items to authenticated;
grant execute on function auth.uid(),public.is_admin() to authenticated;
set local role authenticated;
set local request.jwt.claim.sub='10000000-0000-0000-0000-000000000002';
select pg_temp.assert_true((select count(*)=0 from automation_libraries),'RLS isolates libraries');
select pg_temp.assert_true((select count(*)=0 from automation_library_items),'RLS isolates media');
select pg_temp.assert_true(not has_function_privilege('authenticated','automation_library_claim_due(uuid)','execute'),'claim service role only');
reset role;
rollback;
\echo 'Library SQL contract passed'
