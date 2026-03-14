# Basquio Supabase Scaffold

This scaffold covers the core Basquio entities:

- organizations and memberships
- projects
- source files and datasets
- template profiles
- generation jobs and step tracking
- output artifacts

The initial migration favors architecture fidelity over production-hardening. RLS, storage buckets, and status enums are present so the app and workflow code have stable table boundaries from the start.

For the first pass, RLS remains enabled but no permissive client policies are created. That keeps the database deploy-safe while Basquio still relies on server-side service-role access. The next agent can replace this with membership-aware tenant policies once auth flows are implemented.
