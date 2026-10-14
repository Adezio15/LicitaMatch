import { safeOfficialUrl, extractOfficialLinks } from './officialLink.js';

export function validOfficialUrl(value) {
  const url = safeOfficialUrl(value);
  return url ? new URL(url).href : null;
}

export function officialUrlFromRecord(item) {
  return extractOfficialLinks(item).link_edital;
}
