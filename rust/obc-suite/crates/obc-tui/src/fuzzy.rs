//! Fast, zero-dependency multi-token fuzzy matcher with boundary, camelCase, and streak scoring
//! plus Ratatui span highlighting for `bh-tui`.

use ratatui::style::Style;
use ratatui::text::Span;

/// Result of a successful fuzzy match against a candidate string.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FuzzyMatch {
    /// Higher is better.
    pub score: i32,
    /// Sorted unique character indices (in `chars()` coordinates) matched in the primary string.
    pub positions: Vec<usize>,
}

fn is_boundary(prev: char, cur: char) -> bool {
    matches!(prev, '.' | '_' | '-' | '/' | ' ' | ':' | '(')
        || (prev.is_ascii_lowercase() && cur.is_ascii_uppercase())
}

/// Match a single whitespace-free token against `haystack` (case-insensitive) and return score + char indices.
fn match_token(token: &str, haystack: &str) -> Option<(i32, Vec<usize>)> {
    let q: Vec<char> = token.chars().map(|c| c.to_ascii_lowercase()).collect();
    if q.is_empty() {
        return Some((0, Vec::new()));
    }
    let orig: Vec<char> = haystack.chars().collect();
    let h: Vec<char> = orig.iter().map(char::to_ascii_lowercase).collect();
    if q.len() > h.len() {
        return None;
    }

    // Fast path: check exact contiguous substring first for highest fidelity
    let q_str: String = q.iter().collect();
    let h_str: String = h.iter().collect();
    if let Some(byte_pos) = h_str.find(&q_str) {
        let char_pos = h_str[..byte_pos].chars().count();
        let mut score = 80 + i32::try_from(q.len()).unwrap_or(0) * 24;
        if char_pos == 0 {
            score += if q.len() == h.len() { 160 } else { 90 };
        } else if is_boundary(orig[char_pos - 1], orig[char_pos]) {
            score += 55;
        }
        score -= i32::try_from(h.len().saturating_sub(q.len())).unwrap_or(0).min(40);
        let positions = (char_pos..char_pos + q.len()).collect();
        return Some((score, positions));
    }

    // Subsequence match preferring word boundaries and contiguous runs
    let mut best_pos = Vec::with_capacity(q.len());
    let mut qi = 0usize;
    let mut hi = 0usize;
    let mut score = 0i32;
    let mut prev_match: Option<usize> = None;

    while qi < q.len() && hi < h.len() {
        // Look ahead for a boundary occurrence of q[qi] before picking a mid-word char if still feasible
        if h[hi] == q[qi] {
            let mut chosen = hi;
            let at_boundary = hi == 0 || is_boundary(orig[hi - 1], orig[hi]);
            if !at_boundary && prev_match.is_none_or(|p| hi > p + 1) {
                // Scan forward for a boundary match that still leaves enough room for remaining query chars
                let rem = q.len() - qi;
                for cand in (hi + 1)..=h.len().saturating_sub(rem) {
                    if h[cand] == q[qi] && is_boundary(orig[cand - 1], orig[cand]) {
                        chosen = cand;
                        break;
                    }
                }
            }
            if chosen == 0 {
                score += 45;
            } else if is_boundary(orig[chosen - 1], orig[chosen]) {
                score += 36;
            }
            if let Some(pm) = prev_match {
                if chosen == pm + 1 {
                    score += 24;
                } else {
                    let gap = i32::try_from(chosen.saturating_sub(pm + 1)).unwrap_or(10);
                    score -= gap.min(12);
                }
            }
            score += 10;
            best_pos.push(chosen);
            prev_match = Some(chosen);
            qi += 1;
            hi = chosen + 1;
        } else {
            hi += 1;
        }
    }

    if qi == q.len() {
        let len_penalty = i32::try_from(h.len()).unwrap_or(0).min(40) / 2;
        Some((score - len_penalty, best_pos))
    } else {
        None
    }
}

/// Multi-token fuzzy match across a primary string (highlighted) and an optional secondary string (e.g. description).
#[must_use]
pub fn fuzzy_match(query: &str, primary: &str, secondary: &str) -> Option<FuzzyMatch> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Some(FuzzyMatch {
            score: 0,
            positions: Vec::new(),
        });
    }
    let mut total_score = 0i32;
    let mut positions = Vec::new();
    for tok in trimmed.split_whitespace() {
        if let Some((s1, p1)) = match_token(tok, primary) {
            total_score += s1 + 40;
            positions.extend(p1);
        } else if !secondary.is_empty()
            && let Some((s2, _)) = match_token(tok, secondary)
        {
            total_score += s2;
        } else {
            return None;
        }
    }
    positions.sort_unstable();
    positions.dedup();
    Some(FuzzyMatch {
        score: total_score,
        positions,
    })
}

/// Render `text` into owned Ratatui spans with `positions` highlighted in `hi_style`.
#[must_use]
pub fn highlight_spans(
    text: &str,
    positions: &[usize],
    max_chars: usize,
    base_style: Style,
    hi_style: Style,
) -> Vec<Span<'static>> {
    if positions.is_empty() {
        let clipped: String = text.chars().take(max_chars).collect();
        return vec![Span::styled(clipped, base_style)];
    }
    let mut spans = Vec::new();
    let mut buf = String::new();
    let mut cur_hi = false;
    let mut pi = 0usize;
    for (idx, ch) in text.chars().take(max_chars).enumerate() {
        while pi < positions.len() && positions[pi] < idx {
            pi += 1;
        }
        let is_hi = pi < positions.len() && positions[pi] == idx;
        if idx > 0 && is_hi != cur_hi && !buf.is_empty() {
            spans.push(Span::styled(
                std::mem::take(&mut buf),
                if cur_hi { hi_style } else { base_style },
            ));
        }
        cur_hi = is_hi;
        buf.push(ch);
    }
    if !buf.is_empty() {
        spans.push(Span::styled(buf, if cur_hi { hi_style } else { base_style }));
    }
    spans
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fuzzy_ranks_exact_prefix_and_boundaries_above_loose_subsequences() {
        let exact = fuzzy_match("approach", "approach", "").expect("exact");
        let prefix = fuzzy_match("app", "approach", "").expect("prefix");
        let camel = fuzzy_match("a3m", "a320Mcdu", "").expect("camel");
        let multi = fuzzy_match("fly f35", "fleet.fly", "Launch F-35B fighter").expect("multi");
        assert!(exact.score > prefix.score);
        assert_eq!(camel.positions.len(), 3);
        assert!(multi.score > 0);
        assert!(fuzzy_match("zzz", "fleet.fly", "Launch F-35B").is_none());
    }

    #[test]
    fn highlight_spans_preserves_text() {
        let m = fuzzy_match("flf", "fleet.fly", "").expect("match");
        let spans = highlight_spans("fleet.fly", &m.positions, 20, Style::default(), Style::default());
        let joined: String = spans.iter().map(|s| s.content.as_ref()).collect();
        assert_eq!(joined, "fleet.fly");
    }
}
