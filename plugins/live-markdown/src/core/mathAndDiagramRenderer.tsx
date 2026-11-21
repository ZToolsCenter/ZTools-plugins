import React from "react";

const LATEX_SYMBOL_MAP: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ϵ",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  vartheta: "ϑ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "ϕ",
  varphi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Upsilon: "Υ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
  sum: "∑",
  prod: "∏",
  coprod: "∐",
  int: "∫",
  iint: "∬",
  iiint: "∭",
  oint: "∮",
  infty: "∞",
  partial: "∂",
  nabla: "∇",
  pm: "±",
  mp: "∓",
  times: "×",
  div: "÷",
  cdot: "⋅",
  cdots: "⋯",
  ldots: "…",
  vdots: "⋮",
  ddots: "⋱",
  leq: "≤",
  le: "≤",
  geq: "≥",
  ge: "≥",
  neq: "≠",
  ne: "≠",
  approx: "≈",
  equiv: "≡",
  cong: "≅",
  sim: "∼",
  propto: "∝",
  in: "∈",
  notin: "∉",
  ni: "∋",
  subset: "⊂",
  subseteq: "⊆",
  supset: "⊃",
  supseteq: "⊇",
  cup: "∪",
  cap: "∩",
  emptyset: "∅",
  varnothing: "∅",
  forall: "∀",
  exists: "∃",
  nexists: "∄",
  neg: "¬",
  land: "∧",
  lor: "∨",
  Rightarrow: "⇒",
  Leftarrow: "⇐",
  Leftrightarrow: "⇔",
  rightarrow: "→",
  to: "→",
  leftarrow: "←",
  leftrightarrow: "↔",
  mapsto: "↦",
  uparrow: "↑",
  downarrow: "↓",
  aleph: "ℵ",
  hbar: "ℏ",
  ell: "ℓ",
  Re: "ℜ",
  Im: "ℑ",
  wp: "℘",
  perp: "⊥",
  parallel: "∥",
  angle: "∠",
  triangle: "△",
  oplus: "⊕",
  otimes: "⊗",
  odot: "⊙",
  star: "⋆",
  dagger: "†",
  ddagger: "‡",
  checkmark: "✓",
  quad: "\u2003",
  qquad: "\u2003\u2003"
};

const BLACKBOARD_BOLD_MAP: Record<string, string> = {
  R: "ℝ",
  N: "ℕ",
  Z: "ℤ",
  Q: "ℚ",
  C: "ℂ",
  P: "ℙ",
  E: "𝔼",
  F: "𝔽",
  H: "ℍ"
};

function readBracedGroup(input: string, startIndex: number): { content: string; nextIndex: number } {
  if (input[startIndex] !== "{") {
    return { content: input[startIndex] || "", nextIndex: startIndex + 1 };
  }
  let depth = 0;
  let i = startIndex;
  while (i < input.length) {
    if (input[i] === "\\" && i + 1 < input.length) {
      i += 2;
      continue;
    }
    if (input[i] === "{") depth += 1;
    if (input[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          content: input.slice(startIndex + 1, i),
          nextIndex: i + 1
        };
      }
    }
    i += 1;
  }
  return {
    content: input.slice(startIndex + 1),
    nextIndex: input.length
  };
}

export function renderLatexExpressionToNodes(tex: string, keyPrefix = "m"): React.ReactNode[] {
  const input = String(tex ?? "").trim();
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let seq = 0;
  const nextKey = () => `${keyPrefix}-${(seq += 1)}`;

  // Check for \begin{...} ... \end{...}
  const envMatch = input.match(
    /^\\begin\{(matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|cases|aligned|align\*?)\}([\s\S]*?)\\end\{\1\}$/
  );
  if (envMatch) {
    const envType = envMatch[1];
    const body = envMatch[2].trim();
    const rows = body
      .split(/\\\\/)
      .map((r) => r.trim())
      .filter(Boolean);

    return [
      <span key={nextKey()} className={`ty-math-env ty-math-env-${envType.replace("*", "")}`}>
        {envType === "pmatrix" && <span className="ty-math-delim">(</span>}
        {envType === "bmatrix" && <span className="ty-math-delim">[</span>}
        {envType === "Bmatrix" && <span className="ty-math-delim">{"{"}</span>}
        {envType === "vmatrix" && <span className="ty-math-delim">|</span>}
        {envType === "Vmatrix" && <span className="ty-math-delim">‖</span>}
        {envType === "cases" && <span className="ty-math-delim">{"{"}</span>}
        <span className="ty-math-matrix-grid">
          {rows.map((rowStr, rIdx) => {
            const cells = rowStr.split("&").map((c) => c.trim());
            return (
              <span key={rIdx} className="ty-math-matrix-row">
                {cells.map((cellStr, cIdx) => (
                  <span key={cIdx} className="ty-math-matrix-cell">
                    {renderLatexExpressionToNodes(cellStr, `${keyPrefix}-r${rIdx}c${cIdx}`)}
                  </span>
                ))}
              </span>
            );
          })}
        </span>
        {envType === "pmatrix" && <span className="ty-math-delim">)</span>}
        {envType === "bmatrix" && <span className="ty-math-delim">]</span>}
        {envType === "Bmatrix" && <span className="ty-math-delim">{"}"}</span>}
        {envType === "vmatrix" && <span className="ty-math-delim">|</span>}
        {envType === "Vmatrix" && <span className="ty-math-delim">‖</span>}
      </span>
    ];
  }

  while (i < input.length) {
    const ch = input[i];

    if (ch === "{") {
      const group = readBracedGroup(input, i);
      nodes.push(
        <span key={nextKey()} className="ty-math-group">
          {renderLatexExpressionToNodes(group.content, nextKey())}
        </span>
      );
      i = group.nextIndex;
      continue;
    }

    if (ch === "^" || ch === "_") {
      const isSup = ch === "^";
      i += 1;
      while (i < input.length && input[i] === " ") i += 1;
      const group = readBracedGroup(input, i);
      nodes.push(
        isSup ? (
          <sup key={nextKey()} className="ty-math-sup">
            {renderLatexExpressionToNodes(group.content, nextKey())}
          </sup>
        ) : (
          <sub key={nextKey()} className="ty-math-sub">
            {renderLatexExpressionToNodes(group.content, nextKey())}
          </sub>
        )
      );
      i = group.nextIndex;
      continue;
    }

    if (ch === "\\") {
      if (input[i + 1] === "\\" ) {
        nodes.push(<br key={nextKey()} />);
        i += 2;
        continue;
      }
      if (input[i + 1] === "," || input[i + 1] === ";" || input[i + 1] === " ") {
        nodes.push(<span key={nextKey()}>{"\u2009"}</span>);
        i += 2;
        continue;
      }
      if ("{}%$&_#".includes(input[i + 1] || "")) {
        nodes.push(<span key={nextKey()}>{input[i + 1]}</span>);
        i += 2;
        continue;
      }

      const cmdMatch = input.slice(i + 1).match(/^[A-Za-z]+/);
      if (cmdMatch) {
        const cmd = cmdMatch[0];
        i += 1 + cmd.length;
        while (i < input.length && input[i] === " ") i += 1;

        if (cmd === "begin") {
          const envGroup = readBracedGroup(input, i);
          const envType = envGroup.content.trim();
          i = envGroup.nextIndex;
          const endToken = `\\end{${envType}}`;
          const endIdx = input.indexOf(endToken, i);
          const body =
            endIdx !== -1
              ? input.slice(i, endIdx).trim()
              : input.slice(i).trim();
          i = endIdx !== -1 ? endIdx + endToken.length : input.length;

          const rows = body
            .split(/\\\\/)
            .map((r) => r.trim())
            .filter(Boolean);

          nodes.push(
            <span
              key={nextKey()}
              className={`ty-math-env ty-math-env-${envType.replace("*", "")}`}
            >
              {envType === "pmatrix" && <span className="ty-math-delim">(</span>}
              {envType === "bmatrix" && <span className="ty-math-delim">[</span>}
              {envType === "Bmatrix" && (
                <span className="ty-math-delim">{"{"}</span>
              )}
              {envType === "vmatrix" && <span className="ty-math-delim">|</span>}
              {envType === "Vmatrix" && <span className="ty-math-delim">‖</span>}
              {envType === "cases" && (
                <span className="ty-math-delim">{"{"}</span>
              )}
              <span className="ty-math-matrix-grid">
                {rows.map((rowStr, rIdx) => {
                  const cells = rowStr.split("&").map((c) => c.trim());
                  return (
                    <span key={rIdx} className="ty-math-matrix-row">
                      {cells.map((cellStr, cIdx) => (
                        <span key={cIdx} className="ty-math-matrix-cell">
                          {renderLatexExpressionToNodes(
                            cellStr,
                            `${keyPrefix}-r${rIdx}c${cIdx}`
                          )}
                        </span>
                      ))}
                    </span>
                  );
                })}
              </span>
              {envType === "pmatrix" && <span className="ty-math-delim">)</span>}
              {envType === "bmatrix" && <span className="ty-math-delim">]</span>}
              {envType === "Bmatrix" && (
                <span className="ty-math-delim">{"}"}</span>
              )}
              {envType === "vmatrix" && <span className="ty-math-delim">|</span>}
              {envType === "Vmatrix" && <span className="ty-math-delim">‖</span>}
            </span>
          );
          continue;
        }

        if (cmd === "left" || cmd === "right") {
          if (i < input.length) {
            const delim = input[i] === "." ? "" : input[i];
            if (delim) {
              nodes.push(
                <span key={nextKey()} className="ty-math-delim">
                  {delim}
                </span>
              );
            }
            i += 1;
          }
          continue;
        }

        if (cmd === "frac" || cmd === "dfrac" || cmd === "tfrac") {
          const numGroup = readBracedGroup(input, i);
          i = numGroup.nextIndex;
          while (i < input.length && input[i] === " ") i += 1;
          const denGroup = readBracedGroup(input, i);
          i = denGroup.nextIndex;
          nodes.push(
            <span key={nextKey()} className="ty-math-frac">
              <span className="ty-math-frac-num">
                {renderLatexExpressionToNodes(numGroup.content, nextKey())}
              </span>
              <span className="ty-math-frac-bar" />
              <span className="ty-math-frac-den">
                {renderLatexExpressionToNodes(denGroup.content, nextKey())}
              </span>
            </span>
          );
          continue;
        }

        if (cmd === "sqrt") {
          let rootDegree = "";
          if (input[i] === "[") {
            const closeBracket = input.indexOf("]", i);
            if (closeBracket > i) {
              rootDegree = input.slice(i + 1, closeBracket);
              i = closeBracket + 1;
            }
          }
          const radGroup = readBracedGroup(input, i);
          i = radGroup.nextIndex;
          nodes.push(
            <span key={nextKey()} className="ty-math-sqrt">
              {rootDegree && <sup className="ty-math-sqrt-deg">{rootDegree}</sup>}
              <span className="ty-math-sqrt-sign">√</span>
              <span className="ty-math-sqrt-body">
                {renderLatexExpressionToNodes(radGroup.content, nextKey())}
              </span>
            </span>
          );
          continue;
        }

        if (
          cmd === "text" ||
          cmd === "textrm" ||
          cmd === "mathrm" ||
          cmd === "operatorname"
        ) {
          const txtGroup = readBracedGroup(input, i);
          i = txtGroup.nextIndex;
          nodes.push(
            <span key={nextKey()} className="ty-math-roman">
              {txtGroup.content}
            </span>
          );
          continue;
        }

        if (cmd === "mathbf" || cmd === "boldsymbol") {
          const bGroup = readBracedGroup(input, i);
          i = bGroup.nextIndex;
          nodes.push(
            <strong key={nextKey()} className="ty-math-bold">
              {renderLatexExpressionToNodes(bGroup.content, nextKey())}
            </strong>
          );
          continue;
        }

        if (cmd === "mathbb") {
          const bbGroup = readBracedGroup(input, i);
          i = bbGroup.nextIndex;
          const mapped = BLACKBOARD_BOLD_MAP[bbGroup.content.trim()] || bbGroup.content;
          nodes.push(
            <span key={nextKey()} className="ty-math-bb">
              {mapped}
            </span>
          );
          continue;
        }

        if (cmd === "hat" || cmd === "vec" || cmd === "bar" || cmd === "tilde") {
          const accGroup = readBracedGroup(input, i);
          i = accGroup.nextIndex;
          const accentMark =
            cmd === "hat" ? "^" : cmd === "vec" ? "→" : cmd === "bar" ? "¯" : "~";
          nodes.push(
            <span key={nextKey()} className="ty-math-accent">
              <span className="ty-math-accent-mark">{accentMark}</span>
              <span>{renderLatexExpressionToNodes(accGroup.content, nextKey())}</span>
            </span>
          );
          continue;
        }

        if (LATEX_SYMBOL_MAP[cmd]) {
          nodes.push(
            <span key={nextKey()} className="ty-math-sym">
              {LATEX_SYMBOL_MAP[cmd]}
            </span>
          );
          continue;
        }

        // Standard math functions like sin, cos, log, lim, max, min
        nodes.push(
          <span key={nextKey()} className="ty-math-fn">
            {cmd}
          </span>
        );
        continue;
      }

      i += 1;
      continue;
    }

    if ("+-=<>*/".includes(ch)) {
      const displayOp = ch === "-" ? "−" : ch;
      nodes.push(
        <span key={nextKey()} className="ty-math-op">
          {displayOp}
        </span>
      );
      i += 1;
      continue;
    }

    nodes.push(<span key={nextKey()}>{ch}</span>);
    i += 1;
  }

  return nodes;
}

export const MathFormulaView: React.FC<{
  tex: string;
  displayMode?: boolean;
}> = ({ tex, displayMode = false }) => {
  const trimmed = String(tex ?? "").trim();
  if (!trimmed) {
    return (
      <span className="ty-math-empty">
        {displayMode ? "Empty Math Block (Click to edit LaTeX)" : "$...$"}
      </span>
    );
  }
  return (
    <span
      className={displayMode ? "ty-math-block-render" : "ty-math-inline-render"}
      title={`LaTeX: ${trimmed}`}
    >
      {renderLatexExpressionToNodes(trimmed)}
    </span>
  );
};

interface FlowNode {
  id: string;
  label: string;
  shape: "rect" | "round" | "diamond" | "circle";
  width: number;
  height: number;
}

interface FlowEdge {
  from: string;
  to: string;
  label: string;
  style: "solid" | "dashed" | "thick";
}

export function cleanMermaidCode(rawCode: string): string {
  const lines = String(rawCode ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  while (lines.length > 0 && !lines[0].trim()) {
    lines.shift();
  }
  while (lines.length > 0 && !lines[lines.length - 1].trim()) {
    lines.pop();
  }
  if (lines.length > 0 && /^\s*(`{3,}|~{3,})/.test(lines[0])) {
    lines.shift();
  }
  if (
    lines.length > 0 &&
    /^\s*(`{3,}|~{3,})\s*$/.test(lines[lines.length - 1])
  ) {
    lines.pop();
  }
  return lines.join("\n").trim();
}

function estimateTextWidth(text: string, fontSize = 12.5): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      width += fontSize * 1.04;
    } else if (code <= 0x7f) {
      width += fontSize * 0.6;
    } else {
      width += fontSize * 0.85;
    }
  }
  return Math.ceil(width);
}

function computeNodeDimensions(
  label: string,
  shape: FlowNode["shape"]
): { width: number; height: number } {
  const textW = estimateTextWidth(label, 12.5);
  if (shape === "circle") {
    const diameter = Math.max(54, textW + 24);
    return { width: diameter, height: diameter };
  }
  if (shape === "diamond") {
    const w = Math.max(128, Math.round(textW * 1.48) + 40);
    const h = Math.max(54, 54);
    return { width: w, height: h };
  }
  const w = Math.max(108, textW + 32);
  return { width: w, height: 40 };
}

function parseMermaidFlowchart(
  rawCode: string,
  diagramType?: string
): {
  direction: "TD" | "BT" | "LR" | "RL";
  nodes: FlowNode[];
  edges: FlowEdge[];
} {
  const cleaned = cleanMermaidCode(rawCode);
  const lines = cleaned
    .split("\n")
    .map((l) => l.trim().replace(/;\s*$/, ""))
    .filter((l) => l && !l.startsWith("%%"));

  let direction: "TD" | "BT" | "LR" | "RL" =
    diagramType === "flow" ? "TD" : "TD";
  let startIdx = 0;

  if (lines.length > 0) {
    const header = lines[0];
    const dirMatch = header.match(
      /^(?:graph|flowchart)\s+(TB|TD|BT|RL|LR)\b/i
    );
    if (dirMatch) {
      const d = dirMatch[1].toUpperCase();
      direction = (d === "TB" ? "TD" : d) as "TD" | "BT" | "LR" | "RL";
      startIdx = 1;
    } else if (/^(?:graph|flowchart|stateDiagram(?:-v2)?)\b/i.test(header)) {
      startIdx = 1;
    }
  }

  const nodeMap = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];

  const upsertNode = (
    id: string,
    label?: string,
    shape?: FlowNode["shape"]
  ): string => {
    const existing = nodeMap.get(id);
    const resolvedLabel =
      label !== undefined ? label : existing ? existing.label : id;
    const resolvedShape =
      shape !== undefined ? shape : existing ? existing.shape : "rect";
    const dims = computeNodeDimensions(resolvedLabel, resolvedShape);
    nodeMap.set(id, {
      id,
      label: resolvedLabel,
      shape: resolvedShape,
      width: dims.width,
      height: dims.height
    });
    return id;
  };

  const registerToken = (rawToken: string): string => {
    const token = rawToken.trim();
    if (token === "[*]") {
      return upsertNode("__state_star__", "●", "circle");
    }
    const stadiumMatch = token.match(/^([A-Za-z0-9_.-]+)\(\[([^\]]+)\]\)$/);
    if (stadiumMatch) {
      return upsertNode(
        stadiumMatch[1],
        stadiumMatch[2].replace(/^["']|["']$/g, "").trim(),
        "round"
      );
    }
    const circleMatch = token.match(/^([A-Za-z0-9_.-]+)\(\(([^)]+)\)\)$/);
    if (circleMatch) {
      return upsertNode(
        circleMatch[1],
        circleMatch[2].replace(/^["']|["']$/g, "").trim(),
        "circle"
      );
    }
    const diamondMatch = token.match(/^([A-Za-z0-9_.-]+)\{([^}]+)\}$/);
    if (diamondMatch) {
      return upsertNode(
        diamondMatch[1],
        diamondMatch[2].replace(/^["']|["']$/g, "").trim(),
        "diamond"
      );
    }
    const roundMatch = token.match(/^([A-Za-z0-9_.-]+)\(([^)]+)\)$/);
    if (roundMatch) {
      return upsertNode(
        roundMatch[1],
        roundMatch[2].replace(/^["']|["']$/g, "").trim(),
        "round"
      );
    }
    const rectMatch = token.match(/^([A-Za-z0-9_.-]+)\[([^\]]+)\]$/);
    if (rectMatch) {
      return upsertNode(
        rectMatch[1],
        rectMatch[2].replace(/^["']|["']$/g, "").trim(),
        "rect"
      );
    }
    // flowjs syntax e.g. st=>start: Start
    const flowJsMatch = token.match(
      /^([A-Za-z0-9_.-]+)=>([a-z]+):\s*(.+)$/i
    );
    if (flowJsMatch) {
      const kind = flowJsMatch[2].toLowerCase();
      const shape: FlowNode["shape"] =
        kind === "condition"
          ? "diamond"
          : kind === "start" || kind === "end"
          ? "round"
          : "rect";
      return upsertNode(flowJsMatch[1], flowJsMatch[3].trim(), shape);
    }
    const id = token.replace(/[^A-Za-z0-9_.-]/g, "") || "Node";
    return upsertNode(id);
  };

  for (let idx = startIdx; idx < lines.length; idx += 1) {
    const line = lines[idx];
    if (/^(?:subgraph|end|style|classDef|class|click|linkStyle|direction)\b/i.test(line)) {
      continue;
    }

    // State diagram transition: A --> B : label
    const stateEdge = line.match(
      /^(\[\*\]|[A-Za-z0-9_.-]+)\s*(-->|-\.->|==>)\s*(\[\*\]|[A-Za-z0-9_.-]+)(?:\s*:\s*(.+))?$/
    );
    if (stateEdge && (stateEdge[1] === "[*]" || stateEdge[3] === "[*]" || stateEdge[4])) {
      const fromId =
        stateEdge[1] === "[*]"
          ? upsertNode("Start_State", "●", "circle")
          : registerToken(stateEdge[1]);
      const toId =
        stateEdge[3] === "[*]"
          ? upsertNode("End_State", "◉", "circle")
          : registerToken(stateEdge[3]);
      const arrow = stateEdge[2];
      edges.push({
        from: fromId,
        to: toId,
        label: (stateEdge[4] || "").trim(),
        style:
          arrow === "-.->" ? "dashed" : arrow === "==>" ? "thick" : "solid"
      });
      continue;
    }

    // Inline labeled edge: A -- label --> B, A -. label .-> B, A == label ==> B
    const inlineLabelEdge = line.match(
      /^(.+?)\s*(?:--\s*([^-]+?)\s*-->|-\.\s*([^.]+?)\s*\.->|==\s*([^=]+?)\s*==>)\s*(.+)$/
    );
    if (inlineLabelEdge) {
      const fromId = registerToken(inlineLabelEdge[1]);
      const label = (
        inlineLabelEdge[2] ||
        inlineLabelEdge[3] ||
        inlineLabelEdge[4] ||
        ""
      ).trim();
      const style: FlowEdge["style"] = inlineLabelEdge[3]
        ? "dashed"
        : inlineLabelEdge[4]
        ? "thick"
        : "solid";
      const toId = registerToken(inlineLabelEdge[5]);
      edges.push({ from: fromId, to: toId, label, style });
      continue;
    }

    // Pipe / standard / chained edges: A -->|label| B --> C
    if (/(-->|-\.->|==>|\b->\b)/.test(line)) {
      const chainRegex =
        /\s*(-->|-\.->|==>|->)\s*(?:\|([^|]*)\|)?\s*/g;
      const tokens: string[] = [];
      const connectors: Array<{ arrow: string; label: string }> = [];
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = chainRegex.exec(line)) !== null) {
        tokens.push(line.slice(lastIndex, match.index));
        connectors.push({
          arrow: match[1],
          label: (match[2] || "").trim()
        });
        lastIndex = chainRegex.lastIndex;
      }
      tokens.push(line.slice(lastIndex));

      if (tokens.length >= 2 && tokens.every((t) => t.trim().length > 0)) {
        const nodeIds = tokens.map((t) =>
          registerToken(t.replace(/\([a-z]+\)$/i, ""))
        );
        for (let k = 0; k < connectors.length; k += 1) {
          const conn = connectors[k];
          edges.push({
            from: nodeIds[k],
            to: nodeIds[k + 1],
            label: conn.label,
            style:
              conn.arrow === "-.->"
                ? "dashed"
                : conn.arrow === "==>"
                ? "thick"
                : "solid"
          });
        }
        continue;
      }
    }

    // Standalone node declaration e.g. A[Label] or st=>start: Start
    if (
      /^[A-Za-z0-9_.-]+(?:\[[^\]]+\]|\([^)]+\)|\{[^}]+\}|=>[a-z]+:.+)$/i.test(
        line
      )
    ) {
      registerToken(line);
    }
  }

  return {
    direction,
    nodes: Array.from(nodeMap.values()),
    edges
  };
}

function layoutFlowchart2D(parsed: {
  direction: "TD" | "BT" | "LR" | "RL";
  nodes: FlowNode[];
  edges: FlowEdge[];
}): {
  width: number;
  height: number;
  coords: Map<string, { x: number; y: number }>;
  ranks: Map<string, number>;
} {
  const { direction, nodes, edges } = parsed;
  const isHorizontal = direction === "LR" || direction === "RL";

  // 1. Compute longest-path topological rank for each node (with cycle protection)
  const ranks = new Map<string, number>();
  const inDegree = new Map<string, number>();
  const outEdges = new Map<string, string[]>();
  const inEdges = new Map<string, string[]>();

  for (const n of nodes) {
    ranks.set(n.id, 0);
    inDegree.set(n.id, 0);
    outEdges.set(n.id, []);
    inEdges.set(n.id, []);
  }
  for (const e of edges) {
    if (e.from === e.to) continue;
    if (!outEdges.has(e.from) || !outEdges.has(e.to)) continue;
    outEdges.get(e.from)!.push(e.to);
    inEdges.get(e.to)!.push(e.from);
    inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
  }

  // Iterative relaxation up to V-1 times (handles DAGs cleanly and terminates on cycles)
  const maxIter = Math.max(1, nodes.length);
  for (let iter = 0; iter < maxIter; iter += 1) {
    let changed = false;
    for (const e of edges) {
      if (e.from === e.to) continue;
      const rFrom = ranks.get(e.from) ?? 0;
      const rTo = ranks.get(e.to) ?? 0;
      // Avoid infinite rank escalation on cycles by checking if e.from is already downstream of e.to
      if (rTo < rFrom + 1 && rFrom < nodes.length - 1) {
        ranks.set(e.to, rFrom + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Group nodes by rank
  const layersMap = new Map<number, FlowNode[]>();
  let maxRank = 0;
  for (const n of nodes) {
    const r = ranks.get(n.id) ?? 0;
    if (r > maxRank) maxRank = r;
    if (!layersMap.has(r)) layersMap.set(r, []);
    layersMap.get(r)!.push(n);
  }

  const orderedRanks = Array.from({ length: maxRank + 1 }, (_, idx) => idx);
  if (direction === "RL" || direction === "BT") {
    orderedRanks.reverse();
  }

  // Barycenter ordering within each layer to minimize edge crossings
  const nodeOrderInLayer = new Map<string, number>();
  for (let rIdx = 0; rIdx <= maxRank; rIdx += 1) {
    const layer = layersMap.get(rIdx) || [];
    if (rIdx > 0 && layer.length > 1) {
      layer.sort((a, b) => {
        const predsA = inEdges.get(a.id) || [];
        const predsB = inEdges.get(b.id) || [];
        const avgA =
          predsA.length > 0
            ? predsA.reduce((s, p) => s + (nodeOrderInLayer.get(p) ?? 0), 0) /
              predsA.length
            : 0;
        const avgB =
          predsB.length > 0
            ? predsB.reduce((s, p) => s + (nodeOrderInLayer.get(p) ?? 0), 0) /
              predsB.length
            : 0;
        return avgA - avgB;
      });
    }
    layer.forEach((n, idx) => nodeOrderInLayer.set(n.id, idx));
  }

  const padX = 36;
  const padY = 28;
  const rankGap = isHorizontal ? 86 : 64;
  const siblingGap = isHorizontal ? 34 : 44;

  const coords = new Map<string, { x: number; y: number }>();

  if (isHorizontal) {
    // Each rank is a vertical column of nodes; columns flow left-to-right
    const colWidths: number[] = [];
    const colHeights: number[] = [];

    for (const r of orderedRanks) {
      const layer = layersMap.get(r) || [];
      const maxW = layer.reduce((m, n) => Math.max(m, n.width), 100);
      const totalH =
        layer.reduce((s, n) => s + n.height, 0) +
        Math.max(0, layer.length - 1) * siblingGap;
      colWidths.push(maxW);
      colHeights.push(totalH);
    }

    const contentW =
      colWidths.reduce((s, w) => s + w, 0) +
      Math.max(0, orderedRanks.length - 1) * rankGap;
    const maxColH = colHeights.reduce((m, h) => Math.max(m, h), 80);
    const width = Math.max(460, contentW + padX * 2);
    const height = Math.max(168, maxColH + padY * 2);

    let cursorX = (width - contentW) / 2;
    orderedRanks.forEach((r, cIdx) => {
      const layer = layersMap.get(r) || [];
      const colW = colWidths[cIdx];
      const colH = colHeights[cIdx];
      const centerX = cursorX + colW / 2;
      let cursorY = (height - colH) / 2;

      for (const n of layer) {
        coords.set(n.id, {
          x: Math.round(centerX),
          y: Math.round(cursorY + n.height / 2)
        });
        cursorY += n.height + siblingGap;
      }
      cursorX += colW + rankGap;
    });

    return { width, height, coords, ranks };
  } else {
    // Each rank is a horizontal row of nodes; rows flow top-to-bottom
    const rowWidths: number[] = [];
    const rowHeights: number[] = [];

    for (const r of orderedRanks) {
      const layer = layersMap.get(r) || [];
      const totalW =
        layer.reduce((s, n) => s + n.width, 0) +
        Math.max(0, layer.length - 1) * siblingGap;
      const maxH = layer.reduce((m, n) => Math.max(m, n.height), 40);
      rowWidths.push(totalW);
      rowHeights.push(maxH);
    }

    const maxRowW = rowWidths.reduce((m, w) => Math.max(m, w), 220);
    const contentH =
      rowHeights.reduce((s, h) => s + h, 0) +
      Math.max(0, orderedRanks.length - 1) * rankGap;
    const width = Math.max(460, maxRowW + padX * 2);
    const height = Math.max(168, contentH + padY * 2);

    let cursorY = (height - contentH) / 2;
    orderedRanks.forEach((r, rIdx) => {
      const layer = layersMap.get(r) || [];
      const rowW = rowWidths[rIdx];
      const rowH = rowHeights[rIdx];
      const centerY = cursorY + rowH / 2;
      let cursorX = (width - rowW) / 2;

      for (const n of layer) {
        coords.set(n.id, {
          x: Math.round(cursorX + n.width / 2),
          y: Math.round(centerY)
        });
        cursorX += n.width + siblingGap;
      }
      cursorY += rowH + rankGap;
    });

    return { width, height, coords, ranks };
  }
}

export const MermaidDiagramView: React.FC<{
  code: string;
  diagramType?: string;
}> = ({ code, diagramType }) => {
  const rawUid = React.useId();
  const uid = rawUid.replace(/[^A-Za-z0-9_-]/g, "");
  const cleaned = cleanMermaidCode(code);
  const firstLine = (cleaned.split("\n")[0] || "").trim().toLowerCase();

  if (!cleaned) {
    return (
      <div
        className="ty-mermaid-svg-wrap"
        style={{
          minHeight: 72,
          color: "var(--muted-text-color)",
          fontSize: 12.5
        }}
      >
        输入 Mermaid 语法（如 graph LR / sequenceDiagram / pie）即可实时渲染矢量图
      </div>
    );
  }

  // 1. Sequence Diagram
  if (
    firstLine.startsWith("sequencediagram") ||
    diagramType === "sequence"
  ) {
    const rawLines = cleaned
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("%%"));
    const bodyLines = firstLine.startsWith("sequencediagram")
      ? rawLines.slice(1)
      : rawLines;

    const participants: string[] = [];
    const aliasLabels = new Map<string, string>();
    const messages: Array<{
      from: string;
      to: string;
      text: string;
      dashed: boolean;
    }> = [];

    const ensureParticipant = (id: string) => {
      if (!participants.includes(id)) {
        participants.push(id);
      }
    };

    for (const line of bodyLines) {
      const partMatch = line.match(
        /^(?:participant|actor)\s+([^\s]+?)(?:\s+as\s+(.+))?$/i
      );
      if (partMatch) {
        const id = partMatch[1].replace(/^["']|["']$/g, "");
        ensureParticipant(id);
        if (partMatch[2]) {
          aliasLabels.set(
            id,
            partMatch[2].replace(/^["']|["']$/g, "").trim()
          );
        }
        continue;
      }
      const msgMatch = line.match(
        /^([^\s-:]+)\s*(-->>|->>|-->|->|--x|-x)\s*([^\s-:]+)\s*:\s*(.+)$/
      );
      if (msgMatch) {
        ensureParticipant(msgMatch[1]);
        ensureParticipant(msgMatch[3]);
        messages.push({
          from: msgMatch[1],
          to: msgMatch[3],
          text: msgMatch[4].trim(),
          dashed: msgMatch[2].startsWith("--")
        });
      }
    }

    if (participants.length > 0) {
      const boxWidths = participants.map((p) => {
        const label = aliasLabels.get(p) || p;
        return Math.max(116, estimateTextWidth(label, 12.5) + 28);
      });
      const maxBoxW = Math.max(120, ...boxWidths);
      const maxMsgW = messages.reduce(
        (m, msg) => Math.max(m, estimateTextWidth(msg.text, 12) + 36),
        150
      );
      const colSpacing = Math.max(maxBoxW + 36, Math.min(240, maxMsgW));
      const padSide = Math.ceil(maxBoxW / 2) + 28;
      const width = Math.max(
        480,
        padSide * 2 + Math.max(0, participants.length - 1) * colSpacing
      );
      const topBoxY = 16;
      const boxH = 36;
      const firstMsgY = 92;
      const msgStepY = 54;
      const bottomBoxY = firstMsgY + Math.max(1, messages.length) * msgStepY + 12;
      const height = bottomBoxY + boxH + 16;
      const arrowId = `seq-arrow-${uid}`;

      return (
        <div className="ty-mermaid-svg-wrap">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            width={width}
            height={height}
            className="ty-mermaid-svg"
            style={{
              width: `${width}px`,
              maxWidth: "100%",
              height: "auto",
              display: "block",
              margin: "0 auto"
            }}
          >
            <defs>
              <marker
                id={arrowId}
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="4"
                orient="auto"
              >
                <path
                  d="M0,1 L7,4 L0,7 Z"
                  fill="var(--diagram-primary-border, #3b82f6)"
                />
              </marker>
            </defs>
            {participants.map((p, idx) => {
              const x = padSide + idx * colSpacing;
              const label = aliasLabels.get(p) || p;
              const bw = boxWidths[idx];
              return (
                <g key={p}>
                  <line
                    x1={x}
                    y1={topBoxY + boxH}
                    x2={x}
                    y2={bottomBoxY}
                    stroke="var(--diagram-lifeline, #cbd5e1)"
                    strokeWidth="1.5"
                    strokeDasharray="5 4"
                  />
                  {/* Top Participant Box */}
                  <rect
                    x={x - bw / 2}
                    y={topBoxY}
                    width={bw}
                    height={boxH}
                    rx={7}
                    fill="var(--diagram-node-bg, #ffffff)"
                    stroke="var(--diagram-node-border, #64748b)"
                    strokeWidth="1.5"
                  />
                  <text
                    x={x}
                    y={topBoxY + 22.5}
                    textAnchor="middle"
                    fontSize="12.5"
                    fontWeight="600"
                    fill="var(--diagram-node-text, #0f172a)"
                  >
                    {label}
                  </text>
                  {/* Bottom Participant Box */}
                  <rect
                    x={x - bw / 2}
                    y={bottomBoxY}
                    width={bw}
                    height={boxH}
                    rx={7}
                    fill="var(--diagram-node-bg, #ffffff)"
                    stroke="var(--diagram-node-border, #64748b)"
                    strokeWidth="1.5"
                  />
                  <text
                    x={x}
                    y={bottomBoxY + 22.5}
                    textAnchor="middle"
                    fontSize="12.5"
                    fontWeight="600"
                    fill="var(--diagram-node-text, #0f172a)"
                  >
                    {label}
                  </text>
                </g>
              );
            })}
            {messages.map((m, idx) => {
              const fromIdx = participants.indexOf(m.from);
              const toIdx = participants.indexOf(m.to);
              const x1 = padSide + fromIdx * colSpacing;
              const x2 = padSide + toIdx * colSpacing;
              const y = firstMsgY + idx * msgStepY;
              const labelW = estimateTextWidth(m.text, 12) + 14;

              if (fromIdx === toIdx) {
                return (
                  <g key={idx}>
                    <path
                      d={`M ${x1} ${y - 6} L ${x1 + 38} ${y - 6} L ${x1 + 38} ${y + 14} L ${x1 + 4} ${y + 14}`}
                      fill="none"
                      stroke="var(--diagram-primary-border, #3b82f6)"
                      strokeWidth="1.8"
                      strokeDasharray={m.dashed ? "5 4" : undefined}
                      markerEnd={`url(#${arrowId})`}
                    />
                    <rect
                      x={x1 + 44}
                      y={y - 6}
                      width={labelW}
                      height={20}
                      rx={4}
                      fill="var(--diagram-label-bg, #ffffff)"
                      opacity="0.92"
                    />
                    <text
                      x={x1 + 44 + labelW / 2}
                      y={y + 8}
                      textAnchor="middle"
                      fontSize="12"
                      fill="var(--diagram-node-text, #0f172a)"
                    >
                      {m.text}
                    </text>
                  </g>
                );
              }

              const midX = (x1 + x2) / 2;
              const dir = x2 > x1 ? 1 : -1;
              return (
                <g key={idx}>
                  <rect
                    x={midX - labelW / 2}
                    y={y - 24}
                    width={labelW}
                    height={19}
                    rx={4}
                    fill="var(--diagram-label-bg, #ffffff)"
                    opacity="0.94"
                  />
                  <text
                    x={midX}
                    y={y - 10}
                    textAnchor="middle"
                    fontSize="12"
                    fontWeight="500"
                    fill="var(--diagram-node-text, #0f172a)"
                  >
                    {m.text}
                  </text>
                  <line
                    x1={x1}
                    y1={y}
                    x2={x2 - dir * 3}
                    y2={y}
                    stroke="var(--diagram-primary-border, #3b82f6)"
                    strokeWidth="1.8"
                    strokeDasharray={m.dashed ? "5 4" : undefined}
                    markerEnd={`url(#${arrowId})`}
                  />
                </g>
              );
            })}
          </svg>
        </div>
      );
    }
  }

  // 2. Pie Chart
  if (firstLine.startsWith("pie")) {
    const lines = cleaned.split("\n").map((l) => l.trim());
    let title = "";
    const slices: Array<{ label: string; value: number }> = [];
    for (const line of lines) {
      const titleMatch = line.match(/^(?:pie\s+)?title\s+(.+)$/i);
      if (titleMatch) {
        title = titleMatch[1].trim();
        continue;
      }
      const sliceMatch = line.match(/^"([^"]+)"\s*:\s*(\d+(?:\.\d+)?)$/);
      if (sliceMatch) {
        slices.push({
          label: sliceMatch[1],
          value: parseFloat(sliceMatch[2])
        });
      }
    }
    if (slices.length > 0) {
      const total = slices.reduce((sum, s) => sum + s.value, 0) || 1;
      const palette = [
        "#3b82f6",
        "#10b981",
        "#f59e0b",
        "#ec4899",
        "#8b5cf6",
        "#06b6d4"
      ];
      let accAngle = -Math.PI / 2;
      const width = 500;
      const height = 228;

      return (
        <div className="ty-mermaid-svg-wrap">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            width={width}
            height={height}
            className="ty-mermaid-svg"
            style={{
              width: `${width}px`,
              maxWidth: "100%",
              height: "auto",
              display: "block",
              margin: "0 auto"
            }}
          >
            {title && (
              <text
                x={width / 2}
                y="24"
                textAnchor="middle"
                fontSize="13.5"
                fontWeight="600"
                fill="var(--diagram-node-text, #0f172a)"
              >
                {title}
              </text>
            )}
            <g transform="translate(135, 124)">
              {slices.map((slice, idx) => {
                const angle = (slice.value / total) * Math.PI * 2;
                const x1 = Math.cos(accAngle) * 74;
                const y1 = Math.sin(accAngle) * 74;
                const x2 = Math.cos(accAngle + angle) * 74;
                const y2 = Math.sin(accAngle + angle) * 74;
                const largeArc = angle > Math.PI ? 1 : 0;
                const pathData =
                  slices.length === 1
                    ? "M 0 -74 A 74 74 0 1 1 -0.01 -74 Z"
                    : `M 0 0 L ${x1} ${y1} A 74 74 0 ${largeArc} 1 ${x2} ${y2} Z`;
                accAngle += angle;
                return (
                  <path
                    key={idx}
                    d={pathData}
                    fill={palette[idx % palette.length]}
                    stroke="var(--diagram-bg, #ffffff)"
                    strokeWidth="2"
                  />
                );
              })}
            </g>
            <g transform="translate(245, 62)">
              {slices.map((slice, idx) => {
                const pct = Math.round((slice.value / total) * 100);
                return (
                  <g key={idx} transform={`translate(0, ${idx * 27})`}>
                    <rect
                      width="12"
                      height="12"
                      rx="3"
                      fill={palette[idx % palette.length]}
                    />
                    <text
                      x="20"
                      y="10.5"
                      fontSize="12.5"
                      fill="var(--diagram-node-text, #0f172a)"
                    >
                      {slice.label} ({pct}%)
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      );
    }
  }

  // 3. Gantt Chart
  if (firstLine.startsWith("gantt")) {
    const lines = cleaned.split("\n").map((l) => l.trim());
    let title = "";
    const tasks: Array<{ section: string; name: string; offset: number; span: number }> = [];
    let currentSection = "默认阶段";
    let autoCursor = 0;

    for (const line of lines.slice(1)) {
      if (!line || line.startsWith("%%")) continue;
      if (/^(?:dateFormat|axisFormat|excludes|todayMarker)\b/i.test(line)) continue;
      const tMatch = line.match(/^title\s+(.+)$/i);
      if (tMatch) {
        title = tMatch[1].trim();
        continue;
      }
      const secMatch = line.match(/^section\s+(.+)$/i);
      if (secMatch) {
        currentSection = secMatch[1].trim();
        continue;
      }
      const taskMatch = line.match(/^([^:]+):\s*(.+)$/);
      if (taskMatch) {
        const name = taskMatch[1].trim();
        const meta = taskMatch[2];
        const durMatch = meta.match(/(\d+)\s*[dwh]/i);
        const span = durMatch ? Math.max(1, parseInt(durMatch[1], 10)) : 3;
        tasks.push({
          section: currentSection,
          name,
          offset: autoCursor,
          span
        });
        autoCursor += Math.max(1, Math.floor(span * 0.7));
      }
    }

    if (tasks.length > 0) {
      const totalUnits = Math.max(10, autoCursor + 4);
      const width = 580;
      const topY = title ? 44 : 20;
      const rowH = 30;
      const height = topY + tasks.length * rowH + 24;
      const chartLeft = 170;
      const chartWidth = width - chartLeft - 24;
      const palette = ["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b"];

      return (
        <div className="ty-mermaid-svg-wrap">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            width={width}
            height={height}
            className="ty-mermaid-svg"
            style={{
              width: `${width}px`,
              maxWidth: "100%",
              height: "auto",
              display: "block",
              margin: "0 auto"
            }}
          >
            {title && (
              <text
                x={width / 2}
                y="24"
                textAnchor="middle"
                fontSize="13.5"
                fontWeight="600"
                fill="var(--diagram-node-text, #0f172a)"
              >
                {title}
              </text>
            )}
            {tasks.map((t, idx) => {
              const y = topY + idx * rowH;
              const bx = chartLeft + (t.offset / totalUnits) * chartWidth;
              const bw = Math.max(28, (t.span / totalUnits) * chartWidth);
              return (
                <g key={idx}>
                  <line
                    x1={16}
                    y1={y + rowH}
                    x2={width - 16}
                    y2={y + rowH}
                    stroke="var(--diagram-lifeline, #cbd5e1)"
                    strokeWidth="0.75"
                    strokeDasharray="3 3"
                  />
                  <text
                    x={chartLeft - 12}
                    y={y + 19}
                    textAnchor="end"
                    fontSize="12"
                    fill="var(--diagram-node-text, #0f172a)"
                  >
                    {t.name}
                  </text>
                  <rect
                    x={bx}
                    y={y + 6}
                    width={Math.min(bw, width - 20 - bx)}
                    height={18}
                    rx={4}
                    fill={palette[idx % palette.length]}
                    opacity="0.88"
                  />
                </g>
              );
            })}
          </svg>
        </div>
      );
    }
  }

  // 4. Flowchart / Graph / State Diagram (2D Layered Sugiyama Layout)
  const parsed = parseMermaidFlowchart(cleaned, diagramType);
  if (parsed.nodes.length > 0) {
    const { width, height, coords } = layoutFlowchart2D(parsed);
    const nodeById = new Map(parsed.nodes.map((n) => [n.id, n]));
    const isHorizontal =
      parsed.direction === "LR" || parsed.direction === "RL";
    const arrowId = `flow-arrow-${uid}`;

    return (
      <div className="ty-mermaid-svg-wrap">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          className="ty-mermaid-svg"
          style={{
            width: `${width}px`,
            maxWidth: "100%",
            height: "auto",
            display: "block",
            margin: "0 auto"
          }}
        >
          <defs>
            <marker
              id={arrowId}
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
            >
              <path
                d="M0,1 L7,4 L0,7 Z"
                fill="var(--diagram-edge, #475569)"
              />
            </marker>
          </defs>

          {/* Edges (Smooth Cubic Bezier Curves + Pill Labels) */}
          {parsed.edges.map((edge, idx) => {
            const p1 = coords.get(edge.from);
            const p2 = coords.get(edge.to);
            const n1 = nodeById.get(edge.from);
            const n2 = nodeById.get(edge.to);
            if (!p1 || !p2 || !n1 || !n2) return null;

            let x1 = p1.x;
            let y1 = p1.y;
            let x2 = p2.x;
            let y2 = p2.y;
            let pathD = "";
            let labelX = (p1.x + p2.x) / 2;
            let labelY = (p1.y + p2.y) / 2;

            if (isHorizontal) {
              const dir = p2.x >= p1.x ? 1 : -1;
              x1 = p1.x + dir * (n1.width / 2);
              y1 = p1.y;
              x2 = p2.x - dir * (n2.width / 2 + 3);
              y2 = p2.y;
              const dx = Math.max(28, Math.abs(x2 - x1) * 0.48);
              const cx1 = x1 + dir * dx;
              const cy1 = y1;
              const cx2 = x2 - dir * dx;
              const cy2 = y2;
              pathD = `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
              // Cubic Bezier midpoint at t = 0.5
              labelX = 0.125 * x1 + 0.375 * cx1 + 0.375 * cx2 + 0.125 * x2;
              labelY = 0.125 * y1 + 0.375 * cy1 + 0.375 * cy2 + 0.125 * y2;
            } else {
              const dir = p2.y >= p1.y ? 1 : -1;
              x1 = p1.x;
              y1 = p1.y + dir * (n1.height / 2);
              x2 = p2.x;
              y2 = p2.y - dir * (n2.height / 2 + 3);
              const dy = Math.max(24, Math.abs(y2 - y1) * 0.48);
              const cx1 = x1;
              const cy1 = y1 + dir * dy;
              const cx2 = x2;
              const cy2 = y2 - dir * dy;
              pathD = `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
              labelX = 0.125 * x1 + 0.375 * cx1 + 0.375 * cx2 + 0.125 * x2;
              labelY = 0.125 * y1 + 0.375 * cy1 + 0.375 * cy2 + 0.125 * y2;
            }

            const pillW = edge.label
              ? Math.max(44, estimateTextWidth(edge.label, 11) + 14)
              : 0;

            return (
              <g key={idx}>
                <path
                  d={pathD}
                  fill="none"
                  stroke="var(--diagram-edge, #475569)"
                  strokeWidth={edge.style === "thick" ? "2.5" : "1.75"}
                  strokeDasharray={
                    edge.style === "dashed" ? "5 4" : undefined
                  }
                  markerEnd={`url(#${arrowId})`}
                />
                {edge.label && (
                  <g>
                    <rect
                      x={labelX - pillW / 2}
                      y={labelY - 10}
                      width={pillW}
                      height={20}
                      rx={5}
                      fill="var(--diagram-label-bg, #ffffff)"
                      stroke="var(--diagram-lifeline, #cbd5e1)"
                      strokeWidth="1"
                    />
                    <text
                      x={labelX}
                      y={labelY + 4}
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight="500"
                      fill="var(--diagram-node-text, #0f172a)"
                    >
                      {edge.label}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Nodes */}
          {parsed.nodes.map((node) => {
            const pt = coords.get(node.id);
            if (!pt) return null;
            const hw = node.width / 2;
            const hh = node.height / 2;
            return (
              <g key={node.id} transform={`translate(${pt.x}, ${pt.y})`}>
                {node.shape === "diamond" ? (
                  <polygon
                    points={`0,${-hh} ${hw},0 0,${hh} ${-hw},0`}
                    fill="var(--diagram-primary-bg, #eff6ff)"
                    stroke="var(--diagram-primary-border, #3b82f6)"
                    strokeWidth="1.6"
                  />
                ) : node.shape === "circle" ? (
                  <circle
                    r={hw}
                    fill="var(--diagram-accent-bg, #ecfdf5)"
                    stroke="var(--diagram-accent-border, #10b981)"
                    strokeWidth="1.6"
                  />
                ) : (
                  <rect
                    x={-hw}
                    y={-hh}
                    width={node.width}
                    height={node.height}
                    rx={node.shape === "round" ? hh : 7}
                    fill="var(--diagram-node-bg, #ffffff)"
                    stroke="var(--diagram-node-border, #64748b)"
                    strokeWidth="1.6"
                  />
                )}
                <text
                  x="0"
                  y="4.5"
                  textAnchor="middle"
                  fontSize="12.5"
                  fontWeight="500"
                  fill="var(--diagram-node-text, #0f172a)"
                >
                  {node.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    );
  }

  return (
    <pre className="ty-mermaid-fallback">
      <code>{cleaned}</code>
    </pre>
  );
};

