// tool_3 — poster preprocessing.
import type { ElementRole, ElementSpec } from '../shared/api';
import type { SandCluster } from './sand';

/** spoken_roles_1 -> [tool_3 translate] -> element_roles_1 (keyword matching on the transcript). */
const ROLE_WORDS: [ElementRole, RegExp][] = [
  ['subtitle', /\b(sub ?title|sub ?heading|tag ?line|slogan|date|caption)\b/i],
  ['title', /\b(title|heading|headline|name|big text)\b/i],
  ['body', /\b(body|text|paragraph|description|details|copy|info)\b/i],
  ['image', /\b(image|picture|photo|illustration|drawing|graphic|visual|hero)\b/i],
  ['decoration', /\b(decoration|decorative|ornament|pattern|shape|texture|border|accent)\b/i],
];
export function transcriptToRole(transcript: string): ElementRole | null {
  for (const [role, re] of ROLE_WORDS) if (re.test(transcript)) return role;
  return null;
}

/**
 * poster_theme_1 + sand_clusters_2 + element_roles_1 -> [tool_3 compose] -> element_specs_1
 * Cluster bbox → position and size; grain density → visual weight.
 */
export function composeSpecs(theme: string, clusters: SandCluster[], roles: Record<string, ElementRole>): ElementSpec[] {
  const t = theme.trim() || 'untitled';
  return clusters
    .filter((c) => roles[c.id])
    .map((c) => {
      const role = roles[c.id];
      const weightWord = c.density > 0.66 ? 'bold, heavy' : c.density > 0.33 ? 'balanced' : 'light, delicate';
      const request: Record<ElementRole, string> = {
        title: `the poster's main title for the theme "${t}" (${weightWord})`,
        subtitle: `a short subtitle or tagline that complements the title, theme "${t}"`,
        body: `a short informative paragraph for a poster about "${t}"`,
        image: `the main illustration for a poster about "${t}", ${weightWord} visual presence`,
        decoration: `an abstract decorative motif evoking "${t}", ${weightWord}`,
      };
      return {
        clusterId: c.id, role,
        x: c.bbox.x, y: c.bbox.y, w: c.bbox.w, h: c.bbox.h,
        size: c.size, weight: c.density,
        request: request[role],
      };
    });
}
