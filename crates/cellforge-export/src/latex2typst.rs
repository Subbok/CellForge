/// Convert LaTeX math to Typst math.
/// Handles the most common constructs found in Jupyter notebooks.
pub fn convert(latex: &str) -> String {
    let tokens = tokenize(latex);
    let mut out = String::new();
    let mut i = 0;

    while i < tokens.len() {
        match &tokens[i] {
            Token::Command(cmd) => {
                i = convert_command(cmd, &tokens, i, &mut out);
            }
            Token::Text(t) => {
                // in typst math, multi-letter sequences are treated as variable names.
                // we need spaces between ALL adjacent characters to avoid this.
                // "4ac" → "4 a c", "al" → "a l", "123" stays "123"
                let mut chars = t.chars().peekable();
                while let Some(ch) = chars.next() {
                    out.push(ch);
                    if let Some(&next) = chars.peek() {
                        // don't split digit sequences (123 stays 123)
                        // but split everything else
                        let both_digits = ch.is_ascii_digit() && next.is_ascii_digit();
                        if !both_digits && (ch.is_alphanumeric() && next.is_alphanumeric()) {
                            out.push(' ');
                        }
                    }
                }
                i += 1;
            }
            Token::Open => {
                out.push('(');
                i += 1;
            }
            Token::Close => {
                out.push(')');
                i += 1;
            }
            Token::Sub => {
                out.push('_');
                i += 1;
            }
            Token::Sup => {
                out.push('^');
                i += 1;
            }
            Token::Space => {
                out.push(' ');
                i += 1;
            }
            Token::Other(c) => {
                out.push(*c);
                i += 1;
            }
        }
    }

    out
}

fn convert_command(cmd: &str, tokens: &[Token], pos: usize, out: &mut String) -> usize {
    let mut i = pos + 1; // skip the command token

    match cmd {
        // \frac{num}{den} → frac(num, den)
        "frac" => {
            let (num, next) = collect_group(tokens, i);
            i = next;
            let (den, next) = collect_group(tokens, i);
            i = next;
            out.push_str(&format!("frac({}, {})", convert(&num), convert(&den)));
        }
        // \sqrt{x} → sqrt(x)  or \sqrt[n]{x} → root(n, x)
        "sqrt" => {
            // check for optional [n]
            if i < tokens.len() && matches!(&tokens[i], Token::Other('[')) {
                let mut n = String::new();
                i += 1; // skip [
                while i < tokens.len() && !matches!(&tokens[i], Token::Other(']')) {
                    n.push_str(&token_to_latex(&tokens[i]));
                    i += 1;
                }
                i += 1; // skip ]
                let (body, next) = collect_group(tokens, i);
                i = next;
                out.push_str(&format!("root({}, {})", convert(&n), convert(&body)));
            } else {
                let (body, next) = collect_group(tokens, i);
                i = next;
                out.push_str(&format!("sqrt({})", convert(&body)));
            }
        }
        // \text{...} or \mathrm{...} → "..."
        "text" | "mathrm" | "textbf" | "mathbf" => {
            let (body, next) = collect_group(tokens, i);
            i = next;
            out.push_str(&format!("\"{}\"", body));
        }
        // \left( \right) — just output the delimiter
        "left" => {
            if i < tokens.len() {
                match &tokens[i] {
                    Token::Other(c) => {
                        out.push(*c);
                        i += 1;
                    }
                    Token::Text(t) => {
                        out.push_str(t);
                        i += 1;
                    }
                    _ => {}
                }
            }
        }
        "right" => {
            if i < tokens.len() {
                match &tokens[i] {
                    Token::Other(c) => {
                        out.push(*c);
                        i += 1;
                    }
                    Token::Text(t) => {
                        out.push_str(t);
                        i += 1;
                    }
                    _ => {}
                }
            }
        }
        // \begin{env}...\end{env}
        "begin" => {
            let (env, next) = collect_group(tokens, i);
            i = next;
            match env.as_str() {
                "pmatrix" | "bmatrix" | "matrix" => {
                    let delim = match env.as_str() {
                        "pmatrix" => "(",
                        "bmatrix" => "[",
                        _ => "",
                    };
                    // collect until \end
                    let mut body = String::new();
                    while i < tokens.len() {
                        if let Token::Command(c) = &tokens[i]
                            && c == "end"
                        {
                            i += 1;
                            let (_, n) = collect_group(tokens, i);
                            i = n;
                            break;
                        }
                        body.push_str(&token_to_latex(&tokens[i]));
                        i += 1;
                    }
                    // convert matrix body: & → , and \\ → ;
                    let typst_body = body.replace("&", ",").replace("\\\\", ";");
                    if delim.is_empty() {
                        out.push_str(&format!("mat({})", convert(&typst_body)));
                    } else {
                        out.push_str(&format!(
                            "mat(delim: \"{}\", {})",
                            delim,
                            convert(&typst_body)
                        ));
                    }
                }
                _ => {
                    out.push_str(&format!("\"[{}]\"", env));
                }
            }
        }
        "end" => {
            let (_, next) = collect_group(tokens, i);
            i = next;
        }
        // Greek letters and symbols → direct typst names
        _ => {
            if let Some(typst) = latex_symbol(cmd) {
                out.push_str(typst);
            } else {
                // unknown command — just output the name
                out.push_str(cmd);
            }
        }
    }

    i
}

/// Collect a brace-delimited group {....} and return its raw LaTeX content.
fn collect_group(tokens: &[Token], start: usize) -> (String, usize) {
    let mut i = start;
    // if starts with {, collect until matching }
    if i < tokens.len() && matches!(&tokens[i], Token::Open) {
        i += 1;
        let mut depth = 1;
        let mut content = String::new();
        while i < tokens.len() && depth > 0 {
            match &tokens[i] {
                Token::Open => {
                    depth += 1;
                    content.push('{');
                }
                Token::Close => {
                    depth -= 1;
                    if depth > 0 {
                        content.push('}');
                    }
                }
                _ => content.push_str(&token_to_latex(&tokens[i])),
            }
            i += 1;
        }
        (content, i)
    } else if i < tokens.len() {
        // single token
        let s = token_to_latex(&tokens[i]);
        (s, i + 1)
    } else {
        (String::new(), i)
    }
}

fn token_to_latex(t: &Token) -> String {
    match t {
        Token::Command(c) => format!("\\{c}"),
        Token::Text(t) => t.clone(),
        Token::Open => "{".into(),
        Token::Close => "}".into(),
        Token::Sub => "_".into(),
        Token::Sup => "^".into(),
        Token::Space => " ".into(),
        Token::Other(c) => c.to_string(),
    }
}

fn latex_symbol(cmd: &str) -> Option<&'static str> {
    Some(match cmd {
        // greek
        "alpha" => "alpha",
        "beta" => "beta",
        "gamma" => "gamma",
        "delta" => "delta",
        "epsilon" => "epsilon",
        "varepsilon" => "epsilon.alt",
        "zeta" => "zeta",
        "eta" => "eta",
        "theta" => "theta",
        "iota" => "iota",
        "kappa" => "kappa",
        "lambda" => "lambda",
        "mu" => "mu",
        "nu" => "nu",
        "xi" => "xi",
        "pi" => "pi",
        "rho" => "rho",
        "sigma" => "sigma",
        "tau" => "tau",
        "upsilon" => "upsilon",
        "phi" => "phi",
        "varphi" => "phi.alt",
        "chi" => "chi",
        "psi" => "psi",
        "omega" => "omega",
        "Gamma" => "Gamma",
        "Delta" => "Delta",
        "Theta" => "Theta",
        "Lambda" => "Lambda",
        "Xi" => "Xi",
        "Pi" => "Pi",
        "Sigma" => "Sigma",
        "Phi" => "Phi",
        "Psi" => "Psi",
        "Omega" => "Omega",
        // operators
        "cdot" => "dot",
        "times" => "times",
        "div" => "div",
        "pm" => "plus.minus",
        "mp" => "minus.plus",
        "leq" | "le" => "<=",
        "geq" | "ge" => ">=",
        "neq" | "ne" => "!=",
        "approx" => "approx",
        "equiv" => "equiv",
        "sim" => "tilde",
        "propto" => "prop",
        // arrows
        "to" | "rightarrow" => "arrow.r",
        "leftarrow" => "arrow.l",
        "Rightarrow" => "arrow.r.double",
        "Leftarrow" => "arrow.l.double",
        "leftrightarrow" => "arrow.l.r",
        "Leftrightarrow" => "arrow.l.r.double",
        "mapsto" => "arrow.r.bar",
        // big ops
        "sum" => "sum",
        "prod" => "product",
        "int" => "integral",
        "iint" => "integral.double",
        "iiint" => "integral.triple",
        "oint" => "integral.cont",
        "lim" => "lim",
        "sup" => "sup",
        "inf" => "inf",
        "min" => "min",
        "max" => "max",
        "log" => "log",
        "ln" => "ln",
        "sin" => "sin",
        "cos" => "cos",
        "tan" => "tan",
        "exp" => "exp",
        "det" => "det",
        "dim" => "dim",
        // misc
        "infty" => "infinity",
        "partial" => "diff",
        "nabla" => "nabla",
        "hbar" => "planck.reduce",
        "forall" => "forall",
        "exists" => "exists",
        "in" => "in",
        "notin" => "in.not",
        "subset" => "subset",
        "supset" => "supset",
        "subseteq" => "subset.eq",
        "supseteq" => "supset.eq",
        "cup" => "union",
        "cap" => "sect",
        "emptyset" | "varnothing" => "emptyset",
        "ldots" | "dots" => "dots",
        "cdots" => "dots.c",
        "vdots" => "dots.v",
        "quad" => "quad",
        "qquad" => "wide",
        // formatting
        "bar" => "overline",
        "hat" => "hat",
        "tilde" => "tilde",
        "vec" => "arrow",
        "dot" => "dot.op",
        "overline" => "overline",
        "underline" => "underline",
        _ => return None,
    })
}

// -- tokenizer --

#[derive(Debug)]
enum Token {
    Command(String), // \frac, \alpha, etc
    Text(String),    // letters, digits
    Open,            // {
    Close,           // }
    Sub,             // _
    Sup,             // ^
    Space,           // whitespace
    Other(char),     // +, -, =, (, ), etc
}

fn tokenize(input: &str) -> Vec<Token> {
    let mut tokens = Vec::new();
    let mut chars = input.chars().peekable();

    while let Some(&ch) = chars.peek() {
        match ch {
            '\\' => {
                chars.next();
                if chars.peek().map(|c| c.is_alphabetic()).unwrap_or(false) {
                    let mut cmd = String::new();
                    while chars.peek().map(|c| c.is_alphabetic()).unwrap_or(false) {
                        cmd.push(chars.next().unwrap());
                    }
                    tokens.push(Token::Command(cmd));
                } else if let Some(c) = chars.next() {
                    // \\ or \, or other single char
                    tokens.push(Token::Command(c.to_string()));
                }
            }
            '{' => {
                chars.next();
                tokens.push(Token::Open);
            }
            '}' => {
                chars.next();
                tokens.push(Token::Close);
            }
            '_' => {
                chars.next();
                tokens.push(Token::Sub);
            }
            '^' => {
                chars.next();
                tokens.push(Token::Sup);
            }
            ' ' | '\t' | '\n' => {
                chars.next();
                tokens.push(Token::Space);
            }
            c if c.is_alphanumeric() => {
                let mut s = String::new();
                while chars
                    .peek()
                    .map(|c| c.is_alphanumeric() || *c == '.')
                    .unwrap_or(false)
                {
                    s.push(chars.next().unwrap());
                }
                tokens.push(Token::Text(s));
            }
            c => {
                chars.next();
                tokens.push(Token::Other(c));
            }
        }
    }

    tokens
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simple_frac() {
        assert_eq!(convert("\\frac{a}{b}"), "frac(a, b)");
    }

    #[test]
    fn quadratic() {
        let result = convert("x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}");
        eprintln!("quadratic result: {result}");
        assert!(result.contains("frac("));
        assert!(result.contains("sqrt("));
        assert!(result.contains("plus.minus"));
    }

    #[test]
    fn greek() {
        assert_eq!(convert("\\alpha + \\beta"), "alpha + beta");
    }

    #[test]
    fn subscript() {
        assert_eq!(convert("x_i"), "x_i");
    }

    #[test]
    fn integral() {
        let result = convert("\\int_0^1 f(x) dx");
        assert!(result.contains("integral"));
    }

    #[test]
    fn sum_series() {
        let result = convert("\\sum_{n=1}^{\\infty} \\frac{1}{n^2}");
        assert!(result.contains("sum"));
        assert!(result.contains("infinity"));
        assert!(result.contains("frac("));
    }

    // --- matrix tests ---

    #[test]
    fn pmatrix() {
        let result = convert("\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}");
        assert!(
            result.contains("mat(delim: \"(\""),
            "pmatrix should use '(' delimiter, got: {result}"
        );
    }

    #[test]
    fn bmatrix() {
        let result = convert("\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}");
        assert!(
            result.contains("mat(delim: \"[\""),
            "bmatrix should use '[' delimiter, got: {result}"
        );
    }

    #[test]
    fn plain_matrix() {
        let result = convert("\\begin{matrix} x & y \\\\ z & w \\end{matrix}");
        assert!(
            result.contains("mat("),
            "matrix should produce mat(), got: {result}"
        );
        // plain matrix should NOT have a delim argument
        assert!(
            !result.contains("delim:"),
            "plain matrix should not have delim, got: {result}"
        );
    }

    // --- nested fractions ---

    #[test]
    fn nested_frac() {
        let result = convert("\\frac{\\frac{a}{b}}{c}");
        // outer frac wraps an inner frac
        assert!(
            result.contains("frac(frac(a, b), c)"),
            "nested fracs should produce frac(frac(a, b), c), got: {result}"
        );
    }

    #[test]
    fn frac_with_sqrt() {
        let result = convert("\\frac{\\sqrt{x}}{y}");
        assert!(result.contains("frac(sqrt(x), y)"), "got: {result}");
    }

    // --- edge cases ---

    #[test]
    fn empty_input() {
        assert_eq!(convert(""), "", "empty input should produce empty output");
    }

    #[test]
    fn only_whitespace() {
        let result = convert("   ");
        assert!(
            result.trim().is_empty() || result.chars().all(|c| c == ' '),
            "whitespace input should produce whitespace or empty, got: '{result}'"
        );
    }

    #[test]
    fn unknown_command_passed_through() {
        let result = convert("\\unknowncommand");
        assert!(
            result.contains("unknowncommand"),
            "unknown commands should pass through as-is, got: {result}"
        );
    }

    #[test]
    fn plain_text_no_commands() {
        let result = convert("abc + 123");
        assert!(result.contains('+'));
        assert!(result.contains("123"));
    }

    #[test]
    fn text_command() {
        let result = convert("\\text{hello world}");
        assert!(
            result.contains("\"hello world\""),
            "\\text should produce quoted string, got: {result}"
        );
    }

    #[test]
    fn sqrt_with_nth_root() {
        let result = convert("\\sqrt[3]{x}");
        assert!(
            result.contains("root(3, x)"),
            "\\sqrt[3]{{x}} should produce root(3, x), got: {result}"
        );
    }

    #[test]
    fn left_right_parens() {
        let result = convert("\\left( x + y \\right)");
        assert!(result.contains('('));
        assert!(result.contains(')'));
    }

    #[test]
    fn multiple_greek_letters() {
        let result = convert("\\alpha \\beta \\gamma \\delta \\epsilon");
        assert!(result.contains("alpha"));
        assert!(result.contains("beta"));
        assert!(result.contains("gamma"));
        assert!(result.contains("delta"));
        assert!(result.contains("epsilon"));
    }

    #[test]
    fn operators() {
        assert!(convert("\\cdot").contains("dot"));
        assert!(convert("\\times").contains("times"));
        assert!(convert("\\leq").contains("<="));
        assert!(convert("\\geq").contains(">="));
        assert!(convert("\\neq").contains("!="));
        assert!(convert("\\infty").contains("infinity"));
    }

    #[test]
    fn superscript_and_subscript() {
        let result = convert("x_{i}^{2}");
        assert!(result.contains('_'));
        assert!(result.contains('^'));
    }

    #[test]
    fn arrows() {
        assert!(convert("\\rightarrow").contains("arrow.r"));
        assert!(convert("\\leftarrow").contains("arrow.l"));
        assert!(convert("\\Rightarrow").contains("arrow.r.double"));
    }

    #[test]
    fn sum_with_limits() {
        let result = convert("\\sum_{i=0}^{n}");
        assert!(result.contains("sum"));
        assert!(result.contains('_'));
        assert!(result.contains('^'));
    }

    #[test]
    fn begin_unknown_env() {
        let result = convert("\\begin{align} x = 1 \\end{align}");
        // unknown environments produce a bracketed label
        assert!(
            result.contains("[align]"),
            "unknown env should produce [align], got: {result}"
        );
    }
}
