import { z } from 'zod';

const vaultReferenceCredential = z.object({
  auth_type: z.enum(['oauth2', 'token', 'app']),
  secret_ref: z.string().min(1)
});

const inlineSecretCredential = z.object({
  auth_type: z.enum(['oauth2', 'token', 'app']),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
  access_token: z.string().optional(),
  refresh_token: z.string().optional(),
  private_key_pem: z.string().optional()
});

const credentialSchema = z.union([vaultReferenceCredential, inlineSecretCredential]);

export const createConnectionSchema = z.object({
  tenant_id: z.string().min(1),
  provider: z.enum(['jira', 'github']),
  scope: z.record(z.unknown()).optional(),
  credentials: credentialSchema.optional()
});

export const rotateSecretSchema = z.object({
  tenant_id: z.string().min(1),
  credentials: credentialSchema
});

export const createSyncJobSchema = z.object({
  tenant_id: z.string().min(1),
  connection_id: z.string().uuid(),
  mode: z.enum(['full', 'incremental']).optional().default('incremental')
});

export type CreateConnectionInput = z.infer<typeof createConnectionSchema>;
export type RotateSecretInput = z.infer<typeof rotateSecretSchema>;
export type CreateSyncJobInput = z.infer<typeof createSyncJobSchema>;
