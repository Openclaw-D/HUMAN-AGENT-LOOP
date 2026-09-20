-- TAKEOFF-FA-1.0.0 v2.6 · 五域词表扩展（OBS-03-01；03路 DEFECTS_REPORT 2026-09-20）
-- 原因：TAKEOFF 五列 = 商机/政策/信审/商务/资产 ↔ business/policy/credit/commerce/asset；
--       既有 A 域 CHECK 只收四域，business（商机）域的分析运行/域结果/豁免被 400/约束拒绝。
-- 原则：只放宽 CHECK 枚举（加法），不改任何既有行；回退 = 保留对象停用入口。
-- 词表演进由 Back/CONTRACT.md §13.4 登记；03 路侧接通仅为其 aRegisterDomains 配置加 'business'。

DO $$
DECLARE
  tbl text;
  con text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['package_domain_results', 'analysis_runs', 'domain_requirement_policies', 'domain_exemptions'] LOOP
    SELECT c.conname INTO con
      FROM pg_constraint c
     WHERE c.conrelid = tbl::regclass AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) LIKE '%domain%'
     ORDER BY c.oid LIMIT 1;
    IF con IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', tbl, con);
    END IF;
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (domain IN (''business'',''policy'',''credit'',''commerce'',''asset''))',
      tbl, tbl || '_domain_check');
  END LOOP;
END $$;
