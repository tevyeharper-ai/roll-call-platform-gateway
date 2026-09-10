BEGIN;

CREATE TABLE IF NOT EXISTS agencies (
  id uuid PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY,
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agency_id, slug)
);
CREATE INDEX IF NOT EXISTS clients_agency_idx ON clients(agency_id);

CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(client_id, slug)
);
CREATE INDEX IF NOT EXISTS workspaces_client_idx ON workspaces(client_id);

CREATE TABLE IF NOT EXISTS applications (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  architecture_profile text NOT NULL DEFAULT 'forge-v1',
  runtime_profile text NOT NULL DEFAULT 'forge-runtime-1',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, slug)
);
CREATE INDEX IF NOT EXISTS applications_workspace_idx ON applications(workspace_id);

CREATE TABLE IF NOT EXISTS environments (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('development','preview','staging','production')),
  url text,
  status text NOT NULL DEFAULT 'ready',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(application_id, slug)
);
CREATE INDEX IF NOT EXISTS environments_app_idx ON environments(application_id);

CREATE TABLE IF NOT EXISTS forge_users (
  id uuid PRIMARY KEY,
  email text UNIQUE NOT NULL,
  display_name text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('agency_admin','employee','contractor','client')),
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES forge_users(id) ON DELETE CASCADE,
  scope_type text NOT NULL CHECK (scope_type IN ('agency','client','workspace','application')),
  scope_id uuid NOT NULL,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, scope_type, scope_id, role)
);
CREATE INDEX IF NOT EXISTS memberships_scope_idx ON memberships(scope_type, scope_id);

CREATE TABLE IF NOT EXISTS contractor_assignments (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES forge_users(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  access_level text NOT NULL DEFAULT 'developer',
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  status text NOT NULL DEFAULT 'active',
  UNIQUE(user_id, application_id)
);

CREATE TABLE IF NOT EXISTS repositories (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'github',
  repository text NOT NULL,
  default_branch text NOT NULL DEFAULT 'main',
  status text NOT NULL DEFAULT 'unverified',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(application_id, repository)
);

CREATE TABLE IF NOT EXISTS design_dossiers (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  version text NOT NULL,
  title text NOT NULL,
  file_ref text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  is_current boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(application_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_current_dossier_per_app ON design_dossiers(application_id) WHERE is_current = true;

CREATE TABLE IF NOT EXISTS build_briefs (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  brief_key text NOT NULL,
  title text NOT NULL,
  objective text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  risk_class text NOT NULL DEFAULT 'R1',
  created_by uuid REFERENCES forge_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(application_id, brief_key)
);

CREATE TABLE IF NOT EXISTS releases (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  version text NOT NULL,
  state text NOT NULL DEFAULT 'candidate',
  manifest_ref text,
  certified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(application_id, version)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  agency_id uuid,
  client_id uuid,
  application_id uuid,
  action text NOT NULL,
  request_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS audit_events_scope_idx ON audit_events(agency_id, client_id, application_id, occurred_at DESC);

COMMIT;
