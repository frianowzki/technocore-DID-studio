export function filterFeed(messages, filter, activeDid = null) {
  if (filter === 'mine') return activeDid ? messages.filter((message) => message.from === activeDid) : [];
  return filter === 'all' ? messages : messages.filter((message) => message.kind === filter);
}

export function shortAuthor(value) {
  if (value.startsWith('did:key:')) return `${value.slice(8, 16)}…${value.slice(-7)}`;
  return `~${value}`;
}

export function relativeTime(timestamp, now = new Date()) {
  const seconds = Math.max(0, Math.floor((now.getTime() - Date.parse(timestamp)) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
