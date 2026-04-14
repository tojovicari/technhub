-- Add new providers to IntegrationProvider enum
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'opsgenie';
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'incident_io';
