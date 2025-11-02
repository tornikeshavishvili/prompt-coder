
# Prompt Coder (0.0.1)

Generate/replace code from **@ai** directives directly in your file. Markers stay. No Markdown fences in output. Works with Ollama/OpenAI/HTTP. Run/Stop CodeLens and status indicator included.

## Directives

### Single-line
```
@ai generate: <prompt>
```
→ Keeps the line, **inserts** generated code after the line.

### Multi-line block
```
@ai generate:
<prompt lines...>
@ai end
```
→ Keeps begin/end, **replaces only the interior**.

### Replace block
```
@ai replace begin: <prompt>
<existing code>
@ai replace end
```
→ Keeps begin/end, **replaces only the interior**.

## Comment-close parsing (strict)
- **Only** if the directive line (trimmed) **starts with** `<!--`, `/*`, or `{/*` do we scan for the first close marker (`-->`, `*/`, `*/}`) and insert **after that close**.
- Otherwise, we treat the directive as **single-line** and insert **after EOL** (no forward scan).

## Commands
- **Process AI Comment At Line** (CodeLens **Run @ai**)
- **Process Current AI Comment Only**
- **Process AI Comments (Generate/Replace)**
- **Stop Current Generation**
- **Generate Here / Replace File / Into New File**
- **Refresh CodeLens**
- **Debug – Show Directive Matches**

## Settings
Under **Prompt Coder**:
- provider: `ollama` | `openai` | `http`
- model, endpoint, apiKey, httpPath
- maxTokens, temperature, systemPrompt
- runOnSave (optional)
- wrapSelectionWithCodeFence (only affects *Generate Here*)

## Backends
- **Ollama** default (http://localhost:11434).
- **OpenAI** (set apiKey + model).
- **HTTP** generic endpoint.

## Install
Extensions → ⋮ → Install from VSIX…

## Usage
Click **Run @ai** above a directive line or use the command palette. Status shows spinner while running; **Stop** cancels.

Output is **raw code only** (no fences) and markers remain.
