/**
 * Turn the LaTeX a model occasionally reaches for into plain text.
 *
 * Nothing in this curriculum is typeset maths, and the app ships no maths renderer, so
 * when a reply comes back saying `SYN $\rightarrow$ SYN-ACK` the reader gets the source
 * rather than the arrow. The system prompts ask the model not to do it, which reduces it
 * without ever eliminating it — instruction-following is a tendency, not a guarantee, and
 * a single stray `$\to$` in the middle of a good explanation is exactly the kind of thing
 * that makes an app feel broken. So the renderer degrades it instead of trusting the ask.
 *
 * What this is NOT is a LaTeX engine. It handles the symbol-and-delimiter subset that
 * shows up in prose about protocols and query planners, and anything it does not
 * recognise it unwraps rather than mangles: a stripped brace leaves readable text, and a
 * command it has never seen loses its backslash and keeps its name.
 *
 * The dangerous half is the dollar sign, because `$` is a real character in this
 * curriculum — shell prompts, `$PATH`, `$1` in a script. Two things keep it safe. First,
 * this runs per *token*, so fenced code and inline code spans never reach it (see
 * markdown.ts). Second, `$…$` is only treated as maths when it actually looks like
 * maths — see `looksMathy`.
 */

/** Commands worth a real character. Longest-first matching happens in the regex. */
const SYMBOLS: Record<string, string> = {
  // arrows — the ones that actually show up, describing handshakes and state machines
  rightarrow: '→', to: '→', longrightarrow: '⟶', Rightarrow: '⇒', implies: '⇒',
  leftarrow: '←', gets: '←', Leftarrow: '⇐', leftrightarrow: '↔', Leftrightarrow: '⇔',
  iff: '⇔', uparrow: '↑', downarrow: '↓', mapsto: '↦',
  // arithmetic and comparison
  times: '×', div: '÷', pm: '±', mp: '∓', cdot: '·', ast: '*', bullet: '•',
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', equiv: '≡',
  sim: '~', simeq: '≃', propto: '∝', ll: '≪', gg: '≫',
  // sets and logic
  in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇',
  cup: '∪', cap: '∩', emptyset: '∅', varnothing: '∅',
  land: '∧', wedge: '∧', lor: '∨', vee: '∨', lnot: '¬', neg: '¬',
  forall: '∀', exists: '∃', therefore: '∴',
  // the big operators, as their bare glyphs — no attempt at limits
  sum: '∑', prod: '∏', int: '∫', sqrt: '√', infty: '∞', partial: '∂', nabla: '∇',
  ldots: '…', dots: '…', cdots: '…', vdots: '⋮',
  // greek, lower and upper
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ',
  nu: 'ν', xi: 'ξ', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ',
  chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ',
  Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};

/** Wrappers whose only job is a font; the content is the message. */
const UNWRAP = /\\(?:text|textrm|textit|textbf|texttt|mathrm|mathit|mathbf|mathtt|mathsf|mathcal|operatorname)\s*\{([^{}]*)\}/g;

const SYMBOL_RE = new RegExp(
  `\\\\(${Object.keys(SYMBOLS).sort((a, b) => b.length - a.length).join('|')})(?![a-zA-Z])`,
  'g',
);

/** Convert the contents of a maths span to the nearest readable plain text. */
function convert(math: string): string {
  let s = math;
  // Font wrappers can nest one level in practice (\text{\tt x}); twice is enough.
  s = s.replace(UNWRAP, '$1').replace(UNWRAP, '$1');
  s = s.replace(SYMBOL_RE, (_, name: string) => SYMBOLS[name]);
  // `\%` and friends are escaped literals — the character without its backslash.
  s = s.replace(/\\([%_&#{}$])/g, '$1');
  // Spacing commands: \, \; \: \! \quad \qquad \\ — all whitespace or nothing.
  s = s.replace(/\\(?:quad|qquad)(?![a-zA-Z])/g, ' ').replace(/\\[,;:]/g, ' ').replace(/\\!/g, '');
  s = s.replace(/\\\\/g, ' ');
  // \frac{a}{b} reads better as a/b than as two orphaned braces.
  s = s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '$1/$2');
  // Sub/superscripts keep their marker, which is how anyone writes them in plain text
  // anyway: n^2, x_i. Only the braces go.
  s = s.replace(/([_^])\s*\{([^{}]*)\}/g, '$1$2');
  // Anything still wearing a backslash is a command this doesn't know. Its name is
  // almost always more readable than the raw source, so drop the backslash and keep it.
  s = s.replace(/\\([a-zA-Z]+)/g, '$1');
  // Grouping braces have no meaning once the maths is gone.
  s = s.replace(/[{}]/g, '');
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Is this `$…$` span actually maths, or is it two dollar signs in a sentence about money?
 *
 * The failure mode to avoid is "it costs $5 and $10 total" quietly becoming "it costs 5
 * and 10 total". So the bar is deliberately high: the span must not straddle a line, must
 * not hold its own dollar sign, must not be padded with spaces (currency almost always
 * leaves a space before the next `$`), and must contain a letter or a command — which
 * rules out the bare numbers that money is made of.
 */
function looksMathy(inner: string): boolean {
  if (!inner || inner.length > 80) return false;
  if (/[\n$]/.test(inner)) return false;
  if (/^\s|\s$/.test(inner)) return false;
  return /[a-zA-Z]|\\/.test(inner);
}

/**
 * Replace the LaTeX in a run of prose with plain text.
 *
 * Call this on text that is known not to be code — markdown.ts applies it per token so
 * code spans and fenced blocks are excluded structurally rather than by guesswork.
 */
export function deLatex(text: string): string {
  if (!text || (!text.includes('$') && !text.includes('\\'))) return text;

  let s = text;
  // Display maths first: `$$…$$` would otherwise be read as two empty inline spans.
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, m: string) => convert(m));
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_, m: string) => convert(m));
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_, m: string) => convert(m));
  s = s.replace(/\$([^$\n]+?)\$/g, (whole, m: string) => (looksMathy(m) ? convert(m) : whole));
  // A command written bare, with no delimiters around it at all — `A \rightarrow B`.
  // Only names we recognise, so ordinary prose containing a backslash is left alone.
  s = s.replace(SYMBOL_RE, (_, name: string) => SYMBOLS[name]);
  return s;
}
