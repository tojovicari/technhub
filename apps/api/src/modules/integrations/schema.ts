import { z } from 'zod';

const vaultReferenceCredential = z.object({
  auth_type: z.enum(['oauth2', 'token', 'app', 'bearer', 'api_key']),
  secret_ref: z.string().min(1)
});

const inlineSecretCredential = z.object({
  auth_type: z.enum(['oauth2', 'token', 'app', 'bearer', 'api_key']),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
  access_token: z.string().optional(),
  refresh_token: z.string().optional(),
  private_key_pem: z.string().optional()
}).passthrough();

const credentialSchema = z.union([vaultReferenceCredential, inlineSecretCredential]);

export const createConnectionSchema = z.object({
  tenant_id: z.string().min(1),
  provider: z.enum(['jira', 'github', 'opsgenie', 'incident_io']),
  scope: z.record(z.unknown()).optional(),
  credentials: credentialSchema.optional()
});

export const rotateSecretSchema = z.object({
  tenant_id: z.string().min(1),
  credentials: credentialSchema
});

export const updateConnectionSchema = z.object({
  tenant_id: z.string().min(1),
  status: z.enum(['active', 'disabled']).optional(),
  scope: z.record(z.unknown()).optional()
}).refine(data => data.status !== undefined || data.scope !== undefined, {
  message: 'At least one of status or scope must be provided'
});

export const createSyncJobSchema = z.object({
  tenant_id: z.string().min(1),
  connection_id: z.string().uuid(),
  mode: z.enum(['full', 'incremental']).optional().default('incremental')
});

export const typeMappingSchema = z.object({
  mapping: z.record(
    z.string().min(1),
    z.enum(['feature', 'bug', 'chore', 'spike', 'tech_debt'])
  )
});

export type CreateConnectionInput = z.infer<typeof createConnectionSchema>;
export type UpdateConnectionInput = z.infer<typeof updateConnectionSchema>;
export type RotateSecretInput = z.infer<typeof rotateSecretSchema>;
export type CreateSyncJobInput = z.infer<typeof createSyncJobSchema>;
export type TypeMappingInput = z.infer<typeof typeMappingSchema>;
