export interface RouteBinding {
  id: string;
  module: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  tenant_enforced: boolean;
  required_permissions: string[];
  any_of: boolean;
  abac_rules: string[];
  active: boolean;
}

export const ROUTE_BINDINGS: RouteBinding[] = [
  // ── Auth ──────────────────────────────────────────────────────────────────
  { id: 'rb_auth_register',        module: 'auth', method: 'POST',   path: '/api/v1/auth/register',              tenant_enforced: false, required_permissions: [], any_of: true, abac_rules: [], active: true },
  { id: 'rb_auth_login',           module: 'auth', method: 'POST',   path: '/api/v1/auth/login',                 tenant_enforced: false, required_permissions: [], any_of: true, abac_rules: [], active: true },
  { id: 'rb_auth_refresh',         module: 'auth', method: 'POST',   path: '/api/v1/auth/refresh',               tenant_enforced: false, required_permissions: [], any_of: true, abac_rules: [], active: true },
  { id: 'rb_auth_logout',          module: 'auth', method: 'POST',   path: '/api/v1/auth/logout',                tenant_enforced: false, required_permissions: [], any_of: true, abac_rules: [], active: true },
  { id: 'rb_auth_me',              module: 'auth', method: 'GET',    path: '/api/v1/auth/me',                    tenant_enforced: true,  required_permissions: [], any_of: true, abac_rules: ['account.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_auth_invite_create',   module: 'auth', method: 'POST',   path: '/api/v1/auth/invites',               tenant_enforced: true,  required_permissions: [], any_of: true, abac_rules: ['invite.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_auth_invite_register', module: 'auth', method: 'POST',   path: '/api/v1/auth/register/invite',       tenant_enforced: false, required_permissions: [], any_of: true, abac_rules: [], active: true },

  // ── Core — Teams ──────────────────────────────────────────────────────────
  { id: 'rb_core_teams_list',      module: 'core', method: 'GET',    path: '/api/v1/core/teams',                 tenant_enforced: true, required_permissions: ['core.team.read'],    any_of: true, abac_rules: ['team.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_core_team_create',     module: 'core', method: 'POST',   path: '/api/v1/core/teams',                 tenant_enforced: true, required_permissions: ['core.team.manage'],  any_of: true, abac_rules: ['team.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_core_team_members',    module: 'core', method: 'POST',   path: '/api/v1/core/teams/{team_id}/members', tenant_enforced: true, required_permissions: ['core.team.manage'], any_of: true, abac_rules: ['team.tenant_id == ctx.tenant_id'], active: true },

  // ── Core — Projects ───────────────────────────────────────────────────────
  { id: 'rb_core_projects_list',   module: 'core', method: 'GET',    path: '/api/v1/core/projects',              tenant_enforced: true, required_permissions: ['core.project.read'],   any_of: true, abac_rules: ['project.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_core_project_create',  module: 'core', method: 'POST',   path: '/api/v1/core/projects',              tenant_enforced: true, required_permissions: ['core.project.manage'], any_of: true, abac_rules: ['project.tenant_id == ctx.tenant_id'], active: true },

  // ── Core — Epics ──────────────────────────────────────────────────────────
  { id: 'rb_core_epics_list',      module: 'core', method: 'GET',    path: '/api/v1/core/epics',                 tenant_enforced: true, required_permissions: ['core.epic.read'],   any_of: true, abac_rules: ['epic.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_core_epic_create',     module: 'core', method: 'POST',   path: '/api/v1/core/epics',                 tenant_enforced: true, required_permissions: ['core.epic.manage'], any_of: true, abac_rules: ['epic.tenant_id == ctx.tenant_id'], active: true },

  // ── Core — Tasks ──────────────────────────────────────────────────────────
  { id: 'rb_core_tasks_list',      module: 'core', method: 'GET',    path: '/api/v1/core/tasks',                 tenant_enforced: true, required_permissions: ['core.task.read'],  any_of: true, abac_rules: ['task.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_core_task_create',     module: 'core', method: 'POST',   path: '/api/v1/core/tasks',                 tenant_enforced: true, required_permissions: ['core.task.write'], any_of: true, abac_rules: ['task.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_core_task_patch',      module: 'core', method: 'PATCH',  path: '/api/v1/core/tasks/{task_id}',       tenant_enforced: true, required_permissions: ['core.task.write'], any_of: true, abac_rules: ['task.tenant_id == ctx.tenant_id'], active: true },

  // ── Core — Users ──────────────────────────────────────────────────────────
  { id: 'rb_core_users_list',      module: 'core', method: 'GET',    path: '/api/v1/core/users',                 tenant_enforced: true, required_permissions: ['core.user.read'],   any_of: true, abac_rules: ['user.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_core_user_upsert',     module: 'core', method: 'POST',   path: '/api/v1/core/users',                 tenant_enforced: true, required_permissions: ['core.user.manage'], any_of: true, abac_rules: ['user.tenant_id == ctx.tenant_id'], active: true },

  // ── Resource Groups ───────────────────────────────────────────────────────
  { id: 'rb_rg_list',              module: 'resource_group', method: 'GET',    path: '/api/v1/resource-groups',                                tenant_enforced: true, required_permissions: ['resource_group.read'],            any_of: true, abac_rules: ['resource_group.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_rg_create',            module: 'resource_group', method: 'POST',   path: '/api/v1/resource-groups',                                tenant_enforced: true, required_permissions: ['resource_group.manage'],          any_of: true, abac_rules: ['resource_group.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_rg_get',               module: 'resource_group', method: 'GET',    path: '/api/v1/resource-groups/{group_id}',                     tenant_enforced: true, required_permissions: ['resource_group.read'],            any_of: true, abac_rules: ['resource_group.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_rg_patch',             module: 'resource_group', method: 'PATCH',  path: '/api/v1/resource-groups/{group_id}',                     tenant_enforced: true, required_permissions: ['resource_group.manage'],          any_of: true, abac_rules: ['resource_group.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_rg_add_resource',      module: 'resource_group', method: 'POST',   path: '/api/v1/resource-groups/{group_id}/resources',           tenant_enforced: true, required_permissions: ['resource_group.manage'],          any_of: true, abac_rules: ['resource_group.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_rg_remove_resource',   module: 'resource_group', method: 'DELETE', path: '/api/v1/resource-groups/{group_id}/resources/{project_id}', tenant_enforced: true, required_permissions: ['resource_group.manage'],       any_of: true, abac_rules: ['resource_group.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_rg_add_team',          module: 'resource_group', method: 'POST',   path: '/api/v1/resource-groups/{group_id}/teams',               tenant_enforced: true, required_permissions: ['resource_group.manage'],          any_of: true, abac_rules: ['resource_group.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_rg_remove_team',       module: 'resource_group', method: 'DELETE', path: '/api/v1/resource-groups/{group_id}/teams/{team_id}',     tenant_enforced: true, required_permissions: ['resource_group.manage'],          any_of: true, abac_rules: ['resource_group.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_rg_metrics_summary',   module: 'resource_group', method: 'GET',    path: '/api/v1/resource-groups/{group_id}/metrics/summary',     tenant_enforced: true, required_permissions: ['resource_group.metrics.read'],    any_of: true, abac_rules: ['resource_group.tenant_id == ctx.tenant_id'], active: true },

  // ── Insights ──────────────────────────────────────────────────────────────
  { id: 'rb_insights_overview',    module: 'insights', method: 'GET',    path: '/api/v1/insights/resource-groups/{group_id}/overview', tenant_enforced: true, required_permissions: ['insights.read'], any_of: true, abac_rules: ['resource_group.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_insights_incidents',   module: 'insights', method: 'GET',    path: '/api/v1/insights/resource-groups/{group_id}/incidents', tenant_enforced: true, required_permissions: ['insights.read'], any_of: true, abac_rules: ['resource_group.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_insights_planning',    module: 'insights', method: 'GET',    path: '/api/v1/insights/resource-groups/{group_id}/planning-confidence', tenant_enforced: true, required_permissions: ['insights.read'], any_of: true, abac_rules: ['resource_group.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_insights_backlog',     module: 'insights', method: 'GET',    path: '/api/v1/insights/resource-groups/{group_id}/backlog-quality', tenant_enforced: true, required_permissions: ['insights.read'], any_of: true, abac_rules: ['resource_group.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_insights_trends',      module: 'insights', method: 'GET',    path: '/api/v1/insights/resource-groups/{group_id}/trends', tenant_enforced: true, required_permissions: ['insights.read'], any_of: true, abac_rules: ['resource_group.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_insights_recompute',   module: 'insights', method: 'POST',   path: '/api/v1/insights/resource-groups/{group_id}/recompute', tenant_enforced: true, required_permissions: ['insights.recompute'], any_of: true, abac_rules: ['resource_group.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_insights_policy_get',  module: 'insights', method: 'GET',    path: '/api/v1/insights/resource-groups/{group_id}/calculation-policy', tenant_enforced: true, required_permissions: ['insights.policy.read'], any_of: true, abac_rules: ['resource_group.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_insights_policy_put',  module: 'insights', method: 'PUT',    path: '/api/v1/insights/resource-groups/{group_id}/calculation-policy', tenant_enforced: true, required_permissions: ['insights.policy.write'], any_of: true, abac_rules: ['resource_group.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_insights_policy_publish', module: 'insights', method: 'POST', path: '/api/v1/insights/resource-groups/{group_id}/calculation-policy/publish', tenant_enforced: true, required_permissions: ['insights.policy.publish'], any_of: true, abac_rules: ['resource_group.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_insights_policy_history', module: 'insights', method: 'GET', path: '/api/v1/insights/resource-groups/{group_id}/calculation-policy/history', tenant_enforced: true, required_permissions: ['insights.policy.read'], any_of: true, abac_rules: ['resource_group.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_insights_formulas_list', module: 'insights', method: 'GET', path: '/api/v1/insights/squads/{squad_id}/formulas', tenant_enforced: true, required_permissions: ['insights.policy.read'], any_of: true, abac_rules: ['squad.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_insights_formulas_create', module: 'insights', method: 'POST', path: '/api/v1/insights/squads/{squad_id}/formulas', tenant_enforced: true, required_permissions: ['insights.policy.write'], any_of: true, abac_rules: ['squad.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_insights_formulas_publish', module: 'insights', method: 'POST', path: '/api/v1/insights/squads/{squad_id}/formulas/{formula_id}/publish', tenant_enforced: true, required_permissions: ['insights.policy.publish'], any_of: true, abac_rules: ['squad.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_insights_scopes_list', module: 'insights', method: 'GET', path: '/api/v1/insights/squads/{squad_id}/scopes', tenant_enforced: true, required_permissions: ['insights.policy.read'], any_of: true, abac_rules: ['squad.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_insights_scopes_create', module: 'insights', method: 'POST', path: '/api/v1/insights/squads/{squad_id}/scopes', tenant_enforced: true, required_permissions: ['insights.policy.write'], any_of: true, abac_rules: ['squad.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_insights_scopes_publish', module: 'insights', method: 'POST', path: '/api/v1/insights/squads/{squad_id}/scopes/{scope_id}/publish', tenant_enforced: true, required_permissions: ['insights.policy.publish'], any_of: true, abac_rules: ['squad.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_insights_classifiers_list', module: 'insights', method: 'GET', path: '/api/v1/insights/squads/{squad_id}/classifiers', tenant_enforced: true, required_permissions: ['insights.policy.read'], any_of: true, abac_rules: ['squad.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_insights_classifiers_create', module: 'insights', method: 'POST', path: '/api/v1/insights/squads/{squad_id}/classifiers', tenant_enforced: true, required_permissions: ['insights.policy.write'], any_of: true, abac_rules: ['squad.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_insights_classifiers_publish', module: 'insights', method: 'POST', path: '/api/v1/insights/squads/{squad_id}/classifiers/{classifier_id}/publish', tenant_enforced: true, required_permissions: ['insights.policy.publish'], any_of: true, abac_rules: ['squad.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_insights_formulas_simulate', module: 'insights', method: 'POST', path: '/api/v1/insights/squads/{squad_id}/formulas/simulate', tenant_enforced: true, required_permissions: ['insights.policy.write'], any_of: true, abac_rules: ['squad.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_insights_materialized_list', module: 'insights', method: 'GET', path: '/api/v1/insights/squads/{squad_id}/materialized', tenant_enforced: true, required_permissions: ['insights.read'], any_of: true, abac_rules: ['squad.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_insights_materialized_explainability', module: 'insights', method: 'GET', path: '/api/v1/insights/squads/{squad_id}/materialized/{insight_id}/explainability', tenant_enforced: true, required_permissions: ['insights.read'], any_of: true, abac_rules: ['squad.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_insights_squad_recompute', module: 'insights', method: 'POST', path: '/api/v1/insights/squads/{squad_id}/recompute', tenant_enforced: true, required_permissions: ['insights.recompute'], any_of: true, abac_rules: ['squad.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_insights_squad_recompute_status', module: 'insights', method: 'GET', path: '/api/v1/insights/squads/{squad_id}/recompute/{run_id}', tenant_enforced: true, required_permissions: ['insights.read'], any_of: true, abac_rules: ['squad.tenant_id == ctx.tenant_id'], active: true },

  // ── DORA ──────────────────────────────────────────────────────────────────
  { id: 'rb_dora_scorecard',       module: 'dora', method: 'GET',    path: '/api/v1/dora/scorecard',             tenant_enforced: true, required_permissions: ['dora.read'],          any_of: true, abac_rules: ['ctx.tenant_id == resource.tenant_id'], active: true },
  { id: 'rb_dora_rg_scorecard',    module: 'dora', method: 'GET',    path: '/api/v1/dora/resource-groups/{group_id}/scorecard', tenant_enforced: true, required_permissions: ['dora.read'], any_of: true, abac_rules: ['resource_group.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_dora_deploys_list',    module: 'dora', method: 'GET',    path: '/api/v1/dora/deploys',               tenant_enforced: true, required_permissions: ['dora.read'],          any_of: true, abac_rules: ['ctx.tenant_id == resource.tenant_id'], active: true },
  { id: 'rb_dora_deploy_ingest',   module: 'dora', method: 'POST',   path: '/api/v1/dora/deploys',               tenant_enforced: true, required_permissions: ['dora.deploy.ingest'], any_of: true, abac_rules: ['ctx.tenant_id == resource.tenant_id'], active: true },

  // ── SLA ───────────────────────────────────────────────────────────────────
  { id: 'rb_sla_templates_list',   module: 'sla',  method: 'GET',    path: '/api/v1/sla/templates',              tenant_enforced: true, required_permissions: ['sla.template.read'],   any_of: true, abac_rules: ['template.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_sla_template_create',  module: 'sla',  method: 'POST',   path: '/api/v1/sla/templates',              tenant_enforced: true, required_permissions: ['sla.template.manage'], any_of: true, abac_rules: ['template.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_sla_template_patch',   module: 'sla',  method: 'PATCH',  path: '/api/v1/sla/templates/{template_id}', tenant_enforced: true, required_permissions: ['sla.template.manage'], any_of: true, abac_rules: ['template.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_sla_template_delete',  module: 'sla',  method: 'DELETE', path: '/api/v1/sla/templates/{template_id}', tenant_enforced: true, required_permissions: ['sla.template.manage'], any_of: true, abac_rules: ['template.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_sla_evaluate',         module: 'sla',  method: 'POST',   path: '/api/v1/sla/evaluate',               tenant_enforced: true, required_permissions: ['sla.evaluate'],         any_of: true, abac_rules: ['ctx.tenant_id == resource.tenant_id'], active: true },
  { id: 'rb_sla_compliance',       module: 'sla',  method: 'GET',    path: '/api/v1/sla/compliance',             tenant_enforced: true, required_permissions: ['sla.template.read'],   any_of: true, abac_rules: ['ctx.tenant_id == resource.tenant_id'], active: true },
  { id: 'rb_sla_rg_compliance',    module: 'sla',  method: 'GET',    path: '/api/v1/sla/resource-groups/{group_id}/compliance', tenant_enforced: true, required_permissions: ['sla.read'], any_of: true, abac_rules: ['resource_group.tenant_id == ctx.tenant_id'], active: true },

  // ── COGS ──────────────────────────────────────────────────────────────────
  { id: 'rb_cogs_entries_list',    module: 'cogs', method: 'GET',    path: '/api/v1/cogs/entries',               tenant_enforced: true, required_permissions: ['cogs.read'],          any_of: true, abac_rules: ['ctx.tenant_id == resource.tenant_id'], active: true },
  { id: 'rb_cogs_entry_create',    module: 'cogs', method: 'POST',   path: '/api/v1/cogs/entries',               tenant_enforced: true, required_permissions: ['cogs.write'],         any_of: true, abac_rules: ['ctx.tenant_id == resource.tenant_id'], active: true },
  { id: 'rb_cogs_rollup',          module: 'cogs', method: 'GET',    path: '/api/v1/cogs/rollup',                tenant_enforced: true, required_permissions: ['cogs.read'],          any_of: true, abac_rules: ['ctx.tenant_id == resource.tenant_id'], active: true },
  { id: 'rb_cogs_rg_rollup',       module: 'cogs', method: 'GET',    path: '/api/v1/cogs/resource-groups/{group_id}/rollup', tenant_enforced: true, required_permissions: ['cogs.read'], any_of: true, abac_rules: ['resource_group.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_cogs_budgets_list',    module: 'cogs', method: 'GET',    path: '/api/v1/cogs/budgets',               tenant_enforced: true, required_permissions: ['cogs.read'],          any_of: true, abac_rules: ['ctx.tenant_id == resource.tenant_id'], active: true },
  { id: 'rb_cogs_budget_create',   module: 'cogs', method: 'POST',   path: '/api/v1/cogs/budgets',               tenant_enforced: true, required_permissions: ['cogs.budget.manage'], any_of: true, abac_rules: ['ctx.tenant_id == resource.tenant_id'], active: true },

  // ── Intel ─────────────────────────────────────────────────────────────────
  { id: 'rb_intel_forecast',       module: 'intel', method: 'GET',   path: '/api/v1/intel/forecast',             tenant_enforced: true, required_permissions: ['intel.read'], any_of: true, abac_rules: ['ctx.tenant_id == resource.tenant_id'], active: true },
  { id: 'rb_intel_risks',          module: 'intel', method: 'GET',   path: '/api/v1/intel/risks',                tenant_enforced: true, required_permissions: ['intel.read'], any_of: true, abac_rules: ['ctx.tenant_id == resource.tenant_id'], active: true },
  { id: 'rb_intel_anomalies',      module: 'intel', method: 'GET',   path: '/api/v1/intel/anomalies',            tenant_enforced: true, required_permissions: ['intel.read'], any_of: true, abac_rules: ['ctx.tenant_id == resource.tenant_id'], active: true },
  { id: 'rb_intel_recommendations',module: 'intel', method: 'GET',   path: '/api/v1/intel/recommendations',      tenant_enforced: true, required_permissions: ['intel.read'], any_of: true, abac_rules: ['ctx.tenant_id == resource.tenant_id'], active: true },
  { id: 'rb_intel_capacity',       module: 'intel', method: 'GET',   path: '/api/v1/intel/capacity',             tenant_enforced: true, required_permissions: ['intel.read'], any_of: true, abac_rules: ['ctx.tenant_id == resource.tenant_id'], active: true },

  // ── Integrations ──────────────────────────────────────────────────────────
  { id: 'rb_integrations_list',    module: 'integrations', method: 'GET',    path: '/api/v1/integrations/connections',                     tenant_enforced: true, required_permissions: ['integrations.read'],   any_of: true, abac_rules: ['ctx.tenant_id == resource.tenant_id'], active: true },
  { id: 'rb_integrations_create',  module: 'integrations', method: 'POST',   path: '/api/v1/integrations/connections',                     tenant_enforced: true, required_permissions: ['integrations.manage'], any_of: true, abac_rules: ['ctx.tenant_id == resource.tenant_id'], active: true },
  { id: 'rb_integrations_sync',    module: 'integrations', method: 'POST',   path: '/api/v1/integrations/connections/{connection_id}/sync', tenant_enforced: true, required_permissions: ['integrations.sync'],   any_of: true, abac_rules: ['connection.tenant_id == ctx.tenant_id'], active: true },
  { id: 'rb_integrations_rotate',  module: 'integrations', method: 'PUT',    path: '/api/v1/integrations/connections/{connection_id}/secrets', tenant_enforced: true, required_permissions: ['integrations.manage'], any_of: true, abac_rules: ['connection.tenant_id == ctx.tenant_id'], active: true },

  // ── IAM ───────────────────────────────────────────────────────────────────
  { id: 'rb_iam_profiles_list',    module: 'iam', method: 'GET',    path: '/api/v1/iam/permission-profiles',                          tenant_enforced: true, required_permissions: ['iam.permission_profile.read'],   any_of: true, abac_rules: ['ctx.tenant_id == resource.tenant_id'], active: true },
  { id: 'rb_iam_profile_create',   module: 'iam', method: 'POST',   path: '/api/v1/iam/permission-profiles',                          tenant_enforced: true, required_permissions: ['iam.permission_profile.manage'], any_of: true, abac_rules: ['ctx.tenant_id == resource.tenant_id'], active: true },
  { id: 'rb_iam_profile_patch',    module: 'iam', method: 'PATCH',  path: '/api/v1/iam/permission-profiles/{profile_id}',             tenant_enforced: true, required_permissions: ['iam.permission_profile.manage'], any_of: true, abac_rules: ['ctx.tenant_id == resource.tenant_id'], active: true },
  { id: 'rb_iam_profile_delete',   module: 'iam', method: 'DELETE', path: '/api/v1/iam/permission-profiles/{profile_id}',             tenant_enforced: true, required_permissions: ['iam.permission_profile.manage'], any_of: true, abac_rules: ['ctx.tenant_id == resource.tenant_id'], active: true },
  { id: 'rb_iam_profile_users',    module: 'iam', method: 'GET',    path: '/api/v1/iam/permission-profiles/{profile_id}/users',       tenant_enforced: true, required_permissions: ['iam.permission_profile.read'],   any_of: true, abac_rules: ['ctx.tenant_id == resource.tenant_id'], active: true },
  { id: 'rb_iam_user_profiles',    module: 'iam', method: 'GET',    path: '/api/v1/iam/users/{user_id}/permission-profiles',           tenant_enforced: true, required_permissions: ['iam.permission_profile.read'],   any_of: true, abac_rules: ['ctx.tenant_id == resource.tenant_id'], active: true },
  { id: 'rb_iam_profile_assign',   module: 'iam', method: 'POST',   path: '/api/v1/iam/users/{user_id}/permission-profiles',           tenant_enforced: true, required_permissions: ['iam.permission_profile.assign'], any_of: true, abac_rules: ['ctx.tenant_id == resource.tenant_id'], active: true },
  { id: 'rb_iam_profile_revoke',   module: 'iam', method: 'DELETE', path: '/api/v1/iam/users/{user_id}/permission-profiles/{profile_id}', tenant_enforced: true, required_permissions: ['iam.permission_profile.assign'], any_of: true, abac_rules: ['ctx.tenant_id == resource.tenant_id'], active: true }
];
