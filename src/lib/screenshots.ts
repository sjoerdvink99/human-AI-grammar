import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const directory = path.join(process.cwd(), "public", "screenshots");

const extensions = ["webp", "png", "jpg", "jpeg"];

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Screenshots are stored in public/screenshots/<citationKey>/ or as a legacy single file. */
export function screenshotFor(citationKey: string): string[] {
  const folder = path.join(directory, citationKey);
  if (existsSync(folder) && statSync(folder).isDirectory()) {
    const screenshots = readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isFile() && extensions.includes(path.extname(entry.name).slice(1).toLowerCase()))
      .map((entry) => entry.name)
      .sort();

    if (screenshots.length > 0) {
      return screenshots.map((filename) => `${basePath}/screenshots/${citationKey}/${encodeURIComponent(filename)}`);
    }
  }

  const extension = extensions.find((candidate) => existsSync(path.join(directory, `${citationKey}.${candidate}`)));
  return extension ? [`${basePath}/screenshots/${citationKey}.${extension}`] : [];
}
