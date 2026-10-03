
export const formatLogLine = (line: string): string => {
  if (!line) return '';
  // Display only timestamps already supplied by the producer; never invent time.
  const timestamp = line.match(/^(\[?\d{2}:\d{2}:\d{2}(?:\.\d{3})?\]?)\s+/);
  if (timestamp) line = line.slice(timestamp[0].length);

  // Escape HTML first to prevent injection
  let formatted = line
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  // Apply highlighting rules
  // ORDER MATTERS: Strings must be first to avoid matching HTML attributes in later tags

  // 1. Quoted strings (Match escaped quotes &quot;...&quot;)
  formatted = formatted.replace(/(&quot;.*?&quot;)/g, '<span class="log-string">$1</span>');

  // 2. Errors
  formatted = formatted.replace(/(ERROR:|Error:?|Fail:|Failed:?)(.*)/gi, '<span class="log-error">$1$2</span>');

  // 3. Warnings
  formatted = formatted.replace(/(WARNING:|Warning:?)(.*)/gi, '<span class="log-warning">$1$2</span>');

  // 4. Process tags [tag]
  formatted = formatted.replace(/^(\[\w+\])/, '<span class="log-tag">$1</span>');

  // 5. Progress (percentages)
  formatted = formatted.replace(/(\d{1,3}\.\d+%)/, '<span class="log-progress">$1</span>');

  // 6. Numbers and Units (Size, Time) - e.g. 10.5MiB, 00:01
  formatted = formatted.replace(/\b(\d+(\.\d+)?(MiB|KiB|GiB|s|ms|min))\b/g, '<span class="log-number">$1</span>');

  // 7. File paths or URLs (simplified, exclude < to avoid matching tags)
  formatted = formatted.replace(/(https?:\/\/[^\s<]+)/g, '<span class="log-url">$1</span>');

  return timestamp ? `<span class="log-timestamp">${timestamp[1]}</span>${formatted}` : formatted;
};
