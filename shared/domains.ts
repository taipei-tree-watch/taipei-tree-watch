/**
 * Link domain whitelist for the `link` field of a report.
 *
 * A URL passes when its hostname equals one of these domains or ends with
 * "." followed by one of them (so `www.threads.net` matches `threads.net`).
 */
export const LINK_DOMAINS = [
  'threads.net',
  'threads.com',
  'instagram.com',
  'facebook.com',
  'fb.com',
  'x.com',
  'twitter.com',
  'imgur.com',
  'flickr.com',
  'youtube.com',
  'youtu.be',
  'plurk.com',
  'dcard.tw',
  'ptt.cc',
] as const;

export type LinkDomain = (typeof LINK_DOMAINS)[number];
