/**
 * Service logos for the account badges, from Simple Icons (CC0), bundled in
 * the app -- nothing is fetched, so the network policy stays "talks to no one".
 *
 * Deliberately a curated list, not all ~3,000 icons: each import adds bytes
 * to a phone app. Brands missing from Simple Icons (Microsoft, LinkedIn,
 * Amazon, Slack, OpenAI -- removed at their owners' request -- and local banks)
 * keep the coloured letter badge.
 */
import {
  si1password,
  siAirbnb,
  siAnthropic,
  siApple,
  siAtlassian,
  siBinance,
  siBitbucket,
  siBitwarden,
  siCloudflare,
  siCoinbase,
  siDatadog,
  siDigitalocean,
  siDiscord,
  siDocker,
  siDropbox,
  siEpicgames,
  siFacebook,
  siFigma,
  siFirebase,
  siGithub,
  siGitlab,
  siGodaddy,
  siGoogle,
  siGrafana,
  siHetzner,
  siHuggingface,
  siIcloud,
  siInstagram,
  siJira,
  siMega,
  siNamecheap,
  siNetflix,
  siNetlify,
  siNotion,
  siNpm,
  siOkta,
  siPaypal,
  siPlaystation,
  siPostman,
  siProton,
  siReddit,
  siRevolut,
  siSentry,
  siShopify,
  siSignal,
  siSnapchat,
  siSpotify,
  siSteam,
  siStripe,
  siSupabase,
  siTailscale,
  siTelegram,
  siTiktok,
  siTwitch,
  siUber,
  siVercel,
  siWhatsapp,
  siWise,
  siWordpress,
  siX,
  siZoho,
  siZoom,
} from "simple-icons";

export interface Logo {
  path: string;
  /** Brand colour, hex without '#'. */
  hex: string;
  title: string;
}

const ICONS: [Logo, string[]][] = [
  [si1password, ["1password"]],
  [siAirbnb, ["airbnb"]],
  [siAnthropic, ["anthropic", "claude"]],
  [siApple, ["apple", "appleid"]],
  [siAtlassian, ["atlassian"]],
  [siBinance, ["binance"]],
  [siBitbucket, ["bitbucket"]],
  [siBitwarden, ["bitwarden"]],
  [siCloudflare, ["cloudflare"]],
  [siCoinbase, ["coinbase"]],
  [siDatadog, ["datadog"]],
  [siDigitalocean, ["digitalocean"]],
  [siDiscord, ["discord"]],
  [siDocker, ["docker", "dockerhub"]],
  [siDropbox, ["dropbox"]],
  [siEpicgames, ["epicgames", "epic"]],
  [siFacebook, ["facebook", "meta"]],
  [siFigma, ["figma"]],
  [siFirebase, ["firebase"]],
  [siGithub, ["github"]],
  [siGitlab, ["gitlab"]],
  [siGodaddy, ["godaddy"]],
  [siGoogle, ["google", "gmail", "googleworkspace", "youtube"]],
  [siGrafana, ["grafana"]],
  [siHetzner, ["hetzner"]],
  [siHuggingface, ["huggingface"]],
  [siIcloud, ["icloud"]],
  [siInstagram, ["instagram"]],
  [siJira, ["jira"]],
  [siMega, ["mega", "meganz"]],
  [siNamecheap, ["namecheap"]],
  [siNetflix, ["netflix"]],
  [siNetlify, ["netlify"]],
  [siNotion, ["notion"]],
  [siNpm, ["npm", "npmjs"]],
  [siOkta, ["okta"]],
  [siPaypal, ["paypal"]],
  [siPlaystation, ["playstation", "psn", "sony"]],
  [siPostman, ["postman"]],
  [siProton, ["proton", "protonmail", "protonme", "protonvpn", "protondrive"]],
  [siReddit, ["reddit"]],
  [siRevolut, ["revolut"]],
  [siSentry, ["sentry"]],
  [siShopify, ["shopify"]],
  [siSignal, ["signal"]],
  [siSnapchat, ["snapchat"]],
  [siSpotify, ["spotify"]],
  [siSteam, ["steam"]],
  [siStripe, ["stripe"]],
  [siSupabase, ["supabase"]],
  [siTailscale, ["tailscale"]],
  [siTelegram, ["telegram"]],
  [siTiktok, ["tiktok"]],
  [siTwitch, ["twitch"]],
  [siUber, ["uber"]],
  [siVercel, ["vercel"]],
  [siWhatsapp, ["whatsapp"]],
  [siWise, ["wise", "transferwise"]],
  [siWordpress, ["wordpress"]],
  [siX, ["x", "twitter", "xcom"]],
  [siZoho, ["zoho"]],
  [siZoom, ["zoom"]],
];

const BY_ALIAS = new Map<string, Logo>();
for (const [icon, aliases] of ICONS) for (const alias of aliases) BY_ALIAS.set(alias, icon);

const keyOf = (raw: string) =>
  raw.toLowerCase().replace(/\.(com|org|net|io|me|co|app|dev)(\.[a-z]{2})?$/, "").replace(/[^a-z0-9]/g, "");

/**
 * "GitHub", "github.com", "Google Workspace" all find their logo. The
 * account's email domain is only a fallback when there is no service name:
 * "Standard Bank" with a Gmail login must not wear Google's logo.
 */
export function logoFor(issuer: string, account = ""): Logo | null {
  if (issuer.trim()) return BY_ALIAS.get(keyOf(issuer)) ?? null;
  const domain = account.split("@")[1];
  return domain ? (BY_ALIAS.get(keyOf(domain)) ?? null) : null;
}

/** White or black, whichever reads on the brand colour. */
export function inkOn(hex: string): string {
  const n = parseInt(hex, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#000000" : "#ffffff";
}
