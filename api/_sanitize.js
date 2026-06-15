// Shared sanitization utility for stripping HTML/script from text before Supabase insert.
// Pure regex — no npm dependencies. Gemini output is plain text (not HTML),
// so this is a safety net, not a full HTML parser.

/**
 * Sanitize text: strip HTML tags, decode common entities, collapse whitespace, truncate.
 * @param {*} text - Input text (falsy values return empty string)
 * @param {number} [maxLen=500] - Maximum output length
 * @returns {string} Sanitized text
 */
export function sanitizeText(text, maxLen = 500) {
  if (!text) return '';
  let s = String(text);

  // 1. Decode common HTML entities FIRST (so encoded tags become real tags for step 2)
  s = s.replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // 2. Strip script/style tags AND their content, then strip remaining HTML tags
  s = s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  s = s.replace(/<[^>]*>/g, '');

  // 3. Collapse runs of spaces/tabs (preserve single newlines)
  s = s.replace(/[ \t]{2,}/g, ' ');
  s = s.replace(/\n{3,}/g, '\n\n');

  // 4. Trim leading/trailing whitespace
  s = s.trim();

  // 5. Truncate to maxLen
  if (s.length > maxLen) s = s.slice(0, maxLen);

  return s;
}
