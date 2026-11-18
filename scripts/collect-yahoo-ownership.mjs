// Read-only Yahoo league player list collector. Run with Node.js 24+.
// Output is JSON Lines. A successful run emits a final count for both filters.
// Treat intermediate pages as unverified until both complete successfully.
import {pathToFileURL} from 'node:url';

const base = new URL('https://basketball.fantasysports.yahoo.com/nba/85892/players');
function decode(s) {
  const names = {amp:'&', apos:"'", quot:'"', lt:'<', gt:'>', nbsp:' '};
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|apos|quot|lt|gt|nbsp);/gi, (_, ref) => {
    if (ref.startsWith('#')) return String.fromCodePoint(ref[1].toLowerCase() === 'x' ? parseInt(ref.slice(2),16) : Number(ref.slice(1)));
    return names[ref.toLowerCase()];
  }).trim();
}
function parsePage(html, filter) {
  const label = filter === 'FA' ? 'Free Agents Only' : 'Waivers Only';
  if (!html.includes('/nba/85892/') ||
      !html.includes('<option value="'+filter+'" selected>'+label+'</option>')) throw Error('Yahoo league or status filter not verified');
  const players = [];
  for (const [row] of html.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
    const a = row.match(/<a\b[^>]*\bclass="[^"]*\bname\b[^"]*"[^>]*\bdata-ys-playerid="(\d+)"[^>]*>([^<]+)<\/a>/i);
    if (!a) {
      if (row.includes('data-ys-playerid=')) throw Error('Yahoo player row could not be parsed');
      continue;
    }
    const statusCell = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)][4]?.[1];
    const status = decode(statusCell?.replace(/<[^>]+>/g,'') ?? '');
    if (filter === 'FA' ? status !== 'FA' : !/^W \([A-Z][a-z]{2} \d{1,2}\)$/.test(status)) throw Error('Unexpected Yahoo roster status: '+status);
    const position = row.match(/<span\s+class=["']Fz-xxs["']>\s*([A-Z]{2,3})\s*-\s*((?:PG|SG|SF|PF|C)(?:,\s*(?:PG|SG|SF|PF|C))*)\s*<\/span>/i);
    const player = {yahooId:a[1],name:decode(a[2]),availability:filter === 'FA' ? 'FREE_AGENT' : 'WAIVERS',yahooRosterStatus:status};
    if (filter === 'FA' && position) {
      player.nbaTeam = position[1];
      player.eligiblePositions = position[2].split(',').map(value => value.trim());
    }
    players.push(player);
  }
  if (players.length > 25 || (!players.length && !/>\s*No players found\s*</i.test(html))) throw Error('Unexpected Yahoo player row coverage');
  const next = [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>\s*Next 25\s*<\/a>/gi)].map(m=>decode(m[1]));
  if (next.length > 1 || (next.length && !players.length)) throw Error('Unexpected Yahoo pagination');
  if (!next.length && !/>\s*Next 25\s*<\/li>/i.test(html)) throw Error('Missing Yahoo pagination marker');
  return {players,next:next[0]??null};
}
export async function collect(filter, onPage = () => {}) {
  if (filter !== 'FA' && filter !== 'W') throw Error('Invalid Yahoo ownership filter');
  let url = new URL(base); url.searchParams.set('status',filter);
  const startedAt = new Date().toISOString();
  const ids = new Set();
  for (let offset=0; offset<=2500; offset+=25) {
    const response = await fetch(url,{signal:AbortSignal.timeout(12000)});
    if (!response.ok || response.url !== url.href) throw Error('Yahoo player page unavailable: HTTP '+response.status);
    const {players,next} = parsePage(await response.text(),filter);
    for (const p of players) {
      if (ids.has(p.yahooId)) throw Error('Repeated Yahoo player ID');
      ids.add(p.yahooId);
    }
    onPage({filter,offset,http:response.status,observedAt:new Date().toISOString(),players,complete:!next});
    if (!next) return {filter,startedAt,count:ids.size};
    url = new URL(next,base);
    if (url.origin !== base.origin || url.pathname !== base.pathname || url.searchParams.get('status') !== filter ||
      url.searchParams.get('count') !== String(offset+25)) throw Error('Unexpected Yahoo next link');
  }
  throw Error('Yahoo pagination limit reached');
}
if (!process.argv[1] || process.argv[1] === '-' || import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const filter of ['FA','W']) console.log(JSON.stringify(await collect(filter, page => console.log(JSON.stringify(page)))));
}
