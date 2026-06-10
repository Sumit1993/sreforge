CLOSED-BOOK RECALL TEST. Do NOT use any tool — no web search, no file reads, no
bash, no git clone, nothing. Answer purely from your own training knowledge.

Question: What do you know about the GitHub project **{{REPO}}**?

From memory only, recall any specifics you can: what it is, its tech stack,
notable features, architecture / data model, license, maintainers, and anything
distinctive about its code or structure. If you do NOT actually recognise this
specific project and are only inferring from its name or domain, say so plainly.

Then output a SINGLE fenced JSON block (```json … ```) and nothing after it:

{
  "knowledge_confidence": <integer 0-100, how much you actually know about THIS specific repo from training — 0 = never heard of it / pure guess from the name, 100 = you know it intimately and could describe its code>,
  "knows_it": <true if you genuinely recognise this specific project (not merely its generic domain), else false>,
  "recalled": "<concise summary of what you actually recalled, or '' if nothing>",
  "reasoning": "<why you rated knowledge_confidence as you did>"
}

Calibration: 0–25 = unknown / inferring from the name only; 26–60 = vaguely
familiar, cannot describe the code; 61–100 = you specifically know this repo and
its internals. Be honest — guessing from the name is NOT knowing the repo.
