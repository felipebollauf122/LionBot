const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{3,31}$/;
const PHONE_RE = /^\+?\d{8,15}$/;
export function parseTargets(raw) {
    const tokens = raw
        .split(/[\n,;]+/)
        .map((t) => t.trim())
        .filter(Boolean);
    const seen = new Set();
    const out = [];
    for (const token of tokens) {
        if (PHONE_RE.test(token)) {
            const identifier = token.startsWith("+") ? token : `+${token}`;
            if (seen.has(identifier))
                continue;
            seen.add(identifier);
            out.push({ identifier, type: "phone", valid: true });
            continue;
        }
        const stripped = token.startsWith("@") ? token.slice(1) : token;
        const key = `@${stripped.toLowerCase()}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        if (USERNAME_RE.test(stripped)) {
            out.push({ identifier: stripped, type: "username", valid: true });
        }
        else {
            out.push({ identifier: token, type: "username", valid: false });
        }
    }
    return out;
}
