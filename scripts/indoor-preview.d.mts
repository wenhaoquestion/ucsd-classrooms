export function readLocalIndoorManifest(
  root: string,
  options?: { required?: boolean; directory?: "layouts" | "tririga-local" }
): Record<string, { file: string; status: "facilities-plan" }>;

export function isPublicStaticFile(source: string, root: string): boolean;
