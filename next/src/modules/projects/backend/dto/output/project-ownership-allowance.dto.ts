/**
 * Whether the signed-in user may create another project they will own.
 *
 * Server-computed so the UI never counts projects or compares quotas itself.
 * `canCreateOwnedProject` already accounts for the platform-admin bypass;
 * `owned` and `limit` are for copy such as "5 of 5 projects".
 */
export interface ProjectOwnershipAllowanceDto {
  readonly canCreateOwnedProject: boolean;
  readonly owned: number;
  readonly limit: number;
}
