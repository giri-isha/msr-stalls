import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** The host's `cn` — same file, same path, so module code that imports
 *  `../../lib/cn` resolves to the host's copy after migration. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
